/**
 * 選んだセルの集計のテスト（ADR 0049）。
 *
 * セルの文字列の形は Oracle から実測したもの（指数表記なし、`inf` / `NaN`、
 * `2024-01-02 03:04:05.123000000 +09:00`）に合わせてある。
 */

import { describe, expect, it } from 'vitest'
import type { Cell } from '../../types/db'
import {
  accumulateRows,
  computeSelectionStats,
  createAccumulator,
  describeStat,
  finishStats,
  partialNote,
  selectedCellCount,
  formatStatValue,
  parseDatetime,
  parseNumeric,
} from './selectionStats'
import type { SelectionRange } from './selection'

const 数 = (text: string): Cell => ({ text, kind: 'number' })
const 字 = (text: string): Cell => ({ text, kind: 'text' })
const 時 = (text: string): Cell => ({ text, kind: 'datetime' })
const 空: Cell = { text: '', kind: 'null' }

/** 1 列ぶんの行を作る。 */
function 列(...cells: Cell[]): Cell[][] {
  return cells.map((cell) => [cell])
}

/** 全行・全列を覆う範囲。 */
function 全体(rows: Cell[][]): SelectionRange {
  return { top: 0, bottom: rows.length - 1, left: 0, right: (rows[0]?.length ?? 1) - 1 }
}

describe('computeSelectionStats', () => {
  it('数値の合計・平均・最小・最大を出す', () => {
    // Arrange
    const rows = 列(数('10'), 数('-2.5'), 数('4'))

    // Act
    const stats = computeSelectionStats(rows, 全体(rows), true)

    // Assert
    expect(stats).toMatchObject({
      cellCount: 3,
      numericCount: 3,
      sum: '11.5',
      average: '3.83333333333',
      min: '-2.5',
      max: '10',
      extremaOf: 'number',
      partial: false,
    })
  })

  it('38 桁の NUMBER を足しても精度を落とさない', () => {
    // Arrange
    const nines = '9'.repeat(38)
    const rows = 列(数(nines), 数('1'))

    // Act
    const stats = computeSelectionStats(rows, 全体(rows), true)

    // Assert
    expect(stats.sum).toBe(`1${'0'.repeat(38)}`)
    expect(stats.max).toBe(nines)
  })

  it('0.1 と 0.2 の合計は 0.3 になる', () => {
    // Arrange
    const rows = 列(数('0.1'), 数('0.2'))

    // Act
    const stats = computeSelectionStats(rows, 全体(rows), true)

    // Assert
    expect(stats.sum).toBe('0.3')
    expect(stats.average).toBe('0.15')
  })

  it('平均は 0 から遠い側へ丸める', () => {
    // Arrange
    const rows = 列(数('-1'), 数('-1'), 数('-0.0000000001'))

    // Act
    const stats = computeSelectionStats(rows, 全体(rows), true)

    // Assert
    expect(stats.average).toBe('-0.6666666667')
  })

  it('NULL と数値でないセルは件数にだけ入れ、集計からは外す', () => {
    // Arrange
    const rows = [
      [数('1'), 字('a')],
      [空, 数('3')],
    ]

    // Act
    const stats = computeSelectionStats(rows, 全体(rows), true)

    // Assert
    expect(stats).toMatchObject({
      cellCount: 4,
      numericCount: 2,
      nullCount: 1,
      otherCount: 1,
      sum: '4',
      average: '2',
    })
  })

  it('数値が 1 つも無ければ合計も平均も出さない', () => {
    // Arrange
    const rows = 列(字('a'), 空)

    // Act
    const stats = computeSelectionStats(rows, 全体(rows), true)

    // Assert
    expect(stats.sum).toBeNull()
    expect(stats.average).toBeNull()
    expect(stats.min).toBeNull()
    expect(stats.extremaOf).toBeNull()
  })

  it('inf と NaN は IEEE 754 の足し算と Oracle の並びに従う', () => {
    // Arrange
    const 無限 = 列(数('1'), 数('inf'))
    const 打ち消し = 列(数('inf'), 数('-inf'))
    const 非数 = 列(数('-inf'), 数('NaN'), 数('5'))

    // Act
    const a = computeSelectionStats(無限, 全体(無限), true)
    const b = computeSelectionStats(打ち消し, 全体(打ち消し), true)
    const c = computeSelectionStats(非数, 全体(非数), true)

    // Assert
    expect([a.sum, a.average, a.max]).toEqual(['inf', 'inf', 'inf'])
    expect(b.sum).toBe('NaN')
    expect([c.sum, c.min, c.max]).toEqual(['NaN', '-inf', 'NaN'])
  })

  it('数値として読めない文字列は 0 として足さず数値でない側へ数える', () => {
    // Arrange
    const rows = 列(数('1'), 数('1.5E+3'))

    // Act
    const stats = computeSelectionStats(rows, 全体(rows), true)

    // Assert
    expect(stats.numericCount).toBe(1)
    expect(stats.otherCount).toBe(1)
    expect(stats.sum).toBe('1')
  })

  it('数値が無く日時だけなら日時の最小と最大を出す', () => {
    // Arrange
    const rows = 列(
      時('2024-03-01 00:00:00'),
      時('2023-12-31 23:59:59.500000000'),
      時('2024-03-01 00:00:00.000000001'),
    )

    // Act
    const stats = computeSelectionStats(rows, 全体(rows), true)

    // Assert
    expect(stats).toMatchObject({
      extremaOf: 'datetime',
      min: '2023-12-31 23:59:59.500000000',
      max: '2024-03-01 00:00:00.000000001',
      sum: null,
      average: null,
    })
  })

  it('時間帯付きの日時は UTC に直して比べる', () => {
    // Arrange
    const rows = 列(
      時('2024-01-02 08:00:00.000000000 +09:00'),
      時('2024-01-02 00:00:00.000000000 +00:00'),
    )

    // Act
    const stats = computeSelectionStats(rows, 全体(rows), true)

    // Assert
    expect(stats.min).toBe('2024-01-02 08:00:00.000000000 +09:00')
    expect(stats.max).toBe('2024-01-02 00:00:00.000000000 +00:00')
  })

  it('時間帯の有る日時と無い日時が混ざると最小と最大を出さない', () => {
    // Arrange
    const rows = 列(時('2024-01-02 00:00:00'), 時('2024-01-02 00:00:00.000000000 +09:00'))

    // Act
    const stats = computeSelectionStats(rows, 全体(rows), true)

    // Assert
    expect(stats.min).toBeNull()
    expect(stats.extremaOf).toBeNull()
  })

  it('INTERVAL が混ざると日時の最小と最大を出さない', () => {
    // Arrange
    const rows = 列(時('2024-01-02 00:00:00'), 時('+01 00:00:00'))

    // Act
    const stats = computeSelectionStats(rows, 全体(rows), true)

    // Assert
    expect(stats.max).toBeNull()
  })

  it('数値と日時が混ざると最小と最大は数値を比べる', () => {
    // Arrange
    const rows = [[数('7'), 時('2024-01-02 00:00:00')]]

    // Act
    const stats = computeSelectionStats(rows, 全体(rows), true)

    // Assert
    expect(stats).toMatchObject({ extremaOf: 'number', min: '7', max: '7', otherCount: 1 })
  })

  it('選択が読み込み済みの最後の行に届きカーソルが尽きていなければ partial を立てる', () => {
    // Arrange
    const rows = 列(数('1'), 数('2'), 数('3'))

    // Act
    const 末尾まで = computeSelectionStats(rows, { top: 1, bottom: 2, left: 0, right: 0 }, false)
    const 途中まで = computeSelectionStats(rows, { top: 0, bottom: 1, left: 0, right: 0 }, false)
    const 尽きた = computeSelectionStats(rows, 全体(rows), true)

    // Assert
    expect(末尾まで.partial).toBe(true)
    expect(末尾まで.loadedRows).toBe(3)
    expect(途中まで.partial).toBe(false)
    expect(尽きた.partial).toBe(false)
  })

  it('読み込み済みの行より先を指す範囲は行の数で切る', () => {
    // Arrange
    const rows = 列(数('1'), 数('2'))

    // Act
    const stats = computeSelectionStats(rows, { top: 0, bottom: 5, left: 0, right: 0 }, true)

    // Assert
    expect(stats.cellCount).toBe(2)
    expect(stats.sum).toBe('3')
  })
})

describe('parseNumeric', () => {
  it('負の小数を 10 進として読む', () => {
    // Arrange
    const text = '-0.05'

    // Act
    const value = parseNumeric(text)

    // Assert
    expect(value).toEqual({ kind: 'finite', value: { int: -5n, scale: 2 } })
  })

  it('空文字列や区切り入りは読まない', () => {
    // Arrange
    const texts = ['', '1,000', '.5', 'abc']

    // Act
    const values = texts.map(parseNumeric)

    // Assert
    expect(values).toEqual([null, null, null, null])
  })
})

describe('parseDatetime', () => {
  it('紀元前の日付も読める', () => {
    // Arrange
    const 古い = parseDatetime('-4712-01-01 00:00:00')
    const 新しい = parseDatetime('0001-01-01 00:00:00')

    // Act
    const 順序 = 古い !== null && 新しい !== null && 古い.seconds < 新しい.seconds

    // Assert
    expect(順序).toBe(true)
  })

  it('1970-01-01 は 0 秒になる', () => {
    // Arrange
    const text = '1970-01-01 00:00:01.25'

    // Act
    const key = parseDatetime(text)

    // Assert
    expect(key).toEqual({ seconds: 1, nanos: 250_000_000, zoned: false })
  })
})

describe('formatStatValue', () => {
  it('整数部に 3 桁ごとの区切りを入れ、小数部には入れない', () => {
    // Arrange
    const text = '-1234567.891234'

    // Act
    const formatted = formatStatValue(text)

    // Assert
    expect(formatted).toBe('-1,234,567.891234')
  })

  it('38 桁でも区切りを入れる', () => {
    // Arrange
    const text = '1' + '0'.repeat(37)

    // Act
    const formatted = formatStatValue(text)

    // Assert
    expect(formatted).toBe('10,' + '000,'.repeat(11) + '000')
  })

  it('日時と inf はそのまま返す', () => {
    // Arrange
    const texts = ['2024-01-02 00:00:00', 'inf', 'NaN']

    // Act
    const formatted = texts.map(formatStatValue)

    // Assert
    expect(formatted).toEqual(texts)
  })
})

describe('describeStat', () => {
  it('合計の説明は足した数値の件数と、外した NULL と数値でないセルの件数を言う', () => {
    // Arrange
    const rows = [[数('1'), 数('2'), 字('a'), 空, 空]]
    const stats = computeSelectionStats(rows, 全体(rows), true)

    // Act
    const text = describeStat(stats, 'sum')

    // Assert
    expect(text).toContain('数値 2 件')
    expect(text).toContain('NULL 2 件')
    expect(text).toContain('数値でない 1 件')
    expect(text).not.toContain('読み込み済み')
  })

  it('外したセルが無ければ除外の断りを付けない', () => {
    // Arrange
    const rows = 列(数('1'), 数('2'))
    const stats = computeSelectionStats(rows, 全体(rows), true)

    // Act
    const text = describeStat(stats, 'sum')

    // Assert
    expect(text).toContain('数値 2 件')
    expect(text).not.toContain('含みません')
  })

  it('まだ読み込んでいない行へ続くときは読み込み済みの行数を先頭で言う', () => {
    // Arrange
    const rows = 列(数('1'), 数('2'))
    const stats = computeSelectionStats(rows, 全体(rows), false)

    // Act
    const text = describeStat(stats, 'average')

    // Assert
    const [first] = text.split('\n')
    expect(first).toBe(partialNote(2, 'average'))
    expect(first).toContain('2 行')
    expect(text).toContain('数値 2 件')
  })

  it('日時の最小では日時の件数を言い、日時でないセルを外したと言う', () => {
    // Arrange
    const rows = [[時('2024-01-02 00:00:00'), 字('a')]]
    const stats = computeSelectionStats(rows, 全体(rows), true)

    // Act
    const text = describeStat(stats, 'min')

    // Assert
    expect(text).toContain('日時 1 件')
    expect(text).toContain('日時でない 1 件')
    expect(text).not.toContain('数値')
  })

  it('値が無いときは件数ではなく値が無いことを言う', () => {
    // Arrange
    const rows = 列(字('a'), 字('b'))
    const stats = computeSelectionStats(rows, 全体(rows), true)

    // Act
    const sum = describeStat(stats, 'sum')
    const max = describeStat(stats, 'max')

    // Assert
    expect(sum).toContain('ありません')
    expect(max).toContain('ありません')
    expect(max).not.toContain('件')
  })
})

describe('selectedCellCount', () => {
  it('値を読まずに範囲の広さから数え、読み込み済みの行と列で切る', () => {
    // Arrange
    const rows = [
      [数('1'), 数('2')],
      [数('3'), 数('4')],
    ]

    // Act
    const inside = selectedCellCount(rows, { top: 0, bottom: 1, left: 0, right: 1 })
    const beyond = selectedCellCount(rows, { top: 1, bottom: 9, left: 1, right: 5 })

    // Assert
    expect(inside).toBe(4)
    expect(beyond).toBe(1)
  })
})

describe('accumulateRows', () => {
  it('行を分けて足し込んでも一度に数えたときと同じ結果になる', () => {
    // Arrange
    const rows = [
      [数('1.5'), 時('2024-01-01 00:00:00')],
      [数('inf'), 空],
      [数('-3'), 字('x')],
    ]
    const range = 全体(rows)
    const acc = createAccumulator()

    // Act
    accumulateRows(acc, rows, range, 0, 1)
    accumulateRows(acc, rows, range, 1, 3)
    const sliced = finishStats(acc, rows, range, true)

    // Assert
    expect(sliced).toEqual(computeSelectionStats(rows, range, true))
  })
})
