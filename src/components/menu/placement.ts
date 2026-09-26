/**
 * 右クリックのメニューを置く位置の計算（ADR 0038）。
 *
 * メニューは押した点を左上にして開くが、ウィンドウの右端や下端の近くでは
 * そのままだと外へ切れる。切れた項目は押せないうえ、切れていることにも
 * 気付きにくい。
 */

/** 画面上の点（`clientX` / `clientY`）。 */
export interface Point {
  x: number
  y: number
}

/** 幅と高さ。 */
export interface Size {
  width: number
  height: number
}

/** メニューと画面の端の間に必ず空ける余白。端にぴったり付くと影が切れる。 */
export const MENU_EDGE_MARGIN = 4

/**
 * メニューの左上の位置を決める。
 *
 * 右や下へはみ出すときは、押した点をメニューの右端や下端に合わせて反対側へ
 * 開く。macOS のネイティブのメニューと同じ振る舞いであり、押した点から
 * メニューが離れない。反対側へ開いても収まらないほど画面が狭いときは、
 * 端の余白に寄せて先頭の項目を見せる（見出しと最初の項目が最もよく押される）。
 *
 * @param point 押した点
 * @param menu メニューの大きさ
 * @param viewport 画面の大きさ
 *
 * @returns メニューの左上
 */
export function placeMenu(point: Point, menu: Size, viewport: Size): Point {
  return {
    x: placeAxis(point.x, menu.width, viewport.width),
    y: placeAxis(point.y, menu.height, viewport.height),
  }
}

/**
 * 1 つの軸で位置を決める。
 *
 * @param at 押した位置
 * @param length メニューの長さ
 * @param limit 画面の長さ
 */
function placeAxis(at: number, length: number, limit: number): number {
  if (at + length <= limit - MENU_EDGE_MARGIN) {
    return at
  }
  return Math.max(MENU_EDGE_MARGIN, at - length)
}
