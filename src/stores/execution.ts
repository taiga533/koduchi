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
  /**
   * スクリプト実行（`⌥⌘⏎`）の位置。単発の実行では `null`。
   *
   * 実行中は今どの文を投げているかを、失敗したときはどの文で止まったかを指す。
   */
  progress: ScriptProgress | null
}

/** スクリプト実行における文の位置。 */
export interface ScriptProgress {
  /** 何文目か（1 始まり）。 */
  index: number
  /** 実行する文の総数。 */
  total: number
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
  progress: null,
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
  /** スクリプト実行の何文目か。単発の実行では `null`。 */
  statement: ScriptProgress | null
}

interface ExecutionState {
  /** タブごとの実行状態。 */
  byTab: Record<string, TabExecution>
  /** タブごとの実行計画。取ったタブにだけ入る。 */
  planByTab: Record<string, TabPlan>
  /** メッセージタブに出す実行ログ。新しいものが後ろに積まれる。 */
  log: LogEntry[]

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
  /**
   * 複数の文を順に実行する（`⌥⌘⏎`）。
   *
   * 前の文が終わってから次を投げる。途中で失敗したら以降の文は実行しない。
   * 履歴とログには 1 文ずつ記録する。
   */
  executeScript: (
    connectionId: string,
    tabId: string,
    statements: string[],
    connectionName: string,
  ) => Promise<void>
  /** 実行計画を取る（`⌘E` / `⇧⌘E`）。履歴には記録しない。 */
  generatePlan: (connectionId: string, tabId: string, sql: string, mode: PlanMode) => Promise<void>
  /** 開いている結果セットから続きを取り出す。 */
  fetchMore: (connectionId: string, tabId: string) => Promise<void>
  /**
   * 実行中の文を中止する（`⌘.`）。
   *
   * スクリプト実行では、走っている文を中止したうえで残りの文も実行しない。
   */
  cancel: (connectionId: string, tabId: string) => Promise<void>
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
 * 中止（`⌘.`）を求められたタブ。
 *
 * スクリプト実行の途中で中止されたことを、走っている文の外側へ伝えるために使う。
 * 描画には関わらないためストアの状態には持たせない。
 */
const cancelRequests = new Set<string>()

/** 1 文を実行した結末。 */
type StatementOutcome =
  | {
      ok: true
      /** 成功した文の結果。 */
      execution: TabExecution
      /** 接続を明け渡すために結果セットを閉じられたタブ（ADR 0003）。 */
      discardedTab: string | null
    }
  | {
      ok: false
      /** 失敗の内容。 */
      message: string
      /** 失敗するまでに要したミリ秒。 */
      elapsedMs: number
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

export const useExecutionStore = create<ExecutionState>((set, get) => {
  /**
   * 1 文を実行し、ログと履歴へ 1 件ずつ記録する。
   *
   * タブの表示状態は呼び出し側が決める。単発の実行とスクリプト実行とで、
   * 何を残すかが違うためである。
   *
   * @param connectionId 接続の ID
   * @param tabId 実行するタブ
   * @param sql 実行する 1 文
   * @param connectionName 履歴に残す接続名
   * @param progress スクリプト実行の何文目か。単発の実行では `null`
   */
  const runStatement = async (
    connectionId: string,
    tabId: string,
    sql: string,
    connectionName: string,
    progress: ScriptProgress | null,
  ): Promise<StatementOutcome> => {
    const startedAt = new Date()
    const entryId = crypto.randomUUID()

    try {
      const response = await getDbApi().execute(connectionId, tabId, sql)

      const execution: TabExecution =
        response.kind === 'query'
          ? {
              ...emptyExecution,
              status: 'succeeded',
              columns: response.columns,
              rows: response.chunk.rows,
              exhausted: response.chunk.exhausted,
              elapsedMs: response.elapsedMs,
            }
          : {
              ...emptyExecution,
              status: 'succeeded',
              elapsedMs: response.elapsedMs,
              affectedRows: response.affectedRows,
            }

      const rowCount = execution.affectedRows ?? execution.rows.length

      set((state) => ({
        log: [
          ...state.log,
          {
            id: entryId,
            startedAt,
            sql,
            elapsedMs: response.elapsedMs,
            rowCount,
            error: null,
            notices: response.notices,
            statement: progress,
          },
        ],
      }))

      await recordHistory({
        sql,
        connectionName,
        startedAt: startedAt.getTime(),
        elapsedMs: response.elapsedMs,
        rowCount,
        succeeded: true,
        errorMessage: null,
      })

      return { ok: true, execution, discardedTab: response.discardedTab }
    } catch (error) {
      const message = toErrorMessage(error)
      const elapsedMs = Date.now() - startedAt.getTime()

      set((state) => ({
        log: [
          ...state.log,
          {
            id: entryId,
            startedAt,
            sql,
            elapsedMs,
            rowCount: null,
            error: message,
            notices: [],
            statement: progress,
          },
        ],
      }))

      await recordHistory({
        sql,
        connectionName,
        startedAt: startedAt.getTime(),
        elapsedMs,
        rowCount: null,
        succeeded: false,
        errorMessage: message,
      })

      return { ok: false, message, elapsedMs }
    }
  }

  return {
    byTab: {},
    planByTab: {},
    log: [],

    execute: async (connectionId, tabId, sql, connectionName) => {
      if (get().byTab[tabId]?.status === 'running') {
        return
      }

      set((state) => ({
        byTab: patchTab(state.byTab, tabId, { ...emptyExecution, status: 'running' }),
      }))

      const outcome = await runStatement(connectionId, tabId, sql, connectionName, null)

      set((state) => {
        if (!outcome.ok) {
          return {
            byTab: patchTab(state.byTab, tabId, {
              ...emptyExecution,
              status: 'failed',
              error: outcome.message,
            }),
          }
        }

        let byTab = patchTab(state.byTab, tabId, outcome.execution)

        // 接続を明け渡すために閉じられたタブには、再実行を促す状態を残す。
        if (outcome.discardedTab) {
          byTab = patchTab(byTab, outcome.discardedTab, { status: 'discarded' })
        }

        return { byTab }
      })
    },

    executeScript: async (connectionId, tabId, statements, connectionName) => {
      if (get().byTab[tabId]?.status === 'running' || statements.length === 0) {
        return
      }

      const total = statements.length
      cancelRequests.delete(tabId)

      set((state) => ({
        byTab: patchTab(state.byTab, tabId, {
          ...emptyExecution,
          status: 'running',
          progress: { index: 1, total },
        }),
      }))

      /** 最後に結果セットを返した文の結果。無ければ影響行数を足し上げる。 */
      let lastQuery: TabExecution | null = null
      let affectedRows = 0
      let elapsedMs = 0
      let discardedTab: string | null = null

      for (let index = 0; index < total; index += 1) {
        const progress: ScriptProgress = { index: index + 1, total }

        // 文と文の間で中止された場合。走っている文の中止は実行そのものが失敗する。
        if (cancelRequests.has(tabId)) {
          set((state) => ({
            byTab: patchTab(state.byTab, tabId, {
              ...emptyExecution,
              status: 'failed',
              error: '実行を中止しました',
              elapsedMs,
            }),
          }))
          cancelRequests.delete(tabId)
          return
        }

        if (index > 0) {
          set((state) => ({ byTab: patchTab(state.byTab, tabId, { progress }) }))
        }

        const outcome = await runStatement(
          connectionId,
          tabId,
          statements[index],
          connectionName,
          progress,
        )

        if (!outcome.ok) {
          // 途中で失敗したら以降の文は実行しない。何文目で止まったかを残す。
          set((state) => ({
            byTab: patchTab(state.byTab, tabId, {
              ...emptyExecution,
              status: 'failed',
              error: outcome.message,
              elapsedMs: elapsedMs + outcome.elapsedMs,
              progress,
            }),
          }))
          cancelRequests.delete(tabId)
          return
        }

        elapsedMs += outcome.execution.elapsedMs ?? 0
        if (outcome.execution.columns.length > 0) {
          lastQuery = outcome.execution
        } else {
          affectedRows += outcome.execution.affectedRows ?? 0
        }
        if (outcome.discardedTab && outcome.discardedTab !== tabId) {
          discardedTab = outcome.discardedTab
        }
      }

      cancelRequests.delete(tabId)

      // 結果ペインには最後の結果セットを出す。問い合わせが 1 つも無ければ
      // 影響行数の合計を出す。所要時間はどちらも全体の合計とする。
      const execution: TabExecution = lastQuery
        ? { ...lastQuery, elapsedMs }
        : { ...emptyExecution, status: 'succeeded', elapsedMs, affectedRows }

      set((state) => {
        let byTab = patchTab(state.byTab, tabId, execution)
        if (discardedTab) {
          byTab = patchTab(byTab, discardedTab, { status: 'discarded' })
        }
        return { byTab }
      })
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
      // スクリプト実行の途中なら、残りの文を投げないための目印にもなる。
      cancelRequests.add(tabId)
      await getDbApi().cancel(connectionId, tabId)
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

    clear: () => {
      cancelRequests.clear()
      set({ byTab: {}, planByTab: {}, log: [] })
    },
  }
})

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
      return execution.progress
        ? `${execution.progress.index} / ${execution.progress.total} 文目を実行中`
        : '実行中'
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
