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

/**
 * 報告に行が 1 つも無かったときの文言。
 *
 * 見えない権限・時計の食い違いなど原因は幾つか考えられるが、小槌にはどれか
 * 分からない。1 つに決めつけると、外れたときに利用者を違う方向へ向かわせる。
 */
const EMPTY_NOTE =
  'ALL_ERRORS から該当する行を見つけられませんでした（原因は特定できません）。オブジェクトの状態は ALL_OBJECTS と ALL_ERRORS で確かめてください'

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

  // 読めなかったのと、読んで何も無かったのとは別の事実である。
  if (report.lookupError !== null) {
    lines.push(report.lookupError)
    return lines.join('\n')
  }

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
