/**
 * SQL を字句の並びへ分ける（ADR 0024）。
 *
 * 整形の前後で「同じ SQL のままか」を見張るために使う。整形は**空白の置き方**
 * だけを変えるものであり、字句の並びが 1 つでも変われば、それはもう別の SQL で
 * ある。並びを取って比べれば、書き換えを当てる前に取りやめられる。
 *
 * 比べるために必要なのは並びだけなので、**空白は落とす。**逆に、文字列
 * リテラル・引用符付き識別子・`q'[...]'` 引用符リテラル・コメントは中身ごと
 * 1 つの字句として持つ。中身の空白まで含めて元のままであることを言うためである。
 *
 * 演算子は 1 文字ずつに割る。`||` を 1 つの字句にするか 2 つにするかは、
 * 前後の空白の置き方が変わっても並びが変わらない限りどちらでもよく、割った
 * ほうが照合表を持たずに済む。`a||b` と `a || b` はどちらも `a` `|` `|` `b` に
 * なり、同じ並びとして扱える。
 *
 * 走査の下ごしらえは `scan.ts` が持つ。文の切り出し（`statements.ts`）と同じ
 * 判定を通すことで、`q'[...]'` の見立てが 2 通りに割れないようにしてある。
 */

import {
  IDENTIFIER_CHARACTER,
  isQuotedLiteralStart,
  readWord,
  skipBlockComment,
  skipLineComment,
  skipQuoted,
  skipQuotedLiteral,
} from './scan'

/** 字句の種別。 */
export type SqlTokenKind =
  /** 語（キーワードと非引用の識別子と数字）。 */
  | 'word'
  /** 文字列リテラル `'...'`。 */
  | 'string'
  /** 引用符付き識別子 `"..."`。 */
  | 'quotedIdentifier'
  /** Oracle の引用符リテラル `q'[...]'`。 */
  | 'quotedLiteral'
  /** 行コメントとブロックコメント。 */
  | 'comment'
  /** 上のどれでもない 1 文字（記号・演算子）。 */
  | 'symbol'

/** 字句 1 つ。 */
export interface SqlToken {
  kind: SqlTokenKind
  /** 元の綴りのまま。引用符やコメントの記号も含む。 */
  text: string
}

/**
 * SQL を字句の並びへ分ける。
 *
 * 空白は落とす。語の綴りは**大文字へ畳まない**。整形が綴りを変えていないことを
 * 言うのが目的であり、畳んでしまうとその変化を見逃す（ADR 0013）。
 *
 * @param sql 対象の SQL
 *
 * @returns 出てきた順の字句
 */
export function tokenizeSql(sql: string): SqlToken[] {
  const tokens: SqlToken[] = []
  let cursor = 0

  /** `cursor` から `next` までを 1 つの字句として積み、位置を進める。 */
  const push = (kind: SqlTokenKind, next: number): void => {
    tokens.push({ kind, text: sql.slice(cursor, next) })
    cursor = next
  }

  while (cursor < sql.length) {
    const character = sql[cursor]

    if (/\s/.test(character)) {
      cursor += 1
      continue
    }

    if (character === '-' && sql[cursor + 1] === '-') {
      push('comment', skipLineComment(sql, cursor))
      continue
    }

    if (character === '/' && sql[cursor + 1] === '*') {
      push('comment', skipBlockComment(sql, cursor))
      continue
    }

    if (isQuotedLiteralStart(sql, cursor)) {
      push('quotedLiteral', skipQuotedLiteral(sql, cursor))
      continue
    }

    if (character === "'") {
      push('string', skipQuoted(sql, cursor, "'"))
      continue
    }

    if (character === '"') {
      push('quotedIdentifier', skipQuoted(sql, cursor, '"'))
      continue
    }

    if (IDENTIFIER_CHARACTER.test(character)) {
      push('word', readWord(sql, cursor).next)
      continue
    }

    push('symbol', cursor + 1)
  }

  return tokens
}

/** 字句の並びが食い違った 1 か所。 */
export interface TokenDifference {
  /** 何番目の字句で食い違ったか（0 始まり）。 */
  index: number
  /** 元の SQL の字句。並びが尽きていれば `null`。 */
  before: SqlToken | null
  /** 比べた側の字句。並びが尽きていれば `null`。 */
  after: SqlToken | null
}

/**
 * 2 つの字句の並びを比べ、最初に食い違った場所を返す。
 *
 * 種別と綴りの両方が一致したときだけ同じ字句と見なす。同じ綴りでも種別が違えば
 * 別物である（`q'[a]'` が `q` と `'[a]'` に割れた場合など）。
 *
 * 食い違いが無ければ `null`。
 *
 * @param before 元の SQL の字句
 * @param after 比べる側の字句
 */
export function firstTokenDifference(
  before: SqlToken[],
  after: SqlToken[],
): TokenDifference | null {
  const length = Math.max(before.length, after.length)

  for (let index = 0; index < length; index += 1) {
    const a = before[index] ?? null
    const b = after[index] ?? null
    if (a === null || b === null || a.kind !== b.kind || a.text !== b.text) {
      return { index, before: a, after: b }
    }
  }

  return null
}
