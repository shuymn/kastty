<!-- Do not restructure or delete sections. Update inline when behavior changes. -->

## Runtime and Commands

- Default to Bun for runtime, package management, scripts, and tests.
- Use `bun <file>` instead of `node <file>` or `ts-node <file>`.
- Use `bun install` instead of `npm|yarn|pnpm install`.
- Use `bun run <script>` instead of `npm|yarn|pnpm run <script>`.
- Use `bun test` instead of `jest` or `vitest`.
- Use `bun build <entry>` instead of `webpack` or `esbuild`.
- Use `bunx <package> <command>` instead of `npx <package> <command>`.
- Do not use `dotenv`; Bun loads `.env` automatically.

## APIs

- Prefer `Bun.serve()` for HTTP routes and WebSocket support; do not add `express`.
- Use built-in `WebSocket`; do not add `ws`.
- Use `bun:sqlite` for SQLite; do not add `better-sqlite3`.
- Use `Bun.redis` for Redis; do not add `ioredis`.
- Use `Bun.sql` for Postgres; do not add `pg` or `postgres.js`.
- Prefer `Bun.file` over `node:fs` read/write helpers where applicable.
- Prefer `Bun.$\`...\`` over `execa` for shell commands.

## Frontend and Testing

- Serve frontend via HTML imports from `Bun.serve()`; do not add `vite`.
- Bun HTML entrypoints may import `.tsx`, `.jsx`, `.js`, and CSS directly.
- Write and run tests with `bun:test` and `bun test`.
- Reference Bun docs in `node_modules/bun-types/docs/**.mdx` when needed.

<!-- Maintenance: Keep this file under 30 instruction lines and remove inferable or stale directives. -->
