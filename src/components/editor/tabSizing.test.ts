/**
 * タブ 1 枚の幅の内訳のテスト。
 *
 * 「タブが縮んでも `●` 印・種別のアイコン・閉じる `✕` は見えたままである」
 * という ADR 0022・0023 の約束を、幅の関係として見張る。
 */

import { describe, expect, it } from 'vitest'
import {
  TAB_FIXED_PARTS,
  TAB_MAX_WIDTH,
  TAB_MIN_WIDTH,
  TAB_NAME_MIN_WIDTH,
  tabFixedWidth,
} from './tabSizing'

describe('タブの幅', () => {
  it('名前以外の幅は内訳の合計である', () => {
    // Arrange
    const 内訳 = Object.values(TAB_FIXED_PARTS)

    // Act
    const 合計 = tabFixedWidth()

    // Assert
    expect(合計).toBe(内訳.reduce((total, width) => total + width, 0))
  })

  it('未保存の印・種別のアイコン・閉じるボタンは名前以外の幅に必ず含まれる', () => {
    // Arrange: ADR 0023 が「常に出す」と決めた 3 つ（アイコンは ADR 0022）
    const 常に見えるもの =
      TAB_FIXED_PARTS.dirtyMark + TAB_FIXED_PARTS.kindIcon + TAB_FIXED_PARTS.closeButton

    // Act
    const 名前以外 = tabFixedWidth()

    // Assert
    expect(常に見えるもの).toBe(32)
    expect(名前以外).toBeGreaterThanOrEqual(常に見えるもの)
  })

  it('縮む下限は名前以外の部品がすべて収まる広さである', () => {
    // Arrange
    // 下限まで縮めても部品が欠けてはならない

    // Act
    const 余り = TAB_MIN_WIDTH - tabFixedWidth()

    // Assert
    expect(余り).toBe(TAB_NAME_MIN_WIDTH)
    expect(余り).toBeGreaterThan(0)
  })

  it('縮む下限は広がる上限より狭い', () => {
    // Arrange
    // 上限と下限が逆転すると、ブラウザは下限を優先してタブが縮まなくなる

    // Act
    const 差 = TAB_MAX_WIDTH - TAB_MIN_WIDTH

    // Assert
    expect(差).toBeGreaterThan(0)
  })
})
