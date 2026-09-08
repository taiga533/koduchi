import { describe, expect, it } from 'vitest'
import { syntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import type { SchemaNode, TableColumn } from '../../types/db'
import { buildCatalog } from './catalog'
import { koduchiOracleDialect } from './dialect'
import { readScope } from './sqlScope'

/** スキーマ 1 つを組み立てる。 */
function スキーマ(name: string, objects: string[]): SchemaNode {
  return {
    name,
    objectCount: objects.length,
    objects: objects.map((objectName) => ({ name: objectName, kind: 'table' as const })),
  }
}

/** 列 1 つを組み立てる。 */
function 列(objectName: string, name: string): TableColumn {
  return { objectName, name, typeName: 'NUMBER(12)', nullable: true, kind: 'number' }
}

const カタログ = buildCatalog(
  [スキーマ('KODUCHI', ['EMP', 'ORDERS']), スキーマ('ANALYTICS', ['DAILY_GMV'])],
  {
    KODUCHI: [
      列('EMP', 'EMP_ID'),
      列('EMP', 'EMP_NAME'),
      列('EMP', 'SALARY'),
      列('ORDERS', 'ORDER_ID'),
      列('ORDERS', 'EMP_ID'),
    ],
    ANALYTICS: [列('DAILY_GMV', 'GMV')],
  },
  'KODUCHI',
)

/**
 * `|` の位置から見えるものを読む。
 *
 * @param sql `|` を 1 つ含む SQL
 */
function スコープを読む(sql: string) {
  const pos = sql.indexOf('|')
  const doc = sql.replace('|', '')
  const state = EditorState.create({ doc, extensions: [koduchiOracleDialect.language] })
  const node = syntaxTree(state).resolveInner(pos, -1)
  const scope = readScope(state.doc, カタログ, node, pos)
  return {
    scope,
    /** 見えている表の名前。 */
    表: scope.sources.map((source) => source.name),
    /** 見えている列の名前。 */
    列名: scope.sources.flatMap((source) => source.columns.map((column) => column.name)),
    /** `WITH` で定義された名前。 */
    CTE: scope.ctes.map((cte) => cte.name),
  }
}

describe('readScope', () => {
  it('UPDATE の対象の表が見える', () => {
    // Arrange: `SET` を打った直後は構文としても不完全である

    // Act
    const { 表, 列名 } = スコープを読む('update emp set |')

    // Assert
    expect(表).toEqual(['EMP'])
    expect(列名).toContain('SALARY')
  })

  it('UPDATE の別名も引ける', () => {
    // Arrange

    // Act
    const { scope } = スコープを読む('update emp e set |')

    // Assert
    expect(scope.sources[0].alias).toBe('e')
  })

  it('UPDATE のスキーマ修飾した表が見える', () => {
    // Arrange

    // Act
    const { 表 } = スコープを読む('update koduchi.emp set |')

    // Assert
    expect(表).toEqual(['EMP'])
  })

  it('UPDATE の SET より後ろの語を表と取り違えない', () => {
    // Arrange: `SET` から先は列と式であって表ではない

    // Act
    const { 表 } = スコープを読む('update emp set salary = 1 where |')

    // Assert
    expect(表).toEqual(['EMP'])
  })

  it('INSERT INTO の列並びの中で対象の表が見える', () => {
    // Arrange: 括弧が閉じていない

    // Act
    const { 表, 列名 } = スコープを読む('insert into emp (|')

    // Assert
    expect(表).toEqual(['EMP'])
    expect(列名).toContain('EMP_NAME')
  })

  it('INSERT の列並びの括弧を表と取り違えない', () => {
    // Arrange

    // Act
    const { 表 } = スコープを読む('insert into emp (emp_id, emp_name) values (|')

    // Assert
    expect(表).toEqual(['EMP'])
  })

  it('INSERT INTO SELECT では読み出し元の表も見える', () => {
    // Arrange

    // Act
    const { 表 } = スコープを読む('insert into emp select | from orders')

    // Assert
    expect(表).toEqual(['EMP', 'ORDERS'])
  })

  it('DELETE FROM の表が見える', () => {
    // Arrange

    // Act
    const { 表, 列名 } = スコープを読む('delete from emp where |')

    // Assert
    expect(表).toEqual(['EMP'])
    expect(列名).toContain('EMP_ID')
  })

  it('FROM を省いた DELETE でも表が見える', () => {
    // Arrange: Oracle は `DELETE emp` を許す

    // Act
    const { 表 } = スコープを読む('delete emp where |')

    // Assert
    expect(表).toEqual(['EMP'])
  })

  it('MERGE の対象と読み出し元の両方が見える', () => {
    // Arrange

    // Act
    const { 表 } = スコープを読む('merge into emp e using orders o on (|')

    // Assert
    expect(表).toEqual(['EMP', 'ORDERS'])
  })

  it('MERGE の WHEN より後ろの語を表と取り違えない', () => {
    // Arrange

    // Act
    const { 表 } = スコープを読む('merge into emp e using orders o on (1=1) when matched then |')

    // Assert
    expect(表).toEqual(['EMP', 'ORDERS'])
  })

  it('WITH で定義した名前の列が読める', () => {
    // Arrange

    // Act
    const { 表, 列名, CTE } = スコープを読む(
      'with recent as (select emp_id, emp_name from emp) select | from recent',
    )

    // Assert
    expect(CTE).toEqual(['recent'])
    expect(表).toEqual(['recent'])
    expect(列名).toEqual(['EMP_ID', 'EMP_NAME'])
  })

  it('WITH の列並びを明記したらそちらが列名になる', () => {
    // Arrange

    // Act
    const { 列名 } = スコープを読む(
      'with recent (p, q) as (select emp_id, emp_name from emp) select | from recent',
    )

    // Assert
    expect(列名).toEqual(['p', 'q'])
  })

  it('WITH の中の SELECT * は元の表の列に開かれる', () => {
    // Arrange

    // Act
    const { 列名 } = スコープを読む('with recent as (select * from emp) select | from recent')

    // Assert
    expect(列名).toEqual(['EMP_ID', 'EMP_NAME', 'SALARY'])
  })

  it('AS で別名を付けた式も列として読める', () => {
    // Arrange

    // Act
    const { 列名 } = スコープを読む(
      'with recent as (select count(*) as total, salary from emp) select | from recent',
    )

    // Assert
    expect(列名).toEqual(['total', 'SALARY'])
  })

  it('AS を省いた別名も列として読める', () => {
    // Arrange

    // Act
    const { 列名 } = スコープを読む(
      'with recent as (select trunc(hired_at) hired_day from emp) select | from recent',
    )

    // Assert
    expect(列名).toEqual(['hired_day'])
  })

  it('名前の付かない式は列として出さない', () => {
    // Arrange: `emp_id + salary` に無引用で書ける列名は無い

    // Act
    const { 列名 } = スコープを読む(
      'with recent as (select emp_id + salary, salary from emp) select | from recent',
    )

    // Assert
    expect(列名).toEqual(['SALARY'])
  })

  it('WITH を連ねると前の定義を後ろから引ける', () => {
    // Arrange

    // Act
    const { 列名, CTE } = スコープを読む(
      'with a as (select emp_id from emp), b as (select emp_id from a) select | from b',
    )

    // Assert
    expect(CTE).toEqual(['a', 'b'])
    expect(列名).toEqual(['EMP_ID'])
  })

  it('WITH の中で打っているときは内側の表が見える', () => {
    // Arrange: 外側の `recent` ではなく `emp` の列が要る

    // Act
    const { 表 } = スコープを読む('with recent as (select | from emp) select * from recent')

    // Assert
    expect(表).toEqual(['EMP'])
  })

  it('FROM 句の副問い合わせの列が別名で見える', () => {
    // Arrange

    // Act
    const { scope, 列名 } = スコープを読む('select | from (select emp_id, salary from emp) t')

    // Assert
    expect(scope.sources[0].origin).toBe('subquery')
    expect(scope.sources[0].alias).toBe('t')
    expect(列名).toEqual(['EMP_ID', 'SALARY'])
  })

  it('WHERE の中の副問い合わせでは内側の表が見える', () => {
    // Arrange

    // Act
    const { 表 } = スコープを読む('select * from emp where emp_id in (select | from orders)')

    // Assert
    expect(表).toEqual(['ORDERS'])
  })

  it('関数の引数の括弧は問い合わせと取り違えない', () => {
    // Arrange

    // Act
    const { 表 } = スコープを読む('select nvl(|, 0) from emp')

    // Assert
    expect(表).toEqual(['EMP'])
  })

  it('閉じていない引用符があっても表は見える', () => {
    // Arrange: 打鍵の途中は必ず構文として壊れている

    // Act
    const { 表 } = スコープを読む("update emp set emp_name = 'まだ閉じていない|")

    // Assert
    expect(表).toEqual(['EMP'])
  })

  it('閉じていない括弧が入れ子でも落ちない', () => {
    // Arrange

    // Act
    const { 表 } = スコープを読む('select * from (select * from (select * from emp where (|')

    // Assert
    expect(表).toEqual(['EMP'])
  })

  it('文が無ければ何も見えない', () => {
    // Arrange

    // Act
    const { 表, CTE } = スコープを読む('|')

    // Assert
    expect(表).toEqual([])
    expect(CTE).toEqual([])
  })

  it('前の文の表が次の文へ漏れない', () => {
    // Arrange

    // Act
    const { 表 } = スコープを読む('select * from orders; update emp set |')

    // Assert
    expect(表).toEqual(['EMP'])
  })

  it('解決できない表でも名前だけは残る', () => {
    // Arrange: カタログに `NOWHERE` は無い

    // Act
    const { 表, 列名 } = スコープを読む('update nowhere set |')

    // Assert
    expect(表).toEqual(['nowhere'])
    expect(列名).toEqual([])
  })
})
