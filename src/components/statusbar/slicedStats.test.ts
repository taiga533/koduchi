/**
 * 大きな選択の集計を細切れに走らせることのテスト（ADR 0049）。
 *
 * 後回しの関数は手で進める。時間に頼らず、何回に分けて数えたかと、途中で止めたら
 * 結果が届かないことを見る。壁時計の時間は見ない（実行環境の速さで結果が変わる）。実測値は ADR 0049 にある。
 */

import { describe, expect, it } from 'vitest'
import type { Cell } from '../../types/db'
import { computeSelectionStats } from '../results/selectionStats'
import type { SelectionStats } from '../results/selectionStats'
import { rowsPerSlice, SLICE_CELLS, startSlicedStats } from './slicedStats'

/**
 * 38 桁の数値だけの結果を作る。いちばん重い値で見張るためである。
 *
 * @param rowCount 行の数
 * @param width 列の数
 */
function 重い結果(rowCount: number, width: number): Cell[][] {
  return Array.from({ length: rowCount }, (_row, row) =>
    Array.from({ length: width }, (_column, column) => ({
      text: `${String(row * width + column).padStart(18, '1')}.${'7'.repeat(20)}`,
      kind: 'number' as const,
    })),
  )
}

/** 後回しにされた仕事を溜め、手で 1 つずつ進める。 */
function 手で進める() {
  const queue: (() => void)[] = []
  return {
    schedule: (work: () => void) => {
      queue.push(work)
    },
    /** 溜まった仕事を 1 つ走らせる。走らせたら真。 */
    step: () => {
      const work = queue.shift()
      work?.()
      return work !== undefined
    },
  }
}

describe('startSlicedStats', () => {
  it('20 万セルを 1 万セルずつ 20 回に分けて数え、一度に数えたときと同じ結果を返す', () => {
    // Arrange
    const rows = 重い結果(20_000, 10)
    const range = { top: 0, bottom: 19_999, left: 0, right: 9 }
    const 進め手 = 手で進める()
    let result: SelectionStats | null = null

    // Act
    startSlicedStats({ rows, range, exhausted: true }, (stats) => (result = stats), 進め手.schedule)
    let steps = 0
    while (進め手.step()) {
      steps++
    }

    // Assert
    expect(steps).toBe(20)
    expect(result).toEqual(computeSelectionStats(rows, range, true))
  })

  it('最初のかたまりもその場では数えない', () => {
    // Arrange
    const rows = 重い結果(10, 2)
    const 進め手 = 手で進める()
    let done = false

    // Act
    startSlicedStats(
      { rows, range: { top: 0, bottom: 9, left: 0, right: 1 }, exhausted: true },
      () => (done = true),
      進め手.schedule,
    )

    // Assert
    expect(done).toBe(false)
    expect(進め手.step()).toBe(true)
    expect(done).toBe(true)
  })

  it('止めたら残りを数えず結果も届けない', () => {
    // Arrange
    const rows = 重い結果(3_000, 10)
    const 進め手 = 手で進める()
    let done = false
    const stop = startSlicedStats(
      { rows, range: { top: 0, bottom: 2_999, left: 0, right: 9 }, exhausted: true },
      () => (done = true),
      進め手.schedule,
    )
    進め手.step()

    // Act
    stop()
    const 続きがあった = 進め手.step()

    // Assert
    expect(続きがあった).toBe(true)
    expect(進め手.step()).toBe(false)
    expect(done).toBe(false)
  })
})

describe('rowsPerSlice', () => {
  it('1 かたまりのセルの数が SLICE_CELLS を超えない行数を返し、列が多すぎても 1 行は数える', () => {
    // Arrange
    const widths = [1, 3, 7, 10, 20_000]

    // Act
    const cells = widths.map((width) => rowsPerSlice(width) * width)

    // Assert
    expect(cells.slice(0, 4).every((count) => count <= SLICE_CELLS)).toBe(true)
    expect(rowsPerSlice(20_000)).toBe(1)
  })
})

describe('SLICE_CELLS の上限', () => {
  it('1 回の処理で数えるセルの数が SLICE_CELLS を超えない', () => {
    // Arrange: 行を読むたびに数える器で包み、1 回の処理ごとに読んだ行の数を測る。
    // 列の数は割り切れない 7 にして、端数のかたまりも見る。
    const width = 7
    const rows = 重い結果(5_000, width)
    let 読んだ行 = 0
    const 見張り = new Proxy(rows, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) {
          読んだ行++
        }
        return Reflect.get(target, key, receiver)
      },
    })
    const 進め手 = 手で進める()
    const 各回のセル数: number[] = []
    startSlicedStats(
      {
        rows: 見張り,
        range: { top: 0, bottom: 4_999, left: 0, right: width - 1 },
        exhausted: true,
      },
      () => {},
      進め手.schedule,
    )

    // Act
    for (;;) {
      読んだ行 = 0
      if (!進め手.step()) {
        break
      }
      各回のセル数.push(読んだ行 * width)
    }

    // Assert
    expect(各回のセル数.length).toBe(Math.ceil(5_000 / rowsPerSlice(width)))
    expect(Math.max(...各回のセル数)).toBeLessThanOrEqual(SLICE_CELLS)
    expect(各回のセル数.reduce((a, b) => a + b, 0)).toBe(5_000 * width)
  })
})
