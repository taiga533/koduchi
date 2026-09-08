import { describe, expect, it } from 'vitest'
import { firstTokenDifference, tokenizeSql } from './tokens'

/** 字句の綴りだけを並べる。並びの照合を読みやすくするための下ごしらえ。 */
function 綴り(sql: string): string[] {
  return tokenizeSql(sql).map((token) => token.text)
}

describe('tokenizeSql', () => {
  it('空白を落として語と記号に分ける', () => {
    // Arrange
    const sql = 'select a from t'

    // Act
    const tokens = tokenizeSql(sql)

    // Assert
    expect(tokens).toEqual([
      { kind: 'word', text: 'select' },
      { kind: 'word', text: 'a' },
      { kind: 'word', text: 'from' },
      { kind: 'word', text: 't' },
    ])
  })

  it('語の綴りを大文字へ畳まない', () => {
    // Arrange
    const sql = 'Select MyCol FROM t'

    // Act
    const tokens = 綴り(sql)

    // Assert
    expect(tokens).toEqual(['Select', 'MyCol', 'FROM', 't'])
  })

  it('演算子の前後の空白の有無で並びが変わらない', () => {
    // Arrange
    const 詰めた = 'a||b'
    const 空けた = 'a  ||  b'

    // Act
    const 詰めた並び = 綴り(詰めた)
    const 空けた並び = 綴り(空けた)

    // Assert
    expect(詰めた並び).toEqual(空けた並び)
  })

  it('改行を入れても並びが変わらない', () => {
    // Arrange
    const 一行 = 'select a from t where b = 1'
    const 複数行 = 'select\n  a\nfrom\n  t\nwhere\n  b = 1'

    // Act
    const 一行の並び = 綴り(一行)
    const 複数行の並び = 綴り(複数行)

    // Assert
    expect(一行の並び).toEqual(複数行の並び)
  })

  it('文字列リテラルを中身ごと 1 つの字句にする', () => {
    // Arrange
    const sql = "select 'a b c' from dual"

    // Act
    const tokens = tokenizeSql(sql)

    // Assert
    expect(tokens[1]).toEqual({ kind: 'string', text: "'a b c'" })
  })

  it('文字列の中の二重の引用符を終わりと見なさない', () => {
    // Arrange
    const sql = "select 'it''s' from dual"

    // Act
    const tokens = tokenizeSql(sql)

    // Assert
    expect(tokens[1]).toEqual({ kind: 'string', text: "'it''s'" })
  })

  it("q'[...]' 引用符リテラルを中身ごと 1 つの字句にする", () => {
    // Arrange
    const sql = "select q'[a, b; c]' from dual"

    // Act
    const tokens = tokenizeSql(sql)

    // Assert
    expect(tokens[1]).toEqual({ kind: 'quotedLiteral', text: "q'[a, b; c]'" })
  })

  it("q'[...]' の中の改行もリテラルの一部として持つ", () => {
    // Arrange
    const sql = "select q'[a\nb]' from dual"

    // Act
    const tokens = tokenizeSql(sql)

    // Assert
    expect(tokens[1]).toEqual({ kind: 'quotedLiteral', text: "q'[a\nb]'" })
  })

  it('引用符付き識別子と文字列リテラルを別の種別にする', () => {
    // Arrange
    const sql = `select "a" from t where b = 'a'`

    // Act
    const tokens = tokenizeSql(sql)

    // Assert
    expect(tokens[1].kind).toBe('quotedIdentifier')
    expect(tokens[tokens.length - 1].kind).toBe('string')
  })

  it('行コメントを中身ごと 1 つの字句にし、改行は含めない', () => {
    // Arrange
    const sql = 'select 1 -- メモ\nfrom dual'

    // Act
    const tokens = tokenizeSql(sql)

    // Assert
    expect(tokens[2]).toEqual({ kind: 'comment', text: '-- メモ' })
  })

  it('ブロックコメントを中身ごと 1 つの字句にする', () => {
    // Arrange
    const sql = 'select /*+ INDEX(t idx) */ * from t'

    // Act
    const tokens = tokenizeSql(sql)

    // Assert
    expect(tokens[1]).toEqual({ kind: 'comment', text: '/*+ INDEX(t idx) */' })
  })

  it('バインド変数を記号と語に割るが、綴りは失わない', () => {
    // Arrange
    const sql = 'where id = :order_id'

    // Act
    const tokens = 綴り(sql)

    // Assert
    expect(tokens).toEqual(['where', 'id', '=', ':', 'order_id'])
  })

  it('空白だけの入力からは字句を作らない', () => {
    // Arrange
    const sql = '  \n\t '

    // Act
    const tokens = tokenizeSql(sql)

    // Assert
    expect(tokens).toEqual([])
  })
})

describe('firstTokenDifference', () => {
  it('同じ並びなら食い違いを返さない', () => {
    // Arrange
    const before = tokenizeSql('select a from t')
    const after = tokenizeSql('select\n  a\nfrom\n  t')

    // Act
    const difference = firstTokenDifference(before, after)

    // Assert
    expect(difference).toBeNull()
  })

  it('綴りが変わった位置を返す', () => {
    // Arrange
    const before = tokenizeSql('select a from t')
    const after = tokenizeSql('SELECT a from t')

    // Act
    const difference = firstTokenDifference(before, after)

    // Assert
    expect(difference).toEqual({
      index: 0,
      before: { kind: 'word', text: 'select' },
      after: { kind: 'word', text: 'SELECT' },
    })
  })

  it('綴りが同じでも種別が変われば食い違いとする', () => {
    // Arrange
    const before = [{ kind: 'quotedLiteral', text: "q'[a]'" }] as const
    const after = [{ kind: 'string', text: "q'[a]'" }] as const

    // Act
    const difference = firstTokenDifference([...before], [...after])

    // Assert
    expect(difference?.index).toBe(0)
  })

  it('字句が増えた場所を、元の側が尽きた位置として返す', () => {
    // Arrange
    const before = tokenizeSql('select a')
    const after = tokenizeSql('select a from t')

    // Act
    const difference = firstTokenDifference(before, after)

    // Assert
    expect(difference?.index).toBe(2)
    expect(difference?.before).toBeNull()
    expect(difference?.after).toEqual({ kind: 'word', text: 'from' })
  })

  it('字句が減った場所を、比べた側が尽きた位置として返す', () => {
    // Arrange
    const before = tokenizeSql('select a from t')
    const after = tokenizeSql('select a')

    // Act
    const difference = firstTokenDifference(before, after)

    // Assert
    expect(difference?.index).toBe(2)
    expect(difference?.after).toBeNull()
  })
})
