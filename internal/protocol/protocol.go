// Package protocol defines the attach protocol between the host and its views
// (ADR 0017). Binary WebSocket frames carry terminal bytes; text frames carry
// the JSON control messages defined here, discriminated by "t".
package protocol

import (
	"encoding/json"
	"errors"
	"fmt"
)

// Subprotocol is the WebSocket subprotocol the host selects.
const Subprotocol = "kastty.v1"

// AuthSubprotocolPrefix prefixes the token a view offers as a second subprotocol.
const AuthSubprotocolPrefix = "kastty.auth."

// Kind is the kind of a session.
type Kind string

const (
	KindMain   Kind = "main"
	KindEditor Kind = "editor"
)

// SessionInfo identifies a session in an attached message.
type SessionInfo struct {
	ID   string `json:"id"`
	Kind Kind   `json:"kind"`
}

// Size is a terminal size in cells.
type Size struct {
	Cols int `json:"cols"`
	Rows int `json:"rows"`
}

// ViewConfig is display configuration the view applies to its terminal.
type ViewConfig struct {
	FontFamily string `json:"fontFamily"`
	Scrollback int    `json:"scrollback"`
}

// Host-to-view messages. Each marshals with its "t" discriminant.

type Attached struct {
	Session SessionInfo
	Size    Size
	Title   string
	View    ViewConfig
}

type Snapshot struct{}

type Resized struct{ Size Size }

type Title struct{ Title string }

type Editor struct{ ID string }

type Error struct{ Message string }

type Exit struct{ Code int }

// HostMessage is any message the host sends.
type HostMessage interface{ hostMessage() }

func (Attached) hostMessage() {}
func (Snapshot) hostMessage() {}
func (Resized) hostMessage()  {}
func (Title) hostMessage()    {}
func (Editor) hostMessage()   {}
func (Error) hostMessage()    {}
func (Exit) hostMessage()     {}

// View-to-host messages.

type Resize struct{ Size Size }

type OpenEditor struct{}

// ViewMessage is any control message a view sends.
type ViewMessage interface{ viewMessage() }

func (Resize) viewMessage()     {}
func (OpenEditor) viewMessage() {}

// MaxDimension is the largest accepted column or row count.
const MaxDimension = 65535

// MaxScrollback is the largest view.scrollback a view accepts (int32).
const MaxScrollback = 1<<31 - 1

// ErrInvalid wraps every decoding failure.
var ErrInvalid = errors.New("invalid message")

// EncodeHost marshals a host message to its text frame.
func EncodeHost(m HostMessage) []byte {
	var v any
	switch m := m.(type) {
	case Attached:
		v = struct {
			T       string      `json:"t"`
			Session SessionInfo `json:"session"`
			Size    Size        `json:"size"`
			Title   string      `json:"title"`
			View    ViewConfig  `json:"view"`
		}{"attached", m.Session, m.Size, m.Title, m.View}
	case Snapshot:
		v = struct {
			T string `json:"t"`
		}{"snapshot"}
	case Resized:
		v = struct {
			T    string `json:"t"`
			Cols int    `json:"cols"`
			Rows int    `json:"rows"`
		}{"size", m.Size.Cols, m.Size.Rows}
	case Title:
		v = struct {
			T     string `json:"t"`
			Title string `json:"title"`
		}{"title", m.Title}
	case Editor:
		v = struct {
			T  string `json:"t"`
			ID string `json:"id"`
		}{"editor", m.ID}
	case Error:
		v = struct {
			T       string `json:"t"`
			Message string `json:"message"`
		}{"error", m.Message}
	case Exit:
		v = struct {
			T    string `json:"t"`
			Code int    `json:"code"`
		}{"exit", m.Code}
	default:
		panic(fmt.Sprintf("protocol: unknown host message %T", m))
	}
	b, err := json.Marshal(v)
	if err != nil {
		panic(err) // only plain strings and ints are marshalled
	}
	return b
}

// EncodeView marshals a view message to its text frame.
func EncodeView(m ViewMessage) []byte {
	var v any
	switch m := m.(type) {
	case Resize:
		v = struct {
			T    string `json:"t"`
			Cols int    `json:"cols"`
			Rows int    `json:"rows"`
		}{"resize", m.Size.Cols, m.Size.Rows}
	case OpenEditor:
		v = struct {
			T string `json:"t"`
		}{"open-editor"}
	default:
		panic(fmt.Sprintf("protocol: unknown view message %T", m))
	}
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}

// Wire shapes for decoding: pointers mark required fields.

type wireSize struct {
	Cols *json.RawMessage `json:"cols"`
	Rows *json.RawMessage `json:"rows"`
}

type wireMessage struct {
	T       *string `json:"t"`
	Session *struct {
		ID   *string `json:"id"`
		Kind *string `json:"kind"`
	} `json:"session"`
	Size *wireSize `json:"size"`
	View *struct {
		FontFamily *string          `json:"fontFamily"`
		Scrollback *json.RawMessage `json:"scrollback"`
	} `json:"view"`
	wireSize
	Title   *string          `json:"title"`
	ID      *string          `json:"id"`
	Message *string          `json:"message"`
	Code    *json.RawMessage `json:"code"`
}

func invalid(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalid, fmt.Sprintf(format, args...))
}

func decodeWire(raw []byte) (*wireMessage, error) {
	var w wireMessage
	if len(raw) == 0 || raw[0] != '{' {
		return nil, invalid("not a JSON object")
	}
	if err := json.Unmarshal(raw, &w); err != nil {
		return nil, invalid("%v", err)
	}
	if w.T == nil {
		return nil, invalid("missing t")
	}
	return &w, nil
}

func integer(n *json.RawMessage, field string, min, max int64) (int, error) {
	if n == nil {
		return 0, invalid("missing %s", field)
	}
	// RawMessage keeps quoted strings, so "80" is rejected instead of coerced.
	v, err := json.Number(*n).Int64()
	if err != nil || v < min || v > max {
		return 0, invalid("%s must be an integer in [%d, %d]", field, min, max)
	}
	return int(v), nil
}

func str(s *string, field string) (string, error) {
	if s == nil {
		return "", invalid("missing %s", field)
	}
	return *s, nil
}

func size(w *wireSize) (Size, error) {
	if w == nil {
		return Size{}, invalid("missing size")
	}
	cols, err := integer(w.Cols, "cols", 1, MaxDimension)
	if err != nil {
		return Size{}, err
	}
	rows, err := integer(w.Rows, "rows", 1, MaxDimension)
	if err != nil {
		return Size{}, err
	}
	return Size{Cols: cols, Rows: rows}, nil
}

// DecodeHost parses a host-to-view text frame.
func DecodeHost(raw []byte) (HostMessage, error) {
	w, err := decodeWire(raw)
	if err != nil {
		return nil, err
	}
	switch *w.T {
	case "attached":
		if w.Session == nil || w.View == nil {
			return nil, invalid("attached needs session and view")
		}
		id, err := str(w.Session.ID, "session.id")
		if err != nil {
			return nil, err
		}
		kind, err := str(w.Session.Kind, "session.kind")
		if err != nil {
			return nil, err
		}
		if Kind(kind) != KindMain && Kind(kind) != KindEditor {
			return nil, invalid("unknown session kind %q", kind)
		}
		sz, err := size(w.Size)
		if err != nil {
			return nil, err
		}
		title, err := str(w.Title, "title")
		if err != nil {
			return nil, err
		}
		font, err := str(w.View.FontFamily, "view.fontFamily")
		if err != nil {
			return nil, err
		}
		scrollback, err := integer(w.View.Scrollback, "view.scrollback", 0, MaxScrollback)
		if err != nil {
			return nil, err
		}
		return Attached{SessionInfo{id, Kind(kind)}, sz, title, ViewConfig{font, scrollback}}, nil
	case "snapshot":
		return Snapshot{}, nil
	case "size":
		sz, err := size(&w.wireSize)
		if err != nil {
			return nil, err
		}
		return Resized{sz}, nil
	case "title":
		title, err := str(w.Title, "title")
		if err != nil {
			return nil, err
		}
		return Title{title}, nil
	case "editor":
		id, err := str(w.ID, "id")
		if err != nil {
			return nil, err
		}
		return Editor{id}, nil
	case "error":
		msg, err := str(w.Message, "message")
		if err != nil {
			return nil, err
		}
		return Error{msg}, nil
	case "exit":
		code, err := integer(w.Code, "code", -1<<31, 1<<31-1)
		if err != nil {
			return nil, err
		}
		return Exit{code}, nil
	}
	return nil, invalid("unknown host message %q", *w.T)
}

// DecodeView parses a view-to-host text frame.
func DecodeView(raw []byte) (ViewMessage, error) {
	w, err := decodeWire(raw)
	if err != nil {
		return nil, err
	}
	switch *w.T {
	case "resize":
		sz, err := size(&w.wireSize)
		if err != nil {
			return nil, err
		}
		return Resize{sz}, nil
	case "open-editor":
		return OpenEditor{}, nil
	}
	return nil, invalid("unknown view message %q", *w.T)
}
