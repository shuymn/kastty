// Package session owns one PTY and its terminal state, and fans the state out
// to attached views (ADR 0017).
package session

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/shuymn/kastty/internal/protocol"
	"github.com/shuymn/kastty/internal/pty"
	"github.com/shuymn/kastty/internal/vt"
)

// DefaultHighWater is the live output a view may have waiting before the
// session stops sending it and resyncs the view with a snapshot instead.
const DefaultHighWater = 4 << 20

// maxPendingWrites bounds the writes waiting for the PTY. Query replies beyond
// it are dropped: a program that keeps querying without reading its input must
// not grow the queue forever.
const maxPendingWrites = 256

// ErrExited is returned when attaching to a session whose command has exited.
var ErrExited = errors.New("session has exited")

// Conn is a view's transport; a WebSocket in production.
type Conn interface {
	// Write sends one frame, blocking until it is handed to the network.
	Write(ctx context.Context, binary bool, data []byte) error
	// Close ends the connection normally after everything was written.
	Close() error
}

// Options configures a session.
type Options struct {
	ID         string
	Kind       protocol.Kind
	Argv       []string
	Env        []string
	Size       protocol.Size
	Scrollback int // lines of history the terminal keeps
	View       protocol.ViewConfig
	HighWater  int // defaults to DefaultHighWater
	// OnIdle runs after the last attached view detaches.
	OnIdle func()
}

// Session is a PTY plus the terminal state its output produces.
type Session struct {
	id        string
	kind      protocol.Kind
	viewCfg   protocol.ViewConfig
	highWater int
	onIdle    func()
	pty       *pty.PTY
	done      chan struct{}
	writers   sync.WaitGroup // one per view writer goroutine

	// input feeds the one goroutine that writes to the PTY. Writes block while
	// the command is not reading, so readLoop must never make them itself:
	// the command may be blocked on output that only readLoop drains.
	input chan ptyWrite

	mu       sync.Mutex // guards everything below and serializes the VT
	vt       *vt.Mirror
	views    map[*View]struct{}
	driver   *View
	activity uint64 // stamps View.active
	size     protocol.Size
	title    string
	exited   bool
	exitCode int
	attached bool // a view has attached at least once
}

// Start runs the command and begins mirroring its output.
func Start(opts Options) (*Session, error) {
	mirror, err := vt.New(opts.Size.Cols, opts.Size.Rows, opts.Scrollback)
	if err != nil {
		return nil, err
	}
	p, err := pty.Start(opts.Argv, opts.Env, opts.Size.Cols, opts.Size.Rows)
	if err != nil {
		mirror.Close()
		return nil, err
	}
	s := &Session{
		id:        opts.ID,
		kind:      opts.Kind,
		viewCfg:   opts.View,
		highWater: opts.HighWater,
		onIdle:    opts.OnIdle,
		pty:       p,
		done:      make(chan struct{}),
		input:     make(chan ptyWrite, maxPendingWrites),
		vt:        mirror,
		views:     map[*View]struct{}{},
		size:      opts.Size,
	}
	if s.highWater <= 0 {
		s.highWater = DefaultHighWater
	}
	go s.readLoop()
	go s.writeLoop()
	return s, nil
}

// ID returns the session id used in /attach/{id}.
func (s *Session) ID() string { return s.id }

// Kind returns whether this is the main or an editor session.
func (s *Session) Kind() protocol.Kind { return s.kind }

// Done is closed after the command exits and every view was told.
func (s *Session) Done() <-chan struct{} { return s.done }

// ExitCode returns the command's exit code; valid after Done is closed.
func (s *Session) ExitCode() int {
	<-s.done
	return s.exitCode
}

// Kill hangs up the command. The session then ends as if it exited.
func (s *Session) Kill() { s.pty.Kill() }

// Size returns the current terminal size.
func (s *Session) Size() protocol.Size {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.size
}

// PlainText returns the primary screen and scrollback as plain text.
func (s *Session) PlainText() (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.vt == nil {
		return "", ErrExited
	}
	return s.vt.PlainText()
}

func (s *Session) readLoop() {
	readDone := make(chan struct{})
	go s.pty.CloseAfterDrain(readDone)
	buf := make([]byte, 64<<10)
	for {
		n, err := s.pty.Read(buf)
		if n > 0 {
			s.output(buf[:n])
		}
		if err != nil {
			break
		}
	}
	close(readDone)
	s.finish(s.pty.ExitCode())
}

func (s *Session) output(p []byte) {
	s.mu.Lock()
	replies, titleChanged := s.vt.Write(p)
	data := append([]byte(nil), p...)
	for v := range s.views {
		v.enqueue(frame{binary: true, data: data, droppable: true})
	}
	if titleChanged {
		s.title = s.vt.Title()
		msg := protocol.EncodeHost(protocol.Title{Title: s.title})
		for v := range s.views {
			v.enqueue(frame{data: msg, droppable: true})
		}
	}
	s.mu.Unlock()
	s.reply(replies)
}

// reply queues VT replies for the PTY without waiting: the caller may be
// readLoop, or hold s.mu.
func (s *Session) reply(replies []byte) {
	if len(replies) == 0 {
		return
	}
	select {
	case s.input <- ptyWrite{data: replies}:
	default: // the command has stopped reading its input
	}
}

func (s *Session) finish(code int) {
	s.mu.Lock()
	s.exited = true
	s.exitCode = code
	msg := protocol.EncodeHost(protocol.Exit{Code: code})
	var final []byte // the last screen, for views that fell behind
	for v := range s.views {
		if v.isLagging() {
			if final == nil {
				snapshot, err := s.vt.Snapshot()
				if err != nil {
					go v.fail()
					continue
				}
				final = snapshot
			}
			v.resume(s.resyncFrames(final)...)
		}
		v.enqueue(frame{data: msg})
		v.closeAfterFlush()
	}
	s.vt.Close()
	s.vt = nil
	s.mu.Unlock()
	close(s.done)
}

// Attach registers a view. The view first receives an attached message and a
// snapshot of the current state, then live output.
func (s *Session) Attach(conn Conn) (*View, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.exited {
		return nil, ErrExited
	}
	snapshot, err := s.vt.Snapshot()
	if err != nil {
		return nil, fmt.Errorf("snapshot: %w", err)
	}
	v := newView(s, conn)
	v.enqueue(frame{data: protocol.EncodeHost(protocol.Attached{
		Session: protocol.SessionInfo{ID: s.id, Kind: s.kind},
		Size:    s.size,
		Title:   s.title,
		View:    s.viewCfg,
	})})
	v.enqueue(frame{binary: true, data: snapshot})
	s.views[v] = struct{}{}
	s.attached = true
	s.writers.Go(v.run)
	return v, nil
}

// WasAttached reports whether any view has attached so far.
func (s *Session) WasAttached() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.attached
}

// WaitViews waits until every view's writer has finished, e.g. after the
// session exited and the exit message was flushed, or until ctx is done.
func (s *Session) WaitViews(ctx context.Context) {
	done := make(chan struct{})
	go func() {
		s.writers.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-ctx.Done():
	}
}

// Detach removes a view, e.g. when its connection closed.
func (s *Session) Detach(v *View) {
	s.mu.Lock()
	_, attached := s.views[v]
	delete(s.views, v)
	if s.driver == v {
		s.driver = nil
		if next := s.latestView(); next != nil && !s.exited {
			s.driver = next
			s.applySize(*next.lastSize)
		}
	}
	idle := attached && len(s.views) == 0 && !s.exited
	s.mu.Unlock()
	v.stop()
	if idle && s.onIdle != nil {
		s.onIdle()
	}
}

// Input writes input from a view to the PTY. The view becomes the driver, so
// the terminal takes its size.
func (s *Session) Input(v *View, p []byte) {
	s.mu.Lock()
	if s.exited {
		s.mu.Unlock()
		return
	}
	s.activity++
	v.active = s.activity
	if s.driver != v {
		s.driver = v
		if v.lastSize != nil {
			s.applySize(*v.lastSize)
		}
	}
	s.mu.Unlock()
	// Wait for the write, so a view sending faster than the command reads is
	// held back by its own connection rather than by memory.
	w := ptyWrite{data: p, done: make(chan struct{})}
	select {
	case s.input <- w:
	case <-s.done:
		return
	case <-v.ctx.Done(): // the view is gone
		return
	}
	select {
	case <-w.done:
	case <-s.done:
	case <-v.ctx.Done():
	}
}

// Resize records the size a view can display. It applies only if the view is
// the driver, or becomes the driver because there is none.
func (s *Session) Resize(v *View, size protocol.Size) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.exited {
		return
	}
	v.lastSize = &size
	s.activity++
	v.active = s.activity
	if s.driver == nil {
		s.driver = v
	}
	if s.driver == v {
		s.applySize(size)
	}
}

// latestView returns the view that most recently typed or reported a size,
// which takes over when the driver leaves (tmux's window-size latest).
// Callers hold s.mu.
func (s *Session) latestView() *View {
	var latest *View
	for v := range s.views {
		if v.lastSize != nil && (latest == nil || v.active > latest.active) {
			latest = v
		}
	}
	return latest
}

// Send queues a control message for one view (editor ids, errors).
func (s *Session) Send(v *View, m protocol.HostMessage) {
	v.enqueue(frame{data: protocol.EncodeHost(m)})
}

// applySize resizes the VT and the PTY together. Callers hold s.mu.
func (s *Session) applySize(size protocol.Size) {
	if size == s.size {
		return
	}
	s.size = size
	replies, _ := s.vt.Resize(size.Cols, size.Rows)
	_ = s.pty.Resize(size.Cols, size.Rows)
	s.reply(replies)
	msg := protocol.EncodeHost(protocol.Resized{Size: size})
	for v := range s.views {
		v.enqueue(frame{data: msg, droppable: true})
	}
}

// resync brings a lagging view back with the current state. Taking the
// snapshot under s.mu orders it before any output that follows.
func (s *Session) resync(v *View) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.exited {
		return false
	}
	if _, attached := s.views[v]; !attached {
		return false
	}
	snapshot, err := s.vt.Snapshot()
	if err != nil {
		go v.fail()
		return false
	}
	v.resume(s.resyncFrames(snapshot)...)
	return true
}

// resyncFrames replace everything a lagging view missed. Callers hold s.mu.
func (s *Session) resyncFrames(snapshot []byte) []frame {
	return []frame{
		{data: protocol.EncodeHost(protocol.Resized{Size: s.size})},
		{data: protocol.EncodeHost(protocol.Title{Title: s.title})},
		{data: protocol.EncodeHost(protocol.Snapshot{})},
		{binary: true, data: snapshot},
	}
}

// ptyWrite is input or a query reply on its way to the PTY.
type ptyWrite struct {
	data []byte
	done chan struct{} // closed once written; nil for replies
}

func (s *Session) writeLoop() {
	for {
		select {
		case w := <-s.input:
			_, _ = s.pty.Write(w.data)
			if w.done != nil {
				close(w.done)
			}
		case <-s.done:
			return
		}
	}
}
