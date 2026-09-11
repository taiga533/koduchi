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
 * **名前の付け直し（ADR 0032）はタブの名前をダブルクリックして始める。**掴みと
 * 食い合わないのは、並べ替えが「4px 動かすまでは掴んだと見なさない」という
 * しきい値を初めから持っている（`tabOrder.ts` の `DRAG_THRESHOLD`）からである。
 * ダブルクリックは動かない打鍵なので `held` に届かず、`event.detail` を見て
 * 打ち消すような細工は要らない。編集中のタブは掴まない（入力欄の中で文字を
 * 選ぼうとして並びが動くのを防ぐ）。**定義タブの名前は変えられない**
 * （`tabNaming.ts` の `canRenameTab`）。
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
import { isComposingKey } from '../../input/ime'
import { canRenameTab, normalizeTabName, tabDisplayName, tabTitle } from './tabNaming'
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

interface TabNameInputProps {
  /** 編集を始めたときの名前。今タブ帯に出ている名前である。 */
  initial: string
  /**
   * 名前が決まった。`null` は「自動の名前へ戻す」である（ADR 0032）。
   *
   * 空文字も空白だけも `null` になる。取り消しのための別の入口を作らずに、
   * 付け直しを元へ戻せるようにするための決まりである。
   */
  onCommit: (name: string | null) => void
  /** `esc`。打ち込んだものを捨てて元の名前のままにする。 */
  onCancel: () => void
}

/**
 * タブの名前を打ち直す欄（ADR 0032）。
 *
 * 名前の場所にそのまま重ねる。`●` 印も閉じるボタンも出したままなので、
 * `tabSizing.ts` が数えている固定部分の幅は変わらない。**タブは編集中も
 * 広がらない。**
 *
 * 焦点が外れたときは**確定する**。打ち込んだ文字を、うっかり別の場所を押した
 * だけで捨てるのは失うものが大きい。取り消したいときは `esc` がある。
 */
function TabNameInput({ initial, onCommit, onCancel }: TabNameInputProps) {
  const [draft, setDraft] = useState(initial)
  /** 確定を 2 度走らせない。`⏎` で確定すると、外れる焦点が `blur` も呼ぶ。 */
  const done = useRef(false)

  /** 打ち込まれたものを確定する。 */
  const 確定する = (): void => {
    if (done.current) {
      return
    }
    done.current = true
    onCommit(normalizeTabName(draft))
  }

  return (
    <input
      autoFocus
      // ここから始めた押し下げでタブを掴まない（ADR 0023 の `data-tab-action`）。
      data-tab-action="rename"
      value={draft}
      aria-label="タブの名前"
      // 既定の欄幅（`size` の 20 文字ぶん）に器を押し広げさせない。
      size={1}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={確定する}
      onKeyDown={(event) => {
        // 変換中の `⏎` は変換の確定、`esc` は変換の取り消しである（ADR 0025）。
        if (isComposingKey(event)) {
          return
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          確定する()
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          done.current = true
          onCancel()
        }
      }}
      className="flex-1 min-w-0 w-full px-4px py-1px rounded-4px bg-bg border border-line text-11.5px text-fg font-inherit"
    />
  )
}

export function TabBar({ onCloseTab }: TabBarProps) {
  const tabs = useTabStore((state) => state.tabs)
  const activeTabId = useTabStore((state) => state.activeTabId)
  const selectTab = useTabStore((state) => state.selectTab)
  const moveTab = useTabStore((state) => state.moveTab)
  const openNewTab = useTabStore((state) => state.openNewTab)
  const renameTab = useTabStore((state) => state.renameTab)

  const drag = useRef<DragState | null>(null)
  /** タブの ID から描かれている要素を引く。横位置を実測するために持つ。 */
  const elements = useRef(new Map<string, HTMLElement>())
  /** タブの並びだけを収める、横へスクロールする器。 */
  const scroller = useRef<HTMLDivElement | null>(null)
  /** 端でのスクロールを回している間だけ入る、次のフレームの識別子。 */
  const frame = useRef<number | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  /** 名前を付け直しているタブの ID（ADR 0032）。編集していなければ `null`。 */
  const [editingId, setEditingId] = useState<string | null>(null)

  /**
   * 名前の付け直しを始める（ADR 0032）。
   *
   * 定義タブでは何も起きない。名前がオブジェクトの同一性そのものだからである
   * （`tabNaming.ts` の `canRenameTab`）。
   */
  const startRename = useCallback((id: string) => {
    const tab = useTabStore.getState().tabs.find((item) => item.id === id)
    if (tab && canRenameTab(tab)) {
      setEditingId(id)
    }
  }, [])

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
          const editing = tab.id === editingId
          const display = tabDisplayName(tab)

          /**
           * 掴む。閉じるボタンの上から始めたときは掴まない。
           *
           * 押し下げた時点でそのタブを選ぶ。並べ替えたタブが選ばれていないと、
           * どれを動かしたのかが分からなくなる。
           *
           * **名前を付け直している間も掴まない**（ADR 0032）。入力欄の中で文字を
           * 選ぼうと押したまま動かすと、しきい値を越えて並びが動いてしまう。
           */
          const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
            if (event.button !== 0) {
              return
            }
            if (editing) {
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

          /**
           * タブ帯の中でだけ効く打鍵。
           *
           * `⌥←` / `⌥→` で 1 つずつ動かし（ADR 0023）、`F2` で名前を付け直す
           * （ADR 0032）。どちらもタブ帯の外では意味を持たないため、`App.tsx`
           * ではなくここに置く（`CLAUDE.md` の「キーバインドの置き場所」）。
           *
           * **名前を付け直している間は、ここの打鍵を一切効かせない。**入力欄は
           * この器の中に描かれるため、打った打鍵はそのまま上がってくる。
           * **macOS では `⌥←` / `⌥→` は入力欄の単語単位のカーソル移動である。**
           * 名前の途中で単語の頭へ戻ろうとした `⌥←` でタブが左隣と入れ替わっては
           * ならない。`onPointerDown` の `editing` の関所と 1 対 1 で並ぶ。
           */
          const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
            // 変換中の打鍵は IME のものである（ADR 0025）。
            if (isComposingKey(event)) {
              return
            }
            if (editing) {
              return
            }
            if (
              event.key === 'F2' &&
              !event.metaKey &&
              !event.ctrlKey &&
              !event.altKey &&
              !event.shiftKey
            ) {
              event.preventDefault()
              startRename(tab.id)
              return
            }
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
              // 名前を省いても、指を乗せれば全体が読める。付け直した名前が自動の
              // 名前を覆っているときは、隠れたほうもここに出る（ADR 0032）。
              title={tabTitle(tab)}
              style={{ minWidth: `${TAB_MIN_WIDTH}px`, maxWidth: `${TAB_MAX_WIDTH}px` }}
              onDoubleClick={(event) => {
                // 閉じるボタンを続けて押したときに編集へ入らない。
                if ((event.target as HTMLElement).closest('[data-tab-action]')) {
                  return
                }
                startRename(tab.id)
              }}
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
              {editing ? (
                <TabNameInput
                  initial={display}
                  onCommit={(name) => {
                    renameTab(tab.id, name)
                    setEditingId(null)
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => selectTab(tab.id)}
                  aria-label={isDefinitionTab(tab) ? `${display} の定義` : undefined}
                  className="flex items-center gap-5px min-w-0 bg-transparent border-none p-0 text-inherit font-inherit text-11.5px cursor-pointer"
                >
                  {/* 定義タブの目印（ADR 0022）。名前だけでは SQL タブと見分けにくい。 */}
                  {isDefinitionTab(tab) ? (
                    <TableProperties size={12} className="text-fg5 shrink-0" aria-hidden />
                  ) : null}
                  {/* 縮んだぶんは `…` で省く。省いた名前は器の `title` で読める。 */}
                  <span className="truncate">{display}</span>
                </button>
              )}
              <button
                type="button"
                data-tab-action="close"
                onClick={() => onCloseTab(tab.id)}
                aria-label={`${display} を閉じる`}
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
