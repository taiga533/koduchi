/**
 * アプリのルートコンポーネント。
 *
 * デザイン 3a の 3 パネル構成を組み立て、状態に応じて次の 3 つを出し分ける。
 *
 * 1. Instant Client が読めない（ADR 0001） … 案内画面
 * 2. 未接続（デザイン 5g） … 保存した接続を選ぶ画面と、接続を作成する画面
 * 3. 接続中 … エディタと結果ペイン
 *
 * 接続中の本体は、選ばれているタブの種類で切り替わる（ADR 0022）。SQL タブでは
 * エディタと結果ペイン、定義タブではテーブル定義ビューが本体をまるごと使う。
 *
 * 複数のストアにまたがる裁定は `src/mediator/` の関数にある（ADR 0035）。ここは
 * それを部品の callback と Tauri のイベントへ配線するだけである。画面にしか無い
 * もの（エディタのカーソルとハンドル、確認の尋ね方）は、ここから引数で渡す。
 *
 * 打鍵のたびに描き直る範囲を狭く保つ。カーソル位置は `ui` ストアへ逃がし、
 * 実行に要る位置は ref で持つ。サイドバーと結果ペインへ渡すコールバックは
 * 選択中のタブに依存させず、押された時点のタブをストアから読む。
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { getDbApi } from './api/db'
import { InstantClientNotice } from './components/connection/InstantClientNotice'
import { ConnectionForm } from './components/connection/ConnectionForm'
import { ConnectionPicker } from './components/connection/ConnectionPicker'
import { DisconnectBlockedDialog } from './components/connection/DisconnectBlockedDialog'
import { CsvExportDialog } from './components/csv/CsvExportDialog'
import { EditorPanel } from './components/editor/EditorPanel'
import { SaveQueryDialog } from './components/editor/SaveQueryDialog'
import { Splitter } from './components/layout/Splitter'
import { Shell } from './components/layout/Shell'
import { CenteredPanel } from './components/layout/CenteredPanel'
import { Splash } from './components/layout/Splash'
import {
  EDITOR_HEIGHT_DEFAULT,
  EDITOR_HEIGHT_MIN,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  editorHeightMax,
} from './components/layout/paneSizes'
import { TableCommandPalette } from './components/palette/TableCommandPalette'
import { RunControls } from './components/editor/RunControls'
import { BindPrompt } from './components/editor/BindPrompt'
import type { EditorPosition, SqlEditorHandle } from './components/editor/SqlEditor'
import { TabBar } from './components/editor/TabBar'
import { tabDisplayName } from './components/editor/tabNaming'
import { ResultPane } from './components/results/ResultPane'
import { TableDefinitionPanel } from './components/definition/TableDefinitionPanel'
import { SessionsPanel } from './components/sessions/SessionsPanel'
import { SourceSearchPanel } from './components/source/SourceSearchPanel'
import { SettingsPanel } from './components/settings/SettingsPanel'
import { Sidebar } from './components/sidebar/Sidebar'
import { onOpenSettingsRequested } from './appMenu'
import { onConnectionLost } from './connection/lost'
import type { Command, CommandScreen } from './mediator/commands'
import { resolveKeybindings } from './keybindings/bindings'
import { KeybindingsContext, useKeybindings } from './keybindings/context'
import { COMMANDS, commandById, dispatchCommandKey, runCommand } from './mediator/commands'
import { exportActiveResult } from './mediator/csv'
import { createAskChannel } from './mediator/ask'
import {
  disconnectAndReset,
  openNewConnectionWindow,
  reconnectConnection,
  relayConnectionLost,
} from './mediator/connection'
import type { RunScreen } from './mediator/execution'
import {
  cancelExecution,
  reportFormatFailure,
  requestMore,
  runPlan,
  runScript,
  runSelection,
  runStatement,
} from './mediator/execution'
import { revealSchemaObject } from './mediator/schema'
import { restoreSession } from './mediator/session'
import { saveTab, saveTabAs } from './mediator/files'
import {
  closeOtherTabs,
  closeTabAndRelease,
  closeTabsToRight,
  openDefinitionTab,
  openSqlInNewTab,
  putSqlIntoEditor,
} from './mediator/tabs'
import {
  commitTransaction,
  resolvePendingTransaction,
  rollbackTransaction,
} from './mediator/transaction'
import { useConnectionStore } from './stores/connection'
import { useSchemaStore } from './stores/schema'
import { selectActiveTab, useTabStore } from './stores/tab'
import { useUiStore } from './stores/ui'
import { CLOSE_WORDING } from './transaction/pendingChanges'
import { currentWindowLabel, onWindowCloseRequested } from './window'
import type { ClientStatus, SavedConnection, SchemaFilter } from './types/db'

/** カーソルの初期位置。エディタから通知が来るまでの値。 */
const INITIAL_POSITION: EditorPosition = {
  line: 1,
  column: 1,
  offset: 0,
  selectedText: null,
}

/**
 * 未接続のときに出す画面。
 *
 * 保存した接続を選ぶ画面が手前に立ち、そこから新規作成と編集へ進む。
 * `connection` が編集対象で、`null` なら新規作成である。
 */
type ConnectionView = { mode: 'picker' } | { mode: 'form'; connection: SavedConnection | null }

/**
 * アプリのルート。キーの割り当て（ADR 0037）を解決して部品へ配る。
 *
 * 解決にはコマンドの表（仲介者の値）が要り、部品は仲介者の値を import しない
 * ため、解決はここで 1 度だけ行う。
 */
export function App() {
  const overrides = useUiStore((state) => state.keybindings)
  const keybindings = useMemo(() => resolveKeybindings(COMMANDS, overrides), [overrides])
  return (
    <KeybindingsContext value={keybindings}>
      <AppWindow />
    </KeybindingsContext>
  )
}

/** 1 つのウィンドウの中身。 */
function AppWindow() {
  const keybindings = useKeybindings()
  const [clientStatus, setClientStatus] = useState<ClientStatus | null>(null)
  const [connectionView, setConnectionView] = useState<ConnectionView>({ mode: 'picker' })
  const [csvOpen, setCsvOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  // 実行に要る位置は描画に関わらないため、状態ではなく ref で持つ。
  const positionRef = useRef<EditorPosition>(INITIAL_POSITION)
  // スキーマツリーからエディタへ差し込むための口（ADR 0020）。
  const editorRef = useRef<SqlEditorHandle>(null)

  const connection = useConnectionStore((state) => state.connection)
  const activeTabId = useTabStore((state) => state.activeTabId)
  // 名前だけを購読する。タブの配列そのものを見ると、打鍵のたびにここが
  // 描き直り、サイドバーと結果ペインまで巻き添えになる。
  const activeTabName = useTabStore((state) => {
    const tab = selectActiveTab(state)
    return tab ? tabDisplayName(tab) : ''
  })
  // 選択中のタブの種類だけを購読する（ADR 0022）。定義タブの間はエディタも
  // 結果ペインも出さないが、打鍵のたびにここが描き直っては元も子もない。
  const activeTabKind = useTabStore((state) => selectActiveTab(state)?.kind ?? 'sql')

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
  const sidebarWidth = useUiStore((state) => state.sidebarWidth)
  const editorHeight = useUiStore((state) => state.editorHeight)
  const setSidebarWidth = useUiStore((state) => state.setSidebarWidth)
  const setEditorHeight = useUiStore((state) => state.setEditorHeight)
  const clampToWindow = useUiStore((state) => state.clampToWindow)

  const loadSchemas = useSchemaStore((state) => state.load)
  const setSchemaFilter = useSchemaStore((state) => state.setFilter)

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
    void restoreSession(currentWindowLabel(), window.innerHeight)
  }, [])

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

  // 仲介者からの尋ね事（ADR 0035）。仲介者は答えを `await` し、ここは描いて
  // 押された答えを返すだけである。受け渡し口は画面ごとに 1 つ持つ。
  const [asks] = useState(createAskChannel)
  const pendingAsks = useSyncExternalStore(asks.subscribe, asks.getSnapshot)
  const ask = asks.ask

  /** 押された時点のカーソルと尋ね方。実行の裁定へ渡す。 */
  const runScreen = useCallback((): RunScreen => ({ cursor: positionRef.current, ask }), [ask])

  const onRunStatement = useCallback(() => runStatement(runScreen()), [runScreen])
  const onRunSelection = useCallback(() => runSelection(runScreen()), [runScreen])
  const onRunScript = useCallback(() => runScript(runScreen()), [runScreen])
  const onRunPlan = useCallback((actual: boolean) => void runPlan(actual, runScreen()), [runScreen])
  const onDisconnect = useCallback(() => {
    void disconnectAndReset(ask).then((disconnected) => {
      if (disconnected) {
        setConnectionView({ mode: 'picker' })
      }
    })
  }, [ask])

  // メニューバーの「設定…」（⌘,）から設定画面を開く（ADR 0036）。書き換えるのは
  // `ui` ストアだけであり、仲介者を通さずに繋ぐ。
  useEffect(() => onOpenSettingsRequested(openSettings), [openSettings])

  // サーバ側で接続が切れたことを各ストアへ配る（ADR 0026）。
  useEffect(() => onConnectionLost(relayConnectionLost), [])

  // 未コミットのまま閉じさせない（ADR 0012）。アプリの終了も Rust 側から
  // 各ウィンドウを閉じにいくため、この関所を通る。
  useEffect(() => onWindowCloseRequested(() => resolvePendingTransaction(CLOSE_WORDING)), [])

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
   * コマンドの表（ADR 0035）へ渡す、画面にしか無いもの。
   *
   * 整形はエディタのハンドル越しに行う（ADR 0024）。定義タブでは `EditorPanel` が
   * エディタを描かず、この口も繋がらないため何も起きない（ADR 0022）。
   */
  const commandScreen = useMemo<CommandScreen>(
    () => ({
      cursor: () => positionRef.current,
      ask,
      formatEditor: () => editorRef.current?.formatDocument(),
      openPalette: () => setPaletteOpen(true),
      openCsvDialog: () => setCsvOpen(true),
    }),
    [ask],
  )

  /** パレットで選ばれたコマンドを、キーと同じ裁定と判定に通す。 */
  const executeCommand = useCallback(
    (command: Command) => runCommand(command, commandScreen),
    [commandScreen],
  )

  /** パレットのキーと同じ裁定と判定を、タイトルバーのボタンからも通す。 */
  const openPalette = useCallback(
    () => runCommand(commandById('palette'), commandScreen),
    [commandScreen],
  )

  // ウィンドウ全体で効くキーバインド（ADR の「キーバインド」節）。振り分けは
  // コマンドの表が持つ。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) =>
      dispatchCommandKey(event, commandScreen, keybindings.chords)
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [commandScreen, keybindings])

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
      commands={COMMANDS}
    />
  ) : null

  if (clientStatus.status === 'unavailable') {
    return (
      <Shell onDisconnect={onDisconnect} overlay={settings}>
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
      <Shell onDisconnect={onDisconnect} overlay={settings}>
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
      {pendingAsks.binds ? (
        <BindPrompt
          names={pendingAsks.binds.request.names}
          onSubmit={() => pendingAsks.binds?.answer(true)}
          onClose={() => pendingAsks.binds?.answer(false)}
        />
      ) : null}
      {csvOpen ? (
        <CsvExportDialog onExport={exportActiveResult} onClose={() => setCsvOpen(false)} />
      ) : null}
      {pendingAsks.disconnectBlocked ? (
        <DisconnectBlockedDialog
          onCancelExecution={() => pendingAsks.disconnectBlocked?.answer('cancelExecution')}
          onClose={() => pendingAsks.disconnectBlocked?.answer('dismiss')}
        />
      ) : null}
      {pendingAsks.saveQuery ? (
        <SaveQueryDialog
          defaultName={pendingAsks.saveQuery.request.defaultName}
          sql={pendingAsks.saveQuery.request.sql}
          onSubmit={(name) => pendingAsks.saveQuery?.answer(name)}
          onClose={() => pendingAsks.saveQuery?.answer(null)}
        />
      ) : null}
      {paletteOpen ? (
        <TableCommandPalette
          commands={COMMANDS}
          keybindings={keybindings}
          onRunCommand={executeCommand}
          connectionName={connection.name}
          onUseSql={putSqlIntoEditor}
          onRevealSchemaObject={revealSchemaObject}
          onClose={() => setPaletteOpen(false)}
        />
      ) : null}
    </>
  )

  return (
    <Shell
      onDisconnect={onDisconnect}
      onOpenSessions={openSessions}
      onOpenSourceSearch={openSourceSearch}
      onCommit={commitTransaction}
      onRollback={rollbackTransaction}
      onReconnect={() => void reconnectConnection()}
      onOpenPalette={openPalette}
      overlay={overlay}
    >
      <Sidebar
        connectionId={connection.id}
        savedConnectionId={connection.savedId}
        connectionName={connection.name}
        onOpenNewConnection={openNewConnectionWindow}
        onUseHistory={putSqlIntoEditor}
        onInsertIdentifier={insertIntoEditor}
        onOpenSelect={openSqlInNewTab}
        onOpenDefinition={openDefinitionTab}
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
        <TabBar
          onCloseTab={closeTabAndRelease}
          onCloseOtherTabs={closeOtherTabs}
          onCloseTabsToRight={closeTabsToRight}
          onSaveTab={saveTab}
          onSaveTabAs={saveTabAs}
        />
        {/*
          定義タブを選んでいる間は、エディタも結果ペインも出さずに本体を
          まるごと定義へ渡す（ADR 0022）。定義は実行の結果ではないため、
          結果ペインを添えても空のまま場所を取るだけである。
        */}
        {activeTabKind === 'definition' && activeTabId !== null ? (
          <TableDefinitionPanel connectionId={connection.id} tabId={activeTabId} />
        ) : (
          <>
            <div
              style={{ height: `${editorHeight}px` }}
              className="relative shrink-0 bg-panel rounded-10px border border-line overflow-hidden"
            >
              <EditorPanel
                ref={editorRef}
                onCursorChange={onCursorChange}
                onRunStatement={onRunStatement}
                onRunSelection={onRunSelection}
                onRunScript={onRunScript}
                onCancel={cancelExecution}
                onFormatFailed={reportFormatFailure}
              />
              <RunControls
                tabId={activeTabId}
                onRun={onRunStatement}
                onRunSelection={onRunSelection}
                onRunScript={onRunScript}
                onExplain={() => onRunPlan(false)}
                onExplainActual={() => onRunPlan(true)}
                onSaveCsv={commandScreen.openCsvDialog}
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
              onOpenSqlInNewTab={openSqlInNewTab}
            />
          </>
        )}
      </div>
    </Shell>
  )
}
