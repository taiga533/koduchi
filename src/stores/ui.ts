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
import type { Appearance, EditorFontSize, RowHeight, ThemePreference } from '../theme/appearance'
import { applyAppearance, defaultAppearance, parseEditorFontSize } from '../theme/appearance'
import type { KeybindingOverrides } from '../keybindings/bindings'
import type { FrozenColumn } from '../components/results/columnSizing'
import type { ResultDisplay, ResultDisplayOverride } from '../components/results/resultDisplay'
import {
  applyOverride,
  defaultResultDisplay,
  parseResultDisplay,
} from '../components/results/resultDisplay'
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
  /**
   * 利用者が割り当て直したキー（ADR 0037）。既定との差分だけを持つ。
   *
   * 解決（既定と重ね、重なりを除く）はここではしない。既定はコマンドの表
   * （仲介者）が持ち、ストアは仲介者を import しないためである。
   */
  keybindings: KeybindingOverrides
  /** 設定画面を開いているか。 */
  settingsOpen: boolean
  /**
   * セッションとロックのパネルを開いているか（ADR 0017）。
   *
   * 閉じるとパネルごと消えるため、自動更新の間隔も一緒に止まる。
   */
  sessionsOpen: boolean
  /**
   * オブジェクトのソース検索のパネルを開いているか（ADR 0021）。
   *
   * 検索条件と結果は `sourceSearch` ストアが持つ。ここは開閉だけを預かる。
   */
  sourceSearchOpen: boolean
  /**
   * 結果テーブルで手を入れた列幅。タブ ID → 列名 → 幅（ピクセル）。
   *
   * 列名をキーにするため、同じクエリを実行し直しても幅が保たれる。設定ファイルや
   * セッション（ADR 0005）へは保存しない。再起動すれば既定の幅に戻る。
   */
  resultColumnWidths: Record<string, Record<string, number>>
  /** 結果テーブルの表示調整の既定（ADR 0048）。`settings.toml` へ保存する。 */
  resultDisplayDefaults: ResultDisplay
  /**
   * 結果タブのヘッダーで触った表示調整。タブ ID → 既定と違う項目だけ。
   *
   * 列幅と同じ寿命である。再実行をまたいで残し、タブを閉じたら捨て、保存はしない。
   * 「この結果だけ区切って読みたい」は一時的な用事であり、既定を変えたいなら設定
   * 画面がある。
   */
  resultDisplayOverrides: Record<string, ResultDisplayOverride>
  /** 結果テーブルで固定した列の境目。タブ ID → 境目（ADR 0048）。寿命は列幅と同じ。 */
  resultFrozenColumns: Record<string, FrozenColumn>

  selectSidebarSegment: (segment: SidebarSegment) => void
  selectResultTab: (tab: ResultTab) => void
  /** カーソル位置を伝える。値が変わらなければ何もしない。 */
  setCursor: (cursor: CursorPosition, hasSelection: boolean) => void
  setTheme: (theme: ThemePreference) => void
  setGridLines: (gridLines: boolean) => void
  setRowHeight: (rowHeight: RowHeight) => void
  setEditorFontSize: (editorFontSize: EditorFontSize) => void
  setCsvOptions: (options: CsvOptions) => void
  /** キーの割り当ての差分を置き換えて保存する（ADR 0037）。 */
  setKeybindings: (keybindings: KeybindingOverrides) => void
  /** 結果テーブルの列幅を覚える。 */
  setResultColumnWidth: (tabId: string, columnName: string, width: number) => void
  /** 表示調整の既定を変えて保存する。 */
  setResultDisplayDefaults: (patch: Partial<ResultDisplay>) => void
  /** そのタブだけ表示調整を変える。既定と同じ値へ戻した項目は上書きから落ちる。 */
  setResultDisplayOverride: (tabId: string, patch: Partial<ResultDisplay>) => void
  /** そのタブの表示調整を既定へ戻す。 */
  resetResultDisplay: (tabId: string) => void
  /** 列の固定を決める。`null` で解除する。 */
  setResultFrozenColumn: (tabId: string, frozen: FrozenColumn | null) => void
  /**
   * タブぶんの結果の見え方（列幅・表示調整・固定）を忘れる。タブを閉じたときに呼ぶ。
   *
   * 3 つは寿命が同じなので 1 つの入口にまとめ、閉じる関所が 1 つ呼べば済むようにする。
   */
  forgetResultView: (tabId: string) => void
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
  /** セッションとロックのパネルを開く（ADR 0017）。 */
  openSessions: () => void
  /** セッションとロックのパネルを閉じる。 */
  closeSessions: () => void
  /** オブジェクトのソース検索のパネルを開く（`⇧⌘F`、ADR 0021）。 */
  openSourceSearch: () => void
  /** オブジェクトのソース検索のパネルを閉じる。 */
  closeSourceSearch: () => void
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

/** `settings.toml` へ書く値。 */
type SavedSettings = Pick<
  UiState,
  'appearance' | 'csvOptions' | 'keybindings' | 'resultDisplayDefaults'
>

/**
 * 保存する形へ変換する。
 *
 * `theme` / `rowHeight` / `editorFontSize` は Rust 側では文字列として扱う。値の
 * 意味を知っているのはフロントエンドだけである。
 */
function toSettings({
  appearance,
  csvOptions: csv,
  keybindings,
  resultDisplayDefaults,
}: SavedSettings): AppSettings {
  return {
    appearance: {
      theme: appearance.theme,
      gridLines: appearance.gridLines,
      rowHeight: appearance.rowHeight,
      editorFontSize: appearance.editorFontSize,
    },
    resultDisplay: { ...resultDisplayDefaults },
    csv,
    keybindings: { ...keybindings },
  }
}

/**
 * 設定をファイルへ書く。
 *
 * 書き込みに失敗しても画面の見た目は既に変わっている。設定の保存に失敗したことで
 * 操作を巻き戻すほうが分かりにくいため、失敗は握りつぶす。
 */
function persist(settings: SavedSettings): void {
  void getDbApi()
    .saveAppSettings(toSettings(settings))
    .catch(() => {})
}

/**
 * タブ ID を鍵にした表の 1 行を差し替えた表を返す。`undefined` ならその行を消す。
 *
 * タブごとに持つ値（列幅・表示調整・固定）を同じ形で足し引きするため。
 *
 * @param table 元の表
 * @param tabId 差し替えるタブ
 * @param value 新しい値。消すなら `undefined`
 */
function withEntry<T>(
  table: Record<string, T>,
  tabId: string,
  value: T | undefined,
): Record<string, T> {
  if (value !== undefined) {
    return { ...table, [tabId]: value }
  }
  if (!(tabId in table)) {
    return table
  }
  return Object.fromEntries(Object.entries(table).filter(([id]) => id !== tabId))
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
  keybindings: {},
  settingsOpen: false,
  sessionsOpen: false,
  sourceSearchOpen: false,
  resultColumnWidths: {},
  resultDisplayDefaults: defaultResultDisplay,
  resultDisplayOverrides: {},
  resultFrozenColumns: {},

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
      persist({ ...state, appearance })
      return { appearance }
    }),

  setGridLines: (gridLines) =>
    set((state) => {
      const appearance = { ...state.appearance, gridLines }
      reflect(appearance)
      persist({ ...state, appearance })
      return { appearance }
    }),

  setRowHeight: (rowHeight) =>
    set((state) => {
      const appearance = { ...state.appearance, rowHeight }
      reflect(appearance)
      persist({ ...state, appearance })
      return { appearance }
    }),

  setEditorFontSize: (editorFontSize) =>
    set((state) => {
      const appearance = { ...state.appearance, editorFontSize }
      reflect(appearance)
      persist({ ...state, appearance })
      return { appearance }
    }),

  setCsvOptions: (csvOptions) =>
    set((state) => {
      persist({ ...state, csvOptions })
      return { csvOptions }
    }),

  setKeybindings: (keybindings) =>
    set((state) => {
      persist({ ...state, keybindings })
      return { keybindings }
    }),

  setResultColumnWidth: (tabId, columnName, width) =>
    set((state) => ({
      resultColumnWidths: {
        ...state.resultColumnWidths,
        [tabId]: { ...state.resultColumnWidths[tabId], [columnName]: width },
      },
    })),

  setResultDisplayDefaults: (patch) =>
    set((state) => {
      const resultDisplayDefaults = { ...state.resultDisplayDefaults, ...patch }
      persist({ ...state, resultDisplayDefaults })
      // 既定と同じになった上書きを落とし直す。残すと、そのタブだけ既定を変えても
      // 追随しない理由の無い差分が残る。
      const resultDisplayOverrides = Object.fromEntries(
        Object.entries(state.resultDisplayOverrides).flatMap(([tabId, override]) => {
          const kept = applyOverride(resultDisplayDefaults, override, {})
          return kept === undefined ? [] : [[tabId, kept]]
        }),
      )
      return { resultDisplayDefaults, resultDisplayOverrides }
    }),

  setResultDisplayOverride: (tabId, patch) =>
    set((state) => {
      const next = applyOverride(
        state.resultDisplayDefaults,
        state.resultDisplayOverrides[tabId],
        patch,
      )
      return { resultDisplayOverrides: withEntry(state.resultDisplayOverrides, tabId, next) }
    }),

  resetResultDisplay: (tabId) =>
    set((state) =>
      tabId in state.resultDisplayOverrides
        ? { resultDisplayOverrides: withEntry(state.resultDisplayOverrides, tabId, undefined) }
        : state,
    ),

  setResultFrozenColumn: (tabId, frozen) =>
    set((state) => ({
      resultFrozenColumns: withEntry(state.resultFrozenColumns, tabId, frozen ?? undefined),
    })),

  forgetResultView: (tabId) =>
    set((state) => {
      if (
        !(tabId in state.resultColumnWidths) &&
        !(tabId in state.resultDisplayOverrides) &&
        !(tabId in state.resultFrozenColumns)
      ) {
        return state
      }
      return {
        resultColumnWidths: withEntry(state.resultColumnWidths, tabId, undefined),
        resultDisplayOverrides: withEntry(state.resultDisplayOverrides, tabId, undefined),
        resultFrozenColumns: withEntry(state.resultFrozenColumns, tabId, undefined),
      }
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

  openSessions: () => set({ sessionsOpen: true }),
  closeSessions: () => set({ sessionsOpen: false }),

  openSourceSearch: () => set({ sourceSearchOpen: true }),
  closeSourceSearch: () => set({ sourceSearchOpen: false }),

  loadSettings: async () => {
    try {
      const settings = await getDbApi().loadAppSettings()
      const appearance: Appearance = {
        theme: (settings.appearance.theme as ThemePreference) ?? defaultAppearance.theme,
        gridLines: settings.appearance.gridLines,
        rowHeight: (settings.appearance.rowHeight as RowHeight) ?? defaultAppearance.rowHeight,
        editorFontSize: parseEditorFontSize(settings.appearance.editorFontSize),
      }
      reflect(appearance)
      set({
        appearance,
        csvOptions: settings.csv,
        keybindings: settings.keybindings ?? {},
        resultDisplayDefaults: parseResultDisplay(settings.resultDisplay),
      })
    } catch {
      // 設定が読めなくても既定値で動く。起動を止める理由にはしない。
      reflect(get().appearance)
    }
  },
}))
