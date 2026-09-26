/**
 * トランザクションの裁定（ADR 0012・0035）。
 *
 * コミット・ロールバックと、未コミットのまま接続を手放させないための関所を持つ。
 * 関所は接続を手放す操作 — ウィンドウを閉じる・アプリを終了する・切断する —
 * のすべてが通る。
 */

import { isManualCommit, useConnectionStore } from '../stores/connection'
import { useExecutionStore } from '../stores/execution'
import type { PendingWording } from '../transaction/pendingChanges'
import { askPendingChoice } from '../transaction/pendingChanges'

/**
 * `⌥⌘C`。トランザクションをコミットする（ADR 0012）。
 *
 * 押された時点の接続をストアから読む。キー・ステータスバー・パレットの
 * どこから呼ばれても同じ接続に届けるためである。
 */
export function commitTransaction(): void {
  const active = useConnectionStore.getState().connection
  if (active) {
    void useExecutionStore.getState().commit(active.id)
  }
}

/** `⌥⌘R`。トランザクションをロールバックする（ADR 0012）。 */
export function rollbackTransaction(): void {
  const active = useConnectionStore.getState().connection
  if (active) {
    void useExecutionStore.getState().rollback(active.id)
  }
}

/**
 * 未コミットの変更を片付けてから進めてよいかを決める（ADR 0012）。
 *
 * 接続を手放す操作 — ウィンドウを閉じる・アプリを終了する・切断する — は、
 * すべてこの関所を通る。未コミットの変更があれば「コミット / 破棄 / やめる」を
 * 尋ね、「やめる」を選ばれたら進めない。コミットに失敗したときも進めない。
 * 失敗を告げないまま接続を手放すと、変更は暗黙のロールバックで消える。
 *
 * @param wording 操作ごとの問いかけと肯定側のラベル
 *
 * @returns 進めてよいか
 */
export async function resolvePendingTransaction(wording: PendingWording): Promise<boolean> {
  const { connection: active, status } = useConnectionStore.getState()
  // 切れている接続に「コミットしますか」と尋ねない（ADR 0026）。押しても
  // 届かず、未コミットの変更はサーバ側で既にロールバックされている。
  if (status === 'lost') {
    return true
  }
  if (!active || !isManualCommit(active) || !useExecutionStore.getState().inTransaction) {
    return true
  }

  const choice = await askPendingChoice(wording)

  if (choice === 'cancel') {
    return false
  }

  if (choice === 'commit') {
    await useExecutionStore.getState().commit(active.id)
    // コミットできていれば未コミットの表示は消えている。残っていれば失敗した。
    return !useExecutionStore.getState().inTransaction
  }

  await useExecutionStore.getState().rollback(active.id)
  return true
}
