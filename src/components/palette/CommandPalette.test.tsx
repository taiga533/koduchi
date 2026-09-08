import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { resetDbApi, setDbApi } from '../../api/db'
import { createFakeDbApi } from '../../test/fakeDbApi'
import { useSchemaStore } from '../../stores/schema'
import type { HistoryEntry, SavedQuery, SchemaNode } from '../../types/db'
import type { PaletteCommand } from './CommandPalette'
import { CommandPalette } from './CommandPalette'

const スキーマ一覧: SchemaNode[] = [
  {
    name: 'SCOTT',
    objectCount: 2,
    objects: [
      { name: 'ORDERS', kind: 'table' },
      { name: 'ORDER_ITEMS', kind: 'table' },
    ],
  },
]

const 保存済み一覧: SavedQuery[] = [
  {
    id: 1,
    name: '注文の一覧',
    sql: 'select * from orders',
    connectionName: '開発',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  },
]

const 履歴一覧: HistoryEntry[] = [
  {
    id: 1,
    sql: 'select count(*)\nfrom orders',
    connectionName: '開発',
    startedAt: 1_700_000_000_000,
    elapsedMs: 12,
    rowCount: 1,
    succeeded: true,
    errorMessage: null,
  },
  {
    id: 2,
    sql: 'select count(*)\nfrom orders',
    connectionName: '開発',
    startedAt: 1_700_000_001_000,
    elapsedMs: 9,
    rowCount: 1,
    succeeded: true,
    errorMessage: null,
  },
]

/** テストで使うコマンド。走らせたら記録する。 */
function コマンド(走った: string[]): PaletteCommand[] {
  return [
    { id: 'commit', label: 'コミット', shortcut: '⌥⌘C', run: () => 走った.push('commit') },
    { id: 'rollback', label: 'ロールバック', shortcut: '⌥⌘R', run: () => 走った.push('rollback') },
  ]
}

/** 既定の受け口を揃えてパレットを描く。 */
function パレットを描く(
  overrides: Partial<React.ComponentProps<typeof CommandPalette>> = {},
): void {
  render(
    <CommandPalette
      connectionName="開発"
      commands={[]}
      onUseSql={() => {}}
      onRevealSchemaObject={() => {}}
      onClose={() => {}}
      {...overrides}
    />,
  )
}

beforeEach(() => {
  const fake = createFakeDbApi({ savedQueries: 保存済み一覧, history: 履歴一覧 })
  setDbApi(fake.api)
  useSchemaStore.setState({ schemas: スキーマ一覧, status: 'ready', columnStatus: 'ready' })
})

afterEach(() => {
  resetDbApi()
  useSchemaStore.setState({ schemas: [], status: 'idle', columnStatus: 'idle' })
})

describe('CommandPalette', () => {
  it('種別の見出しを付けて 4 種を並べる', async () => {
    // Arrange
    パレットを描く({ commands: コマンド([]) })

    // Act
    await screen.findByRole('option', { name: /注文の一覧/ })

    // Assert
    expect(screen.getByRole('group', { name: 'コマンド' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'スキーマ' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '保存済みクエリ' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '履歴' })).toBeInTheDocument()
  })

  it('同じ sql の履歴は一度しか並ばない', async () => {
    // Arrange
    パレットを描く()

    // Act
    await screen.findByRole('option', { name: /注文の一覧/ })

    // Assert
    expect(screen.getAllByRole('option', { name: /select count/ })).toHaveLength(1)
  })

  it('打ち込んだ語で候補が絞られる', async () => {
    // Arrange
    パレットを描く({ commands: コマンド([]) })
    await screen.findByRole('option', { name: /注文の一覧/ })

    // Act
    await userEvent.type(screen.getByRole('textbox', { name: /検索/ }), 'order_items')

    // Assert
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option', { name: /ORDER_ITEMS/ })).toBeInTheDocument()
  })

  it('当てはまるものが無ければその旨を出す', async () => {
    // Arrange
    パレットを描く()
    await screen.findByRole('option', { name: /注文の一覧/ })

    // Act
    await userEvent.type(screen.getByRole('textbox', { name: /検索/ }), 'まったく無い語')

    // Assert
    expect(screen.getByText('当てはまるものがありません')).toBeInTheDocument()
  })

  it('最初の候補が選ばれている', async () => {
    // Arrange
    パレットを描く({ commands: コマンド([]) })

    // Act
    const 先頭 = await screen.findByRole('option', { name: /コミット/ })

    // Assert
    expect(先頭).toHaveAttribute('aria-selected', 'true')
  })

  it('下キーで次の候補へ移る', async () => {
    // Arrange
    パレットを描く({ commands: コマンド([]) })
    await screen.findByRole('option', { name: /コミット/ })

    // Act
    await userEvent.keyboard('{ArrowDown}')

    // Assert
    expect(screen.getByRole('option', { name: /ロールバック/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('先頭で上キーを押すと末尾へ回り込む', async () => {
    // Arrange
    パレットを描く({ commands: コマンド([]) })
    await screen.findByRole('option', { name: /select count/ })

    // Act
    await userEvent.keyboard('{ArrowUp}')

    // Assert
    expect(screen.getByRole('option', { name: /select count/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('決定するとコマンドが走りパレットが閉じる', async () => {
    // Arrange
    const 走った: string[] = []
    let 閉じた = false
    パレットを描く({ commands: コマンド(走った), onClose: () => (閉じた = true) })
    await screen.findByRole('option', { name: /コミット/ })

    // Act
    await userEvent.keyboard('{Enter}')

    // Assert
    expect(走った).toEqual(['commit'])
    expect(閉じた).toBe(true)
  })

  it('保存済みクエリを決めると sql がエディタへ渡る', async () => {
    // Arrange
    const 渡された: string[] = []
    パレットを描く({ onUseSql: (sql) => 渡された.push(sql) })
    await screen.findByRole('option', { name: /注文の一覧/ })

    // Act
    await userEvent.click(screen.getByRole('option', { name: /注文の一覧/ }))

    // Assert
    expect(渡された).toEqual(['select * from orders'])
  })

  it('スキーマのオブジェクトを決めるとサイドバーへ知らせる', async () => {
    // Arrange
    const 示された: [string, string | null][] = []
    パレットを描く({ onRevealSchemaObject: (schema, object) => 示された.push([schema, object]) })
    await screen.findByRole('option', { name: /ORDER_ITEMS/ })

    // Act
    await userEvent.click(screen.getByRole('option', { name: /ORDER_ITEMS/ }))

    // Assert
    expect(示された).toEqual([['SCOTT', 'ORDER_ITEMS']])
  })

  it('esc で閉じる', async () => {
    // Arrange
    let 閉じた = false
    パレットを描く({ onClose: () => (閉じた = true) })
    await screen.findByRole('option', { name: /注文の一覧/ })

    // Act
    await userEvent.keyboard('{Escape}')

    // Assert
    expect(閉じた).toBe(true)
  })

  it('履歴は現ウィンドウの接続に絞り保存済みクエリは全接続から探す', async () => {
    // Arrange
    const fake = createFakeDbApi({ savedQueries: 保存済み一覧, history: 履歴一覧 })
    setDbApi(fake.api)

    // Act
    パレットを描く()

    // Assert
    await waitFor(() => expect(fake.calls.listHistory).toHaveLength(1))
    expect(fake.calls.listHistory[0].connectionName).toBe('開発')
    expect(fake.calls.listSavedQueries[0].connectionName).toBeNull()
  })

  it('スキーマの読み込み中はその旨を添える', async () => {
    // Arrange
    useSchemaStore.setState({ schemas: [], status: 'loading' })

    // Act
    パレットを描く()

    // Assert
    expect(await screen.findByText(/スキーマを読み込んでいます/)).toBeInTheDocument()
  })
})
