import { afterEach, describe, expect, it } from 'vitest'
import { getDbApi, resetDbApi } from '../../src/api/db'
import { createDesignDbApi, installBrowserApis } from './browserApis'

/** 約束が決着したかを、マイクロタスクを一巡させてから見る。 */
async function settles(promise: Promise<unknown>): Promise<boolean> {
  let settled = false
  promise.then(
    () => (settled = true),
    () => (settled = true),
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  return settled
}

describe('createDesignDbApi', () => {
  it('渡したメソッドは渡した答えを返す', async () => {
    // Arrange
    const api = createDesignDbApi({ listSavedQueries: async () => [] })

    // Act
    const result = await api.listSavedQueries({ connectionName: null, search: null, limit: 10 })

    // Assert
    expect(result).toEqual([])
  })

  it('渡さなかったメソッドも本物の窓口と同じ名前で揃い、呼ぶと決着しない', async () => {
    // Arrange
    const names = Object.keys(getDbApi())
    const api = createDesignDbApi({})

    // Act
    const pending = api.listHistory({ connectionName: null, search: null, limit: 10 })

    // Assert
    expect(Object.keys(api).toSorted()).toEqual(names.toSorted())
    expect(await settles(pending)).toBe(false)
  })
})

describe('installBrowserApis', () => {
  afterEach(() => {
    resetDbApi()
  })

  it('Tauri の外では DB の窓口を決着しない代役へ差し替える', async () => {
    // Arrange（jsdom には Tauri の IPC が無い）

    // Act
    installBrowserApis()
    const pending = getDbApi().loadAppSettings()

    // Assert
    expect(await settles(pending)).toBe(false)
  })
})
