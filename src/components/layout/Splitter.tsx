/**
 * ペインの境界（区切り）。
 *
 * 縦横どちらにも使える。`orientation` は区切りそのものの向きであり、`vertical`
 * は左右を分ける縦線（幅を変える）、`horizontal` は上下を分ける横線（高さを
 * 変える）を指す。`role="separator"` の `aria-orientation` と同じ意味である。
 *
 * 当たり判定は 6px。親は `gap-6px` で 6px の間隔を空けているため、負の余白で
 * その間隔の中へ重ねて置く。こうすると区切りを足しても隣のペインの間隔は
 * 変わらない。
 *
 * 見た目は端から端までの線ではなく、中央に置いたつまみ（点）である。隣り合う
 * ペインはどちらも `border border-line` を持っており、境目そのものはペインの
 * 縁が示している。区切りが担うのは「ここは掴んで動かせる」ことを見せる役目
 * だけなので、線を引き直さず点だけを置く。点は常に出す（掴めることが触る前に
 * 分からなければ意味がない）。ホバーと焦点では `--ac` へ変わる。
 *
 * ドラッグは `pointerdown` /
 * `pointermove` / `pointerup` と `setPointerCapture` で行う。`mousemove` を
 * `window` に貼るより外れにくく、素早く動かしても掴んだままになる。
 *
 * 値そのものは持たない。呼び出し側が状態を持ち、`onChange` で受け取る。
 */

import { GripHorizontal, GripVertical } from 'lucide-react'
import { useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { clamp } from './paneSizes'

/** 矢印キー 1 回で動く量（px）。 */
export const KEY_STEP = 8
/** `⇧` を押しながらの矢印キー 1 回で動く量（px）。 */
export const KEY_STEP_LARGE = 32

/**
 * つまみの大きさ（px）。
 *
 * lucide の `Grip*` は 24 単位の升目に半径 1 の丸を 2 列 × 3 行で置いたもので、
 * 線幅 2 と合わせて短い辺の絵柄は 10 単位ぶんになる。当たり判定の 6px に収める
 * には 24 単位が 14.4px を超えてはならないため 14 を選んだ。12 まで落とすと
 * 点が 2px を切り、罫線と見分けが付かなくなる。
 */
export const GRIP_SIZE = 14

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
  // 縦の区切りには点を縦に並べたつまみ、横の区切りには横に並べたつまみを置く。
  const Grip = 縦線 ? GripVertical : GripHorizontal

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
      <Grip
        data-splitter-grip={orientation}
        size={GRIP_SIZE}
        /* 絵柄は 6px に収まるが、SVG の枠は 14px あって左右へはみ出す。
           `pointer-events-none` を当てないと、はみ出した枠が押し下げを拾って
           当たり判定が 6px より広がってしまう。 */
        className="pointer-events-none shrink-0 text-fg6 group-hover:text-ac group-focus:text-ac"
      />
    </div>
  )
}
