/**
 * 大きな選択の集計を細切れに走らせる（ADR 0049）。
 *
 * 100 万セルを一度に数えると 300ms ほど描画が止まる。かたまりごとに手を離して
 * 描画と打鍵を先に通し、選択が変わったら途中で捨てる。
 */

import type { SelectionStats } from '../results/selectionStats'
import {
  accumulateRows,
  createAccumulator,
  finishStats,
  lastSelectedRow,
} from '../results/selectionStats'
import type { SelectionSource } from '../../stores/selectionStats'

/**
 * 1 度に数えるセルの数。
 *
 * 38 桁の `NUMBER` だけの 1 万セルで約 3ms（JavaScriptCore、ADR 0049 の実測）。
 * 1 フレーム（16ms）に十分収まり、100 万セルでも 100 回で終わる。
 */
export const SLICE_CELLS = 10_000

/** 次のかたまりを後で走らせる関数。テストでは手で進める。 */
export type Scheduler = (work: () => void) => void

/** 既定の後回し。描画と打鍵の処理を先に通す。 */
const defaultScheduler: Scheduler = (work) => {
  setTimeout(work, 0)
}

/**
 * 1 かたまりに入れる行の数。
 *
 * @param width 選択の列の数
 */
export function rowsPerSlice(width: number): number {
  return Math.max(1, Math.floor(SLICE_CELLS / Math.max(width, 1)))
}

/**
 * 集計を細切れに走らせる。
 *
 * 最初のかたまりもすぐには数えず後回しにする。呼ばれるのは選択が変わった直後で
 * あり、そこで数え始めると選択の描画を待たせるためである。
 *
 * @param source 集計の材料
 * @param onDone 数え終えたら呼ぶ
 * @param schedule 次のかたまりを後で走らせる関数
 * @returns 途中で止める関数。止めたら `onDone` は呼ばれない
 */
export function startSlicedStats(
  source: SelectionSource,
  onDone: (stats: SelectionStats) => void,
  schedule: Scheduler = defaultScheduler,
): () => void {
  const { rows, range, exhausted } = source
  const acc = createAccumulator()
  const end = lastSelectedRow(rows, range) + 1
  const step = rowsPerSlice(range.right - range.left + 1)
  let next = range.top
  let cancelled = false

  const work = () => {
    if (cancelled) {
      return
    }
    const to = Math.min(next + step, end)
    accumulateRows(acc, rows, range, next, to)
    next = to
    if (next < end) {
      schedule(work)
    } else {
      onDone(finishStats(acc, rows, range, exhausted))
    }
  }

  schedule(work)
  return () => {
    cancelled = true
  }
}
