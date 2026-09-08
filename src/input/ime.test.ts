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

describe('本物の IME で変換を確定した ⏎（keyCode 229）', () => {
  it('isComposing が偽でも keyCode が 229 なら変換中と見なす', () => {
    // Arrange: 実機の Kotoeri で観測した組み合わせ（ADR 0025 の測り直し）
    const event = { key: 'Enter', nativeEvent: { isComposing: false, keyCode: 229 } }

    // Act
    const 結果 = isComposingKey(event)

    // Assert
    expect(結果).toBe(true)
  })

  it('window の listener が受ける DOM の event でも keyCode 229 を見る', () => {
    // Arrange
    const event = { key: 'Enter', isComposing: false, keyCode: 229 }

    // Act
    const 結果 = isComposingKey(event)

    // Assert
    expect(結果).toBe(true)
  })

  it('変換の途中の打鍵は今までどおり isComposing で見分ける', () => {
    // Arrange: 候補を選んでいる間は isComposing が真で本来の keyCode が来る
    const event = { key: 'ArrowDown', nativeEvent: { isComposing: true, keyCode: 40 } }

    // Act
    const 結果 = isComposingKey(event)

    // Assert
    expect(結果).toBe(true)
  })

  it('変換していないときの ⏎ は keyCode が 13 で、変換中と見なさない', () => {
    // Arrange
    const event = { key: 'Enter', nativeEvent: { isComposing: false, keyCode: 13 } }

    // Act
    const 結果 = isComposingKey(event)

    // Assert
    expect(結果).toBe(false)
  })

  it('変換確定の ⏎ では <form> の暗黙の送信を止める', () => {
    // Arrange
    let 止めた = false
    const event = {
      key: 'Enter',
      nativeEvent: { isComposing: false, keyCode: 229 },
      preventDefault: () => (止めた = true),
    }

    // Act
    blockComposingSubmit(event)

    // Assert
    expect(止めた).toBe(true)
  })
})
