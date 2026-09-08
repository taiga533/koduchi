/**
 * テーブル定義タブのコピー文字列の組み立てのテスト（ADR 0019・0022）。
 *
 * 見出しの有無・区切り・札の写り方・絞り込みとの関わりを見る。判定はすべて
 * 純粋な関数に寄せてあるため、描画もクリップボードも要らない。
 */

import { describe, expect, it } from 'vitest'
import type { ObjectDefinition, TableColumn, TableConstraint, TableIndex } from '../../types/db'
import {
  buildColumnsCopyText,
  buildConstraintsCopyText,
  buildDdlCopyText,
  buildDefinitionCopy,
  buildIndexesCopyText,
  describeDefinitionCopy,
  formatConstraintDetail,
} from './definitionCopy'

/** 3 列の表。1 列だけ NULL を許す。 */
const 列: TableColumn[] = [
  {
    objectName: 'SHIPMENTS',
    name: 'SHIPMENT_ID',
    typeName: 'NUMBER(12)',
    nullable: false,
    kind: 'number',
  },
  {
    objectName: 'SHIPMENTS',
    name: 'ORDER_ID',
    typeName: 'NUMBER(12)',
    nullable: false,
    kind: 'number',
  },
  {
    objectName: 'SHIPMENTS',
    name: 'TRACKING_NO',
    typeName: 'VARCHAR2(64)',
    nullable: true,
    kind: 'text',
  },
]

/** 主キー・外部キー・無効な検査制約。 */
const 制約: TableConstraint[] = [
  {
    name: 'PK_SHIPMENTS',
    kind: 'primaryKey',
    columns: ['SHIPMENT_ID'],
    searchCondition: null,
    referencedOwner: null,
    referencedTable: null,
    referencedColumns: [],
    deleteRule: null,
    enabled: true,
  },
  {
    name: 'FK_SHIPMENTS_ORDER',
    kind: 'foreignKey',
    columns: ['ORDER_ID'],
    searchCondition: null,
    referencedOwner: 'KODUCHI',
    referencedTable: 'ORDERS',
    referencedColumns: ['ORDER_ID'],
    deleteRule: 'CASCADE',
    enabled: true,
  },
  {
    name: 'CK_SHIPMENTS_STATUS',
    kind: 'check',
    columns: ['STATUS'],
    searchCondition: "status in ('pending','shipped')",
    referencedOwner: null,
    referencedTable: null,
    referencedColumns: [],
    deleteRule: null,
    enabled: false,
  },
]

/** 複合索引と、主キーのために自動生成された索引。 */
const 索引: TableIndex[] = [
  {
    name: 'IX_SHIPMENTS_ORDER_STATUS',
    owner: 'KODUCHI',
    unique: false,
    indexType: 'NORMAL',
    status: 'UNUSABLE',
    generated: false,
    columns: [
      { name: 'ORDER_ID', descending: false },
      { name: 'STATUS', descending: true },
    ],
  },
  {
    name: 'SYS_C0012345',
    owner: 'KODUCHI',
    unique: true,
    indexType: 'NORMAL',
    status: 'VALID',
    generated: true,
    columns: [{ name: 'SHIPMENT_ID', descending: false }],
  },
]

const 定義: ObjectDefinition = {
  owner: 'KODUCHI',
  name: 'SHIPMENTS',
  kind: 'table',
  columns: 列,
  constraints: 制約,
  indexes: 索引,
}

describe('buildColumnsCopyText', () => {
  it('見出しを 1 行目に置き、タブ区切りで写す', () => {
    // Arrange & Act
    const text = buildColumnsCopyText(列, 列)

    // Assert
    const lines = text.split('\n')
    expect(lines[0]).toBe('#\t列\t型\tNULL')
    expect(lines[1]).toBe('1\tSHIPMENT_ID\tNUMBER(12)\tNOT NULL')
    expect(lines[3]).toBe('3\tTRACKING_NO\tVARCHAR2(64)\t可')
  })

  it('絞り込んだ後でも番号は絞り込む前の並び順を出す', () => {
    // Arrange: 貼り先で「元の表の何番目の列か」が残るようにする
    const 絞り込み済み = [列[2]]

    // Act
    const text = buildColumnsCopyText(絞り込み済み, 列)

    // Assert
    expect(text.split('\n')[1]).toBe('3\tTRACKING_NO\tVARCHAR2(64)\t可')
  })

  it('列が 1 つも無ければ見出しだけを返す', () => {
    // Arrange & Act
    const text = buildColumnsCopyText([], [])

    // Assert
    expect(text).toBe('#\t列\t型\tNULL')
  })
})

describe('formatConstraintDetail', () => {
  it('外部キーは参照先の表と列に削除規則を添える', () => {
    // Arrange & Act
    const detail = formatConstraintDetail(制約[1])

    // Assert
    expect(detail).toBe('KODUCHI.ORDERS (ORDER_ID) ON DELETE CASCADE')
  })

  it('参照先が見えないときはその旨を返す', () => {
    // Arrange: 「見えない」と「参照先が無い」は別物である（ADR 0019）
    const 見えない外部キー: TableConstraint = {
      ...制約[1],
      referencedOwner: null,
      referencedTable: null,
      referencedColumns: [],
    }

    // Act
    const detail = formatConstraintDetail(見えない外部キー)

    // Assert
    expect(detail).toBe('参照先を参照できません')
  })

  it('検査制約は条件をそのまま返す', () => {
    // Arrange & Act
    const detail = formatConstraintDetail(制約[2])

    // Assert
    expect(detail).toBe("status in ('pending','shipped')")
  })
})

describe('buildConstraintsCopyText', () => {
  it('見出しを 1 行目に置き、種別と名前と列と参照先を写す', () => {
    // Arrange & Act
    const text = buildConstraintsCopyText(制約)

    // Assert
    const lines = text.split('\n')
    expect(lines[0]).toBe('種別\t名前\t列\t参照先 / 条件')
    expect(lines[1]).toBe('主キー\tPK_SHIPMENTS\tSHIPMENT_ID\t—')
    expect(lines[2]).toBe(
      '外部キー\tFK_SHIPMENTS_ORDER\tORDER_ID\tKODUCHI.ORDERS (ORDER_ID) ON DELETE CASCADE',
    )
  })

  it('無効な制約は画面と同じく種別の欄にその札を写す', () => {
    // Arrange & Act
    const text = buildConstraintsCopyText([制約[2]])

    // Assert
    expect(text.split('\n')[1]).toContain('検査 (無効)')
  })
})

describe('buildIndexesCopyText', () => {
  it('見出しを 1 行目に置き、降順の列と一意の別を写す', () => {
    // Arrange & Act
    const text = buildIndexesCopyText(索引)

    // Assert
    const lines = text.split('\n')
    expect(lines[0]).toBe('名前\t列\t一意\t種類')
    expect(lines[1]).toBe('IX_SHIPMENTS_ORDER_STATUS\tORDER_ID, STATUS DESC\t—\tNORMAL (UNUSABLE)')
  })

  it('自動生成の索引は画面と同じく名前の欄にその札を写す', () => {
    // Arrange & Act
    const text = buildIndexesCopyText([索引[1]])

    // Assert
    expect(text.split('\n')[1]).toBe('SYS_C0012345 (自動生成)\tSHIPMENT_ID\tUNIQUE\tNORMAL')
  })
})

describe('buildDdlCopyText', () => {
  it('断片が 1 つならその本文だけを返す', () => {
    // Arrange & Act
    const text = buildDdlCopyText([{ label: '定義', sql: '\n  CREATE TABLE X (…);\n' }])

    // Assert
    expect(text).toBe('CREATE TABLE X (…);')
  })

  it('仕様と本体は空行 1 つで繋ぎ、見出しは足さない', () => {
    // Arrange: 貼り先は別の環境の SQL であり、日本語の見出しを紛れ込ませない
    const parts = [
      { label: 'パッケージ仕様', sql: 'CREATE OR REPLACE PACKAGE P AS END;\n' },
      { label: 'パッケージ本体', sql: 'CREATE OR REPLACE PACKAGE BODY P AS END;' },
    ]

    // Act
    const text = buildDdlCopyText(parts)

    // Assert
    expect(text).toBe(
      'CREATE OR REPLACE PACKAGE P AS END;\n\nCREATE OR REPLACE PACKAGE BODY P AS END;',
    )
    expect(text).not.toContain('パッケージ仕様')
  })

  it('中身の無い断片は繋ぎ目ごと落とす', () => {
    // Arrange & Act
    const text = buildDdlCopyText([
      { label: '仕様', sql: 'CREATE PACKAGE P;' },
      { label: '本体', sql: '   \n' },
    ])

    // Assert
    expect(text).toBe('CREATE PACKAGE P;')
  })
})

describe('buildDefinitionCopy', () => {
  it('絞り込んでいるときは絞り込んだ後の行だけを写す', () => {
    // Arrange & Act
    const copy = buildDefinitionCopy('columns', 定義, null, 'tracking')

    // Assert
    expect(copy?.count).toBe(1)
    expect(copy?.filtered).toBe(true)
    expect(copy?.text).toContain('TRACKING_NO')
    expect(copy?.text).not.toContain('ORDER_ID')
  })

  it('絞り込んでいないときは全部を写し、絞り込みの印を立てない', () => {
    // Arrange & Act
    const copy = buildDefinitionCopy('columns', 定義, null, '   ')

    // Assert
    expect(copy?.count).toBe(3)
    expect(copy?.filtered).toBe(false)
  })

  it('当てはまる行が 1 つも無ければ写すものを返さない', () => {
    // Arrange: 見出しだけの文字列を貼らせない
    const copy = buildDefinitionCopy('constraints', 定義, null, 'zzz')

    // Assert
    expect(copy).toBeNull()
  })

  it('定義をまだ読んでいなければ写すものを返さない', () => {
    // Arrange & Act
    const copy = buildDefinitionCopy('indexes', null, null, '')

    // Assert
    expect(copy).toBeNull()
  })

  it('DDL は絞り込みに関わらず全文を写し、件数を数えない', () => {
    // Arrange: DDL の内訳に絞り込みは効かない（ADR 0019）
    const ddl = {
      owner: 'KODUCHI',
      name: 'SHIPMENTS',
      kind: 'table' as const,
      parts: [{ label: '定義', sql: 'CREATE TABLE X (…);' }],
    }

    // Act
    const copy = buildDefinitionCopy('ddl', 定義, ddl, 'tracking')

    // Assert
    expect(copy).toEqual({ text: 'CREATE TABLE X (…);', count: null, filtered: false })
  })

  it('DDL をまだ取っていなければ写すものを返さない', () => {
    // Arrange & Act
    const copy = buildDefinitionCopy('ddl', 定義, null, '')

    // Assert
    expect(copy).toBeNull()
  })
})

describe('describeDefinitionCopy', () => {
  it('絞り込んだまま写したことを必ず言う', () => {
    // Arrange & Act
    const 文 = describeDefinitionCopy({ text: '…', count: 3, filtered: true })

    // Assert
    expect(文).toBe('絞り込んだ 3 件をコピーしました')
  })

  it('絞り込んでいなければ件数だけを言う', () => {
    // Arrange & Act
    const 文 = describeDefinitionCopy({ text: '…', count: 1234, filtered: false })

    // Assert
    expect(文).toBe('1,234 件をコピーしました')
  })

  it('DDL は件数を言わない', () => {
    // Arrange & Act
    const 文 = describeDefinitionCopy({ text: '…', count: null, filtered: false })

    // Assert
    expect(文).toBe('DDL をコピーしました')
  })
})
