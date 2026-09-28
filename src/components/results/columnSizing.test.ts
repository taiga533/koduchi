import { describe, expect, it } from 'vitest'
import type { Column } from '../../types/db'
import {
  autoFitWidth,
  CHAR_WIDTH,
  clampColumnWidth,
  columnMinWidthOf,
  displayWidth,
  frozenOffsets,
  gridTemplate,
  MAX_AUTO_WIDTH,
  MIN_COLUMN_WIDTH,
  resolveColumnWidth,
  resolveFrozenCount,
  resolveTableMinWidth,
} from './columnSizing'

/** 数値と文字列の 2 列。既定の下限は 110px と 160px。 */
const 列: Column[] = [
  { name: 'ID', typeName: 'NUMBER(4)', kind: 'number' },
  { name: 'LABEL', typeName: 'VARCHAR2(80)', kind: 'text' },
]

describe('displayWidth', () => {
  it('半角だけの文字列は文字数と同じ幅になる', () => {
    // Arrange
    const text = 'ORDER_ID'

    // Act
    const width = displayWidth(text)

    // Assert
    expect(width).toBe(8)
  })

  it('全角は半角 2 文字ぶんとして数える', () => {
    // Arrange
    const text = '受注番号'

    // Act
    const width = displayWidth(text)

    // Assert
    expect(width).toBe(8)
  })

  it('全角と半角が混ざっていても足し合わされる', () => {
    // Arrange
    const text = '受注ID'

    // Act
    const width = displayWidth(text)

    // Assert
    expect(width).toBe(6)
  })

  it('全角英数も 2 文字ぶんとして数える', () => {
    // Arrange
    const text = 'ＡＢ'

    // Act
    const width = displayWidth(text)

    // Assert
    expect(width).toBe(4)
  })

  it('サロゲートペアは 1 文字として数える', () => {
    // Arrange: CJK 拡張 B の漢字（全角）
    const text = '𠮷'

    // Act
    const width = displayWidth(text)

    // Assert
    expect(width).toBe(2)
  })

  it('空文字列の幅は 0 になる', () => {
    // Arrange
    const text = ''

    // Act
    const width = displayWidth(text)

    // Assert
    expect(width).toBe(0)
  })
})

describe('clampColumnWidth', () => {
  it('下限より狭い幅は下限に揃う', () => {
    // Arrange
    const width = 10

    // Act
    const clamped = clampColumnWidth(width)

    // Assert
    expect(clamped).toBe(MIN_COLUMN_WIDTH)
  })

  it('上限より広い幅は上限に揃う', () => {
    // Arrange
    const width = 2000

    // Act
    const clamped = clampColumnWidth(width)

    // Assert
    expect(clamped).toBe(MAX_AUTO_WIDTH)
  })

  it('小数は整数へ丸める', () => {
    // Arrange
    const width = 123.4

    // Act
    const clamped = clampColumnWidth(width)

    // Assert
    expect(clamped).toBe(123)
  })
})

describe('autoFitWidth', () => {
  it('いちばん長い値が収まる幅になる', () => {
    // Arrange: 半角 20 文字が最長
    const values = ['abc', 'x'.repeat(20)]

    // Act
    const width = autoFitWidth('NAME', values)

    // Assert
    expect(width).toBe(Math.round(20 * CHAR_WIDTH + 19))
  })

  it('値より見出しが長ければ見出しに合わせる', () => {
    // Arrange
    const values = ['1', '2']

    // Act
    const width = autoFitWidth('VERY_LONG_COLUMN_NAME', values)

    // Assert
    expect(width).toBe(Math.round('VERY_LONG_COLUMN_NAME'.length * CHAR_WIDTH + 19))
  })

  it('全角の値は半角の 2 倍の幅で見積もる', () => {
    // Arrange: 全角 6 文字 = 半角 12 文字ぶん
    const values = ['日本語のメモ']

    // Act
    const width = autoFitWidth('NOTE', values)

    // Assert
    expect(width).toBe(Math.round(12 * CHAR_WIDTH + 19))
  })

  it('とても長い値でも 600px を超えない', () => {
    // Arrange
    const values = ['x'.repeat(5000)]

    // Act
    const width = autoFitWidth('BODY', values)

    // Assert
    expect(width).toBe(MAX_AUTO_WIDTH)
  })

  it('行が 1 つも無ければ見出しだけで決まる', () => {
    // Arrange
    const values: string[] = []

    // Act
    const width = autoFitWidth('ID', values)

    // Assert
    expect(width).toBe(MIN_COLUMN_WIDTH)
  })
})

describe('resolveColumnWidth', () => {
  it('幅を決めていない文字列の列は伸縮する既定になる', () => {
    // Arrange
    const widths = {}

    // Act
    const width = resolveColumnWidth(列[1], widths)

    // Assert
    expect(width).toBe('minmax(160px, 1fr)')
  })

  it('幅を決めた列は固定幅になる', () => {
    // Arrange
    const widths = { LABEL: 240 }

    // Act
    const width = resolveColumnWidth(列[1], widths)

    // Assert
    expect(width).toBe('240px')
  })
})

describe('gridTemplate', () => {
  it('行番号の列を先頭に置いて列を並べる', () => {
    // Arrange
    const widths = {}

    // Act
    const template = gridTemplate(列, widths, 44)

    // Assert
    expect(template).toBe('44px 110px minmax(160px, 1fr)')
  })

  it('幅を決めた列だけが固定幅に差し替わる', () => {
    // Arrange
    const widths = { ID: 200 }

    // Act
    const template = gridTemplate(列, widths, 44)

    // Assert
    expect(template).toBe('44px 200px minmax(160px, 1fr)')
  })

  it('固定した文字列の列は伸縮せず下限の幅で決め打ちになる', () => {
    // Arrange
    const widths = {}

    // Act
    const template = gridTemplate(列, widths, 44, 2)

    // Assert
    expect(template).toBe('44px 110px 160px')
  })
})

describe('resolveFrozenCount', () => {
  it('固定していなければ 0 列になる', () => {
    // Arrange
    const frozen = undefined

    // Act
    const count = resolveFrozenCount(列, frozen)

    // Assert
    expect(count).toBe(0)
  })

  it('覚えた位置に同じ名前の列があればそこまでを固定する', () => {
    // Arrange
    const frozen = { name: 'LABEL', index: 1 }

    // Act
    const count = resolveFrozenCount(列, frozen)

    // Assert
    expect(count).toBe(2)
  })

  it('同じ名前の列が並ぶ結果では覚えた位置の列まで固定する', () => {
    // Arrange
    const columns: Column[] = [
      { name: 'ID', typeName: 'NUMBER', kind: 'number' },
      { name: 'NAME', typeName: 'VARCHAR2(10)', kind: 'text' },
      { name: 'ID', typeName: 'NUMBER', kind: 'number' },
    ]

    // Act
    const count = resolveFrozenCount(columns, { name: 'ID', index: 2 })

    // Assert
    expect(count).toBe(3)
  })

  it('列の並びが変わっても同じ名前の列まで固定する', () => {
    // Arrange
    const columns: Column[] = [
      { name: 'LABEL', typeName: 'VARCHAR2(80)', kind: 'text' },
      { name: 'ID', typeName: 'NUMBER(4)', kind: 'number' },
    ]

    // Act
    const count = resolveFrozenCount(columns, { name: 'LABEL', index: 1 })

    // Assert
    expect(count).toBe(1)
  })

  it('その名前の列が無い結果では固定しない', () => {
    // Arrange
    const frozen = { name: 'GONE', index: 0 }

    // Act
    const count = resolveFrozenCount(列, frozen)

    // Assert
    expect(count).toBe(0)
  })
})

describe('frozenOffsets', () => {
  it('固定した列の左端を行番号の列の右から幅を足し上げて返す', () => {
    // Arrange
    const widths = { ID: 90 }

    // Act
    const offsets = frozenOffsets(列, widths, 44, 2)

    // Assert
    expect(offsets).toEqual([44, 134])
  })

  it('固定しなければ空になる', () => {
    // Arrange
    const widths = {}

    // Act
    const offsets = frozenOffsets(列, widths, 44, 0)

    // Assert
    expect(offsets).toEqual([])
  })
})

describe('resolveTableMinWidth', () => {
  it('幅を決めていなければ型ごとの下限を足し合わせる', () => {
    // Arrange: 数値 110 + 文字列 160 + 行番号 44
    const widths = {}

    // Act
    const width = resolveTableMinWidth(列, widths, 44)

    // Assert
    expect(width).toBe(314)
  })

  it('幅を決めた列はその幅で足し合わせる', () => {
    // Arrange: 数値 300 + 文字列 160 + 行番号 44
    const widths = { ID: 300 }

    // Act
    const width = resolveTableMinWidth(列, widths, 44)

    // Assert
    expect(width).toBe(504)
  })
})

describe('columnMinWidthOf', () => {
  it('列の型に応じた下限を返す', () => {
    // Arrange
    const column = 列[0]

    // Act
    const width = columnMinWidthOf(column)

    // Assert
    expect(width).toBe(110)
  })
})
