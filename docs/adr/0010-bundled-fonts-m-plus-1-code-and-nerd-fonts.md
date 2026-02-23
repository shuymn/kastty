# 0010: デフォルトフォントとして M PLUS 1 Code + Nerd Fonts Symbols を同梱・配信

## Status

Proposed

## Context

kastty は「見せるためのターミナル」を提供するツールであり、表示品質が重要な設計目標のひとつである。v1 初期実装ではフォント指定がなく、ブラウザの既定 monospace フォントに依存していた。これにより以下の課題があった：

1. **日本語表示の品質**: ブラウザ既定の monospace フォールバックでは CJK 文字が等幅にならない、または意図しないフォントが使われる
2. **環境差異**: OS やブラウザによって表示が変わるため、デモ時に見た目が再現しない
3. **アイコングリフの欠落**: 開発者ツールや TUI アプリで多用される Nerd Font アイコン（Powerline シンボル等）が表示されない

また、配信方式についても以下の制約を考慮する必要があった：

- kastty は localhost 専用ツールであり、CDN からのフォント読み込みは不適切（オフライン環境で動作しない）
- Bun の CSS バンドラが `@font-face` の `unicode-range` 値を破損するバグがあり、HTML imports 経由での CSS バンドルが使えない
- 将来 `bun build --compile` による単体バイナリ配布を想定しており、フォントアセットも同梱できる構造が望ましい

## Decision

以下の 2 つのフォントをデフォルトとして同梱・配信する：

### フォント選定

| フォント | 用途 | ライセンス | 配信元 |
|----------|------|-----------|--------|
| M PLUS 1 Code (Variable) | ターミナル本文（Latin + CJK） | SIL OFL 1.1 | `@fontsource-variable/m-plus-1-code` npm パッケージ |
| Symbols Nerd Font Mono | アイコングリフ（Powerline 等） | MIT | `web/fonts/` に WOFF2 を同梱 |

**CSS の `font-family` 指定:**

```css
"M PLUS 1 Code Variable", "Symbols Nerd Font Mono", monospace
```

### 配信アーキテクチャ

Bun の CSS バンドラの `unicode-range` 破損を回避するため、フォント CSS とファイルをサーバ側で独自に配信する：

1. **起動時ロード** (`server/fonts.ts`): fontsource パッケージの `index.css` を読み込み、`url()` パスを `/fonts/` ルートに書き換え。Nerd Font の `@font-face` を追記
2. **CSS 配信** (`GET /fonts.css`): 書き換え済み CSS を返却。`Cache-Control: public, max-age=31536000, immutable`
3. **WOFF2 配信** (`GET /fonts/*`): 個別の WOFF2 ファイルを返却。同じく immutable キャッシュ
4. **クライアント側** (`web/main.ts`): `<link>` で `/fonts.css` を読み込み、`document.fonts.load()` でフォント準備完了を待ってから ghostty-web を初期化

### Nerd Font の更新

`scripts/update-nerd-font.sh` を用意し、Nerd Fonts の最新リリースから Symbols Only TTF をダウンロードし、`fonttools` で WOFF2 に変換して `web/fonts/` に配置する。

## Consequences

### Positive

- 全環境で同一のフォント表示が保証される（デモの再現性向上）
- 日本語・CJK の表示品質が向上（M PLUS 1 Code は日本語対応の等幅フォント）
- Nerd Font アイコンが正しく表示される（開発者ツール・TUI の見栄え改善）
- オフライン環境でも動作する（CDN 非依存）
- `?fontFamily=` クエリパラメータによるユーザー指定は引き続き有効（デフォルトの上書き可能）

### Negative

- バンドルサイズの増加（M PLUS 1 Code の WOFF2 群 + Nerd Font WOFF2）
- サーバ側ルートが 2 つ増加（`/fonts.css`, `/fonts/*`）
- Bun の CSS バンドラのバグに対するワークアラウンドであり、将来バグが修正された場合は Bun HTML imports 経由の配信に移行できる
- Nerd Font のバージョン更新は手動スクリプト実行が必要

### Neutral

- フォントファイルは起動時にメモリに読み込まれるため、配信時のディスク I/O は発生しない
- `@fontsource-variable/m-plus-1-code` パッケージは npm 依存として管理される。Nerd Font は手動管理（スクリプト + リポジトリ内 WOFF2）
