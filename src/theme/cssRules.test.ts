import { describe, expect, it } from 'vitest'
import { declarationsFor } from './cssRules'

describe('declarationsFor', () => {
  it('選択子の並びに含まれていれば宣言を拾う', () => {
    // Arrange
    const css = 'html,\nbody {\n  overflow: hidden;\n}'

    // Act
    const found = declarationsFor(css, 'body')

    // Assert
    expect(found.get('overflow')).toBe('hidden')
  })

  it('同じ選択子への規則が複数あれば後に書いたものが勝つ', () => {
    // Arrange
    const css = 'body { margin: 8px; }\nbody { margin: 0; }'

    // Act
    const found = declarationsFor(css, 'body')

    // Assert
    expect(found.get('margin')).toBe('0')
  })

  it('別の規則の宣言を混ぜない', () => {
    // Arrange
    const css = 'html { overflow: hidden; }\nbody { color: red; }'

    // Act
    const found = declarationsFor(css, 'html')

    // Assert
    expect(found.has('color')).toBe(false)
  })

  it('註釈の中に書かれた宣言は拾わない', () => {
    // Arrange
    const css = '/* body { color: red; } */\nbody { color: blue; }'

    // Act
    const found = declarationsFor(css, 'body')

    // Assert
    expect(found.get('color')).toBe('blue')
  })

  it('値にコロンが含まれても property は最初のコロンまでで切る', () => {
    // Arrange
    const css = 'body { background: var(--bg) url(https://example.com/a.png) }'

    // Act
    const found = declarationsFor(css, 'body')

    // Assert
    expect(found.get('background')).toBe('var(--bg) url(https://example.com/a.png)')
  })

  it('書かれていない選択子には空を返す', () => {
    // Arrange
    const css = 'body { color: red; }'

    // Act
    const found = declarationsFor(css, 'main')

    // Assert
    expect(found.size).toBe(0)
  })

  it('@media を含む css は黙って読み飛ばさず例外を投げる', () => {
    // Arrange
    const css = '@media (min-width: 10px) {\n  html { overflow: hidden; }\n}'

    // Act & Assert
    expect(() => declarationsFor(css, 'html')).toThrow(/at-rule/)
  })

  it('@supports を含む css でも例外を投げる', () => {
    // Arrange
    const css = 'body { color: red; }\n@supports (display: grid) { body { color: blue; } }'

    // Act & Assert
    expect(() => declarationsFor(css, 'body')).toThrow(/at-rule/)
  })

  it('ブロックを持たない at-rule は素通りする', () => {
    // Arrange
    const css = "@charset 'utf-8';\nbody { color: red; }"

    // Act
    const found = declarationsFor(css, 'body')

    // Assert
    expect(found.get('color')).toBe('red')
  })
})
