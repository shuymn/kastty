# kastty

A browser-based terminal sharing tool. kastty runs a PTY on your machine, streams it to a local web UI powered by [ghostty-web](https://github.com/coder/ghostty-web), and lets you view or interact with the session from your browser. 

The name combines "cast" and "tty", with a nod to 「彁（ka）」— a ghost kanji that echoes the ghostty-web lineage.

## Features

- **Browser-based terminal** -- renders a full terminal in the browser using ghostty-web
- **Localhost-only** -- binds to `127.0.0.1` with token-based authentication
- **Replay buffer** -- new connections receive recent terminal history
- **Editor overlay** -- open the current terminal buffer in your `$EDITOR` inside an in-browser overlay (`Ctrl+Shift+E`)
- **Bundled fonts** -- ships with [M PLUS 1 Code](https://fonts.google.com/specimen/M+PLUS+1+Code) and [Nerd Fonts Symbols](https://www.nerdfonts.com/) for consistent CJK and icon rendering across environments
- **Font customization** -- configurable terminal font family
- **Tab title sync** -- browser tab title follows terminal OSC title updates, with state emoji
- **Single dependency runtime** -- runs entirely on [Bun](https://bun.sh)

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

When no command is specified, kastty launches your default shell (`$SHELL`).

### Options

| Option | Default | Description |
|---|---|---|
| `--port <n>` | `0` (auto) | Port to listen on |
| `--font-family <name>` | - | Terminal font family |
| `--scrollback <lines>` | `50000` | Requested terminal scrollback lines in browser (approximate) |
| `--replay-buffer-bytes <n>` | auto (from `--scrollback`) | Replay buffer size for reconnect restore |
| `--open` / `--no-open` | `true` | Auto-open browser |
| `-h, --help` | - | Show CLI help |

`--scrollback` is applied as an internal capacity limit in ghostty-web, so the visible line count varies by output width and escape sequences.

### Examples

```bash
# Start an interactive shell session
kastty

# Run a specific command with a custom font
kastty --font-family "Fira Code" -- htop

# Pass flags to the target command
kastty -- htop -d 10

# Increase local scrollback and reconnect replay history
kastty --scrollback 200000 --replay-buffer-bytes 33554432

# Start without opening the browser
kastty --no-open
```

## Editor overlay

Press **`Ctrl+Shift+E`** to open the current terminal buffer in your editor. kastty snapshots the visible buffer and scrollback, writes it to a temporary file, and runs your editor in a dedicated PTY rendered as an overlay above the terminal. The main session keeps running untouched underneath.

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

- [Bun](https://bun.sh)

### Setup

```bash
bun install
```

### Build

Build a single executable:

```bash
bun run build
```

This produces a `kastty` binary in the project root.

### Development

```bash
# Lint
bun run lint

# Format
bun run fmt

# Type check
bun run typecheck

# Run tests
bun test

# All checks
bun run check
```

## License

[MIT](LICENSE)
