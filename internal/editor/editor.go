// Package editor prepares the editor overlay: which editor to run, how to run
// it safely, and the temporary file it opens (ADR 0016, ADR 0017).
package editor

import (
	"fmt"
	"os"
	"strings"
)

// Resolve returns the editor command from $VISUAL, then $EDITOR. The value may
// carry arguments (e.g. "nvim -R"). ok is false when neither is set.
func Resolve(getenv func(string) string) (command string, ok bool) {
	for _, name := range []string{"VISUAL", "EDITOR"} {
		if v := strings.TrimSpace(getenv(name)); v != "" {
			return v, true
		}
	}
	return "", false
}

// Argv runs the editor command through /bin/sh so its own arguments and quoting
// work, while the file path is passed as a positional parameter and can never
// be re-parsed (the way git runs $GIT_EDITOR).
func Argv(command, path string) []string {
	return []string{"/bin/sh", "-c", command + ` "$@"`, "kastty-editor", path}
}

// WriteTemp writes content to a new file only the owner can read. The file is
// created exclusively, so an existing path is never reused.
func WriteTemp(dir, content string) (string, error) {
	f, err := os.CreateTemp(dir, "kastty-editor-*.txt")
	if err != nil {
		return "", fmt.Errorf("create editor file: %w", err)
	}
	_, err = f.WriteString(content)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(f.Name())
		return "", fmt.Errorf("write editor file: %w", err)
	}
	return f.Name(), nil
}
