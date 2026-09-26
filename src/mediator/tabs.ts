/**
 * エディタのタブの裁定（ADR 0020・0022・0023・0035）。
 *
 * タブを閉じる・定義タブを開く・SQL を新しいタブへ入れる、の 3 つを持つ。
 * タブを閉じると結果セット・列幅・定義も手放すため、タブのストアだけでは
 * 完結しない。
 */

import { confirmCloseTab } from '../components/editor/closing'
import { tabDisplayName } from '../components/editor/tabNaming'
import { useConnectionStore } from '../stores/connection'
import { useDefinitionStore } from '../stores/definition'
import { useExecutionStore } from '../stores/execution'
import { selectActiveSqlTab, useTabStore } from '../stores/tab'
import { useUiStore } from '../stores/ui'
import type { DefinitionTarget } from '../types/db'

/**
 * タブを閉じる。
 *
 * 書きかけの SQL があるときは先に尋ねる（ADR 0023）。閉じたタブはセッションへも
 * 書き出されないため、ここで捨てた内容は再起動しても戻らない。
 *
 * 開いたままのカーソルはデータベース側の資源を握り続けるため、閉じる前に
 * 明示的に手放す（ADR 0003）。実行中のタブなら、手放す前に中止の命令を送る
 * （ADR README「エディタとタブ」）。結果テーブルで手を入れた列幅も、二度と使われない
 * ため一緒に忘れる。
 *
 * **タブを閉じる経路はここ 1 つである。**タブの `✕` も `⌘W` もここを通る。
 *
 * @param tabId 閉じるタブ
 */
export async function closeTabAndRelease(tabId: string): Promise<void> {
  const tab = useTabStore.getState().tabs.find((item) => item.id === tabId)
  if (!tab) {
    return
  }
  if (!(await confirmCloseTab(tab, tabDisplayName(tab)))) {
    return
  }

  const connection = useConnectionStore.getState().connection
  if (connection) {
    const execution = useExecutionStore.getState()
    // 実行中なら先に中止の命令を送る。手放すだけでは走っている文がデータベース
    // の上で最後まで走り続け、閉じたタブの文が接続を握ったままになる。走って
    // いないタブへは送らない（`cancel` の関所が弾く）。順序は中止が先である。
    // 手放すとプールはそのタブの割り当てを外すため、後から送った中止は届かない
    // （ADR 0003）。
    void execution.cancel(connection.id, tabId)
    void execution.releaseTab(connection.id, tabId)
  }
  useUiStore.getState().clearResultColumnWidths(tabId)
  // 定義タブなら、そのタブが抱えていた定義と DDL も捨てる（ADR 0022）。
  useDefinitionStore.getState().drop(tabId)
  useTabStore.getState().closeTab(tabId)
}

/** `⌘W`。選んでいるタブを閉じる。閉じる経路は `closeTabAndRelease` 1 つに集める。 */
export function closeActiveTab(): void {
  const tabId = useTabStore.getState().activeTabId
  if (tabId) {
    void closeTabAndRelease(tabId)
  }
}

/**
 * SQL を新しいタブに入れる。実行はしない。
 *
 * @param sql 入れる SQL
 */
function putIntoNewTab(sql: string): void {
  useTabStore.getState().openNewTab()
  const tabId = useTabStore.getState().activeTabId
  if (tabId) {
    useTabStore.getState().updateContent(tabId, sql)
  }
}

/**
 * 履歴や保存済みクエリの SQL をエディタへ入れる。
 *
 * 定義タブを選んでいるときは入れる先が無いため、新しい SQL タブを開いて
 * そこへ入れる（ADR 0022）。黙って何も起きないのでは、押した意味が分からない。
 *
 * @param sql 入れる SQL
 */
export function putSqlIntoEditor(sql: string): void {
  const tab = selectActiveSqlTab(useTabStore.getState())
  if (tab) {
    useTabStore.getState().updateContent(tab.id, sql)
    return
  }
  putIntoNewTab(sql)
}

/**
 * ツリーの `SELECT` を新しいタブに開く（ADR 0020）。
 *
 * **実行はしない。**結果セットのカーソルは接続 1 本につき高々 1 つであり
 * （ADR 0003）、ここで実行すると別のタブが見ている結果が閉じられる。
 * 実行するかどうかは利用者が `⌘⏎` で決める。
 *
 * @param sql 入れる `SELECT`
 */
export function openSqlInNewTab(sql: string): void {
  putIntoNewTab(sql)
}

/**
 * ツリーから定義タブを開く（ADR 0022）。
 *
 * タブ帯へ定義タブを足し（既に同じ対象のタブがあればそこへ移り）、その
 * タブぶんの定義を読む。取得はプールの結果セットを持たない接続で行われる
 * ため、利用者が見ている結果セットは壊れない（ADR 0003・0019）。
 *
 * @param target 開くオブジェクト
 */
export function openDefinitionTab(target: DefinitionTarget): void {
  const active = useConnectionStore.getState().connection
  if (!active) {
    return
  }
  const tabId = useTabStore.getState().openDefinitionTab(target)
  void useDefinitionStore.getState().open(active.id, tabId, target)
}
