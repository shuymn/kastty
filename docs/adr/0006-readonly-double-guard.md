# 0006: readonly を UI + サーバの二重ガードで実装

## Status

Proposed

## Context

kastty の readonly モードはデモ中の誤入力防止を目的としている。実装方法として以下の選択肢がある：

1. クライアント UI のみ（keydown 遮断）
2. サーバ側のみ（WS 入力メッセージ破棄）
3. UI + サーバの二重ガード

kastty はローカル専用のため悪意あるバイパスは脅威ではないが、DevTools が開いている状態でのデモ中に誤って WS にメッセージを送るケースなどは防ぎたい。

## Decision

readonly を **クライアント UI（keydown 遮断）とサーバ（WS 入力メッセージ破棄）の二重ガード** で実装する。

- クライアント側: keydown イベントを遮断し、視覚的にも readonly 状態を表示する
- サーバ側: readonly 有効時に受信した入力メッセージを PTY に write せず破棄する

## Consequences

### Positive

- 確実に入力を防止できる（UI バイパスの心配が不要）
- デモ中の安心感が高い

### Negative

- サーバ側に readonly 状態の管理が必要（ただし実装コストは低い）

### Neutral

- readonly の切替は WS 制御メッセージまたは CLI フラグで行う
