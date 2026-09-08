import { describe, expect, it } from 'vitest'
import { formatSql } from './format'
import { collectBindVariables } from './statements'
import { firstTokenDifference, tokenizeSql } from './tokens'

/**
 * 整形して本文を返す。整形できなかった場合はテストを落とす。
 *
 * 「整形できた」ことを前提にする検査の下ごしらえである。
 */
function 整形する(sql: string): string {
  const outcome = formatSql(sql)
  if (outcome.status !== 'formatted') {
    throw new Error(`整形できなかった: ${JSON.stringify(outcome)}`)
  }
  return outcome.text
}

describe('formatSql', () => {
  it('改行の無い 1 行の SQL に改行とインデントを入れる', () => {
    // Arrange
    const sql = 'select a,b from t where c=1'

    // Act
    const formatted = 整形する(sql)

    // Assert
    expect(formatted.split('\n').length).toBeGreaterThan(1)
  })

  it('整形しても字句の並びが変わらない', () => {
    // Arrange
    const sql =
      'select e.empno,e.ename from emp e join dept d on e.deptno=d.deptno where e.sal>1000 order by e.sal desc'

    // Act
    const formatted = 整形する(sql)

    // Assert
    expect(firstTokenDifference(tokenizeSql(sql), tokenizeSql(formatted))).toBeNull()
  })

  it('キーワードの綴りを変えない', () => {
    // Arrange
    const sql = 'Select a From t'

    // Act
    const formatted = 整形する(sql)

    // Assert
    expect(formatted).toContain('Select')
    expect(formatted).toContain('From')
    expect(formatted).not.toContain('SELECT')
  })

  it('識別子の綴りと引用符を変えない（ADR 0013）', () => {
    // Arrange
    const sql = 'select "MyCol", plain_col from "MyTable"'

    // Act
    const formatted = 整形する(sql)

    // Assert
    expect(formatted).toContain('"MyCol"')
    expect(formatted).toContain('"MyTable"')
    expect(formatted).toContain('plain_col')
  })

  it('バインド変数の名前と並びを保つ', () => {
    // Arrange
    const sql = 'select * from t where a=:alpha and b=:beta and c=:alpha'

    // Act
    const formatted = 整形する(sql)

    // Assert
    expect(collectBindVariables(formatted)).toEqual(collectBindVariables(sql))
  })

  it('バインド変数を文字列リテラルへ変えない', () => {
    // Arrange
    const sql = 'select * from t where d between :from and :to'

    // Act
    const formatted = 整形する(sql)

    // Assert
    expect(formatted).toContain(':from')
    expect(formatted).toContain(':to')
  })

  it("q'[...]' 引用符リテラルの中身を変えない", () => {
    // Arrange
    const sql = "select q'[it''s a, b; c]' from dual"

    // Act
    const formatted = 整形する(sql)

    // Assert
    expect(formatted).toContain("q'[it''s a, b; c]'")
  })

  it('文字列リテラルの中の空白を変えない', () => {
    // Arrange
    const sql = "select '  ふたつの空白  ' from dual"

    // Act
    const formatted = 整形する(sql)

    // Assert
    expect(formatted).toContain("'  ふたつの空白  '")
  })

  it('コメントを落とさない', () => {
    // Arrange
    const sql = 'select /*+ INDEX(t idx_t) */ a -- 末尾のメモ\nfrom t'

    // Act
    const formatted = 整形する(sql)

    // Assert
    expect(formatted).toContain('/*+ INDEX(t idx_t) */')
    expect(formatted).toContain('-- 末尾のメモ')
  })

  it('セミコロンで区切られた複数の文をどちらも残す', () => {
    // Arrange
    const sql = 'select 1 from dual;select 2 from dual;'

    // Act
    const formatted = 整形する(sql)

    // Assert
    expect(firstTokenDifference(tokenizeSql(sql), tokenizeSql(formatted))).toBeNull()
  })

  it("改行を含む q'[...]' を壊すため、整形せずに取りやめる", () => {
    // Arrange
    // sql-formatter 15.8.2 はこの形を `q` と `'[...]'` に割る。
    const sql = "select q'[一行目\n二行目]' from dual"

    // Act
    const outcome = formatSql(sql)

    // Assert
    expect(outcome).toMatchObject({ status: 'failed', reason: 'changed' })
  })

  it('取りやめたときは整形後の本文を返さない', () => {
    // Arrange
    const sql = "select q'[一行目\n二行目]' from dual"

    // Act
    const outcome = formatSql(sql)

    // Assert
    expect(outcome).not.toHaveProperty('text')
  })

  it('取りやめた理由に、食い違った字句を添える', () => {
    // Arrange
    const sql = "select q'[一行目\n二行目]' from dual"

    // Act
    const outcome = formatSql(sql)

    // Assert
    expect(outcome.status === 'failed' && outcome.message).toContain("q'[")
  })

  it('構文が読み取れない SQL では失敗を返し、本文に触れさせない', () => {
    // Arrange
    const sql = "select 'closing quote is missing from dual"

    // Act
    const outcome = formatSql(sql)

    // Assert
    expect(outcome).toMatchObject({ status: 'failed', reason: 'parseError' })
  })

  it('既に整形済みの SQL では変化なしを返す', () => {
    // Arrange
    const sql = 整形する('select a,b from t')

    // Act
    const outcome = formatSql(sql)

    // Assert
    expect(outcome).toEqual({ status: 'unchanged' })
  })

  it('空白だけの入力では変化なしを返す', () => {
    // Arrange
    const sql = '  \n  '

    // Act
    const outcome = formatSql(sql)

    // Assert
    expect(outcome).toEqual({ status: 'unchanged' })
  })

  it('文の断片だけを渡しても整形できる（選択範囲の整形のため）', () => {
    // Arrange
    const sql = 'a,b,c'

    // Act
    const formatted = 整形する(sql)

    // Assert
    expect(firstTokenDifference(tokenizeSql(sql), tokenizeSql(formatted))).toBeNull()
  })

  it('空白 2 つでインデントする', () => {
    // Arrange
    const sql = 'select a from t'

    // Act
    const formatted = 整形する(sql)

    // Assert
    expect(formatted.split('\n').filter((line) => line.startsWith(' '))).toContainEqual('  a')
  })

  it('タブでインデントしない', () => {
    // Arrange
    const sql = 'select a,b from t where c=1'

    // Act
    const formatted = 整形する(sql)

    // Assert
    expect(formatted).not.toContain('\t')
  })
})
