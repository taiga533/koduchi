import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { resetDbApi, setDbApi } from '../../api/db'
import { createFakeDbApi } from '../../test/fakeDbApi'
import { useSchemaStore } from '../../stores/schema'
import { SchemaReloadButton } from './SchemaReloadButton'

beforeEach(() => {
  useSchemaStore.getState().clear()
})

afterEach(() => {
  resetDbApi()
})

describe('SchemaReloadButton', () => {
  it('押すとスキーマを取得し直す', async () => {
    // Arrange
    const 読み直した: string[] = []
    render(
      <SchemaReloadButton
        connectionId="c1"
        onReload={async (id) => {
          読み直した.push(id)
        }}
      />,
    )

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'スキーマを再読み込み' }))

    // Assert
    expect(読み直した).toEqual(['c1'])
  })

  it('未接続では押せない', () => {
    // Arrange
    render(<SchemaReloadButton connectionId={null} onReload={async () => {}} />)

    // Act
    const ボタン = screen.getByRole('button', { name: 'スキーマを再読み込み' })

    // Assert
    expect(ボタン).toBeDisabled()
  })

  it('読み込み中は押せない', async () => {
    // Arrange: 段階 1 が返る前に二度押しさせない
    const { api } = createFakeDbApi()
    setDbApi({ ...api, schemaOverview: () => new Promise(() => {}) })
    render(<SchemaReloadButton connectionId="c1" onReload={async () => {}} />)

    // Act
    void useSchemaStore.getState().reload('c1')

    // Assert
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'スキーマを再読み込み' })).toBeDisabled(),
    )
  })

  it('読み込みが終われば押せるようになる', async () => {
    // Arrange
    const { api } = createFakeDbApi()
    setDbApi(api)
    render(<SchemaReloadButton connectionId="c1" onReload={async () => {}} />)

    // Act
    await useSchemaStore.getState().reload('c1')

    // Assert
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'スキーマを再読み込み' })).toBeEnabled(),
    )
  })
})
