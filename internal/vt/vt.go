// Package vt keeps the host-side terminal state for one PTY using libghostty-vt
// (ADR 0017): the same VT engine the browser view runs, so a snapshot taken here
// renders identically there.
package vt

import (
	"bytes"
	"fmt"
	"strings"

	"go.mitchellh.com/libghostty"
)

// Nominal cell size in pixels. The host has no pixels, so the pixel sizes in
// reports (such as in-band resize reports) are derived from these.
const cellWidthPx, cellHeightPx = 8, 16

// Mirror is a libghostty-vt terminal fed with everything the PTY writes.
// It is not safe for concurrent use; the owning session serializes access.
type Mirror struct {
	term         *libghostty.Terminal
	replies      bytes.Buffer
	titleChanged bool
}

// New creates a mirror of the given size that keeps at least scrollbackLines
// lines of history (libghostty allocates whole pages, so it may keep more).
func New(cols, rows, scrollbackLines int) (*Mirror, error) {
	m := &Mirror{}
	term, err := libghostty.NewTerminal(
		libghostty.WithSize(uint16(cols), uint16(rows)),
		libghostty.WithMaxScrollbackLines(uint(scrollbackLines)),
		// Replies to queries in the output (cursor position, mode reports, …).
		// The host is the only responder, however many views are attached.
		libghostty.WithWritePty(func(_ *libghostty.Terminal, data []byte) { m.replies.Write(data) }),
		libghostty.WithTitleChanged(func(*libghostty.Terminal) { m.titleChanged = true }),
	)
	if err != nil {
		return nil, fmt.Errorf("create terminal: %w", err)
	}
	if err := term.Resize(uint16(cols), uint16(rows), cellWidthPx, cellHeightPx); err != nil {
		term.Close()
		return nil, fmt.Errorf("size terminal: %w", err)
	}
	m.term = term
	return m, nil
}

// Write feeds PTY output. It returns the replies the terminal produced, which
// the caller must write back to the PTY, and whether the title changed.
func (m *Mirror) Write(p []byte) (replies []byte, titleChanged bool) {
	m.replies.Reset()
	m.titleChanged = false
	m.term.VTWrite(p)
	if m.replies.Len() > 0 {
		replies = bytes.Clone(m.replies.Bytes())
	}
	return replies, m.titleChanged
}

// Resize changes the terminal size. Like Write, it returns replies for the
// PTY: the in-band size report when the program enabled mode 2048.
func (m *Mirror) Resize(cols, rows int) ([]byte, error) {
	m.replies.Reset()
	if err := m.term.Resize(uint16(cols), uint16(rows), cellWidthPx, cellHeightPx); err != nil {
		return nil, err
	}
	if m.replies.Len() == 0 {
		return nil, nil
	}
	return bytes.Clone(m.replies.Bytes()), nil
}

// Title returns the current window title (OSC 0 / OSC 2).
func (m *Mirror) Title() string {
	title, err := m.term.Title()
	if err != nil {
		return ""
	}
	return title
}

// Snapshot returns VT bytes that recreate the current state on a fresh
// terminal of the same size: scrollback, screen, modes, cursor and title.
func (m *Mirror) Snapshot() ([]byte, error) {
	var b bytes.Buffer
	alt, err := m.onAlternateScreen()
	if err != nil {
		return nil, err
	}
	if alt {
		// The formatter only sees the active screen. Emit the primary screen
		// from a clone switched back to it first; the alternate-screen output
		// that follows starts with its modes (including ?1049h), so it lands on
		// a fresh alternate screen and saves the primary cursor for when the
		// program exits.
		err := m.withPrimaryClone(func(primary *libghostty.Terminal) error {
			return formatVT(&b, primary)
		})
		if err != nil {
			return nil, err
		}
	}
	if err := formatVT(&b, m.term); err != nil {
		return nil, err
	}
	if title := m.Title(); title != "" {
		// The formatter does not emit the title.
		fmt.Fprintf(&b, "\x1b]2;%s\x1b\\", stripControls(title))
	}
	return b.Bytes(), nil
}

// PlainText returns the primary screen and its scrollback as plain text, with
// soft-wrapped rows joined, trailing whitespace trimmed and trailing blank lines
// dropped. It ends with a newline unless empty. This is what the editor opens.
func (m *Mirror) PlainText() (string, error) {
	alt, err := m.onAlternateScreen()
	if err != nil {
		return "", err
	}
	var text []byte
	plain := func(t *libghostty.Terminal) (err error) {
		text, err = format(t, libghostty.FormatterFormatPlain,
			libghostty.WithFormatterUnwrap(true),
			libghostty.WithFormatterTrim(true),
		)
		return err
	}
	if alt {
		err = m.withPrimaryClone(plain)
	} else {
		err = plain(m.term)
	}
	if err != nil {
		return "", fmt.Errorf("format plain text: %w", err)
	}
	lines := strings.Split(string(text), "\n")
	for i, line := range lines {
		lines[i] = strings.TrimRight(line, " \t")
	}
	for len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	if len(lines) == 0 {
		return "", nil
	}
	return strings.Join(lines, "\n") + "\n", nil
}

// Close releases the terminal.
func (m *Mirror) Close() {
	m.term.Close()
}

func (m *Mirror) onAlternateScreen() (bool, error) {
	screen, err := m.term.ActiveScreen()
	if err != nil {
		return false, fmt.Errorf("active screen: %w", err)
	}
	return screen == libghostty.ScreenAlternate, nil
}

// withPrimaryClone runs fn on a copy of the terminal switched to the primary screen.
func (m *Mirror) withPrimaryClone(fn func(*libghostty.Terminal) error) error {
	encoded, err := m.term.Snapshot()
	if err != nil {
		return fmt.Errorf("encode terminal: %w", err)
	}
	decoder, err := libghostty.NewSnapshotDecoderBytes(encoded)
	if err != nil {
		return fmt.Errorf("decode terminal: %w", err)
	}
	defer decoder.Close()
	clone, err := decoder.Decode()
	if err != nil {
		return fmt.Errorf("decode terminal: %w", err)
	}
	defer clone.Close()
	clone.VTWrite([]byte("\x1b[?1049l"))
	return fn(clone)
}

func formatVT(b *bytes.Buffer, t *libghostty.Terminal) error {
	full, err := format(t, libghostty.FormatterFormatVT,
		libghostty.WithFormatterExtraModes(true),
		libghostty.WithFormatterExtraScrollingRegion(true),
		libghostty.WithFormatterExtraTabstops(true),
		libghostty.WithFormatterExtraKeyboard(true),
		libghostty.WithFormatterExtraCursor(true),
		libghostty.WithFormatterExtraStyle(true),
		libghostty.WithFormatterExtraHyperlink(true),
		libghostty.WithFormatterExtraKittyKeyboard(true),
		libghostty.WithFormatterExtraCharsets(true),
		// No palette: ghostty-web 0.4.0 cannot parse OSC 4 "rgb:" values.
	)
	if err != nil {
		return err
	}
	pad, err := droppedBlankRows(t)
	if err != nil {
		return err
	}
	if pad == 0 {
		b.Write(full)
		return nil
	}
	// The formatter stops at the last non-blank row. When the screen has
	// scrolled, the blank rows below it matter: without them the replay puts
	// every row one or more lines too low. Re-insert them as newlines between
	// the content and the trailing state (scroll region, cursor, style), which
	// the formatter emits after the content.
	content, err := format(t, libghostty.FormatterFormatVT)
	if err != nil {
		return err
	}
	i := bytes.LastIndex(full, content)
	if len(content) == 0 || i < 0 {
		b.Write(full)
		return nil
	}
	end := i + len(content)
	b.Write(full[:end])
	b.Write(bytes.Repeat([]byte("\r\n"), pad))
	b.Write(full[end:])
	return nil
}

// droppedBlankRows counts the blank rows at the bottom of the screen that the
// formatter omits, when that changes where replayed rows land (only once
// rows have scrolled into history).
func droppedBlankRows(t *libghostty.Terminal) (int, error) {
	history, err := t.ScrollbackRows()
	if err != nil {
		return 0, fmt.Errorf("scrollback rows: %w", err)
	}
	if history == 0 {
		return 0, nil
	}
	rows, err := t.Rows()
	if err != nil {
		return 0, fmt.Errorf("rows: %w", err)
	}
	plain, err := format(t, libghostty.FormatterFormatPlain)
	if err != nil {
		return 0, err
	}
	emitted := bytes.Count(plain, []byte("\n")) + 1
	return max(0, int(history)+int(rows)-emitted), nil
}

func format(t *libghostty.Terminal, f libghostty.FormatterFormat, opts ...libghostty.FormatterOption) ([]byte, error) {
	fm, err := libghostty.NewFormatter(t, append([]libghostty.FormatterOption{libghostty.WithFormatterFormat(f)}, opts...)...)
	if err != nil {
		return nil, fmt.Errorf("create formatter: %w", err)
	}
	defer fm.Close()
	out, err := fm.Format()
	if err != nil {
		return nil, fmt.Errorf("format terminal: %w", err)
	}
	return out, nil
}

// stripControls removes C0/C1 controls so a title cannot terminate the OSC early.
func stripControls(s string) string {
	return strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f || (r >= 0x80 && r < 0xa0) {
			return -1
		}
		return r
	}, s)
}
