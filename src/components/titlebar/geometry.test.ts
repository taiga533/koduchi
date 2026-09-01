import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  TITLE_BAR_HEIGHT,
  TRAFFIC_LIGHT_DIAMETER,
  TRAFFIC_LIGHT_LEFT,
  TRAFFIC_LIGHT_SPACING,
  titleBarContentLeft,
  trafficLightRight,
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
