# 0009: Bun.Terminal を bun-pty に置換

## Status

Accepted

Supersedes: [0001](0001-tech-stack-bun-hono-ghostty-web.md) の PTY 部分

## Context

v1 初期実装では PTY 操作に `Bun.Terminal`（Bun ネイティブ API）を採用していた（[ADR-0001](0001-tech-stack-bun-hono-ghostty-web.md)）。しかし、`fzf` 等のインタラクティブプログラムを起動するとターミナルがフリーズする問題が発覚した。

調査の結果、`Bun.Terminal` の内部実装（macOS の kqueue によるイベント監視）にバグがあり、プログラムがターミナルを raw モードに切り替えた際にデータコールバックが発火しなくなることが判明した（[bun#25779](https://github.com/oven-sh/bun/issues/25779)）。

代替として以下を検討した：

1. **node-pty**: Node.js の定番 PTY ライブラリだが、N-API ネイティブモジュールが Bun ランタイムと非互換（`posix_spawnp failed` エラー）
2. **bun-pty**: Bun 向けに設計された PTY ライブラリ。API は node-pty と類似しており、Bun ランタイムで正常に動作する

## Decision

PTY 実装を `Bun.Terminal` から [bun-pty](https://github.com/pektin-dns/bun-pty) に置換する。

- `pty/adapter.ts` の `BunPtyAdapter` クラスが `bun-pty` の `spawn` を使用
- `PtyAdapter` インターフェースは変更なし（アダプタ層の設計が奏功）
- 旧 `BunTerminalAdapter`（`Bun.Terminal` ラッパ）は削除

## Consequences

### Positive

- `fzf`, `vim`, `top` 等のインタラクティブプログラムがフリーズせず動作する
- `PtyAdapter` インターフェースにより、変更は `pty/adapter.ts` に閉じた
- `bun-pty` は node-pty と類似した API を持ち、将来の移行も容易

### Negative

- `bun-pty` はサードパーティ依存であり、Bun ネイティブ API と比べてメンテナンスリスクがある
- `Bun.Terminal` のバグが修正された場合、ネイティブ API への回帰を検討する余地がある

### Neutral

- POSIX 限定（macOS / Linux）の制約は変わらない
- `TERM=xterm-256color` の設定方針も維持
