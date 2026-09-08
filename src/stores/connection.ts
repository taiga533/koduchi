/**
 * 接続の状態を持つストア（ADR 0009）。
 *
 * 1 接続 = 1 ウィンドウであるため、このストアが持つ接続は常に高々 1 つである。
 * Rust 側の呼び出しは `src/api/` 層を介する（ADR 0010）。
 */

import { create } from 'zustand'
import { getDbApi } from '../api/db'
import type { CompletionSettings, ConnectionColor, ConnectionParams } from '../types/db'
import { defaultCompletionSettings, defaultConnectionColor, toErrorMessage } from '../types/db'

/** 接続の段階。ステータスバーの表示に使う。 */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'failed'

/** 接続中のデータベースの情報。タイトルバーに出す。 */
export interface ActiveConnection {
  /** Rust 側の接続表を引くための識別子。接続のたびに採番する。 */
  id: string
  /**
   * `connections.toml` に保存されている接続の ID。保存していなければ `null`。
   *
   * スキーマフィルタを接続ごとに保存し直すのに使う（ADR 0004・0007）。
   * 実行時の識別子と分けてあるのは、保存しない接続でも繋げるようにするためである。
   */
  savedId: string | null
  /** 利用者が付けた表示名。 */
  name: string
  params: ConnectionParams
  /**
   * 補完の設定（ADR 0013）。接続ごとの項目であり、接続した時点で決まる。
   *
   * `params` と分けてあるのは Rust へ渡さない値だからである。スキーマフィルタと
   * 違って繋いだ後に変わらないため、設定を変える口はこのストアに持たない。
   */
  completion: CompletionSettings
  /**
   * 接続に付けた色（ADR 0015）。保存していない接続では既定の `none`。
   *
   * タイトルバーとステータスバーが「今どこへ繋がっているか」を出すのに使う。
   */
  color: ConnectionColor
  /** 接続が属するグループ名（ADR 0015）。未指定なら `null`。 */
  group: string | null
}

/**
 * 保存済みの接続から引き継ぐ、Rust へ渡さない値（ADR 0013・0015）。
 *
 * `ConnectionParams` と分けてあるのは、どれもデータベースへの繋ぎ方ではなく
 * 画面の見せ方と補完の決まりだからである。
 */
export interface ConnectionProfile {
  /** `connections.toml` に保存されている接続の ID。保存していなければ `null`。 */
  savedId?: string | null
  completion?: CompletionSettings
  color?: ConnectionColor
  group?: string | null
}

interface ConnectionState {
  status: ConnectionStatus
  connection: ActiveConnection | null
  /** 接続に失敗したときのメッセージ。成功すると消える。 */
  error: string | null

  /** 接続する。既に接続していれば先に切断する。 */
  connect: (name: string, params: ConnectionParams, profile?: ConnectionProfile) => Promise<void>
  /** 切断する。接続していなければ何もしない。 */
  disconnect: () => Promise<void>
}

/**
 * 接続の識別子を採番する。
 *
 * Rust 側の接続表の鍵になる。ウィンドウをまたいでも衝突しない値であればよい。
 */
function createConnectionId(): string {
  return crypto.randomUUID()
}

/**
 * トランザクションを手で終わらせる接続かどうかを返す（ADR 0012）。
 *
 * 読み取り専用の接続と自動コミットの接続には未コミットの状態が生じないため、
 * 未コミットの表示もコミット / ロールバックのボタンも出さない。
 *
 * @param connection 接続中のデータベース。未接続なら `null`
 */
export function isManualCommit(connection: ActiveConnection | null): boolean {
  return connection !== null && !connection.params.readOnly && !connection.params.autoCommit
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  status: 'disconnected',
  connection: null,
  error: null,

  connect: async (name, params, profile = {}) => {
    const {
      savedId = null,
      completion = defaultCompletionSettings,
      color = defaultConnectionColor,
      group = null,
    } = profile
    const previous = get().connection
    if (previous) {
      await getDbApi().disconnect(previous.id)
    }

    const id = createConnectionId()
    set({ status: 'connecting', error: null })

    try {
      await getDbApi().connect(id, params)
      set({
        status: 'connected',
        connection: { id, savedId, name, params, completion, color, group },
        error: null,
      })
    } catch (error) {
      set({ status: 'failed', connection: null, error: toErrorMessage(error) })
    }
  },

  disconnect: async () => {
    const current = get().connection
    if (!current) {
      return
    }

    await getDbApi().disconnect(current.id)
    set({ status: 'disconnected', connection: null, error: null })
  },
}))
