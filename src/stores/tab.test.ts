import { beforeEach, describe, expect, it } from 'vitest'
import { baseName, resetUntitledCounter, selectActiveTab, selectSession, useTabStore } from './tab'

beforeEach(() => {
  resetUntitledCounter()
  useTabStore.setState({ tabs: [], activeTabId: null })
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
    const tab = useTabStore.getState().tabs[0]
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
    expect(state.tabs[0].content).toBe('')
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
    const tab = useTabStore.getState().tabs[1]
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
    const tab = useTabStore.getState().tabs[0]
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
    expect(state.tabs[0].dirty).toBe(true)
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
