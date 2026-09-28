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

/**
 * 成否での絞り込み（ADR 0046）。
 *
 * 保存しない。スコープと同じく開いたときは既定（`all`）へ戻す。絞ったまま
 * 次に開くと、履歴が消えたように見えるためである。
 */
export type HistoryOutcome = 'all' | 'succeeded' | 'failed'

/**
 * 成否の絞り込みを問い合わせの条件へ写す。
 *
 * 取得済みの一覧を手元で絞らず問い合わせに載せるのは、件数の上限
 * （`HISTORY_LIMIT`）より先に効かせるためである。手元で絞ると、新しい成功が
 * 上限を埋めたとき古い失敗が 1 件も出なくなる。
 *
 * @param outcome 成否での絞り込み
 *
 * @returns 問い合わせの `succeeded`。`null` なら成否を問わない
 */
export function outcomeToSucceeded(outcome: HistoryOutcome): boolean | null {
  switch (outcome) {
    case 'all':
      return null
    case 'succeeded':
      return true
    case 'failed':
      return false
  }
}

/**
 * 読み出しの世代。
 *
 * 絞り込みを続けて切り替えると読み出しが重なり、遅れて返った古い条件の結果が
 * 今の条件の結果を上書きする（「失敗」を選んでいるのに一覧が「すべて」のまま）。
 * 依頼ごとに世代を進め、今の世代でない応答は捨てる。スキーマのストアと同じ形。
 */
let generation = 0

interface HistoryState {
  entries: HistoryEntry[]
  scope: HistoryScope
  /** 成否での絞り込み（ADR 0046）。 */
  outcome: HistoryOutcome
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
  /** 成否での絞り込みを切り替え、読み直す。 */
  setOutcome: (outcome: HistoryOutcome) => void
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
  outcome: 'all',
  search: '',
  connectionName: null,
  loading: false,
  error: null,

  setConnectionName: (connectionName) => set({ connectionName }),

  setScope: (scope) => {
    set({ scope })
    void get().reload()
  },

  setOutcome: (outcome) => {
    set({ outcome })
    void get().reload()
  },

  setSearch: (search) => {
    set({ search })
    void get().reload()
  },

  reload: async () => {
    const { scope, outcome, search, connectionName } = get()
    generation += 1
    const current = generation
    set({ loading: true, error: null })

    try {
      const entries = await getDbApi().listHistory({
        // 全接続を選んでいるとき、または接続名が分からないときは絞らない。
        connectionName: scope === 'connection' ? connectionName : null,
        search: search.trim() === '' ? null : search.trim(),
        succeeded: outcomeToSucceeded(outcome),
        limit: HISTORY_LIMIT,
      })
      if (current === generation) {
        set({ entries, loading: false })
      }
    } catch (error) {
      if (current === generation) {
        set({ loading: false, error: toErrorMessage(error) })
      }
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
      // 消す前に走り出した読み出しが、消した行を一覧へ戻さないようにする。
      generation += 1
      set({ entries: [], loading: false })
    } catch (error) {
      set({ error: toErrorMessage(error) })
    }
  },
}))
