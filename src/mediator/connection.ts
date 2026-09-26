/**
 * 接続の一生の裁定（ADR README「接続の切断と切り替え」・ADR 0026・0030・0035）。
 *
 * 切断・繋ぎ直し・接続断の配りは、どれも複数のストアにまたがる。ストアの中から
 * 別のストアを呼ばず、後片付けの順序はここに 1 本で書く。
 */

import { getDbApi } from '../api/db'
import { useConnectionStore } from '../stores/connection'
import { useDefinitionStore } from '../stores/definition'
import { selectStatementsInFlight, useExecutionStore } from '../stores/execution'
import { useSchemaStore } from '../stores/schema'
import { useSessionsStore } from '../stores/sessions'
import { useSourceSearchStore } from '../stores/sourceSearch'
import { useUiStore } from '../stores/ui'
import { DISCONNECT_WORDING } from '../transaction/pendingChanges'
import type { Ask } from './ask'
import { resolvePendingTransaction } from './transaction'

/**
 * サーバ側で接続が切れたことを受け取り、各ストアへ配る（ADR 0026）。
 *
 * 断は実行だけでなく、スキーマ取得・定義・セッション一覧・ソース検索・
 * コミットのどの往復でも起こりうる。気付くのは `src/api/` 層の見張り 1 箇所で、
 * ここは受け取ったものを順に配るだけである。**切断の後片付けを順に呼ぶのと
 * 同じ形であり、ストア同士を結合させない。**
 *
 * `execution` 側では未コミットの表示を降ろし、そのことをメッセージタブへ
 * 残す。切れた時点で Oracle はロールバック済みであり、表示を出し続けるのも、
 * 黙って消すのも、どちらも嘘になる。
 *
 * **配るのは段階が実際に変わったときだけである。**印が立った後のプールは
 * 往復せずその場で断を返すため、切れたあとにツリーの枝を開く・定義タブを
 * 開く・もう一度実行する、のたびに同じ報せが届く。数えてしまうと、
 * いちばん読みたい最初の 1 行——未コミットがロールバックされたことを
 * 添えた行——がメッセージタブの上へ押し流される。**この機能が守ろうとした
 * 情報を、この機能自身のノイズで隠さない。**繋ぎ直したあとにもう一度
 * 切れれば段階は `connected` から動くため、新しい行が必ず出る。
 *
 * @param message 断を告げるエラーの文言
 */
export function relayConnectionLost(message: string): void {
  if (useConnectionStore.getState().markLost(message)) {
    useExecutionStore.getState().noteConnectionLost(message)
  }
}

/**
 * 同じ接続先へ繋ぎ直す（ADR 0026）。
 *
 * 自動では行わない。押させることそのものが、「繋ぎ直した接続は別のセッション
 * であり、未コミットの変更はもう無い」を利用者へ見せる機会である。
 *
 * 開いていた結果セットは断の時点で破棄済みにしてあるため、ここでは何も
 * 捨てない。エディタのタブと内容も残す。スキーマツリーは同じデータベースの
 * ものであり、繋ぎ直しても中身は変わらない。
 *
 * **繋ぎ直せたらスキーマだけ取り直す**（ADR 0030）。ツリーは接続の識別子で
 * 引くため、新しい接続では取り直さないと古い識別子のまま残る。断がスキーマの
 * 読み込み中に起きていれば、取り直さないかぎりツリーは空のままである。
 * 取り直しは同期的に始まるため、接続が変わったことで走る取得（`load`）は
 * 読み込み中を見て素通りする。
 *
 * **繋ぎ直せなかったときはメッセージタブへ残す。**押した結果が分からないと、
 * 押したのかどうかすら見分けられない。繋ぎ直しの失敗は断そのものではなく
 * `Connect` のエラーであり、断の見張り（`onConnectionLost`）には乗らない。
 */
export async function reconnectConnection(): Promise<void> {
  await useConnectionStore.getState().reconnect()

  const { status, error, connection: active } = useConnectionStore.getState()
  if (status === 'lost') {
    useExecutionStore.getState().noteReconnectFailure(error ?? '接続を確立できませんでした')
    return
  }

  if (status === 'connected' && active) {
    void useSchemaStore.getState().reload(active.id)
  }
}

/**
 * 実行中のすべてのタブを中止する（`⌘.` と同じ）。
 *
 * 切断できない旨の知らせから呼ぶ。実行中のタブは選択中のものとは限らない
 * ため、走っているものをすべて対象にする。
 */
export function cancelAllRunning(): void {
  const active = useConnectionStore.getState().connection
  if (!active) {
    return
  }
  const execution = useExecutionStore.getState()
  for (const [tabId, tab] of Object.entries(execution.byTab)) {
    if (tab.status === 'running') {
      void execution.cancel(active.id, tabId)
    }
  }
}

/**
 * 接続を切り、接続を選ぶ画面へ戻してよい状態にする（方針 2・4）。
 *
 * エディタのタブと内容はそのまま残す。切断でタブを失うと、書きかけの SQL の
 * ために接続を切れなくなる。
 *
 * 後片付けはここで順に呼ぶ。開いたままの結果セットはデータベース側の資源を
 * 握るため、接続が生きているうちに `release_tab` で閉じる（ADR 0003）。
 * ストアの掃除もここで行い、ストア同士を結合させない。
 *
 * 実行中の文があるときは切断せず、先に中止するよう促す（方針 5）。促しには
 * 中止の入口も添え、選ばれたらここで中止する。未コミットの変更があるときは、
 * 閉じるときと同じ関所を通す（ADR 0012）。
 *
 * @param ask 利用者への尋ね方
 *
 * @returns 切断まで進んだか。真なら画面を接続を選ぶところへ戻す
 */
export async function disconnectAndReset(ask: Ask): Promise<boolean> {
  const active = useConnectionStore.getState().connection
  if (!active) {
    return false
  }

  if (selectStatementsInFlight(useExecutionStore.getState())) {
    if ((await ask({ kind: 'disconnectBlocked' })) === 'cancelExecution') {
      cancelAllRunning()
    }
    return false
  }

  // 切断もデータベース側の暗黙のロールバックを招く。閉じるときと同じ関所を
  // 通し、未コミットの変更を黙って捨てさせない（ADR 0012）。
  if (!(await resolvePendingTransaction(DISCONNECT_WORDING))) {
    return false
  }

  const execution = useExecutionStore.getState()
  for (const tabId of Object.keys(execution.byTab)) {
    try {
      await execution.releaseTab(active.id, tabId)
    } catch {
      // 閉じられなくても切断で接続ごと落ちる。切断そのものは止めない。
    }
  }

  const ui = useUiStore.getState()
  useExecutionStore.getState().clear()
  useSchemaStore.getState().clear()
  // セッションの一覧は接続に属する。切断したら捨てる（ADR 0017）。
  useSessionsStore.getState().clear()
  ui.closeSessions()
  // ソース検索の結果も同じく接続に属する（ADR 0021）。
  useSourceSearchStore.getState().clear()
  ui.closeSourceSearch()
  // テーブル定義も接続に属する（ADR 0019）。
  useDefinitionStore.getState().clear()

  try {
    await useConnectionStore.getState().disconnect()
  } catch {
    // 切断に失敗しても画面は接続を選ぶところへ戻す。
  }

  return true
}

/** `⌃⌘N`。別の接続を新しいウィンドウで開く（ADR 0009）。 */
export function openNewConnectionWindow(): void {
  void getDbApi().openConnectionWindow()
}
