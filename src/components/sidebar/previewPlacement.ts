/**
 * 履歴の全文プレビューを置く位置の計算（ADR 0046）。
 *
 * プレビューはサイドバーの右隣、つまりエディタの上に重ねて出す。一覧の中で行を
 * 広げると、ホバーで開いたときに下の行が押し下げられ、ポインタの下の行が
 * 入れ替わって開き直しが連鎖するためである。右隣に出せば、行から右へ
 * ポインタを動かしたとき他の行をまたがずにプレビューへ入れる。
 */

import type { Size } from '../menu/placement'

/** 行の画面上の位置。`getBoundingClientRect()` のうち要る 2 つだけを持つ。 */
export interface RowAnchor {
  top: number
  right: number
}

/** プレビューと画面の端の間に必ず空ける余白。 */
export const PREVIEW_EDGE_MARGIN = 8

/** 行の右端からプレビューまでの隙間。0 だとサイドバーの枠線と重なって見える。 */
export const PREVIEW_GAP = 6

/**
 * ホバーしてからプレビューを出すまでの待ち（ミリ秒）。
 *
 * 一覧の上をポインタが通り過ぎるだけでエディタの上に次々と重なるのを避ける。
 * キーボードの焦点では待たない（焦点は意図して当てたものだからである）。
 */
export const HOVER_OPEN_DELAY_MS = 350

/**
 * ポインタが行を離れてからプレビューを閉じるまでの猶予（ミリ秒）。
 *
 * 行からプレビューへ移る途中でサイドバーの縁やスクロールバーの上を通るため、
 * 離れた瞬間に閉じるとプレビューの中へ入ってスクロールできない。
 */
export const HOVER_CLOSE_DELAY_MS = 150

/**
 * プレビューの左上の位置を決める。
 *
 * 横は行の右隣に置き、はみ出すなら画面の右端へ寄せる（サイドバーに重なっても
 * 切れるよりはよい）。縦は行の上端に揃え、下へはみ出すなら上へずらす。
 * 右クリックのメニュー（`placeMenu`）のように反対側へ開かないのは、プレビューが
 * 行の横に並んでいることが「どの行の全文か」の手掛かりだからである。
 *
 * @param anchor 行の位置
 * @param preview プレビューの大きさ
 * @param viewport 画面の大きさ
 *
 * @returns プレビューの左上
 */
export function placePreview(
  anchor: RowAnchor,
  preview: Size,
  viewport: Size,
): { left: number; top: number } {
  const rightmost = viewport.width - PREVIEW_EDGE_MARGIN - preview.width
  const bottommost = viewport.height - PREVIEW_EDGE_MARGIN - preview.height
  return {
    left: Math.max(PREVIEW_EDGE_MARGIN, Math.min(anchor.right + PREVIEW_GAP, rightmost)),
    top: Math.max(PREVIEW_EDGE_MARGIN, Math.min(anchor.top, bottommost)),
  }
}
