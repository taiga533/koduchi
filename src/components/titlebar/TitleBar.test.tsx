/**
 * タイトルバーのテスト。
 *
 * 見ているのは接続の色とグループの出方（ADR 0015）である。ウィンドウ上端の帯は
 * 「今どこへ繋がっているか」を届ける主役であるため、色を付けた接続で必ず出ること、
 * 付けていない接続では出ないことの両方を見張る。
 *
 * 接続の状態はストアへ直に置いて用意する。`src/api/` 層を差し替えるまでもない。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TitleBar } from './TitleBar'
import { useConnectionStore } from '../../stores/connection'
import type { ConnectionColor } from '../../types/db'

/**
 * 接続済みの状態にする。
 *
 * @param color 接続に付いている色
 * @param group 接続が属するグループ名
 */
function 接続済みにする(color: ConnectionColor = 'none', group: string | null = null): void {
  useConnectionStore.setState({
    status: 'connected',
    connection: {
      id: 'c1',
      savedId: null,
      name: '本番東京',
      params: {
        username: 'koduchi',
        password: '',
        target: { method: 'ezConnect', host: 'localhost', port: 1521, serviceName: 'FREEPDB1' },
        readOnly: false,
        autoCommit: false,
      },
      completion: { identifierCase: 'preserve' },
      color,
      group,
    },
    error: null,
  })
}

beforeEach(() => {
  useConnectionStore.setState({ status: 'disconnected', connection: null, error: null })
})

describe('TitleBar', () => {
  it('未接続のときは色の帯を出さない', () => {
    // Arrange & Act
    render(<TitleBar />)

    // Assert
    expect(screen.queryByTestId('connection-color-bar')).not.toBeInTheDocument()
  })

  it('色の付いていない接続では色の帯を出さない', () => {
    // Arrange
    接続済みにする('none')

    // Act
    render(<TitleBar />)

    // Assert
    expect(screen.queryByTestId('connection-color-bar')).not.toBeInTheDocument()
  })

  it('色の付いた接続ではウィンドウ上端に色の帯が出る', () => {
    // Arrange
    接続済みにする('red')

    // Act
    render(<TitleBar />)

    // Assert
    const 帯 = screen.getByTestId('connection-color-bar')
    expect(帯.style.background).toBe('var(--cn-red)')
    expect(帯).toHaveAttribute('data-connection-color', 'red')
  })

  it('接続名の横の印も接続の色になる', () => {
    // Arrange
    接続済みにする('blue')

    // Act
    render(<TitleBar />)

    // Assert
    expect(screen.getByTestId('connection-color-chip').style.background).toBe('var(--cn-blue)')
  })

  it('色の付いていない接続の印はアクセント色のままである', () => {
    // Arrange
    接続済みにする('none')

    // Act
    render(<TitleBar />)

    // Assert: 色を指定していない = クラスの bg-ac がそのまま効く
    expect(screen.getByTestId('connection-color-chip').style.background).toBe('')
  })

  it('グループを持つ接続では接続名の手前にグループ名が出る', () => {
    // Arrange
    接続済みにする('red', '本番')

    // Act
    render(<TitleBar />)

    // Assert
    expect(screen.getByText('本番 /')).toBeInTheDocument()
    expect(screen.getByText('本番東京')).toBeInTheDocument()
  })

  it('グループを持たない接続ではグループ名を出さない', () => {
    // Arrange
    接続済みにする('red', null)

    // Act
    render(<TitleBar />)

    // Assert
    expect(screen.queryByText('本番 /')).not.toBeInTheDocument()
  })
})
