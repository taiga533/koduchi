import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { resetDbApi, setDbApi } from '../../api/db'
import { createFakeDbApi, type FakeCalls } from '../../test/fakeDbApi'
import type { HistoryEntry } from '../../types/db'
import { useHistoryStore } from '../../stores/history'
import { HistoryList } from './HistoryList'

const 履歴一覧: HistoryEntry[] = [
  {
    id: 1,
    sql: 'select * from users\nwhere id = 1',
    connectionName: '開発',
    startedAt: 1_700_000_000_000,
    elapsedMs: 84,
    rowCount: 142,
    succeeded: true,
    errorMessage: null,
  },
  {
    id: 2,
    sql: 'select * from nowhere',
    connectionName: '開発',
    startedAt: 1_700_000_001_000,
    elapsedMs: 3,
    rowCount: null,
    succeeded: false,
    errorMessage: 'ORA-00942',
  },
]

let calls: FakeCalls

beforeEach(() => {
  const fake = createFakeDbApi({ history: 履歴一覧 })
  calls = fake.calls
  setDbApi(fake.api)
  useHistoryStore.setState({ entries: 履歴一覧, scope: 'connection', search: '', error: null })
})

afterEach(() => {
  resetDbApi()
})

describe('HistoryList', () => {
  it('sql の 1 行目と行数と所要時間が並ぶ', () => {
    // Arrange
    render(<HistoryList onUse={() => {}} />)

    // Act
    const 一件目 = screen.getByText('select * from users')

    // Assert
    expect(一件目).toBeInTheDocument()
    expect(screen.getByText('142 行 · 84 ms')).toBeInTheDocument()
  })

  it('失敗した実行には失敗と出る', () => {
    // Arrange
    render(<HistoryList onUse={() => {}} />)

    // Act
    const 失敗 = screen.getByText('失敗')

    // Assert
    expect(失敗).toBeInTheDocument()
  })

  it('履歴を押すと sql を渡す', async () => {
    // Arrange
    const 渡された: string[] = []
    render(<HistoryList onUse={(sql) => 渡された.push(sql)} />)

    // Act
    await userEvent.click(screen.getByText('select * from users'))

    // Assert
    expect(渡された).toEqual(['select * from users\nwhere id = 1'])
  })

  it('一件ごとに削除できる', async () => {
    // Arrange
    render(<HistoryList onUse={() => {}} />)

    // Act
    await userEvent.click(screen.getAllByRole('button', { name: 'この履歴を削除' })[0])

    // Assert
    expect(calls.deleteHistory).toEqual([1])
  })

  it('スコープを全接続へ切り替えられる', async () => {
    // Arrange
    render(<HistoryList onUse={() => {}} />)

    // Act
    await userEvent.click(screen.getByRole('button', { name: '全接続' }))

    // Assert
    expect(useHistoryStore.getState().scope).toBe('all')
  })

  it('履歴が無ければ空状態を出す', () => {
    // Arrange
    useHistoryStore.setState({ entries: [], loading: false })

    // Act
    render(<HistoryList onUse={() => {}} />)

    // Assert
    expect(screen.getByText('実行した SQL がここに残ります')).toBeInTheDocument()
  })
})
