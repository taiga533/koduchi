/**
 * テーブル定義ビューの絞り込み（ADR 0019）。
 *
 * 列が数百ある表は珍しくない。定義ビューを開いてから目当ての列まで
 * スクロールで探させるのでは、SQL を書く前の確認という用途に足りない。
 *
 * 絞り込みは列だけでなく制約と索引にも当てる。「この列にどんな制約が
 * 付いているか」「この列で引ける索引はあるか」は同じ 1 つの問いであり、
 * タブごとに語を打ち直させる理由が無いためである。
 *
 * どの関数も毎回新しい配列を作る。呼び出し側で `useMemo` に包むこと。
 */

import type { TableColumn, TableConstraint, TableIndex } from '../../types/db'

/**
 * 絞り込み語を突き合わせに使う形へ整える。
 *
 * 前後の空白を落として小文字へ畳む。空の語は「絞り込まない」を意味する。
 *
 * @param search 入力された語
 */
export function normalizeNeedle(search: string): string {
  return search.trim().toLowerCase()
}

/**
 * いずれかの値が語を含むか。
 *
 * `null` と `undefined` は空文字列として扱う。
 *
 * @param values 突き合わせる値
 * @param needle 整えた絞り込み語
 */
function 当たる(values: (string | null | undefined)[], needle: string): boolean {
  return values.some((value) => (value ?? '').toLowerCase().includes(needle))
}

/**
 * 語に当てはまる列だけを返す。
 *
 * 列名と型名とコメントに当てる。型名にも当てるのは、`CLOB` の列や
 * `TIMESTAMP` の列をまとめて見たい場面があるためである。
 *
 * **コメントにも当てるのがこの絞り込みの要である（ADR 0033）。**日本語の
 * 業務システムでは物理名が `T_JUCHU_MEISAI` で論理名がコメントに入っている
 * ことが珍しくなく、利用者が知っているのは論理名のほうである。物理名でしか
 * 引けない絞り込みは、その利用者にとって無いのと変わらない。
 *
 * @param columns 対象の列
 * @param search 絞り込み語
 */
export function filterColumns(columns: TableColumn[], search: string): TableColumn[] {
  const needle = normalizeNeedle(search)
  if (needle === '') {
    return columns
  }

  return columns.filter((column) => 当たる([column.name, column.typeName, column.comment], needle))
}

/**
 * コメントの付いた列が 1 つでもあるか（ADR 0033）。
 *
 * 1 つも無いときは、列の内訳にコメントの欄そのものを出さない。コメントを
 * 使っていないデータベースで、`—` だけが並ぶ欄に幅を取られ続けないためである。
 * **判定は絞り込む前の全列で行う。**絞り込むたびに欄が現れたり消えたりすると、
 * 表の形が語の打鍵ごとに変わる。
 *
 * コピー（`definitionCopy.ts`）も同じ判定を通す。写すのは画面に出ているもの
 * だからである。
 *
 * @param columns 絞り込む前の全列
 */
export function hasColumnComments(columns: TableColumn[]): boolean {
  return columns.some((column) => (column.comment ?? '') !== '')
}

/**
 * 語に当てはまる制約だけを返す。
 *
 * 制約名・掛かっている列・参照先の表と列・検査条件に当てる。列名で引けることが
 * 肝心である。「この列は何かの外部キーか」を確かめるのが主な使い道だからである。
 *
 * @param constraints 対象の制約
 * @param search 絞り込み語
 */
export function filterConstraints(
  constraints: TableConstraint[],
  search: string,
): TableConstraint[] {
  const needle = normalizeNeedle(search)
  if (needle === '') {
    return constraints
  }

  return constraints.filter((constraint) =>
    当たる(
      [
        constraint.name,
        ...constraint.columns,
        constraint.referencedTable,
        ...constraint.referencedColumns,
        constraint.searchCondition,
      ],
      needle,
    ),
  )
}

/**
 * 語に当てはまる索引だけを返す。
 *
 * 索引名と並べている列に当てる。
 *
 * @param indexes 対象の索引
 * @param search 絞り込み語
 */
export function filterIndexes(indexes: TableIndex[], search: string): TableIndex[] {
  const needle = normalizeNeedle(search)
  if (needle === '') {
    return indexes
  }

  return indexes.filter((index) =>
    当たる([index.name, ...index.columns.map((column) => column.name)], needle),
  )
}

/**
 * 索引の列を `A, B DESC` の形に並べる。
 *
 * 降順の列にだけ `DESC` を添える。すべてに `ASC` を書くと、目で追うときに
 * 降順が埋もれる。
 *
 * @param index 対象の索引
 */
export function formatIndexColumns(index: TableIndex): string {
  return index.columns
    .map((column) => (column.descending ? `${column.name} DESC` : column.name))
    .join(', ')
}

/**
 * 外部キーの参照先を `KODUCHI.ORDERS (ORDER_ID)` の形にする。
 *
 * 参照先が見えない（権限が無い）ときは `null` を返す。名前が読めないまま
 * 括弧だけを出すより、参照先が分からないことを表に出すほうがよい。
 *
 * @param constraint 対象の制約
 */
export function formatReference(constraint: TableConstraint): string | null {
  if (constraint.referencedTable === null) {
    return null
  }

  const 表 = constraint.referencedOwner
    ? `${constraint.referencedOwner}.${constraint.referencedTable}`
    : constraint.referencedTable

  if (constraint.referencedColumns.length === 0) {
    return 表
  }

  return `${表} (${constraint.referencedColumns.join(', ')})`
}
