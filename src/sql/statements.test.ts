import { describe, expect, it } from 'vitest'
import {
  collectBindOccurrences,
  collectBindOccurrencesAcross,
  collectBindVariables,
  collectBindVariablesAcross,
  isSelectStatement,
  splitStatements,
  statementAt,
} from './statements'

describe('splitStatements', () => {
  it('セミコロンで区切られた複数の文を切り出す', () => {
    // Arrange
    const sql = 'select 1 from dual; select 2 from dual;'

    // Act
    const statements = splitStatements(sql)

    // Assert
    expect(statements.map((s) => s.text)).toEqual(['select 1 from dual', 'select 2 from dual'])
  })

  it('末尾にセミコロンが無くても最後の文を拾う', () => {
    // Arrange
    const sql = 'select 1 from dual'

    // Act
    const statements = splitStatements(sql)

    // Assert
    expect(statements.map((s) => s.text)).toEqual(['select 1 from dual'])
  })

  it('空白だけの断片は文として扱わない', () => {
    // Arrange
    const sql = 'select 1 from dual;\n\n   \n'

    // Act
    const statements = splitStatements(sql)

    // Assert
    expect(statements).toHaveLength(1)
  })

  it('文字列リテラルの中のセミコロンでは切らない', () => {
    // Arrange
    const sql = "select 'a;b' from dual"

    // Act
    const statements = splitStatements(sql)

    // Assert
    expect(statements.map((s) => s.text)).toEqual(["select 'a;b' from dual"])
  })

  it('二重の引用符で表した文字列中の引用符を終わりと見なさない', () => {
    // Arrange
    const sql = "select 'it''s; fine' from dual"

    // Act
    const statements = splitStatements(sql)

    // Assert
    expect(statements).toHaveLength(1)
  })

  it('引用符で囲まれた識別子の中のセミコロンでは切らない', () => {
    // Arrange
    const sql = 'select "a;b" from dual'

    // Act
    const statements = splitStatements(sql)

    // Assert
    expect(statements).toHaveLength(1)
  })

  it('行コメントの中のセミコロンでは切らない', () => {
    // Arrange
    const sql = 'select 1 -- コメント; ここは無視\nfrom dual'

    // Act
    const statements = splitStatements(sql)

    // Assert
    expect(statements).toHaveLength(1)
  })

  it('ブロックコメントの中のセミコロンでは切らない', () => {
    // Arrange
    const sql = 'select 1 /* コメント; ここは無視 */ from dual'

    // Act
    const statements = splitStatements(sql)

    // Assert
    expect(statements).toHaveLength(1)
  })

  it('閉じられていないブロックコメントは末尾まで読み飛ばす', () => {
    // Arrange
    const sql = 'select 1 from dual /* 閉じ忘れ; '

    // Act
    const statements = splitStatements(sql)

    // Assert
    expect(statements).toHaveLength(1)
  })

  it('Oracle の引用符リテラルの中のセミコロンでは切らない', () => {
    // Arrange
    const sql = "select q'[a;b]' from dual"

    // Act
    const statements = splitStatements(sql)

    // Assert
    expect(statements.map((s) => s.text)).toEqual(["select q'[a;b]' from dual"])
  })

  it('引用符リテラルは括弧以外の区切り文字も使える', () => {
    // Arrange
    const sql = "select q'#a;b#' from dual"

    // Act
    const statements = splitStatements(sql)

    // Assert
    expect(statements).toHaveLength(1)
  })

  it('識別子の末尾の q は引用符リテラルの始まりと見なさない', () => {
    // Arrange
    const sql = "select abcq from dual where x = 'y'; select 2 from dual"

    // Act
    const statements = splitStatements(sql)

    // Assert
    expect(statements).toHaveLength(2)
  })

  it('無名 PL_SQL ブロックの中のセミコロンでは切らない', () => {
    // Arrange
    const sql = 'begin null; null; end;'

    // Act
    const statements = splitStatements(sql)

    // Assert
    expect(statements.map((s) => s.text)).toEqual(['begin null; null; end'])
  })

  it('DECLARE 部のセミコロンでは切らない', () => {
    // Arrange
    const sql = 'declare v number; begin v := 1; end;'

    // Act
    const statements = splitStatements(sql)

    // Assert
    expect(statements).toHaveLength(1)
  })

  it('入れ子になった BEGIN と END を数え合わせる', () => {
    // Arrange
    const sql = 'begin begin null; end; null; end;'

    // Act
    const statements = splitStatements(sql)

    // Assert
    expect(statements).toHaveLength(1)
  })

  it('END IF は入れ子を深くしない', () => {
    // Arrange
    const sql = 'begin if 1 = 1 then null; end if; end;'

    // Act
    const statements = splitStatements(sql)

    // Assert
    expect(statements).toHaveLength(1)
  })

  it('END LOOP は入れ子を深くしない', () => {
    // Arrange
    const sql = 'begin for i in 1 .. 3 loop null; end loop; end;'

    // Act
    const statements = splitStatements(sql)

    // Assert
    expect(statements).toHaveLength(1)
  })

  it('CREATE OR REPLACE FUNCTION を 1 文として扱う', () => {
    // Arrange
    const sql = [
      'create or replace function f return number is',
      '  v number;',
      'begin',
      '  v := 1;',
      '  return v;',
      'end;',
    ].join('\n')

    // Act
    const statements = splitStatements(sql)

    // Assert
    expect(statements).toHaveLength(1)
  })

  it('PL_SQL ブロックの後ろに続く SQL は別の文になる', () => {
    // Arrange
    const sql = 'begin null; end;\nselect 1 from dual;'

    // Act
    const statements = splitStatements(sql)

    // Assert
    expect(statements.map((s) => s.text)).toEqual(['begin null; end', 'select 1 from dual'])
  })

  it('CASE 式を含む問い合わせでも切れ目を誤らない', () => {
    // Arrange
    const sql = "select case when 1 = 1 then 'a' else 'b' end from dual; select 2 from dual"

    // Act
    const statements = splitStatements(sql)

    // Assert
    expect(statements).toHaveLength(2)
  })

  it('切り出した位置が元の文字列と対応する', () => {
    // Arrange
    const sql = '  select 1 from dual;  select 2 from dual'

    // Act
    const statements = splitStatements(sql)

    // Assert
    expect(sql.slice(statements[0].start, statements[0].end)).toBe('select 1 from dual')
    expect(sql.slice(statements[1].start, statements[1].end)).toBe('select 2 from dual')
  })
})

describe('statementAt', () => {
  it('カーソルを含む文を返す', () => {
    // Arrange
    const sql = 'select 1 from dual; select 2 from dual'
    const cursor = sql.indexOf('select 2')

    // Act
    const statement = statementAt(sql, cursor)

    // Assert
    expect(statement?.text).toBe('select 2 from dual')
  })

  it('文の末尾にカーソルがあるときはその文を返す', () => {
    // Arrange
    const sql = 'select 1 from dual; select 2 from dual'
    const cursor = 'select 1 from dual'.length

    // Act
    const statement = statementAt(sql, cursor)

    // Assert
    expect(statement?.text).toBe('select 1 from dual')
  })

  it('文と文の間にカーソルがあるときは直前の文を返す', () => {
    // Arrange
    const sql = 'select 1 from dual;\n\nselect 2 from dual'
    const cursor = sql.indexOf('\n\n') + 1

    // Act
    const statement = statementAt(sql, cursor)

    // Assert
    expect(statement?.text).toBe('select 1 from dual')
  })

  it('先頭の空白にカーソルがあるときは最初の文を返す', () => {
    // Arrange
    const sql = '\n\nselect 1 from dual'

    // Act
    const statement = statementAt(sql, 0)

    // Assert
    expect(statement?.text).toBe('select 1 from dual')
  })

  it('コメントだけの断片は文として扱わない', () => {
    // Arrange
    const sql = '-- 説明だけの行\n;\nselect 1 from dual'

    // Act
    const statement = statementAt(sql, 0)

    // Assert
    expect(statement?.text).toBe('select 1 from dual')
  })

  it('文が 1 つも無いときは null を返す', () => {
    // Arrange
    const sql = '   \n  -- コメントだけ\n'

    // Act
    const statement = statementAt(sql, 0)

    // Assert
    expect(statement).toBeNull()
  })
})

describe('isSelectStatement', () => {
  it('select で始まる文は問い合わせと判定する', () => {
    // Arrange
    const sql = 'select * from users'

    // Act
    const result = isSelectStatement(sql)

    // Assert
    expect(result).toBe(true)
  })

  it('with で始まる文も問い合わせと判定する', () => {
    // Arrange
    const sql = 'with recent as (select 1 from dual) select * from recent'

    // Act
    const result = isSelectStatement(sql)

    // Assert
    expect(result).toBe(true)
  })

  it('先頭のコメントを飛ばして判定する', () => {
    // Arrange
    const sql = '-- 説明\n/* 補足 */ select 1 from dual'

    // Act
    const result = isSelectStatement(sql)

    // Assert
    expect(result).toBe(true)
  })

  it('update で始まる文は問い合わせではないと判定する', () => {
    // Arrange
    const sql = "update users set display_name = 'a'"

    // Act
    const result = isSelectStatement(sql)

    // Assert
    expect(result).toBe(false)
  })

  it('無名 PL_SQL ブロックは問い合わせではないと判定する', () => {
    // Arrange
    const sql = 'begin say_hello; end;'

    // Act
    const result = isSelectStatement(sql)

    // Assert
    expect(result).toBe(false)
  })

  it('selected_at のような語で始まっても問い合わせとは判定しない', () => {
    // Arrange
    const sql = 'selectx 1 from dual'

    // Act
    const result = isSelectStatement(sql)

    // Assert
    expect(result).toBe(false)
  })
})

describe('collectBindVariables', () => {
  it('バインド変数を出てきた順に集める', () => {
    // Arrange
    const sql = 'select * from users where id = :id and name = :name'

    // Act
    const names = collectBindVariables(sql)

    // Assert
    expect(names).toEqual(['id', 'name'])
  })

  it('バインド変数が無ければ空の一覧を返す', () => {
    // Arrange
    const sql = 'select 1 from dual'

    // Act
    const names = collectBindVariables(sql)

    // Assert
    expect(names).toEqual([])
  })

  it('同じ名前は 1 つにまとめる', () => {
    // Arrange
    const sql = 'select * from events where from_id = :id or to_id = :id'

    // Act
    const names = collectBindVariables(sql)

    // Assert
    expect(names).toEqual(['id'])
  })

  it('大文字小文字だけが違う名前も同じものとして 1 つにまとめる', () => {
    // Arrange
    const sql = 'select * from users where id = :id and parent_id = :ID'

    // Act
    const names = collectBindVariables(sql)

    // Assert
    expect(names).toEqual(['id'])
  })

  it('文字列リテラルの中のコロンは拾わない', () => {
    // Arrange
    const sql = "select '10:30' from users where id = :id"

    // Act
    const names = collectBindVariables(sql)

    // Assert
    expect(names).toEqual(['id'])
  })

  it('二重の引用符で表した文字列中のコロンも拾わない', () => {
    // Arrange
    const sql = "select 'it''s :notabind' from dual"

    // Act
    const names = collectBindVariables(sql)

    // Assert
    expect(names).toEqual([])
  })

  it('引用符で囲まれた識別子の中のコロンは拾わない', () => {
    // Arrange
    const sql = 'select "a:b" from users where id = :id'

    // Act
    const names = collectBindVariables(sql)

    // Assert
    expect(names).toEqual(['id'])
  })

  it('行コメントの中のコロンは拾わない', () => {
    // Arrange
    const sql = '-- :commented を無視する\nselect * from users where id = :id'

    // Act
    const names = collectBindVariables(sql)

    // Assert
    expect(names).toEqual(['id'])
  })

  it('ブロックコメントの中のコロンは拾わない', () => {
    // Arrange
    const sql = '/* :commented */ select * from users where id = :id'

    // Act
    const names = collectBindVariables(sql)

    // Assert
    expect(names).toEqual(['id'])
  })

  it('引用符リテラルの中のコロンは拾わない', () => {
    // Arrange
    const sql = "select q'[a:b それと :c]' from users where id = :id"

    // Act
    const names = collectBindVariables(sql)

    // Assert
    expect(names).toEqual(['id'])
  })

  it('コロンが連続する形は変数として扱わない', () => {
    // Arrange
    const sql = 'select value::text from settings'

    // Act
    const names = collectBindVariables(sql)

    // Assert
    expect(names).toEqual([])
  })

  it('pl_sql の代入記号は変数として扱わない', () => {
    // Arrange
    const sql = 'begin total := 0; end;'

    // Act
    const names = collectBindVariables(sql)

    // Assert
    expect(names).toEqual([])
  })

  it('pl_sql のラベルは変数として扱わない', () => {
    // Arrange
    const sql = 'begin <<outer_loop>> for r in (select 1 from dual) loop null; end loop; end;'

    // Act
    const names = collectBindVariables(sql)

    // Assert
    expect(names).toEqual([])
  })

  it('番号で表したバインド変数も集める', () => {
    // Arrange
    const sql = 'select * from users where id = :1'

    // Act
    const names = collectBindVariables(sql)

    // Assert
    expect(names).toEqual(['1'])
  })

  it('pl_sql ブロックの中のバインド変数も集める', () => {
    // Arrange
    const sql = 'begin dbms_output.put_line(:message); end;'

    // Act
    const names = collectBindVariables(sql)

    // Assert
    expect(names).toEqual(['message'])
  })

  it('名前に使えない文字が続くコロンは変数として扱わない', () => {
    // Arrange
    const sql = 'select * from users where id = : and name = :name'

    // Act
    const names = collectBindVariables(sql)

    // Assert
    expect(names).toEqual(['name'])
  })

  it('下線や記号を含む名前も 1 つの変数として読み取る', () => {
    // Arrange
    const sql = 'select * from users where id = :user_id$1'

    // Act
    const names = collectBindVariables(sql)

    // Assert
    expect(names).toEqual(['user_id$1'])
  })
})

describe('collectBindVariablesAcross', () => {
  it('複数の文から名前を出てきた順に集める', () => {
    // Arrange
    const statements = ['insert into t values (:id)', 'update t set name = :name where id = :id']

    // Act
    const names = collectBindVariablesAcross(statements)

    // Assert
    expect(names).toEqual(['id', 'name'])
  })

  it('大文字小文字が違うだけの名前は 1 つにまとめる', () => {
    // Arrange
    const statements = ['select * from t where id = :ID', 'delete from t where id = :id']

    // Act
    const names = collectBindVariablesAcross(statements)

    // Assert
    expect(names).toEqual(['ID'])
  })

  it('バインド変数が無ければ空になる', () => {
    // Arrange
    const statements = ['select 1 from dual', 'commit']

    // Act
    const names = collectBindVariablesAcross(statements)

    // Assert
    expect(names).toEqual([])
  })
})

describe('collectBindOccurrences', () => {
  it('比べている列の名前を大文字で添える', () => {
    // Arrange
    const sql = 'select * from users where user_id = :id'

    // Act
    const occurrences = collectBindOccurrences(sql)

    // Assert
    expect(occurrences).toEqual([{ name: 'id', column: 'USER_ID' }])
  })

  it('等号以外の比較演算子でも列を拾う', () => {
    // Arrange
    const sql = 'select * from events where created_at >= :from and duration_ms <> :d'

    // Act
    const occurrences = collectBindOccurrences(sql)

    // Assert
    expect(occurrences).toEqual([
      { name: 'from', column: 'CREATED_AT' },
      { name: 'd', column: 'DURATION_MS' },
    ])
  })

  it('like と between でも列を拾う', () => {
    // Arrange
    const sql = 'select * from t where name not like :p and created_on between :from and :to'

    // Act
    const occurrences = collectBindOccurrences(sql)

    // Assert
    expect(occurrences).toEqual([
      { name: 'p', column: 'NAME' },
      { name: 'from', column: 'CREATED_ON' },
      { name: 'to', column: 'CREATED_ON' },
    ])
  })

  it('修飾された列は最後の部分を名前とする', () => {
    // Arrange
    const sql = 'select * from users u where u.user_id = :id'

    // Act
    const occurrences = collectBindOccurrences(sql)

    // Assert
    expect(occurrences).toEqual([{ name: 'id', column: 'USER_ID' }])
  })

  it('関数を挟んだ形では列を拾わない', () => {
    // Arrange: 取り違えて誤った型を既定にするくらいなら推し量らない
    const sql = 'select * from t where created_at = trunc(:d)'

    // Act
    const occurrences = collectBindOccurrences(sql)

    // Assert
    expect(occurrences).toEqual([{ name: 'd', column: null }])
  })

  it('比較の形になっていなければ列は付かない', () => {
    // Arrange
    const sql = 'insert into t (id) values (:id)'

    // Act
    const occurrences = collectBindOccurrences(sql)

    // Assert
    expect(occurrences).toEqual([{ name: 'id', column: null }])
  })

  it('同じ名前が何度出てくればその数だけ並ぶ', () => {
    // Arrange
    const sql = 'select * from t where a = :x or b = :x'

    // Act
    const occurrences = collectBindOccurrences(sql)

    // Assert
    expect(occurrences).toEqual([
      { name: 'x', column: 'A' },
      { name: 'x', column: 'B' },
    ])
  })

  it('文字列リテラルやコメントの中は拾わない', () => {
    // Arrange
    const sql = "select ':x' -- id = :y\nfrom t where id = :z"

    // Act
    const occurrences = collectBindOccurrences(sql)

    // Assert
    expect(occurrences).toEqual([{ name: 'z', column: 'ID' }])
  })
})

describe('collectBindOccurrencesAcross', () => {
  it('複数の文から場所を文の順に集める', () => {
    // Arrange
    const statements = [
      'select * from t where id = :id',
      'update t set memo = :memo where id = :id',
    ]

    // Act
    const occurrences = collectBindOccurrencesAcross(statements)

    // Assert
    expect(occurrences).toEqual([
      { name: 'id', column: 'ID' },
      { name: 'memo', column: 'MEMO' },
      { name: 'id', column: 'ID' },
    ])
  })
})
