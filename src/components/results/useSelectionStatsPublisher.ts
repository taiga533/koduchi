/**
 * 結果テーブルの選択を、集計の材料としてステータスバーへ届ける（ADR 0049）。
 *
 * `ResultTable` への足し算を 1 行に留めるため、受け渡しをこのフックへ寄せる。
 */

import { useEffect } from 'react'
import type { Cell } from '../../types/db'
import { useSelectionStatsStore } from '../../stores/selectionStats'
import type { CellSelection } from './selection'
import { selectionRange } from './selection'
import { selectedCellCount } from './selectionStats'

/**
 * 選択を集計の材料としてストアへ置く。
 *
 * **ここでは集計しない。**集計を表の描画の中で走らせると、大きな選択を動かすたびに
 * 表が止まる。このフックは状態を持たず、表をもう 1 度描き直させることもない。
 * 1 セルだけの選択は集計を出さない（その値はセルに見えている）ため `null` を置く。
 * 結果テーブルが消えたら（タブの切り替え・定義タブ）材料も消す。前の結果の集計が
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

  useEffect(() => {
    if (selection === null) {
      publish(null)
      return
    }
    const range = selectionRange(selection)
    publish(selectedCellCount(rows, range) < 2 ? null : { rows, range, exhausted })
  }, [publish, selection, rows, exhausted])

  useEffect(() => () => publish(null), [publish])
}
