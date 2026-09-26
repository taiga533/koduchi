/**
 * 保存済みクエリの裁定（ADR 0018・0035）。
 *
 * 今のタブの SQL を切り出し、名前を尋ね、接続名を添えて保存済みへ積む。
 * タブ・接続・保存済みクエリの 3 つのストアにまたがるため、仲介者に置く。
 */

import { tabBaseName } from '../components/editor/tabNaming'
import { useConnectionStore } from '../stores/connection'
import { useSavedQueryStore } from '../stores/savedQuery'
import { selectActiveSqlTab, useTabStore } from '../stores/tab'
import type { Ask } from './ask'
import type { EditorCursor } from './execution'

/**
 * `⌃⌘S`。今のタブの内容を保存済みクエリにする（ADR 0018）。
 *
 * 選択範囲があればその中だけを保存する。名前の既定値はタブの名前から
 * `.sql` を落としたものである。空白だけの SQL は保存しない。
 *
 * @param cursor 押された時点のカーソル
 * @param ask 利用者への尋ね方
 */
export async function saveQueryFromEditor(cursor: EditorCursor, ask: Ask): Promise<void> {
  const tab = selectActiveSqlTab(useTabStore.getState())
  if (!tab) {
    return
  }
  const sql = cursor.selectedText ?? tab.content
  if (sql.trim() === '') {
    return
  }

  const name = await ask({ kind: 'saveQuery', defaultName: tabBaseName(tab), sql })
  // 接続は名前が決まった時点のものを添える。尋ねている間に切断されていれば積まない。
  const active = useConnectionStore.getState().connection
  if (name === null || !active) {
    return
  }
  await useSavedQueryStore.getState().save(name, sql, active.name)
}
