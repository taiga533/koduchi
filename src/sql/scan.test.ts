import { describe, expect, it } from 'vitest'
import {
  isQuotedLiteralStart,
  readWord,
  skipBlockComment,
  skipLineComment,
  skipQuoted,
  skipQuotedLiteral,
} from './scan'

describe('readWord', () => {
  it('識別子に使える文字が続く限りを 1 語として、綴りのまま返す', () => {
    // Arrange
    const sql = 'MyCol$1#x from t'

    // Act
    const { text, next } = readWord(sql, 0)

    // Assert
    expect(text).toBe('MyCol$1#x')
    expect(next).toBe(9)
  })

  it('語でない位置では空の語を返す', () => {
    // Arrange
    const sql = '(a)'

    // Act
    const { text, next } = readWord(sql, 0)

    // Assert
    expect(text).toBe('')
    expect(next).toBe(0)
  })
})

describe('isQuotedLiteralStart', () => {
  it("q' の後に区切り文字が続く形を始まりと見なす", () => {
    // Arrange
    const sql = "q'[x]'"

    // Act
    const 始まりか = isQuotedLiteralStart(sql, 0)

    // Assert
    expect(始まりか).toBe(true)
  })

  it('大文字の Q でも始まりと見なす', () => {
    // Arrange
    const sql = "Q'[x]'"

    // Act
    const 始まりか = isQuotedLiteralStart(sql, 0)

    // Assert
    expect(始まりか).toBe(true)
  })

  it('直前が識別子の一部なら始まりと見なさない', () => {
    // Arrange
    const sql = "abcq'[x]'"

    // Act
    const 始まりか = isQuotedLiteralStart(sql, 3)

    // Assert
    expect(始まりか).toBe(false)
  })

  it('q の後が引用符でなければ始まりと見なさない', () => {
    // Arrange
    const sql = 'qux'

    // Act
    const 始まりか = isQuotedLiteralStart(sql, 0)

    // Assert
    expect(始まりか).toBe(false)
  })
})

describe('skipQuotedLiteral', () => {
  it('対になる括弧で閉じる', () => {
    // Arrange
    const sql = "q'[a]b]' rest"

    // Act
    const next = skipQuotedLiteral(sql, 0)

    // Assert
    expect(sql.slice(0, next)).toBe("q'[a]b]'")
  })

  it('括弧でない区切り文字は同じ文字で閉じる', () => {
    // Arrange
    const sql = "q'!abc!' rest"

    // Act
    const next = skipQuotedLiteral(sql, 0)

    // Assert
    expect(sql.slice(0, next)).toBe("q'!abc!'")
  })

  it('閉じられていなければ末尾までを literal と見なす', () => {
    // Arrange
    const sql = "q'[abc"

    // Act
    const next = skipQuotedLiteral(sql, 0)

    // Assert
    expect(next).toBe(sql.length)
  })
})

describe('skipQuoted', () => {
  it('二重の引用符を終わりと見なさない', () => {
    // Arrange
    const sql = "'it''s' rest"

    // Act
    const next = skipQuoted(sql, 0, "'")

    // Assert
    expect(sql.slice(0, next)).toBe("'it''s'")
  })

  it('閉じられていなければ末尾までを範囲と見なす', () => {
    // Arrange
    const sql = "'abc"

    // Act
    const next = skipQuoted(sql, 0, "'")

    // Assert
    expect(next).toBe(sql.length)
  })
})

describe('skipLineComment', () => {
  it('改行の手前で止まる', () => {
    // Arrange
    const sql = '-- メモ\nselect 1'

    // Act
    const next = skipLineComment(sql, 0)

    // Assert
    expect(sql.slice(0, next)).toBe('-- メモ')
    expect(sql[next]).toBe('\n')
  })

  it('改行が無ければ末尾で止まる', () => {
    // Arrange
    const sql = '-- 末尾のメモ'

    // Act
    const next = skipLineComment(sql, 0)

    // Assert
    expect(next).toBe(sql.length)
  })
})

describe('skipBlockComment', () => {
  it('閉じの記号の次で止まる', () => {
    // Arrange
    const sql = '/* メモ */ select 1'

    // Act
    const next = skipBlockComment(sql, 0)

    // Assert
    expect(sql.slice(0, next)).toBe('/* メモ */')
  })

  it('閉じられていなければ末尾で止まる', () => {
    // Arrange
    const sql = '/* 閉じ忘れ'

    // Act
    const next = skipBlockComment(sql, 0)

    // Assert
    expect(next).toBe(sql.length)
  })
})
