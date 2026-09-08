/**
 * バインド変数の型を推し量る（ADR 0016）。
 *
 * 既定の型は 2 つの手がかりから決める。1 つは変数が比べられている列の型で、
 * もう 1 つは入力された値の見た目である。列の型のほうが確かなので先に見る。
 *
 * どちらの手がかりも当てにならないときは `VARCHAR2` に落とす。誤った型を既定に
 * するより、これまでどおりの文字列で渡すほうが害が小さいためである。
 */

import type { BindKind, TableColumn } from '../types/db'
import type { BindOccurrence } from './statements'

/** 数値として読める書き方。符号・小数点・指数を許す。 */
const NUMBER_PATTERN = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/

/** 日付として読める書き方。`2024-01-02` と `2024/1/2`。 */
const DATE_PATTERN = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/

/** 時刻まで書かれた日付。`2024-01-02 03:04` や `2024-01-02T03:04:05.678`。 */
const TIMESTAMP_PATTERN = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?$/

/** 数値としてバインドする列の型名。前方一致で見る。 */
const NUMBER_TYPE_PREFIXES = [
  'NUMBER',
  'FLOAT',
  'INTEGER',
  'INT',
  'SMALLINT',
  'DECIMAL',
  'NUMERIC',
  'BINARY_FLOAT',
  'BINARY_DOUBLE',
]

/**
 * 列の型名から、バインドに使う型を決める。
 *
 * `TIMESTAMP(6) WITH TIME ZONE` のような時間帯付きの型も `TIMESTAMP` として
 * 扱う。ダイアログで時間帯は入力できないが、時間帯なしの値と比べれば
 * セッションの時間帯で解釈される。
 *
 * @param typeName `NUMBER(12,2)` のような列の型名
 */
export function bindKindOfColumnType(typeName: string): BindKind {
  const name = typeName.toUpperCase()

  if (name.startsWith('TIMESTAMP')) {
    return 'timestamp'
  }
  if (name.startsWith('DATE')) {
    return 'date'
  }
  if (NUMBER_TYPE_PREFIXES.some((prefix) => name.startsWith(prefix))) {
    return 'number'
  }
  return 'varchar2'
}

/**
 * 入力された値の見た目から型を推し量る。
 *
 * 時刻まで書かれていれば `TIMESTAMP`、年月日だけなら `DATE` と見なす。
 * どれにも当てはまらなければ `null` を返し、呼び出し側の既定に任せる。
 *
 * @param text 入力された値
 */
export function inferBindKindFromText(text: string): BindKind | null {
  const trimmed = text.trim()

  if (trimmed === '') {
    return null
  }
  if (NUMBER_PATTERN.test(trimmed)) {
    return 'number'
  }
  if (TIMESTAMP_PATTERN.test(trimmed)) {
    return 'timestamp'
  }
  if (DATE_PATTERN.test(trimmed)) {
    return 'date'
  }
  return null
}

/**
 * 値の見た目だけで決まる型を返す。読み取れなければ `VARCHAR2`。
 *
 * 利用者が型を選び直したかどうかの判定にも使う。今の型がこの関数の答えと
 * 同じであれば、まだ選び直していないと見なせる。
 *
 * @param text 入力された値
 */
export function autoBindKind(text: string): BindKind {
  return inferBindKindFromText(text) ?? 'varchar2'
}

/**
 * 取得済みの列から、列名で引ける型の表を作る。
 *
 * 同じ名前の列が別の表にあり、型が食い違う場合は `null` を入れる。どちらの表の
 * ことか分からないまま片方の型を採ると、黙って誤った型で実行してしまう。
 *
 * @param columns スキーマ名ごとの列情報（ADR 0007 の段階 2）
 *
 * @returns 大文字に揃えた列名で引く表。食い違う名前は `null`
 */
function buildColumnKinds(columns: Record<string, TableColumn[]>): Map<string, BindKind | null> {
  const kinds = new Map<string, BindKind | null>()

  for (const list of Object.values(columns)) {
    for (const column of list) {
      const key = column.name.toUpperCase()
      const kind = bindKindOfColumnType(column.typeName)

      if (!kinds.has(key)) {
        kinds.set(key, kind)
      } else if (kinds.get(key) !== kind) {
        kinds.set(key, null)
      }
    }
  }

  return kinds
}

/**
 * 変数ごとの既定の型を、比べている列の型から決める（ADR 0016）。
 *
 * 同じ変数が複数の場所で別々の型の列と比べられていたら、その変数は推し量らない。
 * 列がまだ読み込まれていなければ（ADR 0007 の段階 2 の途中）何も返らず、
 * 呼び出し側の既定に落ちる。
 *
 * @param occurrences バインド変数が出てきた場所
 * @param columns スキーマ名ごとの列情報
 *
 * @returns 大文字に揃えた変数名で引く型の表
 */
export function inferBindKinds(
  occurrences: BindOccurrence[],
  columns: Record<string, TableColumn[]>,
): Record<string, BindKind> {
  const columnKinds = buildColumnKinds(columns)
  const found = new Map<string, BindKind | null>()

  for (const { name, column } of occurrences) {
    if (column === null) {
      continue
    }
    const kind = columnKinds.get(column) ?? null
    if (kind === null) {
      continue
    }

    const key = name.toUpperCase()
    if (!found.has(key)) {
      found.set(key, kind)
    } else if (found.get(key) !== kind) {
      found.set(key, null)
    }
  }

  const kinds: Record<string, BindKind> = {}
  for (const [name, kind] of found) {
    if (kind !== null) {
      kinds[name] = kind
    }
  }
  return kinds
}
