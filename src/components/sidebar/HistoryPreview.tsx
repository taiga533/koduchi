/**
 * 履歴 1 件の全文プレビュー（ADR 0046）。
 *
 * 一覧は SQL の 1 行目しか出さない（行の高さを揃えて多くを並べるため）。
 * 全文はフォーカスした行についてだけ、サイドバーの右隣に重ねて出す。
 *
 * **焦点を奪わない。**焦点で開いたプレビューが焦点を取ると、行から焦点が抜けて
 * その場で閉じる。中を読むためのスクロールはポインタで行う。
 *
 * 構文の色分けはしない。字句の走査（`src/sql/tokens.ts`）は空白を落とすため
 * 元の書式へ戻せず、CodeMirror を行ごとに起こすのはホバーのたびには重い。
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { HistoryEntry } from '../../types/db'
import { useEscapeKey } from '../../input/useEscapeKey'
import { placePreview, type RowAnchor } from './previewPlacement'

interface HistoryPreviewProps {
  /** 行の `aria-describedby` から指す。 */
  id: string
  entry: HistoryEntry
  anchor: RowAnchor
  /** 見出しの 1 行（時刻・接続名・成否）。一覧の行と同じ表記を渡す。 */
  meta: React.ReactNode
  onPointerEnter: () => void
  onPointerLeave: () => void
  onClose: () => void
}

/** プレビューの幅。エディタの上に重なるので、読める幅に留めて覆いすぎない。 */
const PREVIEW_WIDTH = 480

export function HistoryPreview({
  id,
  entry,
  anchor,
  meta,
  onPointerEnter,
  onPointerLeave,
  onClose,
}: HistoryPreviewProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState({ left: anchor.right, top: anchor.top })

  useEscapeKey(onClose)

  // 一覧がスクロールすると行が動き、プレビューが別の行の横に残って嘘をつく。
  // スクロールは泡立たないため捕捉相で拾い、プレビュー自身のスクロールは除く。
  useEffect(() => {
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) {
        return
      }
      onClose()
    }
    window.addEventListener('scroll', onScroll, true)
    return () => window.removeEventListener('scroll', onScroll, true)
  }, [onClose])

  // 高さは SQL の長さで決まるため、描いた直後、塗る前に実寸を測って置き直す。
  // 対象の行が変われば `anchor` も作り直されるので、それだけを見れば足りる。
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) {
      return
    }
    const rect = element.getBoundingClientRect()
    setPosition(
      placePreview(
        anchor,
        { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    )
  }, [anchor])

  return (
    <div
      ref={ref}
      id={id}
      role="tooltip"
      data-testid="history-preview"
      style={{ left: position.left, top: position.top, width: PREVIEW_WIDTH }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      className="fixed z-30 max-w-[calc(100vw-16px)] max-h-[60vh] flex flex-col rounded-9px bg-panel border border-line shadow-[0_8px_24px_rgba(24,28,38,.16)] overflow-hidden"
    >
      <div className="shrink-0 px-10px py-6px border-b border-line text-10.5px text-fg5">
        {meta}
      </div>
      <pre className="m-0 flex-1 min-h-0 overflow-auto px-10px py-8px text-11.5px leading-[1.55] text-fg2 whitespace-pre-wrap break-all">
        {entry.sql}
      </pre>
      {entry.succeeded || entry.errorMessage === null ? null : (
        <p className="shrink-0 m-0 max-h-[30%] overflow-auto px-10px py-6px border-t border-line text-11px leading-[1.5] text-err whitespace-pre-wrap break-all">
          {entry.errorMessage}
        </p>
      )}
    </div>
  )
}
