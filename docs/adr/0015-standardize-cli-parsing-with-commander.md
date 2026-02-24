# 0015: CLI 引数解析を commander に統一し未知オプションを fail-fast にする

## Status

Accepted

## Context

従来の CLI 引数解析は `node:util` ベースの自前実装で、`--help` の標準表示を持たず、オプションエラーの扱いが一貫していなかった。

その結果として、存在しないオプション（例: `--version`）が起動対象コマンドとして解釈され、PTY 起動まで進んでから失敗するケースが発生した。これはエラーメッセージの明瞭性と安全性の両面で不適切である。

また、ブラウザ自動起動の無効化に `--open=false` を許可していたが、`--no-open` と二重表現になっていた。

## Decision

- CLI 引数解析ライブラリを `commander` に統一する
- `-h, --help` を標準サポートし、使用方法を自動表示する
- 未知オプションは CLI 解析段階で即時エラー終了する（fail-fast）
- ブラウザ自動起動の無効化は `--no-open` に統一し、`--open=false` / `--open=true` は非対応とする
- 起動対象コマンドへ `-` 始まりの引数を渡す場合は `--` 区切りを必須とする（例: `kastty -- htop -d 10`）

## Consequences

### Positive

- `--help` を含む CLI UX が標準化され、利用者が自己解決しやすくなる
- 未知オプション時に PTY 起動へ進まず、明確なエラーで終了できる
- オプション表記の揺れ（`--open=false` と `--no-open`）を解消できる

### Negative

- `--open=false` を使っていた既存ユーザーは `--no-open` への移行が必要になる
- コマンド側の `-` 始まり引数では `--` 区切りを意識する必要がある

### Neutral

- CLI の機能範囲（`readonly`, `port`, `font-family`, `scrollback`, `replay-buffer-bytes`, `open`）自体は変更しない
