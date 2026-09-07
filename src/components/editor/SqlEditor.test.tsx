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
    onRunScript: () => {},
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

  // CodeMirror の `Mod` は macOS では `⌘`、それ以外では `Ctrl` を指す。jsdom は
  // macOS として判定されないため、ここでは `Ctrl` を押して確かめる。
  it('⌥ + Mod + ⏎ でスクリプト実行が呼ばれる', async () => {
    // Arrange
    const 呼ばれた: string[] = []
    描く({ value: 'select 1;', onRunScript: () => 呼ばれた.push('script') })

    // Act
    await userEvent.click(編集領域())
    await userEvent.keyboard('{Alt>}{Control>}{Enter}{/Control}{/Alt}')

    // Assert
    expect(呼ばれた).toEqual(['script'])
  })

  it('外から内容を差し替えると反映される', () => {
    // Arrange
    const { 差し替える } = 描く({ value: '' })

    // Act
    差し替える('select * from users')

    // Assert
    expect(編集領域().textContent).toContain('select * from users')
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
