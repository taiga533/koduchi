import { describe, expect, it } from 'vitest'
import type { KeyPress } from './chord'
import {
  chordFromPress,
  formatChord,
  hasModifierOrFunctionKey,
  keyNameOf,
  matchesChord,
  parseChord,
  sameChord,
  serializeChord,
} from './chord'

/**
 * 打鍵を作る。
 *
 * @param key `event.key`
 * @param code `event.code`
 * @param modifiers 押している修飾
 */
function 打鍵(key: string, code: string, modifiers: Partial<KeyPress> = {}): KeyPress {
  return {
    key,
    code,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
  }
}

describe('parseChord', () => {
  it('修飾とキーを読み、書いていない修飾は持たない', () => {
    // Arrange
    const text = 'cmd+shift+p'

    // Act
    const chord = parseChord(text)

    // Assert
    expect(chord).toEqual({ key: 'p', meta: true, shift: true })
  })

  it('修飾の順と大文字小文字を問わず、VSCode の別名も受ける', () => {
    // Arrange
    const text = ' Shift+Option+META+Enter '

    // Act
    const chord = parseChord(text)

    // Assert
    expect(chord).toEqual({ key: 'enter', meta: true, alt: true, shift: true })
  })

  it.each(['', 'cmd+', 'cmd++', 'hyper+k', 'cmd+enterr', 'cmd+ab', 'f21'])(
    '%s は読めない',
    (text) => {
      // Arrange & Act
      const chord = parseChord(text)

      // Assert
      expect(chord).toBeNull()
    },
  )

  it('ファンクションキーは修飾なしでも読める', () => {
    // Arrange & Act
    const chord = parseChord('f5')

    // Assert
    expect(chord).toEqual({ key: 'f5' })
  })
})

describe('serializeChord', () => {
  it('修飾を ctrl alt shift cmd の順に並べ、読み戻すと同じになる', () => {
    // Arrange
    const chord = { key: 'e', meta: true, shift: true, ctrl: true }

    // Act
    const text = serializeChord(chord)

    // Assert
    expect(text).toBe('ctrl+shift+cmd+e')
    expect(sameChord(parseChord(text)!, chord)).toBe(true)
  })
})

describe('formatChord', () => {
  it('修飾を ⌃⌥⇧⌘ の順に並べ、キーを大文字にする', () => {
    // Arrange
    const chord = { key: 'n', ctrl: true, alt: true, shift: true, meta: true }

    // Act
    const label = formatChord(chord)

    // Assert
    expect(label).toBe('⌃⌥⇧⌘N')
  })

  it.each([
    [{ key: 'enter', meta: true }, '⌘⏎'],
    [{ key: '.', meta: true }, '⌘.'],
    [{ key: 'f5' }, 'F5'],
    [{ key: 'left', alt: true }, '⌥←'],
  ])('%o は %s と書く', (chord, expected) => {
    // Arrange & Act
    const label = formatChord(chord)

    // Assert
    expect(label).toBe(expected)
  })
})

describe('keyNameOf', () => {
  it('⌥ で化けた英字は物理のキーから読む', () => {
    // Arrange: macOS の ⇧⌥F は Ï になる（ADR 0024）
    const press = 打鍵('Ï', 'KeyF', { altKey: true, shiftKey: true })

    // Act
    const key = keyNameOf(press)

    // Assert
    expect(key).toBe('f')
  })

  it('⌥ で化けた記号も物理のキーから読む', () => {
    // Arrange
    const press = 打鍵('≥', 'Period', { altKey: true, metaKey: true })

    // Act
    const key = keyNameOf(press)

    // Assert
    expect(key).toBe('.')
  })

  it('⌥ が無ければ文字を先に見る', () => {
    // Arrange: Dvorak では S の文字が別の物理キーにある
    const press = 打鍵('s', 'Semicolon', { metaKey: true })

    // Act
    const key = keyNameOf(press)

    // Assert
    expect(key).toBe('s')
  })

  it.each([
    ['Enter', 'Enter', 'enter'],
    ['ArrowLeft', 'ArrowLeft', 'left'],
    ['F12', 'F12', 'f12'],
    ['P', 'KeyP', 'p'],
    [' ', 'Space', 'space'],
  ])('%s は %s から %s と読む', (key, code, expected) => {
    // Arrange & Act
    const name = keyNameOf(打鍵(key, code))

    // Assert
    expect(name).toBe(expected)
  })

  it('修飾キーそのものは読まない', () => {
    // Arrange
    const press = 打鍵('Meta', 'MetaLeft', { metaKey: true })

    // Act
    const key = keyNameOf(press)

    // Assert
    expect(key).toBeNull()
  })
})

describe('chordFromPress', () => {
  it('押している修飾をすべて持つ', () => {
    // Arrange
    const press = 打鍵('E', 'KeyE', { ctrlKey: true, shiftKey: true, metaKey: true })

    // Act
    const chord = chordFromPress(press)

    // Assert
    expect(chord).toEqual({ key: 'e', meta: true, ctrl: true, alt: false, shift: true })
  })

  it('修飾キーだけの打鍵は組み合わせにならない', () => {
    // Arrange
    const press = 打鍵('Shift', 'ShiftLeft', { shiftKey: true })

    // Act
    const chord = chordFromPress(press)

    // Assert
    expect(chord).toBeNull()
  })
})

describe('matchesChord', () => {
  it('修飾が完全に一致したときだけ当たる', () => {
    // Arrange
    const chord = { key: 's', meta: true }

    // Act
    const 同じ = matchesChord(打鍵('s', 'KeyS', { metaKey: true }), chord)
    const 多い = matchesChord(打鍵('s', 'KeyS', { metaKey: true, ctrlKey: true }), chord)
    const 少ない = matchesChord(打鍵('s', 'KeyS'), chord)

    // Assert
    expect([同じ, 多い, 少ない]).toEqual([true, false, false])
  })

  it('⇧⌥F の整形は US でも JIS でも当たる', () => {
    // Arrange
    const chord = { key: 'f', alt: true, shift: true }

    // Act
    const 当たり = matchesChord(打鍵('Ï', 'KeyF', { altKey: true, shiftKey: true }), chord)
    const 置換 = matchesChord(打鍵('ƒ', 'KeyF', { altKey: true, metaKey: true }), chord)

    // Assert
    expect(当たり).toBe(true)
    expect(置換).toBe(false)
  })
})

describe('hasModifierOrFunctionKey', () => {
  it.each([
    [{ key: 'a' }, false],
    [{ key: 'a', shift: true }, false],
    [{ key: 'a', alt: true }, true],
    [{ key: 'a', meta: true }, true],
    [{ key: 'f5' }, true],
  ])('%o は %s', (chord, expected) => {
    // Arrange & Act
    const result = hasModifierOrFunctionKey(chord)

    // Assert
    expect(result).toBe(expected)
  })
})
