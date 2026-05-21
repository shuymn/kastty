<!-- Do not restructure or delete sections. Update inline when behavior changes. -->

## Runtime and Commands

- Use Bun for runtime, package management, scripts, builds, and tests; do not introduce npm/yarn/pnpm workflows.
- Run project scripts through `bun run <script>` and one-off TypeScript through `bun <file>`.

## APIs

- Keep HTTP and WebSocket serving on `Bun.serve()` with built-in `WebSocket`; do not add `express` or `ws`.
- Prefer Bun-native file helpers for static assets and generated files unless Node APIs are required for specific options.

## Frontend and Testing

- Serve the frontend via Bun HTML imports from `Bun.serve()`; do not add `vite` or a separate frontend build pipeline.
- Write tests with `bun:test` and run them with `bun test`.
- Reference Bun docs in `node_modules/bun-types/docs/**.mdx` when Bun API behavior is unclear.

<!-- Maintenance: Keep this file under 30 instruction lines and remove inferable or stale directives. -->
