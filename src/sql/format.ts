/**
 * SQL の整形（ADR 0024）。
 *
 * 業務で書かれた SQL は改行もインデントも無い 1 行で渡ってくることがある。
 * 読める形へ直す道具として `sql-formatter` を使う。
 *
 * **整形が利用者の SQL を書き換えてよいのは空白の置き方だけである。**
 * `sql-formatter` は Oracle の `q'[...]'` 引用符リテラルに改行が入っていると
 * `q` と `'[...]'` に割ってしまう（15.8.2 で実測）。割れた SQL はもう別物であり、
 * そのままエディタへ書き戻せば利用者の SQL を黙って壊すことになる。
 *
 * そこで整形した結果を必ず**字句の並びで照合する**（`tokens.ts`）。並びが 1 つ
 * でも食い違えば、整形を諦めて元のまま返す。壊れた入力を前処理で守る道は採らな
 * かった（理由は ADR 0024）。守り漏らしたときに壊れるのは利用者の SQL であり、
 * 「整形できませんでした」と言うほうが害が小さい。
 *
 * 綴りは畳まない。キーワードも識別子も型名も `preserve` で通す。ADR 0013 の
 * 「引用符は必要なときだけ付け、付けるときは綴りを変えない」と同じ考えであり、
 * 併せて「空白だけが変わる」という照合の前提を保つためでもある。
 */

import { format as formatWithLibrary } from 'sql-formatter'
import { firstTokenDifference, tokenizeSql, type SqlToken } from './tokens'

/**
 * `sql-formatter` へ渡す書式（ADR 0024）。
 *
 * **決め打ちであり、設定にはしていない。**まず 1 通りで出し、不満が出てから
 * 項目を切り出すほうが、使われない設定を抱え込まずに済む。
 *
 * - `language`: 小槌は今のところ Oracle 専用であり、CodeMirror 側の方言
 *   （`dialect.ts`）も Oracle 固定である。接続していなくても整形は使えるべき
 *   なので、接続の有無では切り替えない。
 * - `tabWidth` / `useTabs`: CodeMirror の既定（空白 2 つ）に合わせる。
 * - `keywordCase` などを `preserve` に置く理由は上の説明のとおり。
 */
const FORMAT_OPTIONS = {
  language: 'plsql',
  tabWidth: 2,
  useTabs: false,
  keywordCase: 'preserve',
  dataTypeCase: 'preserve',
  functionCase: 'preserve',
  identifierCase: 'preserve',
  linesBetweenQueries: 1,
} as const

/** 整形できなかった理由。 */
export type FormatFailureReason =
  /** `sql-formatter` が構文を読み取れなかった。 */
  | 'parseError'
  /** 整形の前後で字句の並びが変わった。書き戻せば SQL が壊れる。 */
  | 'changed'

/** 整形の結果。 */
export type FormatOutcome =
  /** 整形できた。`text` を書き戻してよい。 */
  | { status: 'formatted'; text: string }
  /** 既に整形済みで、書き戻す必要が無い。 */
  | { status: 'unchanged' }
  /** 整形できなかった。**元の SQL には触れないこと。** */
  | { status: 'failed'; reason: FormatFailureReason; message: string }

/**
 * 字句 1 つを、報せの中で見せる形にする。
 *
 * 長い文字列リテラルがそのまま出ると読めなくなるため、頭だけを見せる。
 *
 * @param token 見せる字句。並びが尽きていた場所では `null`
 */
function describeToken(token: SqlToken | null): string {
  if (token === null) {
    return '（無し）'
  }
  const head = token.text.length > 20 ? `${token.text.slice(0, 20)}…` : token.text
  return head.replace(/\s+/g, ' ')
}

/**
 * 整形の前後で SQL が同じままかを見張る。
 *
 * 同じであれば `null`、食い違っていればその旨の文言を返す。
 *
 * @param before 整形する前の SQL
 * @param after 整形した後の SQL
 */
function findCorruption(before: string, after: string): string | null {
  const difference = firstTokenDifference(tokenizeSql(before), tokenizeSql(after))
  if (difference === null) {
    return null
  }

  return `整形の結果が元の SQL と食い違ったため、取りやめました（${difference.index + 1} 番目の字句が ${describeToken(difference.before)} から ${describeToken(difference.after)} へ変わっています）。`
}

/**
 * SQL を整形する。
 *
 * **失敗しても元の SQL は返さない。**呼ぶ側が「書き戻さない」と判断できるよう、
 * 結果の形で成否を分けてある。整形できなかったのに元の文字列が返ると、それを
 * そのまま書き戻して取り消し履歴だけが 1 段増える。
 *
 * @param sql 整形する SQL。文が複数並んでいてもよい
 *
 * @returns 整形の結果
 */
export function formatSql(sql: string): FormatOutcome {
  if (sql.trim().length === 0) {
    return { status: 'unchanged' }
  }

  let formatted: string
  try {
    formatted = formatWithLibrary(sql, FORMAT_OPTIONS)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { status: 'failed', reason: 'parseError', message: `整形できませんでした。${detail}` }
  }

  const corruption = findCorruption(sql, formatted)
  if (corruption !== null) {
    return { status: 'failed', reason: 'changed', message: corruption }
  }

  return formatted === sql ? { status: 'unchanged' } : { status: 'formatted', text: formatted }
}
