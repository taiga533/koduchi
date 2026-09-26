/**
 * ウェブビュー既定の右クリックメニューを止める（ADR 0038）。
 *
 * WKWebView は何も無い場所の右クリックに「再読み込み」を出す。押すと
 * フロントエンドの状態（接続・タブ・結果・未コミットの表示）だけが消え、Rust 側の
 * プールとトランザクションは残る。画面と実体が食い違うため、既定のメニューは
 * 止める。
 *
 * **ただし文字を扱う場所では残す。**入力欄・エディタの本文・選んだ文字の上では
 * 「コピー」「貼り付け」「調べる」「翻訳」「スペル」が役に立ち、代わりを作ると
 * クリップボードを読む権限まで要る（ADR 0038 の「エディタの本文」）。
 */

/** 画面上の点（`clientX` / `clientY`）。 */
export interface Point {
  x: number
  y: number
}

/** 矩形のうち、ここで見る部分。 */
interface RectLike {
  left: number
  right: number
  top: number
  bottom: number
}

/** 選択のうち、ここで見る部分。テストから `Selection` の代わりを渡せるように絞ってある。 */
export interface SelectionLike {
  isCollapsed: boolean
  rangeCount: number
  getRangeAt(index: number): { getClientRects(): ArrayLike<RectLike> }
}

/** 文字を打てる要素。CodeMirror の本文は `contenteditable="true"` である。 */
const EDITABLE_SELECTOR = 'input, textarea, [contenteditable=""], [contenteditable="true"]'

/**
 * 押した点が、選んだ文字の上か。
 *
 * **節点の包含ではなく、選択が描かれている矩形で見る。**右クリックの的は文字では
 * なく要素であり、1 つの `<pre>` の中の数語を選んだとき、その `<pre>` は選択に
 * 「含まれ」ない。逆に要素が選択と交わるかで見ると、選択を残したまま同じ器の
 * 空いた所を押しても真になり、「再読み込み」がまた出る。
 *
 * @param point 押した点
 * @param selection 今の選択
 */
export function isOnSelectedText(point: Point, selection: SelectionLike | null): boolean {
  if (selection === null || selection.isCollapsed) {
    return false
  }
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const rects = selection.getRangeAt(index).getClientRects()
    for (let rect = 0; rect < rects.length; rect += 1) {
      const { left, right, top, bottom } = rects[rect]
      if (left <= point.x && point.x <= right && top <= point.y && point.y <= bottom) {
        return true
      }
    }
  }
  return false
}

/**
 * 既定のメニューを残すか。
 *
 * @param target 右クリックされた要素
 * @param point 押した点
 * @param selection 今の選択
 */
export function shouldKeepNativeMenu(
  target: EventTarget | null,
  point: Point,
  selection: SelectionLike | null,
): boolean {
  if (target instanceof Element && target.closest(EDITABLE_SELECTOR)) {
    return true
  }
  return isOnSelectedText(point, selection)
}

/**
 * ウィンドウに関所を張る。外す関数を返す。
 *
 * 自前のメニューを出す部品は自分で `preventDefault` するため、ここは
 * それ以外の場所だけを受け持つ。
 *
 * @param target 張る先
 */
export function installNativeMenuGuard(target: Window): () => void {
  const onContextMenu = (event: MouseEvent) => {
    if (event.defaultPrevented) {
      return
    }
    const point = { x: event.clientX, y: event.clientY }
    if (!shouldKeepNativeMenu(event.target, point, target.getSelection())) {
      event.preventDefault()
    }
  }
  target.addEventListener('contextmenu', onContextMenu)
  return () => target.removeEventListener('contextmenu', onContextMenu)
}
