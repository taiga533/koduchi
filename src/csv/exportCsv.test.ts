import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDbApi, setDbApi } from '../api/db'
import { createFakeDbApi, type FakeCalls } from '../test/fakeDbApi'
import type { Cell, Chunk, Column, CsvOptions } from '../types/db'
import { defaultCsvOptions } from '../types/db'
import { exportCsv } from './exportCsv'

/** 数値セルを 1 つ作る。 */
function セル(text: string): Cell {
  return { text, kind: 'number' }
}

/** 連番の行を作る。 */
function 行(from: number, count: number): Cell[][] {
  return Array.from({ length: count }, (_, index) => [セル(String(from + index))])
}

const 列: Column[] = [{ name: 'N', typeName: 'NUMBER(38,0)', kind: 'number' }]

const 書式: CsvOptions = defaultCsvOptions

let calls: FakeCalls

/** 何もしない進捗の受け口。 */
const 進捗を捨てる = { onProgress: () => {}, isCancelled: () => false }

beforeEach(() => {
  const fake = createFakeDbApi()
  calls = fake.calls
  setDbApi(fake.api)
})

afterEach(() => {
  resetDbApi()
})

describe('exportCsv', () => {
  it('尽きている結果は読み込み済みの行だけを書き出す', async () => {
    // Arrange
    const request = {
      connectionId: 'c1',
      tabId: 't1',
      path: '/tmp/out.csv',
      columns: 列,
      initialRows: 行(1, 3),
      exhausted: true,
      options: 書式,
    }

    // Act
    const result = await exportCsv(request, 進捗を捨てる)

    // Assert
    expect(result).toEqual({ status: 'completed', rows: 3 })
    expect(calls.fetchMore).toHaveLength(0)
    expect(calls.csvStart[0].columns).toEqual(列)
    expect(calls.csvFinish).toHaveLength(1)
  })

  it('尽きていなければカーソルを最後まで読み進める', async () => {
    // Arrange
    const 続き: Chunk[] = [
      { rows: 行(4, 2), exhausted: false },
      { rows: 行(6, 1), exhausted: true },
    ]
    const fake = createFakeDbApi({ onFetchMore: () => 続き.shift()! })
    calls = fake.calls
    setDbApi(fake.api)

    // Act
    const result = await exportCsv(
      {
        connectionId: 'c1',
        tabId: 't1',
        path: '/tmp/out.csv',
        columns: 列,
        initialRows: 行(1, 3),
        exhausted: false,
        options: 書式,
      },
      進捗を捨てる,
    )

    // Assert
    expect(calls.fetchMore).toHaveLength(2)
    expect(result).toEqual({ status: 'completed', rows: 6 })
  })

  it('書けた行数を書き出しのたびに知らせる', async () => {
    // Arrange
    const 続き: Chunk[] = [{ rows: 行(4, 2), exhausted: true }]
    setDbApi(createFakeDbApi({ onFetchMore: () => 続き.shift()! }).api)
    const 進捗: number[] = []

    // Act
    await exportCsv(
      {
        connectionId: 'c1',
        tabId: 't1',
        path: '/tmp/out.csv',
        columns: 列,
        initialRows: 行(1, 3),
        exhausted: false,
        options: 書式,
      },
      { onProgress: (rows) => 進捗.push(rows), isCancelled: () => false },
    )

    // Assert
    expect(進捗).toEqual([3, 5])
  })

  it('中止すると書きかけのファイルを消して途中の行数を返す', async () => {
    // Arrange
    const fake = createFakeDbApi({ onFetchMore: () => ({ rows: 行(4, 2), exhausted: false }) })
    calls = fake.calls
    setDbApi(fake.api)

    // Act
    const result = await exportCsv(
      {
        connectionId: 'c1',
        tabId: 't1',
        path: '/tmp/out.csv',
        columns: 列,
        initialRows: 行(1, 3),
        exhausted: false,
        options: 書式,
      },
      { onProgress: () => {}, isCancelled: () => true },
    )

    // Assert
    expect(result).toEqual({ status: 'cancelled', rows: 3 })
    expect(calls.csvAbort).toHaveLength(1)
    expect(calls.csvFinish).toHaveLength(0)
  })

  it('途中で失敗しても書きかけのファイルは残さない', async () => {
    // Arrange
    const fake = createFakeDbApi()
    calls = fake.calls
    setDbApi({
      ...fake.api,
      fetchMore: async () => {
        throw new Error('結果は破棄されました')
      },
    })

    // Act
    const 実行 = exportCsv(
      {
        connectionId: 'c1',
        tabId: 't1',
        path: '/tmp/out.csv',
        columns: 列,
        initialRows: [],
        exhausted: false,
        options: 書式,
      },
      進捗を捨てる,
    )

    // Assert
    await expect(実行).rejects.toThrow('結果は破棄されました')
    expect(calls.csvAbort).toHaveLength(1)
  })

  it('選んだ書式をそのまま渡す', async () => {
    // Arrange
    const options: CsvOptions = {
      delimiter: 'tab',
      encoding: 'shiftJis',
      nullText: 'word',
    }

    // Act
    await exportCsv(
      {
        connectionId: 'c1',
        tabId: 't1',
        path: '/tmp/out.csv',
        columns: 列,
        initialRows: [],
        exhausted: true,
        options,
      },
      進捗を捨てる,
    )

    // Assert
    expect(calls.csvStart[0].options).toEqual(options)
  })
})
