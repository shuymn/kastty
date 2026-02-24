# kastty

A browser-based terminal sharing tool. kastty runs a PTY on your machine, streams it to a local web UI powered by [ghostty-web](https://github.com/coder/ghostty-web), and lets you view or interact with the session from your browser. 

The name combines "cast" and "tty", with a nod to 「彁（ka）」— a ghost kanji that echoes the ghostty-web lineage.

## Features

- **Browser-based terminal** -- renders a full terminal in the browser using ghostty-web
- **Localhost-only** -- binds to `127.0.0.1` with token-based authentication
- **Readonly mode** -- share your terminal without allowing input
- **Replay buffer** -- new connections receive recent terminal history
- **Bundled fonts** -- ships with [M PLUS 1 Code](https://fonts.google.com/specimen/M+PLUS+1+Code) and [Nerd Fonts Symbols](https://www.nerdfonts.com/) for consistent CJK and icon rendering across environments
- **Font customization** -- adjustable font size and family
- **Tab title sync** -- browser tab title follows terminal OSC title updates, with state emoji
- **Single dependency runtime** -- runs entirely on [Bun](https://bun.sh)

## Requirements

- [Bun](https://bun.sh) v1.3.9+

## Install

```bash
bun install
```

## Build

Build a single executable:

```bash
bun run build
```

This produces a `kastty` binary in the project root.

## Usage

```bash
kastty [options] [command [args...]]
```

When no command is specified, kastty launches your default shell (`$SHELL`).

### Options

| Option | Default | Description |
|---|---|---|
| `--port <n>` | `0` (auto) | Port to listen on |
| `--readonly` | `false` | Start in readonly mode |
| `--font-family <name>` | - | Terminal font family |
| `--open` / `--open=false` | `true` | Auto-open browser |

### Examples

```bash
# Start an interactive shell session
kastty

# Share a readonly session on port 8080
kastty --readonly --port 8080

# Run a specific command with a custom font
kastty --font-family "Fira Code" htop

# Start without opening the browser
kastty --open=false
```

## Development

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
