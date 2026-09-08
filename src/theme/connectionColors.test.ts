/**
 * 接続の色とトークンの対応のテスト（ADR 0015）。
 *
 * 色の値をコンポーネントへ直接書かない決まり（ADR 0008）を守れているかを、
 * 「トークンを参照していること」と「ライト / ダークの両方に定義があること」の
 * 2 点で見張る。
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONNECTION_COLORS } from '../types/db'
import { CONNECTION_COLOR_LABELS, connectionColorVar } from './connectionColors'

/** `tokens.css` を読む。 */
function トークンを読む(): string {
  return readFileSync(resolve(process.cwd(), 'src/theme/tokens.css'), 'utf8')
}

describe('connectionColorVar', () => {
  it('色なしは何も返さない', () => {
    // Arrange & Act
    const 値 = connectionColorVar('none')

    // Assert
    expect(値).toBeUndefined()
  })

  it('色は CSS 変数の参照になる', () => {
    // Arrange & Act
    const 値 = connectionColorVar('red')

    // Assert
    expect(値).toBe('var(--cn-red)')
  })

  it('どの色も生の色の値を返さない', () => {
    // Arrange
    const 色たち = CONNECTION_COLORS.filter((color) => color !== 'none')

    // Act
    const 値たち = 色たち.map((color) => connectionColorVar(color))

    // Assert
    expect(値たち.every((値) => 値?.startsWith('var(--cn-'))).toBe(true)
  })
})

describe('接続の色のトークン', () => {
  it('色なし以外のすべての色がライト・システム追従のダーク・ダーク固定の3箇所で定義されている', () => {
    // Arrange
    const tokens = トークンを読む()
    const 色たち = CONNECTION_COLORS.filter((color) => color !== 'none')

    // Act
    const 定義の数 = 色たち.map(
      (color) => [...tokens.matchAll(new RegExp(`--cn-${color}:`, 'g'))].length,
    )

    // Assert
    expect(定義の数).toEqual(色たち.map(() => 3))
  })

  it('すべての色に見せる名前が付いている', () => {
    // Arrange & Act
    const 名前 = CONNECTION_COLORS.map((color) => CONNECTION_COLOR_LABELS[color])

    // Assert
    expect(名前.every((label) => label !== undefined && label !== '')).toBe(true)
  })
})
