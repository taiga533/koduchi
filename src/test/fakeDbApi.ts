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
  ConnectionParams,
  CsvOptions,
  ExecuteResponse,
  HistoryEntry,
  HistoryQuery,
  NewHistoryEntry,
  SavedConnection,
  SchemaFilter,
  SchemaNode,
  SessionState,
  TableColumn,
  TnsnamesFile,
} from '../types/db'
import { defaultCsvOptions } from '../types/db'

/** 呼び出しの記録。テストから中身を確かめる。 */
export interface FakeCalls {
  connect: { id: string; params: ConnectionParams }[]
  testConnection: ConnectionParams[]
  execute: { id: string; tabId: string; sql: string; binds: Bind[] }[]
  fetchMore: { id: string; tabId: string }[]
  releaseTab: { id: string; tabId: string }[]
  cancel: { id: string; tabId: string }[]
  disconnect: string[]
  recordHistory: NewHistoryEntry[]
  listHistory: HistoryQuery[]
  deleteHistory: number[]
  clearHistory: number
  saveSession: { windowLabel: string; state: SessionState }[]
  schemaOverview: { id: string; filter: SchemaFilter }[]
  schemaColumns: { id: string; owner: string }[]
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
  /** スキーマツリーの段階 1 の応答。 */
  schemas?: SchemaNode[]
  /** スキーマごとの列情報。 */
  columns?: Record<string, TableColumn[]>
  /** 復元するセッション。 */
  session?: SessionState
  /** 実行計画のテキスト。 */
  planText?: string
  /** tnsnames.ora の内容。 */
  tnsnames?: TnsnamesFile
  /** アプリ設定。 */
  appSettings?: AppSettings
}

/** 何も指定しないときに返す、行を持たない結果。 */
export const emptyResponse: ExecuteResponse = {
  kind: 'statement',
  affectedRows: 0,
  elapsedMs: 0,
  notices: [],
  discardedTab: null,
}

/** 何も指定しないときのアプリ設定。 */
const defaultAppSettings: AppSettings = {
  appearance: { theme: 'system', gridLines: true, rowHeight: 'compact' },
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
  options: { exhausted?: boolean; discardedTab?: string | null } = {},
): ExecuteResponse {
  return {
    kind: 'query',
    columns,
    chunk: { rows, exhausted: options.exhausted ?? true },
    elapsedMs: 84,
    notices: [],
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
    disconnect: [],
    recordHistory: [],
    listHistory: [],
    deleteHistory: [],
    clearHistory: 0,
    saveSession: [],
    schemaOverview: [],
    schemaColumns: [],
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
      return options.schemas ?? []
    },

    schemaColumns: async (id, owner) => {
      calls.schemaColumns.push({ id, owner })
      return options.columns?.[owner] ?? []
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
