import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDbApi, setDbApi } from '../api/db'
import { createFakeDbApi } from '../test/fakeDbApi'
import { 接続済みにする, 未接続にする } from '../test/activeConnection'
import { nodeKey, useSchemaStore } from '../stores/schema'
import { useUiStore } from '../stores/ui'
import { reloadSchemas, revealSchemaObject } from './schema'

beforeEach(() => {
  useSchemaStore.getState().clear()
  useUiStore.setState({ sidebarSegment: 'history' })
  接続済みにする()
})

afterEach(() => {
  resetDbApi()
})

describe('revealSchemaObject', () => {
  it('スキーマの面へ切り替え、スキーマを開いてオブジェクトの名前で絞り込む', () => {
    // Arrange: 準備は beforeEach の履歴の面

    // Act
    revealSchemaObject('KODUCHI', 'USERS')

    // Assert
    expect(useUiStore.getState().sidebarSegment).toBe('schema')
    expect(useSchemaStore.getState().search).toBe('USERS')
    expect(useSchemaStore.getState().expanded[nodeKey('KODUCHI')]).toBe(true)
  })

  it('既に開いているスキーマは畳まない', () => {
    // Arrange
    useSchemaStore.getState().toggle(nodeKey('KODUCHI'), true)

    // Act
    revealSchemaObject('KODUCHI', null)

    // Assert
    expect(useSchemaStore.getState().expanded[nodeKey('KODUCHI')]).toBe(true)
    expect(useSchemaStore.getState().search).toBe('KODUCHI')
  })
})

describe('reloadSchemas', () => {
  it('今の接続のスキーマを取り直す', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)

    // Act
    reloadSchemas()

    // Assert
    await expect.poll(() => calls.schemaOverview.map((call) => call.id)).toEqual(['c1'])
  })

  it('繋がっていなければ取りにいかない', () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    未接続にする()

    // Act
    reloadSchemas()

    // Assert
    expect(calls.schemaOverview).toEqual([])
  })
})
