package main

import (
	"bufio"
	"context"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/shuymn/kastty/internal/protocol"
)

// binary builds kastty once for the end-to-end tests below.
var binary = func() func(t *testing.T) string {
	var path string
	return func(t *testing.T) string {
		t.Helper()
		if path != "" {
			return path
		}
		dir, err := os.MkdirTemp("", "kastty-e2e")
		if err != nil {
			t.Fatal(err)
		}
		path = filepath.Join(dir, "kastty")
		out, err := exec.Command("go", "build", "-ldflags", "-X main.version=v9.9.9 -X main.commit=abcdef0123", "-o", path, ".").CombinedOutput()
		if err != nil {
			t.Fatalf("go build: %v\n%s", err, out)
		}
		return path
	}
}()

var urlPattern = regexp.MustCompile(`^http://127\.0\.0\.1:(\d+)/#([0-9a-f]{32})$`)

// launch starts kastty and returns the process and the URL it printed.
func launch(t *testing.T, args ...string) (*exec.Cmd, []string) {
	t.Helper()
	cmd := exec.Command(binary(t), append([]string{"--no-open"}, args...)...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	line := make(chan string, 1)
	go func() {
		s := bufio.NewScanner(stdout)
		if s.Scan() {
			line <- s.Text()
		}
	}()
	select {
	case l := <-line:
		m := urlPattern.FindStringSubmatch(l)
		if m == nil {
			t.Fatalf("printed %q, want the URL with the token in the fragment", l)
		}
		return cmd, m
	case <-time.After(10 * time.Second):
		t.Fatal("kastty printed no URL")
		return nil, nil
	}
}

func exitCode(t *testing.T, cmd *exec.Cmd) int {
	t.Helper()
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		if err == nil {
			return 0
		}
		if ee, ok := err.(*exec.ExitError); ok {
			return ee.ExitCode()
		}
		t.Fatal(err)
	case <-time.After(10 * time.Second):
		t.Fatal("kastty did not exit")
	}
	return -1
}

func TestExitsWithTheCommandsExitCode(t *testing.T) {
	cmd, _ := launch(t, "--", "/bin/sh", "-c", "sleep 0.3; exit 3")
	if code := exitCode(t, cmd); code != 3 {
		t.Fatalf("exit code = %d, want 3", code)
	}
}

func TestSignalsExitWith128PlusSignal(t *testing.T) {
	for sig, want := range map[syscall.Signal]int{syscall.SIGINT: 130, syscall.SIGTERM: 143} {
		cmd, _ := launch(t, "--", "/bin/sh", "-c", "sleep 30")
		_ = cmd.Process.Signal(sig)
		if code := exitCode(t, cmd); code != want {
			t.Errorf("%v: exit code = %d, want %d", sig, code, want)
		}
	}
}

func TestViewSeesOutputAndExit(t *testing.T) {
	cmd, m := launch(t, "--", "/bin/sh", "-c", "printf 'hello e2e\\n'; read _; exit 5")
	base := "127.0.0.1:" + m[1]
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws://"+base+"/attach/main", &websocket.DialOptions{
		Subprotocols: []string{protocol.Subprotocol, protocol.AuthSubprotocolPrefix + m[2]},
		HTTPHeader:   http.Header{"Origin": {"http://" + base}},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	var seen strings.Builder
	sent := false
	for {
		typ, data, err := c.Read(ctx)
		if err != nil {
			t.Fatalf("read: %v (seen %q)", err, seen.String())
		}
		if typ == websocket.MessageBinary {
			seen.Write(data)
			if !sent && strings.Contains(seen.String(), "hello e2e") {
				sent = true
				_ = c.Write(ctx, websocket.MessageBinary, []byte("\n"))
			}
			continue
		}
		if msg, err := protocol.DecodeHost(data); err == nil && msg == (protocol.Exit{Code: 5}) {
			break
		}
	}
	if code := exitCode(t, cmd); code != 5 {
		t.Fatalf("exit code = %d, want 5", code)
	}
}

func TestVersionHelpAndUsageErrors(t *testing.T) {
	out, err := exec.Command(binary(t), "--version").Output()
	if err != nil || strings.TrimSpace(string(out)) != "v9.9.9+abcdef0" {
		t.Fatalf("--version = %q, %v", out, err)
	}
	out, err = exec.Command(binary(t), "--help").Output()
	if err != nil || !strings.Contains(string(out), "Usage: kastty") {
		t.Fatalf("--help = %q, %v", out, err)
	}
	cmd := exec.Command(binary(t), "--replay-buffer-bytes", "1")
	stderr, _ := cmd.CombinedOutput()
	if cmd.ProcessState.ExitCode() != 1 || !strings.Contains(string(stderr), "unknown option '--replay-buffer-bytes'") {
		t.Fatalf("removed option: exit %d, output %q", cmd.ProcessState.ExitCode(), stderr)
	}
}
