import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { GRIP_SIZE, Splitter } from './Splitter'
import type { SplitterOrientation } from './Splitter'

/**
 * 寸法を自分で持つ試験用の包み。
 *
 * `Splitter` は値を持たないため、実際の使われ方に合わせて呼び出し側で持たせる。
 */
function 寸法を持つ区切り({
  orientation,
  initial,
  min = 100,
  max = 400,
  defaultValue = 240,
}: {
  orientation: SplitterOrientation
  initial: number
  min?: number
  max?: number
  defaultValue?: number
}) {
  const [value, setValue] = useState(initial)
  return (
    <Splitter
      orientation={orientation}
      label="サイドバーの幅"
      value={value}
      min={min}
      max={max}
      defaultValue={defaultValue}
      onChange={setValue}
    />
  )
}

/** 区切りの中に描かれたつまみ（点）を取り出す。 */
function つまみ(区切り: HTMLElement): SVGSVGElement | null {
  return 区切り.querySelector<SVGSVGElement>('svg[data-splitter-grip]')
}

/** 区切りを掴んで動かし、離す。 */
function ドラッグする(
  区切り: HTMLElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  fireEvent.pointerDown(区切り, { pointerId: 1, button: 0, clientX: from.x, clientY: from.y })
  fireEvent.pointerMove(区切り, { pointerId: 1, clientX: to.x, clientY: to.y })
  fireEvent.pointerUp(区切り, { pointerId: 1, clientX: to.x, clientY: to.y })
}

describe('Splitter', () => {
  it('縦の区切りは幅の分離子として読み上げられる', () => {
    // Arrange
    render(<寸法を持つ区切り orientation="vertical" initial={240} />)

    // Act
    const 区切り = screen.getByRole('separator', { name: 'サイドバーの幅' })

    // Assert
    expect(区切り).toHaveAttribute('aria-orientation', 'vertical')
    expect(区切り).toHaveAttribute('aria-valuenow', '240')
    expect(区切り).toHaveAttribute('aria-valuemin', '100')
    expect(区切り).toHaveAttribute('aria-valuemax', '400')
  })

  it('横の区切りは高さの分離子として読み上げられる', () => {
    // Arrange
    render(<寸法を持つ区切り orientation="horizontal" initial={268} />)

    // Act
    const 区切り = screen.getByRole('separator')

    // Assert
    expect(区切り).toHaveAttribute('aria-orientation', 'horizontal')
  })

  it('縦の区切りを右へドラッグすると幅が増える', () => {
    // Arrange
    render(<寸法を持つ区切り orientation="vertical" initial={240} />)
    const 区切り = screen.getByRole('separator')

    // Act
    ドラッグする(区切り, { x: 240, y: 0 }, { x: 300, y: 0 })

    // Assert
    expect(区切り).toHaveAttribute('aria-valuenow', '300')
  })

  it('縦の区切りは横の動きだけを見る', () => {
    // Arrange
    render(<寸法を持つ区切り orientation="vertical" initial={240} />)
    const 区切り = screen.getByRole('separator')

    // Act
    ドラッグする(区切り, { x: 240, y: 0 }, { x: 240, y: 120 })

    // Assert
    expect(区切り).toHaveAttribute('aria-valuenow', '240')
  })

  it('横の区切りを下へドラッグすると高さが増える', () => {
    // Arrange
    render(<寸法を持つ区切り orientation="horizontal" initial={268} min={120} max={600} />)
    const 区切り = screen.getByRole('separator')

    // Act
    ドラッグする(区切り, { x: 0, y: 268 }, { x: 0, y: 320 })

    // Assert
    expect(区切り).toHaveAttribute('aria-valuenow', '320')
  })

  it('ドラッグしても下限より小さくはならない', () => {
    // Arrange
    render(<寸法を持つ区切り orientation="vertical" initial={240} />)
    const 区切り = screen.getByRole('separator')

    // Act
    ドラッグする(区切り, { x: 240, y: 0 }, { x: 0, y: 0 })

    // Assert
    expect(区切り).toHaveAttribute('aria-valuenow', '100')
  })

  it('ドラッグしても上限より大きくはならない', () => {
    // Arrange
    render(<寸法を持つ区切り orientation="vertical" initial={240} />)
    const 区切り = screen.getByRole('separator')

    // Act
    ドラッグする(区切り, { x: 240, y: 0 }, { x: 900, y: 0 })

    // Assert
    expect(区切り).toHaveAttribute('aria-valuenow', '400')
  })

  it('離した後の動きは寸法を変えない', () => {
    // Arrange
    render(<寸法を持つ区切り orientation="vertical" initial={240} />)
    const 区切り = screen.getByRole('separator')
    ドラッグする(区切り, { x: 240, y: 0 }, { x: 300, y: 0 })

    // Act
    fireEvent.pointerMove(区切り, { pointerId: 1, clientX: 380, clientY: 0 })

    // Assert
    expect(区切り).toHaveAttribute('aria-valuenow', '300')
  })

  it('ドラッグ中は本文の選択が止まり、離すと戻る', () => {
    // Arrange
    render(<寸法を持つ区切り orientation="vertical" initial={240} />)
    const 区切り = screen.getByRole('separator')

    // Act
    fireEvent.pointerDown(区切り, { pointerId: 1, button: 0, clientX: 240, clientY: 0 })
    const ドラッグ中 = document.body.style.userSelect
    fireEvent.pointerUp(区切り, { pointerId: 1, clientX: 240, clientY: 0 })

    // Assert
    expect(ドラッグ中).toBe('none')
    expect(document.body.style.userSelect).toBe('')
  })

  it('矢印キーで 8px ずつ動く', () => {
    // Arrange
    render(<寸法を持つ区切り orientation="vertical" initial={240} />)
    const 区切り = screen.getByRole('separator')

    // Act
    fireEvent.keyDown(区切り, { key: 'ArrowRight' })

    // Assert
    expect(区切り).toHaveAttribute('aria-valuenow', '248')
  })

  it('⇧ と矢印キーで 32px ずつ動く', () => {
    // Arrange
    render(<寸法を持つ区切り orientation="vertical" initial={240} />)
    const 区切り = screen.getByRole('separator')

    // Act
    fireEvent.keyDown(区切り, { key: 'ArrowLeft', shiftKey: true })

    // Assert
    expect(区切り).toHaveAttribute('aria-valuenow', '208')
  })

  it('横の区切りは上下の矢印キーで動く', () => {
    // Arrange
    render(<寸法を持つ区切り orientation="horizontal" initial={268} min={120} max={600} />)
    const 区切り = screen.getByRole('separator')

    // Act
    fireEvent.keyDown(区切り, { key: 'ArrowDown' })

    // Assert
    expect(区切り).toHaveAttribute('aria-valuenow', '276')
  })

  it('向きに合わない矢印キーでは動かない', () => {
    // Arrange
    render(<寸法を持つ区切り orientation="vertical" initial={240} />)
    const 区切り = screen.getByRole('separator')

    // Act
    fireEvent.keyDown(区切り, { key: 'ArrowDown' })

    // Assert
    expect(区切り).toHaveAttribute('aria-valuenow', '240')
  })

  it('ダブルクリックで既定値へ戻る', () => {
    // Arrange
    render(<寸法を持つ区切り orientation="vertical" initial={380} defaultValue={240} />)
    const 区切り = screen.getByRole('separator')

    // Act
    fireEvent.doubleClick(区切り)

    // Assert
    expect(区切り).toHaveAttribute('aria-valuenow', '240')
  })

  it('縦の区切りは点を縦に並べたつまみを描く', () => {
    // Arrange
    render(<寸法を持つ区切り orientation="vertical" initial={240} />)

    // Act
    const 描かれたつまみ = つまみ(screen.getByRole('separator'))

    // Assert
    expect(描かれたつまみ).not.toBeNull()
    expect(描かれたつまみ).toHaveAttribute('data-splitter-grip', 'vertical')
    expect(描かれたつまみ?.classList.contains('lucide-grip-vertical')).toBe(true)
  })

  it('横の区切りは点を横に並べたつまみを描く', () => {
    // Arrange
    render(<寸法を持つ区切り orientation="horizontal" initial={268} min={120} max={600} />)

    // Act
    const 描かれたつまみ = つまみ(screen.getByRole('separator'))

    // Assert
    expect(描かれたつまみ).toHaveAttribute('data-splitter-grip', 'horizontal')
    expect(描かれたつまみ?.classList.contains('lucide-grip-horizontal')).toBe(true)
  })

  it('つまみは点だけを描き、端から端までの線は引かない', () => {
    // Arrange
    render(<寸法を持つ区切り orientation="vertical" initial={240} />)
    const 区切り = screen.getByRole('separator')

    // Act
    const 描かれたつまみ = つまみ(区切り)

    // Assert: 中身は丸だけであり、線の要素も 1px の帯も無い
    expect([...(描かれたつまみ?.children ?? [])].map((要素) => 要素.tagName)).toEqual(
      Array.from({ length: 6 }, () => 'circle'),
    )
    expect(区切り.querySelector('span')).toBeNull()
  })

  it('つまみは当たり判定の 6px に収まる大きさで描かれる', () => {
    // Arrange
    render(<寸法を持つ区切り orientation="vertical" initial={240} />)

    // Act
    const 描かれたつまみ = つまみ(screen.getByRole('separator'))

    // Assert: lucide の 24 単位の升目のうち絵柄は短い辺で 10 単位ぶんを占める
    expect(描かれたつまみ).toHaveAttribute('width', String(GRIP_SIZE))
    expect((GRIP_SIZE * 10) / 24).toBeLessThanOrEqual(6)
  })

  it('つまみは常に出ており、ホバーと焦点でアクセント色へ変わる', () => {
    // Arrange
    render(<寸法を持つ区切り orientation="vertical" initial={240} />)

    // Act
    const つまみのクラス = つまみ(screen.getByRole('separator'))?.getAttribute('class') ?? ''

    // Assert: 既定の色を持ったまま、ホバーと焦点でだけアクセントへ切り替わる
    expect(つまみのクラス).toContain('text-fg6')
    expect(つまみのクラス).toContain('group-hover:text-ac')
    expect(つまみのクラス).toContain('group-focus:text-ac')
  })

  it('つまみは押し下げを拾わず、当たり判定を広げない', () => {
    // Arrange
    render(<寸法を持つ区切り orientation="vertical" initial={240} />)

    // Act
    const つまみのクラス = つまみ(screen.getByRole('separator'))?.getAttribute('class') ?? ''

    // Assert: SVG の枠は 6px より広いため、はみ出した枠が掴めてはならない
    expect(つまみのクラス).toContain('pointer-events-none')
  })

  it('左ボタン以外ではドラッグを始めない', () => {
    // Arrange
    const onChange = vi.fn()
    render(
      <Splitter
        orientation="vertical"
        label="サイドバーの幅"
        value={240}
        min={100}
        max={400}
        defaultValue={240}
        onChange={onChange}
      />,
    )
    const 区切り = screen.getByRole('separator')

    // Act
    fireEvent.pointerDown(区切り, { pointerId: 1, button: 2, clientX: 240, clientY: 0 })
    fireEvent.pointerMove(区切り, { pointerId: 1, clientX: 300, clientY: 0 })

    // Assert
    expect(onChange).not.toHaveBeenCalled()
  })
})
