/**
 * 履歴の全文プレビューをどの行に出すかを決める（ADR 0046）。
 *
 * 「フォーカスした行」を 2 つの入口で受ける。キーボードの焦点（`Tab` と
 * `↑` / `↓`）と、ポインタを行に置き続けること（ホバー）である。WKWebView では
 * ボタンを押しても焦点が移らない（macOS の作法）ため、焦点だけを入口にすると
 * マウスで使う人には開く道が無い。
 *
 * 焦点で開いたものはポインタが離れても閉じない。焦点が抜けたときに閉じる。
 * ホバーで開いたものは、ポインタが行にもプレビューにも居なくなったら閉じる。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { HOVER_CLOSE_DELAY_MS, HOVER_OPEN_DELAY_MS, type RowAnchor } from './previewPlacement'

/** 出しているプレビュー。 */
export interface PreviewTarget {
  entryId: number
  anchor: RowAnchor
  /** 開いた入口。閉じる条件が入口ごとに違う。 */
  source: 'focus' | 'hover'
}

/** 行とプレビューから呼ぶ口。 */
export interface HistoryPreviewControl {
  target: PreviewTarget | null
  /** 行の本体に焦点が当たった。待たずに出す。 */
  focusRow: (entryId: number, anchor: RowAnchor) => void
  /** 行の本体から焦点が抜けた。 */
  blurRow: (entryId: number) => void
  /** ポインタが行に入った。少し待ってから出す。 */
  enterRow: (entryId: number, anchor: RowAnchor) => void
  /** ポインタが行かプレビューから出た。 */
  leave: () => void
  /** ポインタがプレビューへ入った。閉じる予約を取り消す。 */
  keep: () => void
  /** すぐに閉じる（`esc`・右クリックのメニュー）。 */
  close: () => void
}

/**
 * プレビューの対象と、開閉の待ち時間を持つ。
 *
 * 待ちのタイマーを部品の外へ出したのは、行が 200 件あっても予約は常に高々 1 つで
 * よく、行ごとに持つと取り消し漏れで別の行のプレビューが後から開くためである。
 */
export function useHistoryPreview(): HistoryPreviewControl {
  const [target, setTarget] = useState<PreviewTarget | null>(null)
  const timer = useRef<number | null>(null)
  // 閉じる予約の判断で最新の入口を読むため、state と別に写しを持つ。
  const current = useRef<PreviewTarget | null>(null)

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const show = useCallback((next: PreviewTarget | null) => {
    current.current = next
    setTarget(next)
  }, [])

  useEffect(() => cancel, [cancel])

  const focusRow = useCallback(
    (entryId: number, anchor: RowAnchor) => {
      cancel()
      show({ entryId, anchor, source: 'focus' })
    },
    [cancel, show],
  )

  const blurRow = useCallback(
    (entryId: number) => {
      const shown = current.current
      if (shown !== null && shown.source === 'focus' && shown.entryId === entryId) {
        cancel()
        show(null)
      }
    },
    [cancel, show],
  )

  const enterRow = useCallback(
    (entryId: number, anchor: RowAnchor) => {
      cancel()
      const shown = current.current
      if (shown !== null && shown.entryId === entryId) {
        return
      }
      // 既に何か出ているなら待たずに切り替える。隣の行へ移るたびに一瞬消えると
      // 見比べられない。
      if (shown !== null && shown.source === 'hover') {
        show({ entryId, anchor, source: 'hover' })
        return
      }
      timer.current = window.setTimeout(() => {
        timer.current = null
        show({ entryId, anchor, source: 'hover' })
      }, HOVER_OPEN_DELAY_MS)
    },
    [cancel, show],
  )

  const leave = useCallback(() => {
    cancel()
    const shown = current.current
    if (shown === null || shown.source !== 'hover') {
      return
    }
    timer.current = window.setTimeout(() => {
      timer.current = null
      show(null)
    }, HOVER_CLOSE_DELAY_MS)
  }, [cancel, show])

  const close = useCallback(() => {
    cancel()
    show(null)
  }, [cancel, show])

  return { target, focusRow, blurRow, enterRow, leave, keep: cancel, close }
}
