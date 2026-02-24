# 0012: ghostty-web と競合する auto-scroll トグルを廃止する

## Status

Accepted

## Context

kastty の Web UI には `Auto-scroll: ON/OFF` トグルがあったが、`OFF` にしても新規出力で下端へ戻る挙動が継続し、UI 表示と実挙動が一致しなかった。

根拠（2026年2月24日時点）:

1. `web/main.ts` の従来実装では、`autoScroll` フラグで制御していたのは `scrollToBottom()` の明示呼び出しのみであり、レンダラ内部のスクロール制御は対象外だった
2. `ghostty-web` の `write` 実装（`node_modules/ghostty-web/dist/ghostty-web.js`）には `this.viewportY !== 0 && this.scrollToBottom()` があり、出力到着時に内部で下端追従が発生する
3. `ghostty-web` の公開オプション型（`node_modules/ghostty-web/dist/index.d.ts` の `ITerminalOptions`）に、出力追従を無効化する設定は存在しない
4. 既に `web/ghostty-adapter.ts` では [0011](0011-ghostty-web-integer-scroll-workaround.md) の整数スクロールワークアラウンドを適用しており、スクロール系の制御をアプリ側で部分的に重ねると競合と理解コストが増える

## Decision

- kastty 固有の `auto-scroll` 状態・UI トグルを削除する
- アプリ側の `scrollToBottom()` 強制呼び出しを削除し、出力追従挙動は ghostty-web 標準実装に委譲する
- 仕様書（design/plan/trace）から「追従 ON/OFF 提供」を削除し、「追従トグルは提供しない」方針へ更新する

## Consequences

### Positive

- UI 表示と実挙動の不一致が解消される
- スクロール制御の責務が単純化し、保守性が向上する
- ghostty-web 側挙動の変更追従箇所が減る

### Negative

- ユーザーが「追従を完全に無効化」する選択肢は v1 で提供されない
- 出力量が多い場面で、閲覧中の過去ログが新規出力で下端へ戻る可能性がある

### Neutral

- ghostty-web が将来、出力追従の無効化を公開 API で提供した場合は、再導入を別 ADR で再評価する
