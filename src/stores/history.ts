/**
 * クエリ履歴のストア（ADR 0005）。
 *
 * 履歴は全接続を横断する 1 つの SQLite に入っている。サイドバーのスコープ切替
 * （この接続のみ / 全接続）は、取り出すときの絞り込みで表す。
 *
 * 記録そのものは実行ストアが行う。ここは表示のための読み出しと削除を担う。
 */

import { create } from 'zustand'
import { getDbApi } from '../api/db'
import type { HistoryEntry } from '../types/db'
import { toErrorMessage } from '../types/db'

/** 一度に読み出す件数の上限。 */
export const HISTORY_LIMIT = 200

/** 履歴の表示範囲。デザインのサイドバーにあるスコープ切替に対応する。 */
export type HistoryScope = 'connection' | 'all'

interface HistoryState {
  entries: HistoryEntry[]
  scope: HistoryScope
  /** SQL の部分一致で絞る語。サイドバーの検索入力に対応する。 */
  search: string
  /**
   * 「この接続のみ」で絞るときの接続名。
   *
   * 条件をすべてストアが持つことで、絞り込みが変わったときの読み直しを
   * ストア側で完結させられる。
   */
  connectionName: string | null
  loading: boolean
  error: string | null

  /** 対象の接続を伝える。接続が変わったときに呼ぶ。 */
  setConnectionName: (connectionName: string | null) => void
  /** 表示範囲を切り替え、読み直す。 */
  setScope: (scope: HistoryScope) => void
  /** 検索語を変え、読み直す。 */
  setSearch: (search: string) => void
  /** 現在の条件で履歴を読み直す。 */
  reload: () => Promise<void>
  /** 履歴を 1 件削除する。 */
  remove: (id: number) => Promise<void>
  /** 履歴を全件削除する。設定画面の一括削除に対応する。 */
  clearAll: () => Promise<void>
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  entries: [],
  scope: 'connection',
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
      const entries = await getDbApi().listHistory({
        // 全接続を選んでいるとき、または接続名が分からないときは絞らない。
        connectionName: scope === 'connection' ? connectionName : null,
        search: search.trim() === '' ? null : search.trim(),
        limit: HISTORY_LIMIT,
      })
      set({ entries, loading: false })
    } catch (error) {
      set({ loading: false, error: toErrorMessage(error) })
    }
  },

  remove: async (id) => {
    try {
      await getDbApi().deleteHistory(id)
      set((state) => ({ entries: state.entries.filter((entry) => entry.id !== id) }))
    } catch (error) {
      set({ error: toErrorMessage(error) })
    }
  },

  clearAll: async () => {
    try {
      await getDbApi().clearHistory()
      set({ entries: [] })
    } catch (error) {
      set({ error: toErrorMessage(error) })
    }
  },
}))
