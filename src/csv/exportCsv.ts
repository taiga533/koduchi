/**
 * 結果セットを CSV へ書き出す手順（`⌥⌘S`）。
 *
 * 画面に出ている行だけでは足りないため、カーソルを尽きるまで読み進めながら
 * 書き出す。行は Rust 側へかたまりのまま渡し、フロントエンドには溜め込まない。
 * これで数十万行でもメモリを食わず、途中で中止できる。
 *
 * 書き出すのは結果テーブルと同じセルであり、64KB を超える `CLOB` は既に
 * 切り詰められている。書き出しは止めないが、何セルが切れたまま書かれたかを
 * 数えて返す（ADR 0021 の「黙って切り詰めない」）。
 */

import { getDbApi } from '../api/db'
import type { Cell, Column, CsvOptions } from '../types/db'

/** 書き出しの指示。 */
export interface CsvExportRequest {
  connectionId: string
  tabId: string
  /** 保存先のパス。 */
  path: string
  columns: Column[]
  /** 既に画面へ読み込んである行。まずこれを書く。 */
  initialRows: Cell[][]
  /** その時点でカーソルが尽きているか。 */
  exhausted: boolean
  options: CsvOptions
}

/** 書き出しの進み具合を伝える手立て。 */
export interface CsvExportHooks {
  /** 書けた行数を伝える。 */
  onProgress: (rows: number) => void
  /** 中止されたかを尋ねる。かたまりごとに呼ぶ。 */
  isCancelled: () => boolean
}

/** 書き出しの結末。 */
export interface CsvExportResult {
  status: 'completed' | 'cancelled'
  /** 書けた行数。中止した場合は途中までの数。 */
  rows: number
  /**
   * 切り詰められたまま書き出したセルの数（ADR 0021 の「黙って切り詰めない」）。
   *
   * `CLOB` は先頭 64KB までしか運ばれない（ADR の「値の受け渡し」節）。CSV も
   * 同じセルを書くため、切れた値がそのまま並ぶ。**書き出しは止めない**——
   * 1 つの長い `CLOB` のために表全体の書き出しを断るほうが害が大きい——が、
   * 何セルが切れているかは必ず伝える。
   */
  truncatedCells: number
}

/**
 * かたまりの中の切り詰められたセルを数える。
 *
 * @param rows 数えるかたまり
 */
function countTruncated(rows: Cell[][]): number {
  return rows.reduce(
    (total, row) => total + row.filter((cell) => cell.truncated === true).length,
    0,
  )
}

/**
 * CSV を書き出す。
 *
 * 中止された場合は書きかけのファイルを消す。中途半端な CSV を残すと、
 * 利用者が完全な出力と取り違える。
 *
 * @param request 書き出しの指示
 * @param hooks 進捗の通知と中止の問い合わせ
 */
export async function exportCsv(
  request: CsvExportRequest,
  hooks: CsvExportHooks,
): Promise<CsvExportResult> {
  const api = getDbApi()
  const exportId = crypto.randomUUID()

  await api.csvStart(exportId, request.path, request.columns, request.options)

  try {
    let written = 0
    let truncatedCells = 0

    if (request.initialRows.length > 0) {
      written = await api.csvAppend(exportId, request.initialRows)
      truncatedCells += countTruncated(request.initialRows)
      hooks.onProgress(written)
    }

    let exhausted = request.exhausted

    while (!exhausted) {
      if (hooks.isCancelled()) {
        await api.csvAbort(exportId)
        return { status: 'cancelled', rows: written, truncatedCells }
      }

      const chunk = await api.fetchMore(request.connectionId, request.tabId)
      exhausted = chunk.exhausted

      if (chunk.rows.length > 0) {
        written = await api.csvAppend(exportId, chunk.rows)
        truncatedCells += countTruncated(chunk.rows)
        hooks.onProgress(written)
      }
    }

    const total = await api.csvFinish(exportId)
    return { status: 'completed', rows: total, truncatedCells }
  } catch (error) {
    // 失敗したときも書きかけのファイルは残さない。
    await api.csvAbort(exportId).catch(() => {})
    throw error
  }
}
