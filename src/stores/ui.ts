/**
 * 画面の見た目に関する状態を持つストア。
 *
 * サイドバーの選択セグメントと外観設定（ADR 0008）、ペインの寸法、および設定画面と
 * CSV 保存ダイアログの開閉を扱う。外観設定はルート要素の属性へ反映し、同時に
 * ファイルへ保存する。CSV の書式も「次回のために保存する」対象である。
 *
 * ペインの寸法（サイドバーの幅・エディタの高さ）だけは `settings.toml` ではなく
 * ウィンドウごとのセッションへ保存する（ADR 0005）。ウィンドウごとに違ってよい
 * 値だからである。書き出しは `App` の `SessionSaver` が担う。
 */

import { create } from 'zustand'
import { getDbApi } from '../api/db'
import {
  EDITOR_HEIGHT_DEFAULT,
  SIDEBAR_WIDTH_DEFAULT,
  clampEditorHeight,
  clampSidebarWidth,
} from '../components/layout/paneSizes'
import type { Appearance, RowHeight, ThemePreference } from '../theme/appearance'
import { applyAppearance, defaultAppearance } from '../theme/appearance'
import type { AppSettings, CsvOptions } from '../types/db'
import { defaultCsvOptions } from '../types/db'

/** サイドバーのセグメント。 */
export type SidebarSegment = 'schema' | 'history' | 'saved'

/** 結果ペインのタブ。 */
export type ResultTab = 'result' | 'messages' | 'plan'

/** エディタのカーソル位置。ステータスバーに出す。 */
export interface CursorPosition {
  /** 1 始まりの行番号。 */
  line: number
  /** 1 始まりの桁。 */
  column: number
}

interface UiState {
  sidebarSegment: SidebarSegment
  resultTab: ResultTab
  /**
   * エディタのカーソル位置。
   *
   * ステータスバーと実行ボタンだけが見る。打鍵のたびにアプリ全体を描き直すと
   * 結果テーブルまで巻き込まれるため、値をここへ逃がしてある。
   */
  cursor: CursorPosition
  /** 選択範囲があるか。「選択範囲のみ実行」を押せるかの判定に使う。 */
  hasSelection: boolean
  /** サイドバーの幅（px）。 */
  sidebarWidth: number
  /** エディタの高さ（px）。 */
  editorHeight: number
  appearance: Appearance
  csvOptions: CsvOptions
  /** 設定画面を開いているか。 */
  settingsOpen: boolean
  /**
   * 結果テーブルで手を入れた列幅。タブ ID → 列名 → 幅（ピクセル）。
   *
   * 列名をキーにするため、同じクエリを実行し直しても幅が保たれる。設定ファイルや
   * セッション（ADR 0005）へは保存しない。再起動すれば既定の幅に戻る。
   */
  resultColumnWidths: Record<string, Record<string, number>>

  selectSidebarSegment: (segment: SidebarSegment) => void
  selectResultTab: (tab: ResultTab) => void
  /** カーソル位置を伝える。値が変わらなければ何もしない。 */
  setCursor: (cursor: CursorPosition, hasSelection: boolean) => void
  setTheme: (theme: ThemePreference) => void
  setGridLines: (gridLines: boolean) => void
  setRowHeight: (rowHeight: RowHeight) => void
  setCsvOptions: (options: CsvOptions) => void
  /** 結果テーブルの列幅を覚える。 */
  setResultColumnWidth: (tabId: string, columnName: string, width: number) => void
  /** タブぶんの列幅を忘れる。タブを閉じたときに呼ぶ。 */
  clearResultColumnWidths: (tabId: string) => void
  /** サイドバーの幅を変える。値は許される範囲へ丸める。 */
  setSidebarWidth: (width: number) => void
  /**
   * エディタの高さを変える。値は許される範囲へ丸める。
   *
   * 上限はウィンドウの高さに依存するため、丸めに使う高さを受け取る。
   */
  setEditorHeight: (height: number, windowHeight: number) => void
  /**
   * ウィンドウの高さが変わったときに、寸法を今の上限へ丸め直す。
   *
   * ウィンドウを縮めたときにエディタが画面を埋め尽くさないようにする。
   */
  clampToWindow: (windowHeight: number) => void
  /** セッションから読んだ寸法を反映する。持っていない値は既定値のままにする。 */
  restoreLayout: (
    layout: { sidebarWidth: number | null; editorHeight: number | null },
    windowHeight: number,
  ) => void
  openSettings: () => void
  closeSettings: () => void
  /** 保存済みの設定を読み込んで反映する。起動時に 1 度呼ぶ。 */
  loadSettings: () => Promise<void>
}

/**
 * 外観設定をルート要素へ反映する。
 *
 * jsdom でも `document` は存在するため、テストでも同じ経路が使える。
 */
function reflect(appearance: Appearance): void {
  applyAppearance(document.documentElement, appearance)
}

/**
 * 保存する形へ変換する。
 *
 * `theme` と `rowHeight` は Rust 側では文字列として扱う。値の意味を知っているのは
 * フロントエンドだけである。
 */
function toSettings(appearance: Appearance, csv: CsvOptions): AppSettings {
  return {
    appearance: {
      theme: appearance.theme,
      gridLines: appearance.gridLines,
      rowHeight: appearance.rowHeight,
    },
    csv,
  }
}

/**
 * 設定をファイルへ書く。
 *
 * 書き込みに失敗しても画面の見た目は既に変わっている。設定の保存に失敗したことで
 * 操作を巻き戻すほうが分かりにくいため、失敗は握りつぶす。
 */
function persist(appearance: Appearance, csv: CsvOptions): void {
  void getDbApi()
    .saveAppSettings(toSettings(appearance, csv))
    .catch(() => {})
}

export const useUiStore = create<UiState>((set, get) => ({
  sidebarSegment: 'schema',
  resultTab: 'result',
  cursor: { line: 1, column: 1 },
  hasSelection: false,
  sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
  editorHeight: EDITOR_HEIGHT_DEFAULT,
  appearance: defaultAppearance,
  csvOptions: defaultCsvOptions,
  settingsOpen: false,
  resultColumnWidths: {},

  selectSidebarSegment: (segment) => set({ sidebarSegment: segment }),
  selectResultTab: (tab) => set({ resultTab: tab }),

  setCursor: (cursor, hasSelection) =>
    set((state) => {
      // 同じ位置での再設定で購読側を描き直さない。
      if (
        state.cursor.line === cursor.line &&
        state.cursor.column === cursor.column &&
        state.hasSelection === hasSelection
      ) {
        return state
      }
      return { cursor, hasSelection }
    }),

  setTheme: (theme) =>
    set((state) => {
      const appearance = { ...state.appearance, theme }
      reflect(appearance)
      persist(appearance, state.csvOptions)
      return { appearance }
    }),

  setGridLines: (gridLines) =>
    set((state) => {
      const appearance = { ...state.appearance, gridLines }
      reflect(appearance)
      persist(appearance, state.csvOptions)
      return { appearance }
    }),

  setRowHeight: (rowHeight) =>
    set((state) => {
      const appearance = { ...state.appearance, rowHeight }
      reflect(appearance)
      persist(appearance, state.csvOptions)
      return { appearance }
    }),

  setCsvOptions: (csvOptions) =>
    set((state) => {
      persist(state.appearance, csvOptions)
      return { csvOptions }
    }),

  setResultColumnWidth: (tabId, columnName, width) =>
    set((state) => ({
      resultColumnWidths: {
        ...state.resultColumnWidths,
        [tabId]: { ...state.resultColumnWidths[tabId], [columnName]: width },
      },
    })),

  clearResultColumnWidths: (tabId) =>
    set((state) => {
      if (!(tabId in state.resultColumnWidths)) {
        return state
      }
      const rest = Object.fromEntries(
        Object.entries(state.resultColumnWidths).filter(([id]) => id !== tabId),
      )
      return { resultColumnWidths: rest }
    }),

  setSidebarWidth: (width) => set({ sidebarWidth: clampSidebarWidth(width) }),

  setEditorHeight: (height, windowHeight) =>
    set({ editorHeight: clampEditorHeight(height, windowHeight) }),

  clampToWindow: (windowHeight) =>
    set((state) => {
      const editorHeight = clampEditorHeight(state.editorHeight, windowHeight)
      // 丸めが効かないときは同じ状態を返し、購読側を描き直さない。
      return editorHeight === state.editorHeight ? state : { editorHeight }
    }),

  restoreLayout: (layout, windowHeight) =>
    set((state) => ({
      sidebarWidth:
        layout.sidebarWidth === null ? state.sidebarWidth : clampSidebarWidth(layout.sidebarWidth),
      editorHeight:
        layout.editorHeight === null
          ? clampEditorHeight(state.editorHeight, windowHeight)
          : clampEditorHeight(layout.editorHeight, windowHeight),
    })),

  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),

  loadSettings: async () => {
    try {
      const settings = await getDbApi().loadAppSettings()
      const appearance: Appearance = {
        theme: (settings.appearance.theme as ThemePreference) ?? defaultAppearance.theme,
        gridLines: settings.appearance.gridLines,
        rowHeight: (settings.appearance.rowHeight as RowHeight) ?? defaultAppearance.rowHeight,
      }
      reflect(appearance)
      set({ appearance, csvOptions: settings.csv })
    } catch {
      // 設定が読めなくても既定値で動く。起動を止める理由にはしない。
      reflect(get().appearance)
    }
  },
}))
