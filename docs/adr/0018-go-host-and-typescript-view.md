# 0018: ホストを Go で書き直し、ビューは TypeScript のまま Bun でビルドする

## Status

Accepted

Supersedes: [0001](0001-tech-stack-bun-hono-ghostty-web.md) の Runtime と PTY の部分、[0008](0008-remove-hono-use-bun-native.md)、[0009](0009-replace-bun-terminal-with-bun-pty.md)、[0010](0010-bundled-fonts-m-plus-1-code-and-nerd-fonts.md) の配信とアセット生成の部分、[0015](0015-standardize-cli-parsing-with-commander.md)

## Context

[0017](0017-host-owned-terminal-state.md) で端末状態をホストが持つことにしたため、ホストにはサーバ側の VT と、View ごとに送信量を制御できる WebSocket が必要になった。v0.2 までの Bun 製ホストには、次の問題があった。

- PTY に使っていた bun-pty（[0009](0009-replace-bun-terminal-with-bun-pty.md)）は個人がメンテナンスしている FFI ラッパで、入出力を文字列で受け渡すため PTY のバイト列をそのまま扱えない。出力がないときも 8 ms 間隔でポーリングする。`kill()` で止めたプロセスの終了コードを 0 と報告するため、Ctrl+C で止めた kastty が 0 で終了していた
- [0009](0009-replace-bun-terminal-with-bun-pty.md) で回帰先の候補に残した `Bun.Terminal` には、macOS の PTY に関する未解決の issue が残っている（[bun#33237](https://github.com/oven-sh/bun/issues/33237)、[bun#42171](https://github.com/oven-sh/bun/issues/42171)）
- Bun の WebSocket の `send()` は、未送信量が `backpressureLimit`（既定 16 MiB）を超えるとフレームを捨てる。捨てたことは戻り値 `0` でしか分からず、例外も切断も起きない。旧ホストは戻り値を見ていなかったため、端末出力の欠けに気付かず View の状態が壊れた
- `bun build --compile` で作る単体バイナリは約 70 MB あった
- Bun の CSS バンドラがフォントの `@font-face` を壊すため（[0010](0010-bundled-fonts-m-plus-1-code-and-nerd-fonts.md)）、フォントをサーバで独自に配信し、M PLUS 1 Code のアセットマップを生成して CI で検証する必要があった

G1 の PoC で、go-libghostty（`go.mitchellh.com/libghostty`）経由の libghostty-vt をホストの VT として使えることを確認した。

- 録画または合成した 11 種の出力（vim、less、`fzf --height`、ls、CJK・絵文字・全角文字、代替画面、モード、ハイパーリンク）で、Formatter の VT スナップショットを新しい端末に流すと元と同じ状態になり、同じ出力を ghostty-web 0.4.0 に流しても同じ画面を再現できた
- 解析速度は約 385 MiB/s だった
- DSR への応答は、ホストの VT から PTY にちょうど一度だけ書かれた

## Decision

ホストを Go で書き直す。ブラウザのビューは TypeScript と ghostty-web のまま残し、Bun はビューの lint・テスト・ビルドにだけ使う。

### ホスト（Go）

| 役割 | 採用 | 理由 |
|---|---|---|
| PTY | `github.com/creack/pty` | PTY をファイルとして扱い、バイト列のまま読み書きできる。終了状態は `os/exec` から得る |
| HTTP / WebSocket | `net/http` + `github.com/coder/websocket` | 書き込みの完了をホストが待てるので、送信キューと lagging（[0017](0017-host-owned-terminal-state.md)）を明示的に制御できる |
| VT | `go.mitchellh.com/libghostty`（go-libghostty） | libghostty-vt の cgo バインディング。libghostty-vt は libc にしか依存しないので静的リンクする |

- main パッケージは `./cmd/kastty` とする。バージョンは `-ldflags "-X main.version=<v> -X main.commit=<sha>"` で埋め込み、`kastty --version` は `<version>+<sha の先頭 7 文字>`（未設定なら `dev+HEAD`）を出力する
- CLI 引数は Go で解析する。オプションは `--port`、`--font-family`、`--scrollback`、`--open` / `--no-open`、`-h` / `--help`、`--version` で、起動するコマンドはオプションの後に `[--] command [args...]` で渡す（省略時は `$SHELL`、なければ `/bin/sh`）

### libghostty-vt のビルド

- `scripts/libghostty-vt.sh [zig-target]` は、go-libghostty が `CMakeLists.txt` で固定している ghostty のコミットを取得し、Zig 0.16.0 で静的ライブラリをビルドして、インストール先（prefix）を出力する。コミットが違うと C API が食い違うため、go-libghostty を更新するときはスクリプトのコミットも合わせる
- go-libghostty の cgo 指令は `pkg-config --static libghostty-vt-static` を呼ぶ。`PKG_CONFIG` に `scripts/pkg-config`、`LIBGHOSTTY_VT_PREFIX` に上の prefix を渡して、システムの pkg-config なしでリンクする
- xcframework は作らない（`-Demit-xcframework=false`、go-libghostty の `CMakeLists.txt` と同じ）。完全な Xcode を要求し、使わない iOS 向けのライブラリまでビルドするため
- リリースでは、ターゲットごとに libghostty-vt をビルドしてから `make release-target` でリンクする。Linux 向けは `zig cc` を cgo の C コンパイラにして glibc 2.28 に固定するので、どのホストからでもクロスコンパイルできる。macOS 向けは `zig cc` が `net` パッケージの必要とする `-lresolv` をリンクできないため、macOS ホストの clang で `-mmacosx-version-min=13.0` を付けてビルドする

### ビュー（TypeScript）

- 描画は ghostty-web 0.4.0 のままとし、[0011](0011-ghostty-web-integer-scroll-workaround.md) と [0012](0012-remove-auto-scroll-toggle.md) の判断も維持する
- Bun でビルドして `web/dist` に出力し（`bun run build:web`）、Go の `embed.FS`（`web/embed.go`）でバイナリに埋め込む。配信の経路は [0017](0017-host-owned-terminal-state.md) の接続口に従う
- フォントの選定（[0010](0010-bundled-fonts-m-plus-1-code-and-nerd-fonts.md)）は変えない。Symbols Nerd Font Mono は `web/fonts/` に置き、M PLUS 1 Code はビルド時に `@fontsource-variable/m-plus-1-code` からコピーする。起動時の CSS 書き換えと、生成した TS のアセットマップはなくなる
- 配布するバイナリは Bun を含まない

### プロトコルのテスト

ホストとビューは [0017](0017-host-owned-terminal-state.md) のメッセージをそれぞれの言語で実装する。`internal/protocol/testdata/messages.json` の fixture を Go と TypeScript の両方のテストで読み、実装の食い違いを検出する。

## Consequences

### Positive

- PTY の入出力をバイト列のまま扱え、アイドル時のポーリングがなくなる
- 子プロセスの終了状態を `os/exec` から直接得るので、終了コードが 0 に化けない
- 送信キューをホストが持つので、出力フレームが黙って捨てられることがなく、追いつけない View は [0017](0017-host-owned-terminal-state.md) のスナップショットで再同期できる
- Bun ランタイムを同梱しなくなり、バイナリが小さくなる
- フォントのアセットマップの生成と、その鮮度の検証が不要になる

### Negative

- ホスト（Go）とビュー（TypeScript）の 2 言語になり、ビルドには Go、Bun、Zig 0.16.0 が必要になる
- cgo を使うため、クロスコンパイルにはターゲットごとの libghostty-vt が要り、macOS 向けのバイナリは macOS ホストでしか作れない。初回のビルドでは ghostty のソース取得と Zig のビルドに時間がかかる
- go-libghostty は API の安定性を約束していないため、更新時に追従の手間が出ることがある
- メッセージの型を Go と TypeScript で二重に保守する。食い違いは共有 fixture で検出するが、fixture にないケースは検出できない

### Neutral

- 対応 OS は macOS と Linux のまま（POSIX PTY）
- [0002](0002-localhost-only-security-model.md) のセキュリティモデル（localhost 限定、Host/Origin/トークンの検証）と [0005](0005-blocking-command-pty-lifecycle.md) のライフサイクルは変わらない。トークンを検証する場所は [0017](0017-host-owned-terminal-state.md) で WebSocket の接続時だけになった
- サーバ側の libghostty-vt とブラウザ側の ghostty-web は、どちらも Ghostty の VT 実装に由来する
