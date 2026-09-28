/**
 * エディタのタブの裁定（ADR 0020・0022・0023・0035）。
 *
 * タブを閉じる（1 枚・他・右側）・定義タブを開く・SQL を新しいタブへ入れる、を持つ。
 * タブを閉じると結果セット・列幅・定義も手放すため、タブのストアだけでは
 * 完結しない。
 */

import { confirmCloseTab } from '../components/editor/closing'
import { tabDisplayName } from '../components/editor/tabNaming'
import { otherTabIds, tabIdsToTheRight } from '../components/editor/tabOrder'
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
 * 明示的に手放す（ADR 0003）。実行中のタブなら、手放しが先に中止を送る
 * （ADR README「エディタとタブ」・ADR 0003 への 2026-09-27 の追記）。結果テーブルで手を入れた列幅も、二度と使われない
 * ため一緒に忘れる。
 *
 * **タブを閉じる経路はここ 1 つである。**タブの `✕` も `⌘W` も右クリックの
 * メニュー（ADR 0038）もここを通る。
 *
 * @param tabId 閉じるタブ
 *
 * @returns タブがもう無いか。確認で取り消されたときだけ偽。何枚かをまとめて
 *   閉じる裁定が、取り消された時点で止まるために見る
 */
export async function closeTabAndRelease(tabId: string): Promise<boolean> {
  const tab = useTabStore.getState().tabs.find((item) => item.id === tabId)
  if (!tab) {
    return true
  }
  if (!(await confirmCloseTab(tab, tabDisplayName(tab)))) {
    return false
  }

  const connection = useConnectionStore.getState().connection
  if (connection) {
    // 実行中の文への中止は手放しそのもの（Rust の `release_tab`）が送る。中止を別の
    // コマンドで送ると、Tauri のコマンドは別々のスレッドで走るため手放しに追い越され、
    // 割り当てが外れた後の中止は届かない（ADR 0003 への 2026-09-27 の追記）。
    void useExecutionStore.getState().releaseTab(connection.id, tabId)
  }
  useUiStore.getState().forgetResultView(tabId)
  // 定義タブなら、そのタブが抱えていた定義と DDL も捨てる（ADR 0022）。
  useDefinitionStore.getState().drop(tabId)
  useTabStore.getState().closeTab(tabId)
  return true
}

/**
 * タブを 1 枚ずつ、同じ関所を通して閉じる（ADR 0038）。
 *
 * 書きかけのタブがあれば 1 枚ずつ尋ねる。**取り消されたらそこで止める。**
 * 「閉じない」と答えた人は、残りも閉じてよいかを考え直している。
 *
 * @param tabIds 閉じるタブ。並び順に尋ねる
 */
async function closeTabsInOrder(tabIds: readonly string[]): Promise<void> {
  for (const tabId of tabIds) {
    if (!(await closeTabAndRelease(tabId))) {
      return
    }
  }
}

/**
 * 右クリックの「他のタブを閉じる」（ADR 0038）。
 *
 * @param tabId 残すタブ
 */
export async function closeOtherTabs(tabId: string): Promise<void> {
  const ids = useTabStore.getState().tabs.map((tab) => tab.id)
  await closeTabsInOrder(otherTabIds(ids, tabId))
}

/**
 * 右クリックの「右側のタブを閉じる」（ADR 0038）。
 *
 * @param tabId 基準のタブ。これ自身は閉じない
 */
export async function closeTabsToRight(tabId: string): Promise<void> {
  const ids = useTabStore.getState().tabs.map((tab) => tab.id)
  await closeTabsInOrder(tabIdsToTheRight(ids, tabId))
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
