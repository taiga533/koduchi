import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { resetDbApi, setDbApi } from '../../api/db'
import { createFakeDbApi, type FakeCalls, type FakeDbApiOptions } from '../../test/fakeDbApi'
import type { SavedConnection } from '../../types/db'
import { useConnectionStore } from '../../stores/connection'
import { ConnectionForm, type ConnectionFormProps } from './ConnectionForm'

const 保存済み: SavedConnection = {
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

const tnsnames = {
  entries: [
    { aliases: ['PROD', 'PROD.WORLD'], descriptor: '(DESCRIPTION=(HOST=prod))' },
    { aliases: ['STAGE'], descriptor: '(DESCRIPTION=(HOST=stage))' },
  ],
  warnings: ['IFILE には対応していません: /etc/oracle/common.ora'],
}

let calls: FakeCalls

/** 窓口を差し替えてフォームを描く。 */
function 描く(options: FakeDbApiOptions = {}, props: Partial<ConnectionFormProps> = {}) {
  const fake = createFakeDbApi(options)
  calls = fake.calls
  setDbApi(fake.api)
  render(<ConnectionForm {...props} />)
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

  it('初期値を渡すと編集画面として欄が埋まる', async () => {
    // Arrange
    描く({ passwords: { 'saved-1': 'koduchi_dev' } }, { initial: 保存済み })

    // Act
    const 名前 = screen.getByLabelText('名前')

    // Assert
    expect(screen.getByText('接続を編集')).toBeInTheDocument()
    expect(名前).toHaveValue('開発')
    expect(screen.getByLabelText('サービス名')).toHaveValue('FREEPDB1')
    expect(screen.getByLabelText('ユーザー')).toHaveValue('koduchi')
    await waitFor(() => {
      expect(screen.getByLabelText('パスワード')).toHaveValue('koduchi_dev')
    })
  })

  it('戻るを渡さなければ戻るボタンは出ない', () => {
    // Arrange
    描く()

    // Act
    const 戻る = screen.queryByRole('button', { name: '戻る' })

    // Assert
    expect(戻る).not.toBeInTheDocument()
  })

  it('戻るを押すと選ぶ画面へ返す', async () => {
    // Arrange
    const onBack = vi.fn()
    描く({}, { onBack })

    // Act
    await userEvent.click(screen.getByRole('button', { name: '戻る' }))

    // Assert
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('テスト接続は入力した内容で試して繋がったことを伝える', async () => {
    // Arrange
    描く({ testVersion: '23.9.0.0.0' })
    await userEvent.type(screen.getByLabelText('サービス名'), 'FREEPDB1')
    await userEvent.type(screen.getByLabelText('ユーザー'), 'koduchi')
    await userEvent.type(screen.getByLabelText('パスワード'), 'koduchi_dev')

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'テスト接続' }))

    // Assert
    expect(calls.testConnection).toEqual([
      {
        username: 'koduchi',
        password: 'koduchi_dev',
        target: { method: 'ezConnect', host: 'localhost', port: 1521, serviceName: 'FREEPDB1' },
        readOnly: false,
        autoCommit: false,
      },
    ])
    expect(
      await screen.findByText('接続できました · Oracle Database 23.9.0.0.0'),
    ).toBeInTheDocument()
    expect(calls.connect).toHaveLength(0)
  })

  it('テスト接続に失敗すると理由を出す', async () => {
    // Arrange
    描く({ testError: { kind: 'connect', message: 'ORA-01017: invalid credential' } })
    await userEvent.type(screen.getByLabelText('サービス名'), 'FREEPDB1')
    await userEvent.type(screen.getByLabelText('ユーザー'), 'koduchi')

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'テスト接続' }))

    // Assert
    expect(await screen.findByText('ORA-01017: invalid credential')).toBeInTheDocument()
  })

  it('テストの後に入力を変えると結果は消える', async () => {
    // Arrange
    描く()
    await userEvent.type(screen.getByLabelText('サービス名'), 'FREEPDB1')
    await userEvent.type(screen.getByLabelText('ユーザー'), 'koduchi')
    await userEvent.click(screen.getByRole('button', { name: 'テスト接続' }))
    await screen.findByText('接続できました · Oracle Database 23.9.0.0.0')

    // Act
    await userEvent.type(screen.getByLabelText('ユーザー'), '2')

    // Assert
    expect(
      screen.queryByText('接続できました · Oracle Database 23.9.0.0.0'),
    ).not.toBeInTheDocument()
  })

  it('接続先とユーザーが埋まるまでテスト接続は押せない', async () => {
    // Arrange
    描く()

    // Act
    await userEvent.type(screen.getByLabelText('サービス名'), 'FREEPDB1')

    // Assert
    expect(screen.getByRole('button', { name: 'テスト接続' })).toBeDisabled()
  })

  it('接続すると入力した内容がそのまま渡る', async () => {
    // Arrange
    描く()
    await userEvent.type(screen.getByLabelText('名前'), '開発')
    await userEvent.type(screen.getByLabelText('サービス名'), 'FREEPDB1')
    await userEvent.type(screen.getByLabelText('ユーザー'), 'koduchi')
    await userEvent.type(screen.getByLabelText('パスワード'), 'koduchi_dev')

    // Act
    await userEvent.click(screen.getByRole('button', { name: '保存して接続' }))

    // Assert
    await waitFor(() => expect(calls.connect).toHaveLength(1))
    expect(calls.connect[0].params).toEqual({
      username: 'koduchi',
      password: 'koduchi_dev',
      target: { method: 'ezConnect', host: 'localhost', port: 1521, serviceName: 'FREEPDB1' },
      readOnly: false,
      autoCommit: false,
    })
  })

  it('補完の綴りは既定でカタログのままになっている', () => {
    // Arrange
    描く()

    // Act
    const 選択 = screen.getByRole('button', { name: 'カタログのまま' })

    // Assert
    expect(選択).toHaveAttribute('aria-pressed', 'true')
  })

  it('補完の綴りを選ぶと接続と保存の両方に載る', async () => {
    // Arrange
    描く()
    await userEvent.type(screen.getByLabelText('名前'), '開発')
    await userEvent.type(screen.getByLabelText('サービス名'), 'FREEPDB1')
    await userEvent.type(screen.getByLabelText('ユーザー'), 'koduchi')
    await userEvent.click(screen.getByRole('button', { name: '小文字' }))

    // Act
    await userEvent.click(screen.getByRole('button', { name: '保存して接続' }))

    // Assert
    await waitFor(() => expect(calls.saveConnection).toHaveLength(1))
    expect(calls.saveConnection[0].connection.completion).toEqual({ identifierCase: 'lower' })
    expect(useConnectionStore.getState().connection?.completion).toEqual({
      identifierCase: 'lower',
    })
  })

  it('編集で開くと保存済みの綴りが選ばれている', async () => {
    // Arrange
    const initial: SavedConnection = {
      ...保存済み,
      completion: { identifierCase: 'lower' },
    }

    // Act
    描く({}, { initial })

    // Assert
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '小文字' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    )
  })

  it('保存にチェックが入っていればパスワードごと保存する', async () => {
    // Arrange
    描く()
    await userEvent.type(screen.getByLabelText('名前'), '開発')
    await userEvent.type(screen.getByLabelText('サービス名'), 'FREEPDB1')
    await userEvent.type(screen.getByLabelText('ユーザー'), 'koduchi')
    await userEvent.type(screen.getByLabelText('パスワード'), 'koduchi_dev')

    // Act
    await userEvent.click(screen.getByRole('button', { name: '保存して接続' }))

    // Assert
    await waitFor(() => expect(calls.saveConnection).toHaveLength(1))
    expect(calls.saveConnection[0].password).toBe('koduchi_dev')
    expect(calls.saveConnection[0].connection.name).toBe('開発')
  })

  it('保存のチェックを外すとボタンの文言が接続だけになる', async () => {
    // Arrange
    描く()

    // Act
    await userEvent.click(screen.getByLabelText('この接続を保存する（パスワードはキーチェーンへ）'))

    // Assert
    expect(screen.getByRole('button', { name: '接続' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存して接続' })).not.toBeInTheDocument()
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

  it('自動コミットの既定は切ってある', () => {
    // Arrange: 誤爆したときに取り返せるほうを既定にしてある（ADR 0012）
    描く()

    // Act
    const 自動コミット = screen.getByLabelText('実行のたびに自動でコミットする')

    // Assert
    expect(自動コミット).not.toBeChecked()
  })

  it('読み取り専用を選ぶと自動コミットの項目が押せなくなる', async () => {
    // Arrange
    描く()

    // Act
    await userEvent.click(screen.getByLabelText('読み取り専用で接続する'))

    // Assert
    expect(screen.getByLabelText('実行のたびに自動でコミットする')).toBeDisabled()
  })

  it('自動コミットを入れて接続すると接続情報にその指定が乗る', async () => {
    // Arrange
    描く()
    await userEvent.type(screen.getByLabelText('名前'), '開発')
    await userEvent.type(screen.getByLabelText('サービス名'), 'FREEPDB1')
    await userEvent.type(screen.getByLabelText('ユーザー'), 'koduchi')

    // Act
    await userEvent.click(screen.getByLabelText('実行のたびに自動でコミットする'))
    await userEvent.click(screen.getByRole('button', { name: '保存して接続' }))

    // Assert
    await waitFor(() => expect(calls.connect).toHaveLength(1))
    expect(calls.connect[0].params.autoCommit).toBe(true)
  })

  it('自動コミットの指定は保存する接続にも乗る', async () => {
    // Arrange
    描く()
    await userEvent.type(screen.getByLabelText('名前'), '開発')
    await userEvent.type(screen.getByLabelText('サービス名'), 'FREEPDB1')
    await userEvent.type(screen.getByLabelText('ユーザー'), 'koduchi')

    // Act
    await userEvent.click(screen.getByLabelText('実行のたびに自動でコミットする'))
    await userEvent.click(screen.getByRole('button', { name: '保存して接続' }))

    // Assert
    await waitFor(() => expect(calls.saveConnection).toHaveLength(1))
    expect(calls.saveConnection[0].connection.autoCommit).toBe(true)
  })

  it('編集で開くと保存されていた自動コミットの指定が入っている', () => {
    // Arrange
    描く({}, { initial: { ...保存済み, autoCommit: true } })

    // Act
    const 自動コミット = screen.getByLabelText('実行のたびに自動でコミットする')

    // Assert
    expect(自動コミット).toBeChecked()
  })

  it('色は既定で選ばれていない', () => {
    // Arrange & Act
    描く()

    // Assert
    expect(screen.getByRole('button', { name: '色: なし' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('選んだ色は保存され接続の状態にも入る', async () => {
    // Arrange
    描く()
    await userEvent.type(screen.getByLabelText('名前'), '本番')
    await userEvent.type(screen.getByLabelText('サービス名'), 'FREEPDB1')
    await userEvent.type(screen.getByLabelText('ユーザー'), 'koduchi')

    // Act
    await userEvent.click(screen.getByRole('button', { name: '色: 赤' }))
    await userEvent.click(screen.getByRole('button', { name: '保存して接続' }))

    // Assert
    await waitFor(() => expect(calls.saveConnection).toHaveLength(1))
    expect(calls.saveConnection[0].connection.color).toBe('red')
    expect(useConnectionStore.getState().connection?.color).toBe('red')
  })

  it('入力したグループは前後の空白を落として保存される', async () => {
    // Arrange
    描く()
    await userEvent.type(screen.getByLabelText('名前'), '本番')
    await userEvent.type(screen.getByLabelText('グループ'), '  本番  ')
    await userEvent.type(screen.getByLabelText('サービス名'), 'FREEPDB1')
    await userEvent.type(screen.getByLabelText('ユーザー'), 'koduchi')

    // Act
    await userEvent.click(screen.getByRole('button', { name: '保存して接続' }))

    // Assert
    await waitFor(() => expect(calls.saveConnection).toHaveLength(1))
    expect(calls.saveConnection[0].connection.group).toBe('本番')
  })

  it('グループを空のままにすると未指定として保存される', async () => {
    // Arrange
    描く()
    await userEvent.type(screen.getByLabelText('名前'), '開発')
    await userEvent.type(screen.getByLabelText('サービス名'), 'FREEPDB1')
    await userEvent.type(screen.getByLabelText('ユーザー'), 'koduchi')

    // Act
    await userEvent.click(screen.getByRole('button', { name: '保存して接続' }))

    // Assert
    await waitFor(() => expect(calls.saveConnection).toHaveLength(1))
    expect(calls.saveConnection[0].connection.group).toBeNull()
  })

  it('既に使われているグループ名が入力候補に出る', async () => {
    // Arrange
    描く({ savedConnections: [{ ...保存済み, id: 'saved-9', group: '本番' }] })

    // Act
    await waitFor(() =>
      expect(document.querySelectorAll('#connection-groups option')).toHaveLength(1),
    )

    // Assert
    const 候補 = [...document.querySelectorAll('#connection-groups option')]
    expect(候補.map((option) => option.getAttribute('value'))).toEqual(['本番'])
  })

  it('編集で開くと保存済みの色とグループが入っている', async () => {
    // Arrange
    描く({}, { initial: { ...保存済み, color: 'purple', group: '検証' } })

    // Act
    const 色 = screen.getByRole('button', { name: '色: 紫' })

    // Assert
    expect(色).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(screen.getByLabelText('グループ')).toHaveValue('検証'))
  })
})
