package pty

import (
	"bytes"
	"os"
	"strings"
	"testing"
	"time"
)

// readAll reads until the PTY is closed and returns everything read.
func readAll(t *testing.T, p *PTY) string {
	t.Helper()
	done := make(chan struct{})
	var out bytes.Buffer
	go func() {
		defer close(done)
		buf := make([]byte, 4096)
		for {
			n, err := p.Read(buf)
			out.Write(buf[:n])
			if err != nil {
				return
			}
		}
	}()
	go p.CloseAfterDrain(done)
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("reading did not finish after the command exited")
	}
	return out.String()
}

func start(t *testing.T, script string, cols, rows int) *PTY {
	t.Helper()
	p, err := Start([]string{"/bin/sh", "-c", script}, os.Environ(), cols, rows)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestRunsCommandAndReportsExitCode(t *testing.T) {
	p := start(t, `printf 'hello %s' "$TERM"; exit 7`, 80, 24)
	if out := readAll(t, p); !strings.Contains(out, "hello xterm-256color") {
		t.Fatalf("output = %q", out)
	}
	if code := p.ExitCode(); code != 7 {
		t.Fatalf("exit code = %d, want 7", code)
	}
}

func TestReportsSignalExitAs128PlusSignal(t *testing.T) {
	p := start(t, `kill -TERM $$`, 80, 24)
	readAll(t, p)
	if code := p.ExitCode(); code != 143 {
		t.Fatalf("exit code = %d, want 143", code)
	}
}

func TestStartsWithRequestedSizeAndResizes(t *testing.T) {
	p := start(t, `stty size; read _; stty size`, 120, 40)
	got := make(chan string, 1)
	go func() { got <- readAll(t, p) }()
	time.Sleep(300 * time.Millisecond)
	if err := p.Resize(100, 30); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Write([]byte("\n")); err != nil {
		t.Fatal(err)
	}
	out := <-got
	if !strings.Contains(out, "40 120") || !strings.Contains(out, "30 100") {
		t.Fatalf("output = %q, want sizes 40x120 then 30x100", out)
	}
}

func TestSessionEndsWhenCommandExitsEvenIfBackgroundJobHoldsTerminal(t *testing.T) {
	// The job ignores the hangup and keeps the terminal open; only Close can end the read.
	p := start(t, `(trap '' HUP; sleep 30) & echo started`, 80, 24)
	if err := p.master.SetReadDeadline(time.Time{}); err != nil {
		t.Fatalf("the master is not pollable, so Close cannot interrupt a pending Read: %v", err)
	}
	if out := readAll(t, p); !strings.Contains(out, "started") {
		t.Fatalf("output = %q", out)
	}
	if code := p.ExitCode(); code != 0 {
		t.Fatalf("exit code = %d, want 0", code)
	}
}

func TestKillHangsUpTheCommand(t *testing.T) {
	p := start(t, `sleep 30`, 80, 24)
	done := make(chan struct{})
	go func() {
		defer close(done)
		p.Kill()
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Kill did not return")
	}
	if code := p.ExitCode(); code != 129 {
		t.Fatalf("exit code = %d, want 129 (SIGHUP)", code)
	}
}
