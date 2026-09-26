/**
 * `.sql` ファイルの裁定（ADR 0035）。
 *
 * 保存先を選ばせ、ファイルを読み書きし、その結果をタブのストアへ書き戻す。
 * ダイアログ・ファイルの読み書き・タブの 3 つにまたがるため、仲介者に置く。
 */

import { getDbApi } from '../api/db'
import { getDialogApi } from '../api/dialog'
import { tabFileName } from '../components/editor/tabNaming'
import type { SqlTab } from '../stores/tab'
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
  await saveActiveSqlTab((tab) => tab.filePath)
}

/**
 * `⇧⌘S`。今の SQL タブを、保存先を尋ねて別のファイルへ保存する（ADR 0037）。
 *
 * VSCode の「名前を付けて保存」と同じく、保存した後はそのタブの保存先が新しい
 * ファイルへ移る。以後の `⌘S` が元のファイルを書き換えないためである。
 */
export async function saveActiveTabAs(): Promise<void> {
  await saveActiveSqlTab(() => null)
}

/**
 * 今の SQL タブを保存する。`⌘S` と `⇧⌘S` の違いは、決まっている保存先を
 * 使うかどうかだけである。関所（定義タブでは何もしない）と書き戻しを 2 つに
 * 分けないため、ここへまとめる。
 *
 * @param knownPath 尋ねずに使う保存先。`null` なら選ばせる
 */
async function saveActiveSqlTab(knownPath: (tab: SqlTab) => string | null): Promise<void> {
  const tab = selectActiveSqlTab(useTabStore.getState())
  if (!tab) {
    return
  }

  const path =
    knownPath(tab) ??
    (await getDialogApi().save({
      defaultPath: tab.filePath ?? tabFileName(tab),
      filters: SQL_FILTERS,
    }))
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
