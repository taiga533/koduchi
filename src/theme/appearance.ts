/**
 * 外観設定をルート要素の属性へ反映する（ADR 0008）。
 *
 * テーマと表示設定は CSS 変数の切り替えだけで完結する。ここではその引き金と
 * なる属性の付け外しだけを担い、色や寸法の値は `tokens.css` に閉じ込める。
 */

/** テーマの選択。`system` は `prefers-color-scheme` に追従する。 */
export type ThemePreference = 'system' | 'light' | 'dark'

/** 結果テーブルの行の高さ。デザインの `compactRows` プロパティに対応する。 */
export type RowHeight = 'compact' | 'comfortable'

/**
 * エディタの文字の大きさ。
 *
 * テーマ・行の高さ・罫線と同じく**段階を決め打ちにする**。任意の数値を受けると
 * 上限と下限の防御と、手で書き換えられた `settings.toml` の検証が要る。段階なら
 * 知らない綴りを既定へ落とすだけで済む（`parseEditorFontSize`）。
 *
 * ピクセル値は持たない。実際の大きさは `theme/tokens.css` の `--fs-editor` が
 * 決める（ADR 0008。色や寸法の値はコンポーネントへ書かない）。
 */
export type EditorFontSize = 'small' | 'medium' | 'large' | 'xlarge'

/** 選べる大きさ。設定画面のセグメントの並び順でもある。 */
export const EDITOR_FONT_SIZES: readonly EditorFontSize[] = [
  'small',
  'medium',
  'large',
  'xlarge',
] as const

/** 外観に関する利用者設定のまとまり。 */
export interface Appearance {
  theme: ThemePreference
  /** 結果テーブルに罫線を引くか。デザインの `showGridLines` に対応する。 */
  gridLines: boolean
  rowHeight: RowHeight
  editorFontSize: EditorFontSize
}

/** 設定画面で何も変更していない状態の既定値。デザインの初期値に合わせてある。 */
export const defaultAppearance: Appearance = {
  theme: 'system',
  gridLines: true,
  rowHeight: 'compact',
  editorFontSize: 'medium',
}

/**
 * 保存された文字列を文字の大きさへ読み直す。
 *
 * `settings.toml` は利用者が手で書き換えられるファイルであり、この項目を持たない
 * 古いファイルもある。知らない綴りと欠落はどちらも既定（`medium`）へ落とす。
 *
 * @param value 保存されていた綴り。項目が無ければ `undefined`
 */
export function parseEditorFontSize(value: string | undefined): EditorFontSize {
  return EDITOR_FONT_SIZES.find((size) => size === value) ?? defaultAppearance.editorFontSize
}

/**
 * テーマの選択をルート要素へ反映する。
 *
 * `system` のときは属性そのものを外す。これにより `tokens.css` の
 * `prefers-color-scheme` 側の定義が効き、OS の設定に追従する。
 *
 * @param root 反映先のルート要素（通常は `document.documentElement`）
 * @param theme 適用するテーマの選択
 */
export function applyTheme(root: HTMLElement, theme: ThemePreference): void {
  if (theme === 'system') {
    root.removeAttribute('data-theme')
    return
  }
  root.setAttribute('data-theme', theme)
}

/**
 * 罫線と行の高さの設定をルート要素へ反映する。
 *
 * どちらも既定値のときは属性を付けない。CSS 側は属性が無い状態を既定として
 * 書いてあるため、付け外しの結果が設定値と一対一で対応する。
 *
 * @param root 反映先のルート要素
 * @param appearance 罫線と行の高さを含む外観設定
 */
export function applyDisplaySettings(
  root: HTMLElement,
  appearance: Pick<Appearance, 'gridLines' | 'rowHeight'>,
): void {
  if (appearance.gridLines) {
    root.removeAttribute('data-grid-lines')
  } else {
    root.setAttribute('data-grid-lines', 'off')
  }

  if (appearance.rowHeight === 'compact') {
    root.removeAttribute('data-row-height')
  } else {
    root.setAttribute('data-row-height', 'comfortable')
  }
}

/**
 * エディタの文字の大きさをルート要素へ反映する。
 *
 * 既定（`medium`）のときは属性を付けない。`tokens.css` は属性が無い状態を既定と
 * して書いてあるため、付け外しの結果が設定値と一対一で対応する。
 *
 * @param root 反映先のルート要素
 * @param fontSize 適用する文字の大きさ
 */
export function applyEditorFontSize(root: HTMLElement, fontSize: EditorFontSize): void {
  if (fontSize === defaultAppearance.editorFontSize) {
    root.removeAttribute('data-editor-font-size')
    return
  }
  root.setAttribute('data-editor-font-size', fontSize)
}

/**
 * 外観設定をまとめてルート要素へ反映する。
 *
 * @param root 反映先のルート要素
 * @param appearance 適用する外観設定
 */
export function applyAppearance(root: HTMLElement, appearance: Appearance): void {
  applyTheme(root, appearance.theme)
  applyDisplaySettings(root, appearance)
  applyEditorFontSize(root, appearance.editorFontSize)
}
