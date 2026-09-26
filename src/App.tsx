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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import type { PaletteCommand } from './components/palette/CommandPalette'
import { CommandPalette } from './components/palette/CommandPalette'
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
import { onConnectionLost } from './connection/lost'
import type { Ask, AskAnswers } from './mediator/ask'
import { DISMISSED } from './mediator/ask'
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
import { openSqlFile, saveActiveTab } from './mediator/files'
import { saveQueryFromEditor } from './mediator/savedQuery'
import { reloadSchemas, revealSchemaObject } from './mediator/schema'
import { restoreSession } from './mediator/session'
import {
  closeActiveTab,
  closeTabAndRelease,
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

/** 答えを待っている尋ね事。答えたら `resolve` で仲介者へ返す。 */
interface Pending<T> {
  resolve: (answer: T) => void
}

export function App() {
  const [clientStatus, setClientStatus] = useState<ClientStatus | null>(null)
  const [connectionView, setConnectionView] = useState<ConnectionView>({ mode: 'picker' })
  const [csvOpen, setCsvOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [bindPrompt, setBindPrompt] = useState<
    ({ names: string[] } & Pending<AskAnswers['binds']>) | null
  >(null)
  const [disconnectBlocked, setDisconnectBlocked] = useState<Pending<
    AskAnswers['disconnectBlocked']
  > | null>(null)
  const [saveQueryPrompt, setSaveQueryPrompt] = useState<
    ({ name: string; sql: string } & Pending<AskAnswers['saveQuery']>) | null
  >(null)
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
  const openNewTab = useTabStore((state) => state.openNewTab)
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

  /**
   * 仲介者からの尋ね事を画面に描く（ADR 0035）。
   *
   * 同じ種類の尋ね事が重なったら、前のものは「何もしない」答えで解いてから
   * 差し替える。答えの来ない `Promise` を残すと、その裁定は永遠に止まる。
   */
  const [ask] = useState<Ask>(
    () =>
      ((request: Parameters<Ask>[0]) =>
        new Promise((resolve) => {
          if (request.kind === 'binds') {
            setBindPrompt((previous) => {
              previous?.resolve(DISMISSED.binds)
              return { names: request.names, resolve: resolve as Pending<boolean>['resolve'] }
            })
            return
          }
          if (request.kind === 'disconnectBlocked') {
            setDisconnectBlocked((previous) => {
              previous?.resolve(DISMISSED.disconnectBlocked)
              return { resolve: resolve as Pending<AskAnswers['disconnectBlocked']>['resolve'] }
            })
            return
          }
          setSaveQueryPrompt((previous) => {
            previous?.resolve(DISMISSED.saveQuery)
            return {
              name: request.defaultName,
              sql: request.sql,
              resolve: resolve as Pending<string | null>['resolve'],
            }
          })
        })) as Ask,
  )

  /** 押された時点のカーソルと尋ね方。実行の裁定へ渡す。 */
  const runScreen = useCallback((): RunScreen => ({ cursor: positionRef.current, ask }), [ask])

  const onRunStatement = useCallback(() => runStatement(runScreen()), [runScreen])
  const onRunSelection = useCallback(() => runSelection(runScreen()), [runScreen])
  const onRunScript = useCallback(() => runScript(runScreen()), [runScreen])
  const onRunPlan = useCallback((actual: boolean) => void runPlan(actual, runScreen()), [runScreen])
  const onSaveQuery = useCallback(() => void saveQueryFromEditor(positionRef.current, ask), [ask])
  const onDisconnect = useCallback(() => {
    void disconnectAndReset(ask).then((disconnected) => {
      if (disconnected) {
        setConnectionView({ mode: 'picker' })
      }
    })
  }, [ask])

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
   * `⇧⌥F`。今のタブの SQL を整形する（ADR 0024）。
   *
   * 定義タブでは `EditorPanel` がエディタを描かず、この口も繋がらないため
   * 何も起きない（ADR 0022）。
   */
  const formatEditor = useCallback(() => {
    editorRef.current?.formatDocument()
  }, [])

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

  /** `⌥⌘S`。CSV の保存ダイアログを開く。 */
  const openCsvDialog = useCallback(() => setCsvOpen(true), [])

  /**
   * コマンドパレットに並べる動作（ADR 0018）。
   *
   * 中身は既存のキーバインドで呼べるものだけである。パレットのためだけの動作は
   * 作らない。キーを覚えていなくても辿り着けるようにするのが役目だからである。
   */
  const paletteCommands = useMemo<PaletteCommand[]>(
    () => [
      { id: 'run', label: '実行（カーソル位置の文）', shortcut: '⌘⏎', run: onRunStatement },
      { id: 'run-selection', label: '選択範囲のみ実行', shortcut: '⇧⌘⏎', run: onRunSelection },
      { id: 'run-script', label: 'すべて実行', shortcut: '⌥⌘⏎', run: onRunScript },
      { id: 'explain', label: '実行計画を生成', shortcut: '⌘E', run: () => onRunPlan(false) },
      {
        id: 'explain-actual',
        label: '実測付きで実行計画を生成',
        shortcut: '⇧⌘E',
        run: () => onRunPlan(true),
      },
      { id: 'cancel', label: '実行を中止', shortcut: '⌘.', run: cancelExecution },
      { id: 'format', label: 'SQL を整形', shortcut: '⇧⌥F', run: formatEditor },
      { id: 'csv', label: '結果を CSV で保存', shortcut: '⌥⌘S', run: openCsvDialog },
      { id: 'commit', label: 'コミット', shortcut: '⌥⌘C', run: commitTransaction },
      { id: 'rollback', label: 'ロールバック', shortcut: '⌥⌘R', run: rollbackTransaction },
      { id: 'save-query', label: 'クエリを保存済みへ追加', shortcut: '⇧⌘S', run: onSaveQuery },
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
      { id: 'reload-schemas', label: 'スキーマを再読み込み', shortcut: '', run: reloadSchemas },
      { id: 'settings', label: '設定を開く', shortcut: '', run: openSettings },
    ],
    [
      formatEditor,
      onRunPlan,
      onRunScript,
      onRunSelection,
      onRunStatement,
      onSaveQuery,
      openCsvDialog,
      openNewTab,
      openSessions,
      openSettings,
      openSourceSearch,
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
        handled(() => onRunPlan(event.shiftKey))
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
        handled(onSaveQuery)
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
        handled(closeActiveTab)
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
  }, [onRunPlan, onSaveQuery, openCsvDialog, openNewTab, openPalette, openSourceSearch])

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
      <Shell onOpenSettings={openSettings} onDisconnect={onDisconnect} overlay={settings}>
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
      <Shell onOpenSettings={openSettings} onDisconnect={onDisconnect} overlay={settings}>
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
      {bindPrompt ? (
        <BindPrompt
          names={bindPrompt.names}
          onSubmit={() => {
            setBindPrompt(null)
            bindPrompt.resolve(true)
          }}
          onClose={() => {
            setBindPrompt(null)
            bindPrompt.resolve(false)
          }}
        />
      ) : null}
      {csvOpen ? <CsvExportDialog onClose={() => setCsvOpen(false)} /> : null}
      {disconnectBlocked ? (
        <DisconnectBlockedDialog
          onCancelExecution={() => {
            setDisconnectBlocked(null)
            disconnectBlocked.resolve('cancelExecution')
          }}
          onClose={() => {
            setDisconnectBlocked(null)
            disconnectBlocked.resolve('dismiss')
          }}
        />
      ) : null}
      {saveQueryPrompt ? (
        <SaveQueryDialog
          defaultName={saveQueryPrompt.name}
          sql={saveQueryPrompt.sql}
          onSubmit={(name) => {
            setSaveQueryPrompt(null)
            saveQueryPrompt.resolve(name)
          }}
          onClose={() => {
            setSaveQueryPrompt(null)
            saveQueryPrompt.resolve(null)
          }}
        />
      ) : null}
      {paletteOpen ? (
        <CommandPalette
          connectionName={connection.name}
          commands={paletteCommands}
          onUseSql={putSqlIntoEditor}
          onRevealSchemaObject={revealSchemaObject}
          onClose={() => setPaletteOpen(false)}
        />
      ) : null}
    </>
  )

  return (
    <Shell
      onOpenSettings={openSettings}
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
        <TabBar onCloseTab={closeTabAndRelease} />
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
          </>
        )}
      </div>
    </Shell>
  )
}
