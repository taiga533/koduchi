import { describe, expect, it } from 'vitest'
import type { SchemaNode, TableColumn } from '../../types/db'
import { buildCatalog, findObject, findSchema, isCompletable, resolveObject } from './catalog'

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
  return { objectName, name, typeName: 'NUMBER(12)', nullable: false, kind: 'number' }
}

const スキーマ一覧 = [
  スキーマ('KODUCHI', ['USERS', 'ORDERS']),
  スキーマ('ANALYTICS', ['DAILY_GMV', 'ORDERS']),
]

const 列一覧: Record<string, TableColumn[]> = {
  KODUCHI: [列('USERS', 'USER_ID'), 列('USERS', 'EMAIL'), 列('ORDERS', 'ORDER_ID')],
  ANALYTICS: [列('DAILY_GMV', 'GMV')],
}

describe('isCompletable', () => {
  it('SQL に名前を書く種別は候補に出す', () => {
    // Arrange & Act & Assert
    expect(isCompletable('table')).toBe(true)
    expect(isCompletable('synonym')).toBe(true)
    expect(isCompletable('type')).toBe(true)
  })

  it('索引とトリガーと DB link は候補に出さない', () => {
    // Arrange & Act & Assert: SQL 本文に裸の名前が現れない（ADR 0014）
    expect(isCompletable('index')).toBe(false)
    expect(isCompletable('trigger')).toBe(false)
    expect(isCompletable('databaseLink')).toBe(false)
  })
})

describe('buildCatalog', () => {
  it('スキーマとオブジェクトと列が繋がる', () => {
    // Arrange
    // 列一覧は読み込み済みとする

    // Act
    const catalog = buildCatalog(スキーマ一覧, 列一覧, 'KODUCHI')

    // Assert
    const users = findObject(findSchema(catalog, 'KODUCHI')!, 'USERS')
    expect(users?.columns.map((column) => column.name)).toEqual(['USER_ID', 'EMAIL'])
  })

  it('補完に出さない種別はカタログに載らない', () => {
    // Arrange
    const schemas: SchemaNode[] = [
      {
        name: 'KODUCHI',
        objectCount: 3,
        objects: [
          { name: 'USERS', kind: 'table' },
          { name: 'IX_USERS_EMAIL', kind: 'index' },
          { name: 'DAILY_GMV', kind: 'synonym' },
        ],
      },
    ]

    // Act
    const catalog = buildCatalog(schemas, {}, 'KODUCHI')

    // Assert
    const koduchi = findSchema(catalog, 'KODUCHI')!
    expect(findObject(koduchi, 'IX_USERS_EMAIL')).toBeNull()
    expect(findObject(koduchi, 'DAILY_GMV')?.kind).toBe('synonym')
  })

  it('列がまだ読み込まれていないオブジェクトは列が空になる', () => {
    // Arrange
    const columns = {}

    // Act
    const catalog = buildCatalog(スキーマ一覧, columns, 'KODUCHI')

    // Assert
    expect(findObject(findSchema(catalog, 'KODUCHI')!, 'USERS')?.columns).toEqual([])
  })

  it('既定スキーマは接続したユーザーの名前で決まる', () => {
    // Arrange
    const username = 'koduchi'

    // Act
    const catalog = buildCatalog(スキーマ一覧, 列一覧, username)

    // Assert
    expect(catalog.defaultSchema?.name).toBe('KODUCHI')
  })

  it('ユーザーと同じ名前のスキーマが無ければ既定スキーマを持たない', () => {
    // Arrange: フィルタで隠されている場合などに起こる
    const username = 'SYSTEM'

    // Act
    const catalog = buildCatalog(スキーマ一覧, 列一覧, username)

    // Assert
    expect(catalog.defaultSchema).toBeNull()
  })
})

describe('findSchema', () => {
  it('小文字で打っても大文字のスキーマを引ける', () => {
    // Arrange
    const catalog = buildCatalog(スキーマ一覧, 列一覧, 'KODUCHI')

    // Act
    const schema = findSchema(catalog, 'koduchi')

    // Assert
    expect(schema?.name).toBe('KODUCHI')
  })

  it('存在しないスキーマは null になる', () => {
    // Arrange
    const catalog = buildCatalog(スキーマ一覧, 列一覧, 'KODUCHI')

    // Act
    const schema = findSchema(catalog, 'NOWHERE')

    // Assert
    expect(schema).toBeNull()
  })
})

describe('resolveObject', () => {
  it('修飾された名前はそのスキーマの中から引く', () => {
    // Arrange
    const catalog = buildCatalog(スキーマ一覧, 列一覧, 'KODUCHI')

    // Act
    const object = resolveObject(catalog, ['analytics', 'daily_gmv'])

    // Assert
    expect(object?.name).toBe('DAILY_GMV')
  })

  it('修飾なしの名前は既定スキーマを先に見る', () => {
    // Arrange: ORDERS は両方のスキーマにある
    const catalog = buildCatalog(スキーマ一覧, 列一覧, 'ANALYTICS')

    // Act
    const object = resolveObject(catalog, ['ORDERS'])

    // Assert: ANALYTICS 側には列が無い
    expect(object?.columns).toEqual([])
  })

  it('既定スキーマに無ければ他のスキーマも探す', () => {
    // Arrange
    const catalog = buildCatalog(スキーマ一覧, 列一覧, 'KODUCHI')

    // Act
    const object = resolveObject(catalog, ['DAILY_GMV'])

    // Assert
    expect(object?.name).toBe('DAILY_GMV')
  })

  it('3 段以上の名前は引けない', () => {
    // Arrange
    const catalog = buildCatalog(スキーマ一覧, 列一覧, 'KODUCHI')

    // Act
    const object = resolveObject(catalog, ['A', 'B', 'C'])

    // Assert
    expect(object).toBeNull()
  })
})
