/**
 * エディタのテーマの決め方を見張る（ADR 0031、issue #37）。
 *
 * ここで見張るのは配色ではなく**寸法の置き場所**である。`tooltips({ parent:
 * document.body })` が本体直下に作る入れ物にはエディタと同じテーマの class が
 * 付くため、`&`（テーマの class そのもの）へ寸法を書くと、空の入れ物にも同じ
 * 寸法が付いてしまう。実際にこれでビューポート 1 枚ぶんの白い帯が本体の下に
 * 生まれていた。
 */

import { describe, expect, it } from 'vitest'
import { editorThemeSpec } from './theme'

/** 箱の大きさを決める property。`&` にはどれも書いてはならない。 */
const 寸法のproperty = [
  'height',
  'minHeight',
  'maxHeight',
  'width',
  'minWidth',
  'maxWidth',
  'padding',
  'margin',
  'border',
  'display',
  'position',
]

describe('editorThemeSpec', () => {
  it.each(寸法のproperty)('`&` に %s を書かない（入れ物にも当たるため）', (property) => {
    // Arrange
    const 自分自身 = editorThemeSpec['&'] as Record<string, unknown>

    // Act
    const 書いてある = property in 自分自身

    // Assert
    expect(書いてある).toBe(false)
  })

  it('高さは `&.cm-editor` が持つ', () => {
    // Arrange & Act
    const 編集領域 = editorThemeSpec['&.cm-editor'] as Record<string, unknown>

    // Assert
    expect(編集領域.height).toBe('100%')
  })

  it.each(['fontSize', 'color', 'backgroundColor'])('`&` は %s を持つ', (property) => {
    // Arrange
    const 自分自身 = editorThemeSpec['&'] as Record<string, unknown>

    // Act
    const 書いてある = property in 自分自身

    // Assert
    expect(書いてある).toBe(true)
  })

  it('`&` が持つのはその 3 つだけである', () => {
    // Arrange
    const 自分自身 = editorThemeSpec['&'] as Record<string, unknown>

    // Act
    const 数 = Object.keys(自分自身).length

    // Assert
    expect(数).toBe(3)
  })

  it('高さを持つ選択子は `&.cm-editor` だけである', () => {
    // Arrange
    const 高さを持つ = Object.entries(editorThemeSpec)
      .filter(([, decls]) => 'height' in (decls as Record<string, unknown>))
      .map(([selector]) => selector)

    // Act & Assert
    expect(高さを持つ).toEqual(['&.cm-editor'])
  })
})
