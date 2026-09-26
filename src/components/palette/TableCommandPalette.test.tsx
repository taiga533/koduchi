import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { resetDbApi, setDbApi } from '../../api/db'
import type { Command } from '../../mediator/commands'
import { createFakeDbApi } from '../../test/fakeDbApi'
import { resolveKeybindings } from '../../keybindings/bindings'
import { TableCommandPalette } from './TableCommandPalette'

/** 表の代わりに渡す 2 行。1 行はパレットに並べない。 */
const 表: Command[] = [
  {
    id: 'commit',
    label: 'コミット',
    scope: 'window',
    defaultKey: { key: 'c', ctrl: true, meta: true },
    inPalette: true,
    run: () => {},
  },
  {
    id: 'close-tab',
    label: 'タブを閉じる',
    scope: 'window',
    defaultKey: { key: 'w', meta: true },
    inPalette: false,
    run: () => {},
  },
]

beforeEach(() => {
  setDbApi(createFakeDbApi().api)
})

afterEach(() => {
  resetDbApi()
})

describe('TableCommandPalette', () => {
  it('表の行を並べ、選ばれた行を報告する', async () => {
    // Arrange
    const 報告: string[] = []
    render(
      <TableCommandPalette
        commands={表}
        keybindings={resolveKeybindings(表, {})}
        onRunCommand={(command) => {
          報告.push(command.id)
        }}
        connectionName="dev"
        onUseSql={() => {}}
        onRevealSchemaObject={() => {}}
        onClose={() => {}}
      />,
    )

    // Act
    await userEvent.click(await screen.findByRole('option', { name: /コミット/ }))

    // Assert
    expect(報告).toEqual(['commit'])
    expect(screen.queryByRole('option', { name: /タブを閉じる/ })).not.toBeInTheDocument()
  })
})
