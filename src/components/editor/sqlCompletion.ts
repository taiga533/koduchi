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
 * `FROM` 句に出てくる表の列を非修飾で出すのもここで行う。`select ` まで打った
 * 時点で列名が出るかどうかが、補完の使い勝手をいちばん左右する。
 */

import { syntaxTree } from '@codemirror/language'
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import type { Text } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import type { IdentifierCase, ObjectKind } from '../../types/db'
import type { Catalog, CatalogObject } from './catalog'
import { findObject, findSchema, foldName, resolveObject } from './catalog'
import { styleIdentifier } from './identifiers'

/** 候補の続きとして認める文字。Oracle の識別子は `$` と `#` を含みうる。 */
const VALID_FOR = /^[\w$#]*$/

/** 引用符の中で打っているときに候補の続きとして認める文字。 */
const VALID_FOR_QUOTED = /^"?[\w$#]*"?$/

/** `FROM` 句の走査を終える語。ここから先に表は出てこない。 */
const END_FROM = new Set(
  'where group having order union intersect minus except limit offset fetch for connect start model pivot unpivot'.split(
    ' ',
  ),
)

/** 表と表の条件を繋ぐ語。ここから先はしばらく表が出てこない。 */
const CONDITION = new Set(['on', 'using'])

/** オブジェクトの種類ごとの、候補一覧に出すアイコンの種別。 */
const ICONS: Record<ObjectKind, string> = {
  table: 'class',
  view: 'class',
  materializedView: 'class',
  function: 'function',
  procedure: 'method',
  package: 'namespace',
  sequence: 'variable',
}

/** オブジェクトの種類ごとの説明文。 */
const KIND_LABELS: Record<ObjectKind, string> = {
  table: 'テーブル',
  view: 'ビュー',
  materializedView: 'マテリアライズドビュー',
  function: 'ファンクション',
  procedure: 'プロシージャ',
  package: 'パッケージ',
  sequence: 'シーケンス',
}

/** 候補の並び順。数が大きいほど上に出る。 */
const BOOST = {
  /** `FROM` 句の表の列。今書いている問い合わせに直接効くため最優先。 */
  fromColumn: 2,
  /** `FROM` 句で付けた別名。 */
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

/** `FROM` 句に現れた表 1 つ。 */
export interface TableRef {
  /** `スキーマ名.表名` を分解した名前の並び。 */
  path: string[]
  /** 付けられた別名。無ければ `null`。 */
  alias: string | null
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
  /** カーソルのある文。`FROM` 句を読むのに使う。 */
  statement: SyntaxNode | null
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
 * 識別子の節点かどうかを判定する。
 *
 * @param node 判定する節点
 */
function isIdentifier(node: SyntaxNode | null): boolean {
  return node !== null && (node.name === 'Identifier' || node.name === 'QuotedIdentifier')
}

/**
 * 識別子の節点から名前を取り出す。引用符は外す。
 *
 * @param doc 文書
 * @param node 識別子の節点
 */
function idName(doc: Text, node: SyntaxNode): string {
  const text = doc.sliceString(node.from, node.to)
  const quoted = /^"(.*)"$/.exec(text)
  return quoted ? quoted[1] : text
}

/**
 * 識別子の節点を名前の並びへ分解する。`A.B` は `["A", "B"]` になる。
 *
 * @param doc 文書
 * @param node 識別子または複合識別子の節点
 */
function pathFor(doc: Text, node: SyntaxNode): string[] {
  if (node.name === 'CompositeIdentifier') {
    const path: string[] = []
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (isIdentifier(child)) {
        path.push(idName(doc, child))
      }
    }
    return path
  }
  return [idName(doc, node)]
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
 * カーソルのある文を探す。
 *
 * 空白の上ではカーソルが文の外へ出る（文の範囲は最後のトークンで終わる）ため、
 * 祖先を辿るだけでは見つからない。そのときは直前の文を採る。ただし間に `;` が
 * あれば別の文が終わったということなので、何も返さない。
 *
 * @param doc 文書
 * @param node カーソル位置から解決した節点
 * @param pos カーソルの位置
 */
function statementOf(doc: Text, node: SyntaxNode, pos: number): SyntaxNode | null {
  for (let current: SyntaxNode | null = node; current; current = current.parent) {
    if (current.name === 'Statement') {
      return current
    }
  }

  for (let child = node.childBefore(pos); child; child = child.childBefore(pos)) {
    if (child.name === 'Statement') {
      return doc.sliceString(child.to, pos).includes(';') ? null : child
    }
  }

  return null
}

/**
 * 文の `FROM` 句に現れる表と別名を集める。
 *
 * 副問い合わせは括弧の中に入るため、この走査には引っ掛からない。外側の文の
 * `FROM` 句だけを見る。
 *
 * @param doc 文書
 * @param statement 対象の文
 */
export function tableRefs(doc: Text, statement: SyntaxNode | null): TableRef[] {
  if (!statement) {
    return []
  }

  const refs: TableRef[] = []
  let seenFrom = false
  /** 次に来る識別子が表の名前か。`FROM` と `JOIN` と `,` の直後で真になる。 */
  let expectingTable = false
  /** 直前に拾った表。次の識別子が別名ならここへ付ける。 */
  let last: TableRef | null = null

  for (let scan = statement.firstChild; scan; scan = scan.nextSibling) {
    const keyword =
      scan.name === 'Keyword' ? doc.sliceString(scan.from, scan.to).toLowerCase() : null

    if (!seenFrom) {
      if (keyword === 'from') {
        seenFrom = true
        expectingTable = true
      }
      continue
    }

    if (keyword) {
      if (END_FROM.has(keyword)) {
        break
      }
      if (keyword === 'join') {
        expectingTable = true
        last = null
      } else if (CONDITION.has(keyword)) {
        // 結合条件の中の識別子は表でも別名でもない。
        expectingTable = false
        last = null
      }
      // `as` や `left` / `outer` はそのまま読み飛ばす。表と別名の関係は変わらない。
      continue
    }

    if (scan.name === 'Punctuation' && doc.sliceString(scan.from, scan.to) === ',') {
      expectingTable = true
      last = null
      continue
    }

    if (isIdentifier(scan) || scan.name === 'CompositeIdentifier') {
      if (expectingTable) {
        last = { path: pathFor(doc, scan), alias: null }
        refs.push(last)
        expectingTable = false
      } else if (last && last.alias === null) {
        last.alias = idName(doc, scan)
        last = null
      }
      continue
    }

    // 副問い合わせや関数呼び出し。表の場所を埋めたものとして扱う。
    expectingTable = false
    last = null
  }

  return refs
}

/**
 * カーソルの位置から文脈を読み取る。
 *
 * @param context CodeMirror から渡される文脈
 */
function readContext(context: CompletionContext): TypingContext {
  const doc = context.state.doc
  const node = syntaxTree(context.state).resolveInner(context.pos, -1)
  const statement = statementOf(doc, node, context.pos)

  if (node.name === 'Identifier' || node.name === 'QuotedIdentifier' || node.name === 'Keyword') {
    return {
      from: node.from,
      quoted: node.name === 'QuotedIdentifier',
      parents: parentsFor(doc, tokenBefore(node)),
      empty: false,
      statement,
    }
  }

  if (node.name === '.') {
    return {
      from: context.pos,
      quoted: false,
      parents: parentsFor(doc, node),
      empty: false,
      statement,
    }
  }

  return { from: context.pos, quoted: false, parents: [], empty: true, statement }
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

/** 列 1 つを候補にする。 */
function columnCompletion(
  column: { name: string; typeName: string; nullable: boolean },
  style: NameStyle,
  detailSuffix: string,
  boost: number,
): Completion {
  const 必須 = column.nullable ? '' : ' NOT NULL'
  return nameCompletion(column.name, style, {
    type: 'property',
    detail: `${column.typeName}${必須}${detailSuffix}`,
    boost,
  })
}

/** オブジェクト 1 つを候補にする。 */
function objectCompletion(object: CatalogObject, style: NameStyle): Completion {
  return nameCompletion(object.name, style, {
    type: ICONS[object.kind],
    detail: KIND_LABELS[object.kind],
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
 * `FROM` 句から取れる候補を組み立てる。表の列と別名。
 *
 * 打っている文ごとに変わるため、呼ばれるたびに作り直す。数は高々「結合した表の
 * 列の合計」であり、静的な候補と違って大きくならない。
 *
 * @param catalog 引く先のカタログ
 * @param refs `FROM` 句に現れた表
 * @param style 候補の綴りの決め方
 */
function fromClauseOptions(catalog: Catalog, refs: TableRef[], style: NameStyle): Completion[] {
  const options: Completion[] = []
  /** 同じ名前の列を 2 度出さないための目印。 */
  const 出した列 = new Set<string>()

  for (const ref of refs) {
    const object = resolveObject(catalog, ref.path)
    if (!object) {
      continue
    }
    for (const column of object.columns) {
      if (出した列.has(foldName(column.name))) {
        continue
      }
      出した列.add(foldName(column.name))
      options.push(
        columnCompletion(column, style, ` · ${ref.alias ?? object.name}`, BOOST.fromColumn),
      )
    }
    if (ref.alias) {
      options.push({
        label: style.quoted ? `"${ref.alias}"` : ref.alias,
        type: 'constant',
        detail: object.name,
        boost: BOOST.alias,
      })
    }
  }

  return options
}

/**
 * `名前.` の右に出す候補を組み立てる。
 *
 * 名前は別名・スキーマ・表の順に解決する。どれでもなければ `null` を返し、
 * 候補を出さない（キーワードの補完は別のソースが出す）。
 *
 * @param catalog 引く先のカタログ
 * @param parents `.` の左側にある名前の並び
 * @param refs `FROM` 句に現れた表
 * @param style 挿入したい綴り
 */
function qualifiedOptions(
  catalog: Catalog,
  parents: string[],
  refs: TableRef[],
  style: NameStyle,
): Completion[] | null {
  if (parents.length === 1) {
    const alias = refs.find(
      (ref) => ref.alias !== null && foldName(ref.alias) === foldName(parents[0]),
    )
    if (alias) {
      const object = resolveObject(catalog, alias.path)
      return object
        ? object.columns.map((column) => columnCompletion(column, style, '', BOOST.fromColumn))
        : null
    }

    const schema = findSchema(catalog, parents[0])
    if (schema) {
      return [...schema.objects.values()].map((object) => objectCompletion(object, style))
    }

    const object = resolveObject(catalog, parents)
    return object
      ? object.columns.map((column) => columnCompletion(column, style, '', BOOST.fromColumn))
      : null
  }

  if (parents.length === 2) {
    const schema = findSchema(catalog, parents[0])
    const object = schema ? findObject(schema, parents[1]) : null
    return object
      ? object.columns.map((column) => columnCompletion(column, style, '', BOOST.fromColumn))
      : null
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
    const { from, quoted, parents, empty, statement } = readContext(context)
    if (empty && !context.explicit) {
      return null
    }

    const style: NameStyle = { identifierCase, quoted }
    const refs = tableRefs(context.state.doc, statement)

    let options: Completion[] | null
    if (parents.length === 0) {
      const key = quoted ? 'quoted' : 'plain'
      控え[key] ??= staticOptions(catalog, style)
      options = [...fromClauseOptions(catalog, refs, style), ...控え[key]]
    } else {
      options = qualifiedOptions(catalog, parents, refs, style)
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
