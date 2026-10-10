package session

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/shuymn/kastty/internal/protocol"
	"github.com/shuymn/kastty/internal/vt"
)

// fakeConn records frames like a browser would receive them. A gate, when
// set, blocks writes to simulate a slow connection.
type fakeConn struct {
	mu     sync.Mutex
	frames []recorded
	closed bool
	gate   chan struct{}
	notify chan struct{}
}

type recorded struct {
	binary bool
	data   []byte
}

func newFakeConn() *fakeConn { return &fakeConn{notify: make(chan struct{}, 1)} }

func (c *fakeConn) Write(ctx context.Context, binary bool, data []byte) error {
	c.mu.Lock()
	gate := c.gate
	c.mu.Unlock()
	if gate != nil {
		select {
		case <-gate:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	c.mu.Lock()
	c.frames = append(c.frames, recorded{binary, append([]byte(nil), data...)})
	c.mu.Unlock()
	select {
	case c.notify <- struct{}{}:
	default:
	}
	return nil
}

func (c *fakeConn) Close() error {
	c.mu.Lock()
	c.closed = true
	c.mu.Unlock()
	select {
	case c.notify <- struct{}{}:
	default:
	}
	return nil
}

func (c *fakeConn) snapshot() ([]recorded, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]recorded(nil), c.frames...), c.closed
}

// waitFor polls the received frames until cond holds.
func (c *fakeConn) waitFor(t *testing.T, what string, cond func(frames []recorded, closed bool) bool) []recorded {
	t.Helper()
	deadline := time.After(10 * time.Second)
	for {
		frames, closed := c.snapshot()
		if cond(frames, closed) {
			return frames
		}
		select {
		case <-c.notify:
		case <-time.After(20 * time.Millisecond):
		case <-deadline:
			t.Fatalf("timed out waiting for %s; got %d frames, closed=%v", what, len(frames), closed)
		}
	}
}

func controls(frames []recorded) []protocol.HostMessage {
	var out []protocol.HostMessage
	for _, f := range frames {
		if !f.binary {
			m, err := protocol.DecodeHost(f.data)
			if err != nil {
				panic(err)
			}
			out = append(out, m)
		}
	}
	return out
}

// screen replays frames into a VT the way the browser view does and returns
// its plain text, so tests can compare what a viewer would see.
func screen(t *testing.T, frames []recorded) string {
	t.Helper()
	var m *vt.Mirror
	reset := func(size protocol.Size) {
		if m != nil {
			m.Close()
		}
		var err error
		m, err = vt.New(size.Cols, size.Rows, 10000)
		if err != nil {
			t.Fatal(err)
		}
	}
	size := protocol.Size{Cols: 80, Rows: 24}
	for _, f := range frames {
		if f.binary {
			m.Write(f.data)
			continue
		}
		msg, _ := protocol.DecodeHost(f.data)
		switch msg := msg.(type) {
		case protocol.Attached:
			size = msg.Size
			reset(size)
		case protocol.Snapshot:
			reset(size)
		case protocol.Resized:
			size = msg.Size
			_, _ = m.Resize(size.Cols, size.Rows)
		}
	}
	defer m.Close()
	text, err := m.PlainText()
	if err != nil {
		t.Fatal(err)
	}
	return text
}

func start(t *testing.T, script string, opts ...func(*Options)) *Session {
	t.Helper()
	o := Options{
		ID:         "main",
		Kind:       protocol.KindMain,
		Argv:       []string{"/bin/sh", "-c", script},
		Env:        os.Environ(),
		Size:       protocol.Size{Cols: 80, Rows: 24},
		Scrollback: 1000,
		View:       protocol.ViewConfig{FontFamily: "Test Mono", Scrollback: 1000},
	}
	for _, f := range opts {
		f(&o)
	}
	s, err := Start(o)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		select {
		case <-s.Done():
		default:
			s.Kill()
			<-s.Done()
		}
	})
	return s
}

func attach(t *testing.T, s *Session) (*View, *fakeConn) {
	t.Helper()
	conn := newFakeConn()
	v, err := s.Attach(conn)
	if err != nil {
		t.Fatal(err)
	}
	return v, conn
}

func hasText(want string) func([]recorded, bool) bool {
	return func(frames []recorded, _ bool) bool {
		var b strings.Builder
		for _, f := range frames {
			if f.binary {
				b.Write(f.data)
			}
		}
		return strings.Contains(b.String(), want)
	}
}

func TestAttachSendsHandshakeAndSnapshotBeforeLiveOutput(t *testing.T) {
	s := start(t, `printf 'before\n'; read _; printf 'after\n'; sleep 30`)
	time.Sleep(300 * time.Millisecond)
	v, conn := attach(t, s)
	conn.waitFor(t, "snapshot", func(f []recorded, _ bool) bool { return len(f) >= 2 })
	s.Input(v, []byte("\n"))
	frames := conn.waitFor(t, "live output", hasText("after"))

	attached, ok := controls(frames[:1])[0].(protocol.Attached)
	if !ok {
		t.Fatalf("first frame = %q, want attached", frames[0].data)
	}
	want := protocol.Attached{
		Session: protocol.SessionInfo{ID: "main", Kind: protocol.KindMain},
		Size:    protocol.Size{Cols: 80, Rows: 24},
		View:    protocol.ViewConfig{FontFamily: "Test Mono", Scrollback: 1000},
	}
	if attached != want {
		t.Fatalf("attached = %+v, want %+v", attached, want)
	}
	if !frames[1].binary || !strings.Contains(string(frames[1].data), "before") {
		t.Fatalf("second frame should be the snapshot containing earlier output, got %q", frames[1].data)
	}
	if got := screen(t, frames); !strings.Contains(got, "before") || !strings.Contains(got, "after") {
		t.Fatalf("viewer screen = %q", got)
	}
}

func TestQueryIsAnsweredOnceWhateverTheNumberOfViews(t *testing.T) {
	// The program asks for the cursor position, then reports how many bytes of
	// reply it received.
	s := start(t, `stty raw -echo; read _; printf '\033[6n'; sleep 1; n=$(dd bs=256 count=1 2>/dev/null | wc -c); printf '\r\nreply-bytes=%d\r\n' $n; sleep 30`)
	v1, c1 := attach(t, s)
	_, _ = attach(t, s)
	_, _ = attach(t, s)
	time.Sleep(200 * time.Millisecond)
	s.Input(v1, []byte("\n")) // raw mode: read needs a literal newline
	frames := c1.waitFor(t, "reply count", hasText("reply-bytes="))
	got := screen(t, frames)
	// One reply is ESC [ row ; col R = 6 bytes for a single-digit position.
	if !strings.Contains(got, "reply-bytes=6") {
		t.Fatalf("screen = %q, want exactly one 6-byte reply", got)
	}
}

func TestDriverIsTheViewThatTypedLast(t *testing.T) {
	s := start(t, `sleep 30`)
	a, ca := attach(t, s)
	b, cb := attach(t, s)

	s.Resize(a, protocol.Size{Cols: 100, Rows: 30})
	s.Resize(b, protocol.Size{Cols: 90, Rows: 20})
	if got := s.Size(); got != (protocol.Size{Cols: 100, Rows: 30}) {
		t.Fatalf("size = %+v, want the first view's size", got)
	}

	s.Input(b, []byte("x"))
	if got := s.Size(); got != (protocol.Size{Cols: 90, Rows: 20}) {
		t.Fatalf("size = %+v, want the typing view's size", got)
	}
	for _, c := range []*fakeConn{ca, cb} {
		c.waitFor(t, "size broadcast", func(f []recorded, _ bool) bool {
			return slices.Contains(controls(f), protocol.HostMessage(protocol.Resized{Size: protocol.Size{Cols: 90, Rows: 20}}))
		})
	}
}

func TestSlowViewIsResyncedWithASnapshotAndOthersKeepStreaming(t *testing.T) {
	s := start(t, `read _; i=0; while [ $i -lt 3000 ]; do printf 'line %d xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n' $i; i=$((i+1)); done; printf 'END\n'; sleep 30`,
		func(o *Options) { o.HighWater = 4 << 10 })
	fast, cf := attach(t, s)
	_, slow := attach(t, s)
	cf.waitFor(t, "fast snapshot", func(f []recorded, _ bool) bool { return len(f) >= 2 })
	slow.waitFor(t, "slow snapshot", func(f []recorded, _ bool) bool { return len(f) >= 2 })

	gate := make(chan struct{})
	slow.mu.Lock()
	slow.gate = gate
	slow.mu.Unlock()

	s.Input(fast, []byte("\n"))
	fastFrames := cf.waitFor(t, "fast view output", hasText("END"))
	close(gate)

	slowFrames := slow.waitFor(t, "slow view resync", func(f []recorded, _ bool) bool {
		return slices.Contains(controls(f), protocol.HostMessage(protocol.Snapshot{}))
	})
	// Let anything queued after the resync drain, then compare what both see.
	time.Sleep(300 * time.Millisecond)
	slowFrames, _ = slow.snapshot()
	if a, b := screen(t, fastFrames), screen(t, slowFrames); a != b {
		t.Fatalf("slow view diverged after resync\nfast tail %q\nslow tail %q", tail(a), tail(b))
	}
}

func tail(s string) string {
	if len(s) > 200 {
		return s[len(s)-200:]
	}
	return s
}

func TestExitIsSentToViewsAndClosesThem(t *testing.T) {
	s := start(t, `read _; exit 3`)
	v, conn := attach(t, s)
	s.Input(v, []byte("\n"))
	frames := conn.waitFor(t, "exit", func(_ []recorded, closed bool) bool { return closed })
	msgs := controls(frames)
	if last := msgs[len(msgs)-1]; last != (protocol.Exit{Code: 3}) {
		t.Fatalf("last control = %+v, want exit 3", last)
	}
	if code := s.ExitCode(); code != 3 {
		t.Fatalf("ExitCode() = %d", code)
	}
	if _, err := s.Attach(newFakeConn()); !errors.Is(err, ErrExited) {
		t.Fatalf("Attach after exit: %v", err)
	}
}

func TestTitleChangesAreSent(t *testing.T) {
	s := start(t, `read _; printf '\033]2;my title\007'; sleep 30`)
	v, conn := attach(t, s)
	s.Input(v, []byte("\n"))
	conn.waitFor(t, "title", func(f []recorded, _ bool) bool {
		return slices.Contains(controls(f), protocol.HostMessage(protocol.Title{Title: "my title"}))
	})
}

func TestOnIdleRunsWhenTheLastViewDetaches(t *testing.T) {
	idle := make(chan struct{}, 1)
	s := start(t, `sleep 30`, func(o *Options) { o.OnIdle = func() { idle <- struct{}{} } })
	a, _ := attach(t, s)
	b, _ := attach(t, s)
	s.Detach(a)
	select {
	case <-idle:
		t.Fatal("OnIdle ran while a view was still attached")
	case <-time.After(100 * time.Millisecond):
	}
	s.Detach(b)
	select {
	case <-idle:
	case <-time.After(2 * time.Second):
		t.Fatal("OnIdle did not run")
	}
}

func TestQueryRepliesDoNotStallOutputWhileAPasteIsBlocked(t *testing.T) {
	// Every pasted line makes the command print a cursor position query. The
	// paste is larger than the tty input queue, so it waits for the command to
	// read, while the command waits for its output (and the replies) to drain.
	s := start(t, `stty -echo; while IFS= read -r l; do printf '%s\033[6n\n' "$l"; done`)
	v, conn := attach(t, s)
	var paste strings.Builder
	for i := range 400 {
		fmt.Fprintf(&paste, "line %03d %s\n", i, strings.Repeat("x", 20))
	}
	done := make(chan struct{})
	go func() {
		s.Input(v, []byte(paste.String()))
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("the paste never reached the command")
	}
	conn.waitFor(t, "the last pasted line", hasText("line 399"))
}

func TestInBandSizeReportsReachTheCommand(t *testing.T) {
	s := start(t, `stty raw -echo; printf '\033[?2048hREADY\r\n'; r=$(dd bs=1 count=20 2>/dev/null); printf 'GOT %s END\r\n' "${r#?}"; sleep 30`)
	v, conn := attach(t, s)
	conn.waitFor(t, "mode 2048", hasText("READY"))
	s.Resize(v, protocol.Size{Cols: 100, Rows: 30})
	conn.waitFor(t, "the size report read by the command", hasText("GOT [48;30;100;"))
}

func TestLaggingViewGetsTheFinalScreenWhenTheCommandExits(t *testing.T) {
	s := start(t, `read _; i=0; while [ $i -lt 3000 ]; do printf 'line %d xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n' $i; i=$((i+1)); done; printf 'FINAL\n'; exit 5`,
		func(o *Options) { o.HighWater = 4 << 10 })
	fast, cf := attach(t, s)
	_, slow := attach(t, s)
	cf.waitFor(t, "fast snapshot", func(f []recorded, _ bool) bool { return len(f) >= 2 })
	slow.waitFor(t, "slow snapshot", func(f []recorded, _ bool) bool { return len(f) >= 2 })

	gate := make(chan struct{})
	slow.mu.Lock()
	slow.gate = gate
	slow.mu.Unlock()

	s.Input(fast, []byte("\n"))
	cf.waitFor(t, "fast view exit", func(_ []recorded, closed bool) bool { return closed })
	close(gate)

	frames := slow.waitFor(t, "slow view exit", func(_ []recorded, closed bool) bool { return closed })
	msgs := controls(frames)
	if last := msgs[len(msgs)-1]; last != (protocol.Exit{Code: 5}) {
		t.Fatalf("last control = %+v, want exit 5", last)
	}
	if !slices.Contains(msgs, protocol.HostMessage(protocol.Snapshot{})) {
		t.Fatalf("the lagging view was not resynced before exit: %+v", msgs)
	}
	if text := screen(t, frames); !strings.Contains(text, "line 2999") || !strings.Contains(text, "FINAL") {
		t.Fatalf("the lagging view misses the final output; tail %q", tail(text))
	}
}

func TestDriverLeavingHandsTheSizeToTheLatestRemainingView(t *testing.T) {
	s := start(t, `sleep 30`)
	a, _ := attach(t, s)
	b, _ := attach(t, s)
	c, _ := attach(t, s)

	s.Resize(b, protocol.Size{Cols: 90, Rows: 20})
	s.Resize(c, protocol.Size{Cols: 70, Rows: 22})
	s.Resize(a, protocol.Size{Cols: 100, Rows: 30})
	s.Input(a, []byte("x"))
	if got := s.Size(); got != (protocol.Size{Cols: 100, Rows: 30}) {
		t.Fatalf("size = %+v, want the typing view's size", got)
	}

	s.Detach(a)
	if got := s.Size(); got != (protocol.Size{Cols: 70, Rows: 22}) {
		t.Fatalf("size = %+v, want the size of the view active most recently", got)
	}
	s.Detach(c)
	if got := s.Size(); got != (protocol.Size{Cols: 90, Rows: 20}) {
		t.Fatalf("size = %+v, want the last view's size", got)
	}
}

func TestCoalesceJoinsConsecutiveOutputUpToTheCap(t *testing.T) {
	big := make([]byte, maxCoalescedBytes-1)
	a := []byte("a")
	batch := []frame{
		{binary: true, data: a},
		{binary: true, data: []byte("b")},
		{data: []byte(`{"t":"title","title":"x"}`)},
		{binary: true, data: []byte("c")},
		{binary: true, data: big},
		{binary: true, data: []byte("d")},
	}
	var got []string
	for len(batch) > 0 {
		var f frame
		f, batch = coalesce(batch)
		kind := "text"
		if f.binary {
			kind = "binary"
		}
		got = append(got, fmt.Sprintf("%s %d", kind, len(f.data)))
	}
	want := []string{"binary 2", "text 25", "binary " + strconv.Itoa(maxCoalescedBytes), "binary 1"}
	if !slices.Equal(got, want) {
		t.Fatalf("messages = %q, want %q", got, want)
	}
	if string(a) != "a" {
		t.Fatalf("coalescing modified a frame shared with other views: %q", a)
	}
}

func TestInputStopsWaitingOnceTheViewIsGone(t *testing.T) {
	s := start(t, `sleep 30`) // never reads its input
	v, _ := attach(t, s)
	done := make(chan struct{})
	go func() {
		s.Input(v, bytes.Repeat([]byte("x"), 64<<10))
		close(done)
	}()
	time.Sleep(200 * time.Millisecond)
	v.fail() // e.g. the writer found the connection closed
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Input kept waiting for a view that is gone")
	}
}
