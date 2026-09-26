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
import { useTabStore } from '../stores/tab'
import { isSqlTab } from '../stores/tabKinds'

/** `.sql` ファイルを開く / 保存するときの絞り込み。 */
const SQL_FILTERS = [{ name: 'SQL', extensions: ['sql'] }]

/**
 * `⌘S`。今の SQL タブをファイルへ保存する。
 *
 * 右クリックのメニュー（ADR 0038）と同じ `saveTab` を通す。入口が違っても
 * 保存の関所と書き戻しは 1 つである。
 */
export async function saveActiveTab(): Promise<void> {
  const tabId = useTabStore.getState().activeTabId
  if (tabId) {
    await saveTab(tabId)
  }
}

/**
 * `⇧⌘S`。今の SQL タブを、保存先を尋ねて別のファイルへ保存する（ADR 0037）。
 */
export async function saveActiveTabAs(): Promise<void> {
  const tabId = useTabStore.getState().activeTabId
  if (tabId) {
    await saveTabAs(tabId)
  }
}

/**
 * SQL タブをファイルへ保存する。
 *
 * 保存先が決まっていなければ選ばせる。取り消されたら何もしない。定義タブでは
 * 保存するものが無い（ADR 0022）。**選んでいないタブも保存できる**
 * （タブの右クリック、ADR 0038）。保存のために選択を動かすと、見ていた結果が
 * 入れ替わってしまう。
 *
 * @param tabId 保存するタブ
 */
export async function saveTab(tabId: string): Promise<void> {
  await saveSqlTab(tabId, (tab) => tab.filePath)
}

/**
 * SQL タブを、保存先を尋ねて別のファイルへ保存する。
 *
 * VSCode の「名前を付けて保存」と同じく、保存した後はそのタブの保存先が新しい
 * ファイルへ移る。以後の `⌘S` が元のファイルを書き換えないためである。
 *
 * @param tabId 保存するタブ
 */
export async function saveTabAs(tabId: string): Promise<void> {
  await saveSqlTab(tabId, () => null)
}

/**
 * SQL タブを保存する。`⌘S` と `⇧⌘S` の違いは、決まっている保存先を
 * 使うかどうかだけである。関所（定義タブでは何もしない）と書き戻しを 2 つに
 * 分けないため、ここへまとめる。
 *
 * **書くのは尋ねた後に読み直した中身である。**保存先を選んでいる間もタブは
 * 開いたままで、閉じられたら書かない。
 *
 * @param tabId 保存するタブ
 * @param knownPath 尋ねずに使う保存先。`null` なら選ばせる
 */
async function saveSqlTab(tabId: string, knownPath: (tab: SqlTab) => string | null): Promise<void> {
  const tab = findSqlTab(tabId)
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

  const current = findSqlTab(tabId)
  if (!current) {
    return
  }
  await getDbApi().writeTextFile(path, current.content)
  useTabStore.getState().markSaved(current.id, path)
}

/**
 * ID から SQL タブを引く。定義タブと無いタブは `null`。
 *
 * @param tabId タブの ID
 */
function findSqlTab(tabId: string): SqlTab | null {
  const tab = useTabStore.getState().tabs.find((item) => item.id === tabId)
  return tab && isSqlTab(tab) ? tab : null
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
