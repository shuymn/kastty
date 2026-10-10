// Package host owns the sessions of one kastty process: the main session,
// whose lifetime is the process's, and at most one editor session derived
// from it (ADR 0005, ADR 0017).
package host

import (
	"context"
	"errors"
	"fmt"
	"log"
	"maps"
	"os"
	"slices"
	"sync"
	"time"

	"github.com/shuymn/kastty/internal/editor"
	"github.com/shuymn/kastty/internal/protocol"
	"github.com/shuymn/kastty/internal/session"
)

// MainID is the id of the main session (/attach/main).
const MainID = "main"

// Messages shown to the user when the editor cannot be opened.
var (
	ErrEditorOpen     = errors.New("An editor overlay is already open")
	ErrNoEditor       = errors.New("No editor configured: set $VISUAL or $EDITOR")
	ErrNotMainSession = errors.New("The editor can only be opened from the main terminal")
	ErrShuttingDown   = errors.New("kastty is shutting down")
	errEditorFile     = errors.New("Failed to create editor temporary file")
	errEditorLaunch   = errors.New("Failed to launch editor")
)

// editorScrollback is the history kept for the editor's own terminal.
const editorScrollback = 1000

// initialSize is used until the first view reports its size.
var initialSize = protocol.Size{Cols: 80, Rows: 24}

// Config configures a host.
type Config struct {
	Argv       []string // main command
	Env        []string
	Scrollback int // lines kept by the main session
	View       protocol.ViewConfig
	TempDir    string
	Getenv     func(string) string
	// EditorAttachTimeout ends an editor session no view attached to.
	EditorAttachTimeout time.Duration
	Logger              *log.Logger
}

// Host is the set of sessions.
type Host struct {
	cfg     Config
	main    *session.Session
	reapers sync.WaitGroup // until each editor's temp file is removed

	mu        sync.Mutex
	sessions  map[string]*session.Session
	editor    *session.Session
	editorSeq int
	closing   bool // Shutdown started; no new sessions
}

// Start runs the main command.
func Start(cfg Config) (*Host, error) {
	if cfg.Getenv == nil {
		cfg.Getenv = os.Getenv
	}
	if cfg.TempDir == "" {
		cfg.TempDir = os.TempDir()
	}
	if cfg.EditorAttachTimeout == 0 {
		cfg.EditorAttachTimeout = 10 * time.Second
	}
	if cfg.Logger == nil {
		cfg.Logger = log.New(os.Stderr, "kastty: ", 0)
	}
	main, err := session.Start(session.Options{
		ID:         MainID,
		Kind:       protocol.KindMain,
		Argv:       cfg.Argv,
		Env:        cfg.Env,
		Size:       initialSize,
		Scrollback: cfg.Scrollback,
		View:       cfg.View,
	})
	if err != nil {
		return nil, err
	}
	return &Host{cfg: cfg, main: main, sessions: map[string]*session.Session{MainID: main}}, nil
}

// Main returns the main session.
func (h *Host) Main() *session.Session { return h.main }

// Session returns the session with the given id, or nil.
func (h *Host) Session(id string) *session.Session {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.sessions[id]
}

// OpenEditor opens the main session's text in $VISUAL / $EDITOR as a new
// editor session and returns its id. The error text is shown to the user.
func (h *Host) OpenEditor(from *session.Session) (string, error) {
	if from.Kind() != protocol.KindMain {
		return "", ErrNotMainSession
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closing {
		return "", ErrShuttingDown
	}
	if h.editor != nil {
		return "", ErrEditorOpen
	}
	command, ok := editor.Resolve(h.cfg.Getenv)
	if !ok {
		return "", ErrNoEditor
	}
	text, err := h.main.PlainText()
	if err != nil {
		h.cfg.Logger.Printf("editor: read terminal text: %v", err)
		return "", errEditorFile
	}
	path, err := editor.WriteTemp(h.cfg.TempDir, text)
	if err != nil {
		h.cfg.Logger.Printf("editor: %v", err)
		return "", errEditorFile
	}
	h.editorSeq++
	id := fmt.Sprintf("editor-%d", h.editorSeq)
	var ed *session.Session
	ed, err = session.Start(session.Options{
		ID:         id,
		Kind:       protocol.KindEditor,
		Argv:       editor.Argv(command, path),
		Env:        h.cfg.Env,
		Size:       h.main.Size(),
		Scrollback: editorScrollback,
		View:       h.cfg.View,
		// Closing the overlay ends the editor.
		OnIdle: func() { go ed.Kill() },
	})
	if err != nil {
		h.removeTemp(path)
		h.cfg.Logger.Printf("editor: launch: %v", err)
		return "", errEditorLaunch
	}
	h.sessions[id] = ed
	h.editor = ed
	h.reapers.Add(1)
	go h.reapEditor(ed, path)
	time.AfterFunc(h.cfg.EditorAttachTimeout, func() {
		if !ed.WasAttached() {
			ed.Kill()
		}
	})
	return id, nil
}

func (h *Host) reapEditor(ed *session.Session, path string) {
	<-ed.Done()
	h.removeTemp(path)
	h.reapers.Done()
	h.mu.Lock()
	if h.editor == ed {
		h.editor = nil
	}
	h.mu.Unlock()
	forget := func() {
		h.mu.Lock()
		delete(h.sessions, ed.ID())
		h.mu.Unlock()
	}
	if ed.WasAttached() {
		forget()
		return
	}
	// The overlay may still be on its way, e.g. when the editor command failed
	// at once: keep the id so it learns the exit code instead of a 404.
	time.AfterFunc(h.cfg.EditorAttachTimeout, forget)
}

func (h *Host) removeTemp(path string) {
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		h.cfg.Logger.Printf("editor: remove %s: %v", path, err)
	}
}

// Shutdown ends every session, killing commands still running, then gives
// each session's views up to grace to receive the rest of the output and the
// exit message.
func (h *Host) Shutdown(grace time.Duration) {
	h.mu.Lock()
	h.closing = true
	sessions := slices.Collect(maps.Values(h.sessions))
	h.mu.Unlock()

	var wg sync.WaitGroup
	for _, s := range sessions {
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case <-s.Done():
			default:
				s.Kill()
			}
			<-s.Done()
			// The grace starts once the session ended: killing it may take a while.
			ctx, cancel := context.WithTimeout(context.Background(), grace)
			defer cancel()
			s.WaitViews(ctx)
		}()
	}
	wg.Wait()
	// The editor's temp file holds the terminal text: remove it before exiting.
	h.reapers.Wait()
}
