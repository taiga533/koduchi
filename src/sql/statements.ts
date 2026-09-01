/**
 * SQL を文単位に切り出す（ADR の「SQL の実行単位」節）。
 *
 * `⌘⏎` はカーソル位置の文を実行するため、どこからどこまでが 1 文なのかを
 * 決める必要がある。素朴に `;` で分割すると、文字列リテラル・コメント・
 * Oracle の `q'[...]'` 引用符リテラル・`BEGIN…END;` ブロックの中にある `;` で
 * 誤って切れてしまう。
 *
 * ここでは走査しながら、それらの中に入っている間は区切り文字を無視する。
 */

/** 切り出された 1 文。 */
export interface SqlStatement {
  /** 前後の空白を落とした本文。末尾のセミコロンは含まない。 */
  text: string
  /** 元の文字列における開始位置。 */
  start: number
  /** 元の文字列における終了位置（この位置の文字は含まない）。 */
  end: number
}

/** PL/SQL の入れ子を深くする語。 */
const BLOCK_OPENERS = new Set(['BEGIN', 'CASE', 'IF', 'LOOP'])

/** `END` の直後に来ても入れ子を深くしない語。`END IF` などのため。 */
const END_SUFFIXES = new Set(['IF', 'LOOP', 'CASE'])

/** 無名ブロックの始まりを示す語。 */
const ANONYMOUS_BLOCK_STARTERS = new Set(['DECLARE', 'BEGIN'])

/** `CREATE [OR REPLACE]` に続くと PL/SQL 単位になる語。 */
const PLSQL_OBJECT_KEYWORDS = new Set(['FUNCTION', 'PROCEDURE', 'PACKAGE', 'TRIGGER', 'TYPE'])

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
 * 識別子として使える文字（英数字・`_`・`$`・`#`）が続く限りを 1 語とする。
 *
 * @param sql 対象の文字列
 * @param index 読み始める位置
 *
 * @returns 大文字に揃えた語と、その次の位置
 */
function readWord(sql: string, index: number): { word: string; next: number } {
  let end = index
  while (end < sql.length && /[A-Za-z0-9_$#]/.test(sql[end])) {
    end += 1
  }
  return { word: sql.slice(index, end).toUpperCase(), next: end }
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
function isQuotedLiteralStart(sql: string, index: number): boolean {
  if (sql[index] !== 'q' && sql[index] !== 'Q') {
    return false
  }
  if (sql[index + 1] !== "'") {
    return false
  }
  if (index > 0 && /[A-Za-z0-9_$#]/.test(sql[index - 1])) {
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
function skipQuotedLiteral(sql: string, index: number): number {
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
function skipQuoted(sql: string, index: number, quote: string): number {
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

/** 走査中に持ち回る、PL/SQL ブロックの状態。 */
interface BlockState {
  /** この文が PL/SQL 単位であると判明しているか。 */
  isPlSql: boolean
  /** `BEGIN` などの入れ子の深さ。 */
  depth: number
  /** `BEGIN` を 1 度でも通ったか。`DECLARE` 部の `;` で切らないために使う。 */
  sawBegin: boolean
  /** 文の先頭から数えて何語目かを見るための、意味のある語の並び。 */
  leadingWords: string[]
  /** 直前の語が `END` だったか。`END IF` を数え直さないために使う。 */
  afterEnd: boolean
}

/** 文の走査を始めるときの状態を作る。 */
function createBlockState(): BlockState {
  return {
    isPlSql: false,
    depth: 0,
    sawBegin: false,
    leadingWords: [],
    afterEnd: false,
  }
}

/**
 * 読み取った語を反映して、PL/SQL ブロックの状態を進める。
 *
 * @param state 更新する状態
 * @param word 読み取った語（大文字）
 */
function applyWord(state: BlockState, word: string): void {
  if (state.leadingWords.length < 4) {
    state.leadingWords.push(word)
    state.isPlSql = state.isPlSql || looksLikePlSql(state.leadingWords)
  }

  if (state.afterEnd && END_SUFFIXES.has(word)) {
    // `END IF` の `IF` は入れ子を深くしない。
    state.afterEnd = false
    return
  }

  state.afterEnd = false

  if (word === 'END') {
    state.depth = Math.max(0, state.depth - 1)
    state.afterEnd = true
    return
  }

  if (BLOCK_OPENERS.has(word)) {
    state.depth += 1
    if (word === 'BEGIN') {
      state.sawBegin = true
    }
  }
}

/**
 * 文頭の語の並びから、PL/SQL 単位かどうかを判定する。
 *
 * 無名ブロック（`DECLARE` / `BEGIN` で始まる）と、
 * `CREATE [OR REPLACE] FUNCTION` のような単位を対象にする。
 *
 * @param words 文頭から順に並んだ語（大文字）
 */
function looksLikePlSql(words: string[]): boolean {
  if (words.length === 0) {
    return false
  }

  if (ANONYMOUS_BLOCK_STARTERS.has(words[0])) {
    return true
  }

  if (words[0] !== 'CREATE') {
    return false
  }

  // `CREATE OR REPLACE FUNCTION` の場合は 4 語目、`CREATE FUNCTION` なら 2 語目。
  const rest = words[1] === 'OR' && words[2] === 'REPLACE' ? words.slice(3) : words.slice(1)
  return rest.length > 0 && PLSQL_OBJECT_KEYWORDS.has(rest[0])
}

/**
 * 現在位置で文を区切ってよいかを判定する。
 *
 * PL/SQL 単位では、`BEGIN` を通ったうえで入れ子が閉じきったときだけ区切る。
 * 通常の SQL では常に区切ってよい。
 *
 * @param state 走査中のブロック状態
 */
function canTerminate(state: BlockState): boolean {
  if (!state.isPlSql) {
    return true
  }
  return state.sawBegin && state.depth === 0
}

/**
 * SQL を文単位に切り出す。
 *
 * 空白とコメントだけからなる断片は結果に含めない。末尾のセミコロンが無くても
 * 最後の文として扱う。
 *
 * @param sql 対象の SQL 全文
 *
 * @returns 文の一覧。元の文字列における位置を伴う。
 */
export function splitStatements(sql: string): SqlStatement[] {
  const statements: SqlStatement[] = []

  let segmentStart = 0
  let cursor = 0
  let state = createBlockState()
  /**
   * 現在の断片に、コメントと空白以外の中身があったか。
   *
   * コメントだけの断片を文として実行してしまわないために見張る。
   */
  let sawContent = false

  /** `segmentStart` から `end` までを 1 文として積む。 */
  const pushSegment = (end: number): void => {
    if (!sawContent) {
      return
    }

    const raw = sql.slice(segmentStart, end)
    const leading = raw.length - raw.trimStart().length
    const text = raw.trim()

    if (text.length > 0) {
      statements.push({
        text,
        start: segmentStart + leading,
        end: segmentStart + leading + text.length,
      })
    }
  }

  while (cursor < sql.length) {
    const character = sql[cursor]

    if (character === '-' && sql[cursor + 1] === '-') {
      const lineEnd = sql.indexOf('\n', cursor)
      cursor = lineEnd === -1 ? sql.length : lineEnd + 1
      continue
    }

    if (character === '/' && sql[cursor + 1] === '*') {
      const blockEnd = sql.indexOf('*/', cursor + 2)
      cursor = blockEnd === -1 ? sql.length : blockEnd + 2
      continue
    }

    if (isQuotedLiteralStart(sql, cursor)) {
      sawContent = true
      cursor = skipQuotedLiteral(sql, cursor)
      continue
    }

    if (character === "'" || character === '"') {
      sawContent = true
      cursor = skipQuoted(sql, cursor, character)
      continue
    }

    if (character === ';' && canTerminate(state)) {
      pushSegment(cursor)
      cursor += 1
      segmentStart = cursor
      state = createBlockState()
      sawContent = false
      continue
    }

    if (!/\s/.test(character)) {
      sawContent = true
    }

    if (/[A-Za-z_]/.test(character)) {
      const { word, next } = readWord(sql, cursor)
      applyWord(state, word)
      cursor = next
      continue
    }

    cursor += 1
  }

  pushSegment(sql.length)

  return statements
}

/**
 * カーソル位置にある文を返す（`⌘⏎`）。
 *
 * カーソルが文と文の間の空白にある場合は、直前の文を選ぶ。直前に文が無ければ
 * 直後の文を選ぶ。文が 1 つも無ければ `null` を返す。
 *
 * @param sql 対象の SQL 全文
 * @param cursor カーソルの位置
 */
export function statementAt(sql: string, cursor: number): SqlStatement | null {
  const statements = splitStatements(sql)

  if (statements.length === 0) {
    return null
  }

  const containing = statements.find(
    (statement) => cursor >= statement.start && cursor <= statement.end,
  )
  if (containing) {
    return containing
  }

  // カーソルより前で最も近い文を探す。`statements` は位置の昇順に並んでいる。
  let previous: SqlStatement | null = null
  for (const statement of statements) {
    if (statement.end < cursor) {
      previous = statement
    }
  }
  if (previous) {
    return previous
  }

  return statements[0]
}

/**
 * 先頭のコメントと空白を落とす。
 *
 * 文の種類を先頭のキーワードで判定するために使う。
 *
 * @param sql 対象の SQL
 */
function skipLeadingTrivia(sql: string): string {
  let index = 0

  while (index < sql.length) {
    const rest = sql.slice(index)

    if (/^\s/.test(rest)) {
      index += 1
      continue
    }
    if (rest.startsWith('--')) {
      const lineEnd = sql.indexOf('\n', index)
      index = lineEnd === -1 ? sql.length : lineEnd + 1
      continue
    }
    if (rest.startsWith('/*')) {
      const commentEnd = sql.indexOf('*/', index + 2)
      index = commentEnd === -1 ? sql.length : commentEnd + 2
      continue
    }
    break
  }

  return sql.slice(index)
}

/**
 * 問い合わせだけの文かどうかを判定する。
 *
 * `⇧⌘E`（実測付きの実行計画）は SQL を実際に実行するため、問い合わせ以外に
 * 対しては事前に確認ダイアログを出す必要がある。その判定に使う。
 *
 * 先頭のキーワードだけを見る大まかな判定である。読み取り専用の保証には使わない
 * （それはデータベース側のトランザクションが担う。ADR 0004）。
 *
 * @param sql 判定する SQL
 */
export function isSelectStatement(sql: string): boolean {
  const head = skipLeadingTrivia(sql)
  return /^(select|with)\b/i.test(head)
}
