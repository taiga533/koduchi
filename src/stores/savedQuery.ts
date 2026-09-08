/**
 * 保存済みクエリのストア（ADR 0018）。
 *
 * 保管庫は履歴と同じ `history.sqlite3` の 1 つの表であり、全接続を横断する。
 * 保存したときの接続名を添えてあるため、サイドバーでは「この接続のみ / 全接続」を
 * 切り替えられる。履歴と違って既定は「全接続」である。保存済みクエリは使い回す
 * 道具であり、開発と本番のように同じスキーマを持つ接続をまたいで使うためである。
 *
 * 絞り込みの条件はすべてストアが持ち、変わったら読み直す。履歴ストアと同じ形に
 * してあるのは、サイドバーが両者を同じ検索欄で扱うためである。
 */

import { create } from 'zustand'
import { getDbApi } from '../api/db'
import type { SavedQuery } from '../types/db'
import { toErrorMessage } from '../types/db'

/** 一度に読み出す件数の上限。 */
export const SAVED_QUERY_LIMIT = 200

/** 保存済みクエリの表示範囲。履歴のスコープ切替に合わせてある。 */
export type SavedQueryScope = 'connection' | 'all'

interface SavedQueryState {
  entries: SavedQuery[]
  scope: SavedQueryScope
  /** 名前と SQL の部分一致で絞る語。サイドバーの検索入力に対応する。 */
  search: string
  /** 「この接続のみ」で絞るときの接続名。 */
  connectionName: string | null
  loading: boolean
  error: string | null

  /** 対象の接続を伝える。接続が変わったときに呼ぶ。 */
  setConnectionName: (connectionName: string | null) => void
  /** 表示範囲を切り替え、読み直す。 */
  setScope: (scope: SavedQueryScope) => void
  /** 検索語を変え、読み直す。 */
  setSearch: (search: string) => void
  /** 現在の条件で読み直す。 */
  reload: () => Promise<void>
  /**
   * 今のクエリを名前を付けて保存する。
   *
   * 名前の重複は弾かない。名前は目印であって鍵ではないためである。
   */
  save: (name: string, sql: string, connectionName: string) => Promise<void>
  /** 名前を付け替える。SQL 本体は変えない。 */
  rename: (id: number, name: string) => Promise<void>
  /** 1 件削除する。 */
  remove: (id: number) => Promise<void>
}

export const useSavedQueryStore = create<SavedQueryState>((set, get) => ({
  entries: [],
  scope: 'all',
  search: '',
  connectionName: null,
  loading: false,
  error: null,

  setConnectionName: (connectionName) => set({ connectionName }),

  setScope: (scope) => {
    set({ scope })
    void get().reload()
  },

  setSearch: (search) => {
    set({ search })
    void get().reload()
  },

  reload: async () => {
    const { scope, search, connectionName } = get()
    set({ loading: true, error: null })

    try {
      const entries = await getDbApi().listSavedQueries({
        // 全接続を選んでいるとき、または接続名が分からないときは絞らない。
        connectionName: scope === 'connection' ? connectionName : null,
        search: search.trim() === '' ? null : search.trim(),
        limit: SAVED_QUERY_LIMIT,
      })
      set({ entries, loading: false })
    } catch (error) {
      set({ loading: false, error: toErrorMessage(error) })
    }
  },

  save: async (name, sql, connectionName) => {
    try {
      await getDbApi().createSavedQuery({
        name,
        sql,
        connectionName,
        savedAt: Date.now(),
      })
      await get().reload()
    } catch (error) {
      set({ error: toErrorMessage(error) })
    }
  },

  rename: async (id, name) => {
    const target = get().entries.find((entry) => entry.id === id)
    if (!target) {
      return
    }

    try {
      await getDbApi().updateSavedQuery(id, name, target.sql, Date.now())
      await get().reload()
    } catch (error) {
      set({ error: toErrorMessage(error) })
    }
  },

  remove: async (id) => {
    try {
      await getDbApi().deleteSavedQuery(id)
      set((state) => ({ entries: state.entries.filter((entry) => entry.id !== id) }))
    } catch (error) {
      set({ error: toErrorMessage(error) })
    }
  },
}))
