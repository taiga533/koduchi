import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDbApi, setDbApi } from '../api/db'
import { resetDialogApi, setDialogApi } from '../api/dialog'
import type { CsvExportState } from '../components/csv/CsvSaveDialog'
import { createFakeDbApi } from '../test/fakeDbApi'
import { createFakeDialogApi } from '../test/fakeDialogApi'
import { SQLタブを一枚にする, 接続済みにする } from '../test/activeConnection'
import { emptyExecution, useExecutionStore } from '../stores/execution'
import { useUiStore } from '../stores/ui'
import { defaultCsvOptions } from '../types/db'
import type { CsvExportScreen } from './csv'
import { exportActiveResult } from './csv'

beforeEach(() => {
  useExecutionStore.getState().clear()
  useUiStore.setState({ csvOptions: defaultCsvOptions })
  接続済みにする()
  SQLタブを一枚にする({ name: '売上.sql' })
})

afterEach(() => {
  resetDbApi()
  resetDialogApi()
})

/** 読み切った 2 行の結果をタブに置く。 */
function 結果を置く(): void {
  useExecutionStore.setState({
    byTab: {
      'sql-1': {
        ...emptyExecution,
        status: 'succeeded',
        columns: [{ name: 'N', typeName: 'NUMBER', kind: 'number' }],
        rows: [[{ text: '1', kind: 'number' }], [{ text: '2', kind: 'number', truncated: true }]],
        exhausted: true,
      },
    },
  })
}

/**
 * 報せを記録する画面を作る。
 *
 * @param 中止した 中止されたことにするか
 */
function 画面(中止した = false): CsvExportScreen & { 報せ: CsvExportState[] } {
  const 報せ: CsvExportState[] = []
  return { 報せ, report: (state) => 報せ.push(state), isCancelled: () => 中止した }
}

describe('exportActiveResult', () => {
  it('結果が無ければ保存先を尋ねずにそう告げる', async () => {
    // Arrange
    setDbApi(createFakeDbApi().api)
    const dialog = createFakeDialogApi({ savePath: '/tmp/a.csv' })
    setDialogApi(dialog.api)
    const screen = 画面()

    // Act
    await exportActiveResult(screen)

    // Assert
    expect(dialog.calls.save).toEqual([])
    expect(screen.報せ).toEqual([{ rows: 0, done: true, error: '書き出せる結果がありません' }])
  })

  it('タブの名前を既定にして保存先を選ばせ、書いた行数と切れたセルの数を告げる', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    const dialog = createFakeDialogApi({ savePath: '/tmp/売上.csv' })
    setDialogApi(dialog.api)
    結果を置く()
    const screen = 画面()

    // Act
    await exportActiveResult(screen)

    // Assert
    expect(dialog.calls.save[0].defaultPath).toBe('売上.csv')
    expect(calls.csvStart[0].path).toBe('/tmp/売上.csv')
    expect(calls.csvStart[0].options).toEqual(defaultCsvOptions)
    expect(screen.報せ.at(-1)).toEqual({ rows: 2, done: true, error: null, truncatedCells: 1 })
  })

  it('保存先を選ばずに閉じたら書き出さない', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    setDialogApi(createFakeDialogApi({ savePath: null }).api)
    結果を置く()
    const screen = 画面()

    // Act
    await exportActiveResult(screen)

    // Assert
    expect(calls.csvStart).toEqual([])
    expect(screen.報せ).toEqual([])
  })

  it('書き出しに失敗したらその理由を告げる', async () => {
    // Arrange
    const { api } = createFakeDbApi()
    setDbApi({
      ...api,
      csvStart: async () => {
        throw new Error('書き込めません')
      },
    })
    setDialogApi(createFakeDialogApi({ savePath: '/tmp/a.csv' }).api)
    結果を置く()
    const screen = 画面()

    // Act
    await exportActiveResult(screen)

    // Assert
    expect(screen.報せ.at(-1)).toEqual({ rows: 0, done: true, error: '書き込めません' })
  })
})
