/**
 * 打っている場所から見える表を読む（ADR 0013 の走査を広げたもの）。
 *
 * 補完が列を出すには「今どの表を相手にしているか」が要る。元は `FROM` 句だけを
 * 見ていたため、`UPDATE` や `INSERT` を書き始めた瞬間に列が 1 つも出なくなって
 * いた。同じ表を相手にしているのに補完の効き方が変わるのは、利用者から見れば
 * 壊れているのと変わらない。
 *
 * ここは**構文木を読んで表と列のあつまりを作る**ところに徹し、候補の組み立てと
 * 綴りの決定は `sqlCompletion.ts` と `identifiers.ts` に任せる。判定を純粋な関数へ
 * 寄せておくと、書きかけの壊れた SQL を並べたテストで見張れる。
 *
 * ## 読める形
 *
 * | 文             | 表の位置                                          |
 * | -------------- | ------------------------------------------------- |
 * | `SELECT`       | `FROM` / `JOIN` / `,` の直後                      |
 * | `UPDATE`       | 文の先頭の直後（`SET` まで）                      |
 * | `INSERT`       | `INTO` の直後                                     |
 * | `DELETE`       | 文の先頭の直後（`FROM` は省略できる）             |
 * | `MERGE`        | `INTO` と `USING` の直後（`WHEN` まで）           |
 *
 * 加えて `WITH` で定義した名前（共通表式）と `FROM` 句の副問い合わせを、
 * カタログの表と同じ「列のあつまり」として扱う。列は内側の選択リストから読む。
 *
 * ## 読めない形は読めないままにする
 *
 * 選択リストの項目から出力の列名が決まらないとき（`SELECT a + b` のように名前の
 * 付かない式）は、その列を**落とす**。名前を勝手に作って出すと、実行して初めて
 * `ORA-00904` になる候補を勧めることになる。列が 1 つも読めなくても名前だけは
 * 表の候補として出し、説明に「共通表式」「副問い合わせ」と書いて、カタログに
 * 実在する表と見分けが付くようにする。
 */

import type { Text } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import type { Catalog, CatalogColumn } from './catalog'
import { foldName, resolveObject } from './catalog'

/** 表の出どころ。候補の説明を分けるために持つ。 */
export type SourceOrigin = 'catalog' | 'cte' | 'subquery'

/** 打っている場所から見える「列のあつまり」1 つ。表・共通表式・副問い合わせ。 */
export interface ScopeSource {
  /** 候補の説明に出す名前。カタログの表なら表名、副問い合わせなら別名。 */
  name: string
  /** 付けられた別名。引用符は外してある。無ければ `null`。 */
  alias: string | null
  /** 別名を挿入するときの綴り。利用者が打ったままを返す。 */
  aliasText: string | null
  /** 読めた列。読めなければ空。 */
  columns: CatalogColumn[]
  origin: SourceOrigin
}

/** `WITH` で定義された名前 1 つ。 */
export interface CteDefinition {
  /** 引用符を外した名前。名前を引くのに使う。 */
  name: string
  /** 打たれたままの綴り。候補として挿入するのはこちら。 */
  text: string
  /** 内側の選択リストから読めた列。読めなければ空。 */
  columns: CatalogColumn[]
}

/** 打っている場所から見えるもの全体。 */
export interface Scope {
  /** 見えている列のあつまり。並びは書かれた順。 */
  sources: ScopeSource[]
  /** その文が `WITH` で定義した名前。表の候補として出す。 */
  ctes: CteDefinition[]
}

/** 何も見えていない場合。参照を固定して無駄な作り直しを避ける。 */
const EMPTY_SCOPE: Scope = { sources: [], ctes: [] }

/**
 * 副問い合わせを追いかける深さの上限。
 *
 * 補完は打鍵のたびに走るため、入れ子の深さに比例して重くなってはいけない。
 * 4 段も潜れば実務の問い合わせは足りる。
 */
const MAX_DEPTH = 4

/** どの文でも、この語から先に表は出てこない。 */
const END_COMMON = new Set(
  'where group having order union intersect minus except limit offset fetch for connect start model pivot unpivot'.split(
    ' ',
  ),
)

/** 表と表の条件を繋ぐ語。ここから先はしばらく表が出てこない。 */
const CONDITION = new Set(['on', 'using'])

/** 選択リストの先頭に置ける、列ではない語。 */
const SELECT_MODIFIERS = new Set(['distinct', 'unique', 'all'])

/** 文の種類。表の位置は種類ごとに違う。 */
type Verb = 'select' | 'update' | 'insert' | 'delete' | 'merge'

/** 表の位置の見つけ方。文の種類ごとに 1 つ持つ。 */
interface ScanRule {
  /** この語の直後が表の位置になる。 */
  arms: ReadonlySet<string>
  /** この語より先に表は出てこない。 */
  ends: ReadonlySet<string>
  /** 文の先頭の語の直後がいきなり表の位置か。 */
  armsAtStart: boolean
}

/**
 * 語の集合を足し合わせる。
 *
 * @param base 元になる集合
 * @param extra 足す語
 */
function 足す(base: ReadonlySet<string>, extra: string[]): ReadonlySet<string> {
  return new Set([...base, ...extra])
}

/**
 * 文の種類ごとの走査の規則。
 *
 * `UPDATE` と `DELETE` が `armsAtStart` なのは、この 2 つだけ「文の先頭の語の
 * 直後が表」だからである（`DELETE` の `FROM` は省略できる）。`INSERT` の列並びの
 * 括弧を表と取り違えないのは、`INTO` の直後の表で `arms` が下りているためである。
 */
const RULES: Record<Verb, ScanRule> = {
  select: { arms: new Set(['from', 'join']), ends: END_COMMON, armsAtStart: false },
  update: { arms: new Set(), ends: 足す(END_COMMON, ['set']), armsAtStart: true },
  insert: {
    arms: new Set(['into']),
    ends: 足す(END_COMMON, ['values', 'returning']),
    armsAtStart: false,
  },
  delete: { arms: new Set(['from']), ends: 足す(END_COMMON, ['returning']), armsAtStart: true },
  merge: {
    arms: new Set(['into', 'using']),
    ends: 足す(END_COMMON, ['when', 'returning']),
    armsAtStart: false,
  },
}

/**
 * 識別子の節点かどうかを判定する。
 *
 * @param node 判定する節点
 */
export function isIdentifier(node: SyntaxNode | null): boolean {
  return node !== null && (node.name === 'Identifier' || node.name === 'QuotedIdentifier')
}

/**
 * 識別子の節点から名前を取り出す。引用符は外す。
 *
 * @param doc 文書
 * @param node 識別子の節点
 */
export function idName(doc: Text, node: SyntaxNode): string {
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
 * 節点の綴りをそのまま取る。
 *
 * @param doc 文書
 * @param node 対象の節点
 */
function textOf(doc: Text, node: SyntaxNode): string {
  return doc.sliceString(node.from, node.to)
}

/**
 * キーワードなら小文字に畳んだ綴りを返す。キーワードでなければ `null`。
 *
 * @param doc 文書
 * @param node 対象の節点
 */
function keywordOf(doc: Text, node: SyntaxNode | undefined): string | null {
  return node && node.name === 'Keyword' ? textOf(doc, node).toLowerCase() : null
}

/**
 * 節点が語（キーワードか識別子）なら小文字に畳んだ綴りを返す。
 *
 * 文の先頭の語を見るときに使う。`MERGE` は `@codemirror/lang-sql` の `PLSQL`
 * 方言でキーワードとして登録されておらず、識別子として構文木に載る。
 *
 * @param doc 文書
 * @param node 対象の節点
 */
function wordOf(doc: Text, node: SyntaxNode): string | null {
  return node.name === 'Keyword' || node.name === 'Identifier'
    ? textOf(doc, node).toLowerCase()
    : null
}

/**
 * 文や括弧の中身を、直接の子の並びとして取り出す。
 *
 * 括弧そのものと文末の `;` は落とす。走査はどちらも同じ形の並びとして扱える。
 *
 * @param node 文または括弧の節点
 */
function bodyOf(node: SyntaxNode): SyntaxNode[] {
  const children: SyntaxNode[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === '(' || child.name === ')' || child.name === ';') {
      continue
    }
    children.push(child)
  }
  return children
}

/**
 * 括弧が問い合わせかどうかを判定する。
 *
 * 中身の先頭が `SELECT` か `WITH` なら問い合わせである。`INSERT` の列並びや
 * 関数の引数と見分けるために使う。
 *
 * @param doc 文書
 * @param node 判定する節点
 */
function isQueryParens(doc: Text, node: SyntaxNode): boolean {
  if (node.name !== 'Parens') {
    return false
  }
  const keyword = keywordOf(doc, bodyOf(node)[0])
  return keyword === 'select' || keyword === 'with'
}

/**
 * 文の種類を読む。
 *
 * 先頭の語だけを見る。`WITH` で始まる文は主問い合わせが `SELECT` であるため
 * `select` として扱う。
 *
 * @param doc 文書
 * @param children 文の直接の子
 */
function verbOf(doc: Text, children: SyntaxNode[]): Verb {
  for (const child of children) {
    const word = wordOf(doc, child)
    if (word === null) {
      continue
    }
    return word === 'update' || word === 'insert' || word === 'delete' || word === 'merge'
      ? word
      : 'select'
  }
  return 'select'
}

/**
 * 列の名前が一致するものを探す。大文字小文字は区別しない。
 *
 * @param sources 探す先
 * @param name 探す名前
 */
function findColumn(sources: ScopeSource[], name: string): CatalogColumn | null {
  const 鍵 = foldName(name)
  for (const source of sources) {
    for (const column of source.columns) {
      if (foldName(column.name) === 鍵) {
        return column
      }
    }
  }
  return null
}

/** 選択リストの項目 1 つから読み取れたもの。 */
type Item =
  { kind: 'name'; name: string } | { kind: 'star'; qualifier: string | null } | { kind: 'unknown' }

/**
 * 選択リストの項目 1 つから、出力の列名を読み取る。
 *
 * 読み取れるのは次の 3 つだけである。
 *
 * - `a` / `t.a` — 識別子 1 つ。最後の部分が列名になる
 * - `式 AS x` / `式 x` — 末尾の識別子が別名。ただし直前が演算子なら式の途中で
 *   あって別名ではない（`a + b` の `b` を列名と読まない）
 * - `*` / `t.*` — 元の表の列をそのまま並べる
 *
 * それ以外（`a + b` や `NVL(a, 0)` のように名前の付かない式）は `unknown` を
 * 返し、呼び出し側でその列を落とす。Oracle が付ける既定の列名（式の綴りその
 * もの）を真似ても、無引用では書けない名前になるため候補として役に立たない。
 *
 * @param doc 文書
 * @param tokens 項目 1 つぶんの節点の並び
 */
function selectItem(doc: Text, tokens: SyntaxNode[]): Item {
  if (tokens.length === 0) {
    return { kind: 'unknown' }
  }

  const last = tokens[tokens.length - 1]
  const prev = tokens.length >= 2 ? tokens[tokens.length - 2] : null

  if (last.name === 'Operator' && textOf(doc, last) === '*') {
    if (prev === null) {
      return { kind: 'star', qualifier: null }
    }
    // `e.*` は `e.` までが複合識別子になり、`*` はその外に出る。
    const path = tokens.length === 2 ? pathFor(doc, prev) : []
    return path.length === 1 ? { kind: 'star', qualifier: path[0] } : { kind: 'unknown' }
  }

  if (isIdentifier(last) || last.name === 'CompositeIdentifier') {
    if (prev === null) {
      const path = pathFor(doc, last)
      return path.length === 0 ? { kind: 'unknown' } : { kind: 'name', name: path[path.length - 1] }
    }
    // 演算子の直後の識別子は式の一部であって別名ではない。
    if (prev.name === 'Operator' || last.name === 'CompositeIdentifier') {
      return { kind: 'unknown' }
    }
    return { kind: 'name', name: idName(doc, last) }
  }

  return { kind: 'unknown' }
}

/**
 * 問い合わせの選択リストを読み、出力の列を組み立てる。
 *
 * 型が分かるのは、元の表の列をそのまま並べているときだけである。式に別名を
 * 付けただけの列は名前しか分からないため、型名を空にして候補の説明から落とす。
 *
 * @param doc 文書
 * @param catalog 引く先のカタログ
 * @param children 問い合わせの直接の子
 * @param ctes ここまでに定義された共通表式
 * @param depth 副問い合わせを潜った深さ
 */
function queryColumns(
  doc: Text,
  catalog: Catalog,
  children: SyntaxNode[],
  ctes: CteDefinition[],
  depth: number,
): CatalogColumn[] {
  if (depth > MAX_DEPTH) {
    return []
  }

  const selectAt = children.findIndex((child) => keywordOf(doc, child) === 'select')
  if (selectAt < 0) {
    return []
  }

  let index = selectAt + 1
  while (index < children.length) {
    const keyword = keywordOf(doc, children[index])
    if (keyword === null || !SELECT_MODIFIERS.has(keyword)) {
      break
    }
    index += 1
  }

  const items: SyntaxNode[][] = [[]]
  for (; index < children.length; index += 1) {
    const child = children[index]
    if (keywordOf(doc, child) === 'from') {
      break
    }
    if (child.name === 'Punctuation' && textOf(doc, child) === ',') {
      items.push([])
      continue
    }
    items[items.length - 1].push(child)
  }

  const sources = scanSources(doc, catalog, children, ctes, depth + 1)
  const columns: CatalogColumn[] = []
  const 出した = new Set<string>()

  /** 同じ名前の列を 2 度並べない。 */
  const 列を足す = (column: CatalogColumn) => {
    if (出した.has(foldName(column.name))) {
      return
    }
    出した.add(foldName(column.name))
    columns.push(column)
  }

  for (const tokens of items) {
    const item = selectItem(doc, tokens)
    if (item.kind === 'unknown') {
      continue
    }
    if (item.kind === 'name') {
      列を足す(findColumn(sources, item.name) ?? { name: item.name, typeName: '', nullable: true })
      continue
    }
    for (const source of sources) {
      if (item.qualifier !== null && !matchesName(source, item.qualifier)) {
        continue
      }
      source.columns.forEach(列を足す)
    }
  }

  return columns
}

/**
 * 列のあつまりが、その名前で呼ばれているかを判定する。別名でも表名でも引ける。
 *
 * @param source 判定する列のあつまり
 * @param name 利用者が打った名前
 */
export function matchesName(source: ScopeSource, name: string): boolean {
  const 鍵 = foldName(name)
  return (source.alias !== null && foldName(source.alias) === 鍵) || foldName(source.name) === 鍵
}

/**
 * `WITH` の定義を読む。
 *
 * @param doc 文書
 * @param catalog 引く先のカタログ
 * @param children 文の直接の子
 * @param depth 副問い合わせを潜った深さ
 *
 * @returns 読めた定義と、主問い合わせが始まる位置
 */
function collectCtes(
  doc: Text,
  catalog: Catalog,
  children: SyntaxNode[],
  depth: number,
): { ctes: CteDefinition[]; start: number } {
  if (children.length === 0 || keywordOf(doc, children[0]) !== 'with') {
    return { ctes: [], start: 0 }
  }

  const ctes: CteDefinition[] = []
  let index = 1

  for (;;) {
    const nameNode = children[index]
    if (!nameNode || !isIdentifier(nameNode)) {
      break
    }
    index += 1

    // `WITH r (p, q) AS (...)` の列並び。問い合わせの括弧と綴りで見分けられる。
    let names: string[] | null = null
    const next = children[index]
    if (next && next.name === 'Parens' && !isQueryParens(doc, next)) {
      names = bodyOf(next)
        .filter((child) => isIdentifier(child))
        .map((child) => idName(doc, child))
      index += 1
    }

    // `AS` と `MATERIALIZE` などのヒントを読み飛ばし、本体の括弧まで進む。
    while (index < children.length && children[index].name !== 'Parens') {
      index += 1
    }
    const body = children[index]
    if (!body) {
      break
    }
    index += 1

    const columns = queryColumns(doc, catalog, bodyOf(body), ctes, depth)
    ctes.push({
      name: idName(doc, nameNode),
      text: textOf(doc, nameNode),
      // 列並びを明記してあるならそちらが出力の列名である。型だけ内側から借りる。
      columns: names === null ? columns : renameColumns(names, columns),
    })

    const comma = children[index]
    if (comma && comma.name === 'Punctuation' && textOf(doc, comma) === ',') {
      index += 1
      continue
    }
    break
  }

  return { ctes, start: index }
}

/**
 * 明記された列名に、内側から読めた型を位置で当てる。
 *
 * 数が食い違うときは型を諦める。位置がずれた型を見せるより、型が無いほうがよい。
 *
 * @param names 明記された列名
 * @param columns 内側から読めた列
 */
function renameColumns(names: string[], columns: CatalogColumn[]): CatalogColumn[] {
  return names.map((name, at) =>
    names.length === columns.length
      ? { ...columns[at], name }
      : { name, typeName: '', nullable: true },
  )
}

/**
 * 表の位置に来た識別子を、列のあつまりとして解決する。
 *
 * 共通表式を先に見る。`WITH` で定義した名前は、同じ名前の表があってもその文の
 * 中では共通表式を指すためである。
 *
 * @param catalog 引く先のカタログ
 * @param ctes その文が定義した共通表式
 * @param path `スキーマ名.表名` を分解した名前の並び
 * @param alias 付けられた別名
 * @param aliasText 別名の打たれたままの綴り
 */
function catalogSource(
  catalog: Catalog,
  ctes: CteDefinition[],
  path: string[],
  alias: string | null,
  aliasText: string | null,
): ScopeSource {
  if (path.length === 1) {
    const cte = ctes.find((定義) => foldName(定義.name) === foldName(path[0]))
    if (cte) {
      return { name: cte.name, alias, aliasText, columns: cte.columns, origin: 'cte' }
    }
  }

  const object = resolveObject(catalog, path)
  return {
    name: object?.name ?? path[path.length - 1],
    alias,
    aliasText,
    columns: object?.columns ?? [],
    origin: 'catalog',
  }
}

/**
 * 文（または括弧の中の問い合わせ）を走査し、見えている列のあつまりを集める。
 *
 * 走査は直接の子だけを見る。内側の副問い合わせは括弧の中に入るため引っ掛からず、
 * カーソルがその中にあるときは呼び出し側が括弧のほうを渡す。
 *
 * @param doc 文書
 * @param catalog 引く先のカタログ
 * @param children 走査する節点の並び
 * @param ctes その文が定義した共通表式
 * @param depth 副問い合わせを潜った深さ
 */
function scanSources(
  doc: Text,
  catalog: Catalog,
  children: SyntaxNode[],
  ctes: CteDefinition[],
  depth: number,
): ScopeSource[] {
  if (depth > MAX_DEPTH) {
    return []
  }

  const verb = verbOf(doc, children)
  let rule = RULES[verb]
  /** 次に来る識別子や括弧が表か。 */
  let expecting = rule.armsAtStart
  /** 直前に拾った表。次の識別子が別名ならここへ付ける。 */
  let last: ScopeSource | null = null
  const sources: ScopeSource[] = []

  for (const child of children) {
    const keyword = keywordOf(doc, child)

    if (keyword !== null) {
      if (rule.ends.has(keyword)) {
        break
      }
      // `INSERT INTO t SELECT ... FROM u` のように、DML の途中から問い合わせが
      // 始まることがある。ここから先は `SELECT` の規則で読む。入れた表を捨てない
      // のは、`INSERT INTO t (` の列並びもこの走査の結果を使うためである。
      if (verb !== 'select' && keyword === 'select') {
        rule = RULES.select
        expecting = false
        last = null
        continue
      }
      if (rule.arms.has(keyword)) {
        expecting = true
        last = null
      } else if (CONDITION.has(keyword)) {
        // 結合条件の中の識別子は表でも別名でもない。
        expecting = false
        last = null
      }
      // `as` や `left` / `outer` はそのまま読み飛ばす。表と別名の関係は変わらない。
      continue
    }

    if (child.name === 'Punctuation' && textOf(doc, child) === ',') {
      expecting = true
      last = null
      continue
    }

    if (isIdentifier(child) || child.name === 'CompositeIdentifier') {
      if (expecting) {
        last = catalogSource(catalog, ctes, pathFor(doc, child), null, null)
        sources.push(last)
        expecting = false
      } else if (last && last.alias === null) {
        last.alias = idName(doc, child)
        last.aliasText = textOf(doc, child)
        last = null
      }
      continue
    }

    if (expecting && isQueryParens(doc, child)) {
      last = {
        name: '副問い合わせ',
        alias: null,
        aliasText: null,
        columns: queryColumns(doc, catalog, bodyOf(child), ctes, depth + 1),
        origin: 'subquery',
      }
      sources.push(last)
      expecting = false
      continue
    }

    // 関数呼び出しや `INSERT` の列並び。表の位置を埋めたものとして扱う。
    expecting = false
    last = null
  }

  return sources
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
export function statementOf(doc: Text, node: SyntaxNode, pos: number): SyntaxNode | null {
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
 * カーソルを含むいちばん内側の問い合わせを探す。
 *
 * `WHERE x IN (SELECT ...)` の中で打っているなら、外側の表ではなく内側の表の列を
 * 出すべきである。関数の引数の括弧は問い合わせではないので通り過ぎる。
 *
 * @param doc 文書
 * @param statement カーソルのある文
 * @param node カーソル位置から解決した節点
 *
 * @returns 内側の問い合わせの直接の子。文そのものなら `null`
 */
function innerQuery(doc: Text, statement: SyntaxNode, node: SyntaxNode): SyntaxNode[] | null {
  // 文へ辿り着く前に見つけた最初の問い合わせの括弧が、いちばん内側である。
  // 文の外まで遡ってしまうのは、カーソルが文の末尾の空白の上にあるときであり、
  // そのときも括弧は挟まっていない。
  for (
    let current: SyntaxNode | null = node;
    current && current !== statement;
    current = current.parent
  ) {
    if (isQueryParens(doc, current)) {
      return bodyOf(current)
    }
  }
  return null
}

/**
 * カーソルの位置から見える表を読む。
 *
 * @param doc 文書
 * @param catalog 引く先のカタログ
 * @param node カーソル位置から解決した節点
 * @param pos カーソルの位置
 */
export function readScope(doc: Text, catalog: Catalog, node: SyntaxNode, pos: number): Scope {
  const statement = statementOf(doc, node, pos)
  if (!statement) {
    return EMPTY_SCOPE
  }

  const children = bodyOf(statement)
  const { ctes, start } = collectCtes(doc, catalog, children, 0)
  const inner = innerQuery(doc, statement, node)
  const target = inner ?? children.slice(start)

  return { sources: scanSources(doc, catalog, target, ctes, 0), ctes }
}
