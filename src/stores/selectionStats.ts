/**
 * 結果テーブルで選んだセルの集計と、ステータスバーに出す集計の種類（ADR 0049）。
 *
 * 選択そのものは `ResultTable` の中に閉じたまま置き、ここには**集計の結果だけ**を
 * 置く。選択を `ui` ストアへ出すと打鍵ごとにアプリ全体が描き直る（CLAUDE.md
 * 「結果テーブルのコピー」）。専用の小さなストアにしてあるのは、購読するのが
 * ステータスバーの集計の表示だけになるようにするためである。
 *
 * 集計の種類（合計 / 平均 / 最小 / 最大）は**保存しない**。ウィンドウを閉じれば
 * 既定の合計へ戻る。保存するなら `settings.toml` に項目を足すことになるが、あちらは
 * 表の表示の設定をまとめて扱う別の作業の持ち場であり、一度切り替えれば済む操作の
 * ために書式を広げるほどの理由は無い。
 */

import { create } from 'zustand'
import type { SelectionStats, StatKind } from '../components/results/selectionStats'

interface SelectionStatsState {
  /** 今の選択の集計。選択が無いか、結果テーブルが描かれていなければ `null`。 */
  stats: SelectionStats | null
  /** ステータスバーに出す集計の種類。 */
  kind: StatKind
  /** 集計を差し替える。結果テーブルだけが呼ぶ。 */
  publish: (stats: SelectionStats | null) => void
  /** 出す集計の種類を選ぶ。 */
  choose: (kind: StatKind) => void
}

export const useSelectionStatsStore = create<SelectionStatsState>((set) => ({
  stats: null,
  kind: 'sum',
  publish: (stats) => set({ stats }),
  choose: (kind) => set({ kind }),
}))
