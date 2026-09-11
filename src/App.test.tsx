import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from './App'
import { getDbApi, resetDbApi, setDbApi } from './api/db'
import { createFakeDbApi, emptyResponse, queryResponse } from './test/fakeDbApi'
import { resetPendingDialogs, setPendingDialogs } from './transaction/pendingChanges'
import { resetCloseTabDialog, setCloseTabDialog } from './components/editor/closing'
import { EDITOR_HEIGHT_DEFAULT, SIDEBAR_WIDTH_DEFAULT } from './components/layout/paneSizes'
import { useConnectionStore } from './stores/connection'
import { emptyExecution, useExecutionStore } from './stores/execution'
import { useDefinitionStore } from './stores/definition'
import { useSchemaStore } from './stores/schema'
import type { SchemaFilter, SchemaNode } from './types/db'
import { selectActiveSqlTab, selectActiveTab, useTabStore } from './stores/tab'
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

/** メッセージタブに積まれた「接続」の行を数える（ADR 0026）。 */
function 断の行を数える(): number {
  return useExecutionStore.getState().log.filter((entry) => entry.sql === '接続').length
}

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
      autoCommit: false,
    },
    completion: { identifierCase: 'preserve' as const },
    color: 'none' as const,
    group: null,
  },
  error: null,
}

/**
 * 接続済みの状態にする。接続を経由せずに 3 パネル構成から始めるために使う。
 *
 * @param readOnly 読み取り専用で接続したことにするか
 * @param autoCommit 自動コミットで接続したことにするか（ADR 0012）
 */
function 接続済みにする(readOnly = false, autoCommit = false): void {
  useConnectionStore.setState({
    ...接続済み,
    connection: {
      ...接続済み.connection,
      params: { ...接続済み.connection.params, readOnly, autoCommit },
      completion: { identifierCase: 'preserve' as const },
      color: 'none' as const,
      group: null,
    },
  })
}

/**
 * 未コミットの確認に返す答え。先頭から順に使う（ADR 0012）。
 *
 * ネイティブのダイアログは jsdom では開けないため、確認の境界を差し替える。
 */
let 確認の答え: boolean[] = []

/** 差し替えた確認へ実際に渡された問いかけ。 */
let 確認した問い: string[] = []

/**
 * 未保存のタブを閉じる確認に返す答え。先頭から順に使う（ADR 0023）。
 *
 * 未コミットの確認と同じく、ネイティブのダイアログは jsdom では開けないため
 * 境界を差し替える。
 */
let タブを閉じる確認の答え: boolean[] = []

/** 差し替えた確認へ実際に渡されたタブの名前。 */
let タブを閉じるか尋ねた名前: string[] = []

beforeEach(() => {
  確認の答え = []
  確認した問い = []
  setPendingDialogs((wording) => ({
    confirmProceed: async () => {
      確認した問い.push(wording.question)
      return 確認の答え.shift() ?? false
    },
    confirmCommit: async () => 確認の答え.shift() ?? false,
  }))
  タブを閉じる確認の答え = []
  タブを閉じるか尋ねた名前 = []
  setCloseTabDialog(async (name) => {
    タブを閉じるか尋ねた名前.push(name)
    return タブを閉じる確認の答え.shift() ?? false
  })
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
  resetPendingDialogs()
  resetCloseTabDialog()
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
          autoCommit: false,
        },
        completion: { identifierCase: 'preserve' as const },
        color: 'none' as const,
        group: null,
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
    expect(calls.execute[0].binds).toEqual([{ name: 'id', kind: 'number', value: '42' }])
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
    expect(calls.execute[0].binds).toEqual([{ name: 'memo', kind: 'varchar2', value: null }])
  })

  it('比べている列の型を既定として選ぶ', async () => {
    // Arrange: 列が読み込まれていれば、その型を初期値にする（ADR 0016）
    const { api } = createFakeDbApi({
      onExecute: () => 二行の結果,
      schemas: [{ name: 'KODUCHI', objectCount: 1, objects: [{ name: 'USERS', kind: 'table' }] }],
      columns: {
        KODUCHI: [
          {
            objectName: 'USERS',
            name: 'SIGNED_UP_AT',
            typeName: 'TIMESTAMP(6)',
            nullable: false,
            kind: 'datetime',
          },
        ],
      },
    })
    setDbApi(api)
    接続済みにする()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    await waitFor(() => expect(useSchemaStore.getState().columnStatus).toBe('ready'))
    useTabStore
      .getState()
      .updateContent(選択中のタブ(), 'select * from users where signed_up_at > :from')

    // Act
    await userEvent.click(screen.getByRole('button', { name: '実行' }))
    await screen.findByText('バインド変数の値')

    // Assert
    expect(screen.getByLabelText(':from の型')).toHaveValue('timestamp')
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
    expect(screen.getByLabelText(':id の型')).toHaveValue('number')
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
    expect(calls.explainPlan[0].binds).toEqual([{ name: 'id', kind: 'number', value: '7' }])
  })

  it('⇧⌘F でソース検索のパネルが開く', async () => {
    // Arrange: パレット（⌘K）とは別の道具である（ADR 0018・0021）
    const { api } = createFakeDbApi()
    setDbApi(api)
    接続済みにする()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')

    // Act
    await userEvent.keyboard('{Meta>}{Shift>}f{/Shift}{/Meta}')

    // Assert
    expect(
      await screen.findByRole('dialog', { name: 'オブジェクトのソース検索' }),
    ).toBeInTheDocument()
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
          autoCommit: false,
        },
        completion: { identifierCase: 'preserve' as const },
        color: 'none' as const,
        group: null,
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
    expect(selectActiveSqlTab(useTabStore.getState())?.content).toBe('select * from dual')
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

  it('⌥⌘C でコミットが呼ばれる', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    接続済みにする()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')

    // Act
    fireEvent.keyDown(window, { key: 'c', metaKey: true, altKey: true })

    // Assert
    await waitFor(() => expect(calls.commit).toEqual(['c1']))
  })

  it('⌥⌘R でロールバックが呼ばれる', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    接続済みにする()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')

    // Act
    fireEvent.keyDown(window, { key: 'r', metaKey: true, altKey: true })

    // Assert
    await waitFor(() => expect(calls.rollback).toEqual(['c1']))
  })

  it('ステータスバーのコミットを押すとコミットが呼ばれる', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    接続済みにする()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'コミット' }))

    // Assert
    await waitFor(() => expect(calls.commit).toEqual(['c1']))
  })

  it('未コミットの実行の後はステータスバーに未コミットが出る', async () => {
    // Arrange
    const { api } = createFakeDbApi({
      onExecute: () => ({ ...二行の結果, inTransaction: true }),
    })
    setDbApi(api)
    接続済みにする()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')

    // Act
    await useExecutionStore
      .getState()
      .execute('c1', 選択中のタブ(), 'insert into t values (1)', '開発', [])

    // Assert
    expect(await screen.findByText('未コミット')).toBeInTheDocument()
  })

  it('未コミットのまま切断しようとすると確認が出て、やめると切断しない', async () => {
    // Arrange: 確認は「閉じるか / やめるか」を先に尋ねる（ADR 0012）
    const { api, calls } = createFakeDbApi({
      onExecute: () => ({ ...二行の結果, inTransaction: true }),
    })
    setDbApi(api)
    接続済みにする()
    確認の答え = [false]
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    await useExecutionStore
      .getState()
      .execute('c1', 選択中のタブ(), 'insert into t values (1)', '開発', [])
    const user = userEvent.setup()

    // Act
    await user.click(screen.getByRole('button', { name: '接続中' }))
    await user.click(screen.getByRole('menuitem', { name: '切断' }))

    // Assert
    await waitFor(() => expect(確認した問い).toHaveLength(1))
    expect(確認した問い[0]).toContain('未コミットの変更があります')
    expect(calls.disconnect).toEqual([])
    expect(screen.queryByText('接続を選ぶ')).not.toBeInTheDocument()
  })

  it('未コミットのまま切断してコミットを選ぶと、コミットしてから切断する', async () => {
    // Arrange: 1 段目で「切断」、2 段目で「コミット」を選ぶ
    const { api, calls } = createFakeDbApi({
      onExecute: () => ({ ...二行の結果, inTransaction: true }),
    })
    setDbApi(api)
    接続済みにする()
    確認の答え = [true, true]
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    await useExecutionStore
      .getState()
      .execute('c1', 選択中のタブ(), 'insert into t values (1)', '開発', [])
    const user = userEvent.setup()

    // Act
    await user.click(screen.getByRole('button', { name: '接続中' }))
    await user.click(screen.getByRole('menuitem', { name: '切断' }))

    // Assert
    expect(await screen.findByText('接続を選ぶ')).toBeInTheDocument()
    expect(calls.commit).toEqual(['c1'])
    expect(calls.disconnect).toEqual(['c1'])
  })

  it('未コミットのまま切断して破棄を選ぶと、ロールバックしてから切断する', async () => {
    // Arrange: 1 段目で「切断」、2 段目で「破棄」を選ぶ
    const { api, calls } = createFakeDbApi({
      onExecute: () => ({ ...二行の結果, inTransaction: true }),
    })
    setDbApi(api)
    接続済みにする()
    確認の答え = [true, false]
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    await useExecutionStore
      .getState()
      .execute('c1', 選択中のタブ(), 'insert into t values (1)', '開発', [])
    const user = userEvent.setup()

    // Act
    await user.click(screen.getByRole('button', { name: '接続中' }))
    await user.click(screen.getByRole('menuitem', { name: '切断' }))

    // Assert
    expect(await screen.findByText('接続を選ぶ')).toBeInTheDocument()
    expect(calls.rollback).toEqual(['c1'])
    expect(calls.disconnect).toEqual(['c1'])
  })

  it('未コミットが無ければ切断で確認を出さない', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    接続済みにする()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    const user = userEvent.setup()

    // Act
    await user.click(screen.getByRole('button', { name: '接続中' }))
    await user.click(screen.getByRole('menuitem', { name: '切断' }))

    // Assert
    expect(await screen.findByText('接続を選ぶ')).toBeInTheDocument()
    expect(確認した問い).toEqual([])
    expect(calls.disconnect).toEqual(['c1'])
  })
  it('すべて実行を選ぶとタブの文が順に実行される', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    接続済みにする()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    useTabStore
      .getState()
      .updateContent(選択中のタブ(), 'create table t (n number);\ninsert into t values (1);')

    // Act
    await userEvent.click(screen.getByRole('button', { name: '実行のメニュー' }))
    await userEvent.click(screen.getByRole('button', { name: /すべて実行/ }))

    // Assert
    await waitFor(() =>
      expect(calls.execute.map((call) => call.sql)).toEqual([
        'create table t (n number)',
        'insert into t values (1)',
      ]),
    )
  })

  it('すべて実行のバインド変数は全文ぶんまとめて 1 度だけ尋ねる', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    接続済みにする()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    useTabStore
      .getState()
      .updateContent(
        選択中のタブ(),
        'insert into t values (:id);\nupdate t set name = :name where id = :id;',
      )
    const user = userEvent.setup()

    // Act
    await user.click(screen.getByRole('button', { name: '実行のメニュー' }))
    await user.click(screen.getByRole('button', { name: /すべて実行/ }))
    await screen.findByText('バインド変数の値')
    await user.type(screen.getByLabelText(':id'), '7')
    await user.type(screen.getByLabelText(':name'), 'あ')
    await user.click(screen.getByRole('button', { name: 'この値で実行' }))

    // Assert
    await waitFor(() => expect(calls.execute).toHaveLength(2))
    expect(screen.queryByText('バインド変数の値')).not.toBeInTheDocument()
    for (const call of calls.execute) {
      expect(call.binds).toEqual([
        { name: 'id', kind: 'number', value: '7' },
        { name: 'name', kind: 'varchar2', value: 'あ' },
      ])
    }
  })

  it('すべて実行が途中で失敗すると未コミットのまま止まる', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi({
      onExecute: (sql) => {
        if (sql === 'insert into t values (2)') {
          throw { kind: 'execute', message: 'ORA-00001: unique constraint violated' }
        }
        return { ...emptyResponse, affectedRows: 1, inTransaction: true }
      },
    })
    setDbApi(api)
    接続済みにする()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    useTabStore
      .getState()
      .updateContent(
        選択中のタブ(),
        'insert into t values (1);\ninsert into t values (2);\ninsert into t values (3);',
      )

    // Act
    await userEvent.click(screen.getByRole('button', { name: '実行のメニュー' }))
    await userEvent.click(screen.getByRole('button', { name: /すべて実行/ }))

    // Assert
    expect(await screen.findByText('未コミット')).toBeInTheDocument()
    expect(calls.execute.map((call) => call.sql)).toEqual([
      'insert into t values (1)',
      'insert into t values (2)',
    ])
    expect(screen.getByText(/3 文中 2 文目で失敗しました/)).toBeInTheDocument()
  })
  it('書きかけのタブを閉じるときは確認を挟む（ADR 0023）', async () => {
    // Arrange
    const { api } = createFakeDbApi({})
    setDbApi(api)
    接続済みにする()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    const タブ = 選択中のタブ()
    act(() => {
      useTabStore.getState().updateContent(タブ, 'select 1 from dual')
    })
    タブを閉じる確認の答え = [false]

    // Act
    await userEvent.click(screen.getByRole('button', { name: /を閉じる$/ }))

    // Assert
    expect(タブを閉じるか尋ねた名前).toHaveLength(1)
    expect(useTabStore.getState().tabs.some((tab) => tab.id === タブ)).toBe(true)
  })

  it('確認で閉じるを選ぶとタブが閉じる', async () => {
    // Arrange
    const { api } = createFakeDbApi({})
    setDbApi(api)
    接続済みにする()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    const タブ = 選択中のタブ()
    act(() => {
      useTabStore.getState().updateContent(タブ, 'select 1 from dual')
    })
    タブを閉じる確認の答え = [true]

    // Act
    await userEvent.click(screen.getByRole('button', { name: /を閉じる$/ }))

    // Assert
    await waitFor(() =>
      expect(useTabStore.getState().tabs.some((tab) => tab.id === タブ)).toBe(false),
    )
  })

  it('何も打っていないタブは尋ねずに閉じる', async () => {
    // Arrange
    const { api } = createFakeDbApi({})
    setDbApi(api)
    接続済みにする()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    const タブ = 選択中のタブ()

    // Act
    await userEvent.click(screen.getByRole('button', { name: /を閉じる$/ }))

    // Assert
    await waitFor(() =>
      expect(useTabStore.getState().tabs.some((tab) => tab.id === タブ)).toBe(false),
    )
    expect(タブを閉じるか尋ねた名前).toHaveLength(0)
  })
})

/** タブ帯を SQL タブ 1 枚に戻す（ADR 0022）。 */
function タブを初期化する(): void {
  useTabStore.setState({
    tabs: [
      { kind: 'sql', id: 'sql-1', name: '無題-1.sql', filePath: null, content: '', dirty: false },
    ],
    activeTabId: 'sql-1',
    bindValues: {},
  })
  useDefinitionStore.getState().clear()
}

/**
 * ツリーの `USERS` を右クリックして「定義を開く」を押す（ADR 0022）。
 *
 * @param user 打鍵の口
 */
async function 定義を開く(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  // 「テーブル」は種別フィルタの項目にもあるため、ツリーの中だけを見る。
  const tree = within(await screen.findByTestId('schema-tree'))
  // 既に開いている枝を押すと畳んでしまう。閉じているときだけ押す。
  const 開く = async (name: RegExp) => {
    const row = await tree.findByRole('button', { name })
    if (row.getAttribute('aria-expanded') === 'false') {
      await user.click(row)
    }
  }
  await 開く(/KODUCHI/)
  await 開く(/テーブル/)
  fireEvent.contextMenu(await tree.findByRole('button', { name: 'USERS' }))
  await user.click(screen.getByRole('menuitem', { name: '定義を開く' }))
}

/**
 * テーブル定義タブ（ADR 0022）。
 *
 * ツリーの右クリックからタブが開くこと、定義タブの間は結果ペインが出ないこと、
 * SQL タブへ戻れば元どおりになることを見る。
 */
describe('テーブル定義タブ', () => {
  // jsdom は要素の寸法を持たず、ツリーの仮想スクロールが領域を 0 と見なして
  // 行を 1 つも描かない。寸法だけを補う（`SchemaTree.test.tsx` と同じ手当て）。
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      value: 600,
    })
  })

  afterAll(() => {
    Reflect.deleteProperty(HTMLElement.prototype, 'offsetHeight')
  })

  /** ツリーに置く 1 スキーマ 1 テーブル。取得の窓口が返す。 */
  const スキーマ一覧: SchemaNode[] = [
    { name: 'KODUCHI', objectCount: 1, objects: [{ name: 'USERS', kind: 'table' }] },
  ]

  it('右クリックの「定義を開く」でタブ帯に定義タブが増える', async () => {
    // Arrange
    const { api } = createFakeDbApi({ schemas: スキーマ一覧 })
    setDbApi(api)
    接続済みにする()
    タブを初期化する()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    const user = userEvent.setup()

    // Act
    await 定義を開く(user)

    // Assert
    expect(await screen.findByRole('button', { name: 'USERS の定義' })).toBeInTheDocument()
    expect(useTabStore.getState().tabs.map((tab) => tab.kind)).toEqual(['sql', 'definition'])
  })

  it('定義タブを選んでいる間はエディタも結果ペインも出さない', async () => {
    // Arrange: 定義は実行の結果ではなく、結果ペインは空のまま場所を取るだけである
    const { api } = createFakeDbApi({ schemas: スキーマ一覧 })
    setDbApi(api)
    接続済みにする()
    タブを初期化する()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    const user = userEvent.setup()

    // Act
    await 定義を開く(user)

    // Assert
    expect(await screen.findByTestId('table-definition')).toBeInTheDocument()
    expect(screen.queryByText('SQL を実行すると、ここに結果が出ます')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '実行のメニュー' })).not.toBeInTheDocument()
  })

  it('SQL タブへ戻ると結果ペインが返ってくる', async () => {
    // Arrange
    const { api } = createFakeDbApi({ schemas: スキーマ一覧 })
    setDbApi(api)
    接続済みにする()
    タブを初期化する()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    const user = userEvent.setup()
    await 定義を開く(user)
    await screen.findByTestId('table-definition')

    // Act
    await user.click(screen.getByRole('button', { name: '無題-1.sql' }))

    // Assert
    expect(await screen.findByText('SQL を実行すると、ここに結果が出ます')).toBeInTheDocument()
    expect(screen.queryByTestId('table-definition')).not.toBeInTheDocument()
  })

  it('同じオブジェクトの定義は 2 枚目を開かない', async () => {
    // Arrange
    const { api } = createFakeDbApi({ schemas: スキーマ一覧 })
    setDbApi(api)
    接続済みにする()
    タブを初期化する()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    const user = userEvent.setup()
    await 定義を開く(user)
    await screen.findByTestId('table-definition')
    await user.click(screen.getByRole('button', { name: '無題-1.sql' }))

    // Act
    await 定義を開く(user)

    // Assert
    expect(useTabStore.getState().tabs).toHaveLength(2)
    expect(useTabStore.getState().tabs[1].name).toBe('USERS')
  })

  it('定義タブを閉じるとその定義を手放す', async () => {
    // Arrange
    const { api } = createFakeDbApi({ schemas: スキーマ一覧 })
    setDbApi(api)
    接続済みにする()
    タブを初期化する()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    const user = userEvent.setup()
    await 定義を開く(user)
    await screen.findByTestId('table-definition')

    // Act
    await user.click(screen.getByRole('button', { name: 'USERS を閉じる' }))

    // Assert
    expect(useTabStore.getState().tabs.map((tab) => tab.kind)).toEqual(['sql'])
    expect(useDefinitionStore.getState().byTab).toEqual({})
  })

  it('定義タブはセッションに書き出さない', async () => {
    // Arrange: 定義は接続に属し、再起動後は中身を出せない（ADR 0019・0022）
    const { api, calls } = createFakeDbApi({ schemas: スキーマ一覧 })
    setDbApi(api)
    接続済みにする()
    タブを初期化する()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    const user = userEvent.setup()

    // Act
    await 定義を開く(user)

    // Assert
    await waitFor(() => expect(calls.saveSession.length).toBeGreaterThan(0))
    const 最後 = calls.saveSession[calls.saveSession.length - 1]
    expect(最後.state.tabs.map((tab) => tab.id)).toEqual(['sql-1'])
  })
})

describe('接続断の検出と回復（ADR 0026）', () => {
  // 定義タブを開くテストの後だと、選ばれているタブが SQL タブでないことがある
  // （ADR 0022）。空の SQL タブ 1 枚から始める。
  beforeEach(() => {
    const tab = {
      kind: 'sql' as const,
      id: 'lost-tab',
      name: '無題.sql',
      filePath: null,
      content: '',
      dirty: false,
    }
    useTabStore.setState({ tabs: [tab], activeTabId: tab.id, bindValues: {} })
  })

  /** スキーマ取得に渡す既定の絞り込み。中身は問わない。 */
  const 既定のフィルタ = {
    excludeSystem: true,
    hideEmpty: true,
    kinds: {},
  } as unknown as SchemaFilter

  /** アイドル時間の超過。昼休みのあとに最初に出会う番号である。 */
  const アイドル切断 = {
    kind: 'connectionLost' as const,
    message: 'ORA-02396: 最大アイドル時間を超過しました。再接続してください',
  }

  it('実行が接続断で失敗するとステータスバーがその旨に変わる', async () => {
    // Arrange: ステータスバーが「接続中」のままでは何も分からない
    const { api } = createFakeDbApi({
      onExecute: () => Promise.reject(アイドル切断),
    })
    setDbApi(api)
    接続済みにする()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    useTabStore.getState().updateContent(選択中のタブ(), 'select 1 from dual')

    // Act
    await userEvent.click(screen.getByRole('button', { name: '実行' }))

    // Assert
    expect(await screen.findByText('接続が切れました')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '接続中' })).not.toBeInTheDocument()
  })

  it('実行以外の往復で切れても同じように気付く', async () => {
    // Arrange: 断はどの往復でも起こりうる。気付く場所は `src/api/` 層の 1 箇所に
    // 寄せてあり、経路ごとに書き足す形にはしていない
    const { api } = createFakeDbApi({ commitError: アイドル切断 })
    setDbApi(api)
    接続済みにする()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'コミット' }))

    // Assert
    expect(await screen.findByText('接続が切れました')).toBeInTheDocument()
  })

  it('接続断のあとに再接続を押すと接続中へ戻る', async () => {
    // Arrange
    let 断を返す = true
    const { api, calls } = createFakeDbApi({
      onExecute: () => (断を返す ? Promise.reject(アイドル切断) : emptyResponse),
    })
    setDbApi(api)
    接続済みにする()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    useTabStore.getState().updateContent(選択中のタブ(), 'select 1 from dual')
    await userEvent.click(screen.getByRole('button', { name: '実行' }))
    await screen.findByText('接続が切れました')
    断を返す = false

    // Act
    await userEvent.click(screen.getByRole('button', { name: '再接続' }))

    // Assert
    expect(await screen.findByRole('button', { name: '接続中' })).toBeInTheDocument()
    expect(calls.connect).toHaveLength(1)
  })

  it('スキーマの読み込み中に切れても、繋ぎ直せばツリーを取り直す', async () => {
    // Arrange: ツリーは接続の識別子で引く。取り直さないと、断で止まった
    // ままのツリーが空で残り続ける（ADR 0030）
    let 断を返す = true
    const { api, calls } = createFakeDbApi({
      onSchemaOverview: () => (断を返す ? Promise.reject(アイドル切断) : []),
    })
    setDbApi(api)
    接続済みにする()
    render(<App />)
    await screen.findByText('接続が切れました')
    断を返す = false
    const 断までの取得回数 = calls.schemaOverview.length

    // Act
    await userEvent.click(screen.getByRole('button', { name: '再接続' }))

    // Assert
    await screen.findByRole('button', { name: '接続中' })
    await waitFor(() => expect(calls.schemaOverview.length).toBeGreaterThan(断までの取得回数))
    const 繋ぎ直した後の識別子 = useConnectionStore.getState().connection?.id
    expect(calls.schemaOverview.at(-1)?.id).toBe(繋ぎ直した後の識別子)
  })

  it('未コミットのまま切れたらロールバックされたことをメッセージタブへ残す', async () => {
    // Arrange: 未コミットの表示だけを黙って消すのが最も悪い（ADR 0012 からの申し送り）
    let 断を返す = false
    const { api } = createFakeDbApi({
      onExecute: () =>
        断を返す ? Promise.reject(アイドル切断) : { ...emptyResponse, inTransaction: true },
    })
    setDbApi(api)
    接続済みにする()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    useTabStore.getState().updateContent(選択中のタブ(), "update users set name = 'あ'")
    await userEvent.click(screen.getByRole('button', { name: '実行' }))
    await screen.findByText('未コミット')
    断を返す = true

    // Act
    await userEvent.click(screen.getByRole('button', { name: '実行' }))

    // Assert
    await screen.findByText('接続が切れました')
    expect(useExecutionStore.getState().inTransaction).toBe(false)
    expect(screen.queryByText('未コミット')).not.toBeInTheDocument()
    // 断の報せは、失敗した文そのもののログとは別の 1 行として積まれる
    const 断の行 = useExecutionStore.getState().log.find((entry) => entry.sql === '接続')
    expect(断の行?.error).toContain('ロールバックされました')
  })

  it('切れたあと何度往復してもメッセージタブの断の行は増えない', async () => {
    // Arrange: 印が立った後のプールは往復せずその場で断を返す。数えてしまうと、
    // いちばん読みたい最初の 1 行が上へ押し流される（ADR 0026）
    const { api } = createFakeDbApi({ onExecute: () => Promise.reject(アイドル切断) })
    setDbApi(api)
    接続済みにする()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    useTabStore.getState().updateContent(選択中のタブ(), 'select 1 from dual')
    await userEvent.click(screen.getByRole('button', { name: '実行' }))
    await screen.findByText('接続が切れました')

    // Act: 切れたあとに触りうる操作を重ねる
    await userEvent.click(screen.getByRole('button', { name: '実行' }))
    await userEvent.click(screen.getByRole('button', { name: '実行' }))
    await act(async () => {
      await getDbApi()
        .listSessions('c1')
        .catch(() => {})
      await getDbApi()
        .schemaOverview('c1', 既定のフィルタ)
        .catch(() => {})
    })

    // Assert
    expect(断の行を数える()).toBe(1)
  })

  it('繋ぎ直したあとに再び切れたら新しい行が出る', async () => {
    // Arrange: 2 度目の断を 1 度目と同じものとして飲み込まない（ADR 0026）
    let 断を返す = true
    const { api } = createFakeDbApi({
      onExecute: () => (断を返す ? Promise.reject(アイドル切断) : emptyResponse),
    })
    setDbApi(api)
    接続済みにする()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    useTabStore.getState().updateContent(選択中のタブ(), 'select 1 from dual')
    await userEvent.click(screen.getByRole('button', { name: '実行' }))
    await screen.findByText('接続が切れました')
    断を返す = false
    await userEvent.click(screen.getByRole('button', { name: '再接続' }))
    await screen.findByRole('button', { name: '接続中' })
    断を返す = true

    // Act
    await userEvent.click(screen.getByRole('button', { name: '実行' }))

    // Assert
    await screen.findByText('接続が切れました')
    expect(断の行を数える()).toBe(2)
  })

  it('繋ぎ直せなかったら押した結果がメッセージタブへ残る', async () => {
    // Arrange: 押した結果が分からないと、押したのかどうかも見分けられない
    const { api } = createFakeDbApi({
      onExecute: () => Promise.reject(アイドル切断),
      connectError: { kind: 'connect', message: 'ORA-12541: TNS:no listener' },
    })
    setDbApi(api)
    接続済みにする()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    useTabStore.getState().updateContent(選択中のタブ(), 'select 1 from dual')
    await userEvent.click(screen.getByRole('button', { name: '実行' }))
    await screen.findByText('接続が切れました')

    // Act
    await userEvent.click(screen.getByRole('button', { name: '再接続' }))

    // Assert: 切れたままで、押した結果が 1 行として残る
    expect(await screen.findByRole('button', { name: '再接続' })).toBeInTheDocument()
    const 失敗の行 = useExecutionStore
      .getState()
      .log.filter((entry) => entry.error?.includes('繋ぎ直せませんでした'))
    expect(失敗の行).toHaveLength(1)
    expect(失敗の行[0].error).toContain('ORA-12541')
  })

  it('接続が切れているときの切断は未コミットを尋ねずに接続を選ぶ画面へ戻る', async () => {
    // Arrange: 届かないコミットを尋ねて袋小路へ入れない（ADR 0026）
    let 断を返す = false
    const { api } = createFakeDbApi({
      onExecute: () =>
        断を返す ? Promise.reject(アイドル切断) : { ...emptyResponse, inTransaction: true },
    })
    setDbApi(api)
    接続済みにする()
    render(<App />)
    await screen.findByText('SQL を実行すると、ここに結果が出ます')
    useTabStore.getState().updateContent(選択中のタブ(), "update users set name = 'あ'")
    await userEvent.click(screen.getByRole('button', { name: '実行' }))
    await screen.findByText('未コミット')
    断を返す = true
    await userEvent.click(screen.getByRole('button', { name: '実行' }))
    await screen.findByText('接続が切れました')

    // Act
    await userEvent.click(screen.getByRole('button', { name: '切断' }))

    // Assert
    expect(await screen.findByText('接続を選ぶ')).toBeInTheDocument()
    expect(確認した問い).toEqual([])
  })
})
