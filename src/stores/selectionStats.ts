/**
 * 結果テーブルで選んだ範囲と、ステータスバーに出す集計の種類（ADR 0049）。
 *
 * 選択の状態（`anchor` / `focus`、ドラッグ中か）は `ResultTable` の中に閉じたまま
 * 置き、ここには**集計に要る材料だけ**（読み込み済みの行・正規化した範囲・カーソルが
 * 尽きたか）を置く。選択を `ui` ストアへ出すと打鍵ごとにアプリ全体が描き直る
 * （CLAUDE.md「結果テーブルのコピー」）。専用の小さなストアにしてあるのは、購読する
 * のがステータスバーの集計の表示だけになるようにするためである。
 *
 * 集計そのものをここで持たないのは、集計を `ResultTable` の描画から切り離すためで
 * ある。大きな選択の集計は数百ミリ秒かかり、表の描画の中で走らせると選択を動かす
 * たびに表が止まる。集計は受け取った側（`useSelectionStats`）が細切れに走らせる。
 *
 * 集計の種類（合計 / 平均 / 最小 / 最大）は**保存しない**。ウィンドウを閉じれば
 * 既定の合計へ戻る。保存するなら `settings.toml` に項目を足すことになるが、あちらは
 * 表の表示の設定をまとめて扱う別の作業の持ち場であり、一度切り替えれば済む操作の
 * ために書式を広げるほどの理由は無い。
 */

import { create } from 'zustand'
import type { SelectionRange } from '../components/results/selection'
import type { StatKind } from '../components/results/selectionStats'
import type { Cell } from '../types/db'

/** 集計の材料。 */
export interface SelectionSource {
  rows: Cell[][]
  range: SelectionRange
  exhausted: boolean
}

interface SelectionStatsState {
  /** 今の選択。2 セル以上を選んでいなければ `null`。 */
  source: SelectionSource | null
  /** ステータスバーに出す集計の種類。 */
  kind: StatKind
  /** 選択を差し替える。結果テーブルだけが呼ぶ。 */
  publish: (source: SelectionSource | null) => void
  /** 出す集計の種類を選ぶ。 */
  choose: (kind: StatKind) => void
}

export const useSelectionStatsStore = create<SelectionStatsState>((set) => ({
  source: null,
  kind: 'sum',
  publish: (source) => set({ source }),
  choose: (kind) => set({ kind }),
}))
