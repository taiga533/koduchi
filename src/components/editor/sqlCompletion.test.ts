import { describe, expect, it } from 'vitest'
import { CompletionContext } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import type { SchemaNode, TableColumn } from '../../types/db'
import { buildCatalog } from './catalog'
import { koduchiOracleDialect } from './dialect'
import { sqlCompletionSource } from './sqlCompletion'

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

const スキーマ一覧 = [
  スキーマ('KODUCHI', ['USERS', 'ORDERS', 'MyTable']),
  スキーマ('ANALYTICS', ['DAILY_GMV']),
]

const 列一覧: Record<string, TableColumn[]> = {
  KODUCHI: [
    列('USERS', 'USER_ID'),
    列('USERS', 'EMAIL'),
    列('ORDERS', 'ORDER_ID'),
    列('ORDERS', 'USER_ID'),
  ],
  ANALYTICS: [列('DAILY_GMV', 'GMV')],
}

const カタログ = buildCatalog(スキーマ一覧, 列一覧, 'KODUCHI')

/**
 * `|` の位置にカーソルを置いて補完を走らせ、候補のラベルを返す。
 *
 * @param sql `|` を 1 つ含む SQL
 * @param style 挿入したい識別子の綴り
 */
function 補完する(sql: string, style: 'lower' | 'upper' | 'preserve' = 'preserve') {
  const pos = sql.indexOf('|')
  const doc = sql.replace('|', '')
  const state = EditorState.create({ doc, extensions: [koduchiOracleDialect.language] })
  const context = new CompletionContext(state, pos, true)
  const result = sqlCompletionSource(カタログ, style)(context)
  return {
    result,
    labels: result?.options.map((option) => option.label) ?? [],
    /** ラベルで候補を 1 つ取り出す。 */
    候補: (label: string) => result?.options.find((option) => option.label === label),
  }
}

describe('sqlCompletionSource', () => {
  it('小文字で修飾してもスキーマの表が出る', () => {
    // Arrange: lang-sql の補完はここで候補を 1 件も返さない

    // Act
    const { labels } = 補完する('select * from analytics.|')

    // Assert
    expect(labels).toContain('DAILY_GMV')
  })

  it('大文字で修飾しても同じ表が出る', () => {
    // Arrange

    // Act
    const { labels } = 補完する('select * from ANALYTICS.|')

    // Assert
    expect(labels).toContain('DAILY_GMV')
  })

  it('小文字を選ぶと引用符なしの小文字で挿入される', () => {
    // Arrange

    // Act
    const { 候補 } = 補完する('select * from analytics.|', 'lower')

    // Assert
    expect(候補('daily_gmv')?.apply).toBeUndefined()
  })

  it('カタログのままを選ぶと大文字で挿入される', () => {
    // Arrange

    // Act
    const { 候補 } = 補完する('select * from analytics.|', 'preserve')

    // Assert
    expect(候補('DAILY_GMV')?.apply).toBeUndefined()
  })

  it('引用符が要る名前だけが引用符付きで挿入される', () => {
    // Arrange: `"MyTable"` は無引用で書くと別の名前になる

    // Act
    const { 候補 } = 補完する('select * from koduchi.|', 'lower')

    // Assert
    expect(候補('MyTable')?.apply).toBe('"MyTable"')
  })

  it('修飾のない位置には既定スキーマの表とスキーマ名が出る', () => {
    // Arrange

    // Act
    const { labels } = 補完する('select * from |')

    // Assert
    expect(labels).toContain('ORDERS')
    expect(labels).toContain('ANALYTICS')
  })

  it('修飾のない位置に他スキーマの表は出さない', () => {
    // Arrange: DAILY_GMV は ANALYTICS にしかない

    // Act
    const { labels } = 補完する('select * from |')

    // Assert
    expect(labels).not.toContain('DAILY_GMV')
  })

  it('FROM 句の表の列が修飾なしで出る', () => {
    // Arrange

    // Act
    const { labels } = 補完する('select | from orders')

    // Assert
    expect(labels).toContain('ORDER_ID')
  })

  it('FROM 句の表の列は表名より上に並ぶ', () => {
    // Arrange

    // Act
    const { 候補 } = 補完する('select | from orders')

    // Assert
    expect(候補('ORDER_ID')?.boost).toBeGreaterThan(候補('USERS')?.boost ?? 0)
  })

  it('別名で修飾すると元の表の列が出る', () => {
    // Arrange

    // Act
    const { labels } = 補完する('select o.| from orders o')

    // Assert
    expect(labels).toEqual(['ORDER_ID', 'USER_ID'])
  })

  it('AS を挟んだ別名でも元の表の列が出る', () => {
    // Arrange

    // Act
    const { labels } = 補完する('select o.| from orders as o')

    // Assert
    expect(labels).toEqual(['ORDER_ID', 'USER_ID'])
  })

  it('結合した表の別名もそれぞれ引ける', () => {
    // Arrange

    // Act
    const { labels } = 補完する('select u.| from orders o join users u on o.user_id = u.user_id')

    // Assert
    expect(labels).toEqual(['USER_ID', 'EMAIL'])
  })

  it('結合条件の識別子を表と取り違えない', () => {
    // Arrange: `on o.user_id = u.user_id` の識別子は表ではない

    // Act
    const { 候補 } = 補完する(
      'select | from orders o join users u on o.user_id = u.user_id where 1 = 1',
    )

    // Assert: 別名は 2 つだけで、結合条件から拾った別名は無い
    expect(候補('o')).toBeDefined()
    expect(候補('u')).toBeDefined()
    expect(候補('user_id')).toBeUndefined()
  })

  it('カンマで並べた表の列も出る', () => {
    // Arrange

    // Act
    const { labels } = 補完する('select | from orders o, analytics.daily_gmv g')

    // Assert
    expect(labels).toContain('GMV')
  })

  it('WHERE より後ろの語を表と取り違えない', () => {
    // Arrange

    // Act
    const { 候補 } = 補完する('select * from orders where user_id = 1 and |')

    // Assert
    expect(候補('ORDER_ID')).toBeDefined()
    expect(候補('user_id')).toBeUndefined()
  })

  it('スキーマで修飾した表の列が出る', () => {
    // Arrange

    // Act
    const { labels } = 補完する('select analytics.daily_gmv.| from analytics.daily_gmv')

    // Assert
    expect(labels).toEqual(['GMV'])
  })

  it('引用符の中では綴りを変えずに候補を出す', () => {
    // Arrange
    const style = 'lower'

    // Act
    const { labels } = 補完する('select * from koduchi."|', style)

    // Assert
    expect(labels).toContain('"MyTable"')
  })

  it('解決できない名前で修飾したら候補を出さない', () => {
    // Arrange

    // Act
    const { result } = 補完する('select * from nowhere.|')

    // Assert
    expect(result).toBeNull()
  })

  it('UPDATE の SET 句で対象の表の列が出る', () => {
    // Arrange: `FROM` 句しか見ていなかったころは 1 件も出なかった

    // Act
    const { labels } = 補完する('update orders set |')

    // Assert
    expect(labels).toContain('ORDER_ID')
  })

  it('UPDATE の列は表名より上に並ぶ', () => {
    // Arrange

    // Act
    const { 候補 } = 補完する('update orders set |')

    // Assert
    expect(候補('ORDER_ID')?.boost).toBeGreaterThan(候補('USERS')?.boost ?? 0)
  })

  it('INSERT の列並びで対象の表の列が出る', () => {
    // Arrange: 括弧が閉じていない

    // Act
    const { labels } = 補完する('insert into orders (|')

    // Assert
    expect(labels).toContain('ORDER_ID')
  })

  it('DELETE の WHERE 句で対象の表の列が出る', () => {
    // Arrange

    // Act
    const { labels } = 補完する('delete from orders where |')

    // Assert
    expect(labels).toContain('ORDER_ID')
  })

  it('UPDATE の別名で修飾しても列が出る', () => {
    // Arrange

    // Act
    const { labels } = 補完する('update orders o set o.|')

    // Assert
    expect(labels).toEqual(['ORDER_ID', 'USER_ID'])
  })

  it('WITH で定義した名前が表の候補に出る', () => {
    // Arrange

    // Act
    const { 候補 } = 補完する('with recent as (select order_id from orders) select * from |')

    // Assert: カタログの表と見分けが付くよう説明を分ける
    expect(候補('recent')?.detail).toBe('共通表式')
  })

  it('WITH で定義した名前の綴りは打たれたまま挿入する', () => {
    // Arrange: 利用者が打った名前であってカタログの名前ではない

    // Act
    const { 候補 } = 補完する(
      'with recent as (select order_id from orders) select * from |',
      'upper',
    )

    // Assert
    expect(候補('recent')?.apply).toBeUndefined()
  })

  it('WITH で定義した名前の列が修飾なしで出る', () => {
    // Arrange

    // Act
    const { labels } = 補完する('with recent as (select order_id from orders) select | from recent')

    // Assert
    expect(labels).toContain('ORDER_ID')
  })

  it('WITH で定義した名前で修飾しても列が出る', () => {
    // Arrange

    // Act
    const { labels } = 補完する(
      'with recent as (select order_id from orders) select recent.| from recent',
    )

    // Assert
    expect(labels).toEqual(['ORDER_ID'])
  })

  it('読めない列は候補に出さない', () => {
    // Arrange: `order_id + 1` に無引用で書ける列名は無い

    // Act
    const { 候補 } = 補完する(
      'with recent as (select order_id + 1 from orders) select | from recent',
    )

    // Assert
    expect(候補('ORDER_ID')).toBeUndefined()
  })

  it('副問い合わせの別名で修飾すると内側の列が出る', () => {
    // Arrange

    // Act
    const { labels } = 補完する('select t.| from (select order_id from orders) t')

    // Assert
    expect(labels).toEqual(['ORDER_ID'])
  })

  it('SET 句の 2 つめの代入でも列が出る', () => {
    // Arrange

    // Act
    const { labels } = 補完する('update orders set order_id = 1, |')

    // Assert
    expect(labels).toContain('USER_ID')
  })

  it('閉じていない括弧があっても列が出る', () => {
    // Arrange: 打鍵の途中は必ず構文として壊れている

    // Act
    const { labels } = 補完する('update orders set order_id = (|')

    // Assert
    expect(labels).toContain('ORDER_ID')
  })

  it('壊れた SQL でも例外を投げない', () => {
    // Arrange
    const 壊れた = [
      'update',
      'insert into',
      'with',
      'with x as (',
      'select * from (((',
      "delete from orders where name = 'unclosed",
      'merge into',
      ',,,,',
    ]

    // Act
    const 実行 = () => 壊れた.forEach((sql) => 補完する(`${sql}|`))

    // Assert
    expect(実行).not.toThrow()
  })

  it('明示されていない空の位置では候補を出さない', () => {
    // Arrange
    const doc = 'select * from orders where '
    const state = EditorState.create({ doc, extensions: [koduchiOracleDialect.language] })
    const context = new CompletionContext(state, doc.length, false)

    // Act
    const result = sqlCompletionSource(カタログ, 'preserve')(context)

    // Assert
    expect(result).toBeNull()
  })
})
