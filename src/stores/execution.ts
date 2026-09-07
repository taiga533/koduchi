/**
 * SQL の実行状態を持つストア（ADR 0003）。
 *
 * 結果セットはタブごとに保持される。カーソルは開いたままで、スクロールが下端に
 * 近づくたびに続きを取り出す。接続プールの本数を超えると古い結果セットが閉じられ、
 * そのタブは「破棄された」状態になる。
 *
 * 実行ログはウィンドウに 1 本だけ持ち、メッセージタブに時系列で出す。
 *
 * 実行はすべて履歴に記録する（ADR 0005）。ただし `⌘E` / `⇧⌘E` による実行計画の
 * 生成は記録しない。
 */

import { create } from 'zustand'
import { getDbApi } from '../api/db'
import type { Cell, Column, NewHistoryEntry } from '../types/db'
import { toErrorMessage } from '../types/db'

/** 実行の段階。 */
export type ExecutionStatus =
  | 'idle'
  | 'running'
  | 'succeeded'
  | 'failed'
  /** 接続を明け渡すために結果セットを閉じられた（ADR 0003）。 */
  | 'discarded'

/** タブ 1 枚ぶんの実行状態。 */
export interface TabExecution {
  status: ExecutionStatus
  columns: Column[]
  /** これまでに取り出した行。続きを取るたびに後ろへ伸びる。 */
  rows: Cell[][]
  /** カーソルが尽きたか。偽の間は総行数が分からない。 */
  exhausted: boolean
  /** 所要ミリ秒。実行前は `null`。 */
  elapsedMs: number | null
  /** 影響した行数。問い合わせでは `null`。 */
  affectedRows: number | null
  error: string | null
  /** 続きを取り出している最中か。二重に取りにいかないための見張り。 */
  loadingMore: boolean
}

/** 実行計画の取り方。 */
export type PlanMode =
  /** `⌘E`。`EXPLAIN PLAN FOR` による見積り。SQL は実行しない。 */
  | 'estimate'
  /** `⇧⌘E`。実際に実行してから `DBMS_XPLAN.DISPLAY_CURSOR` で取る。 */
  | 'actual'

/** タブ 1 枚ぶんの実行計画。 */
export interface TabPlan {
  status: 'running' | 'succeeded' | 'failed'
  mode: PlanMode
  /** `DBMS_XPLAN` が整形したテキスト。ツリーへはパースしない。 */
  text: string
  error: string | null
}

/** 何も実行していないタブの状態。 */
export const emptyExecution: TabExecution = {
  status: 'idle',
  columns: [],
  rows: [],
  exhausted: true,
  elapsedMs: null,
  affectedRows: null,
  error: null,
  loadingMore: false,
}

/** メッセージタブに時系列で積む 1 件。 */
export interface LogEntry {
  id: string
  /** 実行を開始した時刻。 */
  startedAt: Date
  /** 実行した SQL の全文。 */
  sql: string
  /** 所要ミリ秒。 */
  elapsedMs: number | null
  /** 行数または影響行数。取得中は途中の値になる。 */
  rowCount: number | null
  /** 失敗したときのメッセージ。 */
  error: string | null
  /** データベースからの通知（`DBMS_OUTPUT`）。 */
  notices: string[]
}

/** トランザクションの操作。ログの見出しに使う。 */
export type TransactionAction = 'commit' | 'rollback'

/** トランザクションの操作をログに出す文言（ADR 0012）。 */
const TRANSACTION_LABELS: Record<TransactionAction, string> = {
  commit: 'コミット',
  rollback: 'ロールバック',
}

interface ExecutionState {
  /** タブごとの実行状態。 */
  byTab: Record<string, TabExecution>
  /** タブごとの実行計画。取ったタブにだけ入る。 */
  planByTab: Record<string, TabPlan>
  /** メッセージタブに出す実行ログ。新しいものが後ろに積まれる。 */
  log: LogEntry[]
  /**
   * 未コミットのトランザクションが残っているか（ADR 0012）。
   *
   * 実行のたびにデータベースへ聞いた結果で置き換える。接続はウィンドウに
   * 1 つであるため、タブごとではなくウィンドウに 1 つ持つ。
   */
  inTransaction: boolean

  /**
   * SQL を実行する。
   *
   * 成功・失敗を問わず履歴に記録する。記録に失敗しても実行の結果は保つ。
   */
  execute: (
    connectionId: string,
    tabId: string,
    sql: string,
    connectionName: string,
  ) => Promise<void>
  /** 実行計画を取る（`⌘E` / `⇧⌘E`）。履歴には記録しない。 */
  generatePlan: (connectionId: string, tabId: string, sql: string, mode: PlanMode) => Promise<void>
  /** 開いている結果セットから続きを取り出す。 */
  fetchMore: (connectionId: string, tabId: string) => Promise<void>
  /** 実行中の文を中止する（`⌘.`）。 */
  cancel: (connectionId: string, tabId: string) => Promise<void>
  /**
   * トランザクションをコミットする（`⌥⌘C`、ADR 0012）。
   *
   * 結果はメッセージタブのログへ 1 行として残す。
   */
  commit: (connectionId: string) => Promise<void>
  /** トランザクションをロールバックする（`⌥⌘R`、ADR 0012）。 */
  rollback: (connectionId: string) => Promise<void>
  /** タブの結果セットを手放す。タブを閉じたときに呼ぶ。 */
  releaseTab: (connectionId: string, tabId: string) => Promise<void>
  /**
   * タブのカーソルを尽きたものとして扱う。
   *
   * CSV 書き出しはカーソルを最後まで読み進めるが、行はストアに溜めない。
   * 書き出しの後に「まだ続きがある」と表示し続けないための後始末である。
   */
  markExhausted: (tabId: string) => void
  /** すべての結果とログを捨てる。接続を切り替えたときに使う。 */
  clear: () => void
}

/**
 * タブの状態を差し替える。
 *
 * @param byTab 現在のタブごとの状態
 * @param tabId 対象のタブ
 * @param patch 差し替える項目
 */
function patchTab(
  byTab: Record<string, TabExecution>,
  tabId: string,
  patch: Partial<TabExecution>,
): Record<string, TabExecution> {
  return { ...byTab, [tabId]: { ...(byTab[tabId] ?? emptyExecution), ...patch } }
}

/**
 * 履歴へ 1 件記録する。
 *
 * 履歴の書き込みに失敗しても、実行そのものの結果は失わせない。保管庫の不調で
 * クエリの結果が消えるほうが害が大きい。
 *
 * @param entry 記録する内容
 */
async function recordHistory(entry: NewHistoryEntry): Promise<void> {
  try {
    await getDbApi().recordHistory(entry)
  } catch {
    // 記録できないことは結果の表示に影響しない。
  }
}

export const useExecutionStore = create<ExecutionState>((set, get) => ({
  byTab: {},
  planByTab: {},
  log: [],
  inTransaction: false,

  execute: async (connectionId, tabId, sql, connectionName) => {
    if (get().byTab[tabId]?.status === 'running') {
      return
    }

    const startedAt = new Date()
    const entryId = crypto.randomUUID()

    set((state) => ({
      byTab: patchTab(state.byTab, tabId, {
        ...emptyExecution,
        status: 'running',
      }),
    }))

    try {
      const response = await getDbApi().execute(connectionId, tabId, sql)

      const execution: TabExecution =
        response.kind === 'query'
          ? {
              status: 'succeeded',
              columns: response.columns,
              rows: response.chunk.rows,
              exhausted: response.chunk.exhausted,
              elapsedMs: response.elapsedMs,
              affectedRows: null,
              error: null,
              loadingMore: false,
            }
          : {
              ...emptyExecution,
              status: 'succeeded',
              elapsedMs: response.elapsedMs,
              affectedRows: response.affectedRows,
            }

      set((state) => {
        let byTab = patchTab(state.byTab, tabId, execution)

        // 接続を明け渡すために閉じられたタブには、再実行を促す状態を残す。
        if (response.discardedTab) {
          byTab = patchTab(byTab, response.discardedTab, { status: 'discarded' })
        }

        return {
          byTab,
          inTransaction: response.inTransaction,
          log: [
            ...state.log,
            {
              id: entryId,
              startedAt,
              sql,
              elapsedMs: response.elapsedMs,
              rowCount: execution.affectedRows ?? execution.rows.length,
              error: null,
              notices: response.notices,
            },
          ],
        }
      })

      await recordHistory({
        sql,
        connectionName,
        startedAt: startedAt.getTime(),
        elapsedMs: response.elapsedMs,
        rowCount: execution.affectedRows ?? execution.rows.length,
        succeeded: true,
        errorMessage: null,
      })
    } catch (error) {
      const message = toErrorMessage(error)
      set((state) => ({
        byTab: patchTab(state.byTab, tabId, {
          ...emptyExecution,
          status: 'failed',
          error: message,
        }),
        log: [
          ...state.log,
          {
            id: entryId,
            startedAt,
            sql,
            elapsedMs: Date.now() - startedAt.getTime(),
            rowCount: null,
            error: message,
            notices: [],
          },
        ],
      }))

      await recordHistory({
        sql,
        connectionName,
        startedAt: startedAt.getTime(),
        elapsedMs: Date.now() - startedAt.getTime(),
        rowCount: null,
        succeeded: false,
        errorMessage: message,
      })
    }
  },

  generatePlan: async (connectionId, tabId, sql, mode) => {
    set((state) => ({
      planByTab: {
        ...state.planByTab,
        [tabId]: { status: 'running', mode, text: '', error: null },
      },
    }))

    try {
      const api = getDbApi()
      const text =
        mode === 'estimate'
          ? await api.explainPlan(connectionId, sql)
          : await api.actualPlan(connectionId, sql)

      set((state) => ({
        planByTab: {
          ...state.planByTab,
          [tabId]: { status: 'succeeded', mode, text, error: null },
        },
      }))
    } catch (error) {
      set((state) => ({
        planByTab: {
          ...state.planByTab,
          [tabId]: { status: 'failed', mode, text: '', error: toErrorMessage(error) },
        },
      }))
    }
  },

  fetchMore: async (connectionId, tabId) => {
    const current = get().byTab[tabId]
    if (!current || current.exhausted || current.loadingMore || current.status !== 'succeeded') {
      return
    }

    set((state) => ({ byTab: patchTab(state.byTab, tabId, { loadingMore: true }) }))

    try {
      const chunk = await getDbApi().fetchMore(connectionId, tabId)
      set((state) => {
        const tab = state.byTab[tabId] ?? emptyExecution
        return {
          byTab: patchTab(state.byTab, tabId, {
            rows: [...tab.rows, ...chunk.rows],
            exhausted: chunk.exhausted,
            loadingMore: false,
          }),
        }
      })
    } catch (error) {
      // 結果セットが閉じられていた場合はここへ来る。再実行を促す状態にする。
      set((state) => ({
        byTab: patchTab(state.byTab, tabId, {
          status: 'discarded',
          loadingMore: false,
          error: toErrorMessage(error),
        }),
      }))
    }
  },

  cancel: async (connectionId, tabId) => {
    if (get().byTab[tabId]?.status !== 'running') {
      return
    }
    await getDbApi().cancel(connectionId, tabId)
  },

  commit: async (connectionId) => {
    await 終わらせる(set, connectionId, 'commit')
  },

  rollback: async (connectionId) => {
    await 終わらせる(set, connectionId, 'rollback')
  },

  releaseTab: async (connectionId, tabId) => {
    await getDbApi().releaseTab(connectionId, tabId)
    set((state) => {
      const { [tabId]: _removed, ...rest } = state.byTab
      const { [tabId]: _removedPlan, ...restPlans } = state.planByTab
      return { byTab: rest, planByTab: restPlans }
    })
  },

  markExhausted: (tabId) =>
    set((state) =>
      state.byTab[tabId]
        ? { byTab: patchTab(state.byTab, tabId, { exhausted: true, loadingMore: false }) }
        : state,
    ),

  clear: () => set({ byTab: {}, planByTab: {}, log: [], inTransaction: false }),
}))

/**
 * トランザクションを終わらせ、その結果をログへ 1 行として残す（ADR 0012）。
 *
 * 成功したら未コミットの表示を消す。失敗したときは未コミットのままにする。
 * 「コミットしました」と出しながら変更が残っているほうが害が大きい。
 *
 * @param set ストアの更新関数
 * @param connectionId 対象の接続
 * @param action コミットかロールバックか
 */
async function 終わらせる(
  set: (updater: (state: ExecutionState) => Partial<ExecutionState>) => void,
  connectionId: string,
  action: TransactionAction,
): Promise<void> {
  const label = TRANSACTION_LABELS[action]
  const startedAt = new Date()
  const entryId = crypto.randomUUID()

  try {
    const api = getDbApi()
    await (action === 'commit' ? api.commit(connectionId) : api.rollback(connectionId))

    set((state) => ({
      inTransaction: false,
      log: [
        ...state.log,
        {
          id: entryId,
          startedAt,
          sql: label,
          elapsedMs: Date.now() - startedAt.getTime(),
          rowCount: null,
          error: null,
          notices: [`${label}しました`],
        },
      ],
    }))
  } catch (error) {
    set((state) => ({
      log: [
        ...state.log,
        {
          id: entryId,
          startedAt,
          sql: label,
          elapsedMs: Date.now() - startedAt.getTime(),
          rowCount: null,
          error: toErrorMessage(error),
          notices: [],
        },
      ],
    }))
  }
}

/**
 * タブの実行状態を返す。まだ実行していなければ空の状態を返す。
 *
 * @param state 実行ストアの状態
 * @param tabId 対象のタブ
 */
export function selectExecution(state: ExecutionState, tabId: string | null): TabExecution {
  if (!tabId) {
    return emptyExecution
  }
  return state.byTab[tabId] ?? emptyExecution
}

/**
 * 結果ペインのヘッダー右端に出す要約を組み立てる（ADR 0003）。
 *
 * カーソル方式では総行数が事前に分からないため、表示を 2 段階にする。
 * 取得中は取得済み行数を、尽きた時点でデザインどおりの確定表示に切り替える。
 *
 * @param execution タブの実行状態
 */
export function formatResultSummary(execution: TabExecution): string {
  switch (execution.status) {
    case 'idle':
      return ''
    case 'running':
      return '実行中'
    case 'failed':
      return execution.elapsedMs === null ? '失敗' : `失敗 · ${execution.elapsedMs} ms`
    case 'discarded':
      return '結果は破棄されました'
    case 'succeeded':
      break
  }

  if (execution.affectedRows !== null) {
    return `${execution.affectedRows.toLocaleString('ja-JP')} 行 · ${execution.elapsedMs} ms`
  }

  const count = execution.rows.length.toLocaleString('ja-JP')

  // 尽きるまでは総行数が分からない。嘘をつかないよう「読み込み済み」と添える。
  return execution.exhausted
    ? `${count} 行 · ${execution.elapsedMs} ms`
    : `${count} 行 読み込み済み`
}

/**
 * 結果ペインに出すタブの一覧を決める（ADR 0009）。
 *
 * 通常は「結果」だけを出し、メッセージは内容があるときにだけ加える。
 * タブが 1 つのときはタブ行そのものを描かない。
 *
 * @param state 実行ストアの状態
 * @param tabId 対象のタブ
 */
export function selectResultTabs(
  state: ExecutionState,
  tabId: string | null,
): ('result' | 'messages' | 'plan')[] {
  const execution = selectExecution(state, tabId)
  const hasMessages =
    execution.error !== null || state.log.some((entry) => entry.notices.length > 0)

  const tabs: ('result' | 'messages' | 'plan')[] = ['result']
  if (hasMessages) {
    tabs.push('messages')
  }
  if (tabId !== null && state.planByTab[tabId] !== undefined) {
    tabs.push('plan')
  }
  return tabs
}

/**
 * タブの実行計画を返す。取っていなければ `null`。
 *
 * @param state 実行ストアの状態
 * @param tabId 対象のタブ
 */
export function selectPlan(state: ExecutionState, tabId: string | null): TabPlan | null {
  if (!tabId) {
    return null
  }
  return state.planByTab[tabId] ?? null
}
