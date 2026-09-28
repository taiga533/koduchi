import { describe, expect, it } from 'vitest'
import type { Cell } from '../../types/db'
import {
  applyOverride,
  cellSegments,
  defaultResultDisplay,
  formattedText,
  groupThousands,
  isAdjusted,
  parseResultDisplay,
  resolveResultDisplay,
  whitespaceSegments,
} from './resultDisplay'

const 区切る = { thousandsSeparator: true, showWhitespace: false }
const 空白を見せる = { thousandsSeparator: false, showWhitespace: true }

describe('groupThousands', () => {
  it('整数を 3 桁ごとに区切る', () => {
    // Arrange
    const text = '1234567'

    // Act
    const grouped = groupThousands(text)

    // Assert
    expect(grouped).toBe('1,234,567')
  })

  it('負の小数は整数部だけを区切り符号と小数部を保つ', () => {
    // Arrange
    const text = '-12345.678901'

    // Act
    const grouped = groupThousands(text)

    // Assert
    expect(grouped).toBe('-12,345.678901')
  })

  it('3 桁以下は変わらない', () => {
    // Arrange
    const text = '999'

    // Act
    const grouped = groupThousands(text)

    // Assert
    expect(grouped).toBe('999')
  })

  it('38 桁の数値も精度を失わずに区切る', () => {
    // Arrange
    const text = '12345678901234567890123456789012345678'

    // Act
    const grouped = groupThousands(text)

    // Assert
    expect(grouped.replaceAll(',', '')).toBe(text)
    expect(grouped.startsWith('12,345,678,901,')).toBe(true)
  })

  it('指数表記や見知らぬ形には手を付けない', () => {
    // Arrange
    const texts = ['1.5E+130', '.5', '1234.', 'abc']

    // Act
    const grouped = texts.map(groupThousands)

    // Assert
    expect(grouped).toEqual(texts)
  })
})

describe('whitespaceSegments', () => {
  it('前後の半角空白だけを記号にして途中の空白は残す', () => {
    // Arrange
    const text = '  A B '

    // Act
    const segments = whitespaceSegments(text)

    // Assert
    expect(segments).toEqual([
      { text: '··', marker: true },
      { text: 'A B', marker: false },
      { text: '·', marker: true },
    ])
  })

  it('タブと改行はどこにあっても記号になる', () => {
    // Arrange
    const text = 'A\tB\r\nC\nD'

    // Act
    const segments = whitespaceSegments(text)

    // Assert
    expect(segments.map((segment) => segment.text).join('')).toBe('A→B↵C↵D')
    expect(segments.filter((segment) => segment.marker).map((s) => s.text)).toEqual(['→', '↵', '↵'])
  })

  it('空白だけの値は空白の数だけ記号になる', () => {
    // Arrange
    const text = '   '

    // Act
    const segments = whitespaceSegments(text)

    // Assert
    expect(segments).toEqual([{ text: '···', marker: true }])
  })

  it('空文字列は何も描かない', () => {
    // Arrange
    const text = ''

    // Act
    const segments = whitespaceSegments(text)

    // Assert
    expect(segments).toEqual([])
  })
})

describe('cellSegments', () => {
  it('何も調整しなければ値をそのまま描く', () => {
    // Arrange
    const cell: Cell = { text: '1234', kind: 'number' }

    // Act
    const segments = cellSegments(cell, defaultResultDisplay)

    // Assert
    expect(segments).toEqual([{ text: '1234', marker: false }])
  })

  it('3 桁区切りは数値の列にだけ効く', () => {
    // Arrange
    const 数値: Cell = { text: '1234', kind: 'number' }
    const 文字列: Cell = { text: '1234', kind: 'text' }

    // Act
    const texts = [formattedText(数値, 区切る), formattedText(文字列, 区切る)]

    // Assert
    expect(texts).toEqual(['1,234', '1234'])
  })

  it('空白の記号は文字列の列にだけ効く', () => {
    // Arrange
    const 文字列: Cell = { text: 'A ', kind: 'text' }
    const 日時: Cell = { text: '2026-09-28 ', kind: 'datetime' }

    // Act
    const texts = [formattedText(文字列, 空白を見せる), formattedText(日時, 空白を見せる)]

    // Assert
    expect(texts).toEqual(['A·', '2026-09-28 '])
  })

  it('NULL はどの調整でも NULL のまま描く', () => {
    // Arrange
    const cell: Cell = { text: '', kind: 'null' }
    const 全部 = { thousandsSeparator: true, showWhitespace: true }

    // Act
    const text = formattedText(cell, 全部)

    // Assert
    expect(text).toBe('NULL')
  })
})

describe('resolveResultDisplay', () => {
  it('上書きした項目だけが既定に勝つ', () => {
    // Arrange
    const defaults = { thousandsSeparator: true, showWhitespace: false }

    // Act
    const display = resolveResultDisplay(defaults, { showWhitespace: true })

    // Assert
    expect(display).toEqual({ thousandsSeparator: true, showWhitespace: true })
  })

  it('上書きが無ければ既定になる', () => {
    // Arrange
    const defaults = { thousandsSeparator: true, showWhitespace: false }

    // Act
    const display = resolveResultDisplay(defaults, undefined)

    // Assert
    expect(display).toEqual(defaults)
  })
})

describe('applyOverride', () => {
  it('既定と違う項目だけを上書きとして残す', () => {
    // Arrange
    const defaults = defaultResultDisplay

    // Act
    const override = applyOverride(defaults, undefined, { thousandsSeparator: true })

    // Assert
    expect(override).toEqual({ thousandsSeparator: true })
  })

  it('既定と同じ値へ戻した項目は上書きから落ちすべて戻れば上書きなしになる', () => {
    // Arrange
    const defaults = defaultResultDisplay
    const current = { thousandsSeparator: true }

    // Act
    const override = applyOverride(defaults, current, { thousandsSeparator: false })

    // Assert
    expect(override).toBeUndefined()
  })

  it('他の項目の上書きは保たれる', () => {
    // Arrange
    const defaults = defaultResultDisplay
    const current = { thousandsSeparator: true }

    // Act
    const override = applyOverride(defaults, current, { showWhitespace: true })

    // Assert
    expect(override).toEqual({ thousandsSeparator: true, showWhitespace: true })
  })
})

describe('isAdjusted', () => {
  it('どれか 1 つでも入っていれば調整中とみなす', () => {
    // Arrange
    const displays = [defaultResultDisplay, 区切る, 空白を見せる]

    // Act
    const adjusted = displays.map(isAdjusted)

    // Assert
    expect(adjusted).toEqual([false, true, true])
  })
})

describe('parseResultDisplay', () => {
  it('表が無ければ既定になる', () => {
    // Arrange
    const saved = undefined

    // Act
    const display = parseResultDisplay(saved)

    // Assert
    expect(display).toEqual(defaultResultDisplay)
  })

  it('真偽値でない項目だけを既定へ落とし他の項目は保つ', () => {
    // Arrange
    const saved = { thousandsSeparator: true, showWhitespace: 'yes' }

    // Act
    const display = parseResultDisplay(saved)

    // Assert
    expect(display).toEqual({ thousandsSeparator: true, showWhitespace: false })
  })
})
