/**
 * 接続の状態を持つストア（ADR 0009）。
 *
 * 1 接続 = 1 ウィンドウであるため、このストアが持つ接続は常に高々 1 つである。
 * Rust 側の呼び出しは `src/api/` 層を介する（ADR 0010）。
 */

import { create } from 'zustand'
import { getDbApi } from '../api/db'
import type { ConnectionParams } from '../types/db'
import { toErrorMessage } from '../types/db'

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
}

interface ConnectionState {
  status: ConnectionStatus
  connection: ActiveConnection | null
  /** 接続に失敗したときのメッセージ。成功すると消える。 */
  error: string | null

  /** 接続する。既に接続していれば先に切断する。 */
  connect: (name: string, params: ConnectionParams, savedId?: string | null) => Promise<void>
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

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  status: 'disconnected',
  connection: null,
  error: null,

  connect: async (name, params, savedId = null) => {
    const previous = get().connection
    if (previous) {
      await getDbApi().disconnect(previous.id)
    }

    const id = createConnectionId()
    set({ status: 'connecting', error: null })

    try {
      await getDbApi().connect(id, params)
      set({ status: 'connected', connection: { id, savedId, name, params }, error: null })
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
