import { describe, expect, it } from 'vitest'
import type { CompileDiagnostic } from '../types/db'
import { formatCompilationReport } from './compilation'

const WARNING = 'ORA-24344: A compilation error occurred while creating an object.'

/** 診断 1 行の見本。 */
function 診断(patch: Partial<CompileDiagnostic> = {}): CompileDiagnostic {
  return {
    owner: 'KODUCHI',
    name: 'BROKEN',
    objectType: 'PROCEDURE',
    line: 3,
    position: 7,
    severity: 'error',
    text: "PLS-00201: identifier 'NUL' must be declared",
    ...patch,
  }
}

describe('formatCompilationReport', () => {
  it('オブジェクトの見出しの下に行と桁と文言を並べる', () => {
    // Arrange
    const report = {
      warning: WARNING,
      diagnostics: [診断(), 診断({ text: 'PL/SQL: Statement ignored' })],
    }

    // Act
    const text = formatCompilationReport(report)

    // Assert
    expect(text).toBe(
      [
        'コンパイルエラーのため、オブジェクトは無効（INVALID）です',
        WARNING,
        'KODUCHI.BROKEN（PROCEDURE）',
        "  3 行 7 桁: PLS-00201: identifier 'NUL' must be declared",
        '  3 行 7 桁: PL/SQL: Statement ignored',
        '行と桁はオブジェクトのソース（ALL_SOURCE）の上の位置です',
      ].join('\n'),
    )
  })

  it('同じ名前でも種別が違えば見出しを分ける', () => {
    // Arrange: 仕様と本体は名前が同じで種別だけが違う
    const report = {
      warning: WARNING,
      diagnostics: [
        診断({ name: 'PKG', objectType: 'PACKAGE' }),
        診断({ name: 'PKG', objectType: 'PACKAGE BODY' }),
      ],
    }

    // Act
    const text = formatCompilationReport(report)

    // Assert
    expect(text).toContain('KODUCHI.PKG（PACKAGE）\n  3 行 7 桁')
    expect(text).toContain('KODUCHI.PKG（PACKAGE BODY）\n  3 行 7 桁')
  })

  it('位置を持たないビューの行には行と桁を書かない', () => {
    // Arrange
    const report = {
      warning: WARNING,
      diagnostics: [
        診断({
          name: 'V',
          objectType: 'VIEW',
          line: 0,
          position: 0,
          text: 'ORA-00942: table or view does not exist',
        }),
      ],
    }

    // Act
    const text = formatCompilationReport(report)

    // Assert
    expect(text).toContain('\n  ORA-00942: table or view does not exist\n')
    expect(text).not.toContain('0 行')
  })

  it('警告の行にはその旨を添える', () => {
    // Arrange
    const report = {
      warning: WARNING,
      diagnostics: [診断({ severity: 'warning', text: 'PLW-05018: unit omitted AUTHID' })],
    }

    // Act
    const text = formatCompilationReport(report)

    // Assert
    expect(text).toContain('  3 行 7 桁: PLW-05018: unit omitted AUTHID（警告）')
  })

  it('行が見つからなくても問題なしとは言わない', () => {
    // Arrange: 権限で見えないなど。Oracle はエラーがあったと言っている
    const report = { warning: WARNING, diagnostics: [] }

    // Act
    const text = formatCompilationReport(report)

    // Assert
    expect(text).toBe(
      [
        'コンパイルエラーのため、オブジェクトは無効（INVALID）です',
        WARNING,
        'ALL_ERRORS に該当する行が見つかりませんでした。権限の無いスキーマのオブジェクトかもしれません',
      ].join('\n'),
    )
  })
})
