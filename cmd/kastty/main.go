// Command kastty runs a command in a PTY and shows it in the browser.
package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"github.com/shuymn/kastty/internal/cli"
	"github.com/shuymn/kastty/internal/host"
	"github.com/shuymn/kastty/internal/protocol"
	"github.com/shuymn/kastty/internal/server"
	"github.com/shuymn/kastty/web"
)

// Set with -ldflags "-X main.version=... -X main.commit=...".
var version, commit string

// shutdownGrace bounds how long views get, once the command has ended, to
// receive its last output and the exit message.
const shutdownGrace = 3 * time.Second

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	opts, err := cli.Parse(args, os.Getenv)
	switch {
	case errors.Is(err, cli.ErrHelp):
		fmt.Fprint(stdout, cli.Usage)
		return 0
	case errors.Is(err, cli.ErrVersion):
		fmt.Fprintln(stdout, cli.Version(version, commit))
		return 0
	case err != nil:
		fmt.Fprintf(stderr, "error: %v\n\n%s", err, cli.Usage)
		return 1
	}

	// Listen first and read the port back, so port 0 never races.
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", opts.Port))
	if err != nil {
		fmt.Fprintf(stderr, "error: %v\n", err)
		return 1
	}
	port := ln.Addr().(*net.TCPAddr).Port

	// Catch signals before starting the command so none is lost.
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	defer signal.Stop(signals)

	h, err := host.Start(host.Config{
		Argv:       opts.Argv,
		Env:        os.Environ(),
		Scrollback: opts.Scrollback,
		View:       protocol.ViewConfig{FontFamily: opts.FontFamily, Scrollback: opts.Scrollback},
	})
	if err != nil {
		ln.Close()
		fmt.Fprintf(stderr, "error: %v\n", err)
		return 1
	}

	assets, err := fs.Sub(web.Dist, "dist")
	if err != nil {
		panic(err) // the embed path is fixed at build time
	}
	token := newToken()
	srv := &http.Server{
		Handler:           server.New(h, token, port, assets),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() { _ = srv.Serve(ln) }()

	// The token travels in the fragment: never sent to the server or in Referer.
	url := fmt.Sprintf("http://127.0.0.1:%d/#%s", port, token)
	fmt.Fprintln(stdout, url)
	if opts.Open {
		openBrowser(url)
	}

	var code int
	select {
	case <-h.Main().Done():
		code = h.Main().ExitCode()
	case sig := <-signals:
		code = 128 + int(sig.(syscall.Signal))
	}

	// End the sessions before the server so views get the exit message.
	h.Shutdown(shutdownGrace)
	_ = srv.Close()
	return code
}

func newToken() string {
	var b [16]byte
	rand.Read(b[:]) // never fails since Go 1.24
	return hex.EncodeToString(b[:])
}

func openBrowser(url string) {
	name := "xdg-open"
	if runtime.GOOS == "darwin" {
		name = "open"
	}
	cmd := exec.Command(name, url)
	if err := cmd.Start(); err != nil {
		return
	}
	go func() { _ = cmd.Wait() }()
}
