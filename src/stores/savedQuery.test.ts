import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDbApi, setDbApi } from '../api/db'
import { createFakeDbApi, type FakeCalls } from '../test/fakeDbApi'
import type { SavedQuery } from '../types/db'
import { SAVED_QUERY_LIMIT, useSavedQueryStore } from './savedQuery'

/** 保存済みクエリ 1 件を組み立てる。 */
function 保存済みクエリ(id: number, name: string, sql: string, connectionName: string): SavedQuery {
  return {
    id,
    name,
    sql,
    connectionName,
    createdAt: 1_700_000_000_000 + id,
    updatedAt: 1_700_000_000_000 + id,
  }
}

const 保存済み一覧 = [
  保存済みクエリ(1, '利用者の一覧', 'select * from users', '開発'),
  保存済みクエリ(2, '注文の一覧', 'select * from orders', '本番'),
]

let calls: FakeCalls

beforeEach(() => {
  const fake = createFakeDbApi({ savedQueries: 保存済み一覧 })
  calls = fake.calls
  setDbApi(fake.api)
  useSavedQueryStore.setState({
    entries: [],
    scope: 'all',
    search: '',
    connectionName: null,
    loading: false,
    error: null,
  })
})

afterEach(() => {
  resetDbApi()
})

describe('useSavedQueryStore', () => {
  it('既定のスコープは全接続である', () => {
    // Arrange
    const 初期状態 = useSavedQueryStore.getState()

    // Act
    const scope = 初期状態.scope

    // Assert
    expect(scope).toBe('all')
  })

  it('この接続のみを選ぶと接続名で絞り込む', async () => {
    // Arrange
    useSavedQueryStore.setState({ scope: 'connection', connectionName: '本番' })

    // Act
    await useSavedQueryStore.getState().reload()

    // Assert
    expect(calls.listSavedQueries[0].connectionName).toBe('本番')
    expect(useSavedQueryStore.getState().entries.map((entry) => entry.id)).toEqual([2])
  })

  it('全接続を選ぶと接続名で絞り込まない', async () => {
    // Arrange
    useSavedQueryStore.setState({ scope: 'all', connectionName: '本番' })

    // Act
    await useSavedQueryStore.getState().reload()

    // Assert
    expect(calls.listSavedQueries[0].connectionName).toBeNull()
    expect(useSavedQueryStore.getState().entries).toHaveLength(2)
  })

  it('検索語は前後の空白を落として渡す', async () => {
    // Arrange
    useSavedQueryStore.setState({ search: '  注文  ' })

    // Act
    await useSavedQueryStore.getState().reload()

    // Assert
    expect(calls.listSavedQueries[0].search).toBe('注文')
    expect(useSavedQueryStore.getState().entries).toHaveLength(1)
  })

  it('検索語を空にすると絞り込みを渡さない', async () => {
    // Arrange
    useSavedQueryStore.setState({ search: '   ' })

    // Act
    await useSavedQueryStore.getState().reload()

    // Assert
    expect(calls.listSavedQueries[0].search).toBeNull()
  })

  it('読み出す件数には上限がある', async () => {
    // Arrange
    useSavedQueryStore.setState({ scope: 'all' })

    // Act
    await useSavedQueryStore.getState().reload()

    // Assert
    expect(calls.listSavedQueries[0].limit).toBe(SAVED_QUERY_LIMIT)
  })

  it('保存すると接続名と sql を添えて渡し読み直す', async () => {
    // Arrange
    useSavedQueryStore.setState({ scope: 'all' })

    // Act
    await useSavedQueryStore.getState().save('今日の売上', 'select * from sales', '開発')

    // Assert
    expect(calls.createSavedQuery).toHaveLength(1)
    expect(calls.createSavedQuery[0].name).toBe('今日の売上')
    expect(calls.createSavedQuery[0].sql).toBe('select * from sales')
    expect(calls.createSavedQuery[0].connectionName).toBe('開発')
    expect(calls.listSavedQueries).toHaveLength(1)
  })

  it('名前を変えても sql は元のまま渡す', async () => {
    // Arrange
    await useSavedQueryStore.getState().reload()

    // Act
    await useSavedQueryStore.getState().rename(1, '利用者の一覧（改）')

    // Assert
    expect(calls.updateSavedQuery).toHaveLength(1)
    expect(calls.updateSavedQuery[0].name).toBe('利用者の一覧（改）')
    expect(calls.updateSavedQuery[0].sql).toBe('select * from users')
  })

  it('一件削除すると一覧からも消える', async () => {
    // Arrange
    await useSavedQueryStore.getState().reload()

    // Act
    await useSavedQueryStore.getState().remove(1)

    // Assert
    expect(calls.deleteSavedQuery).toEqual([1])
    expect(useSavedQueryStore.getState().entries.map((entry) => entry.id)).toEqual([2])
  })

  it('読み出しに失敗するとエラーが残る', async () => {
    // Arrange
    setDbApi({
      ...createFakeDbApi().api,
      listSavedQueries: async () => {
        throw new Error('保存済みクエリを読めません')
      },
    })

    // Act
    await useSavedQueryStore.getState().reload()

    // Assert
    expect(useSavedQueryStore.getState().error).toBe('保存済みクエリを読めません')
    expect(useSavedQueryStore.getState().loading).toBe(false)
  })
})
