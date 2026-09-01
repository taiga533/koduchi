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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { confirm, open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { getDbApi } from './api/db'
import { InstantClientNotice } from './components/connection/InstantClientNotice'
import { ConnectionForm } from './components/connection/ConnectionForm'
import { ConnectionPicker } from './components/connection/ConnectionPicker'
import type { CsvExportState } from './components/csv/CsvSaveDialog'
import { CsvSaveDialog } from './components/csv/CsvSaveDialog'
import { RunButton } from './components/editor/RunButton'
import { SqlEditor, type EditorPosition } from './components/editor/SqlEditor'
import { TabBar } from './components/editor/TabBar'
import { ResultPane } from './components/results/ResultPane'
import { SettingsPanel } from './components/settings/SettingsPanel'
import { Sidebar } from './components/sidebar/Sidebar'
import { StatusBar } from './components/statusbar/StatusBar'
import { TitleBar } from './components/titlebar/TitleBar'
import { exportCsv } from './csv/exportCsv'
import { isSelectStatement, statementAt } from './sql/statements'
import { useConnectionStore } from './stores/connection'
import { useExecutionStore } from './stores/execution'
import { useHistoryStore } from './stores/history'
import { buildCompletionSchema, useSchemaStore } from './stores/schema'
import { selectActiveTab, selectSession, useTabStore } from './stores/tab'
import { useUiStore } from './stores/ui'
import { currentWindowLabel } from './window'
import type { ClientStatus, SavedConnection, SchemaFilter, TableColumn } from './types/db'

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

/** 列がまだ読み込まれていないときに渡す表。参照を固定して再計算を避ける。 */
const NO_COLUMNS: Record<string, TableColumn[]> = {}

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
  const [csvProgress, setCsvProgress] = useState<CsvExportState | null>(null)
  const csvCancelled = useRef(false)
  // 実行に要る位置は描画に関わらないため、状態ではなく ref で持つ。
  const positionRef = useRef<EditorPosition>(INITIAL_POSITION)

  const connection = useConnectionStore((state) => state.connection)
  const tabs = useTabStore((state) => state.tabs)
  const activeTabId = useTabStore((state) => state.activeTabId)
  const activeTab = useTabStore(selectActiveTab)
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

  const sidebarSegment = useUiStore((state) => state.sidebarSegment)
  const selectSidebarSegment = useUiStore((state) => state.selectSidebarSegment)
  const selectResultTab = useUiStore((state) => state.selectResultTab)
  const setCursor = useUiStore((state) => state.setCursor)
  const settingsOpen = useUiStore((state) => state.settingsOpen)
  const openSettings = useUiStore((state) => state.openSettings)
  const closeSettings = useUiStore((state) => state.closeSettings)
  const loadSettings = useUiStore((state) => state.loadSettings)
  const csvOptions = useUiStore((state) => state.csvOptions)
  const setCsvOptions = useUiStore((state) => state.setCsvOptions)

  const schemas = useSchemaStore((state) => state.schemas)
  const schemaColumns = useSchemaStore((state) => state.columns)
  const columnsReady = useSchemaStore((state) => state.columnStatus === 'ready')
  const loadSchemas = useSchemaStore((state) => state.load)
  const setSchemaFilter = useSchemaStore((state) => state.setFilter)

  /**
   * 補完の元。
   *
   * 列は読み込み終えてから 1 度だけ渡す。段階 2 の途中で差し替え続けると、
   * 候補が出ている最中に言語設定が作り直されてちらつく（ADR 0007）。
   */
  const readyColumns = columnsReady ? schemaColumns : NO_COLUMNS
  const completionSchema = useMemo(
    () => buildCompletionSchema(schemas, readyColumns),
    [readyColumns, schemas],
  )

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
      })
      .catch(() => {})
  }, [restoreTabs, selectSidebarSegment])

  // タブの状態が落ち着いたら書き出す。1 打鍵ごとに書かないよう少し待つ。
  useEffect(() => {
    const timer = setTimeout(() => {
      const session = selectSession({ tabs, activeTabId }, sidebarSegment)
      void getDbApi()
        .saveSession(currentWindowLabel(), session)
        .catch(() => {})
    }, SESSION_SAVE_DELAY)

    return () => clearTimeout(timer)
  }, [activeTabId, sidebarSegment, tabs])

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
   * 明示的に手放す（ADR 0003）。
   */
  const closeTabAndRelease = useCallback(
    (tabId: string) => {
      if (connection) {
        void releaseTab(connection.id, tabId)
      }
      closeTab(tabId)
    },
    [closeTab, connection, releaseTab],
  )

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
      <Shell onOpenSettings={openSettings} overlay={settings}>
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
      <Shell onOpenSettings={openSettings} overlay={settings}>
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
    </>
  )

  return (
    <Shell onOpenSettings={openSettings} overlay={overlay}>
      <Sidebar
        connectionId={connection.id}
        savedConnectionId={connection.savedId}
        connectionName={connection.name}
        onOpenNewConnection={openNewConnectionWindow}
        onUseHistory={useHistorySql}
      />
      <div className="flex-1 min-w-0 flex flex-col gap-6px">
        <TabBar onCloseTab={closeTabAndRelease} />
        <div className="relative h-268px shrink-0 bg-panel rounded-10px border border-line overflow-hidden">
          {activeTab ? (
            <SqlEditor
              key={activeTab.id}
              value={activeTab.content}
              schema={completionSchema}
              onChange={(content) => updateContent(activeTab.id, content)}
              onCursorChange={onCursorChange}
              onRunStatement={runStatement}
              onRunSelection={runSelection}
              onCancel={cancelExecution}
            />
          ) : null}
          <RunControls
            tabId={activeTab?.id ?? null}
            onRun={runStatement}
            onRunSelection={runSelection}
            onExplain={() => void runPlan(false)}
            onExplainActual={() => void runPlan(true)}
            onSaveCsv={openCsvDialog}
            onCancel={cancelExecution}
          />
        </div>
        <ResultPane
          tabId={activeTab?.id ?? null}
          runningLabel={`${connection.name} · ${activeTab?.name ?? ''}`}
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
 */
function Shell({
  children,
  onOpenSettings,
  overlay,
}: {
  children: React.ReactNode
  onOpenSettings: () => void
  overlay?: React.ReactNode
}) {
  return (
    <div className="relative h-full flex flex-col bg-bg">
      <TitleBar />
      <div className="flex-1 min-h-0 flex gap-6px p-6px">{children}</div>
      <StatusBar onOpenSettings={onOpenSettings} />
      {overlay}
    </div>
  )
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
