/**
 * CSV の書き出しの裁定（ADR の「CSV の書式」節・ADR 0035）。
 *
 * 選択中のタブの結果を、保存先を選ばせてから書き出す。結果・タブ・接続・書式の
 * 設定を読み、書き終えたら実行のストアへカーソルが尽きたことを書き戻す。
 *
 * 進み具合を描くのは画面の仕事であり、ここは `report` で報せるだけである。
 * 中止も画面が持つ（押された瞬間を知っているのは画面だけである）。
 */

import { getDialogApi } from '../api/dialog'
import type { CsvExportState } from '../components/csv/CsvSaveDialog'
import { tabBaseName } from '../components/editor/tabNaming'
import { exportCsv } from '../csv/exportCsv'
import { useConnectionStore } from '../stores/connection'
import { useExecutionStore } from '../stores/execution'
import { selectActiveSqlTab, useTabStore } from '../stores/tab'
import { useUiStore } from '../stores/ui'

/** 書き出しの進み具合を画面へ渡す口と、中止されたかを読む口。 */
export interface CsvExportScreen {
  /** 進み具合を報せる。 */
  report: (state: CsvExportState) => void
  /** 中止されたか。かたまりを 1 つ書くたびに見る。 */
  isCancelled: () => boolean
}

/**
 * 選択中のタブの結果を CSV へ書き出す。
 *
 * 書き出せる結果が無ければ、保存先を尋ねる前にそう告げる。保存先を選ばずに
 * 閉じられたら何もしない。失敗はダイアログに出す（書き出しは利用者が
 * 見届ける操作であり、メッセージタブへ流すと気づかれない）。
 *
 * @param screen 進み具合の報せ先と中止の読み口
 */
export async function exportActiveResult(screen: CsvExportScreen): Promise<void> {
  const connection = useConnectionStore.getState().connection
  const tab = selectActiveSqlTab(useTabStore.getState())
  if (!connection || !tab) {
    return
  }

  const execution = useExecutionStore.getState().byTab[tab.id]
  if (!execution || execution.columns.length === 0) {
    screen.report({ rows: 0, done: true, error: '書き出せる結果がありません' })
    return
  }

  const path = await getDialogApi().save({
    defaultPath: `${tabBaseName(tab)}.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  })
  if (typeof path !== 'string') {
    return
  }

  screen.report({ rows: 0, done: false, error: null })

  try {
    const result = await exportCsv(
      {
        connectionId: connection.id,
        tabId: tab.id,
        path,
        columns: execution.columns,
        initialRows: execution.rows,
        exhausted: execution.exhausted,
        options: useUiStore.getState().csvOptions,
      },
      {
        onProgress: (rows) => screen.report({ rows, done: false, error: null }),
        isCancelled: screen.isCancelled,
      },
    )

    useExecutionStore.getState().markExhausted(tab.id)
    screen.report({
      rows: result.rows,
      done: true,
      error: result.status === 'cancelled' ? '書き出しを中止しました' : null,
      // 切り詰められたまま書き出したセルはダイアログで伝える（ADR 0021）。
      truncatedCells: result.truncatedCells,
    })
  } catch (error) {
    screen.report({
      rows: 0,
      done: true,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
