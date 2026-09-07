/**
 * ステータスバーのテスト。
 *
 * 未コミットの表示とコミット / ロールバックのボタンが、手動コミットの接続の
 * ときだけ出ることを確かめる（ADR 0012）。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useConnectionStore } from '../../stores/connection'
import { useExecutionStore } from '../../stores/execution'
import type { ConnectionParams } from '../../types/db'
import { StatusBar } from './StatusBar'

/** 接続情報を組み立てる。 */
function 接続情報(readOnly: boolean, autoCommit: boolean): ConnectionParams {
  return {
    username: 'koduchi',
    password: '',
    target: { method: 'ezConnect', host: 'localhost', port: 1521, serviceName: 'FREEPDB1' },
    readOnly,
    autoCommit,
  }
}

/** 接続中の状態を作る。 */
function 繋いだことにする(readOnly = false, autoCommit = false) {
  useConnectionStore.setState({
    status: 'connected',
    connection: { id: 'c1', savedId: null, name: '開発', params: 接続情報(readOnly, autoCommit) },
    error: null,
  })
}

beforeEach(() => {
  useConnectionStore.setState({ status: 'disconnected', connection: null, error: null })
  useExecutionStore.getState().clear()
})

describe('StatusBar', () => {
  it('手動コミットの接続で未コミットのときは未コミットと出る', () => {
    // Arrange
    繋いだことにする()
    useExecutionStore.setState({ inTransaction: true })

    // Act
    render(<StatusBar onOpenSettings={() => {}} />)

    // Assert
    expect(screen.getByText('未コミット')).toBeInTheDocument()
  })

  it('未コミットでなければ未コミットとは出ない', () => {
    // Arrange
    繋いだことにする()

    // Act
    render(<StatusBar onOpenSettings={() => {}} />)

    // Assert
    expect(screen.queryByText('未コミット')).not.toBeInTheDocument()
  })

  it('読み取り専用の接続では未コミットもボタンも出ない', () => {
    // Arrange
    繋いだことにする(true, false)
    useExecutionStore.setState({ inTransaction: true })

    // Act
    render(<StatusBar onOpenSettings={() => {}} />)

    // Assert
    expect(screen.queryByText('未コミット')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'コミット' })).not.toBeInTheDocument()
  })

  it('自動コミットの接続では未コミットもボタンも出ない', () => {
    // Arrange
    繋いだことにする(false, true)
    useExecutionStore.setState({ inTransaction: true })

    // Act
    render(<StatusBar onOpenSettings={() => {}} />)

    // Assert
    expect(screen.queryByText('未コミット')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'ロールバック' })).not.toBeInTheDocument()
  })

  it('手動コミットの接続にはコミットとロールバックのボタンが並ぶ', () => {
    // Arrange
    繋いだことにする()

    // Act
    render(<StatusBar onOpenSettings={() => {}} />)

    // Assert
    expect(screen.getByRole('button', { name: 'コミット' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ロールバック' })).toBeInTheDocument()
  })

  it('未接続のときはコミットのボタンを出さない', () => {
    // Arrange
    // 接続していない状態のまま

    // Act
    render(<StatusBar onOpenSettings={() => {}} />)

    // Assert
    expect(screen.queryByRole('button', { name: 'コミット' })).not.toBeInTheDocument()
  })

  it('コミットのボタンを押すと呼び出し側へ伝わる', async () => {
    // Arrange
    繋いだことにする()
    const onCommit = vi.fn()
    render(<StatusBar onOpenSettings={() => {}} onCommit={onCommit} />)

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'コミット' }))

    // Assert
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('ロールバックのボタンを押すと呼び出し側へ伝わる', async () => {
    // Arrange
    繋いだことにする()
    const onRollback = vi.fn()
    render(<StatusBar onOpenSettings={() => {}} onRollback={onRollback} />)

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'ロールバック' }))

    // Assert
    expect(onRollback).toHaveBeenCalledTimes(1)
  })
})
