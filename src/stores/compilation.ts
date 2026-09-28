/**
 * コンパイルエラーの報告をメッセージタブの文言へ組み立てる（ADR 0045）。
 *
 * エラー表示はメッセージタブのテキストのみとする（ADR README「機能スコープ」）。
 * 波線や行番号の赤ドットは付けず、行・桁・文言をテキストで並べる。
 */

import type { CompilationReport, CompileDiagnostic } from '../types/db'

/** 先頭の 1 行。Oracle の原文の前に置く。 */
const HEADLINE = 'コンパイルエラーのため、オブジェクトは無効（INVALID）です'

/**
 * 行と桁が何を指すかの断り。
 *
 * `ALL_ERRORS` の行はオブジェクトのソース（`ALL_SOURCE`）の上の行であり、
 * エディタの行とは限らない。`CREATE OR REPLACE` と名前を別の行に書けば 1 行
 * ずれ、トリガーは本体の先頭から数える。読み替えて外すより、出どころを言う。
 */
const LINE_NOTE = '行と桁はオブジェクトのソース（ALL_SOURCE）の上の位置です'

/** 報告に行が 1 つも無かったときの文言。 */
const EMPTY_NOTE =
  'ALL_ERRORS に該当する行が見つかりませんでした。権限の無いスキーマのオブジェクトかもしれません'

/**
 * 報告をメッセージタブへ出す文言にする。
 *
 * オブジェクトごとに見出しを 1 行立て、その下へ診断を 1 行ずつ字下げして並べる。
 * `ALL_ERRORS` の行は同じ秒に別のセッションがコンパイルしたオブジェクトを含み
 * うる（ADR 0045）。見出しに名前を出すのは、それを取り違えさせないためである。
 *
 * @param report Rust 側が返した報告
 */
export function formatCompilationReport(report: CompilationReport): string {
  const lines = [HEADLINE, report.warning]

  if (report.diagnostics.length === 0) {
    lines.push(EMPTY_NOTE)
    return lines.join('\n')
  }

  let previous: string | null = null
  for (const diagnostic of report.diagnostics) {
    const heading = objectHeading(diagnostic)
    if (heading !== previous) {
      lines.push(heading)
      previous = heading
    }
    lines.push(`  ${diagnosticLine(diagnostic)}`)
  }
  lines.push(LINE_NOTE)

  return lines.join('\n')
}

/**
 * オブジェクトの見出し（`KODUCHI.P（PACKAGE BODY）`）。
 *
 * @param diagnostic 診断 1 行
 */
function objectHeading(diagnostic: CompileDiagnostic): string {
  return `${diagnostic.owner}.${diagnostic.name}（${diagnostic.objectType}）`
}

/**
 * 診断 1 行（`3 行 7 桁: PLS-00201: ...`）。
 *
 * ビューの行は位置を持たず 0 で届くため、位置を書かない。「0 行 0 桁」は
 * 実在しない場所を指す。
 *
 * @param diagnostic 診断 1 行
 */
function diagnosticLine(diagnostic: CompileDiagnostic): string {
  const position = diagnostic.line > 0 ? `${diagnostic.line} 行 ${diagnostic.position} 桁: ` : ''
  const severity = diagnostic.severity === 'warning' ? '（警告）' : ''
  return `${position}${diagnostic.text}${severity}`
}
