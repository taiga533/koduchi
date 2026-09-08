import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { resetDbApi, setDbApi } from '../../api/db'
import { createFakeDbApi, type FakeCalls } from '../../test/fakeDbApi'
import type { SavedQuery } from '../../types/db'
import { useSavedQueryStore } from '../../stores/savedQuery'
import { SavedQueryList } from './SavedQueryList'

const 保存済み一覧: SavedQuery[] = [
  {
    id: 1,
    name: '利用者の一覧',
    sql: 'select * from users\nwhere id = 1',
    connectionName: '開発',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  },
  {
    id: 2,
    name: '注文の一覧',
    sql: 'select * from orders',
    connectionName: '本番',
    createdAt: 1_700_000_001_000,
    updatedAt: 1_700_000_001_000,
  },
]

let calls: FakeCalls

beforeEach(() => {
  const fake = createFakeDbApi({ savedQueries: 保存済み一覧 })
  calls = fake.calls
  setDbApi(fake.api)
  useSavedQueryStore.setState({
    entries: 保存済み一覧,
    scope: 'all',
    search: '',
    connectionName: null,
    loading: false,
    error: null,
  })
})

afterEach(() => {
  resetDbApi()
})

describe('SavedQueryList', () => {
  it('名前と sql の 1 行目と接続名が並ぶ', () => {
    // Arrange
    render(<SavedQueryList onUse={() => {}} />)

    // Act
    const 名前 = screen.getByText('利用者の一覧')

    // Assert
    expect(名前).toBeInTheDocument()
    expect(screen.getByText('select * from users')).toBeInTheDocument()
    expect(screen.getByText('本番')).toBeInTheDocument()
  })

  it('クエリを押すと sql を渡す', async () => {
    // Arrange
    const 渡された: string[] = []
    render(<SavedQueryList onUse={(sql) => 渡された.push(sql)} />)

    // Act
    await userEvent.click(screen.getByText('利用者の一覧'))

    // Assert
    expect(渡された).toEqual(['select * from users\nwhere id = 1'])
  })

  it('鉛筆を押すと名前を書き換えられる', async () => {
    // Arrange
    render(<SavedQueryList onUse={() => {}} />)
    await userEvent.click(screen.getAllByRole('button', { name: 'このクエリの名前を変える' })[0])

    // Act
    const 入力 = screen.getByRole('textbox', { name: 'クエリの名前' })
    await userEvent.clear(入力)
    await userEvent.type(入力, '利用者{Enter}')

    // Assert
    expect(calls.updateSavedQuery).toHaveLength(1)
    expect(calls.updateSavedQuery[0].name).toBe('利用者')
  })

  it('名前の変更を esc で取り消すと元の名前に戻る', async () => {
    // Arrange
    render(<SavedQueryList onUse={() => {}} />)
    await userEvent.click(screen.getAllByRole('button', { name: 'このクエリの名前を変える' })[0])

    // Act
    const 入力 = screen.getByRole('textbox', { name: 'クエリの名前' })
    await userEvent.clear(入力)
    await userEvent.type(入力, '書きかけ{Escape}')

    // Assert
    expect(calls.updateSavedQuery).toHaveLength(0)
    expect(screen.getByText('利用者の一覧')).toBeInTheDocument()
  })

  it('空の名前は受け付けない', async () => {
    // Arrange
    render(<SavedQueryList onUse={() => {}} />)
    await userEvent.click(screen.getAllByRole('button', { name: 'このクエリの名前を変える' })[0])

    // Act
    const 入力 = screen.getByRole('textbox', { name: 'クエリの名前' })
    await userEvent.clear(入力)
    await userEvent.type(入力, '  {Enter}')

    // Assert
    expect(calls.updateSavedQuery).toHaveLength(0)
    expect(screen.getByText('利用者の一覧')).toBeInTheDocument()
  })

  it('一件ごとに削除できる', async () => {
    // Arrange
    render(<SavedQueryList onUse={() => {}} />)

    // Act
    await userEvent.click(screen.getAllByRole('button', { name: 'このクエリを削除' })[0])

    // Assert
    expect(calls.deleteSavedQuery).toEqual([1])
  })

  it('スコープをこの接続のみへ切り替えられる', async () => {
    // Arrange
    render(<SavedQueryList onUse={() => {}} />)

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'この接続のみ' }))

    // Assert
    expect(useSavedQueryStore.getState().scope).toBe('connection')
  })

  it('保存済みが無ければ空状態を出す', () => {
    // Arrange
    useSavedQueryStore.setState({ entries: [], loading: false })

    // Act
    render(<SavedQueryList onUse={() => {}} />)

    // Assert
    expect(screen.getByText('保存したクエリがここに並びます')).toBeInTheDocument()
  })
})

/** 鉛筆を押して名前の入力欄を出す。 */
async function 名前を編集する() {
  render(<SavedQueryList onUse={() => {}} />)
  await userEvent.click(screen.getAllByRole('button', { name: 'このクエリの名前を変える' })[0])
  return screen.getByRole('textbox', { name: 'クエリの名前' })
}

describe('SavedQueryList の IME 対応（ADR 0025）', () => {
  it('変換中の ⏎ では名前を確定しない', async () => {
    // Arrange
    const 入力 = await 名前を編集する()
    await userEvent.clear(入力)
    await userEvent.type(入力, '利用者')

    // Act
    fireEvent.keyDown(入力, { key: 'Enter', isComposing: true })

    // Assert
    expect(calls.updateSavedQuery).toHaveLength(0)
    expect(screen.getByRole('textbox', { name: 'クエリの名前' })).toBeInTheDocument()
  })

  it('変換していないときの ⏎ は今までどおり名前を確定する', async () => {
    // Arrange
    const 入力 = await 名前を編集する()
    await userEvent.clear(入力)
    await userEvent.type(入力, '利用者')

    // Act
    fireEvent.keyDown(入力, { key: 'Enter' })

    // Assert
    expect(calls.updateSavedQuery).toHaveLength(1)
    expect(calls.updateSavedQuery[0].name).toBe('利用者')
  })

  it('変換中の esc では編集をやめない', async () => {
    // Arrange
    const 入力 = await 名前を編集する()
    await userEvent.clear(入力)
    await userEvent.type(入力, '書きかけ')

    // Act
    fireEvent.keyDown(入力, { key: 'Escape', isComposing: true })

    // Assert
    expect(screen.getByRole('textbox', { name: 'クエリの名前' })).toHaveValue('書きかけ')
  })

  it('変換していないときの esc は今までどおり編集をやめる', async () => {
    // Arrange
    const 入力 = await 名前を編集する()
    await userEvent.clear(入力)
    await userEvent.type(入力, '書きかけ')

    // Act
    fireEvent.keyDown(入力, { key: 'Escape' })

    // Assert
    expect(screen.queryByRole('textbox', { name: 'クエリの名前' })).not.toBeInTheDocument()
    expect(screen.getByText('利用者の一覧')).toBeInTheDocument()
  })
})
