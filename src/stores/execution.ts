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
 * 生成は記録しない。バインド変数へ与えた値も記録しない。値には個人情報が入りうる
 * ためである（ADR の「バインド変数」節）。
 */

import { create } from 'zustand'
import { getDbApi } from '../api/db'
import type { Bind, Cell, Column, NewHistoryEntry } from '../types/db'
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
  /** スクリプト実行の何文目か。単発の実行とトランザクションの操作では `null`。 */
  statement: ScriptProgress | null
}

/** トランザクションの操作。ログの見出しに使う。 */
export type TransactionAction = 'commit' | 'rollback'

/** 整形の報せをログに出すときの見出し（ADR 0024）。 */
const FORMAT_LOG_LABEL = 'SQL の整形'

/** 接続にまつわる報せをログに出すときの見出し（ADR 0026）。 */
const CONNECTION_LOG_LABEL = '接続'

/**
 * 未コミットのまま接続が切れたことを告げる文言（ADR 0026）。
 *
 * Oracle はセッションが切れた時点で未コミットの変更をロールバックしている。
 * 「未コミット」の表示だけを黙って消すと、利用者は自分の変更が残っていると
 * 思ったまま繋ぎ直し、別のセッションでそれを探すことになる。
 */
const LOST_TRANSACTION_NOTICE =
  '未コミットの変更はデータベース側でロールバックされました。繋ぎ直した接続は別のセッションです'

/** 繋ぎ直せなかったことを告げる文言（ADR 0026）。 */
const RECONNECT_FAILURE_NOTICE = '繋ぎ直せませんでした'

/**
 * 接続にまつわる報せをログの 1 行として組み立てる（ADR 0026）。
 *
 * @param error 出す文言
 */
function 接続のログ(error: string): LogEntry {
  return {
    id: crypto.randomUUID(),
    startedAt: new Date(),
    sql: CONNECTION_LOG_LABEL,
    elapsedMs: null,
    rowCount: null,
    error,
    notices: [],
    statement: null,
  }
}

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
   * 記録するのは SQL 本体だけで、バインド変数へ与えた値は残さない。
   */
  execute: (
    connectionId: string,
    tabId: string,
    sql: string,
    connectionName: string,
    binds: Bind[],
  ) => Promise<void>
  /**
   * 複数の文を順に実行する（`⌥⌘⏎`）。
   *
   * 前の文が終わってから次を投げる。途中で失敗したら以降の文は実行しない。
   * 履歴とログには 1 文ずつ記録する。バインド変数の値は全文で使い回すため、
   * 呼び出し側が実行を始める前にまとめて尋ねる。
   */
  executeScript: (
    connectionId: string,
    tabId: string,
    statements: string[],
    connectionName: string,
    binds: Bind[],
  ) => Promise<void>
  /** 実行計画を取る（`⌘E` / `⇧⌘E`）。履歴には記録しない。 */
  generatePlan: (
    connectionId: string,
    tabId: string,
    sql: string,
    mode: PlanMode,
    binds: Bind[],
  ) => Promise<void>
  /** 開いている結果セットから続きを取り出す。 */
  fetchMore: (connectionId: string, tabId: string) => Promise<void>
  /**
   * 実行中の文を中止する（`⌘.`）。
   *
   * スクリプト実行では、走っている文を中止したうえで残りの文も実行しない。
   */
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
  /**
   * 整形できなかったことをメッセージタブへ残す（ADR 0024）。
   *
   * 整形は接続を要らない操作だが、報せの行き先はここ 1 つにしてある
   * （ADR README「機能スコープ」の「エラー表示はメッセージタブのテキストの
   * みとする」）。エディタの中に別の出し方を作らない。
   */
  noteFormatFailure: (message: string) => void
  /**
   * サーバ側で接続が切れたことを記録する（ADR 0026）。
   *
   * 3 つを同時に行う。
   *
   * 1. **未コミットの表示を降ろす。** 切れた時点で Oracle はロールバック済みで
   *    あり、「未コミット」を出し続けるのは嘘になる。
   * 2. **降ろしたことをメッセージタブへ残す。** 黙って消すのが最も悪い。
   * 3. **開いたままだった結果セットを破棄済みにする。** カーソルはサーバ側に
   *    もう無い（ADR 0003 の「結果は破棄されました。再実行してください」）。
   *    読み切ったタブの行はクライアント側にあるため、そのまま残す。
   */
  noteConnectionLost: (message: string) => void
  /**
   * 繋ぎ直せなかったことを記録する（ADR 0026）。
   *
   * 「再接続」を押した結果は、成功しても失敗しても分かる必要がある。失敗は
   * 断そのものではないため `noteConnectionLost` とは別の入口にしてあり、
   * 押すたびに 1 行が積まれる（押した回数だけ結果があるのが正しい）。
   */
  noteReconnectFailure: (message: string) => void
  /** すべての結果とログを捨てる。接続を切り替えたときに使う。 */
  clear: () => void
}

/**
 * 接続が切れたときに、破棄済みへ落とすタブを決める（ADR 0026）。
 *
 * **カーソルを開いたままだったタブだけ**が対象である。読み切ったタブ
 * （`exhausted`）の行はすべてクライアント側にあり、接続が切れても正しいままで
 * ある。それを「破棄されました」に変えるのは、手元にある正しい結果を捨てる
 * ことになる。
 *
 * @param byTab 現在のタブごとの実行状態
 */
export function discardOpenCursors(
  byTab: Record<string, TabExecution>,
): Record<string, TabExecution> {
  const next: Record<string, TabExecution> = {}

  for (const [tabId, execution] of Object.entries(byTab)) {
    const 開いたまま = execution.status === 'succeeded' && !execution.exhausted
    next[tabId] = 開いたまま ? { ...execution, status: 'discarded' } : execution
  }

  return next
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
   * 何を結果として残すかが違うためである。未コミットかどうかは応答が持って
   * くるため、ここで受け取ったまま置き換える（ADR 0012）。
   *
   * @param connectionId 接続の ID
   * @param tabId 実行するタブ
   * @param sql 実行する 1 文
   * @param connectionName 履歴に残す接続名
   * @param binds バインド変数の値。文に無い名前は Rust 側で捨てられる
   * @param progress スクリプト実行の何文目か。単発の実行では `null`
   */
  const runStatement = async (
    connectionId: string,
    tabId: string,
    sql: string,
    connectionName: string,
    binds: Bind[],
    progress: ScriptProgress | null,
  ): Promise<StatementOutcome> => {
    const startedAt = new Date()
    const entryId = crypto.randomUUID()

    try {
      const response = await getDbApi().execute(connectionId, tabId, sql, binds)

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
        inTransaction: response.inTransaction,
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
    inTransaction: false,

    execute: async (connectionId, tabId, sql, connectionName, binds) => {
      if (get().byTab[tabId]?.status === 'running') {
        return
      }

      set((state) => ({
        byTab: patchTab(state.byTab, tabId, { ...emptyExecution, status: 'running' }),
      }))

      const outcome = await runStatement(connectionId, tabId, sql, connectionName, binds, null)

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

    executeScript: async (connectionId, tabId, statements, connectionName, binds) => {
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
          binds,
          progress,
        )

        if (!outcome.ok) {
          // 途中で失敗したら以降の文は実行しない。何文目で止まったかを残す。
          // ここまでの文は未コミットのまま残る。勝手にコミットもロールバックも
          // しない（ADR 0012）。未コミットかどうかは最後に受け取った応答の値が
          // そのまま残り、ステータスバーに出る。
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

    generatePlan: async (connectionId, tabId, sql, mode, binds) => {
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
            ? await api.explainPlan(connectionId, sql, binds)
            : await api.actualPlan(connectionId, sql, binds)

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

    noteConnectionLost: (message) => {
      set((state) => {
        const 未コミットだった = state.inTransaction
        const error = 未コミットだった ? `${message}。${LOST_TRANSACTION_NOTICE}` : message

        return {
          inTransaction: false,
          byTab: discardOpenCursors(state.byTab),
          log: [...state.log, 接続のログ(error)],
        }
      })
    },

    noteReconnectFailure: (message) => {
      set((state) => ({
        log: [...state.log, 接続のログ(`${RECONNECT_FAILURE_NOTICE}: ${message}`)],
      }))
    },

    noteFormatFailure: (message) => {
      set((state) => ({
        log: [
          ...state.log,
          {
            id: crypto.randomUUID(),
            startedAt: new Date(),
            sql: FORMAT_LOG_LABEL,
            elapsedMs: null,
            rowCount: null,
            error: message,
            notices: [],
            statement: null,
          },
        ],
      }))
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

    clear: () => {
      cancelRequests.clear()
      set({ byTab: {}, planByTab: {}, log: [], inTransaction: false })
    },
  }
})

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
          statement: null,
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
          statement: null,
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
 * 実行中のタブが 1 つでもあるかを返す。
 *
 * 切断してよいかの判定に使う。接続を閉じると走っている文は道半ばで
 * 打ち切られるため、先に中止させる（`⌘.`）。
 *
 * @param state 実行ストアの状態
 */
export function selectAnyRunning(state: ExecutionState): boolean {
  return Object.values(state.byTab).some((execution) => execution.status === 'running')
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
  // 通知が無くてもエラーだけの記録は出す。整形の失敗（ADR 0024）と
  // コミットの失敗（ADR 0012）は通知を伴わないため、これが無いと出る先を失う。
  const hasMessages =
    execution.error !== null ||
    state.log.some((entry) => entry.notices.length > 0 || entry.error !== null)

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
