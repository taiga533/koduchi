/**
 * セルの詳細表示に使う純粋な変換。
 *
 * 結果テーブルの 1 行はセルの高さに収まる範囲しか見せられない。`CLOB` は先頭
 * 64KB まで持っているのに、テーブルの中では末尾が切れてしまう。詳細パネルは
 * その全文を落ち着いて読むための場所であり、ここではそこに出す文字列を作る。
 *
 * ただし `CLOB` は 64KB を超えると Rust 側で切り詰められている（ADR の「値の
 * 受け渡し」節）。詳細パネルは「全文を出す」顔をしているため、切れている値を
 * 黙って出すと、利用者は末尾の無い文字列を値そのものだと信じてしまう。**打ち
 * 切ったときも黙って切り詰めない**（ADR 0021）ため、切れた事実は本文とは別の
 * 文言として添える。**本文そのものには印を混ぜない。**パネルの本文は選んで
 * コピーできるデータであり、注記が混ざるとデータが汚れる。
 */

import { CLOB_LIMIT_BYTES } from '../../types/db'
import type { Cell } from '../../types/db'
import { displayText } from './cellText'

/**
 * JSON らしき値かを判定する。
 *
 * 整形を試す前のふるい。前後の空白を除いた先頭が `{` か `[` のものだけを対象と
 * する。数値や文字列だけの JSON（`123` や `"abc"`）は整形しても見た目が変わらず、
 * ただの数値列を JSON と誤認する害のほうが大きい。
 *
 * @param text 判定する文字列
 */
export function looksLikeJson(text: string): boolean {
  const head = text.trimStart()[0]
  return head === '{' || head === '['
}

/**
 * JSON として整形した文字列を返す。
 *
 * `looksLikeJson` を通り、かつ `JSON.parse` に通るときだけ 2 個のスペースで
 * 字下げした文字列を返す。整形できなければ `null` を返し、呼び出し側は生の値を
 * そのまま出す。
 *
 * @param text 整形したい文字列
 */
export function formatJson(text: string): string | null {
  if (!looksLikeJson(text)) {
    return null
  }
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return null
  }
}

/**
 * 値の文字数を数える。
 *
 * サロゲートペアを 1 文字として数えるため、コードポイント単位で数える。
 * `String.prototype.length` の UTF-16 の要素数では、絵文字 1 文字が 2 と出る。
 *
 * @param text 数える文字列
 */
export function characterCount(text: string): number {
  return Array.from(text).length
}

/**
 * 切り詰められた値かを判定する。
 *
 * Rust 側は切れていないセルで項目そのものを省くため、`undefined` は偽である。
 *
 * @param cell 判定するセル
 */
export function isTruncated(cell: Cell): boolean {
  return cell.truncated === true
}

/**
 * 値の大きさを表す一行を組み立てる。
 *
 * 切り詰められた値では文字数だけを出すと嘘になる。数えられるのは切り詰めた
 * **後**の文字列だからである。上限までしか持っていない旨を必ず添える
 * （ADR 0021 の「黙って切り詰めない」）。
 *
 * @param cell 表示するセル
 */
export function sizeLabel(cell: Cell): string {
  if (cell.kind === 'null') {
    return '値なし（NULL）'
  }

  const 文字数 = `${characterCount(cell.text).toLocaleString('ja-JP')} 文字`
  if (!isTruncated(cell)) {
    return 文字数
  }

  return `${文字数}（先頭 ${CLOB_LIMIT_BYTES / 1024} KB のみ · 末尾は切り詰められています）`
}

/**
 * セルの詳細に出す本文を決める。
 *
 * 整形が有効で、かつ JSON として読めるときだけ整形した文字列を返す。それ以外は
 * 生の値をそのまま返す。
 *
 * @param cell 表示するセル
 * @param formatted JSON の整形を有効にするか
 */
export function detailBody(cell: Cell, formatted: boolean): string {
  const raw = displayText(cell)
  if (!formatted) {
    return raw
  }
  return formatJson(raw) ?? raw
}

/**
 * 中身を出せない値かを判定する。
 *
 * `BLOB` / `RAW` は `[BLOB 1.2 KB]` という要約だけを受け取っており、バイト列は
 * フロントエンドに無い（ADR の「値の受け渡し」節）。詳細パネルではその旨を書く。
 *
 * @param cell 判定するセル
 */
export function isOpaque(cell: Cell): boolean {
  return cell.kind === 'binary'
}
