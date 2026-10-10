# kastty

A browser-based terminal sharing tool. kastty runs a PTY on your machine, streams it to a local web UI powered by [ghostty-web](https://github.com/coder/ghostty-web), and lets you view or interact with the session from your browser. 

The name combines "cast" and "tty", with a nod to 「彁（ka）」— a ghost kanji that echoes the ghostty-web lineage.

## Features

- **Browser-based terminal** -- renders a full terminal in the browser using ghostty-web
- **Localhost-only** -- binds to `127.0.0.1` with token-based authentication
- **Server-side terminal state** -- kastty keeps the screen, scrollback, and terminal modes itself, so a reload, a reconnect, or an extra tab restores the exact screen
- **Multiple tabs** -- open the session in several tabs at once; the terminal size follows the tab you last typed in
- **Editor overlay** -- open the current terminal buffer in your `$EDITOR` inside an in-browser overlay (`Ctrl+Shift+E`)
- **Bundled fonts** -- ships with [M PLUS 1 Code](https://fonts.google.com/specimen/M+PLUS+1+Code) and [Nerd Fonts Symbols](https://www.nerdfonts.com/) for consistent CJK and icon rendering across environments
- **Font customization** -- configurable terminal font family
- **Tab title sync** -- browser tab title follows terminal OSC title updates, with state emoji
- **Single binary** -- one self-contained executable with the web UI embedded

## Install

> [!NOTE]
> kastty supports macOS and Linux only. Windows is not supported.

### Homebrew

```bash
brew install shuymn/tap/kastty
```

## Usage

```bash
kastty [options] [-- command [args...]]
```

When no command is specified, kastty launches your default shell (`$SHELL`, or `/bin/sh` if it is unset).

kastty prints a URL such as `http://127.0.0.1:54321/#<token>` and opens it in your browser. The token sits in the URL fragment, so it stays out of request URLs, server logs, and `Referer` headers; the page presents it only in the WebSocket handshake. The page keeps the token for that tab and removes it from the address bar, so open additional tabs with the printed URL.

### Options

| Option | Default | Description |
|---|---|---|
| `--port <n>` | `0` (auto) | Port to listen on |
| `--font-family <name>` | - | Terminal font family |
| `--scrollback <lines>` | `50000` | Scrollback lines kastty keeps for each terminal |
| `--open` / `--no-open` | `true` | Auto-open browser |
| `-h, --help` | - | Show CLI help |
| `--version` | - | Show the version |

kastty allocates scrollback in pages, so it may keep slightly more lines than `--scrollback` requests. The browser view sizes its own scrollback from the same value.

### Examples

```bash
# Start an interactive shell session
kastty

# Run a specific command with a custom font
kastty --font-family "Fira Code" -- htop

# Pass flags to the target command
kastty -- htop -d 10

# Keep more scrollback history
kastty --scrollback 200000

# Start without opening the browser
kastty --no-open
```

## Editor overlay

Press **`Ctrl+Shift+E`** to open the current terminal buffer in your editor. kastty takes the main screen and scrollback from the terminal state it keeps, writes them to a temporary file, and runs your editor in a dedicated PTY rendered as an overlay above the terminal. The main session keeps running untouched underneath.

- The editor command is taken from **`$VISUAL`**, falling back to **`$EDITOR`**. Arguments are honored, e.g. `EDITOR="nvim -R"`. If neither is set, kastty shows an error and does not open the overlay.
- While the overlay is focused, keystrokes go to the editor, not the main terminal.
- Exiting the editor closes the overlay, removes the temporary file, and returns focus to the main terminal.
- Only one overlay can be open at a time; pressing the shortcut again while it is open shows a notice instead of opening a second one.

```bash
# Use a specific editor for the overlay
EDITOR=nvim kastty
```

> [!NOTE]
> The buffer text is captured as plain text; ANSI colors and styling are not preserved. The shortcut is fixed to `Ctrl+Shift+E` (chosen to avoid clashing with browser copy/paste).

## Contributing

### Requirements

- [Go](https://go.dev) (the version in `go.mod`) -- the host
- [Bun](https://bun.sh) -- builds, lints, and tests the web view
- [Zig](https://ziglang.org) -- builds libghostty-vt

Bun and Zig are pinned in `mise.toml`; with [mise](https://mise.jdx.dev), `mise install` installs both.

kastty is a Go host that runs the PTY and keeps the terminal state with [libghostty-vt](https://github.com/ghostty-org/ghostty), plus a TypeScript web view built with Bun and embedded into the binary. The host/view protocol is specified in [ADR 0017](docs/adr/0017-host-owned-terminal-state.md).

### Setup

```bash
mise install
bun install
```

### Make targets

| Target | Description |
|---|---|
| `make web` | Build the web view into `web/dist` |
| `make libghostty` | Build libghostty-vt for the host platform |
| `make build` | Build `./kastty` (web view and libghostty-vt included) |
| `make test` | Run the Go and web tests |
| `make lint` | Lint the Go and web code |
| `make check` | Run all checks |
| `make release-target GOOS=linux GOARCH=arm64` | Build a release binary for one target (Linux targets cross-compile with `zig cc`; macOS targets need a macOS host) |

### libghostty-vt

The host links libghostty-vt statically through cgo ([go-libghostty](https://pkg.go.dev/go.mitchellh.com/libghostty)). `scripts/libghostty-vt.sh [zig-target]` downloads the Ghostty commit that go-libghostty pins, builds the static library with Zig, caches it under `.cache/`, and prints its install prefix. The first build takes a while; later builds reuse the cache.

The make targets wire this up for you. Set `ZIG` when the `zig` on your `PATH` is not the version in `mise.toml`:

```bash
ZIG=/path/to/zig make build
```

To run `go` commands directly, point cgo at the library through the bundled `pkg-config` stand-in:

```bash
export PKG_CONFIG="$PWD/scripts/pkg-config"
export LIBGHOSTTY_VT_PREFIX="$(scripts/libghostty-vt.sh)"
go test ./...
```

## License

[MIT](LICENSE)
