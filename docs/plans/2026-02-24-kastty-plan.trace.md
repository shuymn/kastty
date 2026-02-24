# kastty - Plan Trace Pack

**Plan**: docs/plans/2026-02-24-kastty-plan.md
**Design Doc**: docs/plans/2026-02-24-kastty-design.md

---

## 1. Design Atom Index

### Goals (GOALxx)

| ID | Description |
|----|-------------|
| GOAL01 | ローカルで起動した shell / CLI をブラウザで開ける |
| GOAL02 | ブラウザからターミナル入力ができる |
| GOAL03 | ブラウザサイズに応じて PTY をリサイズできる |
| GOAL04 | 表示品質の高い端末描画（ghostty-web） |
| GOAL05 | MTG 向けの見せやすい UI（プレゼン寄り） |
| GOAL06 | 起動 1 コマンドで使える |
| GOAL07 | ブラウザが自動で開く（任意） |
| GOAL08 | デモ用途に必要な操作（readonly、フォント拡大）がすぐ使える |
| GOAL09 | 意図しない第三者アクセスを防ぐ（localhost 用途でも最低限の防御） |
| GOAL10 | 実装をシンプルに保つ（Bun の強みを活かす） |
| GOAL11 | 将来 Go / Rust へ移植可能なように、プロトコルと責務分離を明確化する |
| GOAL12 | Bun 固有 API 依存を PTY アダプタ層に閉じ込める |

### Non-Goals (NONGOALxx)

| ID | Description |
|----|-------------|
| NONGOAL01 | インターネット公開 / リモートホスティング用途 |
| NONGOAL02 | 認証基盤（OAuth, SSO 等） |
| NONGOAL03 | 複数ユーザー権限管理 |
| NONGOAL04 | 完全なセッション復元（サーバ側 VT パーサ） |
| NONGOAL05 | Windows 対応 |
| NONGOAL06 | tmux 代替のような多ペイン / 多セッション管理 |
| NONGOAL07 | SSH クライアント機能 |

### Requirements (REQxx)

| ID | Description | Source |
|----|-------------|--------|
| REQ01 | Bun + Hono で HTTP サーバを構築し、静的ファイルを配信する | Design: システム構成 |
| REQ02 | WebSocket サーバで PTY I/O を中継する | Design: システム構成 |
| REQ03 | Host / Origin / Token 検証をセキュリティレイヤーで実装する | Design: セキュリティ設計 |
| REQ04 | PTY を `Bun.Terminal` で管理するアダプタ層を実装する | Design: モジュール構成 |
| REQ05 | WS プロトコルでバイナリフレーム（入出力）とテキストフレーム（制御 JSON）を分離する | Design: WebSocket プロトコル |
| REQ06 | CLI 引数解析（shell / command, readonly, port, open）を実装する | Design: CLI 仕様 |
| REQ07 | ブラウザ自動起動機能を実装する | Design: CLI 仕様 |
| REQ08 | ghostty-web でターミナルを描画するフロントエンドを実装する | Design: ブラウザ UI 仕様 |
| REQ09 | 単一クライアント接続ポリシーを実装する | Design: 接続ポリシー |
| REQ10 | readonly を UI + サーバの二重ガードで実装する | Design: readonly 制御 |
| REQ11 | フォントサイズ調整 UI を実装する | Design: ブラウザ UI 仕様 P0 |
| REQ12 | app 管理の auto-scroll トグルを提供せず、スクロール挙動を ghostty-web 標準に委譲する | ADR-0012 |
| REQ13 | 接続状態表示（connecting / connected / disconnected）を実装する | Design: ブラウザ UI 仕様 P0 |
| REQ14 | 出力リプレイバッファ（リングバッファ、上限 1 MB）を実装する | Design: PTY 仕様 |
| REQ15 | PTY ライフサイクル = kastty プロセスライフサイクルとする | Design: PTY 仕様 |
| REQ16 | PTY 終了時にクライアントへ exit イベントを送信する | Design: エラー処理 / 終了処理 |
| REQ17 | WS 切断時は PTY を維持し次の接続を待ち受ける | Design: エラー処理 / 終了処理 |
| REQ18 | resize メッセージで PTY をリサイズする | Design: データフロー |
| REQ19 | 起動時ランダムトークンを生成し URL クエリパラメータで受け渡す | Design: セキュリティ設計 |
| REQ20 | 127.0.0.1 のみに bind する | Design: セキュリティ設計 |
| REQ21 | Bun 固有 API を pty/ に閉じ込める | Design: モジュール構成 |
| REQ22 | WS プロトコルをランタイム非依存にする | Design: モジュール構成 |
| REQ23 | TERM=xterm-256color で PTY を起動する | Design: PTY 仕様 |
| REQ24 | 初期サイズ 80×24 で PTY 起動、接続後 resize で更新する | Design: PTY 仕様 |
| REQ25 | ログへのトークンマスク表示 | Design: セキュリティ設計 |

### Decisions (DECxx)

| ID | Description | ADR |
|----|-------------|-----|
| DEC01 | v1 技術スタック Bun + Hono + ghostty-web | ADR-0001 |
| DEC02 | localhost 限定 + Host/Origin/Token 検証 | ADR-0002 |
| DEC03 | 単一クライアント接続のみ | ADR-0003 |
| DEC04 | WS で制御メッセージと入出力データを分離 | ADR-0004 |
| DEC05 | ブロッキングコマンド + PTY ライフサイクル紐付け | ADR-0005 |
| DEC06 | readonly 二重ガード（UI + サーバ） | ADR-0006 |
| DEC07 | URL クエリパラメータでトークン受け渡し | ADR-0007 |
| DEC08 | auto-scroll トグルを廃止し、出力追従を ghostty-web 標準挙動に委譲する | ADR-0012 |

### Acceptance Criteria (ACxx)

| ID | Description |
|----|-------------|
| AC01 | kastty コマンド一つでローカル shell がブラウザに表示される |
| AC02 | ブラウザからのキー入力が PTY に反映される |
| AC03 | ブラウザリサイズ時に PTY の cols/rows が追従する |
| AC04 | ghostty-web による端末描画が正常に動作する（256color、日本語、基本的な TUI） |
| AC05 | 127.0.0.1 のみに bind し、Host / Origin / Token 検証が機能する |
| AC06 | readonly モードで入力が無効化される |
| AC07 | フォントサイズの増減が即時反映される |
| AC08 | app 管理の auto-scroll トグルがなく、スクロール挙動を ghostty-web 標準に委譲している |
| AC09 | PTY プロセス終了時にクライアントへ通知される |
| AC10 | ブラウザ切断後も PTY は維持され、リロードで再接続・現在の画面が表示される |
| AC11 | kastty プロセスはフォアグラウンドでブロックし、Ctrl+C または PTY プロセス終了で停止する |

---

## 2. Decision Trace

| DECxx | ADR | Status |
|-------|-----|--------|
| DEC01 | ADR-0001 (v1 技術スタック Bun + Hono + ghostty-web) | Proposed |
| DEC02 | ADR-0002 (localhost 限定 + Host/Origin/Token 検証) | Proposed |
| DEC03 | ADR-0003 (単一クライアント接続のみ) | Proposed |
| DEC04 | ADR-0004 (WS 制御メッセージと入出力データの分離) | Proposed |
| DEC05 | ADR-0005 (ブロッキングコマンド + PTY ライフサイクル) | Proposed |
| DEC06 | ADR-0006 (readonly 二重ガード) | Proposed |
| DEC07 | ADR-0007 (URL クエリパラメータトークン) | Proposed |
| DEC08 | ADR-0012 (auto-scroll トグル廃止) | Accepted |

---

## 3. Design → Task Trace Matrix

### REQ → Task (Satisfied Requirements)

| REQxx | Tasks |
|-------|-------|
| REQ01 | T06 |
| REQ02 | T06 |
| REQ03 | T05 |
| REQ04 | T02 |
| REQ05 | T01 |
| REQ06 | T09 |
| REQ07 | T09 |
| REQ08 | T07 |
| REQ09 | T04 |
| REQ10 | T04 (server), T08 (UI) |
| REQ11 | T08 |
| REQ12 | T08 |
| REQ13 | T08 |
| REQ14 | T03 |
| REQ15 | T04, T09 |
| REQ16 | T04 |
| REQ17 | T04 |
| REQ18 | T06, T07 |
| REQ19 | T05 |
| REQ20 | T05, T09 |
| REQ21 | T02 |
| REQ22 | T01 |
| REQ23 | T02 |
| REQ24 | T02 |
| REQ25 | T05 |

**Coverage**: 25/25 REQs mapped → **PASS**

### AC → Task DoD

| ACxx | Tasks (DoD) |
|------|-------------|
| AC01 | T09 |
| AC02 | T06, T07 |
| AC03 | T06, T07 |
| AC04 | T07 |
| AC05 | T05, T09 |
| AC06 | T04, T08 |
| AC07 | T08 |
| AC08 | T08 |
| AC09 | T04 |
| AC10 | T04, T07 |
| AC11 | T09 |

**Coverage**: 11/11 ACs mapped → **PASS**

### GOAL → Task

| GOALxx | Tasks |
|--------|-------|
| GOAL01 | T02, T06, T07 |
| GOAL02 | T02, T06, T07 |
| GOAL03 | T06, T07 |
| GOAL04 | T07 |
| GOAL05 | T08 |
| GOAL06 | T09 |
| GOAL07 | T09 |
| GOAL08 | T04, T08 |
| GOAL09 | T05 |
| GOAL10 | all (design principle) |
| GOAL11 | T01 |
| GOAL12 | T02 |

**Coverage**: 12/12 GOALs covered → **PASS**

### DEC → Task Design Anchors

| DECxx | Tasks |
|-------|-------|
| DEC01 | T02, T06, T07 |
| DEC02 | T05 |
| DEC03 | T04 |
| DEC04 | T01, T06, T07 |
| DEC05 | T04, T09 |
| DEC06 | T04, T08 |
| DEC07 | T05 |
| DEC08 | T07, T08 |

**Coverage**: 8/8 DECs mapped → **PASS**

---

## 4. Task → Design Compose Matrix

| Task | Design Anchors | Satisfied Requirements | AC in DoD |
|------|---------------|----------------------|-----------|
| T01 | REQ05, REQ22, DEC04 | REQ05, REQ22 | — |
| T02 | REQ04, REQ21, REQ23, REQ24, DEC01 | REQ04, REQ21, REQ23, REQ24 | — |
| T03 | REQ14 | REQ14 | — |
| T04 | REQ09, REQ10, REQ15, REQ16, REQ17, DEC03, DEC05, DEC06 | REQ09, REQ10, REQ15, REQ16, REQ17 | AC06, AC09, AC10 |
| T05 | REQ03, REQ19, REQ20, REQ25, DEC02, DEC07 | REQ03, REQ19, REQ20, REQ25 | AC05 |
| T06 | REQ01, REQ02, REQ18, DEC01, DEC04 | REQ01, REQ02, REQ18 | AC02, AC03 |
| T07 | REQ08, REQ18, DEC01, DEC04, DEC08 | REQ08, REQ18 | AC02, AC03, AC04, AC10 |
| T08 | REQ10, REQ11, REQ12, REQ13, DEC06, DEC08 | REQ10, REQ11, REQ12, REQ13 | AC06, AC07, AC08 |
| T09 | REQ06, REQ07, REQ15, REQ20, DEC05 | REQ06, REQ07 | AC01, AC05, AC11 |

**Orphan task anchors** (anchor not in design atoms): none → **PASS**
**Tasks without REQ/AC anchor**: none → **PASS**

---

## 5. Full Cross Self-Check Evidence

### 5.1 Forward Fidelity (Design → Tasks)

**REQ coverage**: Every REQ01–REQ25 appears in at least one task's Satisfied Requirements. **PASS**

**AC coverage**: Every AC01–AC11 appears in at least one task's DoD. **PASS**

**GOAL coverage**: Every GOAL01–GOAL12 is covered by one or more tasks. **PASS**

**DEC coverage**: Every DEC01–DEC08 appears in at least one task's Design Anchors. **PASS**

**DEC→ADR mapping**: Every DEC maps to exactly one ADR.
- DEC01 → ADR-0001 ✓
- DEC02 → ADR-0002 ✓
- DEC03 → ADR-0003 ✓
- DEC04 → ADR-0004 ✓
- DEC05 → ADR-0005 ✓
- DEC06 → ADR-0006 ✓
- DEC07 → ADR-0007 ✓
- DEC08 → ADR-0012 ✓

**PASS**

### 5.2 Reverse Fidelity (Tasks → Design)

Reconstructed design intent from task anchors, goals, GREEN, and DoD:

> The system provides a local terminal sharing tool (T09 CLI) that spawns a PTY via Bun.Terminal adapter (T02), relays I/O through a Hono HTTP/WS server (T06) using a binary/text frame protocol (T01), renders in ghostty-web (T07), and provides UI controls for font, readonly, and status (T08). Session management (T04) enforces single-client policy with PTY lifecycle tied to the process and output replay buffer (T03) for reconnection. Security (T05) is ensured via Host/Origin/Token validation with localhost-only binding.

This reconstruction preserves:
- All design scope (PTY, WS protocol, server, frontend, UI, CLI, security) ✓
- All key decisions (DEC01–DEC08) ✓
- All acceptance criteria intent (AC01–AC11) ✓

**Orphan anchors** (task anchors pointing to non-existent atoms): none ✓
**Tasks without REQ/AC in Satisfied Requirements**: none ✓

**PASS**

### 5.3 Non-Goal Guard

| NONGOALxx | Violating Tasks |
|-----------|----------------|
| NONGOAL01 | none |
| NONGOAL02 | none |
| NONGOAL03 | none |
| NONGOAL04 | none |
| NONGOAL05 | none |
| NONGOAL06 | none |
| NONGOAL07 | none |

No task introduces behavior outside mapped design atoms. **PASS**

### 5.4 Granularity Guard

| Task | Coherent commit-sized? | Notes |
|------|----------------------|-------|
| T01 | ✓ | Single module (`protocol/`) with types + validation |
| T02 | ✓ | Single module (`pty/`) with adapter implementation |
| T03 | ✓ | Single data structure (ring buffer) |
| T04 | ✓ | Single module (`session/`) coordinating deps |
| T05 | ✓ | Single middleware module with related concerns |
| T06 | ✓ | Server integration, touches few files but coherent |
| T07 | ✓ | Frontend terminal core, one coherent feature |
| T08 | ✓ | Frontend UI components, one coherent feature |
| T09 | ✓ | CLI entry point + lifecycle, one coherent feature |

No tasks flagged as too broad or too fragmented. **PASS**

### 5.5 Round-Trip Gate

| Gate | Result |
|------|--------|
| Forward fidelity | PASS |
| Reverse fidelity | PASS |
| Non-goal guard | PASS |
| Granularity guard | PASS |
| **Alignment verdict** | **PASS** |
