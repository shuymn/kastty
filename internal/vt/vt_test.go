package vt

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/creack/pty"
	"go.mitchellh.com/libghostty"
)

const cols, rows = 80, 24

func newMirror(t *testing.T) *Mirror {
	t.Helper()
	m, err := New(cols, rows, 10000)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(m.Close)
	return m
}

// state is what a viewer can observe; two mirrors in the same state render the same.
type state struct {
	Text           string
	CursorX        uint16
	CursorY        uint16
	Screen         libghostty.TerminalScreen
	CursorVisible  bool
	Title          string
	Modes          map[int]bool
	ScrollbackRows uint
}

var observedModes = []int{1, 6, 7, 25, 1000, 1002, 1003, 1004, 1006, 1049, 2004}

func observe(t *testing.T, m *Mirror) state {
	t.Helper()
	f, err := libghostty.NewFormatter(m.term, libghostty.WithFormatterFormat(libghostty.FormatterFormatPlain))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	text, err := f.FormatString()
	if err != nil {
		t.Fatal(err)
	}
	// Styled blank cells come back as explicit spaces; they render the same.
	lines := strings.Split(text, "\n")
	for i := range lines {
		lines[i] = strings.TrimRight(lines[i], " ")
	}
	s := state{Text: strings.Join(lines, "\n"), Title: m.Title(), Modes: map[int]bool{}}
	must := func(err error) {
		if err != nil {
			t.Fatal(err)
		}
	}
	s.CursorX, err = m.term.CursorX()
	must(err)
	s.CursorY, err = m.term.CursorY()
	must(err)
	s.Screen, err = m.term.ActiveScreen()
	must(err)
	s.CursorVisible, err = m.term.CursorVisible()
	must(err)
	s.ScrollbackRows, err = m.term.ScrollbackRows()
	must(err)
	for _, mode := range observedModes {
		s.Modes[mode], err = m.term.Mode(libghostty.NewMode(uint16(mode), false))
		must(err)
	}
	return s
}

func assertSameState(t *testing.T, want, got state) {
	t.Helper()
	if fmt.Sprintf("%+v", want) != fmt.Sprintf("%+v", got) {
		t.Fatalf("state differs\nwant %+v\n got %+v", want, got)
	}
}

// assertRoundTrip checks the snapshot invariant: replaying a snapshot into a
// fresh terminal reproduces the observable state, also after the program
// leaves the alternate screen, and snapshotting the replay is a fixed point.
func assertRoundTrip(t *testing.T, stream []byte) {
	t.Helper()
	orig := newMirror(t)
	orig.Write(stream)
	snap, err := orig.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	replay := newMirror(t)
	replay.Write(snap)
	assertSameState(t, observe(t, orig), observe(t, replay))

	again, err := replay.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	replay2 := newMirror(t)
	replay2.Write(again)
	if snap2, _ := replay2.Snapshot(); !bytes.Equal(again, snap2) {
		t.Fatalf("snapshot is not a fixed point (%d vs %d bytes)", len(again), len(snap2))
	}

	orig.Write([]byte("\x1b[?1049l"))
	replay.Write([]byte("\x1b[?1049l"))
	assertSameState(t, observe(t, orig), observe(t, replay))
}

func TestSnapshotRoundTrip(t *testing.T) {
	var styled bytes.Buffer
	for i := range 300 {
		fmt.Fprintf(&styled, "\x1b[38;5;%dm%03d \x1b[1;4;48;2;%d;%d;%dmstyled\x1b[0m 日本語テキスト 🧑‍💻 é\r\n", i%256, i, i%256, (i*7)%256, (i*13)%256)
	}
	cases := map[string]string{
		"styled scrollback with CJK and emoji":  styled.String(),
		"soft-wrapped lines":                    strings.Repeat("あいうえおかきくけこ", 30) + "\r\n" + strings.Repeat("x", 200) + "\r\nprompt$ ",
		"wide character at the right edge":      strings.Repeat("a", 79) + "漢字\r\n",
		"modes, scrolling region and title":     "\x1b[?1h\x1b[?2004h\x1b[?1000h\x1b[?1006h\x1b[?25l\x1b[5;20r\x1b[10;5Hinside region\x1b]2;my title\x07",
		"hyperlink":                             "\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\ after\r\n",
		"alternate screen over primary content": "primary 1\r\nprimary 2\r\n$ vim\x1b[?1049h\x1b[?1000h\x1b[2J\x1b[Halt content\x1b[5;10Hcursor",
		"query in history":                      "before\r\n\x1b[6nafter\r\n",
		"blank rows below scrolled content":     strings.Repeat("row\r\n", 40) + "\r\n\r\n\r\n",
		"scroll region after scrolled content":  strings.Repeat("row\r\n", 40) + "\x1b[2;10r\x1b[5;3H",
	}
	for name, stream := range cases {
		t.Run(name, func(t *testing.T) { assertRoundTrip(t, []byte(stream)) })
	}
}

// record runs a real program in a PTY and returns everything it wrote.
func record(t *testing.T, keys []string, name string, args ...string) []byte {
	t.Helper()
	if _, err := exec.LookPath(name); err != nil {
		t.Skipf("%s not installed", name)
	}
	cmd := exec.Command(name, args...)
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")
	f, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: cols, Rows: rows})
	if err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	done := make(chan struct{})
	go func() {
		defer close(done)
		buf := make([]byte, 32*1024)
		for {
			n, err := f.Read(buf)
			out.Write(buf[:n])
			if err != nil {
				return
			}
		}
	}()
	time.Sleep(400 * time.Millisecond)
	for _, k := range keys {
		_, _ = f.Write([]byte(k))
		time.Sleep(300 * time.Millisecond)
	}
	_ = cmd.Process.Kill()
	_ = cmd.Wait()
	_ = f.Close()
	<-done
	return out.Bytes()
}

func TestSnapshotRoundTripRecordedPrograms(t *testing.T) {
	file := filepath.Join(t.TempDir(), "hosts.txt")
	if err := os.WriteFile(file, []byte(strings.Repeat("127.0.0.1 localhost 日本語\n", 60)), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Run("vim", func(t *testing.T) {
		assertRoundTrip(t, record(t, []string{"10j", "\x1b:set nu\r"}, "vim", "-u", "NONE", "-N", "-c", "set mouse=a", file))
	})
	t.Run("less", func(t *testing.T) { assertRoundTrip(t, record(t, []string{" "}, "less", file)) })
	t.Run("fzf --height", func(t *testing.T) { assertRoundTrip(t, record(t, []string{"loc"}, "fzf", "--height", "40%")) })
}

func TestWriteReturnsQueryRepliesOnce(t *testing.T) {
	m := newMirror(t)
	replies, _ := m.Write([]byte("abc\x1b[6n"))
	if got, want := string(replies), "\x1b[1;4R"; got != want {
		t.Fatalf("replies = %q, want %q", got, want)
	}
	if replies, _ := m.Write([]byte("more output")); replies != nil {
		t.Fatalf("unexpected replies %q", replies)
	}
}

func TestResizeReturnsTheInBandSizeReport(t *testing.T) {
	m := newMirror(t)
	if replies, err := m.Resize(100, 30); err != nil || replies != nil {
		t.Fatalf("Resize without mode 2048 = %q, %v; want no replies", replies, err)
	}
	m.Write([]byte("\x1b[?2048h"))
	replies, err := m.Resize(90, 20)
	if err != nil || !strings.HasPrefix(string(replies), "\x1b[48;20;90;") {
		t.Fatalf("Resize with mode 2048 = %q, %v; want the in-band size report", replies, err)
	}
}

func TestWriteReportsTitleChanges(t *testing.T) {
	m := newMirror(t)
	if _, changed := m.Write([]byte("plain")); changed {
		t.Fatal("title reported as changed without OSC 0/2")
	}
	if _, changed := m.Write([]byte("\x1b]2;日本語タイトル\x1b\\")); !changed {
		t.Fatal("title change not reported")
	}
	if got := m.Title(); got != "日本語タイトル" {
		t.Fatalf("Title() = %q", got)
	}
}

func TestSnapshotStripsControlsFromTitle(t *testing.T) {
	m := newMirror(t)
	m.Write([]byte("\x1b]2;bad\x07title\x1b\\"))
	snap, err := m.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(snap, []byte("\x1b]2;bad\x07")) {
		t.Fatalf("title escaped its OSC: %q", snap)
	}
}

func TestPlainTextJoinsWrapsAndUsesPrimaryScreen(t *testing.T) {
	m := newMirror(t)
	long := strings.Repeat("x", 100)
	m.Write([]byte("first   \r\n" + long + "\r\n\r\n\r\n"))
	m.Write([]byte("\x1b[?1049h\x1b[2Jeditor content"))
	got, err := m.PlainText()
	if err != nil {
		t.Fatal(err)
	}
	if want := "first\n" + long + "\n"; got != want {
		t.Fatalf("PlainText() = %q, want %q", got, want)
	}
}

func TestPlainTextOfEmptyTerminalIsEmpty(t *testing.T) {
	got, err := newMirror(t).PlainText()
	if err != nil || got != "" {
		t.Fatalf("PlainText() = %q, %v", got, err)
	}
}

func TestScrollbackKeepsAtLeastTheRequestedLines(t *testing.T) {
	m, err := New(cols, rows, 100)
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	for i := range 5000 {
		fmt.Fprintf(m.term, "line %d\r\n", i)
	}
	n, err := m.term.ScrollbackRows()
	if err != nil {
		t.Fatal(err)
	}
	if n < 100 || n >= 5000 {
		t.Fatalf("scrollback rows = %d, want a bounded value of at least 100", n)
	}
}
