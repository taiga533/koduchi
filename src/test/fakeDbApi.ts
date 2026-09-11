/**
 * テスト用のデータベース窓口（ADR 0010）。
 *
 * `src/api/` 層を丸ごと差し替えることで、ストアとコンポーネントのテストを
 * データベースから切り離す。mock ライブラリを使わずに済むのはこのためである。
 */

import type { DbApi } from '../api/db'
import type {
  AppSettings,
  Bind,
  Cell,
  Chunk,
  ClientStatus,
  Column,
  ConnectionHealth,
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
  SessionRow,
  SessionState,
  SourceLine,
  SourceSearchRequest,
  SourceSearchResult,
  SourceTarget,
  TableColumn,
  TnsnamesFile,
} from '../types/db'
import { defaultCsvOptions, defaultSourceKindFilter } from '../types/db'

/** 呼び出しの記録。テストから中身を確かめる。 */
export interface FakeCalls {
  connect: { id: string; params: ConnectionParams }[]
  testConnection: ConnectionParams[]
  execute: { id: string; tabId: string; sql: string; binds: Bind[] }[]
  fetchMore: { id: string; tabId: string }[]
  releaseTab: { id: string; tabId: string }[]
  cancel: { id: string; tabId: string }[]
  commit: string[]
  rollback: string[]
  connectionHealth: string[]
  disconnect: string[]
  recordHistory: NewHistoryEntry[]
  listHistory: HistoryQuery[]
  deleteHistory: number[]
  clearHistory: number
  createSavedQuery: NewSavedQuery[]
  listSavedQueries: SavedQueryQuery[]
  updateSavedQuery: { id: number; name: string; sql: string; updatedAt: number }[]
  deleteSavedQuery: number[]
  saveSession: { windowLabel: string; state: SessionState }[]
  schemaOverview: { id: string; filter: SchemaFilter }[]
  schemaColumns: { id: string; owner: string }[]
  objectDefinition: { id: string; owner: string; name: string; kind: ObjectKind }[]
  objectDdl: { id: string; owner: string; name: string; kind: ObjectKind }[]
  listSessions: string[]
  killSession: { id: string; sid: number; serial: number }[]
  searchSource: { id: string; request: SourceSearchRequest }[]
  sourceContext: { id: string; target: SourceTarget; line: number }[]
  explainPlan: { id: string; sql: string; binds: Bind[] }[]
  actualPlan: { id: string; sql: string; binds: Bind[] }[]
  saveConnection: { connection: SavedConnection; password: string | null }[]
  loadConnectionPassword: string[]
  deleteConnection: string[]
  saveAppSettings: AppSettings[]
  writeTextFile: { path: string; content: string }[]
  csvStart: { exportId: string; path: string; columns: Column[]; options: CsvOptions }[]
  csvAppend: { exportId: string; rows: Cell[][] }[]
  csvFinish: string[]
  csvAbort: string[]
  openConnectionWindow: number
}

/** 窓口の応答を差し替えるための設定。 */
export interface FakeDbApiOptions {
  clientStatus?: ClientStatus
  /** SQL ごとの応答。実行結果か、投げるエラーを返す。 */
  onExecute?: (sql: string) => ExecuteResponse | Promise<ExecuteResponse>
  /** 続きの要求ごとの応答。 */
  onFetchMore?: (tabId: string) => Chunk | Promise<Chunk>
  /** 接続時に投げるエラー。 */
  connectError?: unknown
  /**
   * 接続の様子（ADR 0030）。
   *
   * 渡さないと「切られているとは分からない」「たった今往復できた」を返す。
   * 関数を渡すと呼ばれるたびに答えを変えられる。
   */
  health?: ConnectionHealth | (() => ConnectionHealth)
  /** テスト接続が返すバージョン。 */
  testVersion?: string
  /** テスト接続で投げるエラー。 */
  testError?: unknown
  /** 保存済みの接続。 */
  savedConnections?: SavedConnection[]
  /** 接続 ID ごとのキーチェーンのパスワード。無い ID は未保存として扱う。 */
  passwords?: Record<string, string>
  /** 履歴の一覧。 */
  history?: HistoryEntry[]
  /** 保存済みクエリの一覧（ADR 0018）。 */
  savedQueries?: SavedQuery[]
  /** スキーマツリーの段階 1 の応答。 */
  schemas?: SchemaNode[]
  /**
   * スキーマツリーの段階 1 の応答を呼び出しごとに決める。
   *
   * `schemas` より優先する。断の前後で答えを変える、といった使い方をする。
   */
  onSchemaOverview?: () => SchemaNode[] | Promise<SchemaNode[]>
  /** スキーマごとの列情報。 */
  columns?: Record<string, TableColumn[]>
  /** テーブル定義ビューの応答（ADR 0019）。 */
  definition?: ObjectDefinition
  /** 定義の取得で投げるエラー。権限不足の表示を確かめるのに使う。 */
  definitionError?: unknown
  /** DDL の応答（ADR 0019）。 */
  ddl?: ObjectDdl
  /** DDL の取得で投げるエラー。 */
  ddlError?: unknown
  /** 復元するセッション。 */
  session?: SessionState
  /** 実行計画のテキスト。 */
  planText?: string
  /** セッションの一覧（ADR 0017）。 */
  sessions?: SessionOverview
  /** セッションの一覧で投げるエラー。権限不足の表示を確かめるのに使う。 */
  sessionsError?: unknown
  /** kill で投げるエラー。 */
  killError?: unknown
  /** ソース検索の結果（ADR 0021）。 */
  sourceMatches?: SourceSearchResult
  /** ソース検索で投げるエラー。権限不足の表示を確かめるのに使う。 */
  sourceError?: unknown
  /** 当たった行の前後（ADR 0021）。 */
  sourceLines?: SourceLine[]
  /** tnsnames.ora の内容。 */
  tnsnames?: TnsnamesFile
  /** アプリ設定。 */
  appSettings?: AppSettings
  /** コミットで投げるエラー（ADR 0012）。 */
  commitError?: unknown
  /** ロールバックで投げるエラー（ADR 0012）。 */
  rollbackError?: unknown
}

/** 何も指定しないときに返す、行を持たない結果。 */
export const emptyResponse: ExecuteResponse = {
  kind: 'statement',
  affectedRows: 0,
  elapsedMs: 0,
  notices: [],
  inTransaction: false,
  discardedTab: null,
}

/** 何も指定しないときのセッション一覧（ADR 0017）。 */
export const emptySessionOverview: SessionOverview = {
  instance: 1,
  currentSid: 1,
  sessions: [],
  chains: [],
}

/**
 * セッション 1 行を組み立てる。
 *
 * 指定しなかった項目は、待ってもいなければ待たせてもいない `INACTIVE` の
 * セッションになる。
 *
 * @param row 差し替える項目。`sid` は必須
 */
export function sessionRow(row: Partial<SessionRow> & { sid: number }): SessionRow {
  return {
    serial: row.sid * 10,
    username: 'KODUCHI',
    status: 'INACTIVE',
    osuser: 'taiga',
    machine: 'mac.local',
    process: '4242',
    program: 'sqlplus',
    module: null,
    event: null,
    secondsInWait: 0,
    sqlId: null,
    logonTime: '2026-09-08 10:00:00',
    blockingSession: null,
    blockingInstance: null,
    own: false,
    ...row,
  }
}

/** 何も指定しないときのソース検索の結果（ADR 0021）。 */
export const emptySourceSearchResult: SourceSearchResult = {
  objects: [],
  matchedLines: 0,
  truncated: false,
}

/**
 * ソース検索の求めを組み立てる。
 *
 * 指定しなかった項目は、すべてのスキーマを全種別・大小の区別なしで探す求めになる。
 *
 * @param request 差し替える項目
 */
export function sourceSearchRequest(
  request: Partial<SourceSearchRequest> = {},
): SourceSearchRequest {
  return {
    needle: '',
    owner: null,
    kinds: defaultSourceKindFilter,
    caseSensitive: false,
    limit: 500,
    ...request,
  }
}

/**
 * 何も指定しないときのテーブル定義（ADR 0019）。
 *
 * 列も制約も索引も持たない。何かを見せたいテストは `definition` で差し替える。
 *
 * @param owner 所有者のスキーマ名
 * @param name オブジェクト名
 * @param kind オブジェクトの種類
 */
function emptyDefinition(owner: string, name: string, kind: ObjectKind): ObjectDefinition {
  return { owner, name, kind, columns: [], constraints: [], indexes: [] }
}

/**
 * 列 1 つを組み立てる。
 *
 * 指定しなかった項目は `NUMBER(12)` の NULL 可な列になる。
 *
 * @param column 差し替える項目。`name` は必須
 */
export function tableColumn(column: Partial<TableColumn> & { name: string }): TableColumn {
  return {
    objectName: 'SHIPMENTS',
    typeName: 'NUMBER(12)',
    nullable: true,
    kind: 'number',
    ...column,
  }
}

/** 何も指定しないときのアプリ設定。 */
const defaultAppSettings: AppSettings = {
  appearance: { theme: 'system', gridLines: true, rowHeight: 'compact', editorFontSize: 'medium' },
  csv: defaultCsvOptions,
}

/**
 * 問い合わせの応答を組み立てる。
 *
 * @param columns 列の定義
 * @param rows 返す行
 * @param options カーソルが尽きたか、巻き添えで閉じられたタブ
 */
export function queryResponse(
  columns: Column[],
  rows: Cell[][],
  options: { exhausted?: boolean; discardedTab?: string | null; inTransaction?: boolean } = {},
): ExecuteResponse {
  return {
    kind: 'query',
    columns,
    chunk: { rows, exhausted: options.exhausted ?? true },
    elapsedMs: 84,
    notices: [],
    inTransaction: options.inTransaction ?? false,
    discardedTab: options.discardedTab ?? null,
  }
}

/**
 * テスト用の窓口を作る。
 *
 * @param options 応答の差し替え
 *
 * @returns 窓口と、呼び出しの記録
 */
export function createFakeDbApi(options: FakeDbApiOptions = {}): {
  api: DbApi
  calls: FakeCalls
} {
  const calls: FakeCalls = {
    connect: [],
    testConnection: [],
    execute: [],
    fetchMore: [],
    releaseTab: [],
    cancel: [],
    commit: [],
    rollback: [],
    connectionHealth: [],
    disconnect: [],
    recordHistory: [],
    listHistory: [],
    deleteHistory: [],
    clearHistory: 0,
    createSavedQuery: [],
    listSavedQueries: [],
    updateSavedQuery: [],
    deleteSavedQuery: [],
    saveSession: [],
    schemaOverview: [],
    schemaColumns: [],
    objectDefinition: [],
    objectDdl: [],
    listSessions: [],
    killSession: [],
    searchSource: [],
    sourceContext: [],
    explainPlan: [],
    actualPlan: [],
    saveConnection: [],
    loadConnectionPassword: [],
    deleteConnection: [],
    saveAppSettings: [],
    writeTextFile: [],
    csvStart: [],
    csvAppend: [],
    csvFinish: [],
    csvAbort: [],
    openConnectionWindow: 0,
  }

  let nextHistoryId = 1
  let nextSavedQueryId = 1

  const api: DbApi = {
    instantClientStatus: async () =>
      options.clientStatus ?? { status: 'ready', version: '23.9.0.0.0' },
    saveInstantClientLibDir: async () => {},
    findInstantClientCandidates: async () => [],

    connect: async (id, params) => {
      calls.connect.push({ id, params })
      if (options.connectError !== undefined) {
        throw options.connectError
      }
    },

    testConnection: async (params) => {
      calls.testConnection.push(params)
      if (options.testError !== undefined) {
        throw options.testError
      }
      return options.testVersion ?? '23.9.0.0.0'
    },

    execute: async (id, tabId, sql, binds) => {
      calls.execute.push({ id, tabId, sql, binds })
      return options.onExecute ? options.onExecute(sql) : emptyResponse
    },

    fetchMore: async (id, tabId) => {
      calls.fetchMore.push({ id, tabId })
      return options.onFetchMore ? options.onFetchMore(tabId) : { rows: [], exhausted: true }
    },

    releaseTab: async (id, tabId) => {
      calls.releaseTab.push({ id, tabId })
    },

    cancel: async (id, tabId) => {
      calls.cancel.push({ id, tabId })
    },

    commit: async (id) => {
      calls.commit.push(id)
      if (options.commitError !== undefined) {
        throw options.commitError
      }
    },

    rollback: async (id) => {
      calls.rollback.push(id)
      if (options.rollbackError !== undefined) {
        throw options.rollbackError
      }
    },

    connectionHealth: async (id) => {
      calls.connectionHealth.push(id)
      const health = typeof options.health === 'function' ? options.health() : options.health
      return health ?? { disconnected: false, lastRoundTripMs: Date.now() }
    },

    disconnect: async (id) => {
      calls.disconnect.push(id)
    },

    listSavedConnections: async () => options.savedConnections ?? [],

    saveConnection: async (connection, password) => {
      calls.saveConnection.push({ connection, password })
    },

    deleteConnection: async (id) => {
      calls.deleteConnection.push(id)
    },

    loadConnectionPassword: async (id) => {
      calls.loadConnectionPassword.push(id)
      return options.passwords?.[id] ?? null
    },

    loadAppSettings: async () => options.appSettings ?? defaultAppSettings,

    saveAppSettings: async (settings) => {
      calls.saveAppSettings.push(settings)
    },

    recordHistory: async (entry) => {
      calls.recordHistory.push(entry)
      nextHistoryId += 1
      return nextHistoryId
    },

    listHistory: async (query) => {
      calls.listHistory.push(query)
      const entries = options.history ?? []
      return entries.filter(
        (entry) =>
          (query.connectionName === null || entry.connectionName === query.connectionName) &&
          (query.search === null || entry.sql.includes(query.search)),
      )
    },

    deleteHistory: async (id) => {
      calls.deleteHistory.push(id)
      return true
    },

    clearHistory: async () => {
      calls.clearHistory += 1
      return options.history?.length ?? 0
    },

    createSavedQuery: async (query) => {
      calls.createSavedQuery.push(query)
      nextSavedQueryId += 1
      return nextSavedQueryId
    },

    listSavedQueries: async (query) => {
      calls.listSavedQueries.push(query)
      const entries = options.savedQueries ?? []
      return entries.filter(
        (entry) =>
          (query.connectionName === null || entry.connectionName === query.connectionName) &&
          (query.search === null ||
            entry.name.includes(query.search) ||
            entry.sql.includes(query.search)),
      )
    },

    updateSavedQuery: async (id, name, sql, updatedAt) => {
      calls.updateSavedQuery.push({ id, name, sql, updatedAt })
      return true
    },

    deleteSavedQuery: async (id) => {
      calls.deleteSavedQuery.push(id)
      return true
    },

    saveSession: async (windowLabel, state) => {
      calls.saveSession.push({ windowLabel, state })
    },

    loadSession: async () =>
      options.session ?? {
        tabs: [],
        activeTabId: null,
        sidebarSegment: null,
        sidebarWidth: null,
        editorHeight: null,
      },

    schemaOverview: async (id, filter) => {
      calls.schemaOverview.push({ id, filter })
      return options.onSchemaOverview ? options.onSchemaOverview() : (options.schemas ?? [])
    },

    schemaColumns: async (id, owner) => {
      calls.schemaColumns.push({ id, owner })
      return options.columns?.[owner] ?? []
    },

    objectDefinition: async (id, owner, name, kind) => {
      calls.objectDefinition.push({ id, owner, name, kind })
      if (options.definitionError !== undefined) {
        throw options.definitionError
      }
      return options.definition ?? emptyDefinition(owner, name, kind)
    },

    objectDdl: async (id, owner, name, kind) => {
      calls.objectDdl.push({ id, owner, name, kind })
      if (options.ddlError !== undefined) {
        throw options.ddlError
      }
      return (
        options.ddl ?? {
          owner,
          name,
          kind,
          parts: [{ label: '定義', sql: `create table ${owner}.${name} (id number);` }],
        }
      )
    },

    listSessions: async (id) => {
      calls.listSessions.push(id)
      if (options.sessionsError !== undefined) {
        throw options.sessionsError
      }
      return options.sessions ?? emptySessionOverview
    },

    killSession: async (id, sid, serial) => {
      calls.killSession.push({ id, sid, serial })
      if (options.killError !== undefined) {
        throw options.killError
      }
    },

    searchSource: async (id, request) => {
      calls.searchSource.push({ id, request })
      if (options.sourceError !== undefined) {
        throw options.sourceError
      }
      return options.sourceMatches ?? emptySourceSearchResult
    },

    sourceContext: async (id, target, line) => {
      calls.sourceContext.push({ id, target, line })
      return options.sourceLines ?? []
    },

    explainPlan: async (id, sql, binds) => {
      calls.explainPlan.push({ id, sql, binds })
      return options.planText ?? 'Plan hash value: 0'
    },

    actualPlan: async (id, sql, binds) => {
      calls.actualPlan.push({ id, sql, binds })
      return options.planText ?? 'Plan hash value: 0'
    },

    readTnsnames: async () => options.tnsnames ?? { entries: [], warnings: [] },

    readTextFile: async () => '',

    writeTextFile: async (path, content) => {
      calls.writeTextFile.push({ path, content })
    },

    csvStart: async (exportId, path, columns, csvOptions) => {
      calls.csvStart.push({ exportId, path, columns, options: csvOptions })
    },

    csvAppend: async (exportId, rows) => {
      calls.csvAppend.push({ exportId, rows })
      return calls.csvAppend.reduce((total, call) => total + call.rows.length, 0)
    },

    csvFinish: async (exportId) => {
      calls.csvFinish.push(exportId)
      return calls.csvAppend.reduce((total, call) => total + call.rows.length, 0)
    },

    csvAbort: async (exportId) => {
      calls.csvAbort.push(exportId)
    },

    openConnectionWindow: async () => {
      calls.openConnectionWindow += 1
      return `connection-${calls.openConnectionWindow}`
    },
  }

  return { api, calls }
}
