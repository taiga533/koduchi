/**
 * 結果テーブルの選択を集計し、ステータスバーへ届ける（ADR 0049）。
 *
 * `ResultTable` への足し算を 1 行に留めるため、集計と受け渡しをこのフックへ寄せる。
 */

import { useDeferredValue, useEffect, useMemo } from 'react'
import type { Cell } from '../../types/db'
import { useSelectionStatsStore } from '../../stores/selectionStats'
import type { CellSelection } from './selection'
import { selectionRange } from './selection'
import { computeSelectionStats } from './selectionStats'

/**
 * 選択の集計をステータスバーへ届ける。
 *
 * 集計は `useDeferredValue` で遅らせる。列を丸ごと選ぶと数万セルを `bigint` で
 * 足すことになり、ドラッグや矢印キーのたびにそれを待つと選択の描画がもたつく。
 * 1 セルだけの選択は集計を出さない（その値はセルに見えている）ため `null` を送る。
 * 結果テーブルが消えたら（タブの切り替え・定義タブ）集計も消す。前の結果の集計が
 * 残ると、別の表の値に見える。
 *
 * @param selection 今の選択
 * @param rows 読み込み済みの行
 * @param exhausted カーソルが尽きたか
 */
export function useSelectionStatsPublisher(
  selection: CellSelection | null,
  rows: Cell[][],
  exhausted: boolean,
): void {
  const publish = useSelectionStatsStore((state) => state.publish)
  const deferred = useDeferredValue(selection)

  const stats = useMemo(() => {
    if (deferred === null) {
      return null
    }
    const computed = computeSelectionStats(rows, selectionRange(deferred), exhausted)
    return computed.cellCount < 2 ? null : computed
  }, [deferred, rows, exhausted])

  useEffect(() => {
    publish(stats)
  }, [publish, stats])

  useEffect(() => () => publish(null), [publish])
}
