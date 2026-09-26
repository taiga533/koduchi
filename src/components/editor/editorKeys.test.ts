import { describe, expect, it } from 'vitest'
import type { KeyPress } from '../../keybindings/chord'
import { findEditorAction } from './editorKeys'

/** 既定の割り当て（エディタの行だけ）。 */
const 既定 = new Map([
  ['run', { key: 'enter', meta: true }],
  ['run-selection', { key: 'enter', meta: true, shift: true }],
  ['run-script', { key: 'enter', meta: true, alt: true }],
  ['cancel', { key: '.', meta: true }],
  ['format', { key: 'f', alt: true, shift: true }],
  ['commit', { key: 'c', ctrl: true, meta: true }],
])

/** 打鍵を作る。 */
function 打鍵(key: string, code: string, modifiers: Partial<KeyPress> = {}): KeyPress {
  return { key, code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...modifiers }
}

describe('findEditorAction', () => {
  it.each([
    [打鍵('Enter', 'Enter', { metaKey: true }), 'run'],
    [打鍵('Enter', 'Enter', { metaKey: true, shiftKey: true }), 'run-selection'],
    [打鍵('Enter', 'Enter', { metaKey: true, altKey: true }), 'run-script'],
    [打鍵('.', 'Period', { metaKey: true }), 'cancel'],
    [打鍵('Ï', 'KeyF', { altKey: true, shiftKey: true }), 'format'],
  ])('%o は %s に当たる', (press, action) => {
    // Arrange & Act
    const found = findEditorAction(press, 既定)

    // Assert
    expect(found).toBe(action)
  })

  it('ウィンドウの行のキーはエディタでは当てない', () => {
    // Arrange
    const press = 打鍵('c', 'KeyC', { metaKey: true, ctrlKey: true })

    // Act
    const found = findEditorAction(press, 既定)

    // Assert
    expect(found).toBeNull()
  })

  it('⌥⌘F（置換）は整形に当たらない', () => {
    // Arrange: 修飾が完全に一致したときだけ当てる
    const press = 打鍵('ƒ', 'KeyF', { altKey: true, metaKey: true })

    // Act
    const found = findEditorAction(press, 既定)

    // Assert
    expect(found).toBeNull()
  })

  it('割り当て直したキーで当たり、外した操作には当たらない', () => {
    // Arrange
    const 割り当て = new Map([['run', { key: 'f5' }]])

    // Act
    const 新しいキー = findEditorAction(打鍵('F5', 'F5'), 割り当て)
    const 元のキー = findEditorAction(打鍵('Enter', 'Enter', { metaKey: true }), 割り当て)

    // Assert
    expect(新しいキー).toBe('run')
    expect(元のキー).toBeNull()
  })
})
