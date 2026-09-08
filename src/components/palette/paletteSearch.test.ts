import { describe, expect, it } from 'vitest'
import type { PaletteEntry, PaletteKind } from './paletteSearch'
import {
  PALETTE_GROUP_LIMITS,
  filterPaletteEntries,
  flattenPaletteGroups,
  matchPaletteLabel,
  movePaletteSelection,
  summarizeSql,
} from './paletteSearch'

/** 候補 1 件を組み立てる。 */
function 候補(id: string, kind: PaletteKind, label: string): PaletteEntry {
  return { id, kind, label, detail: '' }
}

describe('matchPaletteLabel', () => {
  it('検索語が空なら全件が同じ強さで当たる', () => {
    // Arrange
    const label = 'ORDERS'

    // Act
    const match = matchPaletteLabel(label, '  ')

    // Assert
    expect(match).toEqual({ score: 0, index: 0 })
  })

  it('大文字小文字を区別せず部分一致で当たる', () => {
    // Arrange
    const label = 'ORDER_ITEMS'

    // Act
    const match = matchPaletteLabel(label, 'item')

    // Assert
    expect(match).not.toBeNull()
    expect(match?.index).toBe(6)
  })

  it('当たらなければ null を返す', () => {
    // Arrange
    const label = 'ORDERS'

    // Act
    const match = matchPaletteLabel(label, 'users')

    // Assert
    expect(match).toBeNull()
  })

  it('前方一致は語頭一致より強い', () => {
    // Arrange
    const 前方 = matchPaletteLabel('ORDER_ITEMS', 'order')

    // Act
    const 語頭 = matchPaletteLabel('SALES_ORDER', 'order')

    // Assert
    expect(前方?.score).toBe(3)
    expect(語頭?.score).toBe(2)
  })

  it('語の途中で当たったものが最も弱い', () => {
    // Arrange
    const 語頭 = matchPaletteLabel('SALES_ORDER', 'order')

    // Act
    const 途中 = matchPaletteLabel('REORDERED', 'order')

    // Assert
    expect(語頭?.score).toBe(2)
    expect(途中?.score).toBe(1)
  })
})

describe('filterPaletteEntries', () => {
  it('見出しは固定の順に並ぶ', () => {
    // Arrange
    const entries = [
      候補('h1', 'history', 'select 1 from dual'),
      候補('s1', 'saved', 'select の保存'),
      候補('t1', 'schema', 'selected_rows'),
      候補('c1', 'command', 'select を実行'),
    ]

    // Act
    const groups = filterPaletteEntries(entries, 'select')

    // Assert
    expect(groups.map((group) => group.kind)).toEqual(['command', 'schema', 'saved', 'history'])
  })

  it('当たりの無い種別は見出しごと出さない', () => {
    // Arrange
    const entries = [候補('t1', 'schema', 'ORDERS'), 候補('c1', 'command', 'コミット')]

    // Act
    const groups = filterPaletteEntries(entries, 'order')

    // Assert
    expect(groups.map((group) => group.kind)).toEqual(['schema'])
  })

  it('種別の中は当たりの強い順に並ぶ', () => {
    // Arrange
    const entries = [
      候補('t1', 'schema', 'REORDERED'),
      候補('t2', 'schema', 'SALES_ORDER'),
      候補('t3', 'schema', 'ORDERS'),
    ]

    // Act
    const groups = filterPaletteEntries(entries, 'order')

    // Assert
    expect(groups[0].entries.map((entry) => entry.id)).toEqual(['t3', 't2', 't1'])
  })

  it('同じ強さなら短いものが先に来る', () => {
    // Arrange
    const entries = [候補('t1', 'schema', 'ORDER_ITEM_DETAILS'), 候補('t2', 'schema', 'ORDERS')]

    // Act
    const groups = filterPaletteEntries(entries, 'order')

    // Assert
    expect(groups[0].entries.map((entry) => entry.id)).toEqual(['t2', 't1'])
  })

  it('検索語が空なら渡された順のまま全件が並ぶ', () => {
    // Arrange
    const entries = [候補('c1', 'command', '実行'), 候補('c2', 'command', 'コミット')]

    // Act
    const groups = filterPaletteEntries(entries, '')

    // Assert
    expect(groups[0].entries.map((entry) => entry.id)).toEqual(['c1', 'c2'])
  })

  it('種別ごとに並べる件数には上限がある', () => {
    // Arrange
    const entries = Array.from({ length: 30 }, (_, index) =>
      候補(`t${index}`, 'schema', `TABLE_${index}`),
    )

    // Act
    const groups = filterPaletteEntries(entries, 'table')

    // Assert
    expect(groups[0].entries).toHaveLength(PALETTE_GROUP_LIMITS.schema)
  })

  it('detail は突き合わせの対象にしない', () => {
    // Arrange
    const entries = [{ id: 'h1', kind: 'history' as const, label: 'select 1', detail: '開発' }]

    // Act
    const groups = filterPaletteEntries(entries, '開発')

    // Assert
    expect(groups).toEqual([])
  })
})

describe('flattenPaletteGroups', () => {
  it('見出しの順のまま一本の並びになる', () => {
    // Arrange
    const entries = [
      候補('t1', 'schema', 'ORDERS'),
      候補('c1', 'command', 'ORDER を実行'),
      候補('h1', 'history', 'select from ORDERS'),
    ]

    // Act
    const flat = flattenPaletteGroups(filterPaletteEntries(entries, 'order'))

    // Assert
    expect(flat.map((entry) => entry.id)).toEqual(['c1', 't1', 'h1'])
  })
})

describe('movePaletteSelection', () => {
  it('下へ一つ動く', () => {
    // Arrange
    const count = 3

    // Act
    const next = movePaletteSelection(count, 0, 1)

    // Assert
    expect(next).toBe(1)
  })

  it('末尾から下へ動くと先頭へ回り込む', () => {
    // Arrange
    const count = 3

    // Act
    const next = movePaletteSelection(count, 2, 1)

    // Assert
    expect(next).toBe(0)
  })

  it('先頭から上へ動くと末尾へ回り込む', () => {
    // Arrange
    const count = 3

    // Act
    const next = movePaletteSelection(count, 0, -1)

    // Assert
    expect(next).toBe(2)
  })

  it('候補が無ければ先頭のままにする', () => {
    // Arrange
    const count = 0

    // Act
    const next = movePaletteSelection(count, 0, 1)

    // Assert
    expect(next).toBe(0)
  })
})

describe('summarizeSql', () => {
  it('改行と連続する空白を一つに畳む', () => {
    // Arrange
    const sql = '  select *\n  from   users\nwhere id = 1  '

    // Act
    const summary = summarizeSql(sql)

    // Assert
    expect(summary).toBe('select * from users where id = 1')
  })

  it('長すぎる sql は切り詰める', () => {
    // Arrange
    const sql = 'a'.repeat(200)

    // Act
    const summary = summarizeSql(sql)

    // Assert
    expect(summary).toHaveLength(120)
  })
})
