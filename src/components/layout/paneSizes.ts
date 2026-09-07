/**
 * ペインの寸法と、その下限・上限。
 *
 * 境界のドラッグ（`Splitter`）とセッション復元（ADR 0005）の両方から使う。
 * 寸法そのものは `ui` ストアが持ち、ここは値の丸め方だけを担う。ウィンドウを
 * 縮めるとエディタの上限が下がるため、丸めはウィンドウの高さに依存する。
 */

/** サイドバーの幅の下限（px）。 */
export const SIDEBAR_WIDTH_MIN = 180
/** サイドバーの幅の上限（px）。 */
export const SIDEBAR_WIDTH_MAX = 480
/** サイドバーの幅の既定値（px）。境界のダブルクリックでこの値へ戻す。 */
export const SIDEBAR_WIDTH_DEFAULT = 240

/** エディタの高さの下限（px）。 */
export const EDITOR_HEIGHT_MIN = 120
/** エディタの高さの既定値（px）。境界のダブルクリックでこの値へ戻す。 */
export const EDITOR_HEIGHT_DEFAULT = 268
/**
 * エディタの高さの上限を決めるための余白（px）。
 *
 * タイトルバー・タブ・ステータスバーと、結果ペインの見出しが収まるだけの高さを
 * ウィンドウから引く。
 */
export const EDITOR_HEIGHT_WINDOW_MARGIN = 200

/**
 * 値を下限と上限の間へ丸める。
 *
 * @param value 丸める値
 * @param min 下限
 * @param max 上限。下限を下回るときは下限が優先される
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * サイドバーの幅を許される範囲へ丸める。
 *
 * @param width 丸める幅（px）
 */
export function clampSidebarWidth(width: number): number {
  return clamp(width, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX)
}

/**
 * エディタの高さの上限を求める。
 *
 * ウィンドウが極端に低いときでも下限を割らないよう、下限より小さくはしない。
 *
 * @param windowHeight ウィンドウの高さ（px）
 */
export function editorHeightMax(windowHeight: number): number {
  return Math.max(EDITOR_HEIGHT_MIN, windowHeight - EDITOR_HEIGHT_WINDOW_MARGIN)
}

/**
 * エディタの高さを許される範囲へ丸める。
 *
 * @param height 丸める高さ（px）
 * @param windowHeight ウィンドウの高さ（px）
 */
export function clampEditorHeight(height: number, windowHeight: number): number {
  return clamp(height, EDITOR_HEIGHT_MIN, editorHeightMax(windowHeight))
}
