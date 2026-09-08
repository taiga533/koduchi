/**
 * IME で変換している最中の打鍵を見分ける（ADR 0025）。
 *
 * 日本語を打つとき、`⏎` は多くの場合「決定」ではなく**変換の確定**である。
 * 「ゆーざ」と打って `⏎` を押すのは「ユーザ」を確かめる操作であって、その先の
 * 実行や保存を頼んだわけではない。にもかかわらず WKWebView は、この `⏎` を
 * **本物の `⏎` として** `keydown` に流す。`⌥⏎` のような修飾付きの打鍵と違い、
 * 変換中かどうかを見ないかぎり区別が付かない。
 *
 * 小槌の対象は WKWebView（macOS の Tauri）だけである。**本物の日本語 IME
 * （Kotoeri）で実際に打って**確かめたところ、変換確定の `⏎` は次のように届く。
 *
 * - `key` は `Enter`、`code` は `Enter` のまま届く。
 * - **`keyCode` は 229 になる。**「この打鍵は IME が処理している」という古くから
 *   の合図であり、本来の 13 では**ない**。
 * - **`isComposing` は偽である。**変換の確定は composition の終わりでもあるため、
 *   この打鍵はもう「変換中」とは見なされない。
 *
 * つまり **`isComposing` だけでは変換確定の `⏎` を見分けられない。** ADR 0025 は
 * 当初 `setMarkedText:` で作った合成の変換状態を測り、「`isComposing` が真になる /
 * `keyCode` は 229 にならない」と結論して `keyCode === 229` を見る案を却下したが、
 * **本物の IME では逆であった。**両方を見る。
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
 * IME が処理している打鍵を表す `keyCode`。
 *
 * 実機の Kotoeri で変換を確定したときの `⏎` はこの値で届き、`isComposing` は
 * 偽である。値そのものに意味は無く、古くからの取り決めである。**推測ではなく
 * 実測した値であり、変える前に測り直すこと。**
 */
const IME_KEY_CODE = 229

/**
 * `isComposing` を持ちうる打鍵。
 *
 * DOM の `KeyboardEvent`（`window` に付けた listener が受け取るもの）は
 * `isComposing` を直に持ち、React の合成 event は `nativeEvent` の下に持つ。
 * React の型には `isComposing` が無いため、両方を省略可として受ける。
 */
export interface ComposableKeyEvent {
  readonly isComposing?: boolean
  readonly keyCode?: number
  readonly nativeEvent?: { readonly isComposing?: boolean; readonly keyCode?: number }
}

/**
 * その打鍵が IME の変換中に起きたものかを返す。
 *
 * React の合成 event を先に見るのは、合成 event が `isComposing` を持たない
 * ためである（持っていないだけで、`undefined` として素通りしてしまう）。
 *
 * **`isComposing` と `keyCode === 229` の両方を見る。**変換の途中（候補を選んで
 * いる間）は `isComposing` が真で届き、変換を確定する `⏎` は `isComposing` が偽・
 * `keyCode` が 229 で届く。片方だけでは確定の打鍵を取りこぼす。
 *
 * @param event 判定する打鍵
 */
export function isComposingKey(event: ComposableKeyEvent): boolean {
  const native = event.nativeEvent
  const isComposing = native?.isComposing ?? event.isComposing ?? false
  const keyCode = native?.keyCode ?? event.keyCode
  return isComposing || keyCode === IME_KEY_CODE
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
