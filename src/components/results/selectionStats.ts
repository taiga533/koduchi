/**
 * 結果テーブルで選んだセルの件数・合計・平均・最小・最大（ADR 0049）。
 *
 * 描画から切り離した純粋な関数だけを置く。選択の状態は `ResultTable` の中に閉じて
 * おり、ステータスバーへは集計の材料（行と範囲）だけを届ける。数えるのはステータス
 * バーの側で、大きな選択では `accumulateRows` を細切れに呼ぶ。
 *
 * 数値は `Cell.text` の 10 進の文字列から `bigint` で勘定する。`NUMBER` は最大 38 桁
 * であり、`number`（倍精度）へ通すと 16 桁目より先が化ける（`Cell` の型の註釈と同じ
 * 理由）。合計は丸めずに正確に出せる。平均だけは割り算で丸めが入る。
 */

import type { Cell } from '../../types/db'
import type { SelectionRange } from './selection'

/** ステータスバーで切り替えて出す集計の種類。 */
export type StatKind = 'sum' | 'average' | 'min' | 'max'

/** 切り替えのメニューに並べる順。 */
export const STAT_KINDS: readonly StatKind[] = ['sum', 'average', 'min', 'max']

/** 集計の種類の呼び名。 */
export const STAT_LABELS: Record<StatKind, string> = {
  sum: '合計',
  average: '平均',
  min: '最小',
  max: '最大',
}

/**
 * 平均で小数点以下に足す桁数。
 *
 * 選んだ値の小数の桁数にこれを足した桁で丸める。`1 / 3` のように割り切れない
 * ものでも表示が際限なく伸びず、入力より粗くもならない。
 */
export const AVERAGE_EXTRA_SCALE = 10

/** 選んだセルの集計。 */
export interface SelectionStats {
  /** 選んだセルの数。NULL も数値でないセルも数える。 */
  cellCount: number
  /** 合計と平均に入った数値のセルの数。 */
  numericCount: number
  /** NULL のセルの数。どの集計にも入れない（SQL の集計関数と同じ）。 */
  nullCount: number
  /** 数値でも NULL でもないセルの数。 */
  otherCount: number
  /** `otherCount` のうち日時のセルの数。 */
  datetimeCount: number
  /**
   * 最小・最大が何の値を比べたものか。
   *
   * 数値が 1 つでもあれば数値を比べる。数値が無く日時だけなら日時を比べる。
   * どちらも比べられなければ `null`。
   */
  extremaOf: 'number' | 'datetime' | null
  /** 10 進の文字列。数値が無ければ `null`。 */
  sum: string | null
  average: string | null
  /** 最小・最大はセルの文字列そのまま（書式は描くときに当てる）。 */
  min: string | null
  max: string | null
  /**
   * まだ読み込んでいない行へ選択が続いているかもしれないか。
   *
   * カーソルが尽きておらず、選択が読み込み済みの最後の行に届いているとき真になる。
   */
  partial: boolean
  /** 読み込み済みの行数。注意書きに添える。 */
  loadedRows: number
}

/** 10 進の値。`int / 10^scale` を表す。 */
interface Decimal {
  int: bigint
  scale: number
}

/**
 * 数値のセルの値。
 *
 * `BINARY_DOUBLE` / `BINARY_FLOAT` は `inf` / `-inf` / `NaN` の文字列でも届く
 * （Oracle から実測）。これらは 10 進では表せないため別に持つ。
 */
type NumericValue =
  { kind: 'finite'; value: Decimal } | { kind: 'posInf' } | { kind: 'negInf' } | { kind: 'nan' }

/** 小数点と符号だけからなる 10 進の文字列。Rust 側は指数表記で送ってこない。 */
const DECIMAL_PATTERN = /^(-)?(\d+)(?:\.(\d+))?$/

/**
 * 数値のセルの文字列を読む。
 *
 * 読めない文字列は `null` を返し、呼び手はそのセルを「数値でない」側へ数える。
 * 読めないものを 0 として足すと、合計が黙って嘘になる。
 *
 * @param text セルの文字列
 */
export function parseNumeric(text: string): NumericValue | null {
  switch (text) {
    case 'inf':
      return { kind: 'posInf' }
    case '-inf':
      return { kind: 'negInf' }
    case 'NaN':
      return { kind: 'nan' }
  }
  const match = DECIMAL_PATTERN.exec(text)
  if (match === null) {
    return null
  }
  const [, sign, whole, fraction = ''] = match
  const int = BigInt(whole + fraction)
  return { kind: 'finite', value: { int: sign ? -int : int, scale: fraction.length } }
}

/**
 * 2 つの 10 進を同じ桁へ揃える。
 *
 * @param a 揃える値
 * @param b 揃える値
 */
function align(a: Decimal, b: Decimal): [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale)
  return [a.int * 10n ** BigInt(scale - a.scale), b.int * 10n ** BigInt(scale - b.scale), scale]
}

/**
 * 10 進を文字列にする。末尾の 0 は落とす。
 *
 * `123.4500` と `123.45` は Oracle の上でも同じ値であり、表示も揃える。
 *
 * @param decimal 文字列にする値
 */
function decimalToString(decimal: Decimal): string {
  const negative = decimal.int < 0n
  const digits = (negative ? -decimal.int : decimal.int).toString().padStart(decimal.scale + 1, '0')
  const whole = digits.slice(0, digits.length - decimal.scale)
  const fraction = digits.slice(digits.length - decimal.scale).replace(/0+$/, '')
  const body = fraction === '' ? whole : `${whole}.${fraction}`
  return negative && body !== '0' ? `-${body}` : body
}

/**
 * 10 進を整数で割り、`scale` 桁で四捨五入する（0 から遠い側へ丸める）。
 *
 * @param dividend 割られる値
 * @param divisor 割る数（正）
 * @param scale 結果の小数の桁数
 */
function divide(dividend: Decimal, divisor: bigint, scale: number): Decimal {
  const shifted = dividend.int * 10n ** BigInt(scale - dividend.scale)
  const negative = shifted < 0n
  const magnitude = negative ? -shifted : shifted
  const quotient = magnitude / divisor
  const rounded = (magnitude % divisor) * 2n >= divisor ? quotient + 1n : quotient
  return { int: negative ? -rounded : rounded, scale }
}

/**
 * 数値の並びの順位。`-inf` < 有限 < `inf` < `NaN`。
 *
 * Oracle の `BINARY_DOUBLE` の比較は `NaN` を最も大きい値として扱う。`MIN` / `MAX`
 * を SQL で書いたときと同じ答えを出すため、それに合わせる。
 *
 * @param value 順位を求める値
 */
function rank(value: NumericValue): number {
  switch (value.kind) {
    case 'negInf':
      return 0
    case 'finite':
      return 1
    case 'posInf':
      return 2
    case 'nan':
      return 3
  }
}

/**
 * 2 つの数値を比べる。
 *
 * @param a 比べる値
 * @param b 比べる値
 * @returns `a` が小さければ負、等しければ 0、大きければ正
 */
function compareNumeric(a: NumericValue, b: NumericValue): number {
  if (a.kind === 'finite' && b.kind === 'finite') {
    const [x, y] = align(a.value, b.value)
    return x < y ? -1 : x > y ? 1 : 0
  }
  return rank(a) - rank(b)
}

/**
 * 日時のセルの文字列の形。
 *
 * `DATE` / `TIMESTAMP` は `2024-01-02 03:04:05[.fffffffff]`、時間帯付きは末尾に
 * ` +09:00` が付いて届く（Oracle から実測）。`INTERVAL` はこの形に当たらない。
 */
const DATETIME_PATTERN =
  /^(-?\d{4,})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?: ([+-])(\d{2}):(\d{2}))?$/

/** 比べられる形に直した日時。 */
interface DatetimeKey {
  /** 紀元からの秒。時間帯付きは UTC に直してある。 */
  seconds: number
  /** 秒の小数部をナノ秒で。 */
  nanos: number
  /** 時間帯を持っていたか。 */
  zoned: boolean
}

/**
 * 暦日を 1970-01-01 からの日数にする（先発グレゴリオ暦）。
 *
 * 年が負でも崩れない算法（Howard Hinnant の days_from_civil）を使う。`Date` は
 * 表せる範囲が ±約 27 万年で足りるが、ローカルの時間帯を混ぜないよう自前で数える。
 *
 * @param year 年
 * @param month 月（1 始まり）
 * @param day 日
 */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const mp = (month + 9) % 12
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

/**
 * 日時のセルの文字列を比べられる形にする。
 *
 * @param text セルの文字列
 * @returns 読めなければ `null`（`INTERVAL` など）
 */
export function parseDatetime(text: string): DatetimeKey | null {
  const match = DATETIME_PATTERN.exec(text)
  if (match === null) {
    return null
  }
  const [, year, month, day, hour, minute, second, fraction = '', sign, offsetH, offsetM] = match
  const offset =
    sign === undefined
      ? 0
      : (sign === '-' ? -1 : 1) * (Number(offsetH) * 3600 + Number(offsetM) * 60)
  const seconds =
    daysFromCivil(Number(year), Number(month), Number(day)) * 86400 +
    Number(hour) * 3600 +
    Number(minute) * 60 +
    Number(second) -
    offset
  return { seconds, nanos: Number(fraction.padEnd(9, '0')), zoned: sign !== undefined }
}

/**
 * 2 つの日時を比べる。
 *
 * @param a 比べる値
 * @param b 比べる値
 */
function compareDatetime(a: DatetimeKey, b: DatetimeKey): number {
  return a.seconds - b.seconds || a.nanos - b.nanos
}

/** 最小と最大を追いかける入れ物。 */
interface Extrema<T> {
  min: { key: T; text: string } | null
  max: { key: T; text: string } | null
}

/**
 * 値を 1 つ入れて最小と最大を更新する。
 *
 * @param extrema 更新する入れ物
 * @param key 比べる値
 * @param text 表示に使うセルの文字列
 * @param compare 比べる関数
 */
function track<T>(extrema: Extrema<T>, key: T, text: string, compare: (a: T, b: T) => number) {
  if (extrema.min === null || compare(key, extrema.min.key) < 0) {
    extrema.min = { key, text }
  }
  if (extrema.max === null || compare(key, extrema.max.key) > 0) {
    extrema.max = { key, text }
  }
}

/**
 * 数値の合計。`inf` / `NaN` は IEEE 754 の足し算に従う。
 *
 * `BINARY_DOUBLE` の列を SQL の `SUM` で足したときと同じ答えにするためである。
 *
 * @param total 有限の値の和
 * @param seen 出てきた非有限の値
 */
function sumOf(total: Decimal, seen: { posInf: boolean; negInf: boolean; nan: boolean }): string {
  if (seen.nan || (seen.posInf && seen.negInf)) {
    return 'NaN'
  }
  if (seen.posInf) {
    return 'inf'
  }
  if (seen.negInf) {
    return '-inf'
  }
  return decimalToString(total)
}

/**
 * 集計の途中の状態。
 *
 * 大きな選択を一度に数えると描画が止まるため、行のかたまりごとに `accumulateRows` で
 * 足し込み、最後に `finishStats` で結果にする（ADR 0049）。途中で選択が変われば
 * 捨てて作り直す。
 */
export interface StatsAccumulator {
  cellCount: number
  numericCount: number
  nullCount: number
  otherCount: number
  datetimeCount: number
  total: Decimal
  seen: { posInf: boolean; negInf: boolean; nan: boolean }
  numbers: Extrema<NumericValue>
  datetimes: Extrema<DatetimeKey>
  datetimeComparable: boolean
  zoned: boolean | null
}

/** 空の集計を作る。 */
export function createAccumulator(): StatsAccumulator {
  return {
    cellCount: 0,
    numericCount: 0,
    nullCount: 0,
    otherCount: 0,
    datetimeCount: 0,
    total: { int: 0n, scale: 0 },
    seen: { posInf: false, negInf: false, nan: false },
    numbers: { min: null, max: null },
    datetimes: { min: null, max: null },
    datetimeComparable: true,
    zoned: null,
  }
}

/**
 * 選択の最後の行（読み込み済みの行で切ったもの）。
 *
 * @param rows 読み込み済みの行
 * @param range 選択範囲
 */
export function lastSelectedRow(rows: Cell[][], range: SelectionRange): number {
  return Math.min(range.bottom, rows.length - 1)
}

/**
 * 選択の `from` 行目から `to` 行目の手前までを集計へ足し込む。
 *
 * @param acc 足し込む先
 * @param rows 読み込み済みの行
 * @param range 選択範囲（列の範囲だけを見る）
 * @param from 始めの行
 * @param to 終わりの行（含まない）
 */
export function accumulateRows(
  acc: StatsAccumulator,
  rows: Cell[][],
  range: SelectionRange,
  from: number,
  to: number,
): void {
  for (let row = from; row < to; row++) {
    const cells = rows[row]
    for (let column = range.left; column <= range.right; column++) {
      const cell = cells[column]
      if (cell === undefined) {
        continue
      }
      acc.cellCount++
      if (cell.kind === 'null') {
        acc.nullCount++
        continue
      }
      if (cell.kind === 'number') {
        const value = parseNumeric(cell.text)
        if (value !== null) {
          acc.numericCount++
          track(acc.numbers, value, cell.text, compareNumeric)
          if (value.kind === 'finite') {
            const [x, y, scale] = align(acc.total, value.value)
            acc.total = { int: x + y, scale }
          } else {
            acc.seen[value.kind] = true
          }
          continue
        }
      }
      acc.otherCount++
      if (cell.kind === 'datetime') {
        acc.datetimeCount++
        const key = parseDatetime(cell.text)
        // 時間帯の有る値と無い値は、どちらが先かを決められない（無いほうの時間帯を
        // 小槌は知らない）。比べられない値が 1 つでも混ざれば、日時の最小・最大は出さない。
        if (key === null || (acc.zoned !== null && acc.zoned !== key.zoned)) {
          acc.datetimeComparable = false
        } else {
          acc.zoned = key.zoned
          track(acc.datetimes, key, cell.text, compareDatetime)
        }
      }
    }
  }
}

/**
 * まだ読み込んでいない行へ選択が続いているかもしれないか。
 *
 * 選択は読み込み済みの行の中にしか無い（`⌘A` も見出しからの列選択も、読み込み済みの
 * 行数で範囲を作る）。そのため、選択が最後の行に届いていてカーソルが尽きていない
 * ときは、利用者の意図した範囲がまだ読み込んでいない行へ続いている。最後の行に
 * 届いていない選択は、利用者が選んだセルそのものであり、集計に欠けは無い。
 *
 * @param rows 読み込み済みの行
 * @param range 選択範囲
 * @param exhausted カーソルが尽きたか
 */
export function isPartialSelection(
  rows: Cell[][],
  range: SelectionRange,
  exhausted: boolean,
): boolean {
  return !exhausted && rows.length > 0 && range.bottom >= rows.length - 1
}

/**
 * 足し込み終えた集計を結果にする。
 *
 * @param acc 足し込み終えた集計
 * @param rows 読み込み済みの行
 * @param range 選択範囲
 * @param exhausted カーソルが尽きたか
 */
export function finishStats(
  acc: StatsAccumulator,
  rows: Cell[][],
  range: SelectionRange,
  exhausted: boolean,
): SelectionStats {
  const hasNumbers = acc.numericCount > 0
  const hasDatetimes = !hasNumbers && acc.datetimeCount > 0 && acc.datetimeComparable
  const extrema = hasNumbers ? acc.numbers : hasDatetimes ? acc.datetimes : { min: null, max: null }
  const nonFinite = acc.seen.nan || acc.seen.posInf || acc.seen.negInf

  return {
    cellCount: acc.cellCount,
    numericCount: acc.numericCount,
    nullCount: acc.nullCount,
    otherCount: acc.otherCount,
    datetimeCount: acc.datetimeCount,
    extremaOf: hasNumbers ? 'number' : hasDatetimes ? 'datetime' : null,
    sum: hasNumbers ? sumOf(acc.total, acc.seen) : null,
    average: hasNumbers
      ? nonFinite
        ? sumOf(acc.total, acc.seen)
        : decimalToString(
            divide(acc.total, BigInt(acc.numericCount), acc.total.scale + AVERAGE_EXTRA_SCALE),
          )
      : null,
    min: extrema.min?.text ?? null,
    max: extrema.max?.text ?? null,
    partial: isPartialSelection(rows, range, exhausted),
    loadedRows: rows.length,
  }
}

/**
 * 選んだセルを一度に集計する。
 *
 * 小さな選択と単体テストのための入口であり、大きな選択は `accumulateRows` を
 * 細切れに呼ぶ（`useSelectionStats`）。
 *
 * @param rows 読み込み済みの行
 * @param range 正規化した選択範囲
 * @param exhausted カーソルが尽きたか
 */
export function computeSelectionStats(
  rows: Cell[][],
  range: SelectionRange,
  exhausted: boolean,
): SelectionStats {
  const acc = createAccumulator()
  accumulateRows(acc, rows, range, range.top, lastSelectedRow(rows, range) + 1)
  return finishStats(acc, rows, range, exhausted)
}

/**
 * 選んだセルの数。値を読まずに範囲の広さから出す。
 *
 * 件数は集計を待たずに出したいため、1 つずつ数えずに求める。行はどれも同じ列の
 * 数を持つ（結果セットの 1 行である）。
 *
 * @param rows 読み込み済みの行
 * @param range 選択範囲
 */
export function selectedCellCount(rows: Cell[][], range: SelectionRange): number {
  const height = lastSelectedRow(rows, range) - range.top + 1
  const width = Math.min(range.right, (rows[0]?.length ?? 0) - 1) - range.left + 1
  return height > 0 && width > 0 ? height * width : 0
}

/**
 * 集計の値を 1 つ取り出す。
 *
 * @param stats 集計
 * @param kind 取り出す種類
 */
export function statValue(stats: SelectionStats, kind: StatKind): string | null {
  return stats[kind]
}

/**
 * 集計の値を表示の書式にする。
 *
 * 10 進の数値だけ整数部に 3 桁ごとの `,` を入れる。日時と `inf` / `NaN` はそのまま
 * 返す。`toLocaleString` は `number` へ通すため 38 桁を扱えず、使わない。
 *
 * @param text 集計の値
 */
export function formatStatValue(text: string): string {
  const match = DECIMAL_PATTERN.exec(text)
  if (match === null) {
    return text
  }
  const [, sign = '', whole, fraction] = match
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${sign}${grouped}${fraction === undefined ? '' : `.${fraction}`}`
}

/**
 * まだ読み込んでいない行へ選択が続いているときの注意文言。
 *
 * 集計を待たずに出せるよう、集計の結果からではなく行数から組み立てる。
 *
 * @param loadedRows 読み込み済みの行数
 * @param kind 注意する集計の種類
 */
export function partialNote(loadedRows: number, kind: StatKind): string {
  return `読み込み済みの ${loadedRows.toLocaleString('ja-JP')} 行だけの${STAT_LABELS[kind]}です。まだ読み込んでいない行は含みません。`
}

/**
 * 集計の値に添える説明（`title`）を組み立てる。
 *
 * 何を足し上げたか、何を外したかを言う。まだ読み込んでいない行へ選択が続いて
 * いるときは、それを先に言う（ADR 0027 の「手元の一部を全体に見せない」）。
 *
 * @param stats 集計
 * @param kind 説明する種類
 */
export function describeStat(stats: SelectionStats, kind: StatKind): string {
  const lines: string[] = []
  if (stats.partial) {
    lines.push(partialNote(stats.loadedRows, kind))
  }
  if (statValue(stats, kind) === null) {
    lines.push(
      kind === 'sum' || kind === 'average'
        ? '数値のセルがありません。'
        : '比べられる数値か日時のセルがありません。',
    )
    return lines.join('\n')
  }
  const ofDatetime = stats.extremaOf === 'datetime' && (kind === 'min' || kind === 'max')
  const counted = ofDatetime
    ? `日時 ${stats.datetimeCount.toLocaleString('ja-JP')} 件`
    : `数値 ${stats.numericCount.toLocaleString('ja-JP')} 件`
  const rest = ofDatetime ? stats.otherCount - stats.datetimeCount : stats.otherCount
  const excluded: string[] = []
  if (stats.nullCount > 0) {
    excluded.push(`NULL ${stats.nullCount.toLocaleString('ja-JP')} 件`)
  }
  if (rest > 0) {
    excluded.push(`${ofDatetime ? '日時' : '数値'}でない ${rest.toLocaleString('ja-JP')} 件`)
  }
  lines.push(
    excluded.length === 0
      ? `${counted}の${STAT_LABELS[kind]}。`
      : `${counted}の${STAT_LABELS[kind]}（${excluded.join('・')}は含みません）。`,
  )
  return lines.join('\n')
}
