# 0011: ghostty-web のスクロール描画バグに対する整数スクロールワークアラウンド

## Status

Accepted

## Context

ghostty-web v0.4.0 の `CanvasRenderer.render()` には、`viewportY`（スクロール位置）が小数値のときにスクロールバック／アクティブバッファの境界行で描画が崩れるバグがある。

macOS のトラックパッドなど `WheelEvent.deltaMode === DOM_DELTA_PIXEL` の入力デバイスでスクロールすると、ghostty-web 内部の `handleWheel` が `deltaY / lineHeight` を計算し、小数の `viewportY` を生成する。このとき `render()` の行取得ロジックで以下の問題が発生する：

1. **境界行の範囲外アクセス**: 行インデックス `t = Math.floor(viewportY)` が `t < viewportY`（小数比較）を満たすため、スクロールバックから `scrollbackLength` 番目（範囲外）の行を取得しようとし、`null` が返る
2. **描画スキップ**: `null` の行は `renderLine()` が呼ばれず、キャンバス上に前回描画の内容が残留する（ゴースト表示）
3. **アクティブバッファの 0 行目がスキップ**: 境界行がスクロールバック側に取られるため、アクティブバッファの表示が 1 行ずれる

症状としては、スクロール時にターミナル上の一部の行に別のビューポート位置の内容が重なって表示される。テキストデータ自体は正常であり、コピー＆ペーストでは正しい内容が得られる（純粋なキャンバス描画の問題）。

## Decision

ghostty-web の `attachCustomWheelEventHandler` API を使用してホイールイベントを自前で処理し、`scrollLines()` に整数値のみを渡すことで `viewportY` を常に整数に保つ。

具体的な実装（`web/ghostty-adapter.ts` の `installIntegerScrollHandler`）：

- `DOM_DELTA_PIXEL` モードではピクセル累積器（accumulator）を使用し、1 行分のピクセルが溜まった時点で整数行数に変換
- `DOM_DELTA_LINE` / `DOM_DELTA_PAGE` モードでは `Math.round()` で整数化
- カスタムハンドラから `true` を返し、ghostty-web のデフォルトハンドラ（小数 `viewportY` を生成する）をバイパス

## Consequences

### Positive

- 全プラットフォーム・全入力デバイスでスクロール時の描画崩れが解消される
- ghostty-web の公開 API（`attachCustomWheelEventHandler`, `scrollLines`）のみを使用しており、内部実装への依存がない

### Negative

- スムーズスクロール（サブピクセル単位の滑らかなアニメーション）が無効になる。スクロールは行単位で離散的に動作する
- ghostty-web 側でバグが修正された場合、このワークアラウンドを除去する必要がある

### Neutral

- ghostty-web の upstream に報告すべきバグである。修正後はこのワークアラウンドを除去し、本 ADR を Superseded にする
