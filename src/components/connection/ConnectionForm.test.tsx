import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { resetDbApi, setDbApi } from '../../api/db'
import { createFakeDbApi, type FakeCalls, type FakeDbApiOptions } from '../../test/fakeDbApi'
import type { SavedConnection } from '../../types/db'
import { useConnectionStore } from '../../stores/connection'
import { ConnectionForm } from './ConnectionForm'

const 保存済み: SavedConnection = {
  id: 'saved-1',
  name: '開発',
  username: 'koduchi',
  readOnly: false,
  schemaFilter: { excludeSystem: true, hideEmpty: true },
  target: { method: 'ezConnect', host: 'localhost', port: 1521, serviceName: 'FREEPDB1' },
}

const tnsnames = {
  entries: [
    { aliases: ['PROD', 'PROD.WORLD'], descriptor: '(DESCRIPTION=(HOST=prod))' },
    { aliases: ['STAGE'], descriptor: '(DESCRIPTION=(HOST=stage))' },
  ],
  warnings: ['IFILE には対応していません: /etc/oracle/common.ora'],
}

let calls: FakeCalls

/** 窓口を差し替えてフォームを描く。 */
function 描く(options: FakeDbApiOptions = {}) {
  const fake = createFakeDbApi(options)
  calls = fake.calls
  setDbApi(fake.api)
  render(<ConnectionForm />)
}

beforeEach(() => {
  useConnectionStore.setState({ status: 'disconnected', connection: null, error: null })
})

afterEach(() => {
  resetDbApi()
})

describe('ConnectionForm', () => {
  it('既定では ezconnect の欄が並ぶ', () => {
    // Arrange
    描く()

    // Act
    const サービス名 = screen.getByLabelText('サービス名')

    // Assert
    expect(サービス名).toBeInTheDocument()
    expect(screen.getByLabelText('ホスト')).toBeInTheDocument()
  })

  it('tns を選ぶとホストとサービス名の欄がエイリアスに差し替わる', async () => {
    // Arrange
    描く()

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'TNS' }))

    // Assert
    expect(screen.queryByLabelText('ホスト')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('サービス名')).not.toBeInTheDocument()
    expect(screen.getByLabelText('エイリアス')).toBeInTheDocument()
  })

  it('tnsnames を読むとエイリアスがプルダウンに並ぶ', async () => {
    // Arrange
    描く({ tnsnames })
    await userEvent.click(screen.getByRole('button', { name: 'TNS' }))

    // Act
    await userEvent.type(screen.getByLabelText('tnsnames.ora の場所'), '/etc/oracle')
    await userEvent.tab()

    // Assert
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'PROD, PROD.WORLD' })).toBeInTheDocument()
    })
    expect(screen.getByRole('option', { name: 'STAGE' })).toBeInTheDocument()
  })

  it('読み込めなかったエントリがあればその旨を出す', async () => {
    // Arrange
    描く({ tnsnames })
    await userEvent.click(screen.getByRole('button', { name: 'TNS' }))

    // Act
    await userEvent.type(screen.getByLabelText('tnsnames.ora の場所'), '/etc/oracle')
    await userEvent.tab()

    // Assert
    await waitFor(() => {
      expect(screen.getByText('一部のエントリを読み込めませんでした')).toBeInTheDocument()
    })
    expect(
      screen.getByText('IFILE には対応していません: /etc/oracle/common.ora'),
    ).toBeInTheDocument()
  })

  it('保存済みの接続が一覧に並ぶ', async () => {
    // Arrange
    描く({ savedConnections: [保存済み] })

    // Act
    const 行 = await screen.findByText('開発')

    // Assert
    expect(行).toBeInTheDocument()
    expect(screen.getByText('localhost:1521/FREEPDB1')).toBeInTheDocument()
  })

  it('保存済みの接続を押すと欄が埋まる', async () => {
    // Arrange
    描く({ savedConnections: [保存済み] })
    const 行 = await screen.findByText('開発')

    // Act
    await userEvent.click(行)

    // Assert
    await waitFor(() => {
      expect(screen.getByLabelText('名前')).toHaveValue('開発')
    })
    expect(screen.getByLabelText('サービス名')).toHaveValue('FREEPDB1')
    expect(screen.getByLabelText('ユーザー')).toHaveValue('koduchi')
  })

  it('保存済みの接続を削除できる', async () => {
    // Arrange
    描く({ savedConnections: [保存済み] })
    await screen.findByText('開発')

    // Act
    await userEvent.click(screen.getByRole('button', { name: '開発 を削除' }))

    // Assert
    expect(calls.deleteConnection).toEqual(['saved-1'])
    await waitFor(() => {
      expect(screen.queryByText('localhost:1521/FREEPDB1')).not.toBeInTheDocument()
    })
  })

  it('接続すると入力した内容がそのまま渡る', async () => {
    // Arrange
    描く()
    await userEvent.type(screen.getByLabelText('名前'), '開発')
    await userEvent.type(screen.getByLabelText('サービス名'), 'FREEPDB1')
    await userEvent.type(screen.getByLabelText('ユーザー'), 'koduchi')
    await userEvent.type(screen.getByLabelText('パスワード'), 'koduchi_dev')

    // Act
    await userEvent.click(screen.getByRole('button', { name: '接続' }))

    // Assert
    await waitFor(() => expect(calls.connect).toHaveLength(1))
    expect(calls.connect[0].params).toEqual({
      username: 'koduchi',
      password: 'koduchi_dev',
      target: { method: 'ezConnect', host: 'localhost', port: 1521, serviceName: 'FREEPDB1' },
      readOnly: false,
    })
  })

  it('保存にチェックが入っていればパスワードごと保存する', async () => {
    // Arrange
    描く()
    await userEvent.type(screen.getByLabelText('名前'), '開発')
    await userEvent.type(screen.getByLabelText('サービス名'), 'FREEPDB1')
    await userEvent.type(screen.getByLabelText('ユーザー'), 'koduchi')
    await userEvent.type(screen.getByLabelText('パスワード'), 'koduchi_dev')

    // Act
    await userEvent.click(screen.getByRole('button', { name: '接続' }))

    // Assert
    await waitFor(() => expect(calls.saveConnection).toHaveLength(1))
    expect(calls.saveConnection[0].password).toBe('koduchi_dev')
    expect(calls.saveConnection[0].connection.name).toBe('開発')
  })

  it('保存のチェックを外すと保存しない', async () => {
    // Arrange
    描く()
    await userEvent.type(screen.getByLabelText('名前'), '開発')
    await userEvent.type(screen.getByLabelText('サービス名'), 'FREEPDB1')
    await userEvent.type(screen.getByLabelText('ユーザー'), 'koduchi')
    await userEvent.click(screen.getByLabelText('この接続を保存する（パスワードはキーチェーンへ）'))

    // Act
    await userEvent.click(screen.getByRole('button', { name: '接続' }))

    // Assert
    await waitFor(() => expect(calls.connect).toHaveLength(1))
    expect(calls.saveConnection).toHaveLength(0)
  })
})
