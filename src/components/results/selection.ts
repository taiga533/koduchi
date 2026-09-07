/**
 * 結果テーブルのセル選択と、選択範囲をクリップボードへ載せる文字列の組み立て。
 *
 * 描画から切り離した純粋な関数だけを置く。選択の状態は `ResultTable` の中に閉じる
 * ため（打鍵ごとにアプリ全体が描き直らないようにするため）、ここには状態を持たない。
 */

import type { Cell, Column } from '../../types/db'
import { displayText } from './cellText'

/** セル 1 つの位置。どちらも 0 始まり。 */
export interface CellPosition {
  row: number
  column: number
}

/**
 * 矩形のセル選択。
 *
 * `anchor` は選択を始めた角、`focus` は今のカーソル位置。`⇧` + クリックや
 * `⇧` + 矢印は `anchor` を据え置いたまま `focus` だけを動かす。
 */
export interface CellSelection {
  anchor: CellPosition
  focus: CellPosition
}

/** 上下左右の端を正規化した選択範囲。両端を含む。 */
export interface SelectionRange {
  top: number
  bottom: number
  left: number
  right: number
}

/** 選択範囲の外枠のうち、そのセルが担う辺。 */
export interface CellEdges {
  top: boolean
  right: boolean
  bottom: boolean
  left: boolean
}

/**
 * 値を範囲内へ収める。
 *
 * @param value 収める値
 * @param min 下限
 * @param max 上限
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * 選択を上下左右の端へ正規化する。
 *
 * `anchor` と `focus` の前後関係は操作の向きで入れ替わるため、描画とコピーは
 * どちらもこの正規化した範囲を見る。
 *
 * @param selection 正規化する選択
 */
export function selectionRange(selection: CellSelection): SelectionRange {
  const { anchor, focus } = selection
  return {
    top: Math.min(anchor.row, focus.row),
    bottom: Math.max(anchor.row, focus.row),
    left: Math.min(anchor.column, focus.column),
    right: Math.max(anchor.column, focus.column),
  }
}

/**
 * セルが選択範囲に入っているかを判定する。
 *
 * @param range 正規化した選択範囲
 * @param row 行番号（0 始まり）
 * @param column 列番号（0 始まり）
 */
export function isSelected(range: SelectionRange, row: number, column: number): boolean {
  return row >= range.top && row <= range.bottom && column >= range.left && column <= range.right
}

/**
 * セルが選択範囲の外枠のどの辺を担うかを返す。
 *
 * 範囲の外側なら 4 辺とも偽を返す。
 *
 * @param range 正規化した選択範囲
 * @param row 行番号（0 始まり）
 * @param column 列番号（0 始まり）
 */
export function selectionEdges(range: SelectionRange, row: number, column: number): CellEdges {
  if (!isSelected(range, row, column)) {
    return { top: false, right: false, bottom: false, left: false }
  }
  return {
    top: row === range.top,
    right: column === range.right,
    bottom: row === range.bottom,
    left: column === range.left,
  }
}

/**
 * 外枠を描く `box-shadow` の値を組み立てる。
 *
 * 罫線を `border` で足すと 1px ぶん内容がずれる。レイアウトに影響しない内側の影で
 * 引く。色は値を書かず `--ac`（アクセント）のトークンを参照する（ADR 0008）。
 *
 * @param edges そのセルが担う辺
 */
export function selectionShadow(edges: CellEdges): string | undefined {
  const parts: string[] = []
  if (edges.top) {
    parts.push('inset 0 1px 0 0 var(--ac)')
  }
  if (edges.right) {
    parts.push('inset -1px 0 0 0 var(--ac)')
  }
  if (edges.bottom) {
    parts.push('inset 0 -1px 0 0 var(--ac)')
  }
  if (edges.left) {
    parts.push('inset 1px 0 0 0 var(--ac)')
  }
  return parts.length === 0 ? undefined : parts.join(', ')
}

/** 選択を動かすキー。 */
export type MoveKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End'

/**
 * キー入力が選択を動かすものかを判定する。
 *
 * @param key `KeyboardEvent.key` の値
 */
export function isMoveKey(key: string): key is MoveKey {
  return (
    key === 'ArrowUp' ||
    key === 'ArrowDown' ||
    key === 'ArrowLeft' ||
    key === 'ArrowRight' ||
    key === 'Home' ||
    key === 'End'
  )
}

/**
 * キー入力で選択を動かす。
 *
 * 表の端では止まる。`extend` が真なら `anchor` を据え置いて範囲を伸ばし、偽なら
 * 移動先の 1 セルだけの選択にする。
 *
 * @param selection 今の選択
 * @param key 押されたキー
 * @param extend `⇧` を伴うか
 * @param rowCount 表示中の行数
 * @param columnCount 列数
 */
export function moveSelection(
  selection: CellSelection,
  key: MoveKey,
  extend: boolean,
  rowCount: number,
  columnCount: number,
): CellSelection {
  const { row, column } = selection.focus
  const moved: CellPosition = (() => {
    switch (key) {
      case 'ArrowUp':
        return { row: row - 1, column }
      case 'ArrowDown':
        return { row: row + 1, column }
      case 'ArrowLeft':
        return { row, column: column - 1 }
      case 'ArrowRight':
        return { row, column: column + 1 }
      case 'Home':
        return { row, column: 0 }
      case 'End':
        return { row, column: columnCount - 1 }
    }
  })()

  const focus: CellPosition = {
    row: clamp(moved.row, 0, Math.max(rowCount - 1, 0)),
    column: clamp(moved.column, 0, Math.max(columnCount - 1, 0)),
  }
  return { anchor: extend ? selection.anchor : focus, focus }
}

/** 行全体を選ぶ選択を作る。行番号の列をクリックしたときに使う。 */
export function rowSelection(row: number, columnCount: number): CellSelection {
  return { anchor: { row, column: 0 }, focus: { row, column: Math.max(columnCount - 1, 0) } }
}

/** 表示中の全行・全列を選ぶ選択を作る（`⌘A`）。 */
export function selectAll(rowCount: number, columnCount: number): CellSelection {
  return {
    anchor: { row: 0, column: 0 },
    focus: { row: Math.max(rowCount - 1, 0), column: Math.max(columnCount - 1, 0) },
  }
}

/** 列 1 本を丸ごと選ぶ選択を作る（右クリックの「この列をコピー」）。 */
export function columnSelection(column: number, rowCount: number): CellSelection {
  return { anchor: { row: 0, column }, focus: { row: Math.max(rowCount - 1, 0), column } }
}

/**
 * 選択範囲をクリップボードへ載せる文字列に組み立てる。
 *
 * 区切りはタブ、行区切りは `\n`。値は画面と同じ規則で、NULL は `NULL` になる。
 * 表計算ソフトがそのまま列に分けて受け取れる形である。
 *
 * @param columns 結果セットの列
 * @param rows 取得済みの行
 * @param range 正規化した選択範囲
 * @param withHeader 列見出しを 1 行目に付けるか（`⇧⌘C`）
 */
export function buildCopyText(
  columns: Column[],
  rows: Cell[][],
  range: SelectionRange,
  withHeader: boolean,
): string {
  const lines: string[] = []

  if (withHeader) {
    const names: string[] = []
    for (let column = range.left; column <= range.right; column += 1) {
      names.push(columns[column]?.name ?? '')
    }
    lines.push(names.join('\t'))
  }

  for (let row = range.top; row <= range.bottom; row += 1) {
    const cells = rows[row]
    if (!cells) {
      continue
    }
    const values: string[] = []
    for (let column = range.left; column <= range.right; column += 1) {
      const cell = cells[column]
      values.push(cell ? displayText(cell) : '')
    }
    lines.push(values.join('\t'))
  }

  return lines.join('\n')
}
