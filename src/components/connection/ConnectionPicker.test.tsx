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
  color: 'none',
  group: null,
  schemaFilter: { excludeSystem: true, hideEmpty: true },
  completion: { identifierCase: 'preserve' },
  target: { method: 'ezConnect', host: 'localhost', port: 1521, serviceName: 'FREEPDB1' },
}

const 本番: SavedConnection = {
  id: 'saved-2',
  name: '本番',
  username: 'app',
  readOnly: true,
  autoCommit: false,
  color: 'none',
  group: null,
  schemaFilter: { excludeSystem: false, hideEmpty: true },
  completion: { identifierCase: 'preserve' },
  target: { method: 'tns', directory: '/etc/oracle', alias: 'PROD' },
}

const 本番東京: SavedConnection = {
  ...本番,
  id: 'saved-3',
  name: '本番東京',
  color: 'red',
  group: '本番',
}

const 本番大阪: SavedConnection = {
  ...本番,
  id: 'saved-4',
  name: '本番大阪',
  color: 'orange',
  group: '本番',
}

const 検証: SavedConnection = {
  ...開発,
  id: 'saved-5',
  name: '検証',
  color: 'blue',
  group: '検証',
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

  it('グループを持つ接続は見出しの下にまとまって並ぶ', async () => {
    // Arrange
    描く({ savedConnections: [本番東京, 検証, 本番大阪] })

    // Act
    const 見出し = await screen.findByRole('heading', { name: '本番', level: 2 })

    // Assert
    const 本番の一覧 = 見出し.parentElement?.querySelector('ul')
    expect(本番の一覧?.textContent).toContain('本番東京')
    expect(本番の一覧?.textContent).toContain('本番大阪')
    expect(本番の一覧?.textContent).not.toContain('検証')
  })

  it('グループは保存されている並びで最初に現れた順に出る', async () => {
    // Arrange: 名前で並べ替えるなら「検証」が先に来る
    描く({ savedConnections: [本番東京, 検証] })
    await screen.findByText('本番東京')

    // Act
    const 見出し = screen.getAllByRole('heading', { level: 2 })

    // Assert
    expect(見出し.map((element) => element.textContent)).toEqual(['本番', '検証'])
  })

  it('グループ未指定の接続は見出しを持たず先頭に並ぶ', async () => {
    // Arrange
    描く({ savedConnections: [本番東京, 開発] })
    await screen.findByText('開発')

    // Act
    const 見出し = screen.getAllByRole('heading', { level: 2 })

    // Assert
    expect(見出し.map((element) => element.textContent)).toEqual(['本番'])
    const 一覧 = screen.getAllByRole('list')
    expect(一覧[0].textContent).toContain('開発')
  })

  it('接続の色は行の帯に当たる', async () => {
    // Arrange
    描く({ savedConnections: [本番東京] })
    await screen.findByText('本番東京')

    // Act
    const 帯 = screen.getByTestId('connection-color-band-saved-3')

    // Assert
    expect(帯.style.background).toBe('var(--cn-red)')
    expect(帯).toHaveAttribute('data-connection-color', 'red')
  })

  it('色なしの接続の帯は塗られない', async () => {
    // Arrange
    描く({ savedConnections: [開発] })
    await screen.findByText('開発')

    // Act
    const 帯 = screen.getByTestId('connection-color-band-saved-1')

    // Assert
    expect(帯.style.background).toBe('transparent')
  })

  it('読み取り専用の接続は色とは別に鍵で示される', async () => {
    // Arrange
    描く({ savedConnections: [開発, 本番東京] })
    await screen.findByText('本番東京')

    // Act
    const 鍵 = screen.getAllByLabelText('読み取り専用')

    // Assert: 読み取り専用は 本番東京 の 1 件だけである
    expect(鍵).toHaveLength(1)
  })

  it('繋ぐと色とグループが接続の状態へ引き継がれる', async () => {
    // Arrange
    描く({ savedConnections: [本番東京], passwords: { 'saved-3': 'secret' }, tnsnames })
    const 行 = await screen.findByText('本番東京')

    // Act
    await userEvent.click(行)

    // Assert
    await waitFor(() => expect(calls.connect).toHaveLength(1))
    expect(useConnectionStore.getState().connection?.color).toBe('red')
    expect(useConnectionStore.getState().connection?.group).toBe('本番')
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
