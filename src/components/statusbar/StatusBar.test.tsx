/**
 * ステータスバーのテスト。
 *
 * 接続メニュー（切断・切り替え）と、未コミットの表示およびコミット /
 * ロールバックのボタン（ADR 0012）の両方を見る。
 *
 * 接続の状態はストアへ直に置いて用意する。`src/api/` 層を差し替えるまでもなく、
 * ここで見たいのは「押せるか」「何が出るか」「何を呼ぶか」だけである。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StatusBar } from './StatusBar'
import { useConnectionStore } from '../../stores/connection'
import { useExecutionStore } from '../../stores/execution'
import { resetDbApi, setDbApi } from '../../api/db'
import { createFakeDbApi } from '../../test/fakeDbApi'
import { onConnectionLost, PROBE_LOST_MESSAGE } from '../../connection/lost'
import { FRESH_WINDOW_MS } from '../../connection/freshness'
import type { ConnectionColor, ConnectionParams } from '../../types/db'

/**
 * 接続中に見せるための接続情報。
 *
 * @param readOnly 読み取り専用で繋いだことにするか
 * @param autoCommit 自動コミットで繋いだことにするか（ADR 0012）
 */
function 接続の設定(readOnly = false, autoCommit = false): ConnectionParams {
  return {
    username: 'koduchi',
    password: '',
    target: { method: 'ezConnect', host: 'localhost', port: 1521, serviceName: 'FREEPDB1' },
    readOnly,
    autoCommit,
  }
}

/**
 * 接続済みの状態にする。
 *
 * @param readOnly 読み取り専用で繋いだことにするか
 * @param autoCommit 自動コミットで繋いだことにするか（ADR 0012）
 * @param color 接続に付いている色（ADR 0015）
 */
function 接続済みにする(
  readOnly = false,
  autoCommit = false,
  color: ConnectionColor = 'none',
): void {
  useConnectionStore.setState({
    status: 'connected',
    connection: {
      id: 'c1',
      savedId: null,
      name: 'dev',
      params: 接続の設定(readOnly, autoCommit),
      completion: { identifierCase: 'preserve' },
      color,
      group: null,
    },
    error: null,
  })
}

/**
 * サーバ側で接続が切れた状態にする（ADR 0026）。
 *
 * 接続の情報は残す。繋ぎ直すのに接続先とユーザーが要るためである。
 */
function 接続が切れた状態にする(): void {
  接続済みにする()
  useConnectionStore.getState().markLost('ORA-02396: 最大アイドル時間を超過しました')
}

/** 必ず要るハンドラをまとめて用意する。 */
function ハンドラを作る() {
  return { onOpenSettings: vi.fn(), onDisconnect: vi.fn(), onSwitchConnection: vi.fn() }
}

beforeEach(() => {
  useConnectionStore.setState({ status: 'disconnected', connection: null, error: null })
  useExecutionStore.getState().clear()
})

afterEach(() => {
  resetDbApi()
})

describe('StatusBar', () => {
  it('未接続のときは接続状態を押せない', () => {
    // Arrange
    const handlers = ハンドラを作る()

    // Act
    render(<StatusBar {...handlers} />)

    // Assert
    expect(screen.getByText('未接続')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '接続中' })).not.toBeInTheDocument()
  })

  it('接続中の表示を押すと切断と切り替えのメニューが出る', async () => {
    // Arrange
    接続済みにする()
    const handlers = ハンドラを作る()
    render(<StatusBar {...handlers} />)

    // Act
    await userEvent.click(screen.getByRole('button', { name: '接続中' }))

    // Assert
    expect(screen.getByRole('menuitem', { name: '切断' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '別の接続へ切り替え…' })).toBeInTheDocument()
  })

  it('切断を選ぶと切断が呼ばれ、メニューは閉じる', async () => {
    // Arrange
    接続済みにする()
    const handlers = ハンドラを作る()
    render(<StatusBar {...handlers} />)
    await userEvent.click(screen.getByRole('button', { name: '接続中' }))

    // Act
    await userEvent.click(screen.getByRole('menuitem', { name: '切断' }))

    // Assert
    expect(handlers.onDisconnect).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menuitem', { name: '切断' })).not.toBeInTheDocument()
  })

  it('別の接続へ切り替えを選ぶと切り替えが呼ばれる', async () => {
    // Arrange
    接続済みにする()
    const handlers = ハンドラを作る()
    render(<StatusBar {...handlers} />)
    await userEvent.click(screen.getByRole('button', { name: '接続中' }))

    // Act
    await userEvent.click(screen.getByRole('menuitem', { name: '別の接続へ切り替え…' }))

    // Assert
    expect(handlers.onSwitchConnection).toHaveBeenCalledTimes(1)
  })

  it('セッションとロックを選ぶとパネルを開く手続きが呼ばれる', async () => {
    // Arrange: 入口は「今どこへ繋がっているか」を出している所に置く（ADR 0017）
    接続済みにする()
    const handlers = ハンドラを作る()
    const onOpenSessions = vi.fn()
    render(<StatusBar {...handlers} onOpenSessions={onOpenSessions} />)
    await userEvent.click(screen.getByRole('button', { name: '接続中' }))

    // Act
    await userEvent.click(screen.getByRole('menuitem', { name: 'セッションとロック…' }))

    // Assert
    expect(onOpenSessions).toHaveBeenCalledTimes(1)
  })

  it('ソースを検索を選ぶとパネルを開く手続きが呼ばれる', async () => {
    // Arrange: セッションとロックと同じ入口に置く（ADR 0021）
    接続済みにする()
    const handlers = ハンドラを作る()
    const onOpenSourceSearch = vi.fn()
    render(<StatusBar {...handlers} onOpenSourceSearch={onOpenSourceSearch} />)
    await userEvent.click(screen.getByRole('button', { name: '接続中' }))

    // Act
    await userEvent.click(screen.getByRole('menuitem', { name: 'ソースを検索…' }))

    // Assert
    expect(onOpenSourceSearch).toHaveBeenCalledTimes(1)
  })

  it('パネルを開く手続きが無ければセッションの項目は出ない', async () => {
    // Arrange: 接続していない画面では意味を持たない
    接続済みにする()
    const handlers = ハンドラを作る()
    render(<StatusBar {...handlers} />)

    // Act
    await userEvent.click(screen.getByRole('button', { name: '接続中' }))

    // Assert
    expect(screen.queryByRole('menuitem', { name: 'セッションとロック…' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'ソースを検索…' })).not.toBeInTheDocument()
  })

  it('手動コミットの接続で未コミットのときは未コミットと出る', () => {
    // Arrange
    接続済みにする()
    useExecutionStore.setState({ inTransaction: true })

    // Act
    render(<StatusBar {...ハンドラを作る()} />)

    // Assert
    expect(screen.getByText('未コミット')).toBeInTheDocument()
  })

  it('未コミットでなければ未コミットとは出ない', () => {
    // Arrange
    接続済みにする()

    // Act
    render(<StatusBar {...ハンドラを作る()} />)

    // Assert
    expect(screen.queryByText('未コミット')).not.toBeInTheDocument()
  })

  it('読み取り専用の接続では未コミットもボタンも出ない', () => {
    // Arrange
    接続済みにする(true, false)
    useExecutionStore.setState({ inTransaction: true })

    // Act
    render(<StatusBar {...ハンドラを作る()} />)

    // Assert
    expect(screen.queryByText('未コミット')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'コミット' })).not.toBeInTheDocument()
  })

  it('自動コミットの接続では未コミットもボタンも出ない', () => {
    // Arrange
    接続済みにする(false, true)
    useExecutionStore.setState({ inTransaction: true })

    // Act
    render(<StatusBar {...ハンドラを作る()} />)

    // Assert
    expect(screen.queryByText('未コミット')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'ロールバック' })).not.toBeInTheDocument()
  })

  it('手動コミットの接続にはコミットとロールバックのボタンが並ぶ', () => {
    // Arrange
    接続済みにする()

    // Act
    render(<StatusBar {...ハンドラを作る()} />)

    // Assert
    expect(screen.getByRole('button', { name: 'コミット' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ロールバック' })).toBeInTheDocument()
  })

  it('未接続のときはコミットのボタンを出さない', () => {
    // Arrange
    // 接続していない状態のまま

    // Act
    render(<StatusBar {...ハンドラを作る()} />)

    // Assert
    expect(screen.queryByRole('button', { name: 'コミット' })).not.toBeInTheDocument()
  })

  it('コミットのボタンを押すと呼び出し側へ伝わる', async () => {
    // Arrange
    接続済みにする()
    const onCommit = vi.fn()
    render(<StatusBar {...ハンドラを作る()} onCommit={onCommit} />)

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'コミット' }))

    // Assert
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('ロールバックのボタンを押すと呼び出し側へ伝わる', async () => {
    // Arrange
    接続済みにする()
    const onRollback = vi.fn()
    render(<StatusBar {...ハンドラを作る()} onRollback={onRollback} />)

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'ロールバック' }))

    // Assert
    expect(onRollback).toHaveBeenCalledTimes(1)
  })

  it('接続メニューと未コミットの表示は同時に出る', async () => {
    // Arrange: #4 の接続メニューを壊していないことを見る
    接続済みにする()
    useExecutionStore.setState({ inTransaction: true })
    render(<StatusBar {...ハンドラを作る()} />)

    // Act
    await userEvent.click(screen.getByRole('button', { name: '接続中' }))

    // Assert
    expect(screen.getByRole('menuitem', { name: '切断' })).toBeInTheDocument()
    expect(screen.getByText('未コミット')).toBeInTheDocument()
  })

  it('色の付いた接続では接続中の手前に色の印が出る', () => {
    // Arrange
    接続済みにする(false, false, 'red')
    const handlers = ハンドラを作る()

    // Act
    render(<StatusBar {...handlers} />)

    // Assert
    const 印 = screen.getByTestId('connection-color-mark')
    expect(印.style.background).toBe('var(--cn-red)')
    expect(印).toHaveAttribute('data-connection-color', 'red')
  })

  it('色の付いていない接続では色の印を出さない', () => {
    // Arrange
    接続済みにする()
    const handlers = ハンドラを作る()

    // Act
    render(<StatusBar {...handlers} />)

    // Assert
    expect(screen.queryByTestId('connection-color-mark')).not.toBeInTheDocument()
  })

  it('読み取り専用は色ではなく文言で示され、色の印とは別に並ぶ', () => {
    // Arrange
    接続済みにする(true, false, 'red')
    const handlers = ハンドラを作る()

    // Act
    render(<StatusBar {...handlers} />)

    // Assert
    expect(screen.getByText('読み取り専用')).toBeInTheDocument()
    expect(screen.getByTestId('connection-color-mark')).toBeInTheDocument()
  })

  it('接続が切れているときは接続中ではなくその旨を出す', () => {
    // Arrange: 「接続中」のままでは何も分からない（ADR 0026）
    接続が切れた状態にする()
    const handlers = ハンドラを作る()

    // Act
    render(<StatusBar {...handlers} />)

    // Assert
    expect(screen.getByText('接続が切れました')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '接続中' })).not.toBeInTheDocument()
  })

  it('接続が切れているときは再接続を押せる', async () => {
    // Arrange
    接続が切れた状態にする()
    const handlers = ハンドラを作る()
    const onReconnect = vi.fn()
    render(<StatusBar {...handlers} onReconnect={onReconnect} />)

    // Act
    await userEvent.click(screen.getByRole('button', { name: '再接続' }))

    // Assert
    expect(onReconnect).toHaveBeenCalledTimes(1)
  })

  it('接続が切れているときも切断で接続を選ぶ画面へ戻れる', async () => {
    // Arrange: 繋ぎ直せない相手のときに袋小路へ入らないための 2 つめの道
    接続が切れた状態にする()
    const handlers = ハンドラを作る()
    render(<StatusBar {...handlers} onReconnect={vi.fn()} />)

    // Act
    await userEvent.click(screen.getByRole('button', { name: '切断' }))

    // Assert
    expect(handlers.onDisconnect).toHaveBeenCalledTimes(1)
  })

  it('接続が切れているときはコミットとロールバックを出さない', () => {
    // Arrange: 押しても届かず、未コミットの状態はもう残っていない（ADR 0026）
    接続が切れた状態にする()
    const handlers = ハンドラを作る()

    // Act
    render(<StatusBar {...handlers} onReconnect={vi.fn()} onCommit={vi.fn()} />)

    // Assert
    expect(screen.queryByRole('button', { name: 'コミット' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'ロールバック' })).not.toBeInTheDocument()
  })

  it('接続が切れているときは未コミットの表示を出さない', () => {
    // Arrange: 切れた時点でデータベース側はロールバック済みである
    接続が切れた状態にする()
    useExecutionStore.setState({ inTransaction: true })
    const handlers = ハンドラを作る()

    // Act
    render(<StatusBar {...handlers} onReconnect={vi.fn()} />)

    // Assert
    expect(screen.queryByText('未コミット')).not.toBeInTheDocument()
  })

  it('最後の往復が古くなったら最終応答の時刻を添える', async () => {
    // Arrange: 往復したときにしか断に気付けない以上、いつまで確かだったかを
    // 正直に見せる（ADR 0030）
    const { api } = createFakeDbApi({
      health: () => ({ disconnected: false, lastRoundTripMs: Date.now() - 12 * 60 * 1000 }),
    })
    setDbApi(api)
    接続済みにする()
    const handlers = ハンドラを作る()

    // Act
    render(<StatusBar {...handlers} />)

    // Assert
    expect(await screen.findByText('最終応答 12 分前')).toBeInTheDocument()
  })

  it('最後の往復が新しいうちは何も添えない', async () => {
    // Arrange: 言わないのが正しい場面で言うと、注記そのものが読まれなくなる
    const { api, calls } = createFakeDbApi({
      health: () => ({
        disconnected: false,
        lastRoundTripMs: Date.now() - (FRESH_WINDOW_MS - 1000),
      }),
    })
    setDbApi(api)
    接続済みにする()
    const handlers = ハンドラを作る()

    // Act
    render(<StatusBar {...handlers} />)
    await waitFor(() => expect(calls.connectionHealth.length).toBeGreaterThan(0))

    // Assert
    expect(screen.queryByTestId('connection-staleness')).not.toBeInTheDocument()
  })

  it('往復なしの覗きで切られていると分かったら断として配る', async () => {
    // Arrange: 問い合わせを走らせる前に気付ける唯一の道である（ADR 0030）
    const { api } = createFakeDbApi({
      health: () => ({ disconnected: true, lastRoundTripMs: Date.now() }),
    })
    setDbApi(api)
    接続済みにする()
    const 届いた: string[] = []
    const 外す = onConnectionLost((message) => 届いた.push(message))
    const handlers = ハンドラを作る()

    // Act
    render(<StatusBar {...handlers} />)

    // Assert
    await waitFor(() => expect(届いた).toEqual([PROBE_LOST_MESSAGE]))
    外す()
  })

  it('繋がっていないときは接続の様子を覗きに行かない', async () => {
    // Arrange: 覗く相手が無い
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    const handlers = ハンドラを作る()

    // Act
    render(<StatusBar {...handlers} />)
    await waitFor(() => expect(screen.getByText('未接続')).toBeInTheDocument())

    // Assert
    expect(calls.connectionHealth).toEqual([])
  })

  it('接続が切れた後は接続の様子を覗きに行かない', async () => {
    // Arrange: 印が立った後は往復も覗きも要らない（ADR 0026）
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    接続が切れた状態にする()
    const handlers = ハンドラを作る()

    // Act
    render(<StatusBar {...handlers} onReconnect={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('接続が切れました')).toBeInTheDocument())

    // Assert
    expect(calls.connectionHealth).toEqual([])
  })

  it('再接続の手続きを渡さないとボタンは出ない', () => {
    // Arrange
    接続が切れた状態にする()
    const handlers = ハンドラを作る()

    // Act
    render(<StatusBar {...handlers} />)

    // Assert
    expect(screen.queryByRole('button', { name: '再接続' })).not.toBeInTheDocument()
  })
})
