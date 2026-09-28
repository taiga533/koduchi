/**
 * 実行の対象となる文を決める（ADR 0039・0047）。
 *
 * `⌘⏎` / `⇧⌘⏎` / `⌥⌘⏎` / 実行計画が「どの文を Oracle へ渡すか」は、仲介者の
 * 実行（`mediator/execution.ts`）とエディタの範囲の表示（`statementRange.ts`）の
 * 両方が知る必要がある。**決め方の持ち主はここ 1 つ**で、どちらもここを呼ぶ。
 * 2 か所に書くと、光らせた範囲と実際に流れた文がずれ、表示が嘘をつく。
 */

import type { SqlStatement } from './statements'
import { splitStatements, statementAt } from './statements'

/**
 * 実行の単位。
 *
 * - `statement`: `⌘⏎`。カーソル位置の文。**選択があっても見ない。**
 * - `selection`: `⇧⌘⏎`。選択範囲の中の文。選択が無ければ無い。
 * - `script`: `⌥⌘⏎`。選択範囲の中の文、選択が無ければ本文全体の文。
 */
export type RunScope = 'statement' | 'selection' | 'script'

/** 実行の対象となる文の並び。 */
export interface RunTarget {
  /**
   * 文の位置がどこから数えたものか。
   *
   * `selection` なら選択範囲の先頭から数えている。仲介者は選択の位置を
   * 知らない（カーソルとして受け取るのは選択した文字列だけ）ため、本文の
   * 位置へ直すのは選択を持っているエディタの側で行う。
   */
  origin: 'document' | 'selection'
  /** 実行する順の文。対象が無ければ空。 */
  statements: SqlStatement[]
}

/** 対象を決めるのに要る、押された時点のカーソル。 */
export interface RunCursor {
  /** 文書の先頭からの位置（選択の `head`）。 */
  offset: number
  /** 選択している文字列。選択が無ければ `null`。 */
  selectedText: string | null
}

/**
 * 実行の対象となる文を決める。
 *
 * 選択範囲も本文と同じ `splitStatements` を通す（ADR 0039）。
 *
 * @param scope 実行の単位
 * @param document タブの本文
 * @param cursor 押された時点のカーソル
 */
export function runTargetOf(scope: RunScope, document: string, cursor: RunCursor): RunTarget {
  if (scope === 'statement') {
    const statement = statementAt(document, cursor.offset)
    return { origin: 'document', statements: statement ? [statement] : [] }
  }

  if (cursor.selectedText !== null) {
    return { origin: 'selection', statements: splitStatements(cursor.selectedText) }
  }

  return scope === 'script'
    ? { origin: 'document', statements: splitStatements(document) }
    : { origin: 'document', statements: [] }
}
