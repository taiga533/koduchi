import { describe, expect, it } from 'vitest'
import { syntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { koduchiOracleDialect } from './dialect'

/** SQL を解析し、指定した位置にある節点の名前を返す。 */
function 節点の名前(sql: string, at: number): string {
  const state = EditorState.create({ doc: sql, extensions: [koduchiOracleDialect.language] })
  return syntaxTree(state).resolveInner(at, 1).name
}

describe('koduchiOracleDialect', () => {
  it('二重引用符は識別子として解析される', () => {
    // Arrange: Oracle で "..." は引用符付きの識別子である
    const sql = 'select * from "MyTable"'

    // Act
    const name = 節点の名前(sql, sql.indexOf('"'))

    // Assert
    expect(name).toBe('QuotedIdentifier')
  })

  it('単一引用符は文字列として解析される', () => {
    // Arrange
    const sql = "select * from orders where memo = 'x'"

    // Act
    const name = 節点の名前(sql, sql.indexOf("'"))

    // Assert
    expect(name).toBe('String')
  })

  it('q 記法の引用符リテラルは文字列として解析される', () => {
    // Arrange: PL/SQL の q'[...]' を引き継いでいることを確かめる
    const sql = "select q'[it's]' from dual"

    // Act
    const name = 節点の名前(sql, sql.indexOf("q'"))

    // Assert
    expect(name).toBe('String')
  })
})
