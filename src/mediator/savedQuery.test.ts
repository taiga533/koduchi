import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDbApi, setDbApi } from '../api/db'
import { createFakeDbApi } from '../test/fakeDbApi'
import { SQLタブを一枚にする, 接続済みにする, 未接続にする } from '../test/activeConnection'
import type { HistoryEntry, SavedQuery } from '../types/db'
import type { Ask, AskRequest } from './ask'
import { nameFromSql, saveQueryFromEditor, saveQueryFromHistory } from './savedQuery'

beforeEach(() => {
  接続済みにする()
})

afterEach(() => {
  resetDbApi()
})

/**
 * 名前を尋ねられたら決めた名前を返す尋ね方を作る。
 *
 * @param 名前 返す名前。`null` なら取り消し
 * @param 尋ねている間に 答える前に起こすこと
 */
function 尋ね方(
  名前: string | null,
  尋ねている間に: () => void = () => {},
): { ask: Ask; 尋ねた: AskRequest[] } {
  const 尋ねた: AskRequest[] = []
  const ask = (async (request: AskRequest) => {
    尋ねた.push(request)
    尋ねている間に()
    return 名前
  }) as Ask
  return { ask, 尋ねた }
}

describe('saveQueryFromEditor', () => {
  it('タブの名前を既定にして尋ね、決まった名前で接続名を添えて保存する', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    SQLタブを一枚にする({ name: '売上.sql', content: 'select 1 from dual' })
    const { ask, 尋ねた } = 尋ね方('売上集計')

    // Act
    await saveQueryFromEditor({ offset: 0, selectedText: null }, ask)

    // Assert
    expect(尋ねた).toEqual([
      { kind: 'saveQuery', defaultName: '売上', sql: 'select 1 from dual', existingName: null },
    ])
    expect(calls.createSavedQuery).toMatchObject([
      { name: '売上集計', sql: 'select 1 from dual', connectionName: 'dev' },
    ])
  })

  it('選択があれば選択した文字列だけを保存する', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    SQLタブを一枚にする({ content: 'select 1 from dual;\nselect 2 from dual' })

    // Act
    await saveQueryFromEditor({ offset: 0, selectedText: 'select 2 from dual' }, 尋ね方('二').ask)

    // Assert
    expect(calls.createSavedQuery).toMatchObject([{ sql: 'select 2 from dual' }])
  })

  it('空白だけのタブでは尋ねない', async () => {
    // Arrange
    setDbApi(createFakeDbApi().api)
    SQLタブを一枚にする({ content: '  \n' })
    const { ask, 尋ねた } = 尋ね方('名前')

    // Act
    await saveQueryFromEditor({ offset: 0, selectedText: null }, ask)

    // Assert
    expect(尋ねた).toEqual([])
  })

  it('取り消されたら保存しない', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    SQLタブを一枚にする({ content: 'select 1 from dual' })

    // Act
    await saveQueryFromEditor({ offset: 0, selectedText: null }, 尋ね方(null).ask)

    // Assert
    expect(calls.createSavedQuery).toEqual([])
  })

  it('尋ねている間に切断されたら保存しない', async () => {
    // Arrange: 添える接続名が無い
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    SQLタブを一枚にする({ content: 'select 1 from dual' })

    // Act
    await saveQueryFromEditor({ offset: 0, selectedText: null }, 尋ね方('名前', 未接続にする).ask)

    // Assert
    expect(calls.createSavedQuery).toEqual([])
  })
})

/** 履歴 1 件を組み立てる。 */
function 履歴(sql: string, connectionName = '本番'): HistoryEntry {
  return {
    id: 1,
    sql,
    connectionName,
    startedAt: 1_700_000_000_000,
    elapsedMs: 3,
    rowCount: 1,
    succeeded: true,
    errorMessage: null,
  }
}

/** 保存済みクエリ 1 件を組み立てる。 */
function 保存済み(name: string, sql: string): SavedQuery {
  return { id: 9, name, sql, connectionName: '開発', createdAt: 0, updatedAt: 0 }
}

describe('saveQueryFromHistory', () => {
  it('1 行目を既定の名前にして尋ね、履歴の接続名を添えて保存する', async () => {
    // Arrange: 今の接続は dev、履歴は本番のもの
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    const { ask, 尋ねた } = 尋ね方('月次の売上')

    // Act
    const 名前 = await saveQueryFromHistory(履歴('select *\n  from sales'), ask)

    // Assert
    expect(尋ねた).toEqual([
      {
        kind: 'saveQuery',
        defaultName: 'select *',
        sql: 'select *\n  from sales',
        existingName: null,
      },
    ])
    expect(calls.createSavedQuery).toMatchObject([
      { name: '月次の売上', sql: 'select *\n  from sales', connectionName: '本番' },
    ])
    expect(名前).toBe('月次の売上')
  })

  it('同じ sql が保存済みならその名前を添えて尋ね、保存は止めない', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi({
      savedQueries: [保存済み('売上', 'select * from sales')],
    })
    setDbApi(api)
    const { ask, 尋ねた } = 尋ね方('売上その2')

    // Act
    await saveQueryFromHistory(履歴('select * from sales'), ask)

    // Assert
    expect(尋ねた[0]).toMatchObject({ existingName: '売上' })
    expect(calls.createSavedQuery).toHaveLength(1)
  })

  it('尋ねている間に切断されても履歴の接続名で保存する', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)

    // Act
    await saveQueryFromHistory(履歴('select 1 from dual'), 尋ね方('名前', 未接続にする).ask)

    // Assert
    expect(calls.createSavedQuery).toMatchObject([{ connectionName: '本番' }])
  })

  it('取り消されたら保存せず null を返す', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)

    // Act
    const 名前 = await saveQueryFromHistory(履歴('select 1 from dual'), 尋ね方(null).ask)

    // Assert
    expect(名前).toBeNull()
    expect(calls.createSavedQuery).toEqual([])
  })

  it('保存に失敗したら null を返す', async () => {
    // Arrange
    setDbApi({
      ...createFakeDbApi().api,
      createSavedQuery: async () => {
        throw new Error('書き込めません')
      },
    })

    // Act
    const 名前 = await saveQueryFromHistory(履歴('select 1 from dual'), 尋ね方('名前').ask)

    // Assert
    expect(名前).toBeNull()
  })
})

describe('nameFromSql', () => {
  it('空行を飛ばした最初の行を空白を詰めて使う', () => {
    // Arrange
    const sql = '\n   select  a,\tb\nfrom t'

    // Act
    const 名前 = nameFromSql(sql)

    // Assert
    expect(名前).toBe('select a, b')
  })

  it('長い行は 40 文字で切って省略の印を付ける', () => {
    // Arrange
    const sql = 'x'.repeat(50)

    // Act
    const 名前 = nameFromSql(sql)

    // Assert
    expect(名前).toBe(`${'x'.repeat(40)}…`)
  })

  it('空白だけなら空にする', () => {
    // Arrange
    const sql = ' \n '

    // Act
    const 名前 = nameFromSql(sql)

    // Assert
    expect(名前).toBe('')
  })
})
