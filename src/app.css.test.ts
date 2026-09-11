/**
 * `app.css` の土台の決め方を見張る（ADR 0031）。
 *
 * jsdom はレイアウトを持たないため「document が実際にスクロールしないこと」は
 * ここでは確かめられない。実機（WKWebView / Chromium）では
 * `documentElement.scrollHeight === clientHeight` であること、器の中の
 * スクロールが生きていることを手で測って確かめてある。ここで見張るのは
 * **その決めが宣言として残っていること**である。
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { declarationsFor } from './theme/cssRules'

// vitest は既定で CSS の取り込みを空にする（`css: false`）ため、`import` では
// 中身が得られない。file をそのまま読む。
const css = readFileSync(resolve(__dirname, 'app.css'), 'utf8')

describe('app.css の土台', () => {
  it.each(['html', 'body', '#root'])('%s の高さをウィンドウいっぱいに押さえる', (selector) => {
    // Arrange & Act
    const found = declarationsFor(css, selector)

    // Assert
    expect(found.get('height')).toBe('100%')
  })

  it.each(['html', 'body'])('%s の overflow を hidden にして document を送らせない', (selector) => {
    // Arrange & Act
    const found = declarationsFor(css, selector)

    // Assert
    expect(found.get('overflow')).toBe('hidden')
  })

  it.each(['html', 'body'])('%s の overscroll-behavior を none にして弾みを止める', (selector) => {
    // Arrange & Act
    const found = declarationsFor(css, selector)

    // Assert
    expect(found.get('overscroll-behavior')).toBe('none')
  })

  it('本体の余白を 0 にする', () => {
    // Arrange & Act
    const found = declarationsFor(css, 'body')

    // Assert
    expect(found.get('margin')).toBe('0')
  })

  it('ビューポートの高さを vh で決めない', () => {
    // Arrange
    // `100vh` は macOS のウィンドウの実際の高さと必ずしも一致せず、差がそのまま
    // はみ出しになる。高さの出どころは `height: 100%` の連なり 1 本に保つ。

    // Act
    const 使っている = /\d+vh\b/.test(css)

    // Assert
    expect(使っている).toBe(false)
  })
})
