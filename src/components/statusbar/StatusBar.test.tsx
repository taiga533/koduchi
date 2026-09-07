/**
 * ステータスバーの接続メニューのテスト。
 *
 * 接続の状態はストアへ直に置いて用意する。`src/api/` 層を差し替えるまでもなく、
 * ここで見たいのは「押せるか」「何が出るか」「何を呼ぶか」だけである。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StatusBar } from './StatusBar'
import { useConnectionStore } from '../../stores/connection'
import type { ConnectionParams } from '../../types/db'

/** 接続中に見せるための接続情報。 */
const 接続の設定: ConnectionParams = {
  username: 'koduchi',
  password: '',
  target: { method: 'ezConnect', host: 'localhost', port: 1521, serviceName: 'FREEPDB1' },
  readOnly: false,
}

/** 接続済みの状態にする。 */
function 接続済みにする(): void {
  useConnectionStore.setState({
    status: 'connected',
    connection: { id: 'c1', savedId: null, name: 'dev', params: 接続の設定 },
    error: null,
  })
}

beforeEach(() => {
  useConnectionStore.setState({ status: 'disconnected', connection: null, error: null })
})

describe('StatusBar', () => {
  it('未接続のときは接続状態を押せない', () => {
    // Arrange
    const handlers = { onOpenSettings: vi.fn(), onDisconnect: vi.fn(), onSwitchConnection: vi.fn() }

    // Act
    render(<StatusBar {...handlers} />)

    // Assert
    expect(screen.getByText('未接続')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '接続中' })).not.toBeInTheDocument()
  })

  it('接続中の表示を押すと切断と切り替えのメニューが出る', async () => {
    // Arrange
    接続済みにする()
    const handlers = { onOpenSettings: vi.fn(), onDisconnect: vi.fn(), onSwitchConnection: vi.fn() }
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
    const handlers = { onOpenSettings: vi.fn(), onDisconnect: vi.fn(), onSwitchConnection: vi.fn() }
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
    const handlers = { onOpenSettings: vi.fn(), onDisconnect: vi.fn(), onSwitchConnection: vi.fn() }
    render(<StatusBar {...handlers} />)
    await userEvent.click(screen.getByRole('button', { name: '接続中' }))

    // Act
    await userEvent.click(screen.getByRole('menuitem', { name: '別の接続へ切り替え…' }))

    // Assert
    expect(handlers.onSwitchConnection).toHaveBeenCalledTimes(1)
  })
})
