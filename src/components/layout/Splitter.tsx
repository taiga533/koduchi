/**
 * ペインの境界（区切り）。
 *
 * 縦横どちらにも使える。`orientation` は区切りそのものの向きであり、`vertical`
 * は左右を分ける縦線（幅を変える）、`horizontal` は上下を分ける横線（高さを
 * 変える）を指す。`role="separator"` の `aria-orientation` と同じ意味である。
 *
 * 当たり判定は 6px、見た目の線は 1px。親は `gap-6px` で 6px の間隔を空けている
 * ため、負の余白でその間隔の中へ重ねて置く。こうすると区切りを足しても隣の
 * ペインの間隔は変わらない。
 *
 * ドラッグは `pointerdown` /
 * `pointermove` / `pointerup` と `setPointerCapture` で行う。`mousemove` を
 * `window` に貼るより外れにくく、素早く動かしても掴んだままになる。
 *
 * 値そのものは持たない。呼び出し側が状態を持ち、`onChange` で受け取る。
 */

import { useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { clamp } from './paneSizes'

/** 矢印キー 1 回で動く量（px）。 */
export const KEY_STEP = 8
/** `⇧` を押しながらの矢印キー 1 回で動く量（px）。 */
export const KEY_STEP_LARGE = 32

/** 区切りの向き。 */
export type SplitterOrientation = 'vertical' | 'horizontal'

interface SplitterProps {
  /** 区切りの向き。`vertical` は縦線で幅を、`horizontal` は横線で高さを変える。 */
  orientation: SplitterOrientation
  /** 現在の寸法（px）。 */
  value: number
  /** 寸法の下限（px）。 */
  min: number
  /** 寸法の上限（px）。 */
  max: number
  /** ダブルクリックで戻す既定値（px）。 */
  defaultValue: number
  /** 寸法が変わったときに呼ばれる。値は下限と上限へ丸めてある。 */
  onChange: (value: number) => void
  /** 支援技術へ渡す名前。 */
  label: string
}

/** ドラッグ中に覚えておくこと。 */
interface DragState {
  pointerId: number
  /** 掴んだ位置（px）。縦線なら `clientX`、横線なら `clientY`。 */
  origin: number
  /** 掴んだ時点の寸法（px）。 */
  start: number
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

export function Splitter({
  orientation,
  value,
  min,
  max,
  defaultValue,
  onChange,
  label,
}: SplitterProps) {
  const drag = useRef<DragState | null>(null)
  const 縦線 = orientation === 'vertical'

  /** ドラッグを始める。掴んだ位置と寸法を覚え、以後の移動を差分で見る。 */
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }
    drag.current = {
      pointerId: event.pointerId,
      origin: 縦線 ? event.clientX : event.clientY,
      start: value,
    }
    capturePointer(event.currentTarget, event.pointerId)
    // ドラッグ中に隣のペインの文字が選択されるのを止める。
    document.body.style.userSelect = 'none'
    event.preventDefault()
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) {
      return
    }
    const 移動量 = (縦線 ? event.clientX : event.clientY) - state.origin
    onChange(clamp(state.start + 移動量, min, max))
  }

  /** ドラッグを終える。指を離したときと、途中で取り消されたときの両方で呼ぶ。 */
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) {
      return
    }
    drag.current = null
    releasePointer(event.currentTarget, event.pointerId)
    document.body.style.userSelect = ''
  }

  /** 矢印キーで動かす。`⇧` を押していれば大きく動く。 */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const 増やす = 縦線 ? 'ArrowRight' : 'ArrowDown'
    const 減らす = 縦線 ? 'ArrowLeft' : 'ArrowUp'
    if (event.key !== 増やす && event.key !== 減らす) {
      return
    }
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP
    const 向き = event.key === 増やす ? 1 : -1
    event.preventDefault()
    onChange(clamp(value + 向き * step, min, max))
  }

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => onChange(defaultValue)}
      onKeyDown={onKeyDown}
      className={`group shrink-0 flex items-center justify-center outline-none touch-none ${
        縦線 ? 'w-6px -mx-6px cursor-col-resize' : 'h-6px -my-6px cursor-row-resize'
      }`}
    >
      <span
        aria-hidden="true"
        className={`bg-line group-hover:bg-ac group-focus:bg-ac ${
          縦線 ? 'w-1px h-full' : 'h-1px w-full'
        }`}
      />
    </div>
  )
}
