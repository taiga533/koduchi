/**
 * アプリのルートコンポーネント。
 *
 * デザイン 3a の 3 パネル構成を組み立て、状態に応じて次の 3 つを出し分ける。
 *
 * 1. Instant Client が読めない（ADR 0001） … 案内画面
 * 2. 未接続（デザイン 5g） … 保存した接続を選ぶ画面と、接続を作成する画面
 * 3. 接続中 … エディタと結果ペイン
 *
 * キーバインドのうち、エディタの中でしか意味を持たない `⌘⏎` / `⇧⌘⏎` / `⌥⌘⏎` / `⌘.` は
 * CodeMirror 側に置く。それ以外はウィンドウ全体で効かせる。`⌘K` のコマンドパレットと
 * `⇧⌘S` のクエリ保存もここにある（ADR 0018）。
 *
 * 打鍵のたびに描き直る範囲を狭く保つ。カーソル位置は `ui` ストアへ逃がし、
 * 実行に要る位置は ref で持つ。サイドバーと結果ペインへ渡すコールバックは
 * 選択中のタブに依存させず、押された時点のタブをストアから読む。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { confirm, open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { getDbApi } from './api/db'
import { InstantClientNotice } from './components/connection/InstantClientNotice'
import { ConnectionForm } from './components/connection/ConnectionForm'
import { ConnectionPicker } from './components/connection/ConnectionPicker'
import { DisconnectBlockedDialog } from './components/connection/DisconnectBlockedDialog'
import type { CsvExportState } from './components/csv/CsvSaveDialog'
import { CsvSaveDialog } from './components/csv/CsvSaveDialog'
import { BindValuesDialog } from './components/editor/BindValuesDialog'
import { EditorPanel } from './components/editor/EditorPanel'
import { SaveQueryDialog } from './components/editor/SaveQueryDialog'
import { Splitter } from './components/layout/Splitter'
import {
  EDITOR_HEIGHT_DEFAULT,
  EDITOR_HEIGHT_MIN,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  editorHeightMax,
} from './components/layout/paneSizes'
import type { PaletteCommand } from './components/palette/CommandPalette'
import { CommandPalette } from './components/palette/CommandPalette'
import { RunButton } from './components/editor/RunButton'
import type { EditorPosition, SqlEditorHandle } from './components/editor/SqlEditor'
import { TabBar } from './components/editor/TabBar'
import { ResultPane } from './components/results/ResultPane'
import { TableDefinitionPanel } from './components/definition/TableDefinitionPanel'
import { SessionsPanel } from './components/sessions/SessionsPanel'
import { SourceSearchPanel } from './components/source/SourceSearchPanel'
import { SettingsPanel } from './components/settings/SettingsPanel'
import { Sidebar } from './components/sidebar/Sidebar'
import { StatusBar } from './components/statusbar/StatusBar'
import { TitleBar } from './components/titlebar/TitleBar'
import { exportCsv } from './csv/exportCsv'
import { inferBindKinds } from './sql/bindTypes'
import type { BindOccurrence } from './sql/statements'
import {
  collectBindOccurrences,
  collectBindOccurrencesAcross,
  collectBindVariables,
  collectBindVariablesAcross,
  isSelectStatement,
  splitStatements,
  statementAt,
} from './sql/statements'
import { isManualCommit, useConnectionStore } from './stores/connection'
import { selectAnyRunning, useExecutionStore } from './stores/execution'
import { useHistoryStore } from './stores/history'
import { nodeKey, useSchemaStore } from './stores/schema'
import { useSavedQueryStore } from './stores/savedQuery'
import { useDefinitionStore } from './stores/definition'
import { useSessionsStore } from './stores/sessions'
import { useSourceSearchStore } from './stores/sourceSearch'
import type { BindInput } from './stores/tab'
import {
  fillBindDefaults,
  selectActiveTab,
  selectBindValues,
  selectSession,
  toBinds,
  useTabStore,
} from './stores/tab'
import { useUiStore } from './stores/ui'
import type { PendingWording } from './transaction/pendingChanges'
import { askPendingChoice, CLOSE_WORDING, DISCONNECT_WORDING } from './transaction/pendingChanges'
import { currentWindowLabel, onWindowCloseRequested } from './window'
import type { Bind, ClientStatus, SavedConnection, SchemaFilter } from './types/db'

/** カーソルの初期位置。エディタから通知が来るまでの値。 */
const INITIAL_POSITION: EditorPosition = {
  line: 1,
  column: 1,
  offset: 0,
  selectedText: null,
}

/** セッションを書き出すまでの待ち時間（ミリ秒）。 */
const SESSION_SAVE_DELAY = 600

/** `.sql` ファイルを開く / 保存するときの絞り込み。 */
const SQL_FILTERS = [{ name: 'SQL', extensions: ['sql'] }]

/**
 * 未接続のときに出す画面。
 *
 * 保存した接続を選ぶ画面が手前に立ち、そこから新規作成と編集へ進む。
 * `connection` が編集対象で、`null` なら新規作成である。
 */
type ConnectionView = { mode: 'picker' } | { mode: 'form'; connection: SavedConnection | null }

/**
 * バインド変数の値が揃うのを待っている実行（ADR の「バインド変数」節）。
 *
 * `⌘⏎` / `⇧⌘⏎` / `⌥⌘⏎` の実行と、`⌘E` / `⇧⌘E` の実行計画のどれもここへ載せる。
 */
type PendingRun =
  | { kind: 'execute'; sql: string }
  | { kind: 'plan'; sql: string; actual: boolean }
  /** `⌥⌘⏎`。切り出した文を順に実行する。値は全文で使い回す。 */
  | { kind: 'script'; statements: string[] }

/**
 * 実行の対象からバインド変数の名前を集める。
 *
 * スクリプト実行では、1 文ごとに尋ねずに全文ぶんをまとめて 1 度だけ尋ねる。
 *
 * @param run 値が揃うのを待っている実行
 */
function bindVariablesOf(run: PendingRun): string[] {
  return run.kind === 'script'
    ? collectBindVariablesAcross(run.statements)
    : collectBindVariables(run.sql)
}

/**
 * 実行の対象からバインド変数の出てくる場所を集める。
 *
 * 既定の型を推し量るのに使う（ADR 0016）。
 *
 * @param run 値が揃うのを待っている実行
 */
function bindOccurrencesOf(run: PendingRun): BindOccurrence[] {
  return run.kind === 'script'
    ? collectBindOccurrencesAcross(run.statements)
    : collectBindOccurrences(run.sql)
}

export function App() {
  const [clientStatus, setClientStatus] = useState<ClientStatus | null>(null)
  const [connectionView, setConnectionView] = useState<ConnectionView>({ mode: 'picker' })
  const [csvOpen, setCsvOpen] = useState(false)
  const [bindPrompt, setBindPrompt] = useState<{ names: string[]; run: PendingRun } | null>(null)
  const [disconnectBlocked, setDisconnectBlocked] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [saveQueryPrompt, setSaveQueryPrompt] = useState<{ name: string; sql: string } | null>(null)
  const [csvProgress, setCsvProgress] = useState<CsvExportState | null>(null)
  const csvCancelled = useRef(false)
  // 実行に要る位置は描画に関わらないため、状態ではなく ref で持つ。
  const positionRef = useRef<EditorPosition>(INITIAL_POSITION)
  // スキーマツリーからエディタへ差し込むための口（ADR 0020）。
  const editorRef = useRef<SqlEditorHandle>(null)

  const connection = useConnectionStore((state) => state.connection)
  const disconnect = useConnectionStore((state) => state.disconnect)
  const activeTabId = useTabStore((state) => state.activeTabId)
  // 名前だけを購読する。タブの配列そのものを見ると、打鍵のたびにここが
  // 描き直り、サイドバーと結果ペインまで巻き添えになる。
  const activeTabName = useTabStore((state) => selectActiveTab(state)?.name ?? '')
  const updateContent = useTabStore((state) => state.updateContent)
  const closeTab = useTabStore((state) => state.closeTab)
  const openNewTab = useTabStore((state) => state.openNewTab)
  const openFile = useTabStore((state) => state.openFile)
  const markSaved = useTabStore((state) => state.markSaved)
  const restoreTabs = useTabStore((state) => state.restore)

  const execute = useExecutionStore((state) => state.execute)
  const executeScript = useExecutionStore((state) => state.executeScript)
  const generatePlan = useExecutionStore((state) => state.generatePlan)
  const fetchMore = useExecutionStore((state) => state.fetchMore)
  const cancel = useExecutionStore((state) => state.cancel)
  const commit = useExecutionStore((state) => state.commit)
  const rollback = useExecutionStore((state) => state.rollback)
  const releaseTab = useExecutionStore((state) => state.releaseTab)
  const markExhausted = useExecutionStore((state) => state.markExhausted)
  const clearExecutions = useExecutionStore((state) => state.clear)

  const selectSidebarSegment = useUiStore((state) => state.selectSidebarSegment)
  const selectResultTab = useUiStore((state) => state.selectResultTab)
  const setCursor = useUiStore((state) => state.setCursor)
  const settingsOpen = useUiStore((state) => state.settingsOpen)
  const openSettings = useUiStore((state) => state.openSettings)
  const closeSettings = useUiStore((state) => state.closeSettings)
  const sessionsOpen = useUiStore((state) => state.sessionsOpen)
  const openSessions = useUiStore((state) => state.openSessions)
  const closeSessions = useUiStore((state) => state.closeSessions)
  const sourceSearchOpen = useUiStore((state) => state.sourceSearchOpen)
  const openSourceSearch = useUiStore((state) => state.openSourceSearch)
  const closeSourceSearch = useUiStore((state) => state.closeSourceSearch)
  const loadSettings = useUiStore((state) => state.loadSettings)
  const csvOptions = useUiStore((state) => state.csvOptions)
  const setCsvOptions = useUiStore((state) => state.setCsvOptions)
  const clearResultColumnWidths = useUiStore((state) => state.clearResultColumnWidths)
  const sidebarWidth = useUiStore((state) => state.sidebarWidth)
  const editorHeight = useUiStore((state) => state.editorHeight)
  const setSidebarWidth = useUiStore((state) => state.setSidebarWidth)
  const setEditorHeight = useUiStore((state) => state.setEditorHeight)
  const clampToWindow = useUiStore((state) => state.clampToWindow)
  const restoreLayout = useUiStore((state) => state.restoreLayout)

  const saveQuery = useSavedQueryStore((state) => state.save)
  const clearSessions = useSessionsStore((state) => state.clear)
  const clearSourceSearch = useSourceSearchStore((state) => state.clear)
  const clearDefinition = useDefinitionStore((state) => state.clear)
  const definitionOpen = useDefinitionStore((state) => state.target !== null)

  const loadSchemas = useSchemaStore((state) => state.load)
  const setSchemaFilter = useSchemaStore((state) => state.setFilter)
  const clearSchemas = useSchemaStore((state) => state.clear)

  // 起動時に Instant Client を初期化する。接続を試す前に判定できるため、
  // 意味の分からないエラーで落ちる事態を避けられる（ADR 0001）。
  useEffect(() => {
    void getDbApi()
      .instantClientStatus()
      .then(setClientStatus)
      .catch(() =>
        setClientStatus({
          status: 'unavailable',
          message: 'Instant Client の状態を取得できませんでした',
          candidates: [],
        }),
      )
  }, [])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  // 前回のタブ構成を復元する（ADR 0005）。接続そのものは復元しない。
  useEffect(() => {
    void getDbApi()
      .loadSession(currentWindowLabel())
      .then((session) => {
        restoreTabs(session)
        if (
          session.sidebarSegment === 'schema' ||
          session.sidebarSegment === 'history' ||
          session.sidebarSegment === 'saved'
        ) {
          selectSidebarSegment(session.sidebarSegment)
        }
        restoreLayout(session, window.innerHeight)
      })
      .catch(() => {})
  }, [restoreLayout, restoreTabs, selectSidebarSegment])

  // ウィンドウを縮めたときにエディタの高さが上限を超えたままにならないよう、
  // 大きさが変わるたびに丸め直す（下限は割らない）。
  useEffect(() => {
    const onResize = () => clampToWindow(window.innerHeight)
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [clampToWindow])

  /** エディタからのカーソル通知。描画に関わる分だけストアへ渡す。 */
  const onCursorChange = useCallback(
    (position: EditorPosition) => {
      positionRef.current = position
      setCursor({ line: position.line, column: position.column }, position.selectedText !== null)
    },
    [setCursor],
  )

  /**
   * 値が揃った実行を行う。
   *
   * 実行と実行計画のどちらもここを通る。バインド変数を尋ねる経路を 1 本に
   * まとめるためである。
   */
  const runPending = useCallback(
    async (run: PendingRun, binds: Bind[]) => {
      const tabId = useTabStore.getState().activeTabId
      if (!connection || !tabId) {
        return
      }

      if (run.kind === 'execute') {
        selectResultTab('result')
        await execute(connection.id, tabId, run.sql, connection.name, binds)
        // 履歴は実行のたびに増える。開いていれば読み直す。
        await useHistoryStore.getState().reload()
        return
      }

      if (run.kind === 'script') {
        selectResultTab('result')
        await executeScript(connection.id, tabId, run.statements, connection.name, binds)
        await useHistoryStore.getState().reload()
        return
      }

      selectResultTab('plan')
      await generatePlan(connection.id, tabId, run.sql, run.actual ? 'actual' : 'estimate', binds)
    },
    [connection, execute, executeScript, generatePlan, selectResultTab],
  )

  /**
   * 実行に取りかかる。
   *
   * SQL にバインド変数が含まれていれば、その値を尋ねてからにする
   * （ADR の「バインド変数」節）。
   */
  const startRun = useCallback(
    (run: PendingRun) => {
      const names = bindVariablesOf(run)
      if (names.length === 0) {
        void runPending(run, [])
        return
      }

      // 初めて尋ねる変数には、比べている列から推し量った型を入れておく
      // （ADR 0016）。覚えている変数はそのまま残す。
      const tabId = useTabStore.getState().activeTabId
      if (tabId) {
        const kinds = inferBindKinds(bindOccurrencesOf(run), useSchemaStore.getState().columns)
        const values = selectBindValues(useTabStore.getState(), tabId)
        useTabStore.getState().setBindValues(tabId, fillBindDefaults(names, values, kinds))
      }

      setBindPrompt({ names, run })
    },
    [runPending],
  )

  /** バインド変数の値が決まった。覚えたうえで実行へ進む。 */
  const submitBinds = useCallback(() => {
    if (!bindPrompt) {
      return
    }
    const tabId = useTabStore.getState().activeTabId
    const values = selectBindValues(useTabStore.getState(), tabId)
    setBindPrompt(null)
    void runPending(bindPrompt.run, toBinds(bindPrompt.names, values))
  }, [bindPrompt, runPending])

  const runSql = useCallback(
    (sql: string) => {
      if (sql.trim() !== '') {
        startRun({ kind: 'execute', sql })
      }
    },
    [startRun],
  )

  /**
   * カーソル位置の文、または選択範囲を取り出す。
   *
   * 内容も位置もストアと ref から読むため、打鍵のたびに作り直さなくてよい。
   */
  const currentSql = useCallback((selectionOnly: boolean): string | null => {
    const tab = selectActiveTab(useTabStore.getState())
    if (!tab) {
      return null
    }
    if (selectionOnly) {
      return positionRef.current.selectedText
    }
    return statementAt(tab.content, positionRef.current.offset)?.text ?? null
  }, [])

  /** `⌘⏎`。カーソル位置の文を実行する。 */
  const runStatement = useCallback(() => {
    const sql = currentSql(false)
    if (sql) {
      runSql(sql)
    }
  }, [currentSql, runSql])

  /** `⇧⌘⏎`。選択範囲を実行する。選択が無ければ何もしない。 */
  const runSelection = useCallback(() => {
    const sql = currentSql(true)
    if (sql) {
      runSql(sql)
    }
  }, [currentSql, runSql])

  /**
   * `⌥⌘⏎`。タブ全体の文を順に実行する。
   *
   * 選択範囲があるときは、その中の文だけを順に実行する。バインド変数があれば
   * 実行を始める前に全文ぶんまとめて尋ねる。途中で失敗したら以降の文は
   * 実行しない（`executeScript` が判断する）。
   */
  const runScript = useCallback(() => {
    const tab = selectActiveTab(useTabStore.getState())
    if (!tab) {
      return
    }

    const source = positionRef.current.selectedText ?? tab.content
    const statements = splitStatements(source).map((statement) => statement.text)
    if (statements.length > 0) {
      startRun({ kind: 'script', statements })
    }
  }, [startRun])

  /**
   * `⌘E` / `⇧⌘E`。実行計画を出す。
   *
   * 実測付き（`⇧⌘E`）は SQL を実際に実行するため、問い合わせ以外に対しては
   * 事前に確認を取る（ADR の「実行計画」節）。
   */
  const runPlan = useCallback(
    async (actual: boolean) => {
      const tabId = useTabStore.getState().activeTabId
      if (!connection || !tabId) {
        return
      }
      const sql = currentSql(positionRef.current.selectedText !== null)
      if (!sql || sql.trim() === '') {
        return
      }

      if (actual && !isSelectStatement(sql)) {
        const 続ける = await confirm(
          'この文は問い合わせではありません。実測付きの実行計画を取るには、実際に実行する必要があります。実行しますか？',
          { title: '実測付きの実行計画', kind: 'warning' },
        )
        if (!続ける) {
          return
        }
      }

      startRun({ kind: 'plan', sql, actual })
    },
    [connection, currentSql, startRun],
  )

  const cancelExecution = useCallback(() => {
    const tabId = useTabStore.getState().activeTabId
    if (connection && tabId) {
      void cancel(connection.id, tabId)
    }
  }, [cancel, connection])

  /** `⌥⌘C`。トランザクションをコミットする（ADR 0012）。 */
  const commitTransaction = useCallback(() => {
    if (connection) {
      void commit(connection.id)
    }
  }, [commit, connection])

  /** `⌥⌘R`。トランザクションをロールバックする（ADR 0012）。 */
  const rollbackTransaction = useCallback(() => {
    if (connection) {
      void rollback(connection.id)
    }
  }, [connection, rollback])

  /**
   * 未コミットの変更を片付けてから進めてよいかを決める（ADR 0012）。
   *
   * 接続を手放す操作 — ウィンドウを閉じる・アプリを終了する・切断する — は、
   * すべてこの関所を通る。未コミットの変更があれば「コミット / 破棄 / やめる」を
   * 尋ね、「やめる」を選ばれたら進めない。コミットに失敗したときも進めない。
   * 失敗を告げないまま接続を手放すと、変更は暗黙のロールバックで消える。
   *
   * @param wording 操作ごとの問いかけと肯定側のラベル
   */
  const resolvePendingTransaction = useCallback(
    async (wording: PendingWording): Promise<boolean> => {
      const active = useConnectionStore.getState().connection
      if (!active || !isManualCommit(active) || !useExecutionStore.getState().inTransaction) {
        return true
      }

      const choice = await askPendingChoice(wording)

      if (choice === 'cancel') {
        return false
      }

      if (choice === 'commit') {
        await commit(active.id)
        // コミットできていれば未コミットの表示は消えている。残っていれば失敗した。
        return !useExecutionStore.getState().inTransaction
      }

      await rollback(active.id)
      return true
    },
    [commit, rollback],
  )

  /** ウィンドウを閉じてよいかを決める。 */
  const allowClose = useCallback(
    () => resolvePendingTransaction(CLOSE_WORDING),
    [resolvePendingTransaction],
  )

  // 未コミットのまま閉じさせない（ADR 0012）。アプリの終了も Rust 側から
  // 各ウィンドウを閉じにいくため、この関所を通る。
  useEffect(() => onWindowCloseRequested(allowClose), [allowClose])

  /** 結果の続きを取りにいく（ADR 0003）。 */
  const requestMore = useCallback(() => {
    const tabId = useTabStore.getState().activeTabId
    if (connection && tabId) {
      void fetchMore(connection.id, tabId)
    }
  }, [connection, fetchMore])

  /**
   * タブを閉じる。
   *
   * 開いたままのカーソルはデータベース側の資源を握り続けるため、閉じる前に
   * 明示的に手放す（ADR 0003）。結果テーブルで手を入れた列幅も、二度と使われない
   * ため一緒に忘れる。
   */
  const closeTabAndRelease = useCallback(
    (tabId: string) => {
      if (connection) {
        void releaseTab(connection.id, tabId)
      }
      clearResultColumnWidths(tabId)
      closeTab(tabId)
    },
    [clearResultColumnWidths, closeTab, connection, releaseTab],
  )

  /**
   * 接続を切り、接続を選ぶ画面へ戻す（方針 2・4）。
   *
   * エディタのタブと内容はそのまま残す。切断でタブを失うと、書きかけの SQL の
   * ために接続を切れなくなる。
   *
   * 後片付けはここで順に呼ぶ。開いたままの結果セットはデータベース側の資源を
   * 握るため、接続が生きているうちに `release_tab` で閉じる（ADR 0003）。
   * ストアの掃除もここで行い、ストア同士を結合させない。
   *
   * 実行中の文があるときは切断せず、先に中止するよう促す（方針 5）。
   * 未コミットの変更があるときは、閉じるときと同じ関所を通す（ADR 0012）。
   */
  const disconnectAndReset = useCallback(async () => {
    const active = useConnectionStore.getState().connection
    if (!active) {
      return
    }

    if (selectAnyRunning(useExecutionStore.getState())) {
      setDisconnectBlocked(true)
      return
    }

    // 切断もデータベース側の暗黙のロールバックを招く。閉じるときと同じ関所を
    // 通し、未コミットの変更を黙って捨てさせない（ADR 0012）。
    if (!(await resolvePendingTransaction(DISCONNECT_WORDING))) {
      return
    }

    for (const tabId of Object.keys(useExecutionStore.getState().byTab)) {
      try {
        await releaseTab(active.id, tabId)
      } catch {
        // 閉じられなくても切断で接続ごと落ちる。切断そのものは止めない。
      }
    }

    clearExecutions()
    clearSchemas()
    // セッションの一覧は接続に属する。切断したら捨てる（ADR 0017）。
    clearSessions()
    closeSessions()
    // ソース検索の結果も同じく接続に属する（ADR 0021）。
    clearSourceSearch()
    closeSourceSearch()
    // テーブル定義も接続に属する（ADR 0019）。
    clearDefinition()

    try {
      await disconnect()
    } catch {
      // 切断に失敗しても画面は接続を選ぶところへ戻す。
    }

    setConnectionView({ mode: 'picker' })
  }, [
    clearDefinition,
    clearExecutions,
    clearSchemas,
    clearSessions,
    clearSourceSearch,
    closeSessions,
    closeSourceSearch,
    disconnect,
    releaseTab,
    resolvePendingTransaction,
  ])

  /**
   * 実行中のすべてのタブを中止する（`⌘.` と同じ）。
   *
   * 切断できない旨のダイアログから呼ぶ。実行中のタブは選択中のものとは限らない
   * ため、走っているものをすべて対象にする。
   */
  const cancelAllRunning = useCallback(() => {
    const active = useConnectionStore.getState().connection
    if (active) {
      for (const [tabId, execution] of Object.entries(useExecutionStore.getState().byTab)) {
        if (execution.status === 'running') {
          void cancel(active.id, tabId)
        }
      }
    }
    setDisconnectBlocked(false)
  }, [cancel])

  /** `⌘S`。保存先が決まっていなければ選ばせる。 */
  const saveActiveTab = useCallback(async () => {
    const tab = selectActiveTab(useTabStore.getState())
    if (!tab) {
      return
    }

    const path = tab.filePath ?? (await saveDialog({ defaultPath: tab.name, filters: SQL_FILTERS }))
    if (typeof path !== 'string') {
      return
    }

    await getDbApi().writeTextFile(path, tab.content)
    markSaved(tab.id, path)
  }, [markSaved])

  /** `⌘O`。`.sql` ファイルを開く。 */
  const openSqlFile = useCallback(async () => {
    const path = await openDialog({ multiple: false, filters: SQL_FILTERS })
    if (typeof path !== 'string') {
      return
    }
    const content = await getDbApi().readTextFile(path)
    openFile(path, content)
  }, [openFile])

  /** `⌃⌘N`。別の接続を新しいウィンドウで開く（ADR 0009）。 */
  const openNewConnectionWindow = useCallback(() => {
    void getDbApi().openConnectionWindow()
  }, [])

  /** 履歴の SQL をエディタへ入れる。 */
  const useHistorySql = useCallback(
    (sql: string) => {
      const tabId = useTabStore.getState().activeTabId
      if (tabId) {
        updateContent(tabId, sql)
      }
    },
    [updateContent],
  )

  /**
   * ツリーで拾った名前をエディタのカーソル位置へ入れる（ADR 0020）。
   *
   * タブストア越しに内容を差し替えず、CodeMirror へ差分として渡す。文書を
   * 丸ごと置き換えるとカーソルが末尾へ飛び、取り消しも 1 段で潰れる。
   */
  const insertIntoEditor = useCallback((text: string) => {
    editorRef.current?.insertAtCursor(text)
  }, [])

  /**
   * ツリーの `SELECT` を新しいタブに開く（ADR 0020）。
   *
   * **実行はしない。**結果セットのカーソルは接続 1 本につき高々 1 つであり
   * （ADR 0003）、ここで実行すると別のタブが見ている結果が閉じられる。
   * 実行するかどうかは利用者が `⌘⏎` で決める。
   */
  const openSqlInNewTab = useCallback(
    (sql: string) => {
      openNewTab()
      const tabId = useTabStore.getState().activeTabId
      if (tabId) {
        updateContent(tabId, sql)
      }
    },
    [openNewTab, updateContent],
  )

  /**
   * `⌘K`。コマンドパレットを開く（ADR 0018）。
   *
   * 探せるのは現ウィンドウの接続の中だけであるため、繋がっていないときは開かない。
   */
  const openPalette = useCallback(() => {
    if (useConnectionStore.getState().connection) {
      setPaletteOpen(true)
    }
  }, [])

  /**
   * パレットで選んだスキーマのオブジェクトをサイドバーで示す。
   *
   * ツリーへ位置を伝える仕組みは足さず、既にある絞り込みと開閉で済ませる。
   * スキーマを開いたうえで名前を検索欄へ入れれば、その 1 件だけが残る。
   */
  const revealSchemaObject = useCallback(
    (schemaName: string, objectName: string | null) => {
      selectSidebarSegment('schema')
      const schema = useSchemaStore.getState()
      schema.setSearch(objectName ?? schemaName)
      if (!schema.expanded[nodeKey(schemaName)]) {
        schema.toggle(nodeKey(schemaName))
      }
    },
    [selectSidebarSegment],
  )

  /**
   * `⇧⌘S`。今のタブの内容を保存済みクエリにする（ADR 0018）。
   *
   * 選択範囲があればその中だけを保存する。名前の既定値はタブの名前から
   * `.sql` を落としたものである。
   */
  const promptSaveQuery = useCallback(() => {
    const tab = selectActiveTab(useTabStore.getState())
    if (!tab) {
      return
    }
    const sql = positionRef.current.selectedText ?? tab.content
    if (sql.trim() === '') {
      return
    }
    setSaveQueryPrompt({ name: tab.name.replace(/\.sql$/, ''), sql })
  }, [])

  /** 名前が決まった。保存済みクエリへ積む。 */
  const commitSaveQuery = useCallback(
    (name: string) => {
      const active = useConnectionStore.getState().connection
      if (saveQueryPrompt && active) {
        void saveQuery(name, saveQueryPrompt.sql, active.name)
      }
      setSaveQueryPrompt(null)
    },
    [saveQuery, saveQueryPrompt],
  )

  /** `⌥⌘S`。CSV の保存ダイアログを開く。 */
  const openCsvDialog = useCallback(() => {
    setCsvProgress(null)
    setCsvOpen(true)
  }, [])

  /** CSV の書き出しを始める。保存先を選ばせてから書き出す。 */
  const startCsvExport = useCallback(async () => {
    const tab = selectActiveTab(useTabStore.getState())
    if (!connection || !tab) {
      return
    }

    const execution = useExecutionStore.getState().byTab[tab.id]
    if (!execution || execution.columns.length === 0) {
      setCsvProgress({ rows: 0, done: true, error: '書き出せる結果がありません' })
      return
    }

    const path = await saveDialog({
      defaultPath: `${tab.name.replace(/\.sql$/, '')}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    })
    if (typeof path !== 'string') {
      return
    }

    csvCancelled.current = false
    setCsvProgress({ rows: 0, done: false, error: null })

    try {
      const result = await exportCsv(
        {
          connectionId: connection.id,
          tabId: tab.id,
          path,
          columns: execution.columns,
          initialRows: execution.rows,
          exhausted: execution.exhausted,
          options: csvOptions,
        },
        {
          onProgress: (rows) => setCsvProgress({ rows, done: false, error: null }),
          isCancelled: () => csvCancelled.current,
        },
      )

      markExhausted(tab.id)
      setCsvProgress({
        rows: result.rows,
        done: true,
        error: result.status === 'cancelled' ? '書き出しを中止しました' : null,
      })
    } catch (error) {
      setCsvProgress({
        rows: 0,
        done: true,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }, [connection, csvOptions, markExhausted])

  /**
   * コマンドパレットに並べる動作（ADR 0018）。
   *
   * 中身は既存のキーバインドで呼べるものだけである。パレットのためだけの動作は
   * 作らない。キーを覚えていなくても辿り着けるようにするのが役目だからである。
   */
  const paletteCommands = useMemo<PaletteCommand[]>(
    () => [
      { id: 'run', label: '実行（カーソル位置の文）', shortcut: '⌘⏎', run: runStatement },
      { id: 'run-selection', label: '選択範囲のみ実行', shortcut: '⇧⌘⏎', run: runSelection },
      { id: 'run-script', label: 'すべて実行', shortcut: '⌥⌘⏎', run: runScript },
      { id: 'explain', label: '実行計画を生成', shortcut: '⌘E', run: () => void runPlan(false) },
      {
        id: 'explain-actual',
        label: '実測付きで実行計画を生成',
        shortcut: '⇧⌘E',
        run: () => void runPlan(true),
      },
      { id: 'cancel', label: '実行を中止', shortcut: '⌘.', run: cancelExecution },
      { id: 'csv', label: '結果を CSV で保存', shortcut: '⌥⌘S', run: openCsvDialog },
      { id: 'commit', label: 'コミット', shortcut: '⌥⌘C', run: commitTransaction },
      { id: 'rollback', label: 'ロールバック', shortcut: '⌥⌘R', run: rollbackTransaction },
      { id: 'save-query', label: 'クエリを保存済みへ追加', shortcut: '⇧⌘S', run: promptSaveQuery },
      { id: 'save-file', label: 'ファイルに保存', shortcut: '⌘S', run: () => void saveActiveTab() },
      { id: 'open-file', label: 'ファイルを開く', shortcut: '⌘O', run: () => void openSqlFile() },
      { id: 'new-tab', label: '新しいタブ', shortcut: '⌘T', run: openNewTab },
      {
        id: 'new-window',
        label: '別の接続を新しいウィンドウで開く',
        shortcut: '⌃⌘N',
        run: openNewConnectionWindow,
      },
      {
        id: 'source-search',
        label: 'オブジェクトのソースを検索',
        shortcut: '⇧⌘F',
        run: openSourceSearch,
      },
      { id: 'sessions', label: 'セッションとロックを開く', shortcut: '', run: openSessions },
      { id: 'settings', label: '設定を開く', shortcut: '', run: openSettings },
    ],
    [
      cancelExecution,
      commitTransaction,
      openCsvDialog,
      openNewConnectionWindow,
      openNewTab,
      openSessions,
      openSettings,
      openSourceSearch,
      openSqlFile,
      promptSaveQuery,
      rollbackTransaction,
      runPlan,
      runScript,
      runSelection,
      runStatement,
      saveActiveTab,
    ],
  )

  // ウィンドウ全体で効くキーバインド（ADR の「キーバインド」節）。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // エディタが既に処理したものは二重に扱わない。
      if (event.defaultPrevented || !event.metaKey) {
        return
      }

      const key = event.key.toLowerCase()

      const handled = (work: () => void) => {
        event.preventDefault()
        work()
      }

      if (key === 'e') {
        handled(() => void runPlan(event.shiftKey))
        return
      }
      if (key === 'c' && event.altKey) {
        handled(commitTransaction)
        return
      }
      if (key === 'r' && event.altKey) {
        handled(rollbackTransaction)
        return
      }
      if (key === 's' && event.altKey) {
        handled(openCsvDialog)
        return
      }
      if (key === 's' && event.shiftKey) {
        handled(promptSaveQuery)
        return
      }
      if (key === 's') {
        handled(() => void saveActiveTab())
        return
      }
      if (key === 'o') {
        handled(() => void openSqlFile())
        return
      }
      if (key === 't') {
        handled(openNewTab)
        return
      }
      if (key === 'w') {
        handled(() => {
          const tabId = useTabStore.getState().activeTabId
          if (tabId) {
            closeTabAndRelease(tabId)
          }
        })
        return
      }
      if (key === 'n' && event.ctrlKey) {
        handled(openNewConnectionWindow)
        return
      }
      if (key === 'f' && event.shiftKey) {
        handled(openSourceSearch)
        return
      }
      if (key === 'k') {
        handled(openPalette)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    closeTabAndRelease,
    commitTransaction,
    rollbackTransaction,
    openCsvDialog,
    openNewConnectionWindow,
    openNewTab,
    openPalette,
    openSourceSearch,
    openSqlFile,
    promptSaveQuery,
    runPlan,
    saveActiveTab,
  ])

  /** 接続できたらフィルタを当ててスキーマの読み込みを始める（ADR 0007）。 */
  const onConnected = useCallback(
    (connectionId: string, filter: SchemaFilter) => {
      void setSchemaFilter(connectionId, filter)
    },
    [setSchemaFilter],
  )

  // 接続が変わったらスキーマを取り直す。
  useEffect(() => {
    if (connection) {
      void loadSchemas(connection.id)
    }
  }, [connection, loadSchemas])

  if (clientStatus === null) {
    return <Splash />
  }

  const settings = settingsOpen ? (
    <SettingsPanel
      clientUnavailable={clientStatus.status === 'unavailable'}
      onClose={closeSettings}
    />
  ) : null

  if (clientStatus.status === 'unavailable') {
    return (
      <Shell
        onOpenSettings={openSettings}
        onDisconnect={() => void disconnectAndReset()}
        overlay={settings}
      >
        <CenteredPanel>
          <InstantClientNotice
            message={clientStatus.message}
            candidates={clientStatus.candidates}
          />
        </CenteredPanel>
      </Shell>
    )
  }

  if (!connection) {
    return (
      <Shell
        onOpenSettings={openSettings}
        onDisconnect={() => void disconnectAndReset()}
        overlay={settings}
      >
        <CenteredPanel>
          {connectionView.mode === 'picker' ? (
            <ConnectionPicker
              onConnected={onConnected}
              onCreate={() => setConnectionView({ mode: 'form', connection: null })}
              onEdit={(saved) => setConnectionView({ mode: 'form', connection: saved })}
            />
          ) : (
            <ConnectionForm
              initial={connectionView.connection}
              onConnected={onConnected}
              onBack={() => setConnectionView({ mode: 'picker' })}
            />
          )}
        </CenteredPanel>
      </Shell>
    )
  }

  const overlay = (
    <>
      {settings}
      {sessionsOpen ? (
        <SessionsPanel
          connectionId={connection.id}
          readOnly={connection.params.readOnly}
          onClose={closeSessions}
        />
      ) : null}
      {sourceSearchOpen ? (
        <SourceSearchPanel connectionId={connection.id} onClose={closeSourceSearch} />
      ) : null}
      {definitionOpen ? <TableDefinitionPanel connectionId={connection.id} /> : null}
      {bindPrompt ? (
        <BindPrompt
          names={bindPrompt.names}
          onSubmit={submitBinds}
          onClose={() => setBindPrompt(null)}
        />
      ) : null}
      {csvOpen ? (
        <CsvSaveDialog
          options={csvOptions}
          onChange={setCsvOptions}
          progress={csvProgress}
          onStart={() => void startCsvExport()}
          onCancel={() => {
            csvCancelled.current = true
          }}
          onClose={() => {
            csvCancelled.current = true
            setCsvOpen(false)
          }}
        />
      ) : null}
      {disconnectBlocked ? (
        <DisconnectBlockedDialog
          onCancelExecution={cancelAllRunning}
          onClose={() => setDisconnectBlocked(false)}
        />
      ) : null}
      {saveQueryPrompt ? (
        <SaveQueryDialog
          defaultName={saveQueryPrompt.name}
          sql={saveQueryPrompt.sql}
          onSubmit={commitSaveQuery}
          onClose={() => setSaveQueryPrompt(null)}
        />
      ) : null}
      {paletteOpen ? (
        <CommandPalette
          connectionName={connection.name}
          commands={paletteCommands}
          onUseSql={useHistorySql}
          onRevealSchemaObject={revealSchemaObject}
          onClose={() => setPaletteOpen(false)}
        />
      ) : null}
    </>
  )

  return (
    <Shell
      onOpenSettings={openSettings}
      onDisconnect={() => void disconnectAndReset()}
      onOpenSessions={openSessions}
      onOpenSourceSearch={openSourceSearch}
      onCommit={commitTransaction}
      onRollback={rollbackTransaction}
      onOpenPalette={openPalette}
      overlay={overlay}
    >
      <Sidebar
        connectionId={connection.id}
        savedConnectionId={connection.savedId}
        connectionName={connection.name}
        onOpenNewConnection={openNewConnectionWindow}
        onUseHistory={useHistorySql}
        onInsertIdentifier={insertIntoEditor}
        onOpenSelect={openSqlInNewTab}
        width={sidebarWidth}
      />
      <Splitter
        orientation="vertical"
        label="サイドバーの幅"
        value={sidebarWidth}
        min={SIDEBAR_WIDTH_MIN}
        max={SIDEBAR_WIDTH_MAX}
        defaultValue={SIDEBAR_WIDTH_DEFAULT}
        onChange={setSidebarWidth}
      />
      <div className="flex-1 min-w-0 flex flex-col gap-6px">
        <TabBar onCloseTab={closeTabAndRelease} />
        <div
          style={{ height: `${editorHeight}px` }}
          className="relative shrink-0 bg-panel rounded-10px border border-line overflow-hidden"
        >
          <EditorPanel
            ref={editorRef}
            onCursorChange={onCursorChange}
            onRunStatement={runStatement}
            onRunSelection={runSelection}
            onRunScript={runScript}
            onCancel={cancelExecution}
          />
          <RunControls
            tabId={activeTabId}
            onRun={runStatement}
            onRunSelection={runSelection}
            onRunScript={runScript}
            onExplain={() => void runPlan(false)}
            onExplainActual={() => void runPlan(true)}
            onSaveCsv={openCsvDialog}
            onCancel={cancelExecution}
          />
        </div>
        <Splitter
          orientation="horizontal"
          label="エディタの高さ"
          value={editorHeight}
          min={EDITOR_HEIGHT_MIN}
          max={editorHeightMax(window.innerHeight)}
          defaultValue={EDITOR_HEIGHT_DEFAULT}
          onChange={(height) => setEditorHeight(height, window.innerHeight)}
        />
        <ResultPane
          tabId={activeTabId}
          runningLabel={`${connection.name} · ${activeTabName}`}
          onCancel={cancelExecution}
          onRequestMore={requestMore}
        />
      </div>
    </Shell>
  )
}

/**
 * 実行ボタンの状態を配る薄い包み。
 *
 * 実行中かどうかと選択の有無はストアから読む。ここで購読しておくことで、
 * 打鍵のたびにアプリ全体を描き直さずに済む。
 */
function RunControls({
  tabId,
  ...handlers
}: {
  tabId: string | null
  onRun: () => void
  onRunSelection: () => void
  onRunScript: () => void
  onExplain: () => void
  onExplainActual: () => void
  onSaveCsv: () => void
  onCancel: () => void
}) {
  const running = useExecutionStore((state) =>
    tabId === null ? false : state.byTab[tabId]?.status === 'running',
  )
  const hasSelection = useUiStore((state) => state.hasSelection)

  return <RunButton running={running} hasSelection={hasSelection} {...handlers} />
}

/**
 * バインド変数ダイアログへ、選択中のタブが覚えている値を配る薄い包み。
 *
 * 入力のたびに描き直る範囲をここへ閉じ込める。アプリのルートで購読すると、
 * 1 文字打つたびにサイドバーと結果ペインまで組み直される。
 */
function BindPrompt({
  names,
  onSubmit,
  onClose,
}: {
  names: string[]
  onSubmit: () => void
  onClose: () => void
}) {
  const tabId = useTabStore((state) => state.activeTabId)
  const values = useTabStore((state) => selectBindValues(state, tabId))
  const setBindValues = useTabStore((state) => state.setBindValues)

  const onChange = (next: Record<string, BindInput>): void => {
    if (tabId) {
      setBindValues(tabId, next)
    }
  }

  return (
    <BindValuesDialog
      names={names}
      values={values}
      onChange={onChange}
      onSubmit={onSubmit}
      onClose={onClose}
    />
  )
}

/**
 * 3 パネル構成の枠。
 *
 * タイトルバー・本体・ステータスバーを縦に並べる。本体の中身は呼び出し側が渡す。
 * 設定画面・CSV の保存ダイアログ・コマンドパレットは、この枠の上に重ねる。
 *
 * 切断はステータスバーの接続状態から呼ぶ。「切断」と「別の接続へ切り替え…」は
 * どちらも同じ動きであるため、受け取る手続きは 1 つでよい。
 */
function Shell({
  children,
  onOpenSettings,
  onDisconnect,
  onOpenSessions,
  onOpenSourceSearch,
  onCommit,
  onRollback,
  onOpenPalette,
  overlay,
}: {
  children: React.ReactNode
  onOpenSettings: () => void
  onDisconnect: () => void
  /** セッションとロックのパネルを開く（ADR 0017）。接続中の画面だけが渡す。 */
  onOpenSessions?: () => void
  /**
   * オブジェクトのソース検索のパネルを開く（`⇧⌘F`、ADR 0021）。
   * 接続中の画面だけが渡す。
   */
  onOpenSourceSearch?: () => void
  /** `⌥⌘C`。トランザクションをコミットする（ADR 0012）。 */
  onCommit?: () => void
  /** `⌥⌘R`。トランザクションをロールバックする（ADR 0012）。 */
  onRollback?: () => void
  /** `⌘K`。コマンドパレットを開く（ADR 0018）。接続中の画面だけが渡す。 */
  onOpenPalette?: () => void
  overlay?: React.ReactNode
}) {
  return (
    <div className="relative h-full flex flex-col bg-bg">
      <SessionSaver />
      <TitleBar onOpenPalette={onOpenPalette} />
      <div className="flex-1 min-h-0 flex gap-6px p-6px">{children}</div>
      <StatusBar
        onOpenSettings={onOpenSettings}
        onDisconnect={onDisconnect}
        onSwitchConnection={onDisconnect}
        onOpenSessions={onOpenSessions}
        onOpenSourceSearch={onOpenSourceSearch}
        onCommit={onCommit}
        onRollback={onRollback}
      />
      {overlay}
    </div>
  )
}

/**
 * タブ構成の書き出し（ADR 0005）。
 *
 * 打鍵のたびに変わるタブの配列を、この何も描かない部品だけで購読する。
 * ルートで購読すると画面全体が打鍵ごとに描き直る。
 */
function SessionSaver() {
  const tabs = useTabStore((state) => state.tabs)
  const activeTabId = useTabStore((state) => state.activeTabId)
  const sidebarSegment = useUiStore((state) => state.sidebarSegment)
  const sidebarWidth = useUiStore((state) => state.sidebarWidth)
  const editorHeight = useUiStore((state) => state.editorHeight)

  // タブの状態が落ち着いたら書き出す。1 打鍵ごとに書かないよう少し待つ。
  // ペインの寸法も同じ待ちに乗せる。ドラッグ中は 1 フレームごとに変わるためである。
  useEffect(() => {
    const timer = setTimeout(() => {
      const session = selectSession(
        { tabs, activeTabId },
        { sidebarSegment, sidebarWidth, editorHeight },
      )
      void getDbApi()
        .saveSession(currentWindowLabel(), session)
        .catch(() => {})
    }, SESSION_SAVE_DELAY)

    return () => clearTimeout(timer)
  }, [activeTabId, editorHeight, sidebarSegment, sidebarWidth, tabs])

  return null
}

/** 本体いっぱいに広がる 1 枚のパネル。案内画面と接続作成に使う。 */
function CenteredPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 min-w-0 bg-panel rounded-10px border border-line flex items-center justify-center overflow-auto p-24px">
      {children}
    </div>
  )
}

/** Instant Client の判定が終わるまでの表示。 */
function Splash() {
  return (
    <div className="h-full flex items-center justify-center bg-bg text-12.5px text-fg4">
      起動しています…
    </div>
  )
}
