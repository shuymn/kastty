# 0001: v1 技術スタックとして Bun + Hono + ghostty-web を採用

## Status

Accepted (Web framework 部分は [0008](0008-remove-hono-use-bun-native.md)、PTY 部分は [0009](0009-replace-bun-terminal-with-bun-pty.md) により Superseded)

## Context

kastty はローカル専用のターミナル共有ツールであり、以下の要件を持つ：

- PTY をブラウザで表示・操作する
- 起動 1 コマンドで使える手軽さ
- 高品質な端末描画
- 将来の Go / Rust 移植を見据えた責務分離

Runtime、Web フレームワーク、ターミナル描画ライブラリの選定が必要。

## Decision

v1 の技術スタックとして以下を採用する：

- **Runtime**: Bun
- **Web framework**: Hono
- **Terminal rendering**: ghostty-web
- **PTY**: `Bun.Terminal`

## Consequences

### Positive

- `Bun.Terminal` により PTY 操作の実装が最短で済む
- `bun --compile` による単体実行ファイル化で配布が容易
- Hono は Bun との相性が良く、HTTP / WS を薄く整理できる
- ghostty-web は xterm.js 互換 API を持ち、表示品質改善が期待できる

### Negative

- `Bun.Terminal` は POSIX 限定のため Windows 非対応
- Bun / ghostty-web はどちらも比較的新しく、API 変更リスクがある
- ghostty-web で特定 TUI が崩れる可能性がある

### Neutral

- Bun 固有 API を `pty/` アダプタ層に閉じ込めることで、将来の移植性を確保する
- フロント側の Terminal adapter インターフェースは事前に用意しない（YAGNI）。致命的な問題が見つかった時点で xterm.js fallback を検討する
