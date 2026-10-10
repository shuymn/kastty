package host

import (
	"context"
	"errors"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/shuymn/kastty/internal/protocol"
	"github.com/shuymn/kastty/internal/session"
)

type nopConn struct{}

func (nopConn) Write(context.Context, bool, []byte) error { return nil }
func (nopConn) Close() error                              { return nil }

func startHost(t *testing.T, script string, env map[string]string) (*Host, string) {
	t.Helper()
	tmp := t.TempDir()
	h, err := Start(Config{
		Argv:                []string{"/bin/sh", "-c", script},
		Env:                 os.Environ(),
		Scrollback:          1000,
		View:                protocol.ViewConfig{Scrollback: 1000},
		TempDir:             tmp,
		Getenv:              func(k string) string { return env[k] },
		EditorAttachTimeout: 500 * time.Millisecond,
		Logger:              log.New(io.Discard, "", 0),
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { h.Shutdown(5 * time.Second) })
	return h, tmp
}

func waitDone(t *testing.T, s *session.Session) {
	t.Helper()
	select {
	case <-s.Done():
	case <-time.After(5 * time.Second):
		t.Fatalf("session %s did not end", s.ID())
	}
}

func TestOpenEditorRunsEditorOnMainTextAndCleansUp(t *testing.T) {
	out := filepath.Join(t.TempDir(), "seen")
	h, tmp := startHost(t, `printf 'hello from main\n'; sleep 30`,
		map[string]string{"EDITOR": "cp -- \"$1\" " + out + "; :"})
	time.Sleep(300 * time.Millisecond)

	id, err := h.OpenEditor(h.Main())
	if err != nil {
		t.Fatal(err)
	}
	ed := h.Session(id)
	if ed == nil || ed.Kind() != protocol.KindEditor {
		t.Fatalf("Session(%q) = %v", id, ed)
	}
	if _, err := ed.Attach(nopConn{}); err != nil {
		t.Fatal(err)
	}
	waitDone(t, ed)

	got, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(got), "hello from main") {
		t.Fatalf("editor received %q", got)
	}
	deadline := time.Now().Add(2 * time.Second)
	for {
		entries, _ := os.ReadDir(tmp)
		if len(entries) == 0 && h.Session(id) == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("temp files %v / session still registered after the editor exited", entries)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestOpenEditorRejectsSecondOverlayAndMissingEditor(t *testing.T) {
	h, _ := startHost(t, `sleep 30`, map[string]string{"VISUAL": "sleep 30 #"})
	id, err := h.OpenEditor(h.Main())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.OpenEditor(h.Main()); !errors.Is(err, ErrEditorOpen) {
		t.Fatalf("second OpenEditor: %v", err)
	}
	if _, err := h.OpenEditor(h.Session(id)); !errors.Is(err, ErrNotMainSession) {
		t.Fatalf("OpenEditor from editor session: %v", err)
	}

	h2, _ := startHost(t, `sleep 30`, map[string]string{})
	if _, err := h2.OpenEditor(h2.Main()); !errors.Is(err, ErrNoEditor) {
		t.Fatalf("OpenEditor without editor: %v", err)
	}
}

func TestEditorEndsWhenNoViewAttachesOrTheLastOneLeaves(t *testing.T) {
	h, _ := startHost(t, `sleep 30`, map[string]string{"EDITOR": "sleep 30 #"})

	id, err := h.OpenEditor(h.Main())
	if err != nil {
		t.Fatal(err)
	}
	waitDone(t, h.Session(id)) // nobody attached within the timeout

	deadline := time.Now().Add(2 * time.Second)
	var id2 string
	for {
		if id2, err = h.OpenEditor(h.Main()); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("editor slot not released: %v", err)
		}
		time.Sleep(20 * time.Millisecond)
	}
	ed := h.Session(id2)
	v, err := ed.Attach(nopConn{})
	if err != nil {
		t.Fatal(err)
	}
	ed.Detach(v)
	waitDone(t, ed)
}

func TestShutdownEndsAllSessions(t *testing.T) {
	h, _ := startHost(t, `sleep 30`, map[string]string{"EDITOR": "sleep 30 #"})
	id, err := h.OpenEditor(h.Main())
	if err != nil {
		t.Fatal(err)
	}
	ed := h.Session(id)
	if _, err := ed.Attach(nopConn{}); err != nil {
		t.Fatal(err)
	}
	h.Shutdown(5 * time.Second)
	waitDone(t, h.Main())
	waitDone(t, ed)
}

func TestEditorThatFailsAtOnceStillReportsItsExitCode(t *testing.T) {
	h, _ := startHost(t, `sleep 30`, map[string]string{"EDITOR": "exit 127 #"})
	id, err := h.OpenEditor(h.Main())
	if err != nil {
		t.Fatal(err)
	}
	ed := h.Session(id)
	waitDone(t, ed)

	// The overlay attaches after the editor already failed: it gets the exit code, not a 404.
	if h.Session(id) != ed {
		t.Fatalf("Session(%q) was forgotten before any view attached", id)
	}
	if _, err := ed.Attach(nopConn{}); !errors.Is(err, session.ErrExited) || ed.ExitCode() != 127 {
		t.Fatalf("Attach = %v, ExitCode = %d; want ErrExited and 127", err, ed.ExitCode())
	}
	deadline := time.Now().Add(2 * time.Second)
	for h.Session(id) != nil {
		if time.Now().After(deadline) {
			t.Fatalf("Session(%q) still registered after the attach timeout", id)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestShutdownRemovesEditorFilesAndRefusesNewEditors(t *testing.T) {
	h, tmp := startHost(t, `sleep 30`, map[string]string{"EDITOR": "sleep 30 #"})
	if _, err := h.OpenEditor(h.Main()); err != nil {
		t.Fatal(err)
	}

	h.Shutdown(0)

	// main.go exits right after Shutdown, so nothing may be left behind.
	if entries, _ := os.ReadDir(tmp); len(entries) != 0 {
		t.Fatalf("temp files %v left after Shutdown", entries)
	}
	if _, err := h.OpenEditor(h.Main()); !errors.Is(err, ErrShuttingDown) {
		t.Fatalf("OpenEditor after Shutdown: %v", err)
	}
}
