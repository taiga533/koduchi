import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from './App'
import { resetDbApi, setDbApi } from './api/db'
import { createFakeDbApi, queryResponse } from './test/fakeDbApi'
import { useConnectionStore } from './stores/connection'
import { useExecutionStore } from './stores/execution'
import { selectActiveTab, useTabStore } from './stores/tab'

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

beforeEach(() => {
  useConnectionStore.setState({ status: 'disconnected', connection: null, error: null })
  useExecutionStore.getState().clear()
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

  it('未接続のときは接続を作成する画面を出す', async () => {
    // Arrange
    const { api } = createFakeDbApi()
    setDbApi(api)

    // Act
    render(<App />)

    // Assert
    expect(await screen.findByText('接続を作成')).toBeInTheDocument()
    expect(screen.getByText('1つの接続が1つのウィンドウになります')).toBeInTheDocument()
  })

  it('必須項目が埋まるまで接続ボタンは押せない', async () => {
    // Arrange
    const { api } = createFakeDbApi()
    setDbApi(api)
    render(<App />)
    await screen.findByText('接続を作成')

    // Act
    const button = screen.getByRole('button', { name: '接続' })

    // Assert
    expect(button).toBeDisabled()
  })

  it('接続すると 3 パネル構成に切り替わる', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    render(<App />)
    await screen.findByText('接続を作成')
    const user = userEvent.setup()

    // Act
    await user.type(screen.getByLabelText('名前'), 'dev')
    await user.type(screen.getByLabelText('サービス名'), 'FREEPDB1')
    await user.type(screen.getByLabelText('ユーザー'), 'koduchi')
    await user.click(screen.getByRole('button', { name: '接続' }))

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
    await screen.findByText('接続を作成')
    const user = userEvent.setup()

    // Act
    await user.type(screen.getByLabelText('名前'), 'dev')
    await user.type(screen.getByLabelText('サービス名'), 'FREEPDB1')
    await user.type(screen.getByLabelText('ユーザー'), 'koduchi')
    await user.click(screen.getByRole('button', { name: '接続' }))

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
    await useExecutionStore.getState().execute('c1', 選択中のタブ(), 'select 1 from dual', '開発')

    // Assert
    expect(await screen.findByText('2 行 · 84 ms')).toBeInTheDocument()
    expect(screen.getByText('N')).toBeInTheDocument()
    expect(screen.getByText('S')).toBeInTheDocument()
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
      .execute('c1', 選択中のタブ(), 'select * from nowhere', '開発')

    // Assert
    expect(await screen.findByRole('button', { name: /メッセージ/ })).toBeInTheDocument()
    expect(screen.getByText('ORA-00942: table or view does not exist')).toBeInTheDocument()
  })
})
