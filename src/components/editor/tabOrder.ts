/**
 * タブの並べ替えの計算（ADR 0023）。
 *
 * 「何番目を何番目へ動かしたら並びはどうなるか」「今のポインタ位置はどの位置へ
 * 落とすことになるか」はどちらもデータの問題であり、描画抜きで確かめられる。
 * 結果テーブルの `selection.ts` / `columnSizing.ts` と同じ考え方で、純粋な関数
 * だけをここに置く。
 */

/** 掴んだと見なすまでに動かす距離（px）。 */
export const DRAG_THRESHOLD = 4

/** 並べ替えの判定に使う、タブ 1 枚の横位置。 */
export interface TabRect {
  /** タブの ID。 */
  id: string
  /** タブの左端（`clientX` と同じ座標系）。 */
  left: number
  /** タブの幅（px）。 */
  width: number
}

/**
 * 配列の要素を 1 つ動かした新しい配列を返す。
 *
 * `from` を抜いてから `to` へ差し込む。`to` は抜いたあとの配列での位置であり、
 * 端から端へ動かすときは `0` と `length - 1` になる。範囲の外や動かない指定
 * （`from === to`）では元の配列と同じ並びを返す。
 *
 * @param items 元の並び
 * @param from 動かす要素の位置
 * @param to 動かした先の位置
 */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) {
    return items
  }

  const moved = [...items]
  const [item] = moved.splice(from, 1)
  moved.splice(to, 0, item)
  return moved
}

/**
 * ドラッグ中のポインタ位置から、掴んでいるタブを落とす位置を決める。
 *
 * 隣のタブの**中心**を越えたときに入れ替える。端まで一息に動かしたときも
 * 途中のタブを飛ばして落とせるよう、掴んだ位置から遠いほうから順に見る。
 * どのタブの中心も越えていなければ、掴んだタブの今の位置をそのまま返す。
 *
 * 幅はタブごとに違う（名前の長さで決まる）ため、中心は実際の位置から測る。
 *
 * @param rects 今の並び順に並べたタブの横位置
 * @param draggingId 掴んでいるタブの ID
 * @param pointerX ポインタの横位置（`clientX`）
 */
export function dropIndex(rects: TabRect[], draggingId: string, pointerX: number): number {
  const current = rects.findIndex((rect) => rect.id === draggingId)
  if (current === -1) {
    return -1
  }

  // 左へ動かす場合。左端に近いほうから見て、中心を越えた最初のタブへ落とす。
  for (let index = 0; index < current; index += 1) {
    if (pointerX < rects[index].left + rects[index].width / 2) {
      return index
    }
  }

  // 右へ動かす場合。右端に近いほうから見て、中心を越えた最初のタブへ落とす。
  for (let index = rects.length - 1; index > current; index -= 1) {
    if (pointerX > rects[index].left + rects[index].width / 2) {
      return index
    }
  }

  return current
}
