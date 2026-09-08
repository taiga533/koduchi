/**
 * IME で変換している最中の打鍵を見分ける（ADR 0025）。
 *
 * 日本語を打つとき、`⏎` は多くの場合「決定」ではなく**変換の確定**である。
 * 「ゆーざ」と打って `⏎` を押すのは「ユーザ」を確かめる操作であって、その先の
 * 実行や保存を頼んだわけではない。にもかかわらず WKWebView は、この `⏎` を
 * **本物の `⏎` として** `keydown` に流す。`⌥⏎` のような修飾付きの打鍵と違い、
 * 変換中かどうかを見ないかぎり区別が付かない。
 *
 * 小槌の対象は WKWebView（macOS の Tauri）だけである。実機の WKWebView で
 * 確かめたところ、変換中の打鍵は次のように届く。
 *
 * - `keydown` の `key` は `Enter` / `Escape` / `ArrowDown` などそのままで、
 *   `Process` にはならない。`keyCode` も 13 / 27 / 40 と本来の値であり、
 *   **229 にはならない**（Chromium の流儀とは違う）。
 * - 一方で `isComposing` は正しく真になる。**変換中かを見る手立てはこれだけ**で
 *   あり、`keyCode === 229` を併せて見る意味は無い。
 * - `<form>` は変換中の `⏎` で**暗黙の送信をしてしまう**。仕様上はしないはずだが
 *   実装はそうなっていない。`keydown` で `preventDefault()` すると止まる。
 * - 変換を確定した**次の**打鍵では `isComposing` は偽に戻っている。確定の直後を
 *   一定時間捨てるような手当ては要らないし、入れれば「日本語を打った直後だけ
 *   `⏎` が効かない」という別の不具合になる。
 *
 * したがって決まりは 1 つで足りる — **変換中の打鍵は何も起こさない。**
 * `⏎` だけでなく `esc` も `↑` `↓` も同じである。`esc` は変換の取り消し、
 * `↑` `↓` は変換候補の選択であり、どれも画面の側が横取りしてよい打鍵ではない。
 *
 * CodeMirror の検索パネル（`src/components/editor/search.tsx`）だけは、打鍵を
 * 受ける先が `@codemirror/search` の中にあってこの関所を通せないため、パネルの
 * 捕捉相で `keyup` の伝播ごと止めている。考え方は同じである。
 */

/**
 * `isComposing` を持ちうる打鍵。
 *
 * DOM の `KeyboardEvent`（`window` に付けた listener が受け取るもの）は
 * `isComposing` を直に持ち、React の合成 event は `nativeEvent` の下に持つ。
 * React の型には `isComposing` が無いため、両方を省略可として受ける。
 */
export interface ComposableKeyEvent {
  readonly isComposing?: boolean
  readonly nativeEvent?: { readonly isComposing?: boolean }
}

/**
 * その打鍵が IME の変換中に起きたものかを返す。
 *
 * React の合成 event を先に見るのは、合成 event が `isComposing` を持たない
 * ためである（持っていないだけで、`undefined` として素通りしてしまう）。
 *
 * @param event 判定する打鍵
 */
export function isComposingKey(event: ComposableKeyEvent): boolean {
  return event.nativeEvent?.isComposing ?? event.isComposing ?? false
}

/** 送信を止められる打鍵。`<form>` の `onKeyDown` が受け取るもの。 */
export interface SubmittableKeyEvent extends ComposableKeyEvent {
  readonly key: string
  preventDefault(): void
}

/**
 * `<form>` の `onKeyDown` に置く関所。変換確定の `⏎` による暗黙の送信を止める。
 *
 * 送信の event 自体は変換中かを持たないため、送信になる前の `keydown` で断つ。
 * 変換していないときの `⏎` はそのまま通り、今までどおり送信される。
 *
 * @param event `<form>` の中で起きた打鍵
 */
export function blockComposingSubmit(event: SubmittableKeyEvent): void {
  if (event.key === 'Enter' && isComposingKey(event)) {
    event.preventDefault()
  }
}
