import { describe, expect, it, beforeEach } from 'vitest'
import {
  applyAppearance,
  applyDisplaySettings,
  applyTheme,
  defaultAppearance,
  type Appearance,
} from './appearance'

describe('applyTheme', () => {
  let root: HTMLElement

  beforeEach(() => {
    root = document.createElement('html')
  })

  it('システム追従を選ぶと data-theme 属性が外れる', () => {
    // Arrange
    root.setAttribute('data-theme', 'dark')

    // Act
    applyTheme(root, 'system')

    // Assert
    expect(root.hasAttribute('data-theme')).toBe(false)
  })

  it('ダークを選ぶと data-theme="dark" が付く', () => {
    // Arrange
    // 属性の無い初期状態から始める

    // Act
    applyTheme(root, 'dark')

    // Assert
    expect(root.getAttribute('data-theme')).toBe('dark')
  })

  it('ライトを選ぶと data-theme="light" が付き OS のダーク設定を上書きできる', () => {
    // Arrange
    root.setAttribute('data-theme', 'dark')

    // Act
    applyTheme(root, 'light')

    // Assert
    expect(root.getAttribute('data-theme')).toBe('light')
  })
})

describe('applyDisplaySettings', () => {
  let root: HTMLElement

  beforeEach(() => {
    root = document.createElement('html')
  })

  it('罫線を消すと data-grid-lines="off" が付く', () => {
    // Arrange
    const appearance = { gridLines: false, rowHeight: 'compact' } as const

    // Act
    applyDisplaySettings(root, appearance)

    // Assert
    expect(root.getAttribute('data-grid-lines')).toBe('off')
  })

  it('罫線を戻すと data-grid-lines 属性が外れる', () => {
    // Arrange
    root.setAttribute('data-grid-lines', 'off')

    // Act
    applyDisplaySettings(root, { gridLines: true, rowHeight: 'compact' })

    // Assert
    expect(root.hasAttribute('data-grid-lines')).toBe(false)
  })

  it('行の高さを広くすると data-row-height="comfortable" が付く', () => {
    // Arrange
    const appearance = { gridLines: true, rowHeight: 'comfortable' } as const

    // Act
    applyDisplaySettings(root, appearance)

    // Assert
    expect(root.getAttribute('data-row-height')).toBe('comfortable')
  })

  it('行の高さを詰めると data-row-height 属性が外れる', () => {
    // Arrange
    root.setAttribute('data-row-height', 'comfortable')

    // Act
    applyDisplaySettings(root, { gridLines: true, rowHeight: 'compact' })

    // Assert
    expect(root.hasAttribute('data-row-height')).toBe(false)
  })
})

describe('applyAppearance', () => {
  it('既定の外観設定では属性が 1 つも付かない', () => {
    // Arrange
    const root = document.createElement('html')

    // Act
    applyAppearance(root, defaultAppearance)

    // Assert
    expect(root.attributes.length).toBe(0)
  })

  it('テーマと表示設定を同時に反映できる', () => {
    // Arrange
    const root = document.createElement('html')
    const appearance: Appearance = {
      theme: 'dark',
      gridLines: false,
      rowHeight: 'comfortable',
    }

    // Act
    applyAppearance(root, appearance)

    // Assert
    expect(root.getAttribute('data-theme')).toBe('dark')
    expect(root.getAttribute('data-grid-lines')).toBe('off')
    expect(root.getAttribute('data-row-height')).toBe('comfortable')
  })
})
