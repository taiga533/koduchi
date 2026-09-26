import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDbApi, setDbApi } from '../api/db'
import { createFakeDbApi } from '../test/fakeDbApi'
import { SQLタブを一枚にする, 接続済みにする, 未接続にする } from '../test/activeConnection'
import type { Ask, AskRequest } from './ask'
import { saveQueryFromEditor } from './savedQuery'

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
    expect(尋ねた).toEqual([{ kind: 'saveQuery', defaultName: '売上', sql: 'select 1 from dual' }])
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
