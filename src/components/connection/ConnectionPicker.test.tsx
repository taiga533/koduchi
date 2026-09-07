import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { resetDbApi, setDbApi } from '../../api/db'
import { createFakeDbApi, type FakeCalls, type FakeDbApiOptions } from '../../test/fakeDbApi'
import type { SavedConnection } from '../../types/db'
import { useConnectionStore } from '../../stores/connection'
import { ConnectionPicker } from './ConnectionPicker'

const 開発: SavedConnection = {
  id: 'saved-1',
  name: '開発',
  username: 'koduchi',
  readOnly: false,
  autoCommit: false,
  schemaFilter: { excludeSystem: true, hideEmpty: true },
  target: { method: 'ezConnect', host: 'localhost', port: 1521, serviceName: 'FREEPDB1' },
}

const 本番: SavedConnection = {
  id: 'saved-2',
  name: '本番',
  username: 'app',
  readOnly: true,
  autoCommit: false,
  schemaFilter: { excludeSystem: false, hideEmpty: true },
  target: { method: 'tns', directory: '/etc/oracle', alias: 'PROD' },
}

const tnsnames = {
  entries: [{ aliases: ['PROD', 'PROD.WORLD'], descriptor: '(DESCRIPTION=(HOST=prod))' }],
  warnings: [],
}

let calls: FakeCalls

const onCreate = vi.fn()
const onEdit = vi.fn()
const onConnected = vi.fn()

/** 窓口を差し替えて選択画面を描く。 */
function 描く(options: FakeDbApiOptions = {}) {
  const fake = createFakeDbApi(options)
  calls = fake.calls
  setDbApi(fake.api)
  render(<ConnectionPicker onCreate={onCreate} onEdit={onEdit} onConnected={onConnected} />)
}

beforeEach(() => {
  useConnectionStore.setState({ status: 'disconnected', connection: null, error: null })
  onCreate.mockClear()
  onEdit.mockClear()
  onConnected.mockClear()
})

afterEach(() => {
  resetDbApi()
})

describe('ConnectionPicker', () => {
  it('保存済みの接続が接続先つきで並ぶ', async () => {
    // Arrange
    描く({ savedConnections: [開発, 本番] })

    // Act
    const 行 = await screen.findByText('開発')

    // Assert
    expect(行).toBeInTheDocument()
    expect(screen.getByText('localhost:1521/FREEPDB1')).toBeInTheDocument()
    expect(screen.getByText('TNS PROD')).toBeInTheDocument()
  })

  it('保存された接続が無いときはその旨を出す', async () => {
    // Arrange
    描く()

    // Act
    const 案内 = await screen.findByText('保存された接続はまだありません')

    // Assert
    expect(案内).toBeInTheDocument()
  })

  it('接続を押すとキーチェーンのパスワードでそのまま繋ぐ', async () => {
    // Arrange
    描く({ savedConnections: [開発], passwords: { 'saved-1': 'koduchi_dev' } })
    const 行 = await screen.findByText('開発')

    // Act
    await userEvent.click(行)

    // Assert
    await waitFor(() => expect(calls.connect).toHaveLength(1))
    expect(calls.connect[0].params).toEqual({
      username: 'koduchi',
      password: 'koduchi_dev',
      target: { method: 'ezConnect', host: 'localhost', port: 1521, serviceName: 'FREEPDB1' },
      readOnly: false,
      autoCommit: false,
    })
    expect(onConnected).toHaveBeenCalledWith(expect.any(String), 開発.schemaFilter)
  })

  it('パスワードが保存されていなければ入力欄を出してから繋ぐ', async () => {
    // Arrange
    描く({ savedConnections: [開発] })
    await userEvent.click(await screen.findByText('開発'))
    const 入力欄 = await screen.findByLabelText('パスワード')
    expect(calls.connect).toHaveLength(0)

    // Act
    await userEvent.type(入力欄, 'koduchi_dev')
    await userEvent.click(screen.getByRole('button', { name: '接続' }))

    // Assert
    await waitFor(() => expect(calls.connect).toHaveLength(1))
    expect(calls.connect[0].params.password).toBe('koduchi_dev')
  })

  it('tns の接続はエイリアスを接続記述子へ解決してから繋ぐ', async () => {
    // Arrange
    描く({ savedConnections: [本番], passwords: { 'saved-2': 'secret' }, tnsnames })
    const 行 = await screen.findByText('本番')

    // Act
    await userEvent.click(行)

    // Assert
    await waitFor(() => expect(calls.connect).toHaveLength(1))
    expect(calls.connect[0].params.target).toEqual({
      method: 'descriptor',
      descriptor: '(DESCRIPTION=(HOST=prod))',
    })
    expect(calls.connect[0].params.readOnly).toBe(true)
  })

  it('tnsnames にエイリアスが無ければ繋がずに理由を出す', async () => {
    // Arrange
    描く({
      savedConnections: [本番],
      passwords: { 'saved-2': 'secret' },
      tnsnames: { entries: [], warnings: [] },
    })
    const 行 = await screen.findByText('本番')

    // Act
    await userEvent.click(行)

    // Assert
    expect(await screen.findByText('tnsnames.ora に PROD が見つかりません')).toBeInTheDocument()
    expect(calls.connect).toHaveLength(0)
  })

  it('削除は確認してから消す', async () => {
    // Arrange
    描く({ savedConnections: [開発] })
    await screen.findByText('開発')

    // Act
    await userEvent.click(screen.getByRole('button', { name: '開発 を削除' }))

    // Assert
    expect(calls.deleteConnection).toHaveLength(0)
    await userEvent.click(screen.getByRole('button', { name: '削除' }))
    expect(calls.deleteConnection).toEqual(['saved-1'])
    await waitFor(() => {
      expect(screen.queryByText('localhost:1521/FREEPDB1')).not.toBeInTheDocument()
    })
  })

  it('削除の確認はやめると取り消せる', async () => {
    // Arrange
    描く({ savedConnections: [開発] })
    await screen.findByText('開発')
    await userEvent.click(screen.getByRole('button', { name: '開発 を削除' }))

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'やめる' }))

    // Assert
    expect(calls.deleteConnection).toHaveLength(0)
    expect(screen.getByText('localhost:1521/FREEPDB1')).toBeInTheDocument()
  })

  it('編集を押すとその接続が渡る', async () => {
    // Arrange
    描く({ savedConnections: [開発] })
    await screen.findByText('開発')

    // Act
    await userEvent.click(screen.getByRole('button', { name: '開発 を編集' }))

    // Assert
    expect(onEdit).toHaveBeenCalledWith(開発)
  })

  it('新しい接続を押すと作成画面へ進む', async () => {
    // Arrange
    描く({ savedConnections: [開発] })
    await screen.findByText('開発')

    // Act
    await userEvent.click(screen.getByRole('button', { name: '新しい接続' }))

    // Assert
    expect(onCreate).toHaveBeenCalledTimes(1)
  })
})
