/**
 * 右クリックのメニューの共通の器（ADR 0038）。
 *
 * スキーマツリー・結果テーブル・タブ帯・一覧の各行が同じ見た目と同じ振る舞いで
 * 開くために 1 つにしてある。決まりは次の 4 つ。
 *
 * - **焦点を奪わない。**暗幕も項目も押し下げの既定動作を止める。奪うと焦点が
 *   `<body>` へ抜け、閉じた後に元の場所のキー（`⌘C` / 矢印など）が届かなくなる
 *   （issue #53）。
 * - `esc` は `useEscapeKey` で受ける（ADR 0031）。器の `onKeyDown` では受けない。
 * - 外を押す・外で右クリックすると閉じる。
 * - 画面の端では反対側へ開く（`placement.ts`）。
 *
 * 項目を選んだら、選んだ操作を呼んでから閉じる。呼び出し側は閉じる手間を
 * 項目ごとに書かなくてよい。キーの表記は呼び出し側が `useShortcutLabel` で
 * 引いて渡す（ADR 0037。手で書かない）。
 */

import { useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { useEscapeKey } from '../../input/useEscapeKey'
import { placeMenu } from './placement'

/** メニューの 1 項目。 */
export interface ContextMenuItem {
  kind: 'item'
  label: string
  icon: ReactNode
  onSelect: () => void
  /** 右端に添えるキーの表記。空文字なら何も出さない。 */
  shortcut?: string
}

/** 項目の並びを区切る線。 */
export interface ContextMenuSeparator {
  kind: 'separator'
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator

/** 区切り線。並びを組むときに使い回す。 */
export const SEPARATOR: ContextMenuSeparator = { kind: 'separator' }

interface ContextMenuProps {
  /** 押した点（`clientX` / `clientY`）。 */
  x: number
  y: number
  /** 並べる項目。 */
  entries: readonly ContextMenuEntry[]
  /**
   * 見出し。右クリックした対象の名前を出す。行が細く取り違えやすい場所で、
   * 何に対するメニューかを見せるためのもの。
   */
  heading?: string
  /** テストから引くための印。暗幕には `-backdrop` を足した印が付く。 */
  testId: string
  /** メニューの幅（px）。項目の文言の長さに合わせて呼び出し側が決める。 */
  width?: number
  /** メニューを閉じる。 */
  onClose: () => void
}

/** 押し下げで焦点が動かないようにする。 */
function keepFocus(event: ReactMouseEvent) {
  event.preventDefault()
}

export function ContextMenu({
  x,
  y,
  entries,
  heading,
  testId,
  width = 200,
  onClose,
}: ContextMenuProps) {
  // `esc` で閉じる。打鍵は器ではなく `window` で受ける（ADR 0031）。
  useEscapeKey(onClose)

  const ref = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState({ x, y })

  // 描いた直後、塗る前に実寸を測って置き直す。項目の数で高さが変わるため、
  // 大きさを先に決め打ちできない。項目は開いている間に変わらないため、測り直すのは
  // 押した点が変わったときだけでよい。
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) {
      return
    }
    const rect = element.getBoundingClientRect()
    setPosition(
      placeMenu(
        { x, y },
        { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    )
  }, [x, y])

  return (
    <>
      {/* メニューの外を押したら閉じる。右クリックでも閉じる。 */}
      <div
        data-testid={`${testId}-backdrop`}
        className="fixed inset-0 z-20"
        onMouseDown={(event) => {
          keepFocus(event)
          onClose()
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          onClose()
        }}
      />
      <div
        ref={ref}
        role="menu"
        data-testid={testId}
        style={{ left: position.x, top: position.y, width }}
        onMouseDown={keepFocus}
        onContextMenu={(event) => event.preventDefault()}
        className="fixed z-30 p-4px rounded-9px bg-panel border border-line shadow-[0_8px_24px_rgba(24,28,38,.16)] flex flex-col gap-1px"
      >
        {heading !== undefined ? (
          <p className="m-0 px-9px py-4px text-10.5px text-fg5 truncate">{heading}</p>
        ) : null}
        {entries.map((entry, index) =>
          entry.kind === 'separator' ? (
            <div key={`separator-${index}`} role="separator" className="h-1px my-3px bg-line" />
          ) : (
            <button
              key={`${index}-${entry.label}`}
              type="button"
              role="menuitem"
              onClick={() => {
                entry.onSelect()
                onClose()
              }}
              className="flex items-center gap-8px px-9px py-5px rounded-6px bg-transparent border-none cursor-pointer font-inherit text-11.5px text-fg text-left hover:bg-fill"
            >
              <span className="text-fg4 flex items-center">{entry.icon}</span>
              <span className="flex-1 min-w-0 truncate">{entry.label}</span>
              {entry.shortcut ? (
                <span className="shrink-0 text-10.5px text-fg5">{entry.shortcut}</span>
              ) : null}
            </button>
          ),
        )}
      </div>
    </>
  )
}
