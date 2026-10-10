package cli

import (
	"errors"
	"reflect"
	"strings"
	"testing"
)

func env(shell string) func(string) string {
	return func(k string) string {
		if k == "SHELL" {
			return shell
		}
		return ""
	}
}

func TestParse(t *testing.T) {
	cases := []struct {
		args []string
		want Options
	}{
		{nil, Options{Scrollback: 50000, Open: true, Argv: []string{"/bin/zsh"}}},
		{[]string{"--port", "8080", "--font-family", "Fira Code", "--scrollback", "200", "--no-open"},
			Options{Port: 8080, FontFamily: "Fira Code", Scrollback: 200, Argv: []string{"/bin/zsh"}}},
		{[]string{"--no-open", "--open"}, Options{Scrollback: 50000, Open: true, Argv: []string{"/bin/zsh"}}},
		{[]string{"htop", "-d", "10"}, Options{Scrollback: 50000, Open: true, Argv: []string{"htop", "-d", "10"}}},
		{[]string{"--", "htop", "-d", "10"}, Options{Scrollback: 50000, Open: true, Argv: []string{"htop", "-d", "10"}}},
		{[]string{"--port=0", "--", "--weird-command"}, Options{Scrollback: 50000, Open: true, Argv: []string{"--weird-command"}}},
	}
	for _, c := range cases {
		got, err := Parse(c.args, env("/bin/zsh"))
		if err != nil {
			t.Errorf("Parse(%q): %v", c.args, err)
			continue
		}
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("Parse(%q) = %+v, want %+v", c.args, got, c.want)
		}
	}
}

func TestParseDefaultsToBinShWithoutShell(t *testing.T) {
	got, err := Parse(nil, env(""))
	if err != nil || !reflect.DeepEqual(got.Argv, []string{"/bin/sh"}) {
		t.Fatalf("Parse(nil) = %+v, %v", got, err)
	}
}

func TestParseRejectsBadUsageBeforeStartingAnything(t *testing.T) {
	cases := map[string]string{
		"--replay-buffer-bytes 1": "unknown option '--replay-buffer-bytes'",
		"--bogus":                 "unknown option '--bogus'",
		"--port 70000":            "invalid --port",
		"--port abc":              "invalid --port",
		"--scrollback 0":          "invalid --scrollback",
		"--scrollback -5":         "invalid --scrollback",
		"--scrollback 2147483648": "invalid --scrollback",
	}
	for args, want := range cases {
		_, err := Parse(strings.Fields(args), env("/bin/zsh"))
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("Parse(%q) error = %v, want %q", args, err, want)
		}
	}
}

func TestParseHelpAndVersion(t *testing.T) {
	for _, args := range [][]string{{"-h"}, {"--help"}} {
		if _, err := Parse(args, env("")); !errors.Is(err, ErrHelp) {
			t.Errorf("Parse(%q) = %v, want ErrHelp", args, err)
		}
	}
	if _, err := Parse([]string{"--version"}, env("")); !errors.Is(err, ErrVersion) {
		t.Errorf("--version = %v, want ErrVersion", err)
	}
}

func TestVersion(t *testing.T) {
	cases := []struct{ version, commit, want string }{
		{"", "", "dev+HEAD"},
		{"v0.3.0", "", "v0.3.0"},
		{"v0.3.0", "ABCDEF0123456", "v0.3.0+abcdef0"},
		{"v0.3.0+build", "abcdef0", "v0.3.0+build.abcdef0"},
		{"", "abcdef0", "dev+abcdef0"},
		{"v1", "not-a-sha", "v1"},
	}
	for _, c := range cases {
		if got := Version(c.version, c.commit); got != c.want {
			t.Errorf("Version(%q, %q) = %q, want %q", c.version, c.commit, got, c.want)
		}
	}
}
