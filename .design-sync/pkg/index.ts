/**
 * Claude Design へ同期するための入口（design-sync）。
 *
 * 小槌はアプリであって部品のライブラリではないため、配布用の入口を持たない。
 * 同期の変換器は「ビルド済みの入口と型」を読むので、ここで `src/components` の
 * 部品と、部品が読むストアを書き出す。`src/` には手を入れない。
 *
 * 部品の多くは zustand のストアから状態を読む。デザインの側で画面を組むときは
 * ストアへ `setState` で状態を置いてから部品を描く。
 */
import 'virtual:uno.css'
import '../../src/theme/tokens.css'
import './base.css'
// 書体（PlemolJP）は CSS に埋め込むと 12MB になるため、ここでは読み込まない。
// 同期の設定の `extraFonts` が `src/theme/fonts.css` と woff2 を別のファイルとして送る。
import { installBrowserApis } from './browserApis'

// Tauri の外（Claude Design の描画環境）では IPC が無い。部品が DB を呼んでも
// 例外で画面が壊れないよう、読み込んだ時点で窓口を差し替える。
installBrowserApis()

export { TitleBar } from '../../src/components/titlebar/TitleBar'
export { StatusBar } from '../../src/components/statusbar/StatusBar'
export { Splitter } from '../../src/components/layout/Splitter'

export { TabBar } from '../../src/components/editor/TabBar'
export { SqlEditor } from '../../src/components/editor/SqlEditor'
export { RunButton } from '../../src/components/editor/RunButton'
export { BindValuesDialog } from '../../src/components/editor/BindValuesDialog'
export { SaveQueryDialog } from '../../src/components/editor/SaveQueryDialog'

export { Sidebar } from '../../src/components/sidebar/Sidebar'
export { SchemaTree } from '../../src/components/sidebar/SchemaTree'
export { SchemaTreeContextMenu } from '../../src/components/sidebar/SchemaTreeContextMenu'
export { SchemaFilterMenu } from '../../src/components/sidebar/SchemaFilterMenu'
export { SchemaReloadButton } from '../../src/components/sidebar/SchemaReloadButton'
export { HistoryList } from '../../src/components/sidebar/HistoryList'
export { SavedQueryList } from '../../src/components/sidebar/SavedQueryList'

export { ResultPane } from '../../src/components/results/ResultPane'
export { ResultTable } from '../../src/components/results/ResultTable'
export { ResultSearchBar } from '../../src/components/results/ResultSearchBar'
export { ResultContextMenu } from '../../src/components/results/ResultContextMenu'
export { CellDetailPanel } from '../../src/components/results/CellDetailPanel'

export { TableDefinitionPanel } from '../../src/components/definition/TableDefinitionPanel'

export { CommandPalette } from '../../src/components/palette/CommandPalette'
export { SettingsPanel } from '../../src/components/settings/SettingsPanel'
export { SessionsPanel } from '../../src/components/sessions/SessionsPanel'
export { SourceSearchPanel } from '../../src/components/source/SourceSearchPanel'
export { CsvSaveDialog } from '../../src/components/csv/CsvSaveDialog'

export { ConnectionPicker } from '../../src/components/connection/ConnectionPicker'
export { ConnectionForm } from '../../src/components/connection/ConnectionForm'
export { DisconnectBlockedDialog } from '../../src/components/connection/DisconnectBlockedDialog'
export { InstantClientNotice } from '../../src/components/connection/InstantClientNotice'

export { useConnectionStore } from '../../src/stores/connection'
export { useDefinitionStore } from '../../src/stores/definition'
export { useExecutionStore } from '../../src/stores/execution'
export { useHistoryStore } from '../../src/stores/history'
export { useSavedQueryStore } from '../../src/stores/savedQuery'
export { useSchemaStore } from '../../src/stores/schema'
export { useSessionsStore } from '../../src/stores/sessions'
export { useSourceSearchStore } from '../../src/stores/sourceSearch'
export { useTabStore } from '../../src/stores/tab'
export { useUiStore } from '../../src/stores/ui'

export { applyAppearance, defaultAppearance } from '../../src/theme/appearance'
export { setDbApi } from '../../src/api/db'
export type { DbApi } from '../../src/api/db'
export { createDesignDbApi } from './browserApis'
export * from '../../src/types/db'
export type {
  Catalog,
  CatalogColumn,
  CatalogObject,
  CatalogSchema,
} from '../../src/components/editor/catalog'
export type { CsvExportState } from '../../src/components/csv/CsvSaveDialog'
export type { BindInput } from '../../src/stores/tab'
export type { ActiveConnection } from '../../src/stores/connection'
export type {
  ExecutionStatus,
  LogEntry,
  ScriptProgress,
  TabExecution,
  TabPlan,
} from '../../src/stores/execution'
export type { EditorTab } from '../../src/stores/tab'
