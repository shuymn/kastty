package editor

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolvePrefersVisualThenEditor(t *testing.T) {
	env := func(vars map[string]string) func(string) string {
		return func(k string) string { return vars[k] }
	}
	cases := []struct {
		vars map[string]string
		want string
		ok   bool
	}{
		{map[string]string{"VISUAL": "nvim -R", "EDITOR": "vi"}, "nvim -R", true},
		{map[string]string{"VISUAL": "  ", "EDITOR": " vi "}, "vi", true},
		{map[string]string{}, "", false},
	}
	for _, c := range cases {
		got, ok := Resolve(env(c.vars))
		if got != c.want || ok != c.ok {
			t.Errorf("Resolve(%v) = %q, %v; want %q, %v", c.vars, got, ok, c.want, c.ok)
		}
	}
}

func TestArgvKeepsEditorArgumentsAndNeverReparsesThePath(t *testing.T) {
	dir := t.TempDir()
	out := filepath.Join(dir, "args")
	// A hostile file name must reach the editor as one literal argument.
	path := filepath.Join(dir, `x"; touch pwned; ".txt`)
	argv := Argv(`printf '%s\n' --flag >`+out, path)
	cmd := exec.Command(argv[0], argv[1:]...)
	cmd.Dir = dir // where an injected `touch pwned` would land
	if err := cmd.Run(); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	if want := "--flag\n" + path + "\n"; string(got) != want {
		t.Fatalf("editor argv = %q, want %q", got, want)
	}
	if _, err := os.Stat(filepath.Join(dir, "pwned")); err == nil {
		t.Fatal("file path was executed as shell code")
	}
}

func TestWriteTempIsOwnerOnlyAndExclusive(t *testing.T) {
	dir := t.TempDir()
	path, err := WriteTemp(dir, "buffer\n")
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Fatalf("mode = %o, want 600", perm)
	}
	if got, _ := os.ReadFile(path); string(got) != "buffer\n" {
		t.Fatalf("content = %q", got)
	}
	if !strings.HasPrefix(filepath.Base(path), "kastty-editor-") {
		t.Fatalf("name = %q", path)
	}
	other, err := WriteTemp(dir, "")
	if err != nil || other == path {
		t.Fatalf("second file = %q, %v", other, err)
	}
}
