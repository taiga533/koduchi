/**
 * Tauri コマンドのラッパ（ADR 0010）。
 *
 * zustand ストアはここを介してのみ Rust 側を呼ぶ。この層を差し替えられるように
 * しておくことで、ストアとコンポーネントのテストをデータベースから切り離せる。
 * mock ライブラリではなく実装の差し替えで済むため、mock を最小限に保てる。
 */

import { invoke } from '@tauri-apps/api/core'
import type {
  AppSettings,
  Bind,
  Cell,
  Chunk,
  ClientStatus,
  Column,
  ConnectionParams,
  CsvOptions,
  ExecuteResponse,
  HistoryEntry,
  HistoryQuery,
  NewHistoryEntry,
  NewSavedQuery,
  ObjectDdl,
  ObjectDefinition,
  ObjectKind,
  SavedConnection,
  SavedQuery,
  SavedQueryQuery,
  SchemaFilter,
  SchemaNode,
  SessionOverview,
  SessionState,
  SourceLine,
  SourceSearchRequest,
  SourceSearchResult,
  SourceTarget,
  TableColumn,
  TnsnamesFile,
} from '../types/db'

/** データベース操作の窓口。 */
export interface DbApi {
  /** Instant Client を初期化し、その状態を返す（ADR 0001）。 */
  instantClientStatus(): Promise<ClientStatus>
  /** Instant Client のライブラリのディレクトリを保存する。反映には再起動が要る。 */
  saveInstantClientLibDir(libDir: string): Promise<void>
  /** Instant Client の候補となるディレクトリを探す。 */
  findInstantClientCandidates(): Promise<string[]>
  /** データベースへ接続し、以後 `id` で参照できるようにする。 */
  connect(id: string, params: ConnectionParams): Promise<void>
  /**
   * 接続できるかだけを試し、繋いだ先のバージョンを返す。
   *
   * 接続は残らないため、成功しても以後 `id` では参照できない。
   */
  testConnection(params: ConnectionParams): Promise<string>
  /** SQL を 1 文実行する。問い合わせでは最初のかたまりだけが返る。 */
  execute(id: string, tabId: string, sql: string, binds: Bind[]): Promise<ExecuteResponse>
  /** 開いている結果セットから続きを取り出す（ADR 0003）。 */
  fetchMore(id: string, tabId: string): Promise<Chunk>
  /** タブの結果セットを閉じる。タブを閉じたときに呼ぶ。 */
  releaseTab(id: string, tabId: string): Promise<void>
  /** 実行中の文を中止する。 */
  cancel(id: string, tabId: string): Promise<void>
  /** トランザクションをコミットする（`⌥⌘C`、ADR 0012）。 */
  commit(id: string): Promise<void>
  /** トランザクションをロールバックする（`⌥⌘R`、ADR 0012）。 */
  rollback(id: string): Promise<void>
  /** 接続を閉じる。 */
  disconnect(id: string): Promise<void>

  /** 保存済みの接続を読む（ADR 0004）。 */
  listSavedConnections(): Promise<SavedConnection[]>
  /** 接続を保存する。パスワードを渡すとキーチェーンへ書く。 */
  saveConnection(connection: SavedConnection, password: string | null): Promise<void>
  /** 接続を削除する。キーチェーンのエントリも消える。 */
  deleteConnection(id: string): Promise<void>
  /** 保存済みのパスワードを取り出す。無ければ `null`。 */
  loadConnectionPassword(id: string): Promise<string | null>
  /** アプリ設定を読む。 */
  loadAppSettings(): Promise<AppSettings>
  /** アプリ設定を書く。 */
  saveAppSettings(settings: AppSettings): Promise<void>

  /** 履歴を 1 件記録する（ADR 0005）。 */
  recordHistory(entry: NewHistoryEntry): Promise<number>
  /** 履歴を新しい順に取り出す。 */
  listHistory(query: HistoryQuery): Promise<HistoryEntry[]>
  /** 履歴を 1 件削除する。 */
  deleteHistory(id: number): Promise<boolean>
  /** 履歴を全件削除し、消した件数を返す。 */
  clearHistory(): Promise<number>
  /** クエリを 1 件保存し、採番された ID を返す（ADR 0018）。 */
  createSavedQuery(query: NewSavedQuery): Promise<number>
  /** 保存済みクエリを更新日時の新しい順に取り出す。 */
  listSavedQueries(query: SavedQueryQuery): Promise<SavedQuery[]>
  /** 保存済みクエリの名前と SQL を書き換える。 */
  updateSavedQuery(id: number, name: string, sql: string, updatedAt: number): Promise<boolean>
  /** 保存済みクエリを 1 件削除する。 */
  deleteSavedQuery(id: number): Promise<boolean>
  /** ウィンドウ 1 つぶんのセッションを保存する。 */
  saveSession(windowLabel: string, state: SessionState): Promise<void>
  /** ウィンドウ 1 つぶんのセッションを読む。 */
  loadSession(windowLabel: string): Promise<SessionState>

  /** スキーマツリーの段階 1 を取る（ADR 0007）。 */
  schemaOverview(id: string, filter: SchemaFilter): Promise<SchemaNode[]>
  /** スキーマ 1 つぶんの列情報を取る（段階 2）。 */
  schemaColumns(id: string, owner: string): Promise<TableColumn[]>

  /**
   * テーブル定義ビュー 1 枚ぶんの内容を取る（ADR 0019）。
   *
   * 列・制約・索引をまとめて返す。DDL は含まない。列は段階 2 のキャッシュを
   * 使い回さず Rust 側が引き直すため、読み込みの途中でも欠けない。
   */
  objectDefinition(
    id: string,
    owner: string,
    name: string,
    kind: ObjectKind,
  ): Promise<ObjectDefinition>
  /**
   * オブジェクト 1 つの DDL を取る（ADR 0019）。
   *
   * パッケージは仕様と本体の 2 つが返る。権限が無い接続では `permission` の
   * 区分でエラーになる。空の定義ではない。
   */
  objectDdl(id: string, owner: string, name: string, kind: ObjectKind): Promise<ObjectDdl>

  /**
   * セッションの一覧とブロッキングの連鎖を取る（ADR 0017）。
   *
   * 参照権限が無い接続では `permission` の区分でエラーになる。空の一覧では
   * ない。「見えない」と「居ない」は別物である。
   */
  listSessions(id: string): Promise<SessionOverview>
  /**
   * セッションを 1 つ終了する（ADR 0017）。
   *
   * 読み取り専用の接続と、小槌自身が張っている接続は Rust 側が弾く。
   */
  killSession(id: string, sid: number, serial: number): Promise<void>

  /**
   * オブジェクトのソースを横断して検索する（ADR 0021）。
   *
   * 検索語はバインド変数として渡され、SQL へ直に埋め込まれない。当たり行数には
   * 上限があり、達したときは `truncated` が真になる。参照権限が無い接続では
   * `permission` の区分でエラーになる。空の結果ではない。
   */
  searchSource(id: string, request: SourceSearchRequest): Promise<SourceSearchResult>
  /**
   * 当たった行の前後を読む（ADR 0021）。
   *
   * 全文ではなく前後だけを読む。数千行のパッケージ本体でも持ち帰る量を
   * 一定に保つためである。
   */
  sourceContext(id: string, target: SourceTarget, line: number): Promise<SourceLine[]>

  /** 見積りだけの実行計画をテキストで返す（`⌘E`）。 */
  explainPlan(id: string, sql: string, binds: Bind[]): Promise<string>
  /** 実測付きの実行計画をテキストで返す（`⇧⌘E`）。 */
  actualPlan(id: string, sql: string, binds: Bind[]): Promise<string>

  /** tnsnames.ora を読む（ADR 0006）。 */
  readTnsnames(directory: string): Promise<TnsnamesFile>
  /** テキストファイルを読む（`⌘O`）。 */
  readTextFile(path: string): Promise<string>
  /** テキストファイルを書く（`⌘S`）。 */
  writeTextFile(path: string, content: string): Promise<void>

  /** CSV の書き出しを始める（`⌥⌘S`）。 */
  csvStart(exportId: string, path: string, columns: Column[], options: CsvOptions): Promise<void>
  /** 行を追記し、これまでに書いた総行数を返す。 */
  csvAppend(exportId: string, rows: Cell[][]): Promise<number>
  /** 書き出しを終え、書いた総行数を返す。 */
  csvFinish(exportId: string): Promise<number>
  /** 書き出しを中止し、書きかけのファイルを消す。 */
  csvAbort(exportId: string): Promise<void>

  /** 別の接続のためのウィンドウを開く（`⌃⌘N`、ADR 0009）。 */
  openConnectionWindow(): Promise<string>
}

/** Tauri の `invoke` を呼ぶ実装。 */
const tauriDbApi: DbApi = {
  instantClientStatus: () => invoke('instant_client_status'),
  saveInstantClientLibDir: (libDir) => invoke('save_instant_client_lib_dir', { libDir }),
  findInstantClientCandidates: () => invoke('find_instant_client_candidates'),
  connect: (id, params) => invoke('connect', { id, params }),
  testConnection: (params) => invoke('test_connection', { params }),
  execute: (id, tabId, sql, binds) => invoke('execute', { id, tabId, sql, binds }),
  fetchMore: (id, tabId) => invoke('fetch_more', { id, tabId }),
  releaseTab: (id, tabId) => invoke('release_tab', { id, tabId }),
  cancel: (id, tabId) => invoke('cancel', { id, tabId }),
  commit: (id) => invoke('commit', { id }),
  rollback: (id) => invoke('rollback', { id }),
  disconnect: (id) => invoke('disconnect', { id }),

  listSavedConnections: () => invoke('list_saved_connections'),
  saveConnection: (connection, password) => invoke('save_connection', { connection, password }),
  deleteConnection: (id) => invoke('delete_connection', { id }),
  loadConnectionPassword: (id) => invoke('load_connection_password', { id }),
  loadAppSettings: () => invoke('load_app_settings'),
  saveAppSettings: (settings) => invoke('save_app_settings', { settings }),

  recordHistory: (entry) => invoke('record_history', { entry }),
  listHistory: (query) => invoke('list_history', { query }),
  deleteHistory: (id) => invoke('delete_history', { id }),
  clearHistory: () => invoke('clear_history'),
  createSavedQuery: (query) => invoke('create_saved_query', { query }),
  listSavedQueries: (query) => invoke('list_saved_queries', { query }),
  updateSavedQuery: (id, name, sql, updatedAt) =>
    invoke('update_saved_query', { id, name, sql, updatedAt }),
  deleteSavedQuery: (id) => invoke('delete_saved_query', { id }),
  saveSession: (windowLabel, state) => invoke('save_session', { windowLabel, state }),
  loadSession: (windowLabel) => invoke('load_session', { windowLabel }),

  schemaOverview: (id, filter) => invoke('schema_overview', { id, filter }),
  schemaColumns: (id, owner) => invoke('schema_columns', { id, owner }),

  objectDefinition: (id, owner, name, kind) =>
    invoke('object_definition', { id, owner, name, kind }),
  objectDdl: (id, owner, name, kind) => invoke('object_ddl', { id, owner, name, kind }),

  listSessions: (id) => invoke('list_sessions', { id }),
  killSession: (id, sid, serial) => invoke('kill_session', { id, sid, serial }),

  searchSource: (id, request) => invoke('search_source', { id, request }),
  sourceContext: (id, target, line) => invoke('source_context', { id, target, line }),

  explainPlan: (id, sql, binds) => invoke('explain_plan', { id, sql, binds }),
  actualPlan: (id, sql, binds) => invoke('actual_plan', { id, sql, binds }),

  readTnsnames: (directory) => invoke('read_tnsnames', { directory }),
  readTextFile: (path) => invoke('read_text_file', { path }),
  writeTextFile: (path, content) => invoke('write_text_file', { path, content }),

  csvStart: (exportId, path, columns, options) =>
    invoke('csv_start', { exportId, path, columns, options }),
  csvAppend: (exportId, rows) => invoke('csv_append', { exportId, rows }),
  csvFinish: (exportId) => invoke('csv_finish', { exportId }),
  csvAbort: (exportId) => invoke('csv_abort', { exportId }),

  openConnectionWindow: () => invoke('open_connection_window'),
}

let current: DbApi = tauriDbApi

/** 現在使われている窓口を返す。ストアはこれを介して Rust 側を呼ぶ。 */
export function getDbApi(): DbApi {
  return current
}

/**
 * 窓口を差し替える。テストからのみ使う。
 *
 * @param api 差し替える実装
 */
export function setDbApi(api: DbApi): void {
  current = api
}

/** 窓口を Tauri の実装へ戻す。テストの後片付けに使う。 */
export function resetDbApi(): void {
  current = tauriDbApi
}
