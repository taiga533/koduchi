import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDbApi, setDbApi } from '../api/db'
import { createFakeDbApi, type FakeCalls } from '../test/fakeDbApi'
import type { HistoryEntry } from '../types/db'
import { HISTORY_LIMIT, outcomeToSucceeded, useHistoryStore } from './history'

/** 履歴 1 件を組み立てる。 */
function 履歴(id: number, sql: string, connectionName: string): HistoryEntry {
  return {
    id,
    sql,
    connectionName,
    startedAt: 1_700_000_000_000 + id,
    elapsedMs: 12,
    rowCount: 3,
    succeeded: true,
    errorMessage: null,
  }
}

const 保存済みの履歴 = [
  履歴(1, 'select * from users', '開発'),
  履歴(2, 'select * from orders', '本番'),
]

let calls: FakeCalls

beforeEach(() => {
  const fake = createFakeDbApi({ history: 保存済みの履歴 })
  calls = fake.calls
  setDbApi(fake.api)
  useHistoryStore.setState({
    entries: [],
    scope: 'connection',
    outcome: 'all',
    search: '',
    connectionName: null,
    error: null,
  })
})

afterEach(() => {
  resetDbApi()
})

describe('outcomeToSucceeded', () => {
  it('すべては成否を問わない', () => {
    // Arrange
    const outcome = 'all' as const

    // Act
    const succeeded = outcomeToSucceeded(outcome)

    // Assert
    expect(succeeded).toBeNull()
  })

  it('成功のみは真で失敗のみは偽になる', () => {
    // Arrange
    const outcomes = ['succeeded', 'failed'] as const

    // Act
    const succeeded = outcomes.map(outcomeToSucceeded)

    // Assert
    expect(succeeded).toEqual([true, false])
  })
})

describe('useHistoryStore', () => {
  it('失敗のみへ切り替えると失敗した履歴を問い合わせ直す', async () => {
    // Arrange
    useHistoryStore.setState({ scope: 'all' })

    // Act
    useHistoryStore.getState().setOutcome('failed')
    await Promise.resolve()

    // Assert
    expect(useHistoryStore.getState().outcome).toBe('failed')
    expect(calls.listHistory.at(-1)?.succeeded).toBe(false)
  })

  it('絞り込みを続けて切り替えると遅れて返った古い応答を捨てる', async () => {
    // Arrange
    const fake = createFakeDbApi({ history: 保存済みの履歴 })
    const 応答待ち: ((entries: HistoryEntry[]) => void)[] = []
    setDbApi({
      ...fake.api,
      listHistory: () => new Promise<HistoryEntry[]>((resolve) => 応答待ち.push(resolve)),
    })
    const 失敗だけ = [{ ...履歴(3, 'select * from nowhere', '開発'), succeeded: false }]

    // Act
    useHistoryStore.getState().setOutcome('all')
    useHistoryStore.getState().setOutcome('failed')
    応答待ち[1](失敗だけ)
    await Promise.resolve()
    応答待ち[0](保存済みの履歴)
    await Promise.resolve()

    // Assert
    expect(useHistoryStore.getState().entries.map((entry) => entry.id)).toEqual([3])
    expect(useHistoryStore.getState().loading).toBe(false)
  })

  it('成否を問わないときは絞り込みを渡さない', async () => {
    // Arrange
    useHistoryStore.setState({ outcome: 'all' })

    // Act
    await useHistoryStore.getState().reload()

    // Assert
    expect(calls.listHistory[0].succeeded).toBeNull()
  })

  it('この接続のみを選ぶと接続名で絞り込む', async () => {
    // Arrange
    useHistoryStore.setState({ scope: 'connection', connectionName: '本番' })

    // Act
    await useHistoryStore.getState().reload()

    // Assert
    expect(calls.listHistory[0].connectionName).toBe('本番')
    expect(useHistoryStore.getState().entries.map((entry) => entry.id)).toEqual([2])
  })

  it('全接続を選ぶと接続名で絞り込まない', async () => {
    // Arrange
    useHistoryStore.setState({ scope: 'all', connectionName: '本番' })

    // Act
    await useHistoryStore.getState().reload()

    // Assert
    expect(calls.listHistory[0].connectionName).toBeNull()
    expect(useHistoryStore.getState().entries).toHaveLength(2)
  })

  it('検索語を空にすると絞り込みを渡さない', async () => {
    // Arrange
    useHistoryStore.setState({ search: '   ' })

    // Act
    await useHistoryStore.getState().reload()

    // Assert
    expect(calls.listHistory[0].search).toBeNull()
  })

  it('検索語は前後の空白を落として渡す', async () => {
    // Arrange
    useHistoryStore.setState({ search: '  users  ', scope: 'all' })

    // Act
    await useHistoryStore.getState().reload()

    // Assert
    expect(calls.listHistory[0].search).toBe('users')
    expect(useHistoryStore.getState().entries).toHaveLength(1)
  })

  it('読み出す件数には上限がある', async () => {
    // Arrange
    useHistoryStore.setState({ scope: 'all' })

    // Act
    await useHistoryStore.getState().reload()

    // Assert
    expect(calls.listHistory[0].limit).toBe(HISTORY_LIMIT)
  })

  it('一件削除すると一覧からも消える', async () => {
    // Arrange
    useHistoryStore.setState({ scope: 'all' })
    await useHistoryStore.getState().reload()

    // Act
    await useHistoryStore.getState().remove(1)

    // Assert
    expect(calls.deleteHistory).toEqual([1])
    expect(useHistoryStore.getState().entries.map((entry) => entry.id)).toEqual([2])
  })

  it('一括削除すると一覧が空になる', async () => {
    // Arrange
    useHistoryStore.setState({ scope: 'all' })
    await useHistoryStore.getState().reload()

    // Act
    await useHistoryStore.getState().clearAll()

    // Assert
    expect(calls.clearHistory).toBe(1)
    expect(useHistoryStore.getState().entries).toEqual([])
  })

  it('読み出しに失敗するとエラーが残る', async () => {
    // Arrange
    setDbApi({
      ...createFakeDbApi().api,
      listHistory: async () => {
        throw new Error('履歴を読めません')
      },
    })

    // Act
    await useHistoryStore.getState().reload()

    // Assert
    expect(useHistoryStore.getState().error).toBe('履歴を読めません')
    expect(useHistoryStore.getState().loading).toBe(false)
  })
})
