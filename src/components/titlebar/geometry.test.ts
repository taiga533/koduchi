import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CONNECTION_COLOR_BAR_HEIGHT,
  TITLE_BAR_HEIGHT,
  TRAFFIC_LIGHT_DIAMETER,
  TRAFFIC_LIGHT_LEFT,
  TRAFFIC_LIGHT_SPACING,
  titleBarContentLeft,
  trafficLightRight,
  trafficLightTop,
  trafficLightY,
} from './geometry'

/** `tauri.conf.json` の 1 枚目のウィンドウ設定を読む。 */
function ウィンドウ設定を読む() {
  const path = resolve(process.cwd(), 'src-tauri/tauri.conf.json')
  const config = JSON.parse(readFileSync(path, 'utf8'))
  return config.app.windows[0]
}

describe('trafficLightY', () => {
  it('42px のタイトルバーでは 23 になる', () => {
    // Arrange
    const height = 42

    // Act
    const y = trafficLightY(height)

    // Assert
    expect(y).toBe(23)
  })

  it('高さの半分より 2px 大きい値になる', () => {
    // Arrange: tao はコンテナの高さを変えることでボタンを動かすため、
    // 指定値とボタン中心のあいだに 2px のずれが生じる
    const heights = [28, 42, 56]

    // Act
    const values = heights.map(trafficLightY)

    // Assert
    expect(values).toEqual([16, 23, 30])
  })
})

describe('trafficLightTop', () => {
  it('42px のタイトルバーではボタンの上端が 14px の位置に来る', () => {
    // Arrange: y = 23 → 中心 21 → 上端 21 − 7
    const height = 42

    // Act
    const top = trafficLightTop(height)

    // Assert
    expect(top).toBe(14)
  })

  it('ボタン中心から半径ぶん上が上端になる', () => {
    // Arrange
    const heights = [28, 42, 56]

    // Act
    const 上端 = heights.map(trafficLightTop)

    // Assert: 中心 = trafficLightY(h) − 2、上端 = 中心 − 直径/2
    expect(上端).toEqual(
      heights.map((height) => trafficLightY(height) - 2 - TRAFFIC_LIGHT_DIAMETER / 2),
    )
  })
})

describe('接続の色の帯（ADR 0015）', () => {
  it('帯は信号機のボタンに掛からない薄さである', () => {
    // Arrange
    const 上端 = trafficLightTop(TITLE_BAR_HEIGHT)

    // Act
    const 帯 = CONNECTION_COLOR_BAR_HEIGHT

    // Assert
    expect(帯).toBeLessThan(上端)
  })

  it('タイトルバーを縮めても帯がボタンに掛からない', () => {
    // Arrange: 高さを変えるとボタンの上端も動くため、いちばん狭い場合で見る
    const heights = [28, 42, 56]

    // Act
    const 余裕 = heights.map((height) => trafficLightTop(height) - CONNECTION_COLOR_BAR_HEIGHT)

    // Assert
    expect(余裕.every((値) => 値 > 0)).toBe(true)
  })
})

describe('trafficLightRight', () => {
  it('3 つのボタンが等間隔に並んだ右端を返す', () => {
    // Arrange: 14 + 23 * 2 + 14
    const left = TRAFFIC_LIGHT_LEFT

    // Act
    const right = trafficLightRight(left)

    // Assert
    expect(right).toBe(left + TRAFFIC_LIGHT_SPACING * 2 + TRAFFIC_LIGHT_DIAMETER)
    expect(right).toBe(74)
  })
})

describe('titleBarContentLeft', () => {
  it('信号機の右端より内側から内容が始まる', () => {
    // Arrange
    const left = TRAFFIC_LIGHT_LEFT

    // Act
    const contentLeft = titleBarContentLeft(left)

    // Assert
    expect(contentLeft).toBeGreaterThan(trafficLightRight(left))
  })
})

describe('tauri.conf.json との整合', () => {
  it('trafficLightPosition.y が計算式と一致する', () => {
    // Arrange
    const window = ウィンドウ設定を読む()

    // Act
    const 期待値 = trafficLightY(TITLE_BAR_HEIGHT)

    // Assert
    expect(window.trafficLightPosition.y).toBe(期待値)
  })

  it('trafficLightPosition.x が信号機の左端と一致する', () => {
    // Arrange
    const window = ウィンドウ設定を読む()

    // Act
    const x = window.trafficLightPosition.x

    // Assert
    expect(x).toBe(TRAFFIC_LIGHT_LEFT)
  })

  it('trafficLightPosition が効く条件を満たしている', () => {
    // Arrange: trafficLightPosition は titleBarStyle Overlay と decorations true の
    // 両方を要求する（@tauri-apps/cli の config.schema.json に明記）
    const window = ウィンドウ設定を読む()

    // Act
    const { titleBarStyle, decorations } = window

    // Assert
    expect(titleBarStyle).toBe('Overlay')
    expect(decorations).toBe(true)
  })
})
