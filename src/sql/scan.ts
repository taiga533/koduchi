/**
 * SQL の走査に使う下ごしらえ（ADR 0024）。
 *
 * 文字列リテラル・コメント・Oracle の `q'[...]'` 引用符リテラルの読み飛ばしは、
 * 文の切り出し（`statements.ts`）でも字句の切り出し（`tokens.ts`）でも要る。
 * どちらも「この位置は本当に区切り文字なのか」を決めるために同じ判定を通る。
 *
 * 2 か所へ書くと、片方だけが直されて食い違う。**この判定の持ち主はここ 1 つ**
 * であり、上の 2 つはここを呼ぶだけにしてある。
 */

/** 識別子として使える文字（英数字・`_`・`$`・`#`）。 */
export const IDENTIFIER_CHARACTER = /[A-Za-z0-9_$#]/

/** `q'[...]'` の開き括弧と閉じ括弧の対応。 */
const QUOTE_DELIMITER_PAIRS: Record<string, string> = {
  '[': ']',
  '(': ')',
  '{': '}',
  '<': '>',
}

/**
 * 位置 `index` から始まる語を読み取る。
 *
 * 識別子として使える文字が続く限りを 1 語とする。**綴りは変えずに返す。**
 * 大文字へ畳むかどうかは呼ぶ側が決める（`statements.ts` は畳み、`tokens.ts` は
 * 畳まない）。
 *
 * @param sql 対象の文字列
 * @param index 読み始める位置
 *
 * @returns 語と、その次の位置
 */
export function readWord(sql: string, index: number): { text: string; next: number } {
  let end = index
  while (end < sql.length && IDENTIFIER_CHARACTER.test(sql[end])) {
    end += 1
  }
  return { text: sql.slice(index, end), next: end }
}

/**
 * 位置 `index` が Oracle の引用符リテラル `q'...'` の始まりかを判定する。
 *
 * `q` または `Q` の直後に `'` が続き、さらにその次が区切り文字である形をとる。
 * 直前が識別子の一部である場合（`abcq'` など）は始まりではない。
 *
 * @param sql 対象の文字列
 * @param index 判定する位置
 */
export function isQuotedLiteralStart(sql: string, index: number): boolean {
  if (sql[index] !== 'q' && sql[index] !== 'Q') {
    return false
  }
  if (sql[index + 1] !== "'") {
    return false
  }
  if (index > 0 && IDENTIFIER_CHARACTER.test(sql[index - 1])) {
    return false
  }
  return index + 2 < sql.length
}

/**
 * Oracle の引用符リテラル `q'[...]'` の終わりを探す。
 *
 * @param sql 対象の文字列
 * @param index `q` の位置
 *
 * @returns リテラルの次の位置
 */
export function skipQuotedLiteral(sql: string, index: number): number {
  const opener = sql[index + 2]
  const closer = QUOTE_DELIMITER_PAIRS[opener] ?? opener
  const terminator = `${closer}'`

  const end = sql.indexOf(terminator, index + 3)
  return end === -1 ? sql.length : end + terminator.length
}

/**
 * 単純な引用符で囲まれた範囲の終わりを探す。
 *
 * `''` は文字列中の引用符 1 つを表すため、終わりとは見なさない。
 *
 * @param sql 対象の文字列
 * @param index 開き引用符の位置
 * @param quote 引用符の文字（`'` または `"`）
 *
 * @returns 閉じ引用符の次の位置
 */
export function skipQuoted(sql: string, index: number, quote: string): number {
  let cursor = index + 1
  while (cursor < sql.length) {
    if (sql[cursor] === quote) {
      if (sql[cursor + 1] === quote) {
        cursor += 2
        continue
      }
      return cursor + 1
    }
    cursor += 1
  }
  return sql.length
}

/**
 * 行コメント `--` の終わりを探す。
 *
 * **改行そのものは含めない。**コメントの本文だけを 1 つの塊として扱えるように
 * するためである（`statements.ts` は改行の 1 文字ぶんを飛ばし損ねても走査が
 * 進むので支障が無い）。
 *
 * @param sql 対象の文字列
 * @param index `-` の位置
 *
 * @returns コメントの次の位置
 */
export function skipLineComment(sql: string, index: number): number {
  const lineEnd = sql.indexOf('\n', index)
  return lineEnd === -1 ? sql.length : lineEnd
}

/**
 * ブロックコメント（`/*` から `*` と `/` の並びまで）の終わりを探す。
 *
 * 閉じられていなければ末尾までをコメントと見なす。
 *
 * @param sql 対象の文字列
 * @param index `/` の位置
 *
 * @returns コメントの次の位置
 */
export function skipBlockComment(sql: string, index: number): number {
  const blockEnd = sql.indexOf('*/', index + 2)
  return blockEnd === -1 ? sql.length : blockEnd + 2
}
