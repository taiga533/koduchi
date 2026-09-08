/**
 * エディタタブの並び（デザイン 3a の 34px 帯）。
 *
 * 未保存の `●` 印は**名前の左**に置き、閉じるボタンは**常に右に出す**
 * （ADR 0023）。印とボタンを入れ替える作りにすると、未保存のタブが閉じられなく
 * なるうえ、`dirty` を持たないタブが並びに混ざったときに破綻する。
 *
 * 並べ替えは Pointer Events で行う。`Splitter` と同じく `setPointerCapture` を
 * 使い、`mousemove` を `window` に貼らない。落とす位置の計算は `tabOrder.ts` の
 * 純粋な関数に寄せてある。
 */

import { useCallback, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { Plus, X } from 'lucide-react'
import { useTabStore } from '../../stores/tab'
import { DRAG_THRESHOLD, dropIndex } from './tabOrder'
import type { TabRect } from './tabOrder'

interface TabBarProps {
  /**
   * タブを閉じる。
   *
   * 開いたままの結果セットを手放す必要があるため（ADR 0003）、ストアを直接
   * 触らずに呼び出し側へ委ねる。
   */
  onCloseTab: (id: string) => void
}

/** ドラッグ中に覚えておくこと。 */
interface DragState {
  pointerId: number
  /** 掴んでいるタブの ID。 */
  id: string
  /** 掴んだ位置（`clientX`）。 */
  origin: number
  /** しきい値を越えて「掴んだ」と見なしたか。 */
  held: boolean
}

/**
 * ポインタを捕捉する。
 *
 * 捕捉できない環境（jsdom など）でもドラッグ自体は成立するため、失敗は無視する。
 *
 * @param element 捕捉する要素
 * @param pointerId ポインタの識別子
 */
function capturePointer(element: Element, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId)
  } catch {
    // 捕捉できなくても `pointermove` は同じ要素へ届く。
  }
}

/**
 * ポインタの捕捉を解く。
 *
 * @param element 捕捉している要素
 * @param pointerId ポインタの識別子
 */
function releasePointer(element: Element, pointerId: number): void {
  try {
    element.releasePointerCapture(pointerId)
  } catch {
    // 既に解かれている場合がある。
  }
}

export function TabBar({ onCloseTab }: TabBarProps) {
  const tabs = useTabStore((state) => state.tabs)
  const activeTabId = useTabStore((state) => state.activeTabId)
  const selectTab = useTabStore((state) => state.selectTab)
  const moveTab = useTabStore((state) => state.moveTab)
  const openNewTab = useTabStore((state) => state.openNewTab)

  const drag = useRef<DragState | null>(null)
  /** タブの ID から描かれている要素を引く。横位置を実測するために持つ。 */
  const elements = useRef(new Map<string, HTMLElement>())
  const [draggingId, setDraggingId] = useState<string | null>(null)

  /**
   * 今の並び順でタブの横位置を測る。
   *
   * 並びは掴んでいる間にも変わるため、閉じ込めた値ではなくストアから読み直す。
   */
  const measure = useCallback((): TabRect[] => {
    const rects: TabRect[] = []
    for (const tab of useTabStore.getState().tabs) {
      const element = elements.current.get(tab.id)
      if (!element) {
        continue
      }
      const rect = element.getBoundingClientRect()
      rects.push({ id: tab.id, left: rect.left, width: rect.width })
    }
    return rects
  }, [])

  /** ドラッグを終える。指を離したときと、途中で取り消されたときの両方で呼ぶ。 */
  const endDrag = useCallback((element: Element, pointerId: number) => {
    drag.current = null
    releasePointer(element, pointerId)
    document.body.style.userSelect = ''
    setDraggingId(null)
  }, [])

  return (
    <div className="h-34px flex items-stretch gap-4px bg-bg shrink-0">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId
        const dragging = tab.id === draggingId

        /**
         * 掴む。閉じるボタンの上から始めたときは掴まない。
         *
         * 押し下げた時点でそのタブを選ぶ。並べ替えたタブが選ばれていないと、
         * どれを動かしたのかが分からなくなる。
         */
        const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
          if (event.button !== 0) {
            return
          }
          if ((event.target as HTMLElement).closest('[data-tab-action]')) {
            return
          }
          selectTab(tab.id)
          drag.current = {
            pointerId: event.pointerId,
            id: tab.id,
            origin: event.clientX,
            held: false,
          }
          capturePointer(event.currentTarget, event.pointerId)
        }

        const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
          const state = drag.current
          if (!state || state.pointerId !== event.pointerId) {
            return
          }

          if (!state.held) {
            // しきい値を越えるまでは、ただの押し下げとして扱う。
            if (Math.abs(event.clientX - state.origin) < DRAG_THRESHOLD) {
              return
            }
            state.held = true
            setDraggingId(state.id)
            document.body.style.userSelect = 'none'
          }

          const to = dropIndex(measure(), state.id, event.clientX)
          if (to !== -1) {
            moveTab(state.id, to)
          }
        }

        const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
          const state = drag.current
          if (!state || state.pointerId !== event.pointerId) {
            return
          }
          endDrag(event.currentTarget, event.pointerId)
        }

        /** `⌥←` / `⌥→` で 1 つずつ動かす（ADR 0023）。 */
        const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
          if (!event.altKey || event.metaKey || event.ctrlKey) {
            return
          }
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
            return
          }
          const order = useTabStore.getState().tabs
          const index = order.findIndex((item) => item.id === tab.id)
          const to = index + (event.key === 'ArrowRight' ? 1 : -1)
          if (index === -1 || to < 0 || to >= order.length) {
            return
          }
          event.preventDefault()
          moveTab(tab.id, to)
        }

        return (
          <div
            key={tab.id}
            ref={(element) => {
              if (element) {
                elements.current.set(tab.id, element)
              } else {
                elements.current.delete(tab.id)
              }
            }}
            data-tab-id={tab.id}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onKeyDown}
            className={`flex items-center gap-6px px-11px rounded-7px text-11.5px touch-none ${
              active ? 'bg-panel text-fg' : 'text-fg3'
            } ${dragging ? 'opacity-60' : ''}`}
          >
            {tab.dirty ? (
              <span
                className="w-7px h-7px rounded-full bg-ac shrink-0"
                aria-label="未保存"
                role="img"
              />
            ) : (
              // 印の有無で幅が動かないよう、印が無いときも場所だけは空けておく。
              <span className="w-7px shrink-0" aria-hidden="true" />
            )}
            <button
              type="button"
              onClick={() => selectTab(tab.id)}
              className="bg-transparent border-none p-0 text-inherit font-inherit text-11.5px cursor-pointer"
            >
              {tab.name}
            </button>
            <button
              type="button"
              data-tab-action="close"
              onClick={() => onCloseTab(tab.id)}
              aria-label={`${tab.name} を閉じる`}
              className="flex items-center bg-transparent border-none p-0 text-fg5 font-inherit cursor-pointer"
            >
              <X size={13} />
            </button>
          </div>
        )
      })}
      <button
        type="button"
        onClick={openNewTab}
        aria-label="新しいタブ"
        className="flex items-center px-9px text-fg5 bg-transparent border-none cursor-pointer font-inherit"
      >
        <Plus size={15} />
      </button>
      <div className="flex-1" />
    </div>
  )
}
