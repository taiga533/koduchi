/**
 * 結果セットを CSV へ書き出す手順（`⌥⌘S`）。
 *
 * 画面に出ている行だけでは足りないため、カーソルを尽きるまで読み進めながら
 * 書き出す。行は Rust 側へかたまりのまま渡し、フロントエンドには溜め込まない。
 * これで数十万行でもメモリを食わず、途中で中止できる。
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

    if (request.initialRows.length > 0) {
      written = await api.csvAppend(exportId, request.initialRows)
      hooks.onProgress(written)
    }

    let exhausted = request.exhausted

    while (!exhausted) {
      if (hooks.isCancelled()) {
        await api.csvAbort(exportId)
        return { status: 'cancelled', rows: written }
      }

      const chunk = await api.fetchMore(request.connectionId, request.tabId)
      exhausted = chunk.exhausted

      if (chunk.rows.length > 0) {
        written = await api.csvAppend(exportId, chunk.rows)
        hooks.onProgress(written)
      }
    }

    const total = await api.csvFinish(exportId)
    return { status: 'completed', rows: total }
  } catch (error) {
    // 失敗したときも書きかけのファイルは残さない。
    await api.csvAbort(exportId).catch(() => {})
    throw error
  }
}
