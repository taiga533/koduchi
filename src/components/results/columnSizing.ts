/**
 * 結果テーブルの列幅に関する純粋な計算。
 *
 * 幅の決め方は 3 通りある。
 *
 * 1. 何もしていない列は型ごとの既定値（`cellText.ts` の `columnMinWidth`）
 * 2. 見出しの右端をドラッグして手で決めた幅
 * 3. 見出しをダブルクリックして内容に合わせた幅
 *
 * 3 の見積りに実寸の測定は使わない。数十万行ぶんのセルを `getBoundingClientRect`
 * で測ると描画が止まるためである。同梱の PlemolJP は等幅で、半角と全角の送り幅が
 * 1:2 に揃っている（`CLAUDE.md` の「書体」節）。全角を 2 文字ぶんとして数えれば、
 * 文字数と 1 文字の送り幅の掛け算で十分な精度の見積りが得られる。
 */

import type { Column } from '../../types/db'
import { columnMinWidth, columnWidth } from './cellText'

/**
 * 半角 1 文字の送り幅（ピクセル）。
 *
 * PlemolJP v3.1.0 の半角字形の送りは 528/1000 em（全角はその 2 倍の 1056/1000
 * em）。結果テーブルの本文は 11.5px であるため `11.5 × 0.528` になる。
 */
export const CHAR_WIDTH = 11.5 * 0.528

/**
 * セルの左右に食われる幅（ピクセル）。
 *
 * `tokens.css` の `--rp`（`4px 9px` / `8px 9px`）の左右 9px ずつと、右の罫線
 * 1px の合計。行の高さを変えても左右のパディングは変わらない。
 */
export const CELL_PADDING = 19

/** 内容に合わせたときの上限（ピクセル）。これ以上は横に広げない。 */
export const MAX_AUTO_WIDTH = 600

/**
 * 列を縮められる下限（ピクセル）。
 *
 * 型ごとの既定値より狭くできないと「今は要らない列を細くして隣を見る」ができない。
 * 見出しが 2〜3 文字読める幅を下限とする。
 */
export const MIN_COLUMN_WIDTH = 48

/** 列名をキーにした幅の対応表。タブごとに持つ。 */
export type ColumnWidths = Record<string, number>

/**
 * 文字列を等幅で並べたときの幅を半角文字数で数える。
 *
 * 全角（East Asian Width の W / F）は 2 文字ぶんとして数える。サロゲートペアを
 * 1 文字として扱うため、コードポイント単位で走査する。
 *
 * @param text 数える文字列
 */
export function displayWidth(text: string): number {
  let width = 0
  for (const char of text) {
    width += isFullWidth(char.codePointAt(0) ?? 0) ? 2 : 1
  }
  return width
}

/**
 * コードポイントが全角かを判定する。
 *
 * East Asian Width が W もしくは F の範囲を並べてある。絵文字は PlemolJP に
 * 字形が無く環境任せの合成になるため、半角として数える（見積りは多少狭くなるが、
 * 手で広げれば済む）。
 *
 * @param code 判定するコードポイント
 */
function isFullWidth(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) || // ハングル字母
    (code >= 0x2e80 && code <= 0x303e) || // CJK 部首・康熙部首・CJK の記号
    (code >= 0x3041 && code <= 0x33ff) || // かな・ハングル・囲み文字
    (code >= 0x3400 && code <= 0x4dbf) || // CJK 拡張 A
    (code >= 0x4e00 && code <= 0x9fff) || // CJK 統合漢字
    (code >= 0xa000 && code <= 0xa4cf) || // イ文字
    (code >= 0xac00 && code <= 0xd7a3) || // ハングル音節
    (code >= 0xf900 && code <= 0xfaff) || // CJK 互換漢字
    (code >= 0xfe10 && code <= 0xfe19) || // 縦書き用の約物
    (code >= 0xfe30 && code <= 0xfe6f) || // CJK 互換形式
    (code >= 0xff00 && code <= 0xff60) || // 全角英数・記号
    (code >= 0xffe0 && code <= 0xffe6) || // 全角の通貨記号
    (code >= 0x20000 && code <= 0x2fffd) || // CJK 拡張 B 以降
    (code >= 0x30000 && code <= 0x3fffd)
  )
}

/**
 * 幅を下限と上限に収める。
 *
 * 手で決めた幅も内容に合わせた幅も同じ範囲に収める。
 *
 * @param width 収めたい幅（ピクセル）
 */
export function clampColumnWidth(width: number): number {
  return Math.round(Math.min(Math.max(width, MIN_COLUMN_WIDTH), MAX_AUTO_WIDTH))
}

/**
 * 内容に合わせた列幅を見積もる。
 *
 * 見出しと値のうち、等幅で並べたときにいちばん長いものが収まる幅を返す。上限は
 * `MAX_AUTO_WIDTH`、下限は `MIN_COLUMN_WIDTH`。
 *
 * @param headerText 列見出しの文字列
 * @param values 走査する値。取得済みの行ぶんだけを渡す
 */
export function autoFitWidth(headerText: string, values: string[]): number {
  let longest = displayWidth(headerText)
  for (const value of values) {
    const width = displayWidth(value)
    if (width > longest) {
      longest = width
    }
  }
  return clampColumnWidth(longest * CHAR_WIDTH + CELL_PADDING)
}

/**
 * 列の既定の下限幅を返す。
 *
 * ドラッグを始めるとき、まだ実寸を測れない場合の出発点に使う。
 *
 * @param column 対象の列
 */
export function columnMinWidthOf(column: Column): number {
  return columnMinWidth(column.kind)
}

/**
 * `grid-template-columns` に渡す 1 列ぶんの指定を決める。
 *
 * 幅を決めていない列は型ごとの既定（文字列は伸縮、それ以外は固定）に従う。
 *
 * @param column 対象の列
 * @param widths 列名をキーにした幅の対応表
 */
export function resolveColumnWidth(column: Column, widths: ColumnWidths): string {
  const width = widths[column.name]
  return width === undefined ? columnWidth(column.kind) : `${width}px`
}

/**
 * 結果テーブル全体の `grid-template-columns` を組み立てる。
 *
 * 見出しと本文は別々のスクロール領域にあるため、同じ文字列を両方へ渡して桁を
 * 揃える（`ResultTable.tsx` のコメント）。
 *
 * @param columns 結果セットの列
 * @param widths 列名をキーにした幅の対応表
 * @param rowNumberWidth 行番号の列の幅（ピクセル）
 */
export function gridTemplate(
  columns: Column[],
  widths: ColumnWidths,
  rowNumberWidth: number,
): string {
  return [
    `${rowNumberWidth}px`,
    ...columns.map((column) => resolveColumnWidth(column, widths)),
  ].join(' ')
}

/**
 * 結果テーブル全体の最小幅を求める。
 *
 * 幅を決めた列はその幅、決めていない列は型ごとの下限を足し込む。
 *
 * @param columns 結果セットの列
 * @param widths 列名をキーにした幅の対応表
 * @param rowNumberWidth 行番号の列の幅（ピクセル）
 */
export function resolveTableMinWidth(
  columns: Column[],
  widths: ColumnWidths,
  rowNumberWidth: number,
): number {
  return columns.reduce(
    (total, column) => total + (widths[column.name] ?? columnMinWidth(column.kind)),
    rowNumberWidth,
  )
}
