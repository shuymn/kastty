package server

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/coder/websocket"

	"github.com/shuymn/kastty/internal/host"
	"github.com/shuymn/kastty/internal/protocol"
)

const token = "0123456789abcdef0123456789abcdef"

var assets = fstest.MapFS{
	"index.html":           {Data: []byte("<!doctype html>view")},
	"assets/main-abc.js":   {Data: []byte("console.log(1)")},
	"fonts/fonts.css":      {Data: []byte("@font-face{}")},
	"fonts/symbols.woff2":  {Data: []byte("wOF2")},
	"secret/not-routed.js": {Data: []byte("x")},
}

type testServer struct {
	base string // http://127.0.0.1:<port>
	host *host.Host
}

func start(t *testing.T, script string, env map[string]string) *testServer {
	t.Helper()
	h, err := host.Start(host.Config{
		Argv:       []string{"/bin/sh", "-c", script},
		Env:        os.Environ(),
		Scrollback: 1000,
		View:       protocol.ViewConfig{Scrollback: 1000},
		TempDir:    t.TempDir(),
		Getenv:     func(k string) string { return env[k] },
		Logger:     log.New(io.Discard, "", 0),
	})
	if err != nil {
		t.Fatal(err)
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	srv := &http.Server{Handler: New(h, token, port, assets)}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() {
		h.Shutdown(5 * time.Second)
		_ = srv.Close()
	})
	return &testServer{base: fmt.Sprintf("http://127.0.0.1:%d", port), host: h}
}

func (s *testServer) get(t *testing.T, path string, header map[string]string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, s.base+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	for k, v := range header {
		if k == "Host" {
			req.Host = v
			continue
		}
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	return res
}

func (s *testServer) dial(t *testing.T, id string, subprotocols ...string) (*websocket.Conn, *http.Response, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	header := http.Header{"Origin": {s.base}}
	return websocket.Dial(ctx, "ws"+strings.TrimPrefix(s.base, "http")+"/attach/"+id, &websocket.DialOptions{
		Subprotocols: subprotocols,
		HTTPHeader:   header,
	})
}

func (s *testServer) attach(t *testing.T, id string) *websocket.Conn {
	t.Helper()
	c, _, err := s.dial(t, id, protocol.Subprotocol, protocol.AuthSubprotocolPrefix+token)
	if err != nil {
		t.Fatal(err)
	}
	c.SetReadLimit(MaxMessageBytes)
	t.Cleanup(func() { c.CloseNow() })
	return c
}

// next reads frames until a control message matching want arrives, returning
// the text of the binary frames seen on the way.
func next[T protocol.HostMessage](t *testing.T, c *websocket.Conn) (T, string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var seen strings.Builder
	for {
		typ, data, err := c.Read(ctx)
		if err != nil {
			var zero T
			t.Fatalf("waiting for %T: %v (seen %q)", zero, err, seen.String())
		}
		if typ == websocket.MessageBinary {
			seen.Write(data)
			continue
		}
		m, err := protocol.DecodeHost(data)
		if err != nil {
			t.Fatal(err)
		}
		if m, ok := m.(T); ok {
			return m, seen.String()
		}
	}
}

func readBinaryUntil(t *testing.T, c *websocket.Conn, want string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var seen strings.Builder
	for !strings.Contains(seen.String(), want) {
		typ, data, err := c.Read(ctx)
		if err != nil {
			t.Fatalf("waiting for %q: %v (seen %q)", want, err, seen.String())
		}
		if typ == websocket.MessageBinary {
			seen.Write(data)
		}
	}
}

func TestRejectsForeignHostAndOrigin(t *testing.T) {
	s := start(t, `sleep 30`, nil)
	port := strings.TrimPrefix(s.base, "http://127.0.0.1:")
	cases := []struct {
		header map[string]string
		want   int
	}{
		{nil, http.StatusOK},
		{map[string]string{"Host": "localhost:" + port}, http.StatusOK},
		{map[string]string{"Host": "attacker.example:" + port}, http.StatusForbidden},
		{map[string]string{"Host": "127.0.0.1:1"}, http.StatusForbidden},
		{map[string]string{"Origin": "http://localhost:" + port}, http.StatusOK},
		{map[string]string{"Origin": "http://attacker.example"}, http.StatusForbidden},
		{map[string]string{"Origin": "null"}, http.StatusForbidden},
	}
	for _, c := range cases {
		if got := s.get(t, "/", c.header).StatusCode; got != c.want {
			t.Errorf("GET / with %v = %d, want %d", c.header, got, c.want)
		}
	}
}

func TestPort80AcceptsHostAndOriginWithoutThePort(t *testing.T) {
	s := New(nil, token, 80, assets)
	cases := []struct {
		host, origin string
		want         int
	}{
		{"127.0.0.1", "", http.StatusOK},
		{"localhost", "http://localhost", http.StatusOK},
		{"127.0.0.1:80", "http://127.0.0.1", http.StatusOK},
		{"attacker.example", "", http.StatusForbidden},
		{"127.0.0.1", "http://attacker.example", http.StatusForbidden},
	}
	for _, c := range cases {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		r.Host = c.host
		if c.origin != "" {
			r.Header.Set("Origin", c.origin)
		}
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		if w.Code != c.want {
			t.Errorf("GET / with Host %q, Origin %q = %d, want %d", c.host, c.origin, w.Code, c.want)
		}
	}
}

func TestServesTheViewAndItsAssets(t *testing.T) {
	s := start(t, `sleep 30`, nil)
	cases := []struct {
		path, contentType, cache string
		status                   int
	}{
		{"/", "text/html; charset=utf-8", "no-cache", http.StatusOK},
		{"/assets/main-abc.js", "text/javascript; charset=utf-8", immutable, http.StatusOK},
		{"/fonts/fonts.css", "text/css; charset=utf-8", immutable, http.StatusOK},
		{"/fonts/symbols.woff2", "font/woff2", immutable, http.StatusOK},
		{"/secret/not-routed.js", "", "", http.StatusNotFound},
		{"/assets/../../etc/passwd", "", "", http.StatusNotFound},
		{"/index.html", "", "", http.StatusNotFound},
	}
	for _, c := range cases {
		res := s.get(t, c.path, nil)
		if res.StatusCode != c.status {
			t.Errorf("GET %s = %d, want %d", c.path, res.StatusCode, c.status)
			continue
		}
		if c.status != http.StatusOK {
			continue
		}
		if got := res.Header.Get("Content-Type"); got != c.contentType {
			t.Errorf("GET %s Content-Type = %q, want %q", c.path, got, c.contentType)
		}
		if got := res.Header.Get("Cache-Control"); got != c.cache {
			t.Errorf("GET %s Cache-Control = %q, want %q", c.path, got, c.cache)
		}
	}
}

func TestAttachRequiresTheTokenSubprotocol(t *testing.T) {
	s := start(t, `sleep 30`, nil)
	cases := map[string][]string{
		"no subprotocols":   nil,
		"no token":          {protocol.Subprotocol},
		"wrong token":       {protocol.Subprotocol, protocol.AuthSubprotocolPrefix + strings.Repeat("0", 32)},
		"token without v1":  {protocol.AuthSubprotocolPrefix + token},
		"token as a prefix": {protocol.Subprotocol, protocol.AuthSubprotocolPrefix + token[:16]},
	}
	for name, sub := range cases {
		_, res, err := s.dial(t, "main", sub...)
		if err == nil || res == nil || res.StatusCode != http.StatusForbidden {
			t.Errorf("%s: err=%v status=%v, want 403", name, err, res)
		}
	}
	_, res, err := s.dial(t, "nope", protocol.Subprotocol, protocol.AuthSubprotocolPrefix+token)
	if err == nil || res == nil || res.StatusCode != http.StatusNotFound {
		t.Errorf("unknown session: err=%v status=%v, want 404", err, res)
	}
}

func TestAttachedViewReceivesStateAndControlsTheTerminal(t *testing.T) {
	s := start(t, `printf 'ready\n'; read _; stty size; sleep 30`, nil)
	time.Sleep(300 * time.Millisecond)
	c := s.attach(t, "main")
	if c.Subprotocol() != protocol.Subprotocol {
		t.Fatalf("subprotocol = %q", c.Subprotocol())
	}
	attached, _ := next[protocol.Attached](t, c)
	if attached.Session != (protocol.SessionInfo{ID: "main", Kind: protocol.KindMain}) {
		t.Fatalf("attached = %+v", attached)
	}
	readBinaryUntil(t, c, "ready") // snapshot

	ctx := context.Background()
	_ = c.Write(ctx, websocket.MessageText, protocol.EncodeView(protocol.Resize{Size: protocol.Size{Cols: 120, Rows: 40}}))
	resized, _ := next[protocol.Resized](t, c)
	if resized.Size != (protocol.Size{Cols: 120, Rows: 40}) {
		t.Fatalf("resized = %+v", resized)
	}
	_ = c.Write(ctx, websocket.MessageBinary, []byte("\n"))
	readBinaryUntil(t, c, "40 120")
}

func TestInvalidControlMessageClosesTheConnection(t *testing.T) {
	s := start(t, `sleep 30`, nil)
	c := s.attach(t, "main")
	next[protocol.Attached](t, c)
	_ = c.Write(context.Background(), websocket.MessageText, []byte(`{"t":"resize","cols":0,"rows":1}`))
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for {
		_, _, err := c.Read(ctx)
		if err == nil {
			continue
		}
		var ce websocket.CloseError
		if !errors.As(err, &ce) || ce.Code != websocket.StatusPolicyViolation {
			t.Fatalf("read error = %v, want policy violation close", err)
		}
		return
	}
}

func TestOpenEditorOverTheWire(t *testing.T) {
	s := start(t, `printf 'main text\n'; sleep 30`, map[string]string{"EDITOR": `cat "$1"; read _ #`})
	time.Sleep(300 * time.Millisecond)
	c := s.attach(t, "main")
	next[protocol.Attached](t, c)

	_ = c.Write(context.Background(), websocket.MessageText, protocol.EncodeView(protocol.OpenEditor{}))
	ed, _ := next[protocol.Editor](t, c)

	ec := s.attach(t, ed.ID)
	attached, _ := next[protocol.Attached](t, ec)
	if attached.Session.Kind != protocol.KindEditor {
		t.Fatalf("editor attached = %+v", attached)
	}
	readBinaryUntil(t, ec, "main text")

	_ = c.Write(context.Background(), websocket.MessageText, protocol.EncodeView(protocol.OpenEditor{}))
	if e, _ := next[protocol.Error](t, c); e.Message != host.ErrEditorOpen.Error() {
		t.Fatalf("second open-editor error = %q", e.Message)
	}

	_ = ec.Write(context.Background(), websocket.MessageBinary, []byte("\n"))
	if exit, _ := next[protocol.Exit](t, ec); exit.Code != 0 {
		t.Fatalf("editor exit = %+v", exit)
	}
}

func TestAttachAfterExitGetsTheExitCode(t *testing.T) {
	s := start(t, `exit 4`, nil)
	select {
	case <-s.host.Main().Done():
	case <-time.After(5 * time.Second):
		t.Fatal("main session did not exit")
	}
	c := s.attach(t, "main")
	if exit, _ := next[protocol.Exit](t, c); exit.Code != 4 {
		t.Fatalf("exit = %+v", exit)
	}
}
