import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SqlEditor, type EditorPosition } from './SqlEditor'

/** 既定の props でエディタを描き、通知された内容を集めて返す。 */
function 描く(overrides: Partial<React.ComponentProps<typeof SqlEditor>> = {}) {
  const 通知: { content: string[]; position: EditorPosition[] } = { content: [], position: [] }
  const props: React.ComponentProps<typeof SqlEditor> = {
    value: '',
    schema: {},
    onChange: (content) => 通知.content.push(content),
    onCursorChange: (position) => 通知.position.push(position),
    onRunStatement: () => {},
    onRunSelection: () => {},
    onCancel: () => {},
    ...overrides,
  }
  const { rerender } = render(<SqlEditor {...props} />)
  return {
    通知,
    /** 外から内容を差し替える。 */
    差し替える: (value: string) => rerender(<SqlEditor {...props} value={value} />),
  }
}

/** 検索パネルの要素を取り出す。開いていなければ `null`。 */
function 検索パネル(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.cm-panel.cm-search')
}

/** 検索パネルの中の入力欄を名前で取り出す。 */
function 検索欄(name: 'search' | 'replace'): HTMLInputElement {
  const 欄 = 検索パネル()?.querySelector(`input[name="${name}"]`)
  if (!(欄 instanceof HTMLInputElement)) {
    throw new Error(`検索パネルの ${name} 欄が見つからない`)
  }
  return 欄
}

/** 編集領域の要素を取り出す。 */
function 編集領域(): HTMLElement {
  const content = document.querySelector('.cm-content')
  if (!(content instanceof HTMLElement)) {
    throw new Error('編集領域が見つからない')
  }
  return content
}

describe('SqlEditor', () => {
  it('初期値が表示される', () => {
    // Arrange
    描く({ value: 'select 1 from dual' })

    // Act
    const 表示 = 編集領域().textContent

    // Assert
    expect(表示).toContain('select 1 from dual')
  })

  it('綴り検査と自動修正を切ってある', () => {
    // Arrange
    描く()

    // Act
    const 領域 = 編集領域()

    // Assert
    expect(領域).toHaveAttribute('spellcheck', 'false')
    expect(領域).toHaveAttribute('autocorrect', 'off')
    expect(領域).toHaveAttribute('autocapitalize', 'off')
  })

  it('入力すると内容が通知される', async () => {
    // Arrange
    const { 通知 } = 描く()

    // Act
    await userEvent.click(編集領域())
    await userEvent.keyboard('select')

    // Assert
    expect(通知.content.at(-1)).toBe('select')
  })

  it('入力するとカーソル位置が通知される', async () => {
    // Arrange
    const { 通知 } = 描く()

    // Act
    await userEvent.click(編集領域())
    await userEvent.keyboard('abc')

    // Assert
    expect(通知.position.at(-1)).toMatchObject({ line: 1, column: 4, offset: 3 })
  })

  it('外から内容を差し替えると反映される', () => {
    // Arrange
    const { 差し替える } = 描く({ value: '' })

    // Act
    差し替える('select * from users')

    // Assert
    expect(編集領域().textContent).toContain('select * from users')
  })

  it('⌘F で検索パネルが開く', async () => {
    // Arrange
    描く({ value: 'select id from users' })

    // Act
    await userEvent.click(編集領域())
    await userEvent.keyboard('{Meta>}f{/Meta}')

    // Assert
    expect(検索パネル()).not.toBeNull()
    expect(検索欄('search')).toBeInTheDocument()
  })

  it('検索パネルの文言が日本語になっている', async () => {
    // Arrange
    描く({ value: 'select id from users' })

    // Act
    await userEvent.click(編集領域())
    await userEvent.keyboard('{Meta>}f{/Meta}')

    // Assert
    expect(検索欄('search')).toHaveAttribute('placeholder', '検索')
    expect(検索欄('replace')).toHaveAttribute('placeholder', '置換後の文字列')
    expect(検索パネル()?.textContent).toContain('次へ')
    expect(検索パネル()?.textContent).toContain('すべて置換')
  })

  it('検索語を入れると該当箇所が強調される', async () => {
    // Arrange
    描く({ value: 'select users.id from users' })
    await userEvent.click(編集領域())
    await userEvent.keyboard('{Meta>}f{/Meta}')

    // Act
    await userEvent.type(検索欄('search'), 'users')

    // Assert
    expect(document.querySelectorAll('.cm-searchMatch').length).toBeGreaterThan(0)
  })

  it('⌥⌘F で置換欄に入力の焦点が移る', async () => {
    // Arrange
    描く({ value: 'select id from users' })

    // Act
    await userEvent.click(編集領域())
    await userEvent.keyboard('{Meta>}{Alt>}f{/Alt}{/Meta}')

    // Assert
    expect(document.activeElement).toBe(検索欄('replace'))
  })

  it('検索欄の変換中は検索語を確定しない', async () => {
    // Arrange
    描く({ value: 'select id from users' })
    await userEvent.click(編集領域())
    await userEvent.keyboard('{Meta>}f{/Meta}')
    const 欄 = 検索欄('search')

    // Act
    欄.value = 'い'
    欄.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, isComposing: true }))

    // Assert
    expect(document.querySelectorAll('.cm-searchMatch')).toHaveLength(0)
  })

  it('検索パネルの閉じるボタンは文字ではなくアイコンで描かれる', async () => {
    // Arrange
    描く({ value: 'select id from users' })

    // Act
    await userEvent.click(編集領域())
    await userEvent.keyboard('{Meta>}f{/Meta}')

    // Assert
    const 閉じる = 検索パネル()?.querySelector('button[name="close"]')
    expect(閉じる?.querySelector('svg')).not.toBeNull()
    expect(閉じる?.textContent).toBe('')
  })

  it('自分が伝えた内容が返ってきても打ち直さない', async () => {
    // Arrange
    const { 通知, 差し替える } = 描く()
    await userEvent.click(編集領域())
    await userEvent.keyboard('select')
    const 通知の数 = 通知.content.length

    // Act
    差し替える('select')

    // Assert
    expect(通知.content).toHaveLength(通知の数)
    expect(編集領域().textContent).toContain('select')
  })
})
