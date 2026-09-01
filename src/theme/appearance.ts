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

/** 外観に関する利用者設定のまとまり。 */
export interface Appearance {
  theme: ThemePreference
  /** 結果テーブルに罫線を引くか。デザインの `showGridLines` に対応する。 */
  gridLines: boolean
  rowHeight: RowHeight
}

/** 設定画面で何も変更していない状態の既定値。デザインの初期値に合わせてある。 */
export const defaultAppearance: Appearance = {
  theme: 'system',
  gridLines: true,
  rowHeight: 'compact',
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
 * 外観設定をまとめてルート要素へ反映する。
 *
 * @param root 反映先のルート要素
 * @param appearance 適用する外観設定
 */
export function applyAppearance(root: HTMLElement, appearance: Appearance): void {
  applyTheme(root, appearance.theme)
  applyDisplaySettings(root, appearance)
}
