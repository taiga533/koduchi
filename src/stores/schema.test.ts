import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDbApi, setDbApi } from '../api/db'
import { createFakeDbApi, type FakeCalls } from '../test/fakeDbApi'
import type { SchemaNode, TableColumn } from '../types/db'
import { defaultSchemaFilter } from '../types/db'
import {
  filterSchemas,
  formatColumnProgress,
  kindGroupKey,
  nodeKey,
  useSchemaStore,
} from './schema'

/** スキーマ 1 つを組み立てる。 */
function スキーマ(name: string, objects: string[]): SchemaNode {
  return {
    name,
    objectCount: objects.length,
    objects: objects.map((objectName) => ({ name: objectName, kind: 'table' as const })),
  }
}

/** 列 1 つを組み立てる。 */
function 列(objectName: string, name: string): TableColumn {
  return {
    objectName,
    name,
    typeName: 'NUMBER(12)',
    nullable: false,
    kind: 'number',
  }
}

const スキーマ一覧 = [
  スキーマ('KODUCHI', ['USERS', 'ORDERS']),
  スキーマ('ANALYTICS', ['DAILY_GMV']),
]

const 列一覧: Record<string, TableColumn[]> = {
  KODUCHI: [列('USERS', 'USER_ID'), 列('USERS', 'EMAIL'), 列('ORDERS', 'ORDER_ID')],
  ANALYTICS: [列('DAILY_GMV', 'REVENUE')],
}

let calls: FakeCalls

beforeEach(() => {
  const fake = createFakeDbApi({ schemas: スキーマ一覧, columns: 列一覧 })
  calls = fake.calls
  setDbApi(fake.api)
  useSchemaStore.getState().clear()
})

afterEach(() => {
  resetDbApi()
})

describe('useSchemaStore', () => {
  it('取得すると段階 1 のスキーマが並び段階 2 の列も流し込まれる', async () => {
    // Arrange
    // beforeEach で窓口を差し替えてある

    // Act
    await useSchemaStore.getState().load('c1')

    // Assert
    const state = useSchemaStore.getState()
    expect(state.status).toBe('ready')
    expect(state.schemas.map((schema) => schema.name)).toEqual(['KODUCHI', 'ANALYTICS'])
    expect(state.columns.KODUCHI).toHaveLength(3)
    expect(state.columnStatus).toBe('ready')
  })

  it('既定のフィルタを付けて取得する', async () => {
    // Arrange
    // beforeEach で状態を初期化してある

    // Act
    await useSchemaStore.getState().load('c1')

    // Assert
    expect(calls.schemaOverview[0].filter).toEqual(defaultSchemaFilter)
  })

  it('取得済みなら二度目の読み込みは走らない', async () => {
    // Arrange
    await useSchemaStore.getState().load('c1')

    // Act
    await useSchemaStore.getState().load('c1')

    // Assert
    expect(calls.schemaOverview).toHaveLength(1)
  })

  it('フィルタを変えると取得し直す', async () => {
    // Arrange
    await useSchemaStore.getState().load('c1')

    // Act
    await useSchemaStore
      .getState()
      .setFilter('c1', { ...defaultSchemaFilter, excludeSystem: false, hideEmpty: false })

    // Assert
    expect(calls.schemaOverview).toHaveLength(2)
    expect(calls.schemaOverview[1].filter).toEqual({
      ...defaultSchemaFilter,
      excludeSystem: false,
      hideEmpty: false,
    })
  })

  it('再読み込みすると取得し直す', async () => {
    // Arrange
    await useSchemaStore.getState().load('c1')

    // Act
    await useSchemaStore.getState().reload('c1')

    // Assert
    expect(calls.schemaOverview).toHaveLength(2)
    expect(useSchemaStore.getState().schemas).toHaveLength(2)
  })

  it('再読み込みしても開閉と絞り込み語は残る', async () => {
    // Arrange: 更新のたびに全部畳まれるのでは使いものにならない
    await useSchemaStore.getState().load('c1')
    useSchemaStore.getState().toggle(nodeKey('KODUCHI'), true)
    useSchemaStore.getState().setSearch('USERS')

    // Act
    await useSchemaStore.getState().reload('c1')

    // Assert
    const state = useSchemaStore.getState()
    expect(state.expanded[nodeKey('KODUCHI')]).toBe(true)
    expect(state.search).toBe('USERS')
  })

  it('再読み込みしても絞り込みの条件は変わらない', async () => {
    // Arrange
    await useSchemaStore
      .getState()
      .setFilter('c1', { ...defaultSchemaFilter, excludeSystem: false })

    // Act
    await useSchemaStore.getState().reload('c1')

    // Assert
    expect(calls.schemaOverview[1].filter.excludeSystem).toBe(false)
  })

  it('段階 2 の途中で再読み込みしても古い列は流れ込まない', async () => {
    // Arrange: 先に始めた取得の列が、後から新しいスキーマへ書き込まれてはならない
    let 古い列を返す!: (columns: TableColumn[]) => void
    const 古い列 = new Promise<TableColumn[]>((resolve) => {
      古い列を返す = resolve
    })
    let 古い取得が始まった!: () => void
    const 古い取得の開始 = new Promise<void>((resolve) => {
      古い取得が始まった = resolve
    })
    let 何回目 = 0
    setDbApi({
      ...createFakeDbApi().api,
      schemaOverview: async () => [スキーマ('KODUCHI', ['USERS'])],
      schemaColumns: async () => {
        何回目 += 1
        if (何回目 === 1) {
          古い取得が始まった()
          return 古い列
        }
        return [列('USERS', '新しい列')]
      },
    })
    const 途中の取得 = useSchemaStore.getState().load('c1')
    await 古い取得の開始

    // Act
    await useSchemaStore.getState().reload('c1')
    古い列を返す([列('USERS', '古い列')])
    await 途中の取得

    // Assert
    expect(useSchemaStore.getState().columns.KODUCHI?.map((column) => column.name)).toEqual([
      '新しい列',
    ])
  })

  it('列の取得に失敗しても残りのスキーマは読み込む', async () => {
    // Arrange
    setDbApi({
      ...createFakeDbApi({ schemas: スキーマ一覧 }).api,
      schemaOverview: async () => スキーマ一覧,
      schemaColumns: async (_id, owner) => {
        if (owner === 'KODUCHI') {
          throw new Error('権限がありません')
        }
        return 列一覧[owner] ?? []
      },
    })

    // Act
    await useSchemaStore.getState().load('c1')

    // Assert
    const state = useSchemaStore.getState()
    expect(state.columns.KODUCHI).toBeUndefined()
    expect(state.columns.ANALYTICS).toHaveLength(1)
    expect(state.columnStatus).toBe('ready')
  })

  it('段階 1 に失敗すると失敗の状態になる', async () => {
    // Arrange
    setDbApi({
      ...createFakeDbApi().api,
      schemaOverview: async () => {
        throw new Error('ORA-00942')
      },
    })

    // Act
    await useSchemaStore.getState().load('c1')

    // Assert
    expect(useSchemaStore.getState().status).toBe('failed')
    expect(useSchemaStore.getState().error).toBe('ORA-00942')
  })

  it('開閉は鍵ごとに切り替わる', () => {
    // Arrange
    const key = nodeKey('KODUCHI', 'USERS')

    // Act
    useSchemaStore.getState().toggle(key)

    // Assert
    expect(useSchemaStore.getState().expanded[key]).toBe(true)
    expect(key).toBe('KODUCHI.USERS')
  })

  it('開閉は値を渡せばその値になる', () => {
    // Arrange: 覚えていない束を閉じる場合である（ADR 0014）
    const key = kindGroupKey('KODUCHI', 'table')

    // Act
    useSchemaStore.getState().toggle(key, false)

    // Assert
    expect(useSchemaStore.getState().expanded[key]).toBe(false)
  })

  it('種別の束の鍵はオブジェクトの鍵と衝突しない', () => {
    // Arrange & Act
    const 束 = kindGroupKey('KODUCHI', 'table')

    // Assert
    expect(束).toBe('KODUCHI.#table')
    expect(束).not.toBe(nodeKey('KODUCHI', 'table'))
  })
})

describe('formatColumnProgress', () => {
  it('読み込み中は進捗を出す', () => {
    // Arrange
    const state = {
      ...useSchemaStore.getState(),
      columnStatus: 'loading' as const,
      loadedSchemas: 8,
      schemas: Array.from({ length: 23 }, (_, index) => スキーマ(`S${index}`, [])),
    }

    // Act
    const text = formatColumnProgress(state)

    // Assert
    expect(text).toBe('列情報を読み込み中 8/23 スキーマ')
  })

  it('読み込みが終わっていれば何も出さない', () => {
    // Arrange
    const state = { ...useSchemaStore.getState(), columnStatus: 'ready' as const }

    // Act
    const text = formatColumnProgress(state)

    // Assert
    expect(text).toBe('')
  })
})

describe('filterSchemas', () => {
  it('絞り込み語が空ならそのまま返る', () => {
    // Arrange
    const search = '  '

    // Act
    const filtered = filterSchemas(スキーマ一覧, 列一覧, search)

    // Assert
    expect(filtered).toBe(スキーマ一覧)
  })

  it('スキーマ名に当たればそのスキーマを丸ごと残す', () => {
    // Arrange
    const search = 'koduchi'

    // Act
    const filtered = filterSchemas(スキーマ一覧, 列一覧, search)

    // Assert
    expect(filtered).toHaveLength(1)
    expect(filtered[0].objects).toHaveLength(2)
  })

  it('オブジェクト名に当たったものだけを残す', () => {
    // Arrange
    const search = 'orders'

    // Act
    const filtered = filterSchemas(スキーマ一覧, 列一覧, search)

    // Assert
    expect(filtered).toHaveLength(1)
    expect(filtered[0].objects.map((object) => object.name)).toEqual(['ORDERS'])
  })

  it('読み込み済みの列名にも当たる', () => {
    // Arrange
    const search = 'email'

    // Act
    const filtered = filterSchemas(スキーマ一覧, 列一覧, search)

    // Assert
    expect(filtered[0].objects.map((object) => object.name)).toEqual(['USERS'])
  })

  it('まだ読み込まれていないスキーマの列には当たらない', () => {
    // Arrange
    const search = 'revenue'

    // Act
    const filtered = filterSchemas(スキーマ一覧, { KODUCHI: 列一覧.KODUCHI }, search)

    // Assert
    expect(filtered).toEqual([])
  })
})
