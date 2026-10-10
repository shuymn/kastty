# 0017: 端末状態をホストが持ち、ビューは attach して描画する

## Status

Accepted

Supersedes: [0002](0002-localhost-only-security-model.md) のトークンを HTTP / WS の双方で検証する部分、[0004](0004-websocket-protocol-design.md)（接続口とメッセージ）、[0005](0005-blocking-command-pty-lifecycle.md) のリプレイバッファに関する部分、[0007](0007-url-query-token.md)、[0013](0013-multi-client-shared-session.md) のサイズの扱い、[0014](0014-align-replay-buffer-with-scrollback.md)、[0016](0016-editor-overlay-pty.md) の `/editor-ws` と本文アップロード

## Context

v0.2 までの kastty では、端末の状態を解釈しているのはブラウザの ghostty-web だけだった。サーバは PTY 出力のバイト列をリングバッファに溜めて配るだけで、次の問題が起きていた。

- 端末への問い合わせ（DSR など）にタブの数だけ応答が返り、再接続時はリプレイ内の過去の問い合わせにも応答して、実行中のプログラムに入力として届いていた
- リングバッファの先頭がエスケープシーケンスや UTF-8 の途中で切れ、代替画面やマウス追跡などのモードが復元されなかった
- 複数タブの resize が後勝ちで PTY のサイズが揺れ、記録時と異なる幅でリプレイが再生されていた
- タイトル解析、エディタ用の本文抽出、スクロールバックの換算が、それぞれクライアント側の近似で実装されていた
- エディタはメイン端末と別系統（`/editor-ws`、別マネージャ、本文アップロード最大 32 MiB）だった

G1 の PoC で、libghostty-vt（go-libghostty 経由）をサーバ側の VT として使えることを確認した。録画した vim / less / fzf / ls を含む 11 種の出力で、Formatter の VT 出力を新しい端末に流すと同じ状態になり（往復の不変条件）、同じ出力を ghostty-web 0.4.0 に流しても同じテキストになった。解析速度は約 385 MiB/s だった。

## Decision

### 概念

- **Host**: kastty プロセス。Session の集合を持つ。寿命はメインの Session と同じ（[0005](0005-blocking-command-pty-lifecycle.md) を維持）
- **Session**: PTY と VT ミラー（libghostty-vt の Terminal）の組。`kind` は `main` か `editor`。端末状態（画面、スクロールバック、モード、カーソル、タイトル、サイズ）の唯一の持ち主
- **View**: Session に attach したブラウザ側の接続。描画だけを行い、端末としての判断はしない
- **Driver**: Session のサイズを決める View。直近に入力を送った View（tmux の `window-size latest` 相当）。Driver が未定のときは最初に resize を送った View がなる。Driver が detach すると、残る View のうち直近に入力か resize を送った View が Driver を引き継ぐ

### 出力の流れ

PTY の出力は VT ミラーに書いてから View に配る。VT ミラーが生成する問い合わせへの応答（write_pty effect）は PTY に一度だけ書く。View は自分の端末エンジンが出力処理中に生成したデータをホストに送らない。

PTY への書き込み（View の入力と問い合わせへの応答）は専用の 1 本の goroutine が順に行い、出力の読み取りは書き込みを待たない。コマンドが入力を読まずに出力で詰まっていても、出力を読み続ければ詰まりが解けるためである。View の入力は書き終わるまで待つ（送り手の接続で背圧をかける）。応答は待たずにキューへ積み、未処理の書き込みが 256 件を超えたら捨てる。Driver の交代などでサイズが変わったときに VT が生成する in-band のサイズ報告（mode 2048）も、応答と同じ経路で PTY に書く。

各 View には送信キューがあり、未送信量が上限（4 MiB）を超えたらライブ出力の送信を止めてキューを捨てる（lagging）。送信が追いついたら、その時点のスナップショットを送って再開する。lagging のままコマンドが終了した View には、`exit` の前に最後の画面のスナップショットを送る。スナップショットの生成とライブ出力の配布は同じロックの下で行うので、順序は常に「スナップショット → それ以降の出力」になる。キューに続けて並んだ出力は、1 MiB までを 1 つのメッセージにまとめて送る。

kastty が終了するときは、すべての Session を終わらせてから、View が残りの出力と `exit` を受け取るまで最大 3 秒待つ。

### スナップショット

VT ミラーの Formatter で VT 形式を出力する。extras は modes / scrolling region / tabstops / keyboard / cursor / style / hyperlink / kitty keyboard / charsets を有効にし、palette は無効にする（ghostty-web 0.4.0 が OSC 4 の `rgb:` 形式を解釈できないため）。

- 代替画面のときは、バイナリスナップショットで複製した Terminal に `CSI ? 1049 l` を書いて主画面に戻し、その VT 出力を先に置く。続く代替画面の VT 出力は先頭でモード（`?1049h` を含む）を出すため、主画面のカーソルが保存され、代替画面の内容が新しい代替画面に描かれる
- 最後にタイトルを `OSC 2 ; <title> ST` で付ける（Formatter はタイトルを出さない）

### 接続口

| メソッドとパス | 内容 |
|---|---|
| `GET /` | ビューの HTML（秘密は含まない） |
| `GET /assets/*`, `GET /fonts/*` | 埋め込みアセット。`Cache-Control: public, max-age=31536000, immutable` |
| `GET /attach/{sessionId}`（WebSocket） | View の attach |

すべてのリクエストで Host を検証する（`127.0.0.1:<port>` または `localhost:<port>`。ポート 80 ではブラウザが省くポートなしの形も認める）。Origin ヘッダがあれば、同じホストの `http://` オリジンに限る。

attach では、upgrade 前に `Sec-WebSocket-Protocol` に `kastty.v1` と `kastty.auth.<token>` の両方があることを検証し、token を定数時間で比較する。応答では `kastty.v1` を選ぶ。失敗は upgrade 前に 403、存在しない Session は 404 で返す。

### トークンの受け渡し

CLI は `http://127.0.0.1:<port>/#<token>` を表示し、ブラウザで開く。ページはフラグメントを読み、`sessionStorage` に保存してから `history.replaceState` で URL から消す。フラグメントはサーバへ送られず、Referer にも載らない。

### メッセージ

バイナリフレームは端末データ、テキストフレームは `t` で種類を判別する JSON とする（[0004](0004-websocket-protocol-design.md) の規約を引き継ぐ）。未知の `t`、型の合わない値は無視せずエラーにする。

ホスト → View:

| `t` | フィールド | 意味 |
|---|---|---|
| `attached` | `session: {id, kind}`, `size: {cols, rows}`, `title`, `view: {fontFamily, scrollback}` | attach 直後に一度だけ送る。直後のバイナリフレーム 1 つがスナップショット |
| `snapshot` | なし | 再同期の合図。View は端末をリセットし、直後のバイナリフレーム 1 つ（スナップショット）を書く |
| `size` | `cols`, `rows` | Session のサイズが変わった。View はこのサイズで描画する |
| `title` | `title` | タイトルが変わった |
| `editor` | `id` | `open-editor` に応じて作った Session の id |
| `error` | `message` | 要求を処理できなかった（理由つき） |
| `exit` | `code` | Session が終了した。ホストはこの後ソケットを閉じる |

View → ホスト:

| `t` | フィールド | 意味 |
|---|---|---|
| バイナリ | 入力バイト | PTY に書く。送った View が Driver になる |
| `resize` | `cols`, `rows`（1〜65535 の整数） | View が表示できるサイズ。Driver の値だけが Session に適用される |
| `open-editor` | なし | `main` の Session でのみ有効。エディタの Session を作る |

受信フレームの上限は 8 MiB とする（ペーストを想定）。View は入力を 1 MiB 以下のフレームに、UTF-8 の文字の途中では切らずに分けて送る。

### エディタ（派生セッション）

`open-editor` を受けたら、ホストは次を行う。

1. エディタの Session がすでにあれば `error`（`An editor overlay is already open`）
2. `$VISUAL`、なければ `$EDITOR` を使う。どちらも空なら `error`（`No editor configured: set $VISUAL or $EDITOR`）
3. メインの VT ミラーから主画面とスクロールバックを plain 形式（ソフトラップを結合、行末の空白を削除）で取り出し、所有者のみ読み書きできる一時ファイルに排他作成で書く
4. `/bin/sh -c '<editor> "$@"' kastty-editor <file>` を新しい Session（`kind: editor`）として起動し、要求した View に `editor` を返す
5. エディタの Session は、エディタの終了か最後の View の切断で終わり、そのとき一時ファイルを削除する。10 秒以内に View が attach しなければエディタを終了させる。View が attach する前にエディタが終了した場合（`$EDITOR` の誤りなど）も、その 10 秒の間は Session の id を残し、遅れて attach した View に `exit` で終了コードを伝える。View は終了コード 126 / 127（シェルがコマンドを実行できなかった）をトーストで表示する。kastty の終了処理が始まった後の `open-editor` には `error` を返し、終了処理は一時ファイルの削除を待つ

### 設定

- `--scrollback <lines>` は VT ミラーのスクロールバック上限（行数）にそのまま使う。libghostty-vt はページ単位で確保するため、実際に保持する行数は指定以上になる
- ブラウザ側の ghostty-web の `scrollback` はバイト容量なので、ビューが `attached.view.scrollback` から換算する
- `--replay-buffer-bytes` は廃止する

## Consequences

### Positive

- 問い合わせへの応答はタブの数に関係なく一度だけになり、再接続で入力が紛れ込まない
- 再接続と 2 つ目のタブが同じ attach になり、復元はスナップショットで常に完全になる
- View ごとに溜まるライブ出力は 4 MiB を超えるとスナップショットに置き換わるので、遅い View がいてもメモリはおおむね「Session 数 × スクロールバック上限 ＋ View 数 × 数 MiB」に収まる
- メイン端末とエディタが同じ仕組みになり、本文のアップロードがなくなる

### Negative

- サーバとブラウザで同じ出力を二度解析する（ローカル用途では問題にならない速度）
- サーバ側の libghostty-vt とブラウザ側の ghostty-web のバージョンがずれると、幅の判定などが食い違う可能性がある。往復テストとエンジン間テストで検出する
- `--replay-buffer-bytes` の廃止と URL 形式の変更は互換性のない変更になる

### Neutral

- Driver 以外の View は Session のサイズで描画し、ウィンドウとの差は余白か切り取りになる
