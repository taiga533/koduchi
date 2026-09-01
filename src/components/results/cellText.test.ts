import { describe, expect, it } from 'vitest'
import {
  columnMinWidth,
  columnWidth,
  displayText,
  isRightAligned,
  NULL_LABEL,
  tableMinWidth,
} from './cellText'

describe('isRightAligned', () => {
  it('数値は右寄せになる', () => {
    // Arrange
    const kind = 'number' as const

    // Act
    const aligned = isRightAligned(kind)

    // Assert
    expect(aligned).toBe(true)
  })

  it('文字列は右寄せにならない', () => {
    // Arrange
    const kind = 'text' as const

    // Act
    const aligned = isRightAligned(kind)

    // Assert
    expect(aligned).toBe(false)
  })

  it('日時は右寄せにならない', () => {
    // Arrange
    const kind = 'datetime' as const

    // Act
    const aligned = isRightAligned(kind)

    // Assert
    expect(aligned).toBe(false)
  })
})

describe('displayText', () => {
  it('NULL は NULL という文字列として表示される', () => {
    // Arrange
    const cell = { text: '', kind: 'null' as const }

    // Act
    const text = displayText(cell)

    // Assert
    expect(text).toBe(NULL_LABEL)
  })

  it('空文字列は空のまま表示され NULL と区別される', () => {
    // Arrange
    const cell = { text: '', kind: 'text' as const }

    // Act
    const text = displayText(cell)

    // Assert
    expect(text).toBe('')
  })

  it('通常の値はそのまま表示される', () => {
    // Arrange
    const cell = { text: '99999999999999999999999999999999999999', kind: 'number' as const }

    // Act
    const text = displayText(cell)

    // Assert
    expect(text).toBe('99999999999999999999999999999999999999')
  })
})

describe('columnWidth', () => {
  it('文字列の列は伸縮する幅になる', () => {
    // Arrange
    const kind = 'text' as const

    // Act
    const width = columnWidth(kind)

    // Assert
    expect(width).toBe('minmax(160px, 1fr)')
  })

  it('数値の列は固定幅になる', () => {
    // Arrange
    const kind = 'number' as const

    // Act
    const width = columnWidth(kind)

    // Assert
    expect(width).toBe('110px')
  })

  it('NULL の列も文字列として伸縮する', () => {
    // Arrange
    const kind = 'null' as const

    // Act
    const width = columnWidth(kind)

    // Assert
    expect(width).toBe('minmax(160px, 1fr)')
  })
})

describe('tableMinWidth', () => {
  it('各列の下限と行番号の幅を足し合わせる', () => {
    // Arrange: 数値 110 + 文字列 160 + 行番号 44
    const kinds = ['number', 'text'] as const

    // Act
    const width = tableMinWidth([...kinds], 44)

    // Assert
    expect(width).toBe(314)
  })

  it('列が無ければ行番号の幅だけになる', () => {
    // Arrange
    const kinds: never[] = []

    // Act
    const width = tableMinWidth(kinds, 44)

    // Assert
    expect(width).toBe(44)
  })

  it('列の下限は grid の指定と一致する', () => {
    // Arrange
    const kind = 'datetime' as const

    // Act
    const min = columnMinWidth(kind)

    // Assert
    expect(columnWidth(kind)).toBe(`${min}px`)
  })
})
