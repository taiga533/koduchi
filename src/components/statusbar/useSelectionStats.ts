/**
 * 選択の集計を、表の描画を止めずに求める（ADR 0049）。
 */

import { useEffect, useMemo, useState } from 'react'
import type { SelectionStats } from '../results/selectionStats'
import { computeSelectionStats, selectedCellCount } from '../results/selectionStats'
import type { SelectionSource } from '../../stores/selectionStats'
import { SLICE_CELLS, startSlicedStats } from './slicedStats'

/** 集計がまだ終わっていないことを表す。 */
export const PENDING = 'pending'

/**
 * 選択の集計を返す。
 *
 * 1 かたまり（`SLICE_CELLS`）に収まる選択はその場で数える。数ミリ秒で終わり、
 * 後回しにすると選ぶたびに「集計中」が一瞬出てちらつく。それより大きい選択は
 * 細切れに数え、終わるまでは `PENDING` を返す。前の選択の値を出し続けると、
 * 別の範囲の値に見えるためである。
 *
 * @param source 集計の材料
 */
export function useSelectionStats(source: SelectionSource): SelectionStats | typeof PENDING {
  const small = selectedCellCount(source.rows, source.range) <= SLICE_CELLS
  const immediate = useMemo(
    () => (small ? computeSelectionStats(source.rows, source.range, source.exhausted) : null),
    [small, source],
  )
  const [sliced, setSliced] = useState<{ source: SelectionSource; stats: SelectionStats } | null>(
    null,
  )

  useEffect(() => {
    if (small) {
      return
    }
    return startSlicedStats(source, (stats) => setSliced({ source, stats }))
  }, [small, source])

  if (immediate !== null) {
    return immediate
  }
  return sliced?.source === source ? sliced.stats : PENDING
}
