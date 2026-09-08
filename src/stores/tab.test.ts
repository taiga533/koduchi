import { beforeEach, describe, expect, it } from 'vitest'
import type { BindInput, SqlTab } from './tab'
import {
  applyBindText,
  baseName,
  fillBindDefaults,
  resetUntitledCounter,
  selectActiveTab,
  selectBindValues,
  selectSession,
  toBinds,
  useTabStore,
} from './tab'

/**
 * 並びの n 枚目を SQL タブとして取り出す。
 *
 * タブの並びには定義タブも混ざりうるため（ADR 0022）、内容や未保存の印を
 * 見るテストではここを通す。
 *
 * @param index 並びの位置
 */
function sqlTabAt(index: number): SqlTab {
  const tab = useTabStore.getState().tabs[index]
  if (tab.kind !== 'sql') {
    throw new Error(`${index} 枚目は SQL タブではない`)
  }
  return tab
}

beforeEach(() => {
  resetUntitledCounter()
  useTabStore.setState({ tabs: [], activeTabId: null, bindValues: {} })
  useTabStore.getState().openNewTab()
})

describe('useTabStore', () => {
  it('新規タブは無題の連番で名付けられる', () => {
    // Arrange
    // beforeEach で 1 枚目が開かれている

    // Act
    useTabStore.getState().openNewTab()

    // Assert
    expect(useTabStore.getState().tabs.map((tab) => tab.name)).toEqual(['無題-1.sql', '無題-2.sql'])
  })

  it('新しく開いたタブが選択される', () => {
    // Arrange
    // beforeEach で 1 枚目が開かれている

    // Act
    useTabStore.getState().openNewTab()

    // Assert
    const state = useTabStore.getState()
    expect(state.activeTabId).toBe(state.tabs[1].id)
  })

  it('内容を書き換えると未保存になる', () => {
    // Arrange
    const id = useTabStore.getState().tabs[0].id

    // Act
    useTabStore.getState().updateContent(id, 'select 1 from dual')

    // Assert
    const tab = sqlTabAt(0)
    expect(tab.content).toBe('select 1 from dual')
    expect(tab.dirty).toBe(true)
  })

  it('選択中のタブを閉じると隣のタブが選ばれる', () => {
    // Arrange
    useTabStore.getState().openNewTab()
    const [first, second] = useTabStore.getState().tabs

    // Act
    useTabStore.getState().closeTab(second.id)

    // Assert
    expect(useTabStore.getState().activeTabId).toBe(first.id)
  })

  it('最後の 1 枚を閉じると新しい空のタブが開く', () => {
    // Arrange
    const id = useTabStore.getState().tabs[0].id

    // Act
    useTabStore.getState().closeTab(id)

    // Assert
    const state = useTabStore.getState()
    expect(state.tabs).toHaveLength(1)
    expect(state.tabs[0].id).not.toBe(id)
    expect(sqlTabAt(0).content).toBe('')
  })

  it('選択していないタブを閉じても選択は変わらない', () => {
    // Arrange
    useTabStore.getState().openNewTab()
    const [first, second] = useTabStore.getState().tabs

    // Act
    useTabStore.getState().closeTab(first.id)

    // Assert
    expect(useTabStore.getState().activeTabId).toBe(second.id)
  })
})

/** タブを 3 枚にし、名前で並びを見分けられるようにする。 */
function 三枚開く(): void {
  useTabStore.getState().openNewTab()
  useTabStore.getState().openNewTab()
}

/** 今の並びのタブ名を返す。 */
function 並び(): string[] {
  return useTabStore.getState().tabs.map((tab) => tab.name)
}

describe('useTabStore.moveTab', () => {
  it('タブを後ろへ動かすと並びが変わる', () => {
    // Arrange
    三枚開く()
    const 一枚目 = useTabStore.getState().tabs[0]

    // Act
    useTabStore.getState().moveTab(一枚目.id, 2)

    // Assert
    expect(並び()).toEqual(['無題-2.sql', '無題-3.sql', '無題-1.sql'])
  })

  it('タブを前へ動かすと並びが変わる', () => {
    // Arrange
    三枚開く()
    const 三枚目 = useTabStore.getState().tabs[2]

    // Act
    useTabStore.getState().moveTab(三枚目.id, 0)

    // Assert
    expect(並び()).toEqual(['無題-3.sql', '無題-1.sql', '無題-2.sql'])
  })

  it('並べ替えても選択は動かない', () => {
    // Arrange
    三枚開く()
    const 三枚目 = useTabStore.getState().tabs[2]
    useTabStore.getState().selectTab(三枚目.id)

    // Act
    useTabStore.getState().moveTab(三枚目.id, 0)

    // Assert
    expect(useTabStore.getState().activeTabId).toBe(三枚目.id)
  })

  it('並べ替えてもタブの内容は持ち回る', () => {
    // Arrange
    三枚開く()
    const 一枚目 = useTabStore.getState().tabs[0]
    useTabStore.getState().updateContent(一枚目.id, 'select 1 from dual')

    // Act
    useTabStore.getState().moveTab(一枚目.id, 2)

    // Assert
    const 動いた先 = sqlTabAt(2)
    expect(動いた先.id).toBe(一枚目.id)
    expect(動いた先.content).toBe('select 1 from dual')
    expect(動いた先.dirty).toBe(true)
  })

  it('知らない ID を指しても並びは変わらない', () => {
    // Arrange
    三枚開く()

    // Act
    useTabStore.getState().moveTab('無い', 0)

    // Assert
    expect(並び()).toEqual(['無題-1.sql', '無題-2.sql', '無題-3.sql'])
  })

  it('範囲の外へは動かせない', () => {
    // Arrange
    三枚開く()
    const 一枚目 = useTabStore.getState().tabs[0]

    // Act
    useTabStore.getState().moveTab(一枚目.id, 3)

    // Assert
    expect(並び()).toEqual(['無題-1.sql', '無題-2.sql', '無題-3.sql'])
  })

  it('並べ替えた順序はセッションへそのまま書き出される', () => {
    // Arrange
    三枚開く()
    const 一枚目 = useTabStore.getState().tabs[0]
    useTabStore.getState().moveTab(一枚目.id, 2)

    // Act
    const session = selectSession(useTabStore.getState(), {
      sidebarSegment: 'schema',
      sidebarWidth: 240,
      editorHeight: 268,
    })

    // Assert
    expect(session.tabs.map((tab) => tab.name)).toEqual(['無題-2.sql', '無題-3.sql', '無題-1.sql'])
  })

  it('保存した順序はそのまま復元される', () => {
    // Arrange
    三枚開く()
    const 一枚目 = useTabStore.getState().tabs[0]
    useTabStore.getState().moveTab(一枚目.id, 2)
    const session = selectSession(useTabStore.getState(), {
      sidebarSegment: 'schema',
      sidebarWidth: 240,
      editorHeight: 268,
    })

    // Act
    useTabStore.setState({ tabs: [], activeTabId: null })
    useTabStore.getState().restore(session)

    // Assert
    expect(並び()).toEqual(['無題-2.sql', '無題-3.sql', '無題-1.sql'])
  })
})

describe('selectActiveTab', () => {
  it('選択中のタブを返す', () => {
    // Arrange
    useTabStore.getState().openNewTab()

    // Act
    const active = selectActiveTab(useTabStore.getState())

    // Assert
    expect(active?.name).toBe('無題-2.sql')
  })
})

describe('baseName', () => {
  it('パスからファイル名だけを取り出す', () => {
    // Arrange
    const filePath = '/Users/taiga/queries/users.sql'

    // Act
    const name = baseName(filePath)

    // Assert
    expect(name).toBe('users.sql')
  })

  it('区切りを含まない文字列はそのまま返る', () => {
    // Arrange
    const filePath = 'users.sql'

    // Act
    const name = baseName(filePath)

    // Assert
    expect(name).toBe('users.sql')
  })
})

describe('ファイルを開く', () => {
  it('開いたファイルはファイル名のタブになり未保存にならない', () => {
    // Arrange
    const filePath = '/tmp/users.sql'

    // Act
    useTabStore.getState().openFile(filePath, 'select * from users')

    // Assert
    const tab = sqlTabAt(1)
    expect(tab.name).toBe('users.sql')
    expect(tab.filePath).toBe(filePath)
    expect(tab.content).toBe('select * from users')
    expect(tab.dirty).toBe(false)
  })

  it('同じファイルを開き直すとそのタブへ移るだけでタブは増えない', () => {
    // Arrange
    const filePath = '/tmp/users.sql'
    useTabStore.getState().openFile(filePath, 'select 1')
    const opened = useTabStore.getState().tabs[1].id

    // Act
    useTabStore.getState().openFile(filePath, 'select 1')

    // Assert
    expect(useTabStore.getState().tabs).toHaveLength(2)
    expect(useTabStore.getState().activeTabId).toBe(opened)
  })
})

describe('保存', () => {
  it('保存すると未保存の印が消えてファイル名がタブ名になる', () => {
    // Arrange
    const id = useTabStore.getState().tabs[0].id
    useTabStore.getState().updateContent(id, 'select 1 from dual')

    // Act
    useTabStore.getState().markSaved(id, '/tmp/query.sql')

    // Assert
    const tab = sqlTabAt(0)
    expect(tab.dirty).toBe(false)
    expect(tab.name).toBe('query.sql')
    expect(tab.filePath).toBe('/tmp/query.sql')
  })
})

describe('セッションの復元', () => {
  it('保存しておいたタブを並び順のまま復元する', () => {
    // Arrange
    const session = {
      tabs: [
        { id: 't1', name: '無題-3.sql', filePath: null, content: 'select 1', dirty: true },
        {
          id: 't2',
          name: 'users.sql',
          filePath: '/tmp/users.sql',
          content: 'select 2',
          dirty: false,
        },
      ],
      activeTabId: 't2',
      sidebarSegment: 'history',
    }

    // Act
    useTabStore.getState().restore(session)

    // Assert
    const state = useTabStore.getState()
    expect(state.tabs.map((tab) => tab.id)).toEqual(['t1', 't2'])
    expect(state.activeTabId).toBe('t2')
    expect(sqlTabAt(0).dirty).toBe(true)
  })

  it('復元した無題の番号とぶつからない番号が次に振られる', () => {
    // Arrange
    useTabStore.getState().restore({
      tabs: [{ id: 't1', name: '無題-3.sql', filePath: null, content: '', dirty: false }],
      activeTabId: 't1',
    })

    // Act
    useTabStore.getState().openNewTab()

    // Assert
    expect(useTabStore.getState().tabs[1].name).toBe('無題-4.sql')
  })

  it('保存されたタブが無ければ今のタブを保つ', () => {
    // Arrange
    const before = useTabStore.getState().tabs

    // Act
    useTabStore.getState().restore({ tabs: [], activeTabId: null })

    // Assert
    expect(useTabStore.getState().tabs).toEqual(before)
  })
})

describe('定義タブ', () => {
  it('定義タブを末尾へ足して選ぶ', () => {
    // Arrange
    const 対象 = { owner: 'KODUCHI', name: 'SHIPMENTS', kind: 'table' } as const

    // Act
    const id = useTabStore.getState().openDefinitionTab(対象)

    // Assert
    const state = useTabStore.getState()
    expect(state.tabs.map((tab) => tab.kind)).toEqual(['sql', 'definition'])
    expect(state.tabs[1].name).toBe('SHIPMENTS')
    expect(state.activeTabId).toBe(id)
  })

  it('同じ対象を 2 度開いてもタブは増えない', () => {
    // Arrange
    const 対象 = { owner: 'KODUCHI', name: 'SHIPMENTS', kind: 'table' } as const
    const 最初 = useTabStore.getState().openDefinitionTab(対象)
    useTabStore.getState().selectTab(useTabStore.getState().tabs[0].id)

    // Act
    const 二度目 = useTabStore.getState().openDefinitionTab({ ...対象 })

    // Assert
    expect(useTabStore.getState().tabs).toHaveLength(2)
    expect(二度目).toBe(最初)
    expect(useTabStore.getState().activeTabId).toBe(最初)
  })

  it('定義タブへ内容を書き込もうとしても変わらない', () => {
    // Arrange: 定義タブは編集できない（ADR 0022）
    const id = useTabStore
      .getState()
      .openDefinitionTab({ owner: 'KODUCHI', name: 'SHIPMENTS', kind: 'table' })

    // Act
    useTabStore.getState().updateContent(id, 'select 1')

    // Assert
    expect(useTabStore.getState().tabs[1]).toEqual({
      kind: 'definition',
      id,
      name: 'SHIPMENTS',
      target: { owner: 'KODUCHI', name: 'SHIPMENTS', kind: 'table' },
    })
  })

  it('定義タブも同じ手続きで閉じられる', () => {
    // Arrange: 並びは 1 本であり、閉じる操作は種類を問わない
    const id = useTabStore
      .getState()
      .openDefinitionTab({ owner: 'KODUCHI', name: 'SHIPMENTS', kind: 'table' })

    // Act
    useTabStore.getState().closeTab(id)

    // Assert
    expect(useTabStore.getState().tabs.map((tab) => tab.kind)).toEqual(['sql'])
  })

  it('復元したタブに定義タブは混ざらない', () => {
    // Arrange
    useTabStore.getState().openDefinitionTab({ owner: 'KODUCHI', name: 'SHIPMENTS', kind: 'table' })

    // Act
    useTabStore.getState().restore({
      tabs: [{ id: 't1', name: '無題-9.sql', filePath: null, content: 'select 1', dirty: false }],
      activeTabId: 't1',
    })

    // Assert
    expect(useTabStore.getState().tabs.map((tab) => tab.kind)).toEqual(['sql'])
  })
})

describe('selectSession', () => {
  it('未保存のバッファも含めて書き出す', () => {
    // Arrange
    const id = useTabStore.getState().tabs[0].id
    useTabStore.getState().updateContent(id, 'select 1 from dual')

    // Act
    const session = selectSession(useTabStore.getState(), {
      sidebarSegment: 'schema',
      sidebarWidth: 240,
      editorHeight: 268,
    })

    // Assert
    expect(session.tabs).toEqual([
      { id, name: '無題-1.sql', filePath: null, content: 'select 1 from dual', dirty: true },
    ])
    expect(session.activeTabId).toBe(id)
    expect(session.sidebarSegment).toBe('schema')
  })

  it('定義タブは書き出さず、選んでいれば選択も落とす', () => {
    // Arrange: 定義は接続に属し、再起動後は中身を出せない（ADR 0022）
    const sqlId = useTabStore.getState().tabs[0].id
    const definitionId = useTabStore
      .getState()
      .openDefinitionTab({ owner: 'KODUCHI', name: 'SHIPMENTS', kind: 'table' })

    // Act
    const session = selectSession(useTabStore.getState(), {
      sidebarSegment: 'schema',
      sidebarWidth: 240,
      editorHeight: 268,
    })

    // Assert
    expect(useTabStore.getState().activeTabId).toBe(definitionId)
    expect(session.tabs.map((tab) => tab.id)).toEqual([sqlId])
    expect(session.activeTabId).toBeNull()
  })

  it('ペインの寸法も書き出す', () => {
    // Arrange
    const layout = { sidebarSegment: 'history', sidebarWidth: 320, editorHeight: 400 }

    // Act
    const session = selectSession(useTabStore.getState(), layout)

    // Assert
    expect(session.sidebarWidth).toBe(320)
    expect(session.editorHeight).toBe(400)
  })
})

describe('バインド変数の記憶', () => {
  it('タブごとにバインド変数の値を覚える', () => {
    // Arrange
    const id = useTabStore.getState().tabs[0].id

    // Act
    useTabStore
      .getState()
      .setBindValues(id, { userId: { text: '42', kind: 'varchar2', isNull: false } })

    // Assert
    expect(selectBindValues(useTabStore.getState(), id)).toEqual({
      userId: { text: '42', kind: 'varchar2', isNull: false },
    })
  })

  it('別のタブの値とは混ざらない', () => {
    // Arrange
    const 一枚目 = useTabStore.getState().tabs[0].id
    useTabStore.getState().openNewTab()
    const 二枚目 = useTabStore.getState().tabs[1].id

    // Act
    useTabStore
      .getState()
      .setBindValues(一枚目, { id: { text: '1', kind: 'varchar2', isNull: false } })
    useTabStore
      .getState()
      .setBindValues(二枚目, { id: { text: '2', kind: 'varchar2', isNull: false } })

    // Assert
    expect(selectBindValues(useTabStore.getState(), 一枚目).id.text).toBe('1')
    expect(selectBindValues(useTabStore.getState(), 二枚目).id.text).toBe('2')
  })

  it('タブを閉じるとその値は消える', () => {
    // Arrange
    const id = useTabStore.getState().tabs[0].id
    useTabStore.getState().openNewTab()
    useTabStore.getState().setBindValues(id, { id: { text: '1', kind: 'varchar2', isNull: false } })

    // Act
    useTabStore.getState().closeTab(id)

    // Assert
    expect(useTabStore.getState().bindValues[id]).toBeUndefined()
  })

  it('セッションの書き出しにはバインド変数の値を含めない', () => {
    // Arrange
    const id = useTabStore.getState().tabs[0].id
    useTabStore
      .getState()
      .setBindValues(id, { id: { text: '個人情報', kind: 'varchar2', isNull: false } })

    // Act
    const session = selectSession(useTabStore.getState(), {
      sidebarSegment: 'schema',
      sidebarWidth: 240,
      editorHeight: 268,
    })

    // Assert
    expect(JSON.stringify(session)).not.toContain('個人情報')
  })

  it('セッションから復元すると前のタブの値は持ち越さない', () => {
    // Arrange
    const id = useTabStore.getState().tabs[0].id
    useTabStore.getState().setBindValues(id, { id: { text: '1', kind: 'varchar2', isNull: false } })

    // Act
    useTabStore.getState().restore({
      tabs: [{ id: 't1', name: '無題-1.sql', filePath: null, content: '', dirty: false }],
      activeTabId: 't1',
    })

    // Assert
    expect(useTabStore.getState().bindValues).toEqual({})
  })

  it('まだ入力していないタブでは空の表を返す', () => {
    // Arrange
    const id = useTabStore.getState().tabs[0].id

    // Act
    const values = selectBindValues(useTabStore.getState(), id)

    // Assert
    expect(values).toEqual({})
  })
})

describe('toBinds', () => {
  it('尋ねた名前の順に名前と値の対へ変換する', () => {
    // Arrange
    const values: Record<string, BindInput> = {
      id: { text: '42', kind: 'varchar2', isNull: false },
      name: { text: '小槌', kind: 'varchar2', isNull: false },
    }

    // Act
    const binds = toBinds(['id', 'name'], values)

    // Assert
    expect(binds).toEqual([
      { name: 'id', kind: 'varchar2', value: '42' },
      { name: 'name', kind: 'varchar2', value: '小槌' },
    ])
  })

  it('null のチェックが付いた変数の値は null になる', () => {
    // Arrange
    const values: Record<string, BindInput> = {
      memo: { text: '入力しただけの値', kind: 'varchar2', isNull: true },
    }

    // Act
    const binds = toBinds(['memo'], values)

    // Assert
    expect(binds).toEqual([{ name: 'memo', kind: 'varchar2', value: null }])
  })

  it('入力していない変数は空文字列として渡す', () => {
    // Arrange
    const values = {}

    // Act
    const binds = toBinds(['id'], values)

    // Assert
    expect(binds).toEqual([{ name: 'id', kind: 'varchar2', value: '' }])
  })

  it('選ばれた型を添えて渡す', () => {
    // Arrange
    const values: Record<string, BindInput> = {
      day: { text: '2024-01-02', kind: 'date', isNull: false },
    }

    // Act
    const binds = toBinds(['day'], values)

    // Assert
    expect(binds).toEqual([{ name: 'day', kind: 'date', value: '2024-01-02' }])
  })
})

describe('fillBindDefaults', () => {
  it('初めて尋ねる変数には推し量った型を入れる', () => {
    // Arrange
    const kinds = { USER_ID: 'number' as const }

    // Act
    const values = fillBindDefaults(['user_id'], {}, kinds)

    // Assert
    expect(values.user_id).toEqual({ text: '', kind: 'number', isNull: false })
  })

  it('推し量れない変数は文字列にする', () => {
    // Arrange
    const kinds = {}

    // Act
    const values = fillBindDefaults(['memo'], {}, kinds)

    // Assert
    expect(values.memo).toEqual({ text: '', kind: 'varchar2', isNull: false })
  })

  it('前回の値と型はそのまま残す', () => {
    // Arrange: 利用者が選んだ型を推し量りで上書きしない
    const remembered: Record<string, BindInput> = {
      id: { text: '42', kind: 'varchar2', isNull: false },
    }

    // Act
    const values = fillBindDefaults(['id'], remembered, { ID: 'number' })

    // Assert
    expect(values.id).toEqual({ text: '42', kind: 'varchar2', isNull: false })
  })

  it('今回尋ねない変数の入力も落とさない', () => {
    // Arrange
    const remembered: Record<string, BindInput> = {
      別の変数: { text: '1', kind: 'number', isNull: false },
    }

    // Act
    const values = fillBindDefaults(['id'], remembered, {})

    // Assert
    expect(values.別の変数).toEqual({ text: '1', kind: 'number', isNull: false })
  })
})

describe('applyBindText', () => {
  it('型を選び直していなければ値の見た目に型が追う', () => {
    // Arrange
    const input: BindInput = { text: '', kind: 'varchar2', isNull: false }

    // Act
    const next = applyBindText(input, '2024-01-02 03:04:05')

    // Assert
    expect(next).toEqual({ text: '2024-01-02 03:04:05', kind: 'timestamp', isNull: false })
  })

  it('値を消せば型も文字列へ戻る', () => {
    // Arrange
    const input: BindInput = { text: '42', kind: 'number', isNull: false }

    // Act
    const next = applyBindText(input, '')

    // Assert
    expect(next.kind).toBe('varchar2')
  })

  it('値の見た目と違う型が選ばれていれば型は変わらない', () => {
    // Arrange
    const input: BindInput = { text: '42', kind: 'varchar2', isNull: false }

    // Act
    const next = applyBindText(input, '43')

    // Assert
    expect(next).toEqual({ text: '43', kind: 'varchar2', isNull: false })
  })
})
