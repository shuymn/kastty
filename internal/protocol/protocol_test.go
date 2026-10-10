package protocol

import (
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"testing"
)

type fixtureSet struct {
	Valid []struct {
		Raw     string          `json:"raw"`
		Message json.RawMessage `json:"message"`
	} `json:"valid"`
	Invalid []string `json:"invalid"`
}

type fixtures struct {
	HostToView fixtureSet `json:"hostToView"`
	ViewToHost fixtureSet `json:"viewToHost"`
}

func loadFixtures(t *testing.T) fixtures {
	t.Helper()
	b, err := os.ReadFile("testdata/messages.json")
	if err != nil {
		t.Fatal(err)
	}
	var f fixtures
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

func jsonEqual(t *testing.T, got []byte, want json.RawMessage) {
	t.Helper()
	var g, w any
	if err := json.Unmarshal(got, &g); err != nil {
		t.Fatalf("encoded output is not JSON: %v", err)
	}
	if err := json.Unmarshal(want, &w); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(g, w) {
		t.Fatalf("got %s, want %s", got, want)
	}
}

func TestHostMessagesRoundTripThroughFixtures(t *testing.T) {
	f := loadFixtures(t)
	for _, c := range f.HostToView.Valid {
		m, err := DecodeHost([]byte(c.Raw))
		if err != nil {
			t.Fatalf("DecodeHost(%s): %v", c.Raw, err)
		}
		jsonEqual(t, EncodeHost(m), c.Message)
	}
}

func TestViewMessagesRoundTripThroughFixtures(t *testing.T) {
	f := loadFixtures(t)
	for _, c := range f.ViewToHost.Valid {
		m, err := DecodeView([]byte(c.Raw))
		if err != nil {
			t.Fatalf("DecodeView(%s): %v", c.Raw, err)
		}
		jsonEqual(t, EncodeView(m), c.Message)
	}
}

func TestRejectsInvalidHostMessages(t *testing.T) {
	for _, raw := range loadFixtures(t).HostToView.Invalid {
		if m, err := DecodeHost([]byte(raw)); !errors.Is(err, ErrInvalid) {
			t.Errorf("DecodeHost(%q) = %#v, %v; want ErrInvalid", raw, m, err)
		}
	}
}

func TestRejectsInvalidViewMessages(t *testing.T) {
	for _, raw := range loadFixtures(t).ViewToHost.Invalid {
		if m, err := DecodeView([]byte(raw)); !errors.Is(err, ErrInvalid) {
			t.Errorf("DecodeView(%q) = %#v, %v; want ErrInvalid", raw, m, err)
		}
	}
}
