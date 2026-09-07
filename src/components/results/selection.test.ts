import { describe, expect, it } from 'vitest'
import type { Cell, Column } from '../../types/db'
import {
  buildCopyText,
  columnSelection,
  isMoveKey,
  isSelected,
  moveSelection,
  rowSelection,
  selectAll,
  selectionEdges,
  selectionRange,
  selectionShadow,
} from './selection'

/** 2 列 3 行の結果。NULL と空文字列を 1 つずつ含む。 */
const 列: Column[] = [
  { name: 'ID', typeName: 'NUMBER(4)', kind: 'number' },
  { name: 'LABEL', typeName: 'VARCHAR2(80)', kind: 'text' },
]

const 行: Cell[][] = [
  [
    { text: '10', kind: 'number' },
    { text: 'あ', kind: 'text' },
  ],
  [
    { text: '20', kind: 'number' },
    { text: '', kind: 'null' },
  ],
  [
    { text: '30', kind: 'number' },
    { text: '', kind: 'text' },
  ],
]

describe('selectionRange', () => {
  it('anchor が focus より後ろでも上下左右へ正規化される', () => {
    // Arrange
    const 選択 = { anchor: { row: 2, column: 1 }, focus: { row: 0, column: 0 } }

    // Act
    const 範囲 = selectionRange(選択)

    // Assert
    expect(範囲).toEqual({ top: 0, bottom: 2, left: 0, right: 1 })
  })
})

describe('isSelected', () => {
  it('範囲の内側のセルは選択されている', () => {
    // Arrange
    const 範囲 = { top: 0, bottom: 1, left: 0, right: 1 }

    // Act
    const 結果 = isSelected(範囲, 1, 1)

    // Assert
    expect(結果).toBe(true)
  })

  it('範囲の外側のセルは選択されていない', () => {
    // Arrange
    const 範囲 = { top: 0, bottom: 1, left: 0, right: 0 }

    // Act
    const 結果 = isSelected(範囲, 1, 1)

    // Assert
    expect(結果).toBe(false)
  })
})

describe('selectionEdges', () => {
  it('1 セルだけの選択では 4 辺とも外枠になる', () => {
    // Arrange
    const 範囲 = { top: 1, bottom: 1, left: 1, right: 1 }

    // Act
    const 辺 = selectionEdges(範囲, 1, 1)

    // Assert
    expect(辺).toEqual({ top: true, right: true, bottom: true, left: true })
  })

  it('範囲の中ほどのセルはどの辺も担わない', () => {
    // Arrange
    const 範囲 = { top: 0, bottom: 2, left: 0, right: 2 }

    // Act
    const 辺 = selectionEdges(範囲, 1, 1)

    // Assert
    expect(辺).toEqual({ top: false, right: false, bottom: false, left: false })
  })

  it('範囲の外側のセルは 4 辺とも偽になる', () => {
    // Arrange
    const 範囲 = { top: 0, bottom: 0, left: 0, right: 0 }

    // Act
    const 辺 = selectionEdges(範囲, 5, 5)

    // Assert
    expect(辺).toEqual({ top: false, right: false, bottom: false, left: false })
  })
})

describe('selectionShadow', () => {
  it('担う辺だけがアクセントのトークンで引かれる', () => {
    // Arrange
    const 辺 = { top: true, right: false, bottom: false, left: true }

    // Act
    const 影 = selectionShadow(辺)

    // Assert
    expect(影).toBe('inset 0 1px 0 0 var(--ac), inset 1px 0 0 0 var(--ac)')
  })

  it('どの辺も担わなければ影を付けない', () => {
    // Arrange
    const 辺 = { top: false, right: false, bottom: false, left: false }

    // Act
    const 影 = selectionShadow(辺)

    // Assert
    expect(影).toBeUndefined()
  })
})

describe('isMoveKey', () => {
  it('矢印キーと Home / End は移動のキーである', () => {
    // Arrange
    const キー = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']

    // Act
    const 結果 = キー.map(isMoveKey)

    // Assert
    expect(結果).toEqual([true, true, true, true, true, true])
  })

  it('それ以外のキーは移動のキーではない', () => {
    // Arrange
    const キー = 'a'

    // Act
    const 結果 = isMoveKey(キー)

    // Assert
    expect(結果).toBe(false)
  })
})

describe('moveSelection', () => {
  it('矢印キーは 1 セルだけの選択にして移動する', () => {
    // Arrange
    const 選択 = { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 1 } }

    // Act
    const 次 = moveSelection(選択, 'ArrowDown', false, 3, 2)

    // Assert
    expect(次).toEqual({ anchor: { row: 1, column: 1 }, focus: { row: 1, column: 1 } })
  })

  it('⇧ を伴うと anchor を据え置いて範囲が伸びる', () => {
    // Arrange
    const 選択 = { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } }

    // Act
    const 次 = moveSelection(選択, 'ArrowDown', true, 3, 2)

    // Assert
    expect(次).toEqual({ anchor: { row: 0, column: 0 }, focus: { row: 1, column: 0 } })
  })

  it('表の端では止まる', () => {
    // Arrange
    const 選択 = { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } }

    // Act
    const 次 = moveSelection(選択, 'ArrowUp', false, 3, 2)

    // Assert
    expect(次.focus).toEqual({ row: 0, column: 0 })
  })

  it('Home は行頭へ End は行末へ移る', () => {
    // Arrange
    const 選択 = { anchor: { row: 1, column: 1 }, focus: { row: 1, column: 1 } }

    // Act
    const 行頭 = moveSelection(選択, 'Home', false, 3, 2)
    const 行末 = moveSelection(行頭, 'End', false, 3, 2)

    // Assert
    expect(行頭.focus).toEqual({ row: 1, column: 0 })
    expect(行末.focus).toEqual({ row: 1, column: 1 })
  })
})

describe('rowSelection / selectAll / columnSelection', () => {
  it('行の選択はその行の全列を覆う', () => {
    // Arrange
    const 列数 = 2

    // Act
    const 範囲 = selectionRange(rowSelection(1, 列数))

    // Assert
    expect(範囲).toEqual({ top: 1, bottom: 1, left: 0, right: 1 })
  })

  it('全選択は表示中の全行全列を覆う', () => {
    // Arrange
    const 行数 = 3
    const 列数 = 2

    // Act
    const 範囲 = selectionRange(selectAll(行数, 列数))

    // Assert
    expect(範囲).toEqual({ top: 0, bottom: 2, left: 0, right: 1 })
  })

  it('列の選択はその列の全行を覆う', () => {
    // Arrange
    const 行数 = 3

    // Act
    const 範囲 = selectionRange(columnSelection(1, 行数))

    // Assert
    expect(範囲).toEqual({ top: 0, bottom: 2, left: 1, right: 1 })
  })
})

describe('buildCopyText', () => {
  it('セルはタブ区切り行は改行区切りになる', () => {
    // Arrange
    const 範囲 = { top: 0, bottom: 1, left: 0, right: 1 }

    // Act
    const 文字列 = buildCopyText(列, 行, 範囲, false)

    // Assert
    expect(文字列).toBe('10\tあ\n20\tNULL')
  })

  it('見出し付きでは列名が 1 行目に付く', () => {
    // Arrange
    const 範囲 = { top: 0, bottom: 0, left: 0, right: 1 }

    // Act
    const 文字列 = buildCopyText(列, 行, 範囲, true)

    // Assert
    expect(文字列).toBe('ID\tLABEL\n10\tあ')
  })

  it('NULL は NULL 空文字列は空のままで区別される', () => {
    // Arrange: 2 行目が NULL、3 行目が空文字列
    const 範囲 = { top: 1, bottom: 2, left: 1, right: 1 }

    // Act
    const 文字列 = buildCopyText(列, 行, 範囲, false)

    // Assert
    expect(文字列).toBe('NULL\n')
  })

  it('1 セルだけの選択では値だけが返る', () => {
    // Arrange
    const 範囲 = { top: 2, bottom: 2, left: 0, right: 0 }

    // Act
    const 文字列 = buildCopyText(列, 行, 範囲, false)

    // Assert
    expect(文字列).toBe('30')
  })
})
