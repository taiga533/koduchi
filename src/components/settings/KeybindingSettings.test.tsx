import { useMemo } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { resetDbApi, setDbApi } from '../../api/db'
import { createFakeDbApi, type FakeCalls } from '../../test/fakeDbApi'
import type { BindableCommand } from '../../keybindings/bindings'
import { resolveKeybindings } from '../../keybindings/bindings'
import { KeybindingsContext } from '../../keybindings/context'
import { useUiStore } from '../../stores/ui'
import { KeybindingSettings } from './KeybindingSettings'
import { SettingsPanel } from './SettingsPanel'

/** 試しに使う表。 */
const 表: BindableCommand[] = [
  { id: 'commit', label: 'コミット', defaultKey: { key: 'c', ctrl: true, meta: true } },
  { id: 'palette', label: 'パレット', defaultKey: { key: 'p', shift: true, meta: true } },
  { id: 'sessions', label: 'セッション', defaultKey: null },
]

let calls: FakeCalls

beforeEach(() => {
  const fake = createFakeDbApi()
  calls = fake.calls
  setDbApi(fake.api)
  useUiStore.setState({ keybindings: {} })
})

afterEach(() => {
  resetDbApi()
})

/** `App.tsx` と同じく、ストアの差分から割り当てを解決して配る。 */
function 割り当てを配る({ children }: { children: React.ReactNode }) {
  const overrides = useUiStore((state) => state.keybindings)
  const resolved = useMemo(() => resolveKeybindings(表, overrides), [overrides])
  return <KeybindingsContext value={resolved}>{children}</KeybindingsContext>
}

/** キー割り当ての欄だけを描く。 */
function 描く() {
  render(
    <割り当てを配る>
      <KeybindingSettings commands={表} />
    </割り当てを配る>,
  )
}

/** 操作のキーの欄。 */
function キーの欄(label: string): HTMLElement {
  return screen.getByRole('button', { name: `${label}のキー` })
}

describe('KeybindingSettings', () => {
  it('今のキーを出し、キーの無い操作は — にする', () => {
    // Arrange & Act
    描く()

    // Assert
    expect(キーの欄('コミット')).toHaveTextContent('⌃⌘C')
    expect(キーの欄('セッション')).toHaveTextContent('—')
  })

  it('押してから打ったキーに割り当て直し、差分として保存する', async () => {
    // Arrange
    描く()

    // Act
    await userEvent.click(キーの欄('パレット'))
    fireEvent.keyDown(キーの欄('パレット'), { key: 'k', code: 'KeyK', metaKey: true })

    // Assert
    expect(キーの欄('パレット')).toHaveTextContent('⌘K')
    expect(calls.saveAppSettings.at(-1)?.keybindings).toEqual({ palette: 'cmd+k' })
  })

  it('記録した打鍵は既定の動作を止め、ウィンドウの振り分けへ渡さない', async () => {
    // Arrange
    描く()
    await userEvent.click(キーの欄('セッション'))

    // Act
    const 止めなかった = fireEvent.keyDown(キーの欄('セッション'), {
      key: 'w',
      code: 'KeyW',
      metaKey: true,
    })

    // Assert
    expect(止めなかった).toBe(false)
  })

  it('変換中の打鍵は記録しない（ADR 0025）', async () => {
    // Arrange
    描く()
    await userEvent.click(キーの欄('パレット'))

    // Act
    fireEvent.keyDown(キーの欄('パレット'), { key: 'Enter', code: 'Enter', keyCode: 229 })
    fireEvent.keyDown(キーの欄('パレット'), { key: 'Enter', code: 'Enter', isComposing: true })

    // Assert
    expect(キーの欄('パレット')).toHaveTextContent('キーを押す…')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(calls.saveAppSettings).toEqual([])
  })

  it('他の操作のキーを打つと相手の名前を添えて断り、記録を続ける', async () => {
    // Arrange
    描く()
    await userEvent.click(キーの欄('セッション'))

    // Act
    fireEvent.keyDown(キーの欄('セッション'), {
      key: 'c',
      code: 'KeyC',
      metaKey: true,
      ctrlKey: true,
    })

    // Assert
    expect(screen.getByRole('alert')).toHaveTextContent('⌃⌘C は「コミット」に割り当て済みです')
    expect(キーの欄('セッション')).toHaveTextContent('キーを押す…')
    expect(calls.saveAppSettings).toEqual([])
  })

  it('修飾キーだけを押している間は待ち続ける', async () => {
    // Arrange
    描く()
    await userEvent.click(キーの欄('セッション'))

    // Act
    fireEvent.keyDown(キーの欄('セッション'), { key: 'Meta', code: 'MetaLeft', metaKey: true })

    // Assert
    expect(キーの欄('セッション')).toHaveTextContent('キーを押す…')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('既定に戻すと差分から消える', async () => {
    // Arrange
    useUiStore.setState({ keybindings: { palette: 'cmd+k' } })
    描く()

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'パレットを既定に戻す' }))

    // Assert
    expect(キーの欄('パレット')).toHaveTextContent('⇧⌘P')
    expect(calls.saveAppSettings.at(-1)?.keybindings).toEqual({})
  })

  it('キーを外すと — になり、空文字を差分に書く', async () => {
    // Arrange
    描く()

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'コミットのキーを外す' }))

    // Assert
    expect(キーの欄('コミット')).toHaveTextContent('—')
    expect(calls.saveAppSettings.at(-1)?.keybindings).toEqual({ commit: '' })
  })

  it('重なって効かない既定のキーと読めない差分を行の下に報せる', () => {
    // Arrange: 手で書いた settings.toml
    useUiStore.setState({ keybindings: { sessions: 'shift+cmd+p', commit: 'cmd+' } })

    // Act
    描く()

    // Assert
    expect(screen.getByText('⇧⌘P は「セッション」と重なっているため効きません')).toBeInTheDocument()
    expect(
      screen.getByText('設定の「cmd+」が読めないため、既定のキーで動いています'),
    ).toBeInTheDocument()
  })

  it('すべて既定に戻すと差分が空になる', async () => {
    // Arrange
    useUiStore.setState({ keybindings: { palette: 'cmd+k', commit: '' } })
    描く()

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'すべて既定に戻す' }))

    // Assert
    expect(useUiStore.getState().keybindings).toEqual({})
    expect(キーの欄('コミット')).toHaveTextContent('⌃⌘C')
  })
})

describe('SettingsPanel のキー割り当て', () => {
  it('記録中の esc は記録を取り消し、設定画面は閉じない（ADR 0031）', async () => {
    // Arrange
    let 閉じた = false
    render(
      <割り当てを配る>
        <SettingsPanel commands={表} clientUnavailable={false} onClose={() => (閉じた = true)} />
      </割り当てを配る>,
    )
    await userEvent.click(キーの欄('パレット'))

    // Act
    fireEvent.keyDown(キーの欄('パレット'), { key: 'Escape', code: 'Escape' })

    // Assert
    expect(閉じた).toBe(false)
    expect(キーの欄('パレット')).toHaveTextContent('⇧⌘P')
  })

  it('記録していなければ esc で設定画面を閉じる', () => {
    // Arrange
    let 閉じた = false
    render(
      <割り当てを配る>
        <SettingsPanel commands={表} clientUnavailable={false} onClose={() => (閉じた = true)} />
      </割り当てを配る>,
    )

    // Act
    fireEvent.keyDown(キーの欄('パレット'), { key: 'Escape', code: 'Escape' })

    // Assert
    expect(閉じた).toBe(true)
  })
})
