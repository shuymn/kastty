<!-- Do not restructure or delete sections. Update inline when behavior changes. -->

## Runtime and Commands

- The host is Go (`cmd/kastty`, `internal/`); the browser view is TypeScript under `web/`, bundled by Bun into `web/dist` and embedded by `web/embed.go`.
- Build, test, and lint through `make`: its targets build libghostty-vt and export the cgo environment (`PKG_CONFIG=scripts/pkg-config`, `LIBGHOSTTY_VT_PREFIX`) that bare `go build` and `go test` lack.
- libghostty-vt comes from `scripts/libghostty-vt.sh` (the Zig pinned in `mise.toml`, path in `ZIG`); keep its ghostty commit equal to the one go-libghostty pins.
- Use Bun only for web tooling (`bun install`, `bun run build:web`, `bun test web`, biome); keep npm/yarn/pnpm workflows out.
- The Nix package (`flake.nix`, `nix/package.nix`) takes libghostty-vt from the flake's `ghostty` input, pinned to the same commit; after changing `bun.lock`, `go.sum`, or `flake.lock`, run `scripts/update-nix-hashes.sh`.

## APIs

- `docs/adr/0017-host-owned-terminal-state.md` is the host/view protocol contract; change the Go and TypeScript sides together and extend `internal/protocol/testdata/messages.json`, which both test suites read.
- Serve HTTP with `net/http`, WebSockets with `coder/websocket`, and PTYs with `creack/pty` (ADR 0018).

## Frontend and Testing

- Format Go with gofmt and keep `go vet` clean; format and lint TypeScript with biome.
- Write web tests with `bun:test`; run Go tests through `make test` so cgo finds libghostty-vt.
- Reference Bun docs in `node_modules/bun-types/docs/**.mdx` when Bun bundler or test runner behavior is unclear.

<!-- Maintenance: Keep this file under 30 instruction lines and remove inferable or stale directives. -->
