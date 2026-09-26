import { describe, expect, it } from 'vitest'
import { MENU_EDGE_MARGIN, placeMenu } from './placement'

const 画面 = { width: 1000, height: 700 }
const メニュー = { width: 200, height: 150 }

describe('placeMenu', () => {
  it('収まるときは押した点を左上にする', () => {
    // Arrange
    const 押した点 = { x: 100, y: 120 }

    // Act
    const 位置 = placeMenu(押した点, メニュー, 画面)

    // Assert
    expect(位置).toEqual({ x: 100, y: 120 })
  })

  it('右へはみ出すときは押した点を右端にして左へ開く', () => {
    // Arrange
    const 押した点 = { x: 900, y: 120 }

    // Act
    const 位置 = placeMenu(押した点, メニュー, 画面)

    // Assert
    expect(位置).toEqual({ x: 700, y: 120 })
  })

  it('下へはみ出すときは押した点を下端にして上へ開く', () => {
    // Arrange
    const 押した点 = { x: 100, y: 650 }

    // Act
    const 位置 = placeMenu(押した点, メニュー, 画面)

    // Assert
    expect(位置).toEqual({ x: 100, y: 500 })
  })

  it('端の余白に掛かるだけでも反対側へ開く', () => {
    // Arrange: 右端までちょうど 200px だが、余白のぶん足りない
    const 押した点 = { x: 800, y: 120 }

    // Act
    const 位置 = placeMenu(押した点, メニュー, 画面)

    // Assert
    expect(位置.x).toBe(600)
  })

  it('反対側へ開いても収まらないほど狭ければ端の余白に寄せる', () => {
    // Arrange
    const 狭い画面 = { width: 1000, height: 200 }
    const 押した点 = { x: 100, y: 100 }

    // Act
    const 位置 = placeMenu(押した点, メニュー, 狭い画面)

    // Assert
    expect(位置.y).toBe(MENU_EDGE_MARGIN)
  })
})
