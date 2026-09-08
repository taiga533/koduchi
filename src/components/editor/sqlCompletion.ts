/**
 * SQL の補完ソース（ADR 0013）。
 *
 * `@codemirror/lang-sql` の `schemaCompletionSource` は使わない。理由は 2 つある。
 *
 * 1. **階層の解決が大文字小文字を区別する。** Oracle のカタログは名前を大文字で
 *    持つため、`koduchi.` と小文字で打つと候補が 1 件も出ない。
 * 2. **挿入する綴りを決められない。** 候補の組み立てが内部の `nameCompletion` に
 *    閉じており、大文字の名前はすべて `"TABLE_NAME"` と引用符付きで挿入される。
 *
 * 代わりに構文木を自分で読み、畳んだ名前で `catalog.ts` を引き、綴りは
 * `identifiers.ts` に決めさせる。キーワードの補完は `lang-sql` のものを併用する
 * （こちらは大文字小文字の問題を持たない）。
 *
 * 「今どの表を相手にしているか」の読み取りは `sqlScope.ts` に寄せてある。ここは
 * カーソルの位置から文脈を読み、その結果を候補へ組み立てるところに徹する。
 */

import { syntaxTree } from '@codemirror/language'
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import type { Text } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import type { IdentifierCase, ObjectKind } from '../../types/db'
import { OBJECT_KIND_LABELS } from '../../types/db'
import type { Catalog, CatalogColumn, CatalogObject } from './catalog'
import { findObject, findSchema, foldName, resolveObject } from './catalog'
import { styleIdentifier } from './identifiers'
import type { Scope, ScopeSource } from './sqlScope'
import { idName, isIdentifier, matchesName, readScope } from './sqlScope'

/** 候補の続きとして認める文字。Oracle の識別子は `$` と `#` を含みうる。 */
const VALID_FOR = /^[\w$#]*$/

/** 引用符の中で打っているときに候補の続きとして認める文字。 */
const VALID_FOR_QUOTED = /^"?[\w$#]*"?$/

/** オブジェクトの種類ごとの、候補一覧に出すアイコンの種別。 */
const ICONS: Record<ObjectKind, string> = {
  table: 'class',
  view: 'class',
  materializedView: 'class',
  index: 'property',
  trigger: 'method',
  sequence: 'variable',
  synonym: 'class',
  type: 'type',
  function: 'function',
  procedure: 'method',
  package: 'namespace',
  databaseLink: 'namespace',
}

/** 候補の並び順。数が大きいほど上に出る。 */
const BOOST = {
  /** 見えている表の列。今書いている文に直接効くため最優先。 */
  column: 2,
  /** 別名と、その文が `WITH` で定義した名前。 */
  alias: 1,
  /** 既定スキーマの表。 */
  object: 0,
  /** スキーマ名。修飾したいときにしか要らない。 */
  schema: -1,
} as const

/** 候補の綴りの決め方。 */
interface NameStyle {
  /** 挿入したい識別子の綴り。 */
  identifierCase: IdentifierCase
  /**
   * 引用符の中で打っているか。
   *
   * 真なら綴りを変えず、カタログの綴りを引用符ごと候補に出す。利用者が自分で
   * 引用符を打ったのだから、その綴りを勝手に変えない。
   */
  quoted: boolean
}

/** 打っている場所から読み取った文脈。 */
interface TypingContext {
  /** 候補で置き換え始める位置。 */
  from: number
  /** 引用符の中で打っているか。 */
  quoted: boolean
  /** `.` の左側にある名前の並び。修飾していなければ空。 */
  parents: string[]
  /** 識別子でも `.` でもない位置か。 */
  empty: boolean
  /** カーソル位置から解決した節点。見えている表を読むのに使う。 */
  node: SyntaxNode
}

/**
 * 直前のトークンを取る。注釈は読み飛ばす。
 *
 * @param node 起点になる節点
 */
function tokenBefore(node: SyntaxNode): SyntaxNode {
  const cursor = node.cursor().moveTo(node.from, -1)
  while (cursor.name.endsWith('Comment')) {
    cursor.moveTo(cursor.from, -1)
  }
  return cursor.node
}

/**
 * `.` の連なりを遡り、修飾している名前の並びを取る。
 *
 * @param doc 文書
 * @param node `.` であることを期待する節点
 */
function parentsFor(doc: Text, node: SyntaxNode | null): string[] {
  const path: string[] = []
  let current = node
  for (;;) {
    if (!current || current.name !== '.') {
      return path
    }
    const name = tokenBefore(current)
    if (!isIdentifier(name)) {
      return path
    }
    path.unshift(idName(doc, name))
    current = tokenBefore(name)
  }
}

/**
 * カーソルの位置から文脈を読み取る。
 *
 * @param context CodeMirror から渡される文脈
 */
function readContext(context: CompletionContext): TypingContext {
  const doc = context.state.doc
  const node = syntaxTree(context.state).resolveInner(context.pos, -1)

  if (node.name === 'Identifier' || node.name === 'QuotedIdentifier' || node.name === 'Keyword') {
    return {
      from: node.from,
      quoted: node.name === 'QuotedIdentifier',
      parents: parentsFor(doc, tokenBefore(node)),
      empty: false,
      node,
    }
  }

  if (node.name === '.') {
    return {
      from: context.pos,
      quoted: false,
      parents: parentsFor(doc, node),
      empty: false,
      node,
    }
  }

  return { from: context.pos, quoted: false, parents: [], empty: true, node }
}

/**
 * 名前 1 つを候補にする。
 *
 * @param name カタログが持っている綴りの名前
 * @param style 挿入したい綴り
 * @param extra アイコン・説明・並び順
 */
function nameCompletion(
  name: string,
  style: NameStyle,
  extra: { type: string; detail: string; boost: number },
): Completion {
  if (style.quoted) {
    return { label: `"${name}"`, ...extra }
  }
  const styled = styleIdentifier(name, style.identifierCase)
  return { label: styled.label, apply: styled.apply, ...extra }
}

/**
 * 列 1 つを候補にする。
 *
 * 共通表式や副問い合わせが式へ別名を付けただけの列は型が分からない。そのときは
 * 型名が空で来るので、説明から丸ごと落とす（`sqlScope.ts`）。
 *
 * @param column 候補にする列
 * @param style 候補の綴りの決め方
 * @param qualifier 説明の右に添える表の名前。修飾済みの位置では空
 * @param boost 並び順
 */
function columnCompletion(
  column: CatalogColumn,
  style: NameStyle,
  qualifier: string,
  boost: number,
): Completion {
  const 必須 = column.nullable ? '' : ' NOT NULL'
  const 型 = column.typeName === '' ? '' : `${column.typeName}${必須}`
  return nameCompletion(column.name, style, {
    type: 'property',
    detail: [型, qualifier].filter((部分) => 部分 !== '').join(' · '),
    boost,
  })
}

/** オブジェクト 1 つを候補にする。 */
function objectCompletion(object: CatalogObject, style: NameStyle): Completion {
  return nameCompletion(object.name, style, {
    type: ICONS[object.kind],
    detail: OBJECT_KIND_LABELS[object.kind],
    boost: BOOST.object,
  })
}

/**
 * 文に依らない候補を組み立てる。既定スキーマのオブジェクトとスキーマ名。
 *
 * 既定スキーマに数万のオブジェクトがあると 1 回あたり数ミリ秒かかる。中身は
 * カタログと綴りだけで決まり打っている文には依らないため、呼び出し側で覚える。
 *
 * @param catalog 引く先のカタログ
 * @param style 候補の綴りの決め方
 */
function staticOptions(catalog: Catalog, style: NameStyle): Completion[] {
  const options: Completion[] = []

  if (catalog.defaultSchema) {
    for (const object of catalog.defaultSchema.objects.values()) {
      options.push(objectCompletion(object, style))
    }
  }

  for (const schema of catalog.schemas.values()) {
    options.push(
      nameCompletion(schema.name, style, {
        type: 'namespace',
        detail: 'スキーマ',
        boost: BOOST.schema,
      }),
    )
  }

  return options
}

/**
 * 表の出どころごとの説明。カタログの表は表名そのものが説明になる。
 */
const ORIGIN_LABELS: Record<ScopeSource['origin'], string> = {
  catalog: '',
  cte: '共通表式',
  subquery: '副問い合わせ',
}

/**
 * 見えている表から取れる候補を組み立てる。列・別名・`WITH` で定義した名前。
 *
 * 打っている文ごとに変わるため、呼ばれるたびに作り直す。数は高々「見えている表の
 * 列の合計」であり、静的な候補と違って大きくならない。
 *
 * @param scope 打っている場所から見えるもの
 * @param style 候補の綴りの決め方
 */
function scopeOptions(scope: Scope, style: NameStyle): Completion[] {
  const options: Completion[] = []
  /** 同じ名前の列を 2 度出さないための目印。 */
  const 出した列 = new Set<string>()

  for (const source of scope.sources) {
    for (const column of source.columns) {
      if (出した列.has(foldName(column.name))) {
        continue
      }
      出した列.add(foldName(column.name))
      options.push(columnCompletion(column, style, source.alias ?? source.name, BOOST.column))
    }
    if (source.aliasText !== null && source.alias !== null) {
      options.push({
        // 別名は利用者が打った綴りである。カタログの名前ではないので綴りを変えない。
        label: style.quoted ? `"${source.alias}"` : source.aliasText,
        type: 'constant',
        detail: ORIGIN_LABELS[source.origin] === '' ? source.name : ORIGIN_LABELS[source.origin],
        boost: BOOST.alias,
      })
    }
  }

  for (const cte of scope.ctes) {
    options.push({
      // 共通表式の名前も利用者が打った綴りである。
      label: style.quoted ? `"${cte.name}"` : cte.text,
      type: 'class',
      detail: ORIGIN_LABELS.cte,
      boost: BOOST.alias,
    })
  }

  return options
}

/**
 * `名前.` の右に出す候補を組み立てる。
 *
 * 名前は**別名 → 共通表式 → スキーマ → 表**の順に解決する。どれでもなければ
 * `null` を返し、候補を出さない（キーワードの補完は別のソースが出す）。
 *
 * 共通表式をスキーマより先に見るのは、`WITH` で定義した名前がその文の中では
 * 同じ名前の表より強いためである。逆にカタログの表より後ろに置くと、書きかけの
 * 文で `WITH` の名前が拾えないときに候補が消える。
 *
 * @param catalog 引く先のカタログ
 * @param scope 打っている場所から見えるもの
 * @param parents `.` の左側にある名前の並び
 * @param style 挿入したい綴り
 */
function qualifiedOptions(
  catalog: Catalog,
  scope: Scope,
  parents: string[],
  style: NameStyle,
): Completion[] | null {
  /** 列の並びを候補にする。1 件も無ければ `null`。 */
  const 列を出す = (columns: CatalogColumn[]) =>
    columns.length === 0
      ? null
      : columns.map((column) => columnCompletion(column, style, '', BOOST.column))

  if (parents.length === 1) {
    const alias = scope.sources.find(
      (source) => source.alias !== null && foldName(source.alias) === foldName(parents[0]),
    )
    if (alias) {
      return 列を出す(alias.columns)
    }

    const cte = scope.sources.find(
      (source) => source.origin === 'cte' && matchesName(source, parents[0]),
    )
    if (cte) {
      return 列を出す(cte.columns)
    }

    const schema = findSchema(catalog, parents[0])
    if (schema) {
      return [...schema.objects.values()].map((object) => objectCompletion(object, style))
    }

    const object = resolveObject(catalog, parents)
    return object ? 列を出す(object.columns) : null
  }

  if (parents.length === 2) {
    const schema = findSchema(catalog, parents[0])
    const object = schema ? findObject(schema, parents[1]) : null
    return object ? 列を出す(object.columns) : null
  }

  return null
}

/**
 * 補完ソースを作る。
 *
 * @param catalog 引く先のカタログ
 * @param style 挿入したい識別子の綴り
 */
export function sqlCompletionSource(catalog: Catalog, identifierCase: IdentifierCase) {
  /**
   * 文に依らない候補の控え。
   *
   * 引用符の中かどうかで綴りが変わるため、2 通りを別々に覚える。使われないほうは
   * 作らない。
   */
  const 控え: { plain?: Completion[]; quoted?: Completion[] } = {}

  return (context: CompletionContext): CompletionResult | null => {
    const { from, quoted, parents, empty, node } = readContext(context)
    if (empty && !context.explicit) {
      return null
    }

    const style: NameStyle = { identifierCase, quoted }
    const scope = readScope(context.state.doc, catalog, node, context.pos)

    let options: Completion[] | null
    if (parents.length === 0) {
      const key = quoted ? 'quoted' : 'plain'
      控え[key] ??= staticOptions(catalog, style)
      options = [...scopeOptions(scope, style), ...控え[key]]
    } else {
      options = qualifiedOptions(catalog, scope, parents, style)
    }

    if (options === null || options.length === 0) {
      return null
    }

    if (quoted) {
      // 閉じ引用符が既にあるなら候補で丸ごと置き換える。二重にしないためである。
      const 閉じ引用符が続く = context.state.sliceDoc(context.pos, context.pos + 1) === '"'
      return {
        from,
        to: 閉じ引用符が続く ? context.pos + 1 : undefined,
        options,
        validFor: VALID_FOR_QUOTED,
      }
    }

    return { from, options, validFor: VALID_FOR }
  }
}
