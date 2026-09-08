/**
 * 2 種類のタブが混ざった並びの扱いのテスト（ADR 0022）。
 *
 * 足す・見分ける・セッションへ出す・セッションから戻すの 4 つを見る。
 * どれも純粋な関数であり、ストアもデータベースも要らない。
 */

import { describe, expect, it } from 'vitest'
import type { DefinitionEditorTab, EditorTab, SqlTab } from './tab'
import {
  definitionTabName,
  findDefinitionTab,
  fromSessionTabs,
  isDefinitionTab,
  isDirty,
  isSqlTab,
  openDefinitionTab,
  sameDefinitionTarget,
  toSessionTabs,
} from './tabKinds'
import type { DefinitionTarget } from '../types/db'

const 出荷: DefinitionTarget = { owner: 'KODUCHI', name: 'SHIPMENTS', kind: 'table' }
const 注文: DefinitionTarget = { owner: 'KODUCHI', name: 'ORDERS', kind: 'table' }

/**
 * SQL タブを 1 枚作る。
 *
 * @param id タブの識別子
 * @param overrides 上書きしたい項目
 */
function SQLタブ(id: string, overrides: Partial<SqlTab> = {}): SqlTab {
  return {
    kind: 'sql',
    id,
    name: `${id}.sql`,
    filePath: null,
    content: '',
    dirty: false,
    ...overrides,
  }
}

/**
 * 定義タブを 1 枚作る。
 *
 * @param id タブの識別子
 * @param target 見る対象
 */
function 定義タブ(id: string, target: DefinitionTarget): DefinitionEditorTab {
  return { kind: 'definition', id, name: definitionTabName(target), target }
}

describe('タブの種類の見分け', () => {
  it('SQL タブと定義タブを見分ける', () => {
    // Arrange
    const sql = SQLタブ('t1')
    const definition = 定義タブ('t2', 出荷)

    // Act & Assert
    expect(isSqlTab(sql)).toBe(true)
    expect(isDefinitionTab(sql)).toBe(false)
    expect(isSqlTab(definition)).toBe(false)
    expect(isDefinitionTab(definition)).toBe(true)
  })

  it('定義タブには未保存の印が付かない', () => {
    // Arrange: 定義タブは編集できず、未保存になりようがない
    const 未保存 = SQLタブ('t1', { dirty: true })
    const definition = 定義タブ('t2', 出荷)

    // Act & Assert
    expect(isDirty(未保存)).toBe(true)
    expect(isDirty(definition)).toBe(false)
  })

  it('定義タブの名前はオブジェクト名である', () => {
    // Arrange & Act
    const name = definitionTabName(出荷)

    // Assert
    expect(name).toBe('SHIPMENTS')
  })
})

describe('sameDefinitionTarget', () => {
  it('所有者と名前と種別がすべて同じなら同じ対象である', () => {
    // Arrange & Act & Assert
    expect(sameDefinitionTarget(出荷, { ...出荷 })).toBe(true)
  })

  it('名前が同じでも種別が違えば別の対象である', () => {
    // Arrange: 表とその索引が同名になることがある
    const 索引 = { ...出荷, kind: 'index' as const }

    // Act & Assert
    expect(sameDefinitionTarget(出荷, 索引)).toBe(false)
  })

  it('所有者が違えば別の対象である', () => {
    // Arrange & Act & Assert
    expect(sameDefinitionTarget(出荷, { ...出荷, owner: 'OTHER' })).toBe(false)
  })
})

describe('openDefinitionTab', () => {
  it('定義タブを並びの末尾へ足して選ぶ', () => {
    // Arrange
    const tabs: EditorTab[] = [SQLタブ('t1'), SQLタブ('t2')]

    // Act
    const opened = openDefinitionTab(tabs, 出荷, 'd1')

    // Assert
    expect(opened.created).toBe(true)
    expect(opened.tabs.map((tab) => tab.id)).toEqual(['t1', 't2', 'd1'])
    expect(opened.activeTabId).toBe('d1')
    expect(opened.tabs[2].name).toBe('SHIPMENTS')
  })

  it('同じ対象のタブが既にあれば 2 枚目を開かずそちらへ移る', () => {
    // Arrange: 定義は読むだけの画面であり、2 枚並べても同じものを映す（ADR 0022）
    const tabs: EditorTab[] = [SQLタブ('t1'), 定義タブ('d1', 出荷)]

    // Act
    const opened = openDefinitionTab(tabs, { ...出荷 }, 'd2')

    // Assert
    expect(opened.created).toBe(false)
    expect(opened.tabs).toHaveLength(2)
    expect(opened.activeTabId).toBe('d1')
  })

  it('別の対象なら 2 枚目を開く', () => {
    // Arrange
    const tabs: EditorTab[] = [定義タブ('d1', 出荷)]

    // Act
    const opened = openDefinitionTab(tabs, 注文, 'd2')

    // Assert
    expect(opened.tabs.map((tab) => tab.id)).toEqual(['d1', 'd2'])
    expect(opened.activeTabId).toBe('d2')
  })

  it('元の並びを書き換えない', () => {
    // Arrange
    const tabs: EditorTab[] = [SQLタブ('t1')]

    // Act
    openDefinitionTab(tabs, 出荷, 'd1')

    // Assert
    expect(tabs).toHaveLength(1)
  })
})

describe('findDefinitionTab', () => {
  it('同じ対象のタブを見つける', () => {
    // Arrange
    const tabs: EditorTab[] = [SQLタブ('t1'), 定義タブ('d1', 注文), 定義タブ('d2', 出荷)]

    // Act
    const found = findDefinitionTab(tabs, 出荷)

    // Assert
    expect(found?.id).toBe('d2')
  })

  it('無ければ null を返す', () => {
    // Arrange
    const tabs: EditorTab[] = [SQLタブ('t1')]

    // Act
    const found = findDefinitionTab(tabs, 出荷)

    // Assert
    expect(found).toBeNull()
  })
})

describe('セッションへの出し入れ', () => {
  it('定義タブはセッションへ書き出さない', () => {
    // Arrange: 定義は接続に属し、再起動後は中身を出せない（ADR 0019・0022）
    const tabs: EditorTab[] = [
      SQLタブ('t1', { content: 'select 1', dirty: true }),
      定義タブ('d1', 出荷),
      SQLタブ('t2', { filePath: '/tmp/users.sql' }),
    ]

    // Act
    const session = toSessionTabs(tabs)

    // Assert
    expect(session.map((tab) => tab.id)).toEqual(['t1', 't2'])
  })

  it('SQL タブは内容も未保存の印も丸ごと書き出す', () => {
    // Arrange
    const tabs: EditorTab[] = [SQLタブ('t1', { content: 'select 1', dirty: true })]

    // Act
    const session = toSessionTabs(tabs)

    // Assert
    expect(session[0]).toEqual({
      id: 't1',
      name: 't1.sql',
      filePath: null,
      content: 'select 1',
      dirty: true,
    })
  })

  it('セッションから戻したタブはすべて SQL タブである', () => {
    // Arrange
    const session = [
      { id: 't1', name: '無題-1.sql', filePath: null, content: 'select 1', dirty: true },
    ]

    // Act
    const tabs = fromSessionTabs(session)

    // Assert
    expect(tabs.every(isSqlTab)).toBe(true)
    expect(tabs[0].content).toBe('select 1')
  })
})
