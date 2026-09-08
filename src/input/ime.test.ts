import { describe, expect, it, vi } from 'vitest'
import { blockComposingSubmit, isComposingKey } from './ime'

describe('isComposingKey', () => {
  it('React の合成 event は nativeEvent の isComposing を見る', () => {
    // Arrange
    const event = { nativeEvent: { isComposing: true } }

    // Act
    const 変換中 = isComposingKey(event)

    // Assert
    expect(変換中).toBe(true)
  })

  it('React の合成 event で変換していなければ偽を返す', () => {
    // Arrange
    const event = { nativeEvent: { isComposing: false } }

    // Act
    const 変換中 = isComposingKey(event)

    // Assert
    expect(変換中).toBe(false)
  })

  it('DOM の KeyboardEvent は自身の isComposing を見る', () => {
    // Arrange
    const event = new KeyboardEvent('keydown', { key: 'Escape', isComposing: true })

    // Act
    const 変換中 = isComposingKey(event)

    // Assert
    expect(変換中).toBe(true)
  })

  it('DOM の KeyboardEvent で変換していなければ偽を返す', () => {
    // Arrange
    const event = new KeyboardEvent('keydown', { key: 'Escape' })

    // Act
    const 変換中 = isComposingKey(event)

    // Assert
    expect(変換中).toBe(false)
  })

  it('isComposing をどこにも持たない打鍵は変換中でないとみなす', () => {
    // Arrange
    const event = {}

    // Act
    const 変換中 = isComposingKey(event)

    // Assert
    expect(変換中).toBe(false)
  })
})

describe('blockComposingSubmit', () => {
  it('変換中の ⏎ は暗黙の送信を止める', () => {
    // Arrange
    const preventDefault = vi.fn()
    const event = { key: 'Enter', nativeEvent: { isComposing: true }, preventDefault }

    // Act
    blockComposingSubmit(event)

    // Assert
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  it('変換していないときの ⏎ は止めない', () => {
    // Arrange
    const preventDefault = vi.fn()
    const event = { key: 'Enter', nativeEvent: { isComposing: false }, preventDefault }

    // Act
    blockComposingSubmit(event)

    // Assert
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('変換中でも ⏎ 以外の打鍵は止めない', () => {
    // Arrange
    const preventDefault = vi.fn()
    const event = { key: 'a', nativeEvent: { isComposing: true }, preventDefault }

    // Act
    blockComposingSubmit(event)

    // Assert
    expect(preventDefault).not.toHaveBeenCalled()
  })
})
