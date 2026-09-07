import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDbApi, setDbApi } from '../api/db'
import { createFakeDbApi, type FakeCalls } from '../test/fakeDbApi'
import { defaultAppearance } from '../theme/appearance'
import { defaultCsvOptions } from '../types/db'
import {
  EDITOR_HEIGHT_DEFAULT,
  EDITOR_HEIGHT_MIN,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from '../components/layout/paneSizes'
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
    resultColumnWidths: {},
    sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
    editorHeight: EDITOR_HEIGHT_DEFAULT,
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

  it('結果テーブルの列幅を列名ごとに覚える', () => {
    // Arrange
    // 既定では何も覚えていない

    // Act
    useUiStore.getState().setResultColumnWidth('tab-1', 'ID', 220)

    // Assert
    expect(useUiStore.getState().resultColumnWidths).toEqual({ 'tab-1': { ID: 220 } })
  })

  it('列幅はタブごとに分かれて覚えられる', () => {
    // Arrange
    useUiStore.getState().setResultColumnWidth('tab-1', 'ID', 220)

    // Act
    useUiStore.getState().setResultColumnWidth('tab-2', 'ID', 90)

    // Assert
    expect(useUiStore.getState().resultColumnWidths).toEqual({
      'tab-1': { ID: 220 },
      'tab-2': { ID: 90 },
    })
  })

  it('列幅を覚えても設定ファイルへは書かない', () => {
    // Arrange
    // 保存の呼び出しはまだ無い

    // Act
    useUiStore.getState().setResultColumnWidth('tab-1', 'ID', 220)

    // Assert
    expect(calls.saveAppSettings).toHaveLength(0)
  })

  it('タブを閉じるとそのタブの列幅を忘れる', () => {
    // Arrange
    useUiStore.getState().setResultColumnWidth('tab-1', 'ID', 220)
    useUiStore.getState().setResultColumnWidth('tab-2', 'ID', 90)

    // Act
    useUiStore.getState().clearResultColumnWidths('tab-1')

    // Assert
    expect(useUiStore.getState().resultColumnWidths).toEqual({ 'tab-2': { ID: 90 } })
  })

  it('覚えていないタブを忘れさせても何も変わらない', () => {
    // Arrange
    useUiStore.getState().setResultColumnWidth('tab-1', 'ID', 220)
    const 前 = useUiStore.getState().resultColumnWidths

    // Act
    useUiStore.getState().clearResultColumnWidths('tab-9')

    // Assert
    expect(useUiStore.getState().resultColumnWidths).toBe(前)
  })
})

describe('ペインの寸法', () => {
  it('サイドバーの幅を変えられる', () => {
    // Arrange
    // beforeEach で既定値に戻してある

    // Act
    useUiStore.getState().setSidebarWidth(320)

    // Assert
    expect(useUiStore.getState().sidebarWidth).toBe(320)
  })

  it('サイドバーの幅は下限と上限へ丸められる', () => {
    // Arrange
    // Act
    useUiStore.getState().setSidebarWidth(SIDEBAR_WIDTH_MAX + 200)
    const 上限 = useUiStore.getState().sidebarWidth
    useUiStore.getState().setSidebarWidth(SIDEBAR_WIDTH_MIN - 200)
    const 下限 = useUiStore.getState().sidebarWidth

    // Assert
    expect(上限).toBe(SIDEBAR_WIDTH_MAX)
    expect(下限).toBe(SIDEBAR_WIDTH_MIN)
  })

  it('エディタの高さはウィンドウの高さに応じて丸められる', () => {
    // Arrange
    const ウィンドウの高さ = 600

    // Act
    useUiStore.getState().setEditorHeight(900, ウィンドウの高さ)

    // Assert
    expect(useUiStore.getState().editorHeight).toBe(400)
  })

  it('ウィンドウを縮めるとエディタの高さも上限まで下がる', () => {
    // Arrange
    useUiStore.getState().setEditorHeight(500, 1000)

    // Act
    useUiStore.getState().clampToWindow(500)

    // Assert
    expect(useUiStore.getState().editorHeight).toBe(300)
  })

  it('ウィンドウを広げても高さは勝手に増えない', () => {
    // Arrange
    useUiStore.getState().setEditorHeight(300, 1000)

    // Act
    useUiStore.getState().clampToWindow(1200)

    // Assert
    expect(useUiStore.getState().editorHeight).toBe(300)
  })

  it('セッションから読んだ寸法を反映できる', () => {
    // Arrange
    // Act
    useUiStore.getState().restoreLayout({ sidebarWidth: 300, editorHeight: 200 }, 900)

    // Assert
    expect(useUiStore.getState().sidebarWidth).toBe(300)
    expect(useUiStore.getState().editorHeight).toBe(200)
  })

  it('寸法を持たない古いセッションでは既定値のままになる', () => {
    // Arrange
    // Act
    useUiStore.getState().restoreLayout({ sidebarWidth: null, editorHeight: null }, 900)

    // Assert
    expect(useUiStore.getState().sidebarWidth).toBe(SIDEBAR_WIDTH_DEFAULT)
    expect(useUiStore.getState().editorHeight).toBe(EDITOR_HEIGHT_DEFAULT)
  })

  it('復元した寸法も下限を割らない', () => {
    // Arrange
    // Act
    useUiStore.getState().restoreLayout({ sidebarWidth: 10, editorHeight: 10 }, 900)

    // Assert
    expect(useUiStore.getState().sidebarWidth).toBe(SIDEBAR_WIDTH_MIN)
    expect(useUiStore.getState().editorHeight).toBe(EDITOR_HEIGHT_MIN)
  })
})
