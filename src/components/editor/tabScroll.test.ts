/**
 * タブ帯の横スクロールの計算のテスト。
 *
 * 帯が実際にはみ出すかどうかは jsdom では確かめられないが、「どこまで送れば
 * 見えるか」「端でどれだけ送るか」は数の問題として確かめられる。`tabOrder.ts`
 * と同じ考えで、境目をここで見張る。
 */

import { describe, expect, it } from 'vitest'
import { AUTO_SCROLL_EDGE, AUTO_SCROLL_MAX_STEP, autoScrollStep, revealOffset } from './tabScroll'

describe('revealOffset', () => {
  it('見えているタブでは送り量が変わらない', () => {
    // Arrange: 帯は 300px、送り量 0。タブは 100〜200 に居る
    // Act
    const 送り量 = revealOffset(0, 300, 100, 100)

    // Assert
    expect(送り量).toBe(0)
  })

  it('右に隠れているタブは右端が帯の右端に来るまで送る', () => {
    // Arrange: 帯は 150px、送り量 0。タブは 208〜308 に居る
    // Act
    const 送り量 = revealOffset(0, 150, 208, 100)

    // Assert
    expect(送り量).toBe(158)
  })

  it('左に隠れているタブは左端が帯の左端に来るまで戻す', () => {
    // Arrange: 帯は 150px、送り量 158。タブは 0〜100 に居る
    // Act
    const 送り量 = revealOffset(158, 150, 0, 100)

    // Assert
    expect(送り量).toBe(0)
  })

  it('必要な最小限しか動かさない', () => {
    // Arrange: 帯は 150px、送り量 100。タブは 220〜320 で右へ 70 はみ出す
    // Act
    const 送り量 = revealOffset(100, 150, 220, 100)

    // Assert
    expect(送り量).toBe(170)
  })

  it('先頭のタブを見せる送り量は負にならない', () => {
    // Arrange: 送り量 0 で既に先頭が見えている
    // Act
    const 送り量 = revealOffset(0, 150, 0, 100)

    // Assert
    expect(送り量).toBe(0)
  })

  it('帯より広いタブは左端を優先する', () => {
    // Arrange: 帯は 80px、タブは 100〜200 の 100px
    // Act
    const 送り量 = revealOffset(0, 80, 100, 100)

    // Assert: 右端に合わせると名前の頭が切れるため、左端で止める
    expect(送り量).toBe(100)
  })
})

describe('autoScrollStep', () => {
  it('端から離れていれば送らない', () => {
    // Arrange: 帯は 0〜300
    // Act
    const 送り = autoScrollStep(0, 300, 150)

    // Assert
    expect(送り).toBe(0)
  })

  it('右の端に入ると右へ送る', () => {
    // Arrange: 帯は 0〜300。右端の内側 24px は 276 から
    // Act
    const 送り = autoScrollStep(0, 300, 290)

    // Assert
    expect(送り).toBeGreaterThan(0)
  })

  it('左の端に入ると左へ送る', () => {
    // Arrange
    // Act
    const 送り = autoScrollStep(0, 300, 10)

    // Assert
    expect(送り).toBeLessThan(0)
  })

  it('端の境目のすぐ内側でも必ず 1px は送る', () => {
    // Arrange: 右端の内側 24px にちょうど 1px 入った位置
    // Act
    const 送り = autoScrollStep(0, 300, 300 - AUTO_SCROLL_EDGE + 1)

    // Assert
    expect(送り).toBe(1)
  })

  it('端の境目の外側では送らない', () => {
    // Arrange: 端の内側にちょうど届かない位置
    // Act
    const 送り = autoScrollStep(0, 300, 300 - AUTO_SCROLL_EDGE)

    // Assert
    expect(送り).toBe(0)
  })

  it('端へ深く入るほど大きく送る', () => {
    // Arrange
    // Act
    const 浅い = autoScrollStep(0, 300, 285)
    const 深い = autoScrollStep(0, 300, 298)

    // Assert
    expect(深い).toBeGreaterThan(浅い)
  })

  it('帯の外まで出しても上限を超えて送らない', () => {
    // Arrange
    // Act
    const 右 = autoScrollStep(0, 300, 900)
    const 左 = autoScrollStep(0, 300, -900)

    // Assert
    expect(右).toBe(AUTO_SCROLL_MAX_STEP)
    expect(左).toBe(-AUTO_SCROLL_MAX_STEP)
  })

  it('端の幅の 2 倍より狭い帯では左を優先する', () => {
    // Arrange: 帯が 30px しかなく、左右の端が重なっている
    // Act
    const 送り = autoScrollStep(0, 30, 20)

    // Assert
    expect(送り).toBeLessThan(0)
  })
})
