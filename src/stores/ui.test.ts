import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDbApi, setDbApi } from '../api/db'
import { createFakeDbApi, type FakeCalls } from '../test/fakeDbApi'
import { defaultAppearance } from '../theme/appearance'
import { defaultCsvOptions } from '../types/db'
import { useUiStore } from './ui'

let calls: FakeCalls

beforeEach(() => {
  const fake = createFakeDbApi()
  calls = fake.calls
  setDbApi(fake.api)
  useUiStore.setState({
    appearance: defaultAppearance,
    csvOptions: defaultCsvOptions,
    settingsOpen: false,
    sidebarSegment: 'schema',
    resultTab: 'result',
  })
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-grid-lines')
  document.documentElement.removeAttribute('data-row-height')
})

afterEach(() => {
  resetDbApi()
})

describe('useUiStore', () => {
  it('テーマを変えるとルート要素へ反映され保存される', () => {
    // Arrange
    // beforeEach で属性を消してある

    // Act
    useUiStore.getState().setTheme('dark')

    // Assert
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(calls.saveAppSettings[0].appearance.theme).toBe('dark')
  })

  it('罫線を消すと属性が付き保存される', () => {
    // Arrange
    // 既定では罫線あり

    // Act
    useUiStore.getState().setGridLines(false)

    // Assert
    expect(document.documentElement.getAttribute('data-grid-lines')).toBe('off')
    expect(calls.saveAppSettings[0].appearance.gridLines).toBe(false)
  })

  it('行の高さを変えると属性が付き保存される', () => {
    // Arrange
    // 既定はつめた行

    // Act
    useUiStore.getState().setRowHeight('comfortable')

    // Assert
    expect(document.documentElement.getAttribute('data-row-height')).toBe('comfortable')
    expect(calls.saveAppSettings[0].appearance.rowHeight).toBe('comfortable')
  })

  it('csv の書式を変えると次回のために保存される', () => {
    // Arrange
    const options = {
      delimiter: 'tab' as const,
      encoding: 'utf8' as const,
      nullText: 'word' as const,
    }

    // Act
    useUiStore.getState().setCsvOptions(options)

    // Assert
    expect(useUiStore.getState().csvOptions).toEqual(options)
    expect(calls.saveAppSettings[0].csv).toEqual(options)
  })

  it('保存済みの設定を読み込むと反映される', async () => {
    // Arrange
    setDbApi(
      createFakeDbApi({
        appSettings: {
          appearance: { theme: 'light', gridLines: false, rowHeight: 'comfortable' },
          csv: { delimiter: 'semicolon', encoding: 'shiftJis', nullText: 'backslash' },
        },
      }).api,
    )

    // Act
    await useUiStore.getState().loadSettings()

    // Assert
    expect(useUiStore.getState().appearance).toEqual({
      theme: 'light',
      gridLines: false,
      rowHeight: 'comfortable',
    })
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(useUiStore.getState().csvOptions.encoding).toBe('shiftJis')
  })

  it('設定が読めなくても既定値のまま動く', async () => {
    // Arrange
    setDbApi({
      ...createFakeDbApi().api,
      loadAppSettings: async () => {
        throw new Error('読めません')
      },
    })

    // Act
    await useUiStore.getState().loadSettings()

    // Assert
    expect(useUiStore.getState().appearance).toEqual(defaultAppearance)
  })

  it('設定画面の開閉を持つ', () => {
    // Arrange
    // 既定は閉じている

    // Act
    useUiStore.getState().openSettings()

    // Assert
    expect(useUiStore.getState().settingsOpen).toBe(true)
    useUiStore.getState().closeSettings()
    expect(useUiStore.getState().settingsOpen).toBe(false)
  })
})
