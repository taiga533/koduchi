/**
 * 結果テーブルのセル表示に関する純粋な判定。
 *
 * デザインに指定の無い NULL の見せ方（ADR 0008）と、数値の右寄せ判定をここに
 * まとめる。描画から切り離してあるため単体でテストできる。
 */

import type { Cell, CellKind } from '../../types/db'

/** NULL のセルに出す文字列。空文字列と見分けるための表示（ADR 0008）。 */
export const NULL_LABEL = 'NULL'

/**
 * セルの中身を右寄せにするかを判定する。
 *
 * 数値だけを右寄せにする。日時は桁が揃っているため左寄せのままでよい。
 *
 * @param kind セルの種類
 */
export function isRightAligned(kind: CellKind): boolean {
  return kind === 'number'
}

/**
 * セルに表示する文字列を決める。
 *
 * NULL は空文字列と区別できるよう `NULL` と表示する。
 *
 * @param cell 表示するセル
 */
export function displayText(cell: Cell): string {
  return cell.kind === 'null' ? NULL_LABEL : cell.text
}

/**
 * 列が縮んでよい下限の幅（ピクセル）。
 *
 * 数値は桁数が読めるよう狭めに、文字列は広めにとる。ここで決めた下限の合計が、
 * 結果テーブルが横スクロールを始める幅になる。
 *
 * @param kind 列の種類
 */
export function columnMinWidth(kind: CellKind): number {
  switch (kind) {
    case 'number':
      return 110
    case 'datetime':
      return 180
    case 'bool':
      return 80
    case 'binary':
      return 140
    default:
      return 160
  }
}

/**
 * 列幅を決める。
 *
 * テーブルの `grid-template-columns` に使う。文字列の列だけは、余った幅を
 * 分け合って伸びるようにする。
 *
 * @param kind 列の種類
 */
export function columnWidth(kind: CellKind): string {
  const min = columnMinWidth(kind)
  return kind === 'text' || kind === 'null' ? `minmax(${min}px, 1fr)` : `${min}px`
}

/**
 * 結果テーブル全体の最小幅を求める。
 *
 * 見出しと本文は別々のスクロール領域に置くため、同じ幅を明示して桁を揃える必要が
 * ある。行番号の列ぶんも足し込む。
 *
 * @param kinds 各列の種類
 * @param rowNumberWidth 行番号の列の幅（ピクセル）
 */
export function tableMinWidth(kinds: CellKind[], rowNumberWidth: number): number {
  return kinds.reduce((total, kind) => total + columnMinWidth(kind), rowNumberWidth)
}
