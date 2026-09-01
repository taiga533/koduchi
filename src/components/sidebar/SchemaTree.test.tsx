import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SchemaNode, TableColumn } from '../../types/db'
import { useSchemaStore } from '../../stores/schema'
import { SchemaTree } from './SchemaTree'

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
