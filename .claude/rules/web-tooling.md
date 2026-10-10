---
paths:
  - "web/**"
  - "package.json"
---

# Web view tooling

- Run one-off tools with `bunx <tool>` and one-off TypeScript with `bun <file>`.
- Bundle with Bun's bundler through `bun run build:web`; it is the view's whole build pipeline.
- The view is browser code (`WebSocket`, DOM); serving, PTYs, and terminal state belong to the Go host.
