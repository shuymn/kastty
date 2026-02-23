# 0008: Hono を削除し Bun ネイティブ API に統一

## Status

Accepted

Supersedes: [0001](0001-tech-stack-bun-hono-ghostty-web.md) の Web framework 部分

## Context

v1 初期実装では Web フレームワークとして Hono を採用していた（[ADR-0001](0001-tech-stack-bun-hono-ghostty-web.md)）。しかし実装を進める中で以下の課題が明らかになった：

1. **ルーティングが単純すぎる**: 実際のルートは `/`（HTML）、`/ws`（WebSocket）、`/ghostty-vt.wasm`（WASM）の 3 つのみ。Hono のルーティング抽象化に対してアプリケーションの複雑度が低すぎる
2. **Bun HTML imports との非互換**: Bun は `import page from "./index.html"` + `Bun.serve({ routes })` でフロントエンドの自動バンドル・HMR を提供するが、Hono の `app.fetch` をメインハンドラにするとこの機能が使えない
3. **WebSocket の二重ラッピング**: Hono の `upgradeWebSocket()` は Bun ネイティブの `server.upgrade()` をラップしているだけで、追加の価値がない
4. **セキュリティミドルウェアの単純さ**: Host/Origin/Token 検証は合計 20 行程度の純関数で済み、ミドルウェアチェーンの抽象化は不要

## Decision

Hono を削除し、全ての HTTP/WebSocket 処理を `Bun.serve()` のネイティブ API で実装する：

- **フロントエンド配信**: Bun HTML imports（`routes: { "/": homepage }`）による自動バンドル
- **WebSocket**: `Bun.serve({ websocket: { ... } })` + `server.upgrade(req)`
- **セキュリティ検証**: `fetch` ハンドラ内で純関数を直接呼び出し
- **静的アセット**: WASM ファイルは `fetch` ハンドラ内で配信

## Consequences

### Positive

- 依存パッケージが 1 つ減少（`hono` 削除）
- Bun HTML imports により**ビルドステップが不要**になった（`Bun.build()` によるランタイムバンドルや事前ビルドスクリプトが不要）
- 開発時の HMR が自動で有効になる
- フレームワークの抽象化層が消え、コードの見通しが良くなった
- 設計目標「Bun の強みを活かしてシンプルに保つ」により合致する

### Negative

- Bun HTML imports の `routes` は `fetch` より先に評価されるため、`/`（HTML ページ）に対する Token 検証が適用されない。セキュリティ境界は `/ws`（WebSocket）の Token 検証に集約される
- 将来ルートが増えた場合、`fetch` ハンドラ内の条件分岐が肥大化する可能性がある（その時点でフレームワーク再導入を検討）

### Neutral

- セキュリティ関数は Hono ミドルウェア形式から純関数に変わったが、検証ロジック自体は同一
- テストは `Bun.serve()` を直接起動する形に変わり、実際のサーバー挙動に近いテストになった
