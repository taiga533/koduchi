import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from './App'
import { resetDbApi, setDbApi } from './api/db'
import { createFakeDbApi, queryResponse } from './test/fakeDbApi'
import { EDITOR_HEIGHT_DEFAULT, SIDEBAR_WIDTH_DEFAULT } from './components/layout/paneSizes'
import { useConnectionStore } from './stores/connection'
import { emptyExecution, useExecutionStore } from './stores/execution'
import { useSchemaStore } from './stores/schema'
import { selectActiveTab, useTabStore } from './stores/tab'
import { useUiStore } from './stores/ui'

/** 2 行 2 列の問い合わせ結果。 */
const 二行の結果 = queryResponse(
  [
    { name: 'N', typeName: 'NUMBER(38,0)', kind: 'number' },
    { name: 'S', typeName: 'VARCHAR2(10)', kind: 'text' },
  ],
  [
    [
      { text: '1', kind: 'number' },
      { text: 'あ', kind: 'text' },
    ],
    [
      { text: '2', kind: 'number' },
      { text: '', kind: 'null' },
    ],
  ],
)

/** 選択中のタブの ID を返す。 */
function 選択中のタブ(): string {
  const tab = selectActiveTab(useTabStore.getState())
  if (!tab) {
    throw new Error('タブが選択されていない')
  }
  return tab.id
}

/** 接続済みの状態を作る。ペインの寸法を見るテストで使う。 */
const 接続済み = {
  status: 'connected' as const,
  connection: {
    id: 'c1',
    savedId: null,
    name: 'dev',
    params: {
      username: 'koduchi',
      password: '',
      target: {
        method: 'ezConnect' as const,
        host: 'localhost',
        port: 1521,
        serviceName: 'FREEPDB1',
      },
      readOnly: false,
    },
  },
  error: null,
}

/** 接続済みの状態にする。接続を経由せずに 3 パネル構成から始めるために使う。 */
function 接続済みにする(): void {
  useConnectionStore.setState(接続済み)
}

beforeEach(() => {
  useConnectionStore.setState({ status: 'disconnected', connection: null, error: null })
  useExecutionStore.getState().clear()
  useTabStore.setState({ bindValues: {} })
  useSchemaStore.getState().clear()
  useUiStore.setState({
    sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
    editorHeight: EDITOR_HEIGHT_DEFAULT,
  })
})

afterEach(() => {
  resetDbApi()
})

describe('App', () => {
  it('Instant Client が読めないときは案内画面を出す', async () => {
    // Arrange
    const { api } = createFakeDbApi({
      clientStatus: {
        status: 'unavailable',
        message: 'DPI-1047: Cannot locate a 64-bit Oracle Client library',
        candidates: ['/opt/homebrew/lib'],
      },
    })
    setDbApi(api)

    // Act
    render(<App />)

    // Assert
    expect(await screen.findByText('Oracle Instant Client が見つかりません')).toBeInTheDocument()
  })

  it('案内画面では検出された候補を選べる', async () => {
    // Arrange
    const { api } = createFakeDbApi({
      clientStatus: {
        status: 'unavailable',
        message: 'DPI-1047',
        candidates: ['/opt/homebrew/lib'],
      },
    })
    setDbApi(api)

    // Act
    render(<App />)

    // Assert
    await screen.findByText('Oracle Instant Client が見つかりません')
    expect(screen.getByDisplayValue('/opt/homebrew/lib')).toBeInTheDocument()
  })

  it('未接続のときはまず接続を選ぶ画面を出す', async () => {
    // Arrange
    const { api } = createFakeDbApi()
    setDbApi(api)

    // Act
    render(<App />)

    // Assert
    expect(await screen.findByText('接続を選ぶ')).toBeInTheDocument()
    expect(screen.getByText('1つの接続が1つのウィンドウになります')).toBeInTheDocument()
  })

  it('選ぶ画面の新しい接続から作成画面へ進む', async () => {
    // Arrange
    const { api } = createFakeDbApi()
    setDbApi(api)
    render(<App />)
    await screen.findByText('接続を選ぶ')

    // Act
    await userEvent.click(screen.getByRole('button', { name: '新しい接続' }))

    // Assert
    expect(await screen.findByText('接続を作成')).toBeInTheDocument()
  })

  it('作成画面から戻ると選ぶ画面に返る', async () => {
    // Arrange
    const { api } = createFakeDbApi()
    setDbApi(api)
    render(<App />)
    await screen.findByText('接続を選ぶ')
    await userEvent.click(screen.getByRole('button', { name: '新しい接続' }))
    await screen.findByText('接続を作成')

    // Act
    await userEvent.click(screen.getByRole('button', { name: '戻る' }))

    // Assert
    expect(await screen.findByText('接続を選ぶ')).toBeInTheDocument()
  })

  it('必須項目が埋まるまで接続ボタンは押せない', async () => {
    // Arrange
    const { api } = createFakeDbApi()
    setDbApi(api)
    render(<App />)
    await screen.findByText('接続を選ぶ')
    await userEvent.click(screen.getByRole('button', { name: '新しい接続' }))
    await screen.findByText('接続を作成')

    // Act
    const button = screen.getByRole('button', { name: '保存して接続' })

    // Assert
    expect(button).toBeDisabled()
  })

  it('接続すると 3 パネル構成に切り替わる', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    render(<App />)
    await screen.findByText('接続を選ぶ')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '新しい接続' }))
    await screen.findByText('接続を作成')

    // Act
    await user.type(screen.getByLabelText('名前'), 'dev')
    await user.type(screen.getByLabelText('サービス名'), 'FREEPDB1')
    await user.type(screen.getByLabelText('ユーザー'), 'koduchi')
    await user.click(screen.getByRole('button', { name: '保存して接続' }))

    // Assert
    await waitFor(() => expect(calls.connect).toHaveLength(1))
    expect(calls.connect[0].params.target).toEqual({
      method: 'ezConnect',
      host: 'localhost',
      port: 1521,
      serviceName: 'FREEPDB1',
    })
    expect(await screen.findByText('SQL を実行すると、ここに結果が出ます')).toBeInTheDocument()
  })

  it('接続に失敗するとエラーメッセージが画面に出る', async () => {
    // Arrange
    const { api } = createFakeDbApi({
      connectError: { kind: 'connect', message: 'ORA-12541: TNS:no listener' },
    })
    setDbApi(api)
    render(<App />)
    await screen.findByText('接続を選ぶ')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '新しい接続' }))
    await screen.findByText('接続を作成')

    // Act
    await user.type(screen.getByLabelText('名前'), 'dev')
    await user.type(screen.getByLabelText('サービス名'), 'FREEPDB1')
    await user.type(screen.getByLabelText('ユーザー'), 'koduchi')
    await user.click(screen.getByRole('button', { name: '保存して接続' }))

    // Assert
    expect(await screen.findByText('ORA-12541: TNS:no listener')).toBeInTheDocument()
  })

  it('実行結果は列見出しと行を伴って表示される', async () => {
    // Arrange
    const { api } = createFakeDbApi({ onExecute: () => 二行の結果 })
    setDbApi(api)
    useConnectionStore.setState({
      status: 'connected',
      connection: {
        id: 'c1',
        savedId: null,
        name: 'dev',
        params: {
          username: 'koduchi',
          password: '',
          target: { method: 'ezConnect', host: 'localhost', port: 1521, serviceName: 'FREEPDB1' },
          readOnly: false,
        },
      },
      error: null,
    })
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')

    // Act
    await useExecutionStore
      .getState()
      .execute('c1', 選択中のタブ(), 'select 1 from dual', '開発', [])

    // Assert
    expect(await screen.findByText('2 行 · 84 ms')).toBeInTheDocument()
    expect(screen.getByText('N')).toBeInTheDocument()
    expect(screen.getByText('S')).toBeInTheDocument()
  })

  it('バインド変数を含む SQL は値を尋ねてから実行する', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi({ onExecute: () => 二行の結果 })
    setDbApi(api)
    接続済みにする()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    useTabStore.getState().updateContent(選択中のタブ(), 'select * from users where id = :id')

    // Act
    await userEvent.click(screen.getByRole('button', { name: '実行' }))

    // Assert
    expect(await screen.findByText('バインド変数の値')).toBeInTheDocument()
    expect(calls.execute).toHaveLength(0)
  })

  it('尋ねた値を添えて実行する', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi({ onExecute: () => 二行の結果 })
    setDbApi(api)
    接続済みにする()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    useTabStore.getState().updateContent(選択中のタブ(), 'select * from users where id = :id')
    await userEvent.click(screen.getByRole('button', { name: '実行' }))
    await screen.findByText('バインド変数の値')

    // Act
    await userEvent.type(screen.getByLabelText(':id'), '42')
    await userEvent.click(screen.getByRole('button', { name: 'この値で実行' }))

    // Assert
    await waitFor(() => expect(calls.execute).toHaveLength(1))
    expect(calls.execute[0].binds).toEqual([['id', '42']])
  })

  it('null にチェックを付けると null として渡す', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi({ onExecute: () => 二行の結果 })
    setDbApi(api)
    接続済みにする()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    useTabStore.getState().updateContent(選択中のタブ(), 'select * from users where memo = :memo')
    await userEvent.click(screen.getByRole('button', { name: '実行' }))
    await screen.findByText('バインド変数の値')

    // Act
    await userEvent.click(screen.getByRole('checkbox', { name: 'NULL' }))
    await userEvent.click(screen.getByRole('button', { name: 'この値で実行' }))

    // Assert
    await waitFor(() => expect(calls.execute).toHaveLength(1))
    expect(calls.execute[0].binds).toEqual([['memo', null]])
  })

  it('前回の値は次に尋ねられたとき初期値になる', async () => {
    // Arrange
    const { api } = createFakeDbApi({ onExecute: () => 二行の結果 })
    setDbApi(api)
    接続済みにする()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    useTabStore.getState().updateContent(選択中のタブ(), 'select * from users where id = :id')
    await userEvent.click(screen.getByRole('button', { name: '実行' }))
    await screen.findByText('バインド変数の値')
    await userEvent.type(screen.getByLabelText(':id'), '42')
    await userEvent.click(screen.getByRole('button', { name: 'この値で実行' }))
    await waitFor(() => expect(screen.queryByText('バインド変数の値')).not.toBeInTheDocument())

    // Act
    await userEvent.click(screen.getByRole('button', { name: '実行' }))
    await screen.findByText('バインド変数の値')

    // Assert
    expect(screen.getByLabelText(':id')).toHaveValue('42')
  })

  it('取り消すと実行しない', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi({ onExecute: () => 二行の結果 })
    setDbApi(api)
    接続済みにする()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    useTabStore.getState().updateContent(選択中のタブ(), 'select * from users where id = :id')
    await userEvent.click(screen.getByRole('button', { name: '実行' }))
    await screen.findByText('バインド変数の値')

    // Act
    await userEvent.click(screen.getByRole('button', { name: '取り消す' }))

    // Assert
    expect(screen.queryByText('バインド変数の値')).not.toBeInTheDocument()
    expect(calls.execute).toHaveLength(0)
  })

  it('バインド変数が無ければ尋ねずに実行する', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi({ onExecute: () => 二行の結果 })
    setDbApi(api)
    接続済みにする()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    useTabStore.getState().updateContent(選択中のタブ(), 'select 1 from dual')

    // Act
    await userEvent.click(screen.getByRole('button', { name: '実行' }))

    // Assert
    await waitFor(() => expect(calls.execute).toHaveLength(1))
    expect(calls.execute[0].binds).toEqual([])
    expect(screen.queryByText('バインド変数の値')).not.toBeInTheDocument()
  })

  it('実行計画もバインド変数の値を添えて取る', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    接続済みにする()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    useTabStore.getState().updateContent(選択中のタブ(), 'select * from users where id = :id')
    await userEvent.keyboard('{Meta>}e{/Meta}')
    await screen.findByText('バインド変数の値')

    // Act
    await userEvent.type(screen.getByLabelText(':id'), '7')
    await userEvent.click(screen.getByRole('button', { name: 'この値で実行' }))

    // Assert
    await waitFor(() => expect(calls.explainPlan).toHaveLength(1))
    expect(calls.explainPlan[0].binds).toEqual([['id', '7']])
  })

  it('実行に失敗するとメッセージタブが現れる', async () => {
    // Arrange
    const { api } = createFakeDbApi({
      onExecute: () => {
        throw { kind: 'execute', message: 'ORA-00942: table or view does not exist' }
      },
    })
    setDbApi(api)
    useConnectionStore.setState({
      status: 'connected',
      connection: {
        id: 'c1',
        savedId: null,
        name: 'dev',
        params: {
          username: 'koduchi',
          password: '',
          target: { method: 'ezConnect', host: 'localhost', port: 1521, serviceName: 'FREEPDB1' },
          readOnly: false,
        },
      },
      error: null,
    })
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')

    // Act
    await useExecutionStore
      .getState()
      .execute('c1', 選択中のタブ(), 'select * from nowhere', '開発', [])

    // Assert
    expect(await screen.findByRole('button', { name: /メッセージ/ })).toBeInTheDocument()
    expect(screen.getByText('ORA-00942: table or view does not exist')).toBeInTheDocument()
  })

  it('切断すると接続を選ぶ画面へ戻り、エディタのタブは残る', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    接続済みにする()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    const タブ = 選択中のタブ()
    act(() => useTabStore.getState().updateContent(タブ, 'select * from dual'))
    const user = userEvent.setup()

    // Act
    await user.click(screen.getByRole('button', { name: '接続中' }))
    await user.click(screen.getByRole('menuitem', { name: '切断' }))

    // Assert
    expect(await screen.findByText('接続を選ぶ')).toBeInTheDocument()
    expect(calls.disconnect).toEqual(['c1'])
    expect(useTabStore.getState().tabs.map((tab) => tab.id)).toContain(タブ)
    expect(selectActiveTab(useTabStore.getState())?.content).toBe('select * from dual')
  })

  it('切断のときに開いている結果セットを閉じ、スキーマを捨てる', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi({
      onExecute: () => 二行の結果,
      schemas: [{ name: 'KODUCHI', objectCount: 1, objects: [{ name: 'T1', kind: 'table' }] }],
    })
    setDbApi(api)
    接続済みにする()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    const タブ = 選択中のタブ()
    await useExecutionStore.getState().execute('c1', タブ, 'select 1 from dual', 'dev', [])
    await waitFor(() => expect(useSchemaStore.getState().schemas).toHaveLength(1))
    const user = userEvent.setup()

    // Act
    await user.click(screen.getByRole('button', { name: '接続中' }))
    await user.click(screen.getByRole('menuitem', { name: '切断' }))

    // Assert
    await screen.findByText('接続を選ぶ')
    expect(calls.releaseTab).toEqual([{ id: 'c1', tabId: タブ }])
    expect(useExecutionStore.getState().byTab).toEqual({})
    expect(useSchemaStore.getState().schemas).toEqual([])
  })

  it('別の接続へ切り替えても切断して接続を選ぶ画面へ戻る', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    接続済みにする()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    const user = userEvent.setup()

    // Act
    await user.click(screen.getByRole('button', { name: '接続中' }))
    await user.click(screen.getByRole('menuitem', { name: '別の接続へ切り替え…' }))

    // Assert
    expect(await screen.findByText('接続を選ぶ')).toBeInTheDocument()
    expect(calls.disconnect).toEqual(['c1'])
  })

  it('実行中の文があるときは切断せず、中止を促す', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    接続済みにする()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    const タブ = 選択中のタブ()
    act(() =>
      useExecutionStore.setState({ byTab: { [タブ]: { ...emptyExecution, status: 'running' } } }),
    )
    const user = userEvent.setup()

    // Act
    await user.click(screen.getByRole('button', { name: '接続中' }))
    await user.click(screen.getByRole('menuitem', { name: '切断' }))

    // Assert
    expect(await screen.findByText('実行中のため切断できません')).toBeInTheDocument()
    expect(calls.disconnect).toEqual([])
    expect(useConnectionStore.getState().connection).not.toBeNull()
  })

  it('切断できない知らせから実行を中止できる', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    接続済みにする()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    const タブ = 選択中のタブ()
    act(() =>
      useExecutionStore.setState({ byTab: { [タブ]: { ...emptyExecution, status: 'running' } } }),
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '接続中' }))
    await user.click(screen.getByRole('menuitem', { name: '切断' }))
    await screen.findByText('実行中のため切断できません')

    // Act
    await user.click(screen.getByRole('button', { name: '実行を中止' }))

    // Assert
    expect(calls.cancel).toEqual([{ id: 'c1', tabId: タブ }])
    expect(screen.queryByText('実行中のため切断できません')).not.toBeInTheDocument()
  })

  it('サイドバーの境界をドラッグするとサイドバーの幅が変わる', async () => {
    // Arrange
    const { api } = createFakeDbApi()
    setDbApi(api)
    useConnectionStore.setState(接続済み)
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    const 境界 = screen.getByRole('separator', { name: 'サイドバーの幅' })

    // Act
    fireEvent.pointerDown(境界, { pointerId: 1, button: 0, clientX: 240, clientY: 0 })
    fireEvent.pointerMove(境界, { pointerId: 1, clientX: 320, clientY: 0 })
    fireEvent.pointerUp(境界, { pointerId: 1, clientX: 320, clientY: 0 })

    // Assert
    expect(useUiStore.getState().sidebarWidth).toBe(320)
    expect(境界).toHaveAttribute('aria-valuenow', '320')
  })

  it('エディタの境界をダブルクリックすると既定の高さへ戻る', async () => {
    // Arrange
    const { api } = createFakeDbApi()
    setDbApi(api)
    useConnectionStore.setState(接続済み)
    useUiStore.setState({ editorHeight: 420 })
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')

    // Act
    fireEvent.doubleClick(screen.getByRole('separator', { name: 'エディタの高さ' }))

    // Assert
    expect(useUiStore.getState().editorHeight).toBe(EDITOR_HEIGHT_DEFAULT)
  })

  it('保存されたペインの寸法をセッションから復元する', async () => {
    // Arrange
    const { api } = createFakeDbApi({
      session: {
        tabs: [],
        activeTabId: null,
        sidebarSegment: null,
        sidebarWidth: 300,
        editorHeight: 200,
      },
    })
    setDbApi(api)
    useConnectionStore.setState(接続済み)

    // Act
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')

    // Assert
    await waitFor(() => expect(useUiStore.getState().sidebarWidth).toBe(300))
    expect(useUiStore.getState().editorHeight).toBe(200)
  })

  it('寸法を持たない古いセッションを読んでも既定値で表示する', async () => {
    // Arrange
    const { api } = createFakeDbApi({
      session: {
        tabs: [],
        activeTabId: null,
        sidebarSegment: null,
        sidebarWidth: null,
        editorHeight: null,
      },
    })
    setDbApi(api)
    useConnectionStore.setState(接続済み)

    // Act
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')

    // Assert
    expect(useUiStore.getState().sidebarWidth).toBe(SIDEBAR_WIDTH_DEFAULT)
    expect(useUiStore.getState().editorHeight).toBe(EDITOR_HEIGHT_DEFAULT)
  })

  it('変えた寸法はセッションとして書き出される', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    useConnectionStore.setState(接続済み)
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')

    // Act
    fireEvent.keyDown(screen.getByRole('separator', { name: 'サイドバーの幅' }), {
      key: 'ArrowRight',
    })

    // Assert
    await waitFor(() => {
      const 最後 = calls.saveSession.at(-1)
      expect(最後?.state.sidebarWidth).toBe(SIDEBAR_WIDTH_DEFAULT + 8)
    })
  })
})
