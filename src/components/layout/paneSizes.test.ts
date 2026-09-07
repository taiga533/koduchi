import { describe, expect, it } from 'vitest'
import {
  EDITOR_HEIGHT_MIN,
  EDITOR_HEIGHT_WINDOW_MARGIN,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  clamp,
  clampEditorHeight,
  clampSidebarWidth,
  editorHeightMax,
} from './paneSizes'

describe('clamp', () => {
  it('範囲の中の値はそのまま返る', () => {
    // Arrange
    // Act
    const 結果 = clamp(50, 0, 100)

    // Assert
    expect(結果).toBe(50)
  })

  it('下限より小さい値は下限になる', () => {
    // Arrange
    // Act
    const 結果 = clamp(-10, 0, 100)

    // Assert
    expect(結果).toBe(0)
  })

  it('上限より大きい値は上限になる', () => {
    // Arrange
    // Act
    const 結果 = clamp(200, 0, 100)

    // Assert
    expect(結果).toBe(100)
  })
})

describe('clampSidebarWidth', () => {
  it('下限を割る幅は下限へ丸められる', () => {
    // Arrange
    const 狭すぎる幅 = SIDEBAR_WIDTH_MIN - 40

    // Act
    const 結果 = clampSidebarWidth(狭すぎる幅)

    // Assert
    expect(結果).toBe(SIDEBAR_WIDTH_MIN)
  })

  it('上限を超える幅は上限へ丸められる', () => {
    // Arrange
    const 広すぎる幅 = SIDEBAR_WIDTH_MAX + 100

    // Act
    const 結果 = clampSidebarWidth(広すぎる幅)

    // Assert
    expect(結果).toBe(SIDEBAR_WIDTH_MAX)
  })
})

describe('editorHeightMax', () => {
  it('上限はウィンドウの高さから余白を引いた値になる', () => {
    // Arrange
    const ウィンドウの高さ = 900

    // Act
    const 結果 = editorHeightMax(ウィンドウの高さ)

    // Assert
    expect(結果).toBe(900 - EDITOR_HEIGHT_WINDOW_MARGIN)
  })

  it('ウィンドウが低くても上限は下限を下回らない', () => {
    // Arrange
    const 低いウィンドウ = 200

    // Act
    const 結果 = editorHeightMax(低いウィンドウ)

    // Assert
    expect(結果).toBe(EDITOR_HEIGHT_MIN)
  })
})

describe('clampEditorHeight', () => {
  it('下限を割る高さは下限へ丸められる', () => {
    // Arrange
    const 低すぎる高さ = EDITOR_HEIGHT_MIN - 50

    // Act
    const 結果 = clampEditorHeight(低すぎる高さ, 900)

    // Assert
    expect(結果).toBe(EDITOR_HEIGHT_MIN)
  })

  it('ウィンドウを縮めると高さも上限まで下がる', () => {
    // Arrange
    const 元の高さ = 600

    // Act
    const 結果 = clampEditorHeight(元の高さ, 500)

    // Assert
    expect(結果).toBe(500 - EDITOR_HEIGHT_WINDOW_MARGIN)
  })
})
