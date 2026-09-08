/**
 * タブ帯の横スクロールの計算（ADR 0023 の器）。
 *
 * タブは `tabSizing.ts` の下限まで縮むが、それでも収まらない枚数になったら
 * 帯を横へスクロールさせる。そこで要る計算は 2 つあり、どちらも数の問題なので
 * 描画抜きで確かめられる。`tabOrder.ts` と同じ考え方で、純粋な関数だけを
 * ここに置く。
 *
 * - `revealOffset` — 選んだタブが帯の外に居るとき、どこまで送れば見えるか
 * - `autoScrollStep` — 掴んだタブを端まで持っていったとき、1 フレームでどれだけ送るか
 *
 * **落とす位置の計算（`tabOrder.ts` の `dropIndex`）はスクロールしても
 * そのままでよい。**`getBoundingClientRect()` が返すのは表示領域を原点にした
 * 座標であり、`clientX` と同じ土俵だからである。器の中身がどれだけ送られていても
 * 両者は一緒にずれる。だからスクロールを足すために `tabOrder.ts` へ手を入れる
 * 必要は無い。
 */

/** 端とみなす帯の内側の幅（px）。ここへ入るとスクロールが始まる。 */
export const AUTO_SCROLL_EDGE = 24

/** 1 フレームで送る量の上限（px）。端へ深く入るほどこの値に近づく。 */
export const AUTO_SCROLL_MAX_STEP = 14

/**
 * 選んだタブが見えるようになる送り量を返す。
 *
 * 既に見えているときは今の送り量をそのまま返す（呼び出し側が値の変化を見て
 * 書き込みを省ける）。左に隠れているときはタブの左端を帯の左端へ、右に隠れて
 * いるときはタブの右端を帯の右端へ合わせる。**必要な最小限しか動かさない。**
 * 帯より広いタブ（下限まで縮んでもなお帯に入らないとき）は左端を優先する。
 * 名前は左から読むためである。
 *
 * @param scrollLeft 今の送り量（px）
 * @param viewportWidth 帯の見えている幅（px）
 * @param tabLeft タブの左端。帯の中身の左端を 0 とした位置（px）
 * @param tabWidth タブの幅（px）
 */
export function revealOffset(
  scrollLeft: number,
  viewportWidth: number,
  tabLeft: number,
  tabWidth: number,
): number {
  if (tabLeft < scrollLeft) {
    return Math.max(tabLeft, 0)
  }

  const overflow = tabLeft + tabWidth - (scrollLeft + viewportWidth)
  if (overflow > 0) {
    // 帯より広いタブでは左端を優先する。右端に合わせると名前の頭が切れる。
    return Math.max(Math.min(scrollLeft + overflow, tabLeft), 0)
  }

  return scrollLeft
}

/**
 * 端へ深く入るほど大きくなる送り量を返す。
 *
 * @param depth 端の内側からどれだけ入ったか（px）
 */
function stepFor(depth: number): number {
  const ratio = Math.min(depth / AUTO_SCROLL_EDGE, 1)
  // 端に触れた時点で必ず動く。0 を返すとその場で止まって見える。
  return Math.max(1, Math.round(AUTO_SCROLL_MAX_STEP * ratio))
}

/**
 * ドラッグ中のポインタ位置から、1 フレームで送る量を返す。
 *
 * 左へ送るときは負、右へ送るときは正、端から離れているときは 0 を返す。
 * 帯の外まで出したときは上限で送り続ける。**帯が端の幅の 2 倍より狭いときは
 * 左を優先する**（両端が重なるが、そこまで狭い帯ではタブが 1 枚も入らない）。
 *
 * @param viewportLeft 帯の左端（`clientX` と同じ座標系）
 * @param viewportRight 帯の右端（`clientX` と同じ座標系）
 * @param pointerX ポインタの横位置（`clientX`）
 */
export function autoScrollStep(
  viewportLeft: number,
  viewportRight: number,
  pointerX: number,
): number {
  const intoLeft = viewportLeft + AUTO_SCROLL_EDGE - pointerX
  if (intoLeft > 0) {
    return -stepFor(intoLeft)
  }

  const intoRight = pointerX - (viewportRight - AUTO_SCROLL_EDGE)
  if (intoRight > 0) {
    return stepFor(intoRight)
  }

  return 0
}
