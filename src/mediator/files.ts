/**
 * `.sql` ファイルの裁定（ADR 0035）。
 *
 * 保存先を選ばせ、ファイルを読み書きし、その結果をタブのストアへ書き戻す。
 * ダイアログ・ファイルの読み書き・タブの 3 つにまたがるため、仲介者に置く。
 */

import { getDbApi } from '../api/db'
import { getDialogApi } from '../api/dialog'
import { tabFileName } from '../components/editor/tabNaming'
import { selectActiveSqlTab, useTabStore } from '../stores/tab'

/** `.sql` ファイルを開く / 保存するときの絞り込み。 */
const SQL_FILTERS = [{ name: 'SQL', extensions: ['sql'] }]

/**
 * `⌘S`。今の SQL タブをファイルへ保存する。
 *
 * 保存先が決まっていなければ選ばせる。取り消されたら何もしない。定義タブでは
 * 保存するものが無い（ADR 0022）。
 */
export async function saveActiveTab(): Promise<void> {
  const tab = selectActiveSqlTab(useTabStore.getState())
  if (!tab) {
    return
  }

  const path =
    tab.filePath ??
    (await getDialogApi().save({ defaultPath: tabFileName(tab), filters: SQL_FILTERS }))
  if (typeof path !== 'string') {
    return
  }

  await getDbApi().writeTextFile(path, tab.content)
  useTabStore.getState().markSaved(tab.id, path)
}

/** `⌘O`。`.sql` ファイルを選ばせて、新しいタブで開く。 */
export async function openSqlFile(): Promise<void> {
  const path = await getDialogApi().open({ filters: SQL_FILTERS })
  if (typeof path !== 'string') {
    return
  }
  const content = await getDbApi().readTextFile(path)
  useTabStore.getState().openFile(path, content)
}
