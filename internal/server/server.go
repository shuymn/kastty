// Package server serves the view and the attach WebSocket (ADR 0002, ADR 0017).
package server

import (
	"context"
	"crypto/subtle"
	"errors"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"slices"
	"strconv"
	"strings"

	"github.com/coder/websocket"

	"github.com/shuymn/kastty/internal/host"
	"github.com/shuymn/kastty/internal/protocol"
	"github.com/shuymn/kastty/internal/session"
)

// MaxMessageBytes caps one inbound WebSocket message (input such as a paste).
const MaxMessageBytes = 8 << 20

const immutable = "public, max-age=31536000, immutable"

// Server handles every HTTP request for one host.
type Server struct {
	host   *host.Host
	token  []byte
	hosts  []string // accepted Host headers, which are also the origins' hosts
	assets fs.FS
}

// New serves assets (the contents of web/dist) and attaches views to h's
// sessions. port is the port the listener is bound to.
func New(h *host.Host, token string, port int, assets fs.FS) *Server {
	p := strconv.Itoa(port)
	hosts := []string{"127.0.0.1:" + p, "localhost:" + p}
	if port == 80 {
		// Browsers leave the default port out of Host and Origin.
		hosts = append(hosts, "127.0.0.1", "localhost")
	}
	return &Server{host: h, token: []byte(token), hosts: hosts, assets: assets}
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Host and Origin checks stop DNS rebinding and other sites' pages from
	// reaching the server; they apply to every request.
	if !s.validHost(r.Host) || !s.validOrigin(r.Header.Get("Origin")) {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}
	switch p := r.URL.Path; {
	case p == "/":
		s.serveFile(w, r, "index.html", "no-cache")
	case strings.HasPrefix(p, "/assets/"), strings.HasPrefix(p, "/fonts/"):
		s.serveFile(w, r, strings.TrimPrefix(p, "/"), immutable)
	case strings.HasPrefix(p, "/attach/"):
		s.attach(w, r, strings.TrimPrefix(p, "/attach/"))
	default:
		http.NotFound(w, r)
	}
}

func (s *Server) validHost(h string) bool {
	return slices.Contains(s.hosts, h)
}

func (s *Server) validOrigin(origin string) bool {
	// Browsers always send Origin on WebSocket upgrades; other local clients
	// may omit it and still need the token.
	if origin == "" {
		return true
	}
	h, ok := strings.CutPrefix(origin, "http://")
	return ok && s.validHost(h)
}

var contentTypes = map[string]string{
	".html":  "text/html; charset=utf-8",
	".js":    "text/javascript; charset=utf-8",
	".css":   "text/css; charset=utf-8",
	".woff2": "font/woff2",
	".map":   "application/json",
}

func (s *Server) serveFile(w http.ResponseWriter, r *http.Request, name, cacheControl string) {
	name = path.Clean(name)
	if !fs.ValidPath(name) {
		http.NotFound(w, r)
		return
	}
	body, err := fs.ReadFile(s.assets, name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	ext := path.Ext(name)
	contentType, ok := contentTypes[ext]
	if !ok {
		contentType = mime.TypeByExtension(ext)
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	h := w.Header()
	h.Set("Content-Type", contentType)
	h.Set("Cache-Control", cacheControl)
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Length", strconv.Itoa(len(body)))
	if r.Method == http.MethodHead {
		return
	}
	_, _ = w.Write(body)
}

// authorized checks the subprotocols the view offered: it must speak
// kastty.v1 and present the token as kastty.auth.<token>.
func (s *Server) authorized(r *http.Request) bool {
	var speaksV1, tokenOK bool
	for _, header := range r.Header.Values("Sec-WebSocket-Protocol") {
		for _, p := range strings.Split(header, ",") {
			p = strings.TrimSpace(p)
			if p == protocol.Subprotocol {
				speaksV1 = true
			}
			if t, ok := strings.CutPrefix(p, protocol.AuthSubprotocolPrefix); ok &&
				subtle.ConstantTimeCompare([]byte(t), s.token) == 1 {
				tokenOK = true
			}
		}
	}
	return speaksV1 && tokenOK
}

func (s *Server) attach(w http.ResponseWriter, r *http.Request, id string) {
	if !s.authorized(r) {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}
	sess := s.host.Session(id)
	if sess == nil {
		http.NotFound(w, r)
		return
	}
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		Subprotocols: []string{protocol.Subprotocol},
		// Same origins as validOrigin, enforced again by the library.
		OriginPatterns: s.hosts,
	})
	if err != nil {
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(MaxMessageBytes)

	v, err := sess.Attach(wsConn{conn})
	if errors.Is(err, session.ErrExited) {
		_ = conn.Write(r.Context(), websocket.MessageText, protocol.EncodeHost(protocol.Exit{Code: sess.ExitCode()}))
		_ = conn.Close(websocket.StatusNormalClosure, "")
		return
	}
	if err != nil {
		_ = conn.Close(websocket.StatusInternalError, "attach failed")
		return
	}
	defer sess.Detach(v)
	s.readLoop(r.Context(), conn, sess, v)
}

func (s *Server) readLoop(ctx context.Context, conn *websocket.Conn, sess *session.Session, v *session.View) {
	for {
		typ, data, err := conn.Read(ctx)
		if err != nil {
			return
		}
		if typ == websocket.MessageBinary {
			sess.Input(v, data)
			continue
		}
		msg, err := protocol.DecodeView(data)
		if err != nil {
			_ = conn.Close(websocket.StatusPolicyViolation, "invalid message")
			return
		}
		switch msg := msg.(type) {
		case protocol.Resize:
			sess.Resize(v, msg.Size)
		case protocol.OpenEditor:
			if id, err := s.host.OpenEditor(sess); err != nil {
				sess.Send(v, protocol.Error{Message: err.Error()})
			} else {
				sess.Send(v, protocol.Editor{ID: id})
			}
		}
	}
}

// wsConn adapts a WebSocket to session.Conn.
type wsConn struct{ c *websocket.Conn }

func (w wsConn) Write(ctx context.Context, binary bool, data []byte) error {
	typ := websocket.MessageText
	if binary {
		typ = websocket.MessageBinary
	}
	return w.c.Write(ctx, typ, data)
}

func (w wsConn) Close() error { return w.c.Close(websocket.StatusNormalClosure, "") }
