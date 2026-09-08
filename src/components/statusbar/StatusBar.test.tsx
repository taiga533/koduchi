/**
 * ステータスバーのテスト。
 *
 * 接続メニュー（切断・切り替え）と、未コミットの表示およびコミット /
 * ロールバックのボタン（ADR 0012）の両方を見る。
 *
 * 接続の状態はストアへ直に置いて用意する。`src/api/` 層を差し替えるまでもなく、
 * ここで見たいのは「押せるか」「何が出るか」「何を呼ぶか」だけである。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StatusBar } from './StatusBar'
import { useConnectionStore } from '../../stores/connection'
import { useExecutionStore } from '../../stores/execution'
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

/** 必ず要るハンドラをまとめて用意する。 */
function ハンドラを作る() {
  return { onOpenSettings: vi.fn(), onDisconnect: vi.fn(), onSwitchConnection: vi.fn() }
}

beforeEach(() => {
  useConnectionStore.setState({ status: 'disconnected', connection: null, error: null })
  useExecutionStore.getState().clear()
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
})
