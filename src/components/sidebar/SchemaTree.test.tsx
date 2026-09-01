import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SchemaNode, TableColumn } from '../../types/db'
import { useSchemaStore } from '../../stores/schema'
import { flattenSchemas, SchemaTree } from './SchemaTree'

/**
 * jsdom は要素の寸法を持たない。仮想スクロールは `offsetHeight` で表示領域を
 * 測るため、そのままだと領域が 0 と見なされて行が 1 つも描かれない。
 *
 * 補うのは寸法だけで、アプリの振る舞いは差し替えていない。
 */
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    value: 600,
  })
})

const スキーマ一覧: SchemaNode[] = [
  {
    name: 'KODUCHI',
    objectCount: 2,
    objects: [
      { name: 'USERS', kind: 'table' },
      { name: 'ORDER_TOTAL', kind: 'function' },
    ],
  },
]

const 列一覧: Record<string, TableColumn[]> = {
  KODUCHI: [
    {
      objectName: 'USERS',
      name: 'USER_ID',
      typeName: 'NUMBER(12)',
      nullable: false,
      kind: 'number',
    },
    {
      objectName: 'USERS',
      name: 'EMAIL',
      typeName: 'VARCHAR2(255)',
      nullable: false,
      kind: 'text',
    },
  ],
}

beforeEach(() => {
  useSchemaStore.getState().clear()
  useSchemaStore.setState({
    schemas: スキーマ一覧,
    columns: 列一覧,
    status: 'ready',
    columnStatus: 'ready',
  })
})

describe('SchemaTree', () => {
  it('スキーマ名とオブジェクト数が並ぶ', () => {
    // Arrange
    render(<SchemaTree />)

    // Act
    const row = screen.getByRole('button', { name: /KODUCHI/ })

    // Assert
    expect(row).toHaveTextContent('KODUCHI')
    expect(row).toHaveTextContent('2')
  })

  it('スキーマを展開するとオブジェクトが並ぶ', async () => {
    // Arrange
    render(<SchemaTree />)

    // Act
    await userEvent.click(screen.getByRole('button', { name: /KODUCHI/ }))

    // Assert
    expect(screen.getByRole('button', { name: /USERS/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ORDER_TOTAL/ })).toBeInTheDocument()
  })

  it('テーブルを展開すると列名と型が並ぶ', async () => {
    // Arrange
    render(<SchemaTree />)
    await userEvent.click(screen.getByRole('button', { name: /KODUCHI/ }))

    // Act
    await userEvent.click(screen.getByRole('button', { name: /USERS/ }))

    // Assert
    expect(screen.getByText('USER_ID')).toBeInTheDocument()
    expect(screen.getByText('VARCHAR2(255)')).toBeInTheDocument()
  })

  it('関数は展開できない', async () => {
    // Arrange
    render(<SchemaTree />)
    await userEvent.click(screen.getByRole('button', { name: /KODUCHI/ }))

    // Act
    const 関数 = screen.getByRole('button', { name: /ORDER_TOTAL/ })

    // Assert
    expect(関数).not.toHaveAttribute('aria-expanded')
  })

  it('絞り込み語に当たったオブジェクトだけが残る', async () => {
    // Arrange
    useSchemaStore.setState({ search: 'order' })
    render(<SchemaTree />)

    // Act
    await userEvent.click(screen.getByRole('button', { name: /KODUCHI/ }))

    // Assert
    expect(screen.getByRole('button', { name: /ORDER_TOTAL/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /USERS/ })).not.toBeInTheDocument()
  })

  it('取得に失敗するとその旨を出す', () => {
    // Arrange
    useSchemaStore.setState({ status: 'failed', error: 'ORA-00942', schemas: [] })

    // Act
    render(<SchemaTree />)

    // Assert
    expect(screen.getByText('ORA-00942')).toBeInTheDocument()
  })
})

describe('flattenSchemas', () => {
  it('畳んだスキーマは自身の 1 行だけになる', () => {
    // Arrange
    const expanded = {}

    // Act
    const rows = flattenSchemas(スキーマ一覧, 列一覧, expanded)

    // Assert
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'schema', name: 'KODUCHI', open: false })
  })

  it('展開したスキーマの下にオブジェクトが並ぶ', () => {
    // Arrange
    const expanded = { KODUCHI: true }

    // Act
    const rows = flattenSchemas(スキーマ一覧, 列一覧, expanded)

    // Assert
    expect(rows.map((row) => row.kind)).toEqual(['schema', 'object', 'object'])
    expect(rows[2]).toMatchObject({ name: 'ORDER_TOTAL', expandable: false })
  })

  it('展開したテーブルの下に自分の列だけが並ぶ', () => {
    // Arrange
    const expanded = { KODUCHI: true, 'KODUCHI.USERS': true }

    // Act
    const rows = flattenSchemas(スキーマ一覧, 列一覧, expanded)

    // Assert
    expect(rows.filter((row) => row.kind === 'column').map((row) => row.name)).toEqual([
      'USER_ID',
      'EMAIL',
    ])
  })

  it('列が未取得のテーブルには読み込み中の行が入る', () => {
    // Arrange
    const expanded = { KODUCHI: true, 'KODUCHI.USERS': true }

    // Act
    const rows = flattenSchemas(スキーマ一覧, {}, expanded)

    // Assert
    expect(rows.map((row) => row.kind)).toEqual(['schema', 'object', 'columnsLoading', 'object'])
  })

  it('展開できない種類は開いた印を付けても展開されない', () => {
    // Arrange
    const expanded = { KODUCHI: true, 'KODUCHI.ORDER_TOTAL': true }

    // Act
    const rows = flattenSchemas(スキーマ一覧, 列一覧, expanded)

    // Assert
    expect(rows.map((row) => row.kind)).toEqual(['schema', 'object', 'object'])
  })
})

describe('テーブル定義ビュー', () => {
  it('テーブルには定義の入口があるが操作できない', async () => {
    // Arrange
    render(<SchemaTree />)
    await userEvent.click(screen.getByRole('button', { name: /KODUCHI/ }))

    // Act
    const 入口 = screen.getByTitle('テーブル定義ビューは未実装です')

    // Assert
    expect(入口).toHaveAttribute('aria-disabled', 'true')
  })
})
