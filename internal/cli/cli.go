// Package cli parses kastty's command line (ADR 0015, ADR 0017).
package cli

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"

	"github.com/shuymn/kastty/internal/protocol"
)

// DefaultScrollback is the number of history lines kept by default.
const DefaultScrollback = 50000

// Options is a parsed command line.
type Options struct {
	Port       int
	FontFamily string
	Scrollback int
	Open       bool
	Argv       []string // command to run; defaults to $SHELL or /bin/sh
}

// ErrHelp and ErrVersion ask the caller to print Usage or Version and exit 0.
var (
	ErrHelp    = errors.New("help requested")
	ErrVersion = errors.New("version requested")
)

// Usage is the help text.
const Usage = `Usage: kastty [options] [--] [command [args...]]

Browser-based terminal sharing tool

Options:
  --port <n>            Port to listen on (0 for auto) (default: 0)
  --font-family <name>  Terminal font family
  --scrollback <lines>  Lines of history to keep (default: 50000)
  --open                Open the browser (default)
  --no-open             Do not open the browser
  -h, --help            Show this help
  --version             Show the version
`

// Parse parses args (without the program name). Errors other than ErrHelp and
// ErrVersion describe invalid usage.
func Parse(args []string, getenv func(string) string) (Options, error) {
	opts := Options{Scrollback: DefaultScrollback, Open: true}
	fs := flag.NewFlagSet("kastty", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	fs.Usage = func() {}
	var port, scrollback string
	var help, version bool
	fs.StringVar(&port, "port", "0", "")
	fs.StringVar(&opts.FontFamily, "font-family", "", "")
	fs.StringVar(&scrollback, "scrollback", strconv.Itoa(DefaultScrollback), "")
	fs.BoolFunc("open", "", func(v string) error { return setBool(&opts.Open, v, true) })
	fs.BoolFunc("no-open", "", func(v string) error { return setBool(&opts.Open, v, false) })
	fs.BoolVar(&help, "h", false, "")
	fs.BoolVar(&help, "help", false, "")
	fs.BoolVar(&version, "version", false, "")

	if err := fs.Parse(args); err != nil {
		return Options{}, unknownFlag(err)
	}
	if help {
		return Options{}, ErrHelp
	}
	if version {
		return Options{}, ErrVersion
	}
	var err error
	if opts.Port, err = strconv.Atoi(port); err != nil || opts.Port < 0 || opts.Port > 65535 {
		return Options{}, fmt.Errorf("invalid --port %q: must be an integer from 0 to 65535", port)
	}
	if opts.Scrollback, err = strconv.Atoi(scrollback); err != nil || opts.Scrollback <= 0 || opts.Scrollback > protocol.MaxScrollback {
		return Options{}, fmt.Errorf("invalid --scrollback %q: must be an integer from 1 to %d", scrollback, protocol.MaxScrollback)
	}
	opts.Argv = fs.Args()
	if len(opts.Argv) == 0 {
		shell := getenv("SHELL")
		if shell == "" {
			shell = "/bin/sh"
		}
		opts.Argv = []string{shell}
	}
	return opts, nil
}

// setBool lets --open/--no-open take an explicit value while keeping their meaning.
func setBool(dst *bool, v string, meaning bool) error {
	b, err := strconv.ParseBool(v)
	if err != nil {
		return err
	}
	*dst = b == meaning
	return nil
}

var flagName = regexp.MustCompile(`flag provided but not defined: -+(\S+)`)

func unknownFlag(err error) error {
	if m := flagName.FindStringSubmatch(err.Error()); m != nil {
		return fmt.Errorf("unknown option '--%s'", m[1])
	}
	return err
}

// Version formats the build version: "<version>+<short commit>", or
// "dev+HEAD" for an unversioned build.
func Version(version, commit string) string {
	version = strings.TrimSpace(version)
	if version == "" {
		version = "dev"
	}
	short := strings.ToLower(strings.TrimSpace(commit))
	if len(short) >= 7 && isHex(short[:7]) {
		sep := "+"
		if strings.Contains(version, "+") {
			sep = "."
		}
		return version + sep + short[:7]
	}
	if version == "dev" {
		return "dev+HEAD"
	}
	return version
}

func isHex(s string) bool {
	for _, r := range s {
		if !strings.ContainsRune("0123456789abcdef", r) {
			return false
		}
	}
	return true
}
