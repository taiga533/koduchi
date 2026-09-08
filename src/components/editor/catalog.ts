/**
 * 補完の元になるカタログ（ADR 0013）。
 *
 * `@codemirror/lang-sql` が受け取る `{ 表名: 列名の並び }` の表は、名前を
 * 大文字小文字まで含めた完全一致でしか引けない。Oracle のカタログは名前を
 * 大文字で持つため、`koduchi.` と小文字で打った瞬間に候補が 1 件も出なくなる。
 * そこで**畳んだ名前を鍵にした自前の表**を持ち、`sqlCompletion.ts` の補完ソース
 * から引く。
 *
 * 非修飾で出す表は既定スキーマ（接続したユーザーのスキーマ）のものだけに絞る。
 * 全スキーマの表名を並べると、他人のスキーマの表が自分の表を隠しうる。
 */

import type { ObjectKind, SchemaNode, TableColumn } from '../../types/db'

/**
 * 補完の候補に出す種別（ADR 0014）。
 *
 * SQL の中で名前を書く種別だけを入れる。索引とトリガーは SQL 本文に名前が
 * 現れない（`DROP INDEX` などの DDL でしか使わない）ため出さない。DB link は
 * `表@リンク名` の形でしか使えず、この補完ソースは `@` を解さないので、
 * 裸の名前を並べても誤った綴りを勧めるだけになる。
 *
 * シノニムと型は入れる。シノニムは表と同じ位置に書け、型は PL/SQL の宣言で使う。
 */
const COMPLETABLE_KINDS: ReadonlySet<ObjectKind> = new Set<ObjectKind>([
  'table',
  'view',
  'materializedView',
  'sequence',
  'synonym',
  'type',
  'function',
  'procedure',
  'package',
])

/**
 * 補完の候補に出す種別か。
 *
 * @param kind オブジェクトの種類
 */
export function isCompletable(kind: ObjectKind): boolean {
  return COMPLETABLE_KINDS.has(kind)
}

/** 表やビューの列 1 つ。 */
export interface CatalogColumn {
  /** カタログが持っている綴りの名前。 */
  name: string
  /** `NUMBER(12,2)` のような表示用の型名。候補の説明に出す。 */
  typeName: string
  nullable: boolean
}

/** スキーマの中のオブジェクト 1 つ。 */
export interface CatalogObject {
  /** カタログが持っている綴りの名前。 */
  name: string
  kind: ObjectKind
  /** 段階 2 が終わるまでは空（ADR 0007）。 */
  columns: CatalogColumn[]
}

/** スキーマ 1 つ。 */
export interface CatalogSchema {
  /** カタログが持っている綴りの名前。 */
  name: string
  /** 畳んだオブジェクト名で引く表。 */
  objects: Map<string, CatalogObject>
}

/** 補完が引く表の全体。 */
export interface Catalog {
  /** 畳んだスキーマ名で引く表。並びは取得順を保つ。 */
  schemas: Map<string, CatalogSchema>
  /**
   * 非修飾の表名を出すスキーマ。接続したユーザーのスキーマ。
   *
   * そのスキーマが取得できていなければ `null`。フィルタで隠されている場合や、
   * ユーザー名と同じ名前のスキーマが無い場合に起こる。
   */
  defaultSchema: CatalogSchema | null
}

/** 空のカタログ。参照を固定して再計算を避けるために使う。 */
export const EMPTY_CATALOG: Catalog = { schemas: new Map(), defaultSchema: null }

/**
 * 名前を引くための鍵へ畳む。
 *
 * Oracle は無引用の識別子を大文字へ畳むため、大文字へ寄せれば利用者がどの綴りで
 * 打っても引ける。`"abc"` のように引用符付きで作られた小文字の名前と `ABC` は
 * 本来別物だが、補完では区別せず先に登録されたほうを採る。
 *
 * @param name 畳む名前
 */
export function foldName(name: string): string {
  return name.toUpperCase()
}

/**
 * 取得済みのスキーマからカタログを組み立てる。
 *
 * 補完に出さない種別（索引・トリガー・DB link）はここで落とす。カタログは
 * 補完のためだけの表であり、引けない名前を抱えても嵩むだけである（ADR 0014）。
 *
 * @param schemas 段階 1 で取れたスキーマ（ADR 0007）
 * @param columns スキーマ名ごとの列情報。段階 2 が終わるまでは欠けている
 * @param defaultSchemaName 非修飾で表を出すスキーマ名。接続したユーザー名
 */
export function buildCatalog(
  schemas: SchemaNode[],
  columns: Record<string, TableColumn[]>,
  defaultSchemaName: string | null,
): Catalog {
  const built = new Map<string, CatalogSchema>()

  for (const schema of schemas) {
    const 列 = new Map<string, CatalogColumn[]>()
    for (const column of columns[schema.name] ?? []) {
      const names = 列.get(foldName(column.objectName)) ?? []
      names.push({ name: column.name, typeName: column.typeName, nullable: column.nullable })
      列.set(foldName(column.objectName), names)
    }

    const objects = new Map<string, CatalogObject>()
    for (const object of schema.objects) {
      if (!isCompletable(object.kind)) {
        continue
      }
      objects.set(foldName(object.name), {
        name: object.name,
        kind: object.kind,
        columns: 列.get(foldName(object.name)) ?? [],
      })
    }

    built.set(foldName(schema.name), { name: schema.name, objects })
  }

  const defaultSchema =
    defaultSchemaName === null ? null : (built.get(foldName(defaultSchemaName)) ?? null)

  return { schemas: built, defaultSchema }
}

/**
 * スキーマを名前で引く。大文字小文字は区別しない。
 *
 * @param catalog 引く先のカタログ
 * @param name 利用者が打った綴りの名前
 */
export function findSchema(catalog: Catalog, name: string): CatalogSchema | null {
  return catalog.schemas.get(foldName(name)) ?? null
}

/**
 * オブジェクトを名前で引く。大文字小文字は区別しない。
 *
 * @param schema 引く先のスキーマ
 * @param name 利用者が打った綴りの名前
 */
export function findObject(schema: CatalogSchema, name: string): CatalogObject | null {
  return schema.objects.get(foldName(name)) ?? null
}

/**
 * 修飾のありなしを問わず、名前の並びからオブジェクトを引く。
 *
 * `["KODUCHI", "ORDERS"]` はそのスキーマの表を、`["ORDERS"]` はまず既定スキーマを
 * 見て、無ければ取得順で最初に見つかったスキーマの表を返す。非修飾の**候補**は
 * 既定スキーマのものしか出さないが、利用者が自分で打った名前は他スキーマの表で
 * ありうるため、引くときは全体を見る。
 *
 * @param catalog 引く先のカタログ
 * @param path `スキーマ名.オブジェクト名` を分解した名前の並び
 */
export function resolveObject(catalog: Catalog, path: string[]): CatalogObject | null {
  if (path.length === 2) {
    const schema = findSchema(catalog, path[0])
    return schema ? findObject(schema, path[1]) : null
  }

  if (path.length !== 1) {
    return null
  }

  if (catalog.defaultSchema) {
    const found = findObject(catalog.defaultSchema, path[0])
    if (found) {
      return found
    }
  }

  for (const schema of catalog.schemas.values()) {
    const found = findObject(schema, path[0])
    if (found) {
      return found
    }
  }

  return null
}
