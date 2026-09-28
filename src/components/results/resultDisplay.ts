/**
 * 結果テーブルの表示調整（ADR 0048）。
 *
 * **変えるのは画面に描く文字だけである。**値そのもの（`displayText`）は変えない。
 * コピー（`⌘C`）・CSV・詳細パネルは値を使い、ここで作る文字は描画・列幅の見積り・
 * 検索の当て先（値に加えて見えている文字も当てる）にだけ使う。`1,234` を `WHERE`
 * へ貼ると `ORA-00933` になり、CSV では区切りの `,` と混ざる。写す先が SQL と表計算
 * である以上、写すものは値に寄せる。
 *
 * 描画から切り離した純粋な関数だけを置く。
 */

import type { Cell } from '../../types/db'
import { displayText } from './cellText'

/** 結果テーブルの表示調整。すべて見た目だけに効く。 */
export interface ResultDisplay {
  /** 数値の整数部を 3 桁ごとに `,` で区切る。 */
  thousandsSeparator: boolean
  /** 前後の空白・タブ・改行を記号で見せる。 */
  showWhitespace: boolean
}

/**
 * 既定の表示調整。どちらも切ってあり、値をそのまま描く。
 *
 * 入れると何かが画面から消える、または足される。何もしていない利用者の画面を
 * 今までと変えないため、既定は切っておく。
 */
export const defaultResultDisplay: ResultDisplay = {
  thousandsSeparator: false,
  showWhitespace: false,
}

/**
 * 結果タブごとの一時的な上書き。既定と違う項目だけを持つ。
 *
 * 差分だけを持つのは、設定画面で既定を変えたときに、そのタブで触っていない項目は
 * 新しい既定へ追随させるためである（キーの割り当て（ADR 0037）と同じ持ち方）。
 */
export type ResultDisplayOverride = Partial<ResultDisplay>

/** 描いた文字の 1 かたまり。`marker` は値に無い、見せるために足した記号。 */
export interface TextSegment {
  text: string
  marker: boolean
}

/** 空白を見せる記号。値に含まれうる文字と取り違えないよう、描くときに色を落とす。 */
const SPACE_MARK = '·'
const TAB_MARK = '→'
const NEWLINE_MARK = '↵'

/**
 * 既定と上書きを重ねて、そのタブで効く表示調整を決める。
 *
 * @param defaults `settings.toml` の既定
 * @param override そのタブで触った項目。無ければ `undefined`
 */
export function resolveResultDisplay(
  defaults: ResultDisplay,
  override: ResultDisplayOverride | undefined,
): ResultDisplay {
  return { ...defaults, ...override }
}

/**
 * 上書きに 1 項目を足した結果を返す。既定と同じになった項目は落とす。
 *
 * 既定と同じ値を上書きとして残すと、後で既定を変えたときにそのタブだけが古い値に
 * 取り残される。どの項目も既定と同じなら `undefined`（上書きなし）を返す。
 *
 * @param defaults `settings.toml` の既定
 * @param override 今の上書き
 * @param patch 変えた項目
 */
export function applyOverride(
  defaults: ResultDisplay,
  override: ResultDisplayOverride | undefined,
  patch: ResultDisplayOverride,
): ResultDisplayOverride | undefined {
  const merged: ResultDisplayOverride = { ...override, ...patch }
  const kept = (Object.keys(merged) as (keyof ResultDisplay)[]).filter(
    (key) => merged[key] !== undefined && merged[key] !== defaults[key],
  )
  if (kept.length === 0) {
    return undefined
  }
  return Object.fromEntries(kept.map((key) => [key, merged[key]])) as ResultDisplayOverride
}

/**
 * 既定から外れた表示になっているかを判定する。
 *
 * ヘッダーのボタンの色で知らせるために使う。見えている文字と写す値が違いうる
 * ことを、開かなくても分かるようにする。
 *
 * @param display 効いている表示調整
 */
export function isAdjusted(display: ResultDisplay): boolean {
  return display.thousandsSeparator || display.showWhitespace
}

/**
 * 数値の文字列の整数部を 3 桁ごとに区切る。
 *
 * Oracle の `NUMBER` は 38 桁あり、`number` に載せると精度が壊れる（`types/db.ts`
 * の `Cell`）。そのため `Intl.NumberFormat` を通さず、文字列のまま桁を数えて区切る。
 * `-12345.678` / `1234` の形だけを区切り、指数表記や見知らぬ形は**手を付けずに
 * 返す**（読み違えて桁を崩すより、区切らないほうがよい）。
 *
 * @param text 数値の文字列
 */
export function groupThousands(text: string): string {
  const match = /^(-?)(\d+)(\.\d+)?$/.exec(text)
  if (match === null) {
    return text
  }
  const [, sign, integer, fraction = ''] = match
  return `${sign}${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction}`
}

/**
 * 空白を記号に置き換えたかたまりへ分ける。
 *
 * 見せるのは**前後の半角空白**と、どこにあってもタブと改行である。途中の半角空白は
 * 読めているので置き換えない（置き換えると文が読めなくなる）。前後の空白は
 * `CHAR(n)` の詰め物や取り込みの混入であり、`WHERE` で当たらない原因として探される。
 * 改行は、1 行に収めて描くセルでは空白と区別が付かない。
 *
 * @param text 値
 */
export function whitespaceSegments(text: string): TextSegment[] {
  const leading = /^ */.exec(text)?.[0].length ?? 0
  const trailing = leading === text.length ? 0 : (/ *$/.exec(text)?.[0].length ?? 0)
  const body = text.slice(leading, text.length - trailing)

  const segments: TextSegment[] = []
  const push = (part: string, marker: boolean) => {
    if (part === '') {
      return
    }
    const last = segments.at(-1)
    if (last !== undefined && last.marker === marker) {
      last.text += part
    } else {
      segments.push({ text: part, marker })
    }
  }

  push(SPACE_MARK.repeat(leading), true)
  for (const part of body.split(/(\r\n|\r|\n|\t)/)) {
    if (part === '\t') {
      push(TAB_MARK, true)
    } else if (part === '\r\n' || part === '\r' || part === '\n') {
      push(NEWLINE_MARK, true)
    } else {
      push(part, false)
    }
  }
  push(SPACE_MARK.repeat(trailing), true)
  return segments
}

/**
 * セルに描く文字をかたまりの並びで返す。
 *
 * NULL は表示調整を受けない（`NULL` の表記は ADR 0008 の決定であり、空文字列と
 * 見分けるためのものである）。2 進値は要約の文字列なので区切りも記号も当てない。
 *
 * @param cell 描くセル
 * @param display 効いている表示調整
 */
export function cellSegments(cell: Cell, display: ResultDisplay): TextSegment[] {
  const value = displayText(cell)
  if (cell.kind === 'number' && display.thousandsSeparator) {
    return [{ text: groupThousands(value), marker: false }]
  }
  if (cell.kind === 'text' && display.showWhitespace) {
    return whitespaceSegments(value)
  }
  return [{ text: value, marker: false }]
}

/**
 * セルに描く文字を 1 つの文字列で返す。
 *
 * 列幅の見積りと検索の当て先に使う。描くものと同じ文字で測らないと、区切りを
 * 入れた列で内容合わせをしたときに末尾が `…` で欠ける。
 *
 * @param cell 描くセル
 * @param display 効いている表示調整
 */
export function formattedText(cell: Cell, display: ResultDisplay): string {
  return cellSegments(cell, display)
    .map((segment) => segment.text)
    .join('')
}

/**
 * 保存されていた値を表示調整へ読み直す。
 *
 * `settings.toml` は手で書き換えられ、項目を持たない古いファイルもある。真偽値で
 * ない値と欠落はどちらも既定へ落とす。
 *
 * @param saved 保存されていた値。表が無ければ `undefined`
 */
export function parseResultDisplay(
  saved: Partial<Record<keyof ResultDisplay, unknown>> | undefined,
): ResultDisplay {
  const pick = (key: keyof ResultDisplay): boolean => {
    const value = saved?.[key]
    return typeof value === 'boolean' ? value : defaultResultDisplay[key]
  }
  return {
    thousandsSeparator: pick('thousandsSeparator'),
    showWhitespace: pick('showWhitespace'),
  }
}
