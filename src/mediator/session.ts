/**
 * セッションの復元の裁定（ADR 0005・0035）。
 *
 * 前回のタブ構成・サイドバーの面・ペインの寸法を戻す。タブと画面の 2 つの
 * ストアにまたがるため、仲介者に置く。接続そのものは復元しない。
 */

import { getDbApi } from '../api/db'
import { useTabStore } from '../stores/tab'
import { useUiStore } from '../stores/ui'

/**
 * ウィンドウのセッションを読み、タブと画面の配置を戻す。
 *
 * 読めなかったときは何もしない。初めて開くウィンドウや壊れた記録で起動を
 * 止めるより、空のタブ 1 枚から始めるほうがよい。
 *
 * @param windowLabel セッションの鍵になるウィンドウのラベル
 * @param windowHeight 今のウィンドウの高さ。エディタの高さの上限を決める
 */
export async function restoreSession(windowLabel: string, windowHeight: number): Promise<void> {
  let session
  try {
    session = await getDbApi().loadSession(windowLabel)
  } catch {
    return
  }

  useTabStore.getState().restore(session)
  if (
    session.sidebarSegment === 'schema' ||
    session.sidebarSegment === 'history' ||
    session.sidebarSegment === 'saved'
  ) {
    useUiStore.getState().selectSidebarSegment(session.sidebarSegment)
  }
  useUiStore.getState().restoreLayout(session, windowHeight)
}
