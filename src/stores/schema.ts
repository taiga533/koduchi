/**
 * スキーマツリーのストア（ADR 0007）。
 *
 * 取得は 3 段階に分かれる。
 *
 * 1. 接続直後にスキーマ名・オブジェクト数・オブジェクト名を取る。ここまでで
 *    ツリーと検索が使える。
 * 2. その後、列情報をスキーマごとにバックグラウンドで流し込む。サイドバーの
 *    下部に `列情報を読み込み中 8/23 スキーマ` を出す。
 * 3. 検索は読み込み済みの範囲に対して効く。
 *
 * キャッシュはこのストアが持ち、手動リロードで破棄する。
 */

import { create } from 'zustand'
import { getDbApi } from '../api/db'
import type { ObjectComment, ObjectKind, SchemaFilter, SchemaNode, TableColumn } from '../types/db'
import { defaultSchemaFilter, toErrorMessage } from '../types/db'

/** 段階 1 の状態。 */
export type SchemaStatus = 'idle' | 'loading' | 'ready' | 'failed'

/** 段階 2（列情報）の状態。 */
export type ColumnStatus = 'idle' | 'loading' | 'ready'

/** スキーマ名 → オブジェクト名 → コメント（ADR 0043）。 */
export type ObjectCommentIndex = Record<string, Record<string, string>>

interface SchemaState {
  schemas: SchemaNode[]
  /** スキーマ名ごとの列情報。読み込み済みのものだけが入る。 */
  columns: Record<string, TableColumn[]>
  /**
   * スキーマ名 → オブジェクト名 → コメント（ADR 0043）。
   *
   * 段階 2 で列と一緒に届く。コメントを出さない設定で読んだスキーマは空である。
   */
  objectComments: ObjectCommentIndex
  status: SchemaStatus
  columnStatus: ColumnStatus
  /** 列情報を読み終えたスキーマの数。進捗表示に使う。 */
  loadedSchemas: number
  filter: SchemaFilter
  /** ツリーの絞り込み語。オブジェクト名と、読み込み済みの列名に効く。 */
  search: string
  /** 展開されているスキーマ名とオブジェクト名の鍵。 */
  expanded: Record<string, boolean>
  error: string | null

  /** スキーマを取得する。既に取得済みなら何もしない。 */
  load: (connectionId: string) => Promise<void>
  /** キャッシュを捨てて取得し直す。 */
  reload: (connectionId: string) => Promise<void>
  /**
   * フィルタを変える。取得の結果が変わる変更のときだけ取得し直す
   * （`needsRefetch`）。
   */
  setFilter: (connectionId: string, filter: SchemaFilter) => Promise<void>
  setSearch: (search: string) => void
  /**
   * スキーマ・種別の束・オブジェクトの開閉を切り替える。
   *
   * `open` を省いたときは今覚えている状態を反転する。束は検索中だけ既定で
   * 開くため、見えているとおりに閉じられるよう呼び出し側が値を渡す。
   */
  toggle: (key: string, open?: boolean) => void
  /** 接続を切ったときに捨てる。 */
  clear: () => void
}

/**
 * 取得の世代。
 *
 * リロードやフィルタ変更で古い取得が走り続けたとき、その結果を捨てるために使う。
 * 段階 2 はスキーマの数だけ往復するため、中断の判定が要る。
 */
let generation = 0

/** ツリーの節点を一意に指す鍵を作る。 */
export function nodeKey(schema: string, object?: string): string {
  return object === undefined ? schema : `${schema}.${object}`
}

/**
 * 種別の束を一意に指す鍵を作る（ADR 0014）。
 *
 * オブジェクトの鍵と衝突しないよう `#` で継ぐ。Oracle の無引用の識別子は
 * `#` で始まれないため、`KODUCHI.#table` の形なら実在の名前と重ならない。
 *
 * @param schema スキーマ名
 * @param kind オブジェクトの種類
 */
export function kindGroupKey(schema: string, kind: ObjectKind): string {
  return `${schema}.#${kind}`
}

/**
 * フィルタの変更で取得し直す必要があるか（ADR 0043）。
 *
 * 型名の表示は見た目だけであり、切り替えるたびに全スキーマを取り直すのは
 * 割に合わない。コメントは**出す側へ切り替えたときだけ**取り直す。隠す側へは
 * 手元の値を描かないだけで足り、次の取得からは読みにいかない。
 *
 * @param previous 今のフィルタ
 * @param next 新しいフィルタ
 */
export function needsRefetch(previous: SchemaFilter, next: SchemaFilter): boolean {
  if (previous.excludeSystem !== next.excludeSystem || previous.hideEmpty !== next.hideEmpty) {
    return true
  }
  const kinds = Object.keys(next.kinds) as ObjectKind[]
  if (kinds.some((kind) => previous.kinds[kind] !== next.kinds[kind])) {
    return true
  }
  return !previous.showComments && next.showComments
}

/**
 * 段階 2 のオブジェクトのコメントを、名前で引ける形に直す。
 *
 * @param comments スキーマ 1 つぶんのコメント
 */
function indexComments(comments: ObjectComment[]): Record<string, string> {
  return Object.fromEntries(comments.map((comment) => [comment.objectName, comment.comment]))
}

export const useSchemaStore = create<SchemaState>((set, get) => {
  /**
   * 段階 2 を回す。スキーマ 1 つずつ列情報を取り、そのつど状態へ流し込む。
   *
   * @param connectionId 接続の識別子
   * @param schemas 対象のスキーマ
   * @param current この取得の世代
   */
  async function loadColumns(
    connectionId: string,
    schemas: SchemaNode[],
    current: number,
  ): Promise<void> {
    set({ columnStatus: 'loading', loadedSchemas: 0 })
    const withComments = get().filter.showComments

    for (const schema of schemas) {
      if (current !== generation) {
        return
      }

      try {
        const result = await getDbApi().schemaColumns(connectionId, schema.name, withComments)
        if (current !== generation) {
          return
        }
        set((state) => ({
          columns: { ...state.columns, [schema.name]: result.columns },
          objectComments: {
            ...state.objectComments,
            [schema.name]: indexComments(result.objectComments),
          },
          loadedSchemas: state.loadedSchemas + 1,
        }))
      } catch {
        // 1 つのスキーマで失敗しても残りは読み込む。権限の無いスキーマで
        // 起こりうるため、ツリー全体を失敗にはしない。
        if (current !== generation) {
          return
        }
        set((state) => ({ loadedSchemas: state.loadedSchemas + 1 }))
      }
    }

    if (current === generation) {
      set({ columnStatus: 'ready' })
    }
  }

  /**
   * 段階 1 と段階 2 を続けて走らせる。
   *
   * @param connectionId 接続の識別子
   */
  async function run(connectionId: string): Promise<void> {
    generation += 1
    const current = generation

    set({
      status: 'loading',
      error: null,
      schemas: [],
      columns: {},
      objectComments: {},
      loadedSchemas: 0,
    })

    try {
      const schemas = await getDbApi().schemaOverview(connectionId, get().filter)
      if (current !== generation) {
        return
      }
      set({ schemas, status: 'ready' })
      await loadColumns(connectionId, schemas, current)
    } catch (error) {
      if (current !== generation) {
        return
      }
      set({ status: 'failed', columnStatus: 'idle', error: toErrorMessage(error) })
    }
  }

  return {
    schemas: [],
    columns: {},
    objectComments: {},
    status: 'idle',
    columnStatus: 'idle',
    loadedSchemas: 0,
    filter: defaultSchemaFilter,
    search: '',
    expanded: {},
    error: null,

    load: async (connectionId) => {
      if (get().status !== 'idle') {
        return
      }
      await run(connectionId)
    },

    reload: async (connectionId) => {
      await run(connectionId)
    },

    setFilter: async (connectionId, filter) => {
      const refetch = needsRefetch(get().filter, filter)
      set({ filter })
      if (refetch) {
        await run(connectionId)
      }
    },

    setSearch: (search) => set({ search }),

    toggle: (key, open) =>
      set((state) => ({
        expanded: { ...state.expanded, [key]: open ?? !state.expanded[key] },
      })),

    clear: () => {
      generation += 1
      // フィルタは接続ごとの設定であるため、これも既定へ戻す（ADR 0004）。
      set({
        schemas: [],
        columns: {},
        objectComments: {},
        status: 'idle',
        columnStatus: 'idle',
        loadedSchemas: 0,
        filter: defaultSchemaFilter,
        search: '',
        expanded: {},
        error: null,
      })
    },
  }
})

/**
 * 列情報の読み込み進捗を文言にする。
 *
 * 読み込みが終わっているときは空文字列を返す。読み込み中だけ出す表示である。
 *
 * @param state スキーマストアの状態
 */
export function formatColumnProgress(state: SchemaState): string {
  if (state.columnStatus !== 'loading') {
    return ''
  }
  return `列情報を読み込み中 ${state.loadedSchemas}/${state.schemas.length} スキーマ`
}

/**
 * 絞り込み語に当てはまるスキーマだけを返す。
 *
 * スキーマ名・オブジェクト名に加え、読み込み済みの列名にも当てる。まだ
 * 読み込まれていないスキーマの列はヒットしない（ADR 0007）。
 *
 * コメントを渡したときは、表・ビューのコメントと列のコメントにも当てる
 * （ADR 0043）。利用者が知っているのは論理名のほうであることが多い
 * （ADR 0033 と同じ動機）。**コメントを隠しているときは `null` を渡す。**
 * 見えていない文字列に当たって行が残ると、なぜ残ったのかが画面から読めない。
 *
 * 呼び出し側で `useMemo` に包むこと。毎回新しい配列を作るため、そのまま
 * セレクタとして使うと再描画が止まらなくなる。
 *
 * @param schemas 取得済みのスキーマ
 * @param columns スキーマ名ごとの列情報
 * @param search 絞り込み語
 * @param objectComments オブジェクトのコメント。コメントを当てないときは `null`
 */
export function filterSchemas(
  schemas: SchemaNode[],
  columns: Record<string, TableColumn[]>,
  search: string,
  objectComments: ObjectCommentIndex | null = null,
): SchemaNode[] {
  const needle = search.trim().toLowerCase()
  if (needle === '') {
    return schemas
  }

  return schemas
    .map((schema) => {
      if (schema.name.toLowerCase().includes(needle)) {
        return schema
      }

      const withComments = objectComments !== null
      const hits = (text: string | undefined) =>
        text !== undefined && text.toLowerCase().includes(needle)

      const 列で当たったオブジェクト = new Set(
        (columns[schema.name] ?? [])
          .filter((column) => hits(column.name) || (withComments && hits(column.comment)))
          .map((column) => column.objectName),
      )
      const コメント = objectComments?.[schema.name] ?? {}

      const objects = schema.objects.filter(
        (object) =>
          hits(object.name) ||
          列で当たったオブジェクト.has(object.name) ||
          (withComments && hasComment(object.kind) && hits(コメント[object.name])),
      )

      return { ...schema, objects }
    })
    .filter((schema) => schema.objects.length > 0 || schema.name.toLowerCase().includes(needle))
}

/**
 * コメントを持ちうる種別か（ADR 0033・0043）。
 *
 * `ALL_TAB_COMMENTS` に載るのは表・ビュー・マテビューだけである。コメントは
 * 名前で引くため、表と同名の索引やトリガーにまで表のコメントを付けない
 * ためにここで絞る。
 *
 * @param kind オブジェクトの種類
 */
export function hasComment(kind: ObjectKind): boolean {
  return kind === 'table' || kind === 'view' || kind === 'materializedView'
}
