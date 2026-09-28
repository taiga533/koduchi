import { describe, expect, it } from 'vitest'
import { PREVIEW_EDGE_MARGIN, PREVIEW_GAP, placePreview } from './previewPlacement'

const 画面 = { width: 1200, height: 800 }
const プレビュー = { width: 480, height: 300 }

describe('placePreview', () => {
  it('行の右隣に上端を揃えて置く', () => {
    // Arrange
    const 行 = { top: 120, right: 260 }

    // Act
    const 位置 = placePreview(行, プレビュー, 画面)

    // Assert
    expect(位置).toEqual({ left: 260 + PREVIEW_GAP, top: 120 })
  })

  it('右へはみ出すときは画面の右端へ寄せる', () => {
    // Arrange
    const 行 = { top: 120, right: 900 }

    // Act
    const 位置 = placePreview(行, プレビュー, 画面)

    // Assert
    expect(位置.left).toBe(1200 - PREVIEW_EDGE_MARGIN - 480)
  })

  it('下へはみ出すときは上へずらして全体を見せる', () => {
    // Arrange
    const 行 = { top: 700, right: 260 }

    // Act
    const 位置 = placePreview(行, プレビュー, 画面)

    // Assert
    expect(位置.top).toBe(800 - PREVIEW_EDGE_MARGIN - 300)
  })

  it('画面より大きいときは左上の余白に寄せる', () => {
    // Arrange
    const 行 = { top: 400, right: 260 }
    const 狭い画面 = { width: 300, height: 200 }

    // Act
    const 位置 = placePreview(行, プレビュー, 狭い画面)

    // Assert
    expect(位置).toEqual({ left: PREVIEW_EDGE_MARGIN, top: PREVIEW_EDGE_MARGIN })
  })
})
