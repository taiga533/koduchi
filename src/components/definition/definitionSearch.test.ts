import { describe, expect, it } from 'vitest'
import {
  filterColumns,
  filterConstraints,
  filterIndexes,
  formatIndexColumns,
  formatReference,
  normalizeNeedle,
} from './definitionSearch'
import type { TableColumn, TableConstraint, TableIndex } from '../../types/db'

/**
 * 列 1 つを組み立てる。
 *
 * @param name 列名
 * @param typeName 型名
 */
function 列(name: string, typeName = 'NUMBER(12)'): TableColumn {
  return { objectName: 'SHIPMENTS', name, typeName, nullable: true, kind: 'number' }
}

/**
 * 制約 1 つを組み立てる。
 *
 * @param constraint 差し替える項目。`name` と `kind` は必須
 */
function 制約(
  constraint: Partial<TableConstraint> & Pick<TableConstraint, 'name' | 'kind'>,
): TableConstraint {
  return {
    columns: [],
    searchCondition: null,
    referencedOwner: null,
    referencedTable: null,
    referencedColumns: [],
    deleteRule: null,
    enabled: true,
    ...constraint,
  }
}

/**
 * 索引 1 つを組み立てる。
 *
 * @param index 差し替える項目。`name` は必須
 */
function 索引(index: Partial<TableIndex> & Pick<TableIndex, 'name'>): TableIndex {
  return {
    owner: 'KODUCHI',
    unique: false,
    indexType: 'NORMAL',
    status: 'VALID',
    generated: false,
    columns: [],
    ...index,
  }
}

describe('normalizeNeedle', () => {
  it('前後の空白を落として小文字へ畳む', () => {
    // Arrange
    const search = '  Order_Id  '

    // Act
    const needle = normalizeNeedle(search)

    // Assert
    expect(needle).toBe('order_id')
  })
})

describe('filterColumns', () => {
  it('語が空なら元の並びをそのまま返す', () => {
    // Arrange
    const columns = [列('ORDER_ID'), 列('STATUS')]

    // Act
    const 絞り込み済み = filterColumns(columns, '   ')

    // Assert
    expect(絞り込み済み).toEqual(columns)
  })

  it('列名の部分一致で絞り込める', () => {
    // Arrange
    const columns = [列('ORDER_ID'), 列('SHIPMENT_ID'), 列('STATUS')]

    // Act
    const 絞り込み済み = filterColumns(columns, 'id')

    // Assert
    expect(絞り込み済み.map((column) => column.name)).toEqual(['ORDER_ID', 'SHIPMENT_ID'])
  })

  it('大文字小文字を区別せずに当たる', () => {
    // Arrange
    const columns = [列('TRACKING_NO')]

    // Act
    const 絞り込み済み = filterColumns(columns, 'tracking')

    // Assert
    expect(絞り込み済み).toHaveLength(1)
  })

  it('型名でも絞り込める', () => {
    // Arrange
    const columns = [列('SHIPPED_AT', 'TIMESTAMP(6)'), 列('ORDER_ID')]

    // Act
    const 絞り込み済み = filterColumns(columns, 'timestamp')

    // Assert
    expect(絞り込み済み.map((column) => column.name)).toEqual(['SHIPPED_AT'])
  })
})

describe('filterConstraints', () => {
  it('制約名で絞り込める', () => {
    // Arrange
    const constraints = [
      制約({ name: 'PK_SHIPMENTS', kind: 'primaryKey' }),
      制約({ name: 'CK_SHIPMENTS_STATUS', kind: 'check' }),
    ]

    // Act
    const 絞り込み済み = filterConstraints(constraints, 'ck_')

    // Assert
    expect(絞り込み済み.map((c) => c.name)).toEqual(['CK_SHIPMENTS_STATUS'])
  })

  it('掛かっている列の名前でも当たる', () => {
    // Arrange: 「この列は何かの外部キーか」を確かめるのが主な使い道である
    const constraints = [
      制約({ name: 'FK_SHIPMENTS_ORDER', kind: 'foreignKey', columns: ['ORDER_ID'] }),
      制約({ name: 'PK_SHIPMENTS', kind: 'primaryKey', columns: ['SHIPMENT_ID'] }),
    ]

    // Act
    const 絞り込み済み = filterConstraints(constraints, 'order_id')

    // Assert
    expect(絞り込み済み.map((c) => c.name)).toEqual(['FK_SHIPMENTS_ORDER'])
  })

  it('参照先の表の名前でも当たる', () => {
    // Arrange
    const constraints = [
      制約({
        name: 'FK_SHIPMENTS_ORDER',
        kind: 'foreignKey',
        referencedTable: 'ORDERS',
      }),
      制約({ name: 'PK_SHIPMENTS', kind: 'primaryKey' }),
    ]

    // Act
    const 絞り込み済み = filterConstraints(constraints, 'orders')

    // Assert
    expect(絞り込み済み.map((c) => c.name)).toEqual(['FK_SHIPMENTS_ORDER'])
  })

  it('検査条件の中身でも当たる', () => {
    // Arrange
    const constraints = [
      制約({
        name: 'CK_SHIPMENTS_STATUS',
        kind: 'check',
        searchCondition: "status in ('pending','shipped')",
      }),
    ]

    // Act
    const 絞り込み済み = filterConstraints(constraints, 'shipped')

    // Assert
    expect(絞り込み済み).toHaveLength(1)
  })
})

describe('filterIndexes', () => {
  it('索引名で絞り込める', () => {
    // Arrange
    const indexes = [索引({ name: 'IX_SHIPMENTS_ORDER_STATUS' }), 索引({ name: 'PK_SHIPMENTS' })]

    // Act
    const 絞り込み済み = filterIndexes(indexes, 'ix_')

    // Assert
    expect(絞り込み済み.map((index) => index.name)).toEqual(['IX_SHIPMENTS_ORDER_STATUS'])
  })

  it('並べている列の名前でも当たる', () => {
    // Arrange
    const indexes = [
      索引({
        name: 'IX_SHIPMENTS_ORDER_STATUS',
        columns: [
          { name: 'ORDER_ID', descending: false },
          { name: 'STATUS', descending: false },
        ],
      }),
      索引({ name: 'PK_SHIPMENTS', columns: [{ name: 'SHIPMENT_ID', descending: false }] }),
    ]

    // Act
    const 絞り込み済み = filterIndexes(indexes, 'status')

    // Assert
    expect(絞り込み済み.map((index) => index.name)).toEqual(['IX_SHIPMENTS_ORDER_STATUS'])
  })
})

describe('formatIndexColumns', () => {
  it('列をカンマで繋いだ形にする', () => {
    // Arrange
    const index = 索引({
      name: 'IX_A',
      columns: [
        { name: 'ORDER_ID', descending: false },
        { name: 'STATUS', descending: false },
      ],
    })

    // Act
    const 表示 = formatIndexColumns(index)

    // Assert
    expect(表示).toBe('ORDER_ID, STATUS')
  })

  it('降順の列にだけDESCを添える', () => {
    // Arrange: すべてに ASC を書くと降順が埋もれる
    const index = 索引({
      name: 'IX_A',
      columns: [
        { name: 'CREATED_AT', descending: true },
        { name: 'USER_ID', descending: false },
      ],
    })

    // Act
    const 表示 = formatIndexColumns(index)

    // Assert
    expect(表示).toBe('CREATED_AT DESC, USER_ID')
  })
})

describe('formatReference', () => {
  it('参照先をスキーマ付きの表と列で表す', () => {
    // Arrange
    const constraint = 制約({
      name: 'FK_SHIPMENT_LEGS_RATE',
      kind: 'foreignKey',
      referencedOwner: 'KODUCHI',
      referencedTable: 'CARRIER_RATES',
      referencedColumns: ['CARRIER', 'ZONE'],
    })

    // Act
    const 表示 = formatReference(constraint)

    // Assert
    expect(表示).toBe('KODUCHI.CARRIER_RATES (CARRIER, ZONE)')
  })

  it('参照先が見えないときはnullを返す', () => {
    // Arrange: 権限が無いと参照先の表が読めない。括弧だけを出して黙らない
    const constraint = 制約({ name: 'FK_X', kind: 'foreignKey' })

    // Act
    const 表示 = formatReference(constraint)

    // Assert
    expect(表示).toBeNull()
  })
})
