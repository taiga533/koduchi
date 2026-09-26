import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDbApi, setDbApi } from '../api/db'
import { resetCloseTabDialog, setCloseTabDialog } from '../components/editor/closing'
import { createFakeDbApi } from '../test/fakeDbApi'
import { SQLタブを一枚にする, 接続済みにする, 未接続にする } from '../test/activeConnection'
import { useDefinitionStore } from '../stores/definition'
import { emptyExecution, useExecutionStore } from '../stores/execution'
import { selectActiveSqlTab, selectActiveTab, useTabStore } from '../stores/tab'
import { useUiStore } from '../stores/ui'
import {
  closeActiveTab,
  closeOtherTabs,
  closeTabAndRelease,
  closeTabsToRight,
  openDefinitionTab,
  openSqlInNewTab,
  putSqlIntoEditor,
} from './tabs'

/** タブを閉じる確認に返す答え。先頭から順に使う。 */
let 確認の答え: boolean[] = []

/** 確認へ渡されたタブの名前。 */
let 尋ねた名前: string[] = []

/** 定義タブで開く対象。 */
const USERS = { owner: 'KODUCHI', name: 'USERS', kind: 'table' as const }

beforeEach(() => {
  確認の答え = []
  尋ねた名前 = []
  setCloseTabDialog(async (name) => {
    尋ねた名前.push(name)
    return 確認の答え.shift() ?? false
  })
  useExecutionStore.getState().clear()
  useDefinitionStore.getState().clear()
  useUiStore.setState({ resultColumnWidths: {} })
  接続済みにする()
})

afterEach(() => {
  resetDbApi()
  resetCloseTabDialog()
})

/** 今あるタブの ID を並べる。 */
function タブの並び(): string[] {
  return useTabStore.getState().tabs.map((tab) => tab.id)
}

describe('closeTabAndRelease', () => {
  it('書きかけのタブは尋ね、取り消されたら閉じない', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    SQLタブを一枚にする({ content: 'select 1 from dual', dirty: true })
    確認の答え = [false]

    // Act
    await closeTabAndRelease('sql-1')

    // Assert
    expect(尋ねた名前).toEqual(['無題-1.sql'])
    expect(タブの並び()).toContain('sql-1')
    expect(calls.releaseTab).toEqual([])
  })

  it('閉じるときは結果セットと列幅を手放す', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    SQLタブを一枚にする()
    useUiStore.getState().setResultColumnWidth('sql-1', 'N', 120)

    // Act
    await closeTabAndRelease('sql-1')

    // Assert
    expect(尋ねた名前).toEqual([])
    expect(タブの並び()).not.toContain('sql-1')
    expect(calls.releaseTab).toEqual([{ id: 'c1', tabId: 'sql-1' }])
    expect(useUiStore.getState().resultColumnWidths['sql-1']).toBeUndefined()
  })

  it('実行中のタブを閉じても中止は別のコマンドにせず、手放しだけを送る', async () => {
    // Arrange: 別のコマンドの中止は手放しに追い越されると届かない。走っている文への
    // 中止は手放し（Rust の release_tab）が自分で送る（ADR 0003）
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    SQLタブを一枚にする()
    useExecutionStore.setState({ byTab: { 'sql-1': { ...emptyExecution, status: 'running' } } })

    // Act
    await closeTabAndRelease('sql-1')

    // Assert
    expect(calls.cancel).toEqual([])
    expect(calls.releaseTab).toEqual([{ id: 'c1', tabId: 'sql-1' }])
    expect(タブの並び()).not.toContain('sql-1')
  })

  it('定義タブを閉じるとその定義も手放す', async () => {
    // Arrange
    setDbApi(createFakeDbApi().api)
    SQLタブを一枚にする()
    openDefinitionTab(USERS)
    const 定義タブ = useTabStore.getState().activeTabId as string
    await expect.poll(() => useDefinitionStore.getState().byTab[定義タブ]).toBeDefined()

    // Act
    await closeTabAndRelease(定義タブ)

    // Assert
    expect(useDefinitionStore.getState().byTab[定義タブ]).toBeUndefined()
    expect(タブの並び()).not.toContain(定義タブ)
  })

  it('繋がっていなくてもタブは閉じる', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    SQLタブを一枚にする()
    未接続にする()

    // Act
    await closeTabAndRelease('sql-1')

    // Assert
    expect(タブの並び()).not.toContain('sql-1')
    expect(calls.releaseTab).toEqual([])
  })

  it('無いタブを閉じようとしても何もしない', async () => {
    // Arrange
    setDbApi(createFakeDbApi().api)
    SQLタブを一枚にする()

    // Act
    await closeTabAndRelease('無いタブ')

    // Assert
    expect(タブの並び()).toEqual(['sql-1'])
  })
})

/** SQL タブを 4 枚にし、並び順の ID を返す。`dirty` に入れた位置のタブだけ書きかけにする。 */
function SQLタブを四枚にする(dirty: number[] = []): string[] {
  SQLタブを一枚にする()
  for (let index = 0; index < 3; index += 1) {
    useTabStore.getState().openNewTab()
  }
  const ids = タブの並び()
  for (const index of dirty) {
    useTabStore.getState().updateContent(ids[index], `select ${index} from dual`)
  }
  return ids
}

describe('closeOtherTabs', () => {
  it('右クリックしたタブだけを残し、他は手放して閉じる', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    const [a, b, c, d] = SQLタブを四枚にする()

    // Act
    await closeOtherTabs(b)

    // Assert
    expect(タブの並び()).toEqual([b])
    expect(calls.releaseTab.map((call) => call.tabId)).toEqual([a, c, d])
  })

  it('書きかけのタブで取り消されたら、そこから先は閉じない', async () => {
    // Arrange
    setDbApi(createFakeDbApi().api)
    const [a, b, c, d] = SQLタブを四枚にする([2])
    確認の答え = [false]

    // Act
    await closeOtherTabs(b)

    // Assert
    expect(尋ねた名前).toHaveLength(1)
    expect(タブの並び()).toEqual([b, c, d])
    expect(タブの並び()).not.toContain(a)
  })
})

describe('closeTabsToRight', () => {
  it('右クリックしたタブより右だけを閉じる', async () => {
    // Arrange
    setDbApi(createFakeDbApi().api)
    const [a, b] = SQLタブを四枚にする()

    // Act
    await closeTabsToRight(b)

    // Assert
    expect(タブの並び()).toEqual([a, b])
  })

  it('右端のタブでは何も閉じない', async () => {
    // Arrange
    setDbApi(createFakeDbApi().api)
    const ids = SQLタブを四枚にする()

    // Act
    await closeTabsToRight(ids[3])

    // Assert
    expect(タブの並び()).toEqual(ids)
  })
})

describe('closeActiveTab', () => {
  it('選んでいるタブを同じ関所を通して閉じる', async () => {
    // Arrange
    setDbApi(createFakeDbApi().api)
    SQLタブを一枚にする({ content: 'select 1 from dual', dirty: true })
    確認の答え = [true]

    // Act
    closeActiveTab()

    // Assert
    await expect.poll(() => タブの並び()).not.toContain('sql-1')
    expect(尋ねた名前).toEqual(['無題-1.sql'])
  })
})

describe('putSqlIntoEditor', () => {
  it('SQL タブを選んでいればその中身を差し替える', () => {
    // Arrange
    SQLタブを一枚にする({ content: 'select 1 from dual' })

    // Act
    putSqlIntoEditor('select 2 from dual')

    // Assert
    expect(タブの並び()).toEqual(['sql-1'])
    expect(selectActiveSqlTab(useTabStore.getState())?.content).toBe('select 2 from dual')
  })

  it('定義タブを選んでいれば新しい SQL タブを開いて入れる', () => {
    // Arrange
    setDbApi(createFakeDbApi().api)
    SQLタブを一枚にする({ content: 'select 1 from dual' })
    openDefinitionTab(USERS)

    // Act
    putSqlIntoEditor('select 2 from dual')

    // Assert
    expect(タブの並び()).toHaveLength(3)
    expect(selectActiveSqlTab(useTabStore.getState())?.content).toBe('select 2 from dual')
  })
})

describe('openSqlInNewTab', () => {
  it('新しいタブに入れるだけで実行はしない', () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    SQLタブを一枚にする({ content: 'select 1 from dual' })

    // Act
    openSqlInNewTab('select * from KODUCHI.USERS')

    // Assert
    expect(タブの並び()).toHaveLength(2)
    expect(selectActiveSqlTab(useTabStore.getState())?.content).toBe('select * from KODUCHI.USERS')
    expect(calls.execute).toEqual([])
  })
})

describe('openDefinitionTab', () => {
  it('定義タブを開き、そのタブぶんの定義を読む', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    SQLタブを一枚にする()

    // Act
    openDefinitionTab(USERS)

    // Assert
    expect(selectActiveTab(useTabStore.getState())?.kind).toBe('definition')
    await expect.poll(() => calls.objectDefinition).toHaveLength(1)
  })

  it('繋がっていなければ開かない', () => {
    // Arrange
    setDbApi(createFakeDbApi().api)
    SQLタブを一枚にする()
    未接続にする()

    // Act
    openDefinitionTab(USERS)

    // Assert
    expect(タブの並び()).toEqual(['sql-1'])
  })
})
