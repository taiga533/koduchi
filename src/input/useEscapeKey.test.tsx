import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { useEscapeKey } from './useEscapeKey'
import { escapeHandlerCount } from './escapeStack'

/** `esc` を受けるだけの器。焦点は誰にも当てない。 */
function オーバーレイ({ onEscape }: { onEscape: () => void }) {
  useEscapeKey(onEscape)
  return <div>オーバーレイ</div>
}

/** `window` へ `esc` を送る。`init` で変換中などの細工を足せる。 */
function escを打つ(init: Partial<KeyboardEventInit & { keyCode: number }> = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, ...init })
  window.dispatchEvent(event)
  return event
}

describe('useEscapeKey', () => {
  it('焦点がどこにも当たっていなくても esc を受け取る', () => {
    // Arrange
    const 閉じる = vi.fn()
    render(<オーバーレイ onEscape={閉じる} />)
    ;(document.activeElement as HTMLElement | null)?.blur()

    // Act
    escを打つ()

    // Assert
    expect(document.activeElement).toBe(document.body)
    expect(閉じる).toHaveBeenCalledTimes(1)
  })

  it('受け取った esc は既定の動きを止める', () => {
    // Arrange
    render(<オーバーレイ onEscape={() => {}} />)

    // Act
    const event = escを打つ()

    // Assert
    expect(event.defaultPrevented).toBe(true)
  })

  it('esc 以外の打鍵では呼ばれない', () => {
    // Arrange
    const 閉じる = vi.fn()
    render(<オーバーレイ onEscape={閉じる} />)

    // Act
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))

    // Assert
    expect(閉じる).not.toHaveBeenCalled()
  })

  it('変換中の esc では呼ばれない（ADR 0025）', () => {
    // Arrange
    const 閉じる = vi.fn()
    render(<オーバーレイ onEscape={閉じる} />)

    // Act
    escを打つ({ isComposing: true })

    // Assert
    expect(閉じる).not.toHaveBeenCalled()
  })

  it('変換を確定する打鍵（keyCode 229）でも呼ばれない（ADR 0025）', () => {
    // Arrange
    const 閉じる = vi.fn()
    render(<オーバーレイ onEscape={閉じる} />)

    // Act
    escを打つ({ keyCode: 229 })

    // Assert
    expect(閉じる).not.toHaveBeenCalled()
  })

  it('より近い所で処理済みの esc は二重に扱わない', () => {
    // Arrange
    const 閉じる = vi.fn()
    render(<オーバーレイ onEscape={閉じる} />)
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    event.preventDefault()

    // Act
    window.dispatchEvent(event)

    // Assert
    expect(閉じる).not.toHaveBeenCalled()
  })

  it('重なっているときは後から開いたものだけが閉じる', () => {
    // Arrange
    const 下 = vi.fn()
    const 上 = vi.fn()
    render(
      <>
        <オーバーレイ onEscape={下} />
        <オーバーレイ onEscape={上} />
      </>,
    )

    // Act
    escを打つ()

    // Assert
    expect(上).toHaveBeenCalledTimes(1)
    expect(下).not.toHaveBeenCalled()
  })

  it('描画し直しても受け手の順序は入れ替わらない', () => {
    // Arrange
    const 下 = vi.fn()
    const 上 = vi.fn()
    const { rerender } = render(
      <>
        <オーバーレイ onEscape={下} />
        <オーバーレイ onEscape={上} />
      </>,
    )

    // Act
    // 渡す関数の同一性が変わる描画（`() => 下()` は毎回別物）を挟む
    rerender(
      <>
        <オーバーレイ onEscape={() => 下()} />
        <オーバーレイ onEscape={() => 上()} />
      </>,
    )
    escを打つ()

    // Assert
    expect(上).toHaveBeenCalledTimes(1)
    expect(下).not.toHaveBeenCalled()
  })

  it('描画し直した後は新しい関数が呼ばれる', () => {
    // Arrange
    const 古い = vi.fn()
    const 新しい = vi.fn()
    const { rerender } = render(<オーバーレイ onEscape={古い} />)

    // Act
    rerender(<オーバーレイ onEscape={新しい} />)
    escを打つ()

    // Assert
    expect(新しい).toHaveBeenCalledTimes(1)
    expect(古い).not.toHaveBeenCalled()
  })

  it('閉じた後の esc では呼ばれない', () => {
    // Arrange
    const 閉じる = vi.fn()
    const { unmount } = render(<オーバーレイ onEscape={閉じる} />)

    // Act
    unmount()
    escを打つ()

    // Assert
    expect(閉じる).not.toHaveBeenCalled()
    expect(escapeHandlerCount()).toBe(0)
  })
})
