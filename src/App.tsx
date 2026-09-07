/**
 * アプリのルートコンポーネント。
 *
 * デザイン 3a の 3 パネル構成を組み立て、状態に応じて次の 3 つを出し分ける。
 *
 * 1. Instant Client が読めない（ADR 0001） … 案内画面
 * 2. 未接続（デザイン 5g） … 保存した接続を選ぶ画面と、接続を作成する画面
 * 3. 接続中 … エディタと結果ペイン
 *
 * キーバインドのうち、エディタの中でしか意味を持たない `⌘⏎` / `⇧⌘⏎` / `⌘.` は
 * CodeMirror 側に置く。それ以外はウィンドウ全体で効かせる。
 *
 * 打鍵のたびに描き直る範囲を狭く保つ。カーソル位置は `ui` ストアへ逃がし、
 * 実行に要る位置は ref で持つ。サイドバーと結果ペインへ渡すコールバックは
 * 選択中のタブに依存させず、押された時点のタブをストアから読む。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { confirm, open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { getDbApi } from './api/db'
import { InstantClientNotice } from './components/connection/InstantClientNotice'
import { ConnectionForm } from './components/connection/ConnectionForm'
import { ConnectionPicker } from './components/connection/ConnectionPicker'
import { DisconnectBlockedDialog } from './components/connection/DisconnectBlockedDialog'
import type { CsvExportState } from './components/csv/CsvSaveDialog'
import { CsvSaveDialog } from './components/csv/CsvSaveDialog'
import { EditorPanel } from './components/editor/EditorPanel'
import { Splitter } from './components/layout/Splitter'
import {
  EDITOR_HEIGHT_DEFAULT,
  EDITOR_HEIGHT_MIN,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  editorHeightMax,
} from './components/layout/paneSizes'
import { RunButton } from './components/editor/RunButton'
import type { EditorPosition } from './components/editor/SqlEditor'
import { TabBar } from './components/editor/TabBar'
import { ResultPane } from './components/results/ResultPane'
import { SettingsPanel } from './components/settings/SettingsPanel'
import { Sidebar } from './components/sidebar/Sidebar'
import { StatusBar } from './components/statusbar/StatusBar'
import { TitleBar } from './components/titlebar/TitleBar'
import { exportCsv } from './csv/exportCsv'
import { isSelectStatement, statementAt } from './sql/statements'
import { useConnectionStore } from './stores/connection'
import { selectAnyRunning, useExecutionStore } from './stores/execution'
import { useHistoryStore } from './stores/history'
import { useSchemaStore } from './stores/schema'
import { selectActiveTab, selectSession, useTabStore } from './stores/tab'
import { useUiStore } from './stores/ui'
import { currentWindowLabel } from './window'
import type { ClientStatus, SavedConnection, SchemaFilter } from './types/db'

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

export function App() {
  const [clientStatus, setClientStatus] = useState<ClientStatus | null>(null)
  const [connectionView, setConnectionView] = useState<ConnectionView>({ mode: 'picker' })
  const [csvOpen, setCsvOpen] = useState(false)
  const [disconnectBlocked, setDisconnectBlocked] = useState(false)
  const [csvProgress, setCsvProgress] = useState<CsvExportState | null>(null)
  const csvCancelled = useRef(false)
  // 実行に要る位置は描画に関わらないため、状態ではなく ref で持つ。
  const positionRef = useRef<EditorPosition>(INITIAL_POSITION)

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
  const generatePlan = useExecutionStore((state) => state.generatePlan)
  const fetchMore = useExecutionStore((state) => state.fetchMore)
  const cancel = useExecutionStore((state) => state.cancel)
  const releaseTab = useExecutionStore((state) => state.releaseTab)
  const markExhausted = useExecutionStore((state) => state.markExhausted)
  const clearExecutions = useExecutionStore((state) => state.clear)

  const selectSidebarSegment = useUiStore((state) => state.selectSidebarSegment)
  const selectResultTab = useUiStore((state) => state.selectResultTab)
  const setCursor = useUiStore((state) => state.setCursor)
  const settingsOpen = useUiStore((state) => state.settingsOpen)
  const openSettings = useUiStore((state) => state.openSettings)
  const closeSettings = useUiStore((state) => state.closeSettings)
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

  const runSql = useCallback(
    async (sql: string) => {
      const tabId = useTabStore.getState().activeTabId
      if (!connection || !tabId || sql.trim() === '') {
        return
      }
      selectResultTab('result')
      await execute(connection.id, tabId, sql, connection.name)
      // 履歴は実行のたびに増える。開いていれば読み直す。
      await useHistoryStore.getState().reload()
    },
    [connection, execute, selectResultTab],
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
      void runSql(sql)
    }
  }, [currentSql, runSql])

  /** `⇧⌘⏎`。選択範囲を実行する。選択が無ければ何もしない。 */
  const runSelection = useCallback(() => {
    const sql = currentSql(true)
    if (sql) {
      void runSql(sql)
    }
  }, [currentSql, runSql])

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

      selectResultTab('plan')
      await generatePlan(connection.id, tabId, sql, actual ? 'actual' : 'estimate')
    },
    [connection, currentSql, generatePlan, selectResultTab],
  )

  const cancelExecution = useCallback(() => {
    const tabId = useTabStore.getState().activeTabId
    if (connection && tabId) {
      void cancel(connection.id, tabId)
    }
  }, [cancel, connection])

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

    for (const tabId of Object.keys(useExecutionStore.getState().byTab)) {
      try {
        await releaseTab(active.id, tabId)
      } catch {
        // 閉じられなくても切断で接続ごと落ちる。切断そのものは止めない。
      }
    }

    clearExecutions()
    clearSchemas()

    try {
      await disconnect()
    } catch {
      // 切断に失敗しても画面は接続を選ぶところへ戻す。
    }

    setConnectionView({ mode: 'picker' })
  }, [clearExecutions, clearSchemas, disconnect, releaseTab])

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
      if (key === 's' && event.altKey) {
        handled(openCsvDialog)
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
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    closeTabAndRelease,
    openCsvDialog,
    openNewConnectionWindow,
    openNewTab,
    openSqlFile,
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
    </>
  )

  return (
    <Shell
      onOpenSettings={openSettings}
      onDisconnect={() => void disconnectAndReset()}
      overlay={overlay}
    >
      <Sidebar
        connectionId={connection.id}
        savedConnectionId={connection.savedId}
        connectionName={connection.name}
        onOpenNewConnection={openNewConnectionWindow}
        onUseHistory={useHistorySql}
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
            onCursorChange={onCursorChange}
            onRunStatement={runStatement}
            onRunSelection={runSelection}
            onCancel={cancelExecution}
          />
          <RunControls
            tabId={activeTabId}
            onRun={runStatement}
            onRunSelection={runSelection}
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
 * 3 パネル構成の枠。
 *
 * タイトルバー・本体・ステータスバーを縦に並べる。本体の中身は呼び出し側が渡す。
 * 設定画面と CSV の保存ダイアログは、この枠の上に重ねる。
 *
 * 切断はステータスバーの接続状態から呼ぶ。「切断」と「別の接続へ切り替え…」は
 * どちらも同じ動きであるため、受け取る手続きは 1 つでよい。
 */
function Shell({
  children,
  onOpenSettings,
  onDisconnect,
  overlay,
}: {
  children: React.ReactNode
  onOpenSettings: () => void
  onDisconnect: () => void
  overlay?: React.ReactNode
}) {
  return (
    <div className="relative h-full flex flex-col bg-bg">
      <SessionSaver />
      <TitleBar />
      <div className="flex-1 min-h-0 flex gap-6px p-6px">{children}</div>
      <StatusBar
        onOpenSettings={onOpenSettings}
        onDisconnect={onDisconnect}
        onSwitchConnection={onDisconnect}
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
