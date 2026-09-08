/**
 * セッションとロックのストア（ADR 0017）。
 *
 * `V$SESSION` の一覧とブロッキングの連鎖を持ち、kill の確認待ちも預かる。
 * 一覧はプールの結果セットを保持していない接続で読まれるため、利用者が見ている
 * 結果セット（ADR 0003）は何度読み直しても壊れない。
 *
 * 権限が無くて読めなかったことは `permissionDenied` で区別する。空の一覧を
 * 出して「誰も居ない」と読ませてはならない。
 */

import { create } from 'zustand'
import { getDbApi } from '../api/db'
import type { BlockingNode, SessionOverview, SessionRow } from '../types/db'
import { isDbError, toErrorMessage } from '../types/db'

/** 一覧の取得状態。 */
export type SessionsStatus = 'idle' | 'loading' | 'ready' | 'failed'

/** 自動更新の間隔（ミリ秒）。 */
export const AUTO_REFRESH_INTERVAL = 5_000

interface SessionsState {
  overview: SessionOverview | null
  status: SessionsStatus
  error: string | null
  /**
   * 読めなかった理由が権限不足か（ADR 0017）。
   *
   * 真のときは「この接続では参照できない」と出す。空の一覧は出さない。
   */
  permissionDenied: boolean
  /** 一覧の絞り込み語。ユーザー・プログラム・マシン・`SID` に効く。 */
  search: string
  /** 5 秒ごとに読み直すか。既定は偽。 */
  autoRefresh: boolean
  /** kill の確認待ちの対象。確認していなければ `null`。 */
  killTarget: SessionRow | null
  /** kill が弾かれた・失敗したときのメッセージ。 */
  killError: string | null

  /** 一覧を読み直す。 */
  load: (connectionId: string) => Promise<void>
  setSearch: (search: string) => void
  /** 自動更新の入り切りを切り替える。 */
  toggleAutoRefresh: () => void
  /** kill の確認を出す（ADR 0017 の関所 3）。 */
  requestKill: (session: SessionRow) => void
  /** kill の確認を取り消す。 */
  cancelKill: () => void
  /** 確認済みの kill を実行し、一覧を読み直す。 */
  confirmKill: (connectionId: string) => Promise<void>
  /** 切断したときに捨てる。 */
  clear: () => void
}

/**
 * 取得の世代。
 *
 * 自動更新と手動の更新が重なったとき、古い取得の結果を捨てるために使う。
 */
let generation = 0

export const useSessionsStore = create<SessionsState>((set, get) => ({
  overview: null,
  status: 'idle',
  error: null,
  permissionDenied: false,
  search: '',
  autoRefresh: false,
  killTarget: null,
  killError: null,

  load: async (connectionId) => {
    generation += 1
    const current = generation

    // 2 度目以降は前の一覧を残したまま読む。読み直すたびに表が消えると、
    // 自動更新のたびに画面が跳ねる。
    set((state) => ({ status: state.overview === null ? 'loading' : state.status }))

    try {
      const overview = await getDbApi().listSessions(connectionId)
      if (current !== generation) {
        return
      }
      set({ overview, status: 'ready', error: null, permissionDenied: false })
    } catch (error) {
      if (current !== generation) {
        return
      }
      set({
        status: 'failed',
        overview: null,
        error: toErrorMessage(error),
        permissionDenied: isDbError(error) && error.kind === 'permission',
      })
    }
  },

  setSearch: (search) => set({ search }),

  toggleAutoRefresh: () => set((state) => ({ autoRefresh: !state.autoRefresh })),

  requestKill: (session) => set({ killTarget: session, killError: null }),

  cancelKill: () => set({ killTarget: null }),

  confirmKill: async (connectionId) => {
    const target = get().killTarget
    if (!target) {
      return
    }

    try {
      await getDbApi().killSession(connectionId, target.sid, target.serial)
      set({ killTarget: null, killError: null })
    } catch (error) {
      // 弾かれた理由は利用者に見せる。Rust 側の関所（読み取り専用・小槌自身の
      // 接続）で止まった場合もここへ来る。
      set({ killTarget: null, killError: toErrorMessage(error) })
    }

    await get().load(connectionId)
  },

  clear: () => {
    generation += 1
    set({
      overview: null,
      status: 'idle',
      error: null,
      permissionDenied: false,
      search: '',
      autoRefresh: false,
      killTarget: null,
      killError: null,
    })
  },
}))

/**
 * 絞り込み語に当てはまるセッションだけを返す。
 *
 * `SID`・ユーザー・OS ユーザー・マシン・プログラム・待機イベントに当てる。
 * 語が空なら元の並びをそのまま返す。
 *
 * 呼び出し側で `useMemo` に包むこと。毎回新しい配列を作るため、そのまま
 * セレクタとして使うと再描画が止まらなくなる。
 *
 * @param sessions 取得したままのセッション
 * @param search 絞り込み語
 */
export function filterSessions(sessions: SessionRow[], search: string): SessionRow[] {
  const needle = search.trim().toLowerCase()
  if (needle === '') {
    return sessions
  }

  return sessions.filter((session) =>
    [
      String(session.sid),
      session.username,
      session.osuser,
      session.machine,
      session.program,
      session.event,
    ].some((value) => (value ?? '').toLowerCase().includes(needle)),
  )
}

/**
 * 連鎖の 1 節点より下に居るセッションの数を数える。
 *
 * @param nodes 数える節点
 */
function countNodes(nodes: BlockingNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countNodes(node.blocked), 0)
}

/**
 * 待たされているセッションの数を数える。
 *
 * ブロッキングの連鎖に載っている節点のうち、根を除いた数である。
 *
 * @param overview 取得した一覧。未取得なら `null`
 */
export function countBlockedSessions(overview: SessionOverview | null): number {
  if (!overview) {
    return 0
  }

  return overview.chains.reduce((total, root) => total + countNodes(root.blocked), 0)
}
