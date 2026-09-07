/**
 * UnoCSS が実際に生成する CSS を検査する。
 *
 * `leading-1.6` のような書き方は、preset-wind4 では比率ではなく間隔尺度として
 * 解釈され、`line-height: calc(var(--spacing) * 1.6)` = 6.4px になる。見た目が
 * 崩れるだけでビルドもリントも通ってしまうため、生成結果そのものを見張る。
 */

import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createGenerator } from 'unocss'
import { describe, expect, it } from 'vitest'
import { koduchiUnoConfig } from './unoConfig'

/** アプリと同じ設定でジェネレータを作る。 */
function ジェネレータを作る() {
  return createGenerator(koduchiUnoConfig)
}

/** `src/` 配下の tsx から、クラス名らしき文字列をすべて集める。 */
function 使っているクラス名を集める(): string[] {
  const root = resolve(process.cwd(), 'src')
  const files = globSync('**/*.tsx', { cwd: root }).map((name) => resolve(root, name))

  const names = new Set<string>()
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const [, literal] of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      for (const token of (literal ?? '').split(/\s+/)) {
        if (token && !token.includes('${')) {
          names.add(token)
        }
      }
    }
    // 三項演算子の分岐など、テンプレートリテラルの中身も拾う
    for (const [, literal] of text.matchAll(/className=\{`([^`]*)`\}/g)) {
      for (const token of literal.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) {
        if (token) {
          names.add(token)
        }
      }
    }
  }

  return [...names]
}

describe('UnoCSS のユーティリティ', () => {
  it('行の高さが間隔尺度として解釈されているクラスが無い', async () => {
    // Arrange
    const 使っているクラス = 使っているクラス名を集める()
    const generator = await ジェネレータを作る()

    // Act
    const { css } = await generator.generate(使っているクラス.join(' '), { preflights: false })

    // Assert: 比率のつもりの指定が `calc(var(--spacing) * n)` になっていないこと
    const 誤った行の高さ = [
      ...css.matchAll(/\.([^{]+)\{[^}]*line-height:calc\(var\(--spacing\)[^}]*\}/g),
    ]
    expect(誤った行の高さ.map((match) => match[1])).toEqual([])
  })

  it('比率で書いた行の高さは角括弧で正しく生成される', async () => {
    // Arrange
    const generator = await ジェネレータを作る()

    // Act
    const { css } = await generator.generate('leading-[1.6]', { preflights: false })

    // Assert
    expect(css).toContain('line-height:1.6')
  })

  it('デザイントークンの色は CSS 変数を参照する', async () => {
    // Arrange
    const generator = await ジェネレータを作る()

    // Act
    const { css } = await generator.generate('bg-panel text-fg3 border-line', { preflights: false })

    // Assert
    expect(css).toContain('var(--panel)')
    expect(css).toContain('var(--fg3)')
    expect(css).toContain('var(--line)')
  })

  it('注意の色は CSS 変数を参照する', async () => {
    // Arrange: 未コミットの表示に使う（ADR 0012）
    const generator = await ジェネレータを作る()

    // Act
    const { css } = await generator.generate('text-warn', { preflights: false })

    // Assert
    expect(css).toContain('var(--warn)')
  })

  it('注意の色はライトとダークの両方で定義されている', async () => {
    // Arrange
    const tokens = readFileSync(resolve(process.cwd(), 'src/theme/tokens.css'), 'utf8')

    // Act: ライト・システム追従のダーク・ダーク固定の 3 箇所
    const 定義の数 = [...tokens.matchAll(/--warn:/g)].length

    // Assert
    expect(定義の数).toBe(3)
  })
})
