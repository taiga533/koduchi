import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { resetDbApi, setDbApi } from '../../api/db'
import { createFakeDbApi, type FakeCalls } from '../../test/fakeDbApi'
import type { SavedConnection } from '../../types/db'
import { useSchemaStore } from '../../stores/schema'
import { SchemaFilterMenu } from './SchemaFilterMenu'

const 保存済み: SavedConnection = {
  id: 'saved-1',
  name: '開発',
  username: 'koduchi',
  readOnly: false,
  autoCommit: false,
  schemaFilter: { excludeSystem: true, hideEmpty: true },
  target: { method: 'ezConnect', host: 'localhost', port: 1521, serviceName: 'FREEPDB1' },
}

let calls: FakeCalls

beforeEach(() => {
  const fake = createFakeDbApi({ savedConnections: [保存済み] })
  calls = fake.calls
  setDbApi(fake.api)
  useSchemaStore.getState().clear()
})

afterEach(() => {
  resetDbApi()
})

describe('SchemaFilterMenu', () => {
  it('条件は 2 つで既定はどちらも有効である', async () => {
    // Arrange
    render(
      <SchemaFilterMenu connectionId="c1" savedConnectionId="saved-1" onReload={async () => {}} />,
    )

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'スキーマの絞り込み' }))

    // Assert
    expect(screen.getByLabelText('システムスキーマを除外')).toBeChecked()
    expect(screen.getByLabelText('参照可能なオブジェクトが無いスキーマを隠す')).toBeChecked()
  })

  it('条件を変えるとスキーマを取得し直す', async () => {
    // Arrange
    render(
      <SchemaFilterMenu connectionId="c1" savedConnectionId="saved-1" onReload={async () => {}} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'スキーマの絞り込み' }))

    // Act
    await userEvent.click(screen.getByLabelText('システムスキーマを除外'))

    // Assert
    await waitFor(() => expect(calls.schemaOverview).toHaveLength(1))
    expect(calls.schemaOverview[0].filter).toEqual({ excludeSystem: false, hideEmpty: true })
  })

  it('条件は接続のエントリへ書き戻される', async () => {
    // Arrange
    render(
      <SchemaFilterMenu connectionId="c1" savedConnectionId="saved-1" onReload={async () => {}} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'スキーマの絞り込み' }))

    // Act
    await userEvent.click(screen.getByLabelText('参照可能なオブジェクトが無いスキーマを隠す'))

    // Assert
    await waitFor(() => expect(calls.saveConnection).toHaveLength(1))
    expect(calls.saveConnection[0].connection.schemaFilter).toEqual({
      excludeSystem: true,
      hideEmpty: false,
    })
    expect(calls.saveConnection[0].password).toBeNull()
  })

  it('保存していない接続では書き戻さない', async () => {
    // Arrange
    render(
      <SchemaFilterMenu connectionId="c1" savedConnectionId={null} onReload={async () => {}} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'スキーマの絞り込み' }))

    // Act
    await userEvent.click(screen.getByLabelText('システムスキーマを除外'))

    // Assert
    await waitFor(() => expect(calls.schemaOverview).toHaveLength(1))
    expect(calls.saveConnection).toHaveLength(0)
  })

  it('未接続では操作できない', () => {
    // Arrange
    render(
      <SchemaFilterMenu connectionId={null} savedConnectionId={null} onReload={async () => {}} />,
    )

    // Act
    const ボタン = screen.getByRole('button', { name: 'スキーマの絞り込み' })

    // Assert
    expect(ボタン).toBeDisabled()
  })

  it('再読み込みを押すと取得し直す', async () => {
    // Arrange
    const 読み直した: string[] = []
    render(
      <SchemaFilterMenu
        connectionId="c1"
        savedConnectionId="saved-1"
        onReload={async (id) => {
          読み直した.push(id)
        }}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'スキーマの絞り込み' }))

    // Act
    await userEvent.click(screen.getByRole('button', { name: '再読み込み' }))

    // Assert
    expect(読み直した).toEqual(['c1'])
  })
})
