# 0006: readonly を廃止

## Status

Accepted

## Context

kastty の readonly モードはデモ中の誤入力防止を目的としていた。実装方法として以下の選択肢があった：

1. クライアント UI のみ（keydown 遮断）
2. サーバ側のみ（WS 入力メッセージ破棄）
3. UI + サーバの二重ガード

当初は UI + サーバの二重ガードを採用したが、実運用では readonly を使う機会がなく、UI footer の存在も常時表示する価値に見合わなくなった。

## Decision

readonly 機能を廃止する。

- クライアント側: readonly toggle と入力遮断を削除する
- サーバ側: readonly 状態管理と入力破棄ガードを削除する
- プロトコル: `readonly` 制御メッセージと `hello.readonly` を削除する
- CLI: `--readonly` オプションを削除する

## Consequences

### Positive

- footer UI を削除でき、端末表示領域が常にシンプルになる
- クライアント・サーバ・プロトコルから readonly 状態同期が消え、実装が単純になる

### Negative

- 誤入力防止用の readonly モードは使えない

### Neutral

- localhost + token のアクセス制御方針は変更しない
