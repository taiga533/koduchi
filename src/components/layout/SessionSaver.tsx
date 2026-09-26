import { useEffect } from 'react'
import { getDbApi } from '../../api/db'
import { selectSession, useTabStore } from '../../stores/tab'
import { useUiStore } from '../../stores/ui'
import { currentWindowLabel } from '../../window'

/** セッションを書き出すまでの待ち時間（ミリ秒）。 */
export const SESSION_SAVE_DELAY = 600

/**
 * タブ構成の書き出し（ADR 0005）。
 *
 * 打鍵のたびに変わるタブの配列を、この何も描かない部品だけで購読する。
 * ルートで購読すると画面全体が打鍵ごとに描き直る。
 */
export function SessionSaver() {
  const tabs = useTabStore((state) => state.tabs)
  const activeTabId = useTabStore((state) => state.activeTabId)
  const sidebarSegment = useUiStore((state) => state.sidebarSegment)
  const sidebarWidth = useUiStore((state) => state.sidebarWidth)
  const editorHeight = useUiStore((state) => state.editorHeight)

  // タブの状態が落ち着いたら書き出す。1 打鍵ごとに書かないよう少し待つ。
  // ペインの寸法も同じ待ちに乗せる。ドラッグ中は 1 フレームごとに変わるためである。
  useEffect(() => {
    const timer = setTimeout(() => {
      const session = selectSession(
        { tabs, activeTabId },
        { sidebarSegment, sidebarWidth, editorHeight },
      )
      void getDbApi()
        .saveSession(currentWindowLabel(), session)
        .catch(() => {})
    }, SESSION_SAVE_DELAY)

    return () => clearTimeout(timer)
  }, [activeTabId, editorHeight, sidebarSegment, sidebarWidth, tabs])

  return null
}
