# kastty - Plan Compose Pack

**Plan**: docs/plans/2026-02-24-kastty-plan.md
**Design Doc**: docs/plans/2026-02-24-kastty-design.md

---

## 1. Reconstructed Design Summary (from tasks only)

The following design summary is reconstructed solely from the task list's Design Anchors, Goal, GREEN descriptions, and DoD — without re-reading the original design doc.

### System Overview

kastty はローカル専用のターミナル共有ツールである。CLI コマンド一つで PTY を起動し（T09）、Bun.Terminal アダプタ（T02）経由で shell/command を管理する。Hono ベースの HTTP/WS サーバ（T06）が静的ファイル配信と WebSocket I/O 中継を行い、フロントエンドの ghostty-web（T07）でターミナルを描画する。

### Protocol

WebSocket プロトコル（T01）はバイナリフレーム（入出力データ）とテキストフレーム（JSON 制御メッセージ）を分離する。制御メッセージの型は `t` フィールドで識別し、ランタイム非依存で定義される。メッセージ種別: `resize`, `readonly`, `ping`（C→S）、`hello`, `exit`, `error`, `pong`（S→C）。

### PTY Management

PTY は `Bun.Terminal` ラッパー（T02）で管理し、`TERM=xterm-256color`、初期サイズ 80×24 で起動する。Bun 固有 API は `pty/` に閉じ込める。PTY ライフサイクルは kastty プロセスに紐付き（T04, T09）、ブラウザ切断では終了しない。

### Session Management

セッションマネージャ（T04）が PTY アダプタ、リプレイバッファ、接続状態を統合管理する。同時接続は単一クライアントのみ。既接続中は新規接続を拒否し、切断後に受け入れる。サーバ側 readonly ガードにより、readonly 有効時は入力を PTY に書き込まない。PTY 終了時は exit イベントを伝播する。

### Replay Buffer

出力リプレイバッファ（T03）はリングバッファ（上限 1 MB）で PTY 出力を蓄積する。クライアント（再）接続時にバッファ内容を一括送信し、ghostty-web がエスケープシーケンスを処理して画面を復元する。サーバ側 VT 状態解析は行わない。

### Security

セキュリティレイヤー（T05）は Host ヘッダ検証（`127.0.0.1:<port>`, `localhost:<port>`）、Origin ヘッダ検証（ローカルオリジンのみ）、起動時ランダムトークン検証（URL クエリパラメータ `?t=<token>`）を実装する。トークンはログでマスク表示する。サーバは `127.0.0.1` のみに bind する（T09）。

### Frontend

ghostty-web（T07）で端末描画を行い、WS 経由でバイナリ I/O を中継する。リサイズイベントは WS 制御メッセージとして送信し、サーバ経由で PTY をリサイズする。UI コントロール（T08）として接続状態表示、フォントサイズ調整、readonly トグル（UI 側 keydown 遮断 + WS 制御メッセージ）、出力追従 ON/OFF を提供する。

### CLI & Lifecycle

kastty コマンド（T09）は CLI 引数（`-- cmd args...`, `--readonly`, `--port`, `--open`）を解析し、`127.0.0.1` でサーバを起動する。URL を表示し、デフォルトでブラウザを自動起動する。プロセスはフォアグラウンドでブロックし、PTY 終了または SIGINT で停止する。

---

## 2. Scope Diff

### Missing (design doc にあるがタスクにない)

なし。設計ドキュメントの v1 スコープ内の全要件がタスクに反映されている。

P1 (v1.1) および P2 (将来) の UI 機能（プレゼンモード、テーマ切替、パターンマスキング等）は設計ドキュメントで明示的に v1 スコープ外とされており、タスクに含まれないことは正しい。

M0（技術検証）で選定するライブラリ（validation, CLI parser, frontend framework, build tool, logging）は各タスクの実装時に選定する設計としており、独立したタスクとしては不要。

### Extra (タスクにあるが設計ドキュメントにない)

なし。全タスクのスコープは設計ドキュメントの要件に基づいている。

### Ambiguous (解釈の余地がある項目)

| Item | 解釈 | 根拠 |
|------|------|------|
| M0 ライブラリ選定の粒度 | 各タスク内で実装時に選定 | 設計ドキュメントが候補を列挙するのみで決定していないため、実装タスク内の判断事項とした |
| フロントエンドビルド方式 | T07/T08 の実装時に決定 | 設計ドキュメントが Bun bundler / Vite を候補として挙げるのみ |
| エラーページ表示（PTY 起動失敗時） | T09 の CLI エラー出力として対応 | 設計ドキュメントの「エラーページ表示 or CLI へ明示出力」の後者を採用 |

---

## 3. Alignment Verdict

| Check | Result |
|-------|--------|
| Reconstructed scope matches design doc | ✓ |
| No missing v1 requirements | ✓ |
| No extra scope beyond design doc | ✓ |
| Ambiguous items resolved within design intent | ✓ |
| **Verdict** | **PASS** |
