# 0014: replay buffer の既定容量を scrollback 設定に連動させる

## Status

Accepted

## Context

`ghostty-web` v0.4.0 の `scrollback` オプションは、見た目の「行数」を直接指定する値ではなく、内部の scrollback 容量として扱われる。そのため、表示できる履歴行数は出力内容（折り返し、エスケープシーケンス、行幅）に依存して変動する。

一方、サーバ側の replay buffer はバイト単位のリングバッファであり、scrollback 設定と独立にサイズを決めると次の問題が起きる。

- replay buffer が小さすぎると、再接続時に表示側が保持可能な範囲より前で切れて復元量が不足する
- replay buffer が大きすぎると、表示側 scrollback の上限を超える分は実効表示に寄与しない

## Decision

- CLI の `--scrollback` は「要求行数」として受け取り、ghostty 用内部容量へ変換して適用する
- `--replay-buffer-bytes` 未指定時は、同じ変換結果を replay buffer の既定容量として使用する
- `--replay-buffer-bytes` が明示指定された場合は、その値を優先する
- `--scrollback` は近似指定であり、実際の表示行数は出力内容に依存することをドキュメントに明記する

## Consequences

### Positive

- scrollback と replay buffer の既定値が整合し、再接続時の復元量が期待とずれにくくなる
- 利用者は通常 `--scrollback` だけ調整すればよく、チューニング項目が減る

### Negative

- `--scrollback` は厳密な表示行数指定ではないため、設定値と体感行数が一致しない場合がある
- 変換係数は経験則であり、将来の ghostty-web 実装変更時に再調整が必要になる可能性がある

### Neutral

- 高度な用途では `--replay-buffer-bytes` による明示上書きが引き続き利用できる
