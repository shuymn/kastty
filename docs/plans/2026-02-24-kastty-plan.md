# kastty - Implementation Plan

**Design Doc**: docs/plans/2026-02-24-kastty-design.md
**Trace Pack**: docs/plans/2026-02-24-kastty-plan.trace.md
**Compose Pack**: docs/plans/2026-02-24-kastty-plan.compose.md
**Test Runner**: `bun test`

---

## Task Dependency Graph

```
T01 (protocol) ─────┬──→ T06 (server) ──→ T09 (CLI)
                     │
T02 (pty) ──┐        │
            ├→ T04 (session) ──┘
T03 (buf) ──┘

T05 (security) ─────┘

T01 (protocol) ──→ T07 (frontend) ──→ T08 (UI)
```

**Foundation layer** (parallel): T01, T02, T03, T05
**Integration layer**: T04 (← T02, T03)
**Server layer**: T06 (← T01, T04, T05)
**Frontend layer**: T07 (← T01), T08 (← T07)
**Entry layer**: T09 (← T06)

---

## Tasks

### T01: WS protocol type definitions and validation

**Goal**: Define all WebSocket control message schemas in `protocol/` with runtime validation, keeping the protocol runtime-independent.

**Design Anchors**: REQ05, REQ22, DEC04
**Satisfied Requirements**: REQ05, REQ22
**Deps**: none

**RED**:
- Test that each control message type (`resize`, `readonly`, `ping`, `hello`, `exit`, `error`, `pong`) can be parsed and validated from raw JSON
- Test that invalid payloads are rejected with appropriate errors
- Test that message type discriminator (`t` field) routes to correct schema

**GREEN**:
- Implement TypeScript types and runtime validation for all client→server messages (`resize`, `readonly`, `ping`) and server→client messages (`hello`, `exit`, `error`, `pong`)
- Select and integrate a validation library (Zod, TypeBox, etc.)

**REFACTOR**:
- Extract shared patterns (e.g., base message shape) if duplication emerges

**DoD**:
- All control message types have corresponding TS types and runtime validators
- Invalid payloads produce typed errors
- No Bun/Hono-specific imports in `protocol/`
- `bun test` passes

---

### T02: PTY adapter layer (Bun.Terminal wrapper)

**Goal**: Implement `BunTerminalAdapter` in `pty/` that wraps `Bun.Terminal`, isolating all Bun-specific PTY API behind an adapter interface.

**Design Anchors**: REQ04, REQ21, REQ23, REQ24, DEC01
**Satisfied Requirements**: REQ04, REQ21, REQ23, REQ24
**Deps**: none

**RED**:
- Test that PTY starts with `TERM=xterm-256color` and initial size 80×24
- Test that PTY can be resized to arbitrary cols/rows
- Test that data written to PTY is received by the spawned process
- Test that PTY output is emitted via callback
- Test that process exit triggers an exit callback with exit code

**GREEN**:
- Implement adapter wrapping `Bun.Terminal` with: `start(command, args, env)`, `resize(cols, rows)`, `write(data)`, `onData(callback)`, `onExit(callback)`, `destroy()`
- Set `TERM=xterm-256color` in environment
- Default initial size to 80×24

**REFACTOR**:
- Ensure adapter interface is clean enough that a non-Bun implementation could be swapped in

**DoD**:
- PTY spawns with correct TERM and initial size
- Resize, write, data output, exit detection all work
- All Bun-specific API calls are confined to `pty/`
- `bun test` passes

---

### T03: Output replay buffer (ring buffer)

**Goal**: Implement a fixed-size ring buffer (default 1 MB) that accumulates PTY output for replay on client (re)connection.

**Design Anchors**: REQ14
**Satisfied Requirements**: REQ14
**Deps**: none

**RED**:
- Test that buffer stores data up to capacity
- Test that buffer overwrites oldest data when full (ring behavior)
- Test that `getContents()` returns all buffered data in correct order
- Test that buffer handles zero-length and exactly-at-capacity writes

**GREEN**:
- Implement ring buffer with configurable capacity (default 1 MB)
- `append(data: Uint8Array)` to write PTY output
- `getContents(): Uint8Array` to retrieve current buffer for replay
- `clear()` to reset

**REFACTOR**:
- Optimize memory allocation if profiling shows issues

**DoD**:
- Ring buffer correctly stores and retrieves data with FIFO eviction
- Default capacity is 1 MB
- `bun test` passes

---

### T04: Session manager with single-client policy

**Goal**: Coordinate PTY adapter, replay buffer, single-client connection policy, server-side readonly state, and PTY lifecycle management.

**Design Anchors**: REQ09, REQ10, REQ15, REQ16, REQ17, DEC03, DEC05, DEC06
**Satisfied Requirements**: REQ09, REQ10, REQ15, REQ16, REQ17
**Deps**: T02, T03

**RED**:
- Test that only one client can be connected at a time; second connection is rejected
- Test that after client disconnect, a new client can connect
- Test that PTY output is forwarded to connected client AND appended to replay buffer
- Test that replay buffer contents are provided on new connection
- Test that server-side readonly flag prevents PTY write
- Test that PTY exit event is propagated to session consumers
- Test that PTY remains alive when client disconnects

**GREEN**:
- Implement session manager that owns PTY adapter and replay buffer instances
- Track connected client (0 or 1); reject additional connections
- On client connect: provide replay buffer contents, then stream PTY output
- On client disconnect: keep PTY alive, accept next connection
- Readonly state: when enabled, discard incoming input data before PTY write
- Propagate PTY exit event to session consumers

**REFACTOR**:
- Clarify ownership boundaries between session manager and its dependencies

**DoD**:
- Single-client policy enforced (AC connection test)
- Readonly server-side guard works (AC06 partial)
- PTY survives client disconnect (AC10 partial)
- PTY exit notifies consumers (AC09)
- `bun test` passes

---

### T05: Security layer (token + Host/Origin validation)

**Goal**: Implement security middleware: random token generation, Host header validation, Origin header validation, and token masking in logs.

**Design Anchors**: REQ03, REQ19, REQ20, REQ25, DEC02, DEC07
**Satisfied Requirements**: REQ03, REQ19, REQ20, REQ25
**Deps**: none

**RED**:
- Test that generated token has sufficient entropy (e.g., ≥32 hex chars)
- Test that requests with valid `Host` header (`127.0.0.1:<port>`, `localhost:<port>`) pass
- Test that requests with invalid `Host` header are rejected
- Test that requests with valid local `Origin` pass; others are rejected
- Test that requests with valid `?t=<token>` pass; missing/wrong token is rejected
- Test that token is masked in log output

**GREEN**:
- Token generation using cryptographically secure random bytes
- Hono middleware for Host header validation (allowlist: `127.0.0.1:<port>`, `localhost:<port>`)
- Hono middleware for Origin header validation (local origins only)
- Token validation for both HTTP and WS upgrade requests via `?t=` query parameter
- Token masking utility for log output

**REFACTOR**:
- Consolidate middleware chain ordering for clarity

**DoD**:
- All three validations (Host, Origin, Token) reject invalid requests (AC05)
- Token has high entropy
- Log output masks token values
- `bun test` passes

---

### T06: HTTP/WS server (Hono integration)

**Goal**: Build Hono application with static file serving, WebSocket endpoint integrating protocol dispatch, session manager, and security middleware.

**Design Anchors**: REQ01, REQ02, REQ18, DEC01, DEC04
**Satisfied Requirements**: REQ01, REQ02, REQ18
**Deps**: T01, T04, T05

**RED**:
- Test that `GET /` serves static HTML/JS/WASM files
- Test that `WS /ws` upgrade succeeds with valid token
- Test that WS binary frames from client are forwarded to session (PTY write)
- Test that WS text frames are parsed via protocol types and dispatched (resize → PTY resize, readonly → session, ping → pong)
- Test that PTY output is sent to client as WS binary frames
- Test that `hello` message is sent on WS connection
- Test that `exit` message is sent when PTY exits
- Test that replay buffer is sent before live stream on connection

**GREEN**:
- Create Hono app with security middleware chain
- Static file serving route (`GET /`, `GET /assets/*`)
- WS upgrade route (`GET /ws`) with Hono's WebSocket helper
- WS handler: binary frames → session.write, text frames → protocol parse → dispatch
- On connect: send `hello`, send replay buffer, start streaming
- On PTY exit: send `exit` message, close WS
- On resize message: call session.resize

**REFACTOR**:
- Extract WS message dispatch into a dedicated handler if complexity grows

**DoD**:
- Static files served correctly
- WS connection established with protocol handshake
- Input/output flows through WS ↔ PTY (AC02, AC03 partial)
- Resize messages update PTY dimensions
- `bun test` passes

---

### T07: Frontend terminal core (ghostty-web + WS client)

**Goal**: Initialize ghostty-web terminal, establish WS connection, handle binary/text frames, and process replay buffer on (re)connection.

**Design Anchors**: REQ08, REQ18, DEC01, DEC04
**Satisfied Requirements**: REQ08, REQ18
**Deps**: T01

**RED**:
- Test that ghostty-web terminal initializes and attaches to DOM
- Test that WS connection is established with token from URL query
- Test that incoming binary frames are written to terminal
- Test that terminal input is sent as WS binary frames
- Test that resize events from terminal trigger WS resize message
- Test that replay data on connection is processed by terminal
- Test that connection state transitions (connecting → connected → disconnected) are tracked

**GREEN**:
- Initialize ghostty-web with container element
- Establish WS connection to `ws://127.0.0.1:<port>/ws?t=<token>`
- Binary frame handler: write received data to ghostty-web
- Terminal input handler: send keystrokes as WS binary frames
- Resize observer: detect terminal size changes, send resize control message
- On WS open + hello: process replay buffer, then enter live I/O mode
- Track and expose connection state

**REFACTOR**:
- Separate WS communication logic from terminal rendering concerns

**DoD**:
- ghostty-web renders terminal output correctly (AC04)
- Keyboard input reaches server (AC02)
- Resize propagates to server (AC03)
- Replay data restores screen on reconnection (AC10 client side)
- `bun test` passes (unit tests for non-WASM logic; WASM integration verified manually)

---

### T08: Frontend UI controls

**Goal**: Implement UI components for connection status display, font size adjustment, readonly toggle (client-side), and auto-scroll toggle.

**Design Anchors**: REQ10, REQ11, REQ12, REQ13, DEC06
**Satisfied Requirements**: REQ10, REQ11, REQ12, REQ13
**Deps**: T07

**RED**:
- Test that connection status displays current state (connecting / connected / disconnected)
- Test that font size increase/decrease updates terminal font size
- Test that readonly toggle sends WS control message and blocks keydown events
- Test that auto-scroll toggle enables/disables output following

**GREEN**:
- Connection status indicator reflecting WS state
- Font size controls (+/−) that update ghostty-web font size
- Readonly toggle: block keydown events in UI, send `readonly` control message to server
- Auto-scroll toggle: control terminal scroll-to-bottom behavior on new output

**REFACTOR**:
- Unify UI state management if component count grows

**DoD**:
- Connection status reflects actual WS state (AC13 via REQ13)
- Font size changes are immediate (AC07)
- Readonly blocks input at UI and server (AC06)
- Auto-scroll toggles correctly (AC08)
- `bun test` passes

---

### T09: CLI and process lifecycle

**Goal**: Implement CLI argument parsing, server startup on `127.0.0.1`, token URL display, browser auto-open, and process lifecycle (foreground blocking, signal handling, PTY exit → process exit).

**Design Anchors**: REQ06, REQ07, REQ15, REQ20, DEC05
**Satisfied Requirements**: REQ06, REQ07
**Deps**: T06

**RED**:
- Test that default invocation starts the default shell
- Test that `-- cmd args...` starts the specified command
- Test that `--readonly` sets initial readonly mode
- Test that `--port 0` enables automatic port assignment
- Test that `--open=false` suppresses browser launch
- Test that the process blocks until PTY exits or SIGINT is received
- Test that PTY exit causes process exit with appropriate code

**GREEN**:
- CLI argument parser (select lightweight library: citty, commander, etc.)
- Parse: `[-- command args...]`, `--readonly`, `--port <n>`, `--open=<bool>`
- Start server on `127.0.0.1:<port>` with generated token
- Print URL (`http://127.0.0.1:<port>/?t=<token>`) to stdout
- Open URL in default browser (unless `--open=false`)
- Block foreground: await PTY exit or SIGINT/SIGTERM
- On PTY exit: shut down server, exit process
- On SIGINT: destroy PTY, shut down server, exit process

**REFACTOR**:
- Ensure clean shutdown ordering (PTY → WS → HTTP → process)

**DoD**:
- `kastty` starts shell in browser with one command (AC01)
- Bind is `127.0.0.1` only (AC05 partial)
- Process blocks and exits correctly (AC11)
- `bun test` passes

---

## Checkpoint Summary

| Check | Result |
|-------|--------|
| Forward fidelity (REQ → Task) | PASS |
| Forward fidelity (AC → DoD) | PASS |
| Forward fidelity (GOAL → Task) | PASS |
| Forward fidelity (DEC → Design Anchors) | PASS |
| Reverse fidelity (Task → Design) | PASS |
| Non-goal guard | PASS |
| Granularity guard | PASS |
| **Alignment verdict** | **PASS** |

Full evidence: see [plan.trace.md](2026-02-24-kastty-plan.trace.md)
Reconstruction & scope diff: see [plan.compose.md](2026-02-24-kastty-plan.compose.md)
