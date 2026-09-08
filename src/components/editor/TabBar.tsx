/**
 * エディタタブの並び（デザイン 3a の 34px 帯）。
 *
 * 並ぶのは SQL タブと定義タブの 2 種類である（ADR 0022）。並びは 1 本であり、
 * 選択・閉じる・並べ替えはどちらも同じに扱う。**定義タブも掴んで動かせる。**
 *
 * 未保存の `●` 印は**名前の左**に置き、閉じるボタンは**常に右に出す**
 * （ADR 0023）。印とボタンを入れ替える作りにすると、未保存のタブが閉じられなく
 * なるうえ、`dirty` を持たないタブが並びに混ざったときに破綻する。定義タブが
 * まさにそれであり、`dirty` は `tabKinds.ts` の `isDirty` 越しに見る。
 *
 * 定義タブには種類の分かるアイコンを名前の左へ添える（ADR 0022）。`●` 印と
 * 同じ側だが、**定義タブは未保存にならない**ため両方が出ることはない。印の場所は
 * 印が無いときも空けてあり、SQL タブと定義タブで名前の左端が揃う。
 *
 * **枚数が増えたときの収め方は 3 段構えである。**
 *
 * 1. タブは `tabSizing.ts` の上限（`TAB_MAX_WIDTH`）で頭打ちにし、はみ出す名前は
 *    `…` で省く。全体は `title` で確かめられる。
 * 2. 帯が足りなくなったらタブを縮める。縮む下限は `TAB_MIN_WIDTH` であり、
 *    `●` 印・種別のアイコン・閉じる `✕` はどこまで縮めても見えたままになる。
 * 3. 下限まで縮めても収まらない枚数では、タブの並びだけを横へスクロールさせる
 *    （`[data-tab-scroller]`）。**`＋` ボタンはその外側に置く**ので、何枚開いても
 *    流されない。選んだタブが帯の外に居るときは `tabScroll.ts` の `revealOffset`
 *    で見える位置まで送る。
 *
 * 並べ替えは Pointer Events で行う。`Splitter` と同じく `setPointerCapture` を
 * 使い、`mousemove` を `window` に貼らない。落とす位置の計算は `tabOrder.ts` の
 * 純粋な関数に寄せてある。**スクロールしても `dropIndex` はそのままでよい**
 * （理由は `tabScroll.ts` の冒頭）。掴んだまま端まで持っていったときは
 * `autoScrollStep` の量で帯を送り、送れたぶんだけ落とす位置を計算し直す。
 * **ドラッグ中は選択の追従を止める。**掴んで動かしている最中に帯が別の都合で
 * 動くと、指とタブがずれる。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { Plus, TableProperties, X } from 'lucide-react'
import { useTabStore } from '../../stores/tab'
import { isDefinitionTab, isDirty } from '../../stores/tabKinds'
import { DRAG_THRESHOLD, dropIndex } from './tabOrder'
import type { TabRect } from './tabOrder'
import { autoScrollStep, revealOffset } from './tabScroll'
import { TAB_MAX_WIDTH, TAB_MIN_WIDTH } from './tabSizing'

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
  /** 直近のポインタの横位置（`clientX`）。端でのスクロールが見に来る。 */
  pointerX: number
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
  /** タブの並びだけを収める、横へスクロールする器。 */
  const scroller = useRef<HTMLDivElement | null>(null)
  /** 端でのスクロールを回している間だけ入る、次のフレームの識別子。 */
  const frame = useRef<number | null>(null)
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

  /**
   * 今のポインタ位置から落とす位置を決め、並びを動かす。
   *
   * @param id 掴んでいるタブの ID
   * @param pointerX ポインタの横位置（`clientX`）
   */
  const applyDrop = useCallback(
    (id: string, pointerX: number) => {
      const to = dropIndex(measure(), id, pointerX)
      if (to !== -1) {
        moveTab(id, to)
      }
    },
    [measure, moveTab],
  )

  /** 端でのスクロールを止める。 */
  const stopAutoScroll = useCallback(() => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current)
      frame.current = null
    }
  }, [])

  /**
   * 端でのスクロールを始める。既に回っていれば何もしない。
   *
   * 1 フレームごとに `autoScrollStep` の量だけ帯を送り、送れたぶんだけ落とす
   * 位置を計算し直す。端から離れたとき・これ以上送れないとき・ドラッグが
   * 終わったときに自分で止まる。ポインタが止まっていても帯は動き続けるため、
   * 次のフレームは中で予約する。
   */
  const startAutoScroll = useCallback(() => {
    /** 1 フレームぶん進める。自分を呼び直すので関数宣言で書く。 */
    function step(): void {
      frame.current = null
      const element = scroller.current
      const state = drag.current
      if (!element || !state || !state.held) {
        return
      }

      const viewport = element.getBoundingClientRect()
      const 送り = autoScrollStep(viewport.left, viewport.right, state.pointerX)
      if (送り === 0) {
        return
      }

      const before = element.scrollLeft
      element.scrollLeft = before + 送り
      if (element.scrollLeft === before) {
        // 端まで送りきった。これ以上回しても何も起きない。
        return
      }

      applyDrop(state.id, state.pointerX)
      frame.current = requestAnimationFrame(step)
    }

    if (frame.current === null) {
      frame.current = requestAnimationFrame(step)
    }
  }, [applyDrop])

  /** ドラッグを終える。指を離したときと、途中で取り消されたときの両方で呼ぶ。 */
  const endDrag = useCallback(
    (element: Element, pointerId: number) => {
      drag.current = null
      stopAutoScroll()
      releasePointer(element, pointerId)
      document.body.style.userSelect = ''
      setDraggingId(null)
    },
    [stopAutoScroll],
  )

  // 描かれないまま外れたときにフレームを残さない。
  useEffect(() => stopAutoScroll, [stopAutoScroll])

  /**
   * 選んだタブが帯の外に居たら、見える位置まで送る。
   *
   * `⌘K` のパレットや `⌘T` で選択が飛んだとき、そのタブが帯の外に居ることが
   * 起こる。**ドラッグ中は追わない**（掴んでいる指とタブがずれる）。掴み終えた
   * 時点で `draggingId` が戻り、動かしたタブが改めて見える位置へ来る。
   *
   * 祖先まで動かしてしまう `scrollIntoView` は使わず、帯の送り量だけを書く。
   *
   * 並びが変わっただけでは追わない。並べ替えは掴んでいる間の出来事であり、
   * 掴み終えた時点の `draggingId` の戻りが同じ仕事をする。タブの開閉も
   * `activeTabId` が動くので、ここから漏れるのは「名前が変わって幅が変わった」
   * ときだけである。
   */
  useEffect(() => {
    if (draggingId !== null) {
      return
    }
    const element = scroller.current
    const tab = activeTabId === null ? undefined : elements.current.get(activeTabId)
    if (!element || !tab) {
      return
    }

    const viewport = element.getBoundingClientRect()
    const rect = tab.getBoundingClientRect()
    // 帯の中身の左端を 0 とした位置に直す。
    const left = rect.left - viewport.left + element.scrollLeft
    const next = revealOffset(element.scrollLeft, viewport.width, left, rect.width)
    if (next !== element.scrollLeft) {
      element.scrollLeft = next
    }
  }, [activeTabId, draggingId])

  return (
    <div className="h-34px flex items-stretch gap-4px bg-bg shrink-0 min-w-0">
      <div
        ref={scroller}
        data-tab-scroller=""
        /* `tab-scroller` は水平スクロールバーを隠すためだけの決まり（`app.css`）。
           34px の帯にバーの居場所は無い。 */
        className="tab-scroller flex items-stretch gap-4px min-w-0 overflow-x-auto overflow-y-hidden"
      >
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
              pointerX: event.clientX,
            }
            capturePointer(event.currentTarget, event.pointerId)
          }

          const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
            const state = drag.current
            if (!state || state.pointerId !== event.pointerId) {
              return
            }
            state.pointerX = event.clientX

            if (!state.held) {
              // しきい値を越えるまでは、ただの押し下げとして扱う。
              if (Math.abs(event.clientX - state.origin) < DRAG_THRESHOLD) {
                return
              }
              state.held = true
              setDraggingId(state.id)
              document.body.style.userSelect = 'none'
            }

            applyDrop(state.id, event.clientX)
            // 端に居るなら帯を送る。既に回っていれば何もしない。
            startAutoScroll()
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
              // 名前を省いても、指を乗せれば全体が読める。
              title={tab.name}
              style={{ minWidth: `${TAB_MIN_WIDTH}px`, maxWidth: `${TAB_MAX_WIDTH}px` }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onKeyDown={onKeyDown}
              className={`flex items-center gap-6px px-11px rounded-7px text-11.5px touch-none ${
                active ? 'bg-panel text-fg' : 'text-fg3'
              } ${dragging ? 'opacity-60' : ''}`}
            >
              {isDirty(tab) ? (
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
                aria-label={isDefinitionTab(tab) ? `${tab.name} の定義` : undefined}
                className="flex items-center gap-5px min-w-0 bg-transparent border-none p-0 text-inherit font-inherit text-11.5px cursor-pointer"
              >
                {/* 定義タブの目印（ADR 0022）。名前だけでは SQL タブと見分けにくい。 */}
                {isDefinitionTab(tab) ? (
                  <TableProperties size={12} className="text-fg5 shrink-0" aria-hidden />
                ) : null}
                {/* 縮んだぶんは `…` で省く。省いた名前は器の `title` で読める。 */}
                <span className="truncate">{tab.name}</span>
              </button>
              <button
                type="button"
                data-tab-action="close"
                onClick={() => onCloseTab(tab.id)}
                aria-label={`${tab.name} を閉じる`}
                className="flex items-center bg-transparent border-none p-0 text-fg5 font-inherit cursor-pointer"
              >
                <X size={13} className="shrink-0" />
              </button>
            </div>
          )
        })}
      </div>
      {/* スクロールする器の外に置く。何枚開いても流されない。 */}
      <button
        type="button"
        onClick={openNewTab}
        aria-label="新しいタブ"
        className="flex items-center px-9px shrink-0 text-fg5 bg-transparent border-none cursor-pointer font-inherit"
      >
        <Plus size={15} />
      </button>
      <div className="flex-1" />
    </div>
  )
}
