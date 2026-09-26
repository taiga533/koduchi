import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Copy } from 'lucide-react'
import { ContextMenu, SEPARATOR } from './ContextMenu'

/** 項目 1 つを作る。 */
function 項目(label: string, onSelect: () => void = () => {}, shortcut?: string) {
  return { kind: 'item' as const, label, icon: <Copy size={13} />, onSelect, shortcut }
}

describe('ContextMenu', () => {
  it('項目を選ぶとその操作を呼んでから閉じる', () => {
    // Arrange
    const 順序: string[] = []
    render(
      <ContextMenu
        x={10}
        y={10}
        testId="menu"
        entries={[項目('コピー', () => 順序.push('選んだ'))]}
        onClose={() => 順序.push('閉じた')}
      />,
    )

    // Act
    fireEvent.click(screen.getByRole('menuitem', { name: 'コピー' }))

    // Assert
    expect(順序).toEqual(['選んだ', '閉じた'])
  })

  it('キーの表記と見出しと区切り線を出す', () => {
    // Arrange / Act
    render(
      <ContextMenu
        x={10}
        y={10}
        testId="menu"
        heading="KODUCHI.USERS"
        entries={[項目('閉じる', () => {}, '⌘W'), SEPARATOR, 項目('名前を変更')]}
        onClose={() => {}}
      />,
    )

    // Assert
    expect(screen.getByText('KODUCHI.USERS')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /閉じる/ })).toHaveTextContent('⌘W')
    expect(screen.getAllByRole('separator')).toHaveLength(1)
  })

  it('暗幕も項目も押し下げの既定動作を止め、焦点を奪わない', () => {
    // Arrange
    const onClose = vi.fn()
    render(<ContextMenu x={10} y={10} testId="menu" entries={[項目('コピー')]} onClose={onClose} />)

    // Act
    const 項目の既定動作 = fireEvent.mouseDown(screen.getByRole('menuitem', { name: 'コピー' }))
    const 暗幕の既定動作 = fireEvent.mouseDown(screen.getByTestId('menu-backdrop'))

    // Assert: `fireEvent` は既定動作を止められたときに偽を返す
    expect(項目の既定動作).toBe(false)
    expect(暗幕の既定動作).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('外で右クリックすると閉じ、ウェブビューのメニューも出さない', () => {
    // Arrange
    const onClose = vi.fn()
    render(<ContextMenu x={10} y={10} testId="menu" entries={[項目('コピー')]} onClose={onClose} />)

    // Act
    const 既定動作 = fireEvent.contextMenu(screen.getByTestId('menu-backdrop'))

    // Assert
    expect(既定動作).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('esc で閉じる', () => {
    // Arrange
    const onClose = vi.fn()
    render(<ContextMenu x={10} y={10} testId="menu" entries={[項目('コピー')]} onClose={onClose} />)

    // Act
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))

    // Assert
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
