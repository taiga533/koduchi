import { describe, expect, it } from 'vitest'
import type { Cell } from '../../types/db'
import {
  EMPTY_OUTCOME,
  cellMatches,
  indexOfMatch,
  isSearchable,
  matchKeySet,
  matchSummary,
  nextMatchIndex,
  searchRows,
  selectionAt,
  truncationNote,
} from './resultSearch'

/** 文字列のセルを作る。 */
function 文字(text: string): Cell {
  return { text, kind: 'text' }
}

/** 数値のセルを作る。 */
function 数値(text: string): Cell {
  return { text, kind: 'number' }
}

/** NULLのセル。画面には `NULL` と出る。 */
const NULLのセル: Cell = { text: '', kind: 'null' }

/** 大小を区別しない既定の当て方。 */
const 既定 = { caseSensitive: false }

describe('isSearchable', () => {
  it('空の語では探せない', () => {
    // Arrange & Act & Assert
    expect(isSearchable('')).toBe(false)
  })

  it('空白 1 つでも探せる', () => {
    // Arrange: CHAR の右詰めの空白を探したい場面があるため trim しない

    // Act & Assert
    expect(isSearchable(' ')).toBe(true)
  })
})

describe('cellMatches', () => {
  it('画面に出ている文字列に当たる', () => {
    // Arrange
    const セル = 文字('ORDERS')

    // Act & Assert
    expect(cellMatches(セル, 'order', false)).toBe(true)
  })

  it('大文字と小文字を区別すると綴りの違うものは外れる', () => {
    // Arrange
    const セル = 文字('ORDERS')

    // Act & Assert
    expect(cellMatches(セル, 'order', true)).toBe(false)
  })

  it('NULLのセルは NULL という語で当たる', () => {
    // Arrange: 値は空文字列だが画面には NULL と出ている

    // Act & Assert
    expect(cellMatches(NULLのセル, 'null', false)).toBe(true)
  })

  it('NULLのセルは空文字列では当たらない扱いにならない', () => {
    // Arrange: displayText が NULL を返すため、値の空文字列は探し先に現れない

    // Act & Assert
    expect(cellMatches(NULLのセル, 'zzz', false)).toBe(false)
  })
})

describe('searchRows', () => {
  /** 3 行 2 列。2 行目と 3 行目に `あ` を含む。 */
  const 行: Cell[][] = [
    [数値('10'), 文字('ORDERS')],
    [数値('20'), 文字('あいう')],
    [数値('30'), 文字('かあき')],
  ]

  it('語が空なら当たりを返さない', () => {
    // Arrange & Act
    const 結果 = searchRows(null, 行, '', 既定)

    // Assert
    expect(結果).toBe(EMPTY_OUTCOME)
  })

  it('当たりは行優先に並ぶ', () => {
    // Arrange & Act
    const 結果 = searchRows(null, 行, 'あ', 既定)

    // Assert
    expect(結果.matches).toEqual([
      { row: 1, column: 1 },
      { row: 2, column: 1 },
    ])
  })

  it('走査した行数を持ち帰る', () => {
    // Arrange & Act
    const 結果 = searchRows(null, 行, 'あ', 既定)

    // Assert
    expect(結果.scannedRows).toBe(3)
  })

  it('同じ行に複数当たれば列の順に並ぶ', () => {
    // Arrange
    const 同じ語が二列: Cell[][] = [[文字('あ'), 文字('あ')]]

    // Act
    const 結果 = searchRows(null, 同じ語が二列, 'あ', 既定)

    // Assert
    expect(結果.matches).toEqual([
      { row: 0, column: 0 },
      { row: 0, column: 1 },
    ])
  })

  it('続きの行が届いたら前の当たりへ継ぎ足す', () => {
    // Arrange: 先に 3 行を探しておく
    const 前回 = searchRows(null, 行, 'あ', 既定)
    const 続き = [...行, [数値('40'), 文字('さあし')]]

    // Act
    const 結果 = searchRows(前回, 続き, 'あ', 既定)

    // Assert
    expect(結果.matches).toEqual([
      { row: 1, column: 1 },
      { row: 2, column: 1 },
      { row: 3, column: 1 },
    ])
    expect(結果.scannedRows).toBe(4)
  })

  it('語を打ち替えたら先頭から数え直す', () => {
    // Arrange
    const 前回 = searchRows(null, 行, 'あ', 既定)

    // Act
    const 結果 = searchRows(前回, 行, 'ORDERS', 既定)

    // Assert
    expect(結果.matches).toEqual([{ row: 0, column: 1 }])
  })

  it('大小の扱いを変えたら先頭から数え直す', () => {
    // Arrange
    const 前回 = searchRows(null, 行, 'orders', 既定)

    // Act
    const 結果 = searchRows(前回, 行, 'orders', { caseSensitive: true })

    // Assert
    expect(結果.matches).toEqual([])
  })

  it('実行し直して行が入れ替わったら継ぎ足さない', () => {
    // Arrange: 行数は同じだが中身が違う別の結果
    const 前回 = searchRows(null, 行, 'あ', 既定)
    const 別の結果: Cell[][] = [
      [数値('10'), 文字('x')],
      [数値('20'), 文字('y')],
      [数値('30'), 文字('z')],
    ]

    // Act
    const 結果 = searchRows(前回, 別の結果, 'あ', 既定)

    // Assert
    expect(結果.matches).toEqual([])
  })

  it('行が減ったら先頭から数え直す', () => {
    // Arrange
    const 前回 = searchRows(null, 行, 'あ', 既定)

    // Act
    const 結果 = searchRows(前回, 行.slice(0, 2), 'あ', 既定)

    // Assert
    expect(結果.matches).toEqual([{ row: 1, column: 1 }])
    expect(結果.scannedRows).toBe(2)
  })

  it('切り詰められた値を走査したことを持ち帰る', () => {
    // Arrange: CLOB が 64KB で切れているセルを混ぜる
    const 切れた行: Cell[][] = [[{ text: '長い本文', kind: 'text', truncated: true }]]

    // Act
    const 結果 = searchRows(null, 切れた行, '本文', 既定)

    // Assert
    expect(結果.sawTruncated).toBe(true)
  })

  it('切り詰めが無ければ断り書きは立たない', () => {
    // Arrange & Act
    const 結果 = searchRows(null, 行, 'あ', 既定)

    // Assert
    expect(結果.sawTruncated).toBe(false)
  })

  it('切り詰めの印は当たらなかったセルでも拾う', () => {
    // Arrange: 探した先に切れた値があれば、当たらなくても断り書きが要る
    const 混ざった行: Cell[][] = [[文字('あ'), { text: '別の本文', kind: 'text', truncated: true }]]

    // Act
    const 結果 = searchRows(null, 混ざった行, 'あ', 既定)

    // Assert
    expect(結果.sawTruncated).toBe(true)
  })
})

describe('indexOfMatch', () => {
  const 当たり = [
    { row: 1, column: 0 },
    { row: 3, column: 2 },
    { row: 3, column: 5 },
    { row: 9, column: 1 },
  ]

  it('同じ行の中でも列で見分ける', () => {
    // Arrange & Act & Assert
    expect(indexOfMatch(当たり, { row: 3, column: 5 })).toBe(2)
  })

  it('先頭と末尾を引ける', () => {
    // Arrange & Act & Assert
    expect(indexOfMatch(当たり, { row: 1, column: 0 })).toBe(0)
    expect(indexOfMatch(当たり, { row: 9, column: 1 })).toBe(3)
  })

  it('当たりでない位置は -1 を返す', () => {
    // Arrange & Act & Assert
    expect(indexOfMatch(当たり, { row: 3, column: 3 })).toBe(-1)
  })

  it('当たりが無ければ -1 を返す', () => {
    // Arrange & Act & Assert
    expect(indexOfMatch([], { row: 0, column: 0 })).toBe(-1)
  })
})

describe('nextMatchIndex', () => {
  it('末尾の次は先頭へ巻き戻る', () => {
    // Arrange & Act & Assert
    expect(nextMatchIndex(3, 2, true)).toBe(0)
  })

  it('先頭の前は末尾へ巻き戻る', () => {
    // Arrange & Act & Assert
    expect(nextMatchIndex(3, 0, false)).toBe(2)
  })

  it('どこにも居なければ進むときは先頭へ', () => {
    // Arrange & Act & Assert
    expect(nextMatchIndex(3, -1, true)).toBe(0)
  })

  it('どこにも居なければ戻るときは末尾へ', () => {
    // Arrange & Act & Assert
    expect(nextMatchIndex(3, -1, false)).toBe(2)
  })

  it('当たりが無ければ -1 のまま', () => {
    // Arrange & Act & Assert
    expect(nextMatchIndex(0, -1, true)).toBe(-1)
  })
})

describe('matchKeySet', () => {
  it('当たりの位置を引ける形にする', () => {
    // Arrange
    const 当たり = [
      { row: 1, column: 2 },
      { row: 4, column: 0 },
    ]

    // Act
    const 集合 = matchKeySet(当たり)

    // Assert
    expect(集合.has('1:2')).toBe(true)
    expect(集合.has('4:0')).toBe(true)
    expect(集合.has('1:0')).toBe(false)
  })
})

describe('selectionAt', () => {
  it('当たり 1 つだけを選んだ状態にする', () => {
    // Arrange & Act
    const 選択 = selectionAt({ row: 2, column: 1 })

    // Assert
    expect(選択).toEqual({ anchor: { row: 2, column: 1 }, focus: { row: 2, column: 1 } })
  })
})

describe('matchSummary', () => {
  it('カーソルが尽きていなければ探した行数を必ず添える', () => {
    // Arrange: 1,200 行だけ取得済みで 3 件当たった

    // Act
    const 文言 = matchSummary(3, 0, 1200, false)

    // Assert
    expect(文言).toBe('1 / 3 件（取得済みの 1,200 行のうち）')
  })

  it('カーソルが尽きていれば件数だけを出す', () => {
    // Arrange & Act
    const 文言 = matchSummary(3, 0, 1200, true)

    // Assert
    expect(文言).toBe('1 / 3 件')
  })

  it('一致が無いときも探した範囲を添える', () => {
    // Arrange & Act
    const 文言 = matchSummary(0, -1, 1000, false)

    // Assert
    expect(文言).toBe('一致なし（取得済みの 1,000 行のうち）')
  })

  it('カーソルが尽きていて一致が無ければ一致なしだけを出す', () => {
    // Arrange & Act
    const 文言 = matchSummary(0, -1, 40, true)

    // Assert
    expect(文言).toBe('一致なし')
  })

  it('どこにも居ないときは件数だけを出す', () => {
    // Arrange & Act
    const 文言 = matchSummary(5, -1, 40, true)

    // Assert
    expect(文言).toBe('5 件')
  })
})

describe('truncationNote', () => {
  it('切り詰められた値を探したときは断り書きを返す', () => {
    // Arrange & Act
    const 文言 = truncationNote(true)

    // Assert
    expect(文言).toBe('一部の値は先頭 64 KB までしか探していません')
  })

  it('切り詰めが無ければ何も出さない', () => {
    // Arrange & Act & Assert
    expect(truncationNote(false)).toBeNull()
  })
})
