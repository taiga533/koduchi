/**
 * Rust 側と共有する型定義。
 *
 * `src-tauri/src/db/` の `serde` 表現と一対一で対応する。フィールド名は Rust 側で
 * camelCase へ変換されている。
 */

/** セルの値の種類。結果テーブルの右寄せ判定と NULL の描き分けに使う。 */
export type CellKind = 'number' | 'text' | 'datetime' | 'bool' | 'binary' | 'null'

/**
 * 結果テーブルの 1 セル。
 *
 * 数値も文字列として持つ。Oracle の `NUMBER` は最大 38 桁の 10 進数であり、
 * JavaScript の `number` に載せると精度が壊れるためである。
 */
export interface Cell {
  /** 表示に使う文字列。`kind` が `null` のときは空文字列。 */
  text: string
  kind: CellKind
}

/** 結果セットの列。 */
export interface Column {
  name: string
  /** `NUMBER(12,2)` のようなデータベース上の型名。 */
  typeName: string
  kind: CellKind
}

/**
 * カーソルから一度に取り出した行のかたまり（ADR 0003）。
 *
 * 数十万行を一括で受け取るとメインスレッドが固まるため、結果セットは開いたまま
 * 保持し、スクロールが下端に近づくたびに 1,000 行ずつ取り出す。
 */
export interface Chunk {
  rows: Cell[][]
  /**
   * カーソルが尽きたか。
   *
   * 真になるまで総行数は分からない。行数の表示が 2 段階に分かれるのはこのため。
   */
  exhausted: boolean
}

/** SQL を 1 文実行した結果。問い合わせかどうかで返るものが違う。 */
export type ExecuteOutcome =
  | {
      kind: 'query'
      columns: Column[]
      chunk: Chunk
      elapsedMs: number
      notices: string[]
      /**
       * 未コミットのトランザクションが残っているか（ADR 0012）。
       *
       * 実行のたびにデータベースへ聞いた結果である。クライアント側で DML を
       * 数えると `WITH ... INSERT` や無名 PL/SQL ブロックをすり抜ける。
       */
      inTransaction: boolean
    }
  | {
      kind: 'statement'
      affectedRows: number
      elapsedMs: number
      notices: string[]
      /** 未コミットのトランザクションが残っているか（ADR 0012）。 */
      inTransaction: boolean
    }

/** 実行結果と、その巻き添えで結果セットを閉じられたタブ。 */
export type ExecuteResponse = ExecuteOutcome & {
  /**
   * 接続を明け渡すために結果セットを閉じられたタブ（ADR 0003）。
   *
   * このタブには「結果は破棄されました。再実行してください」を出す。
   */
  discardedTab: string | null
}

/**
 * バインド変数 1 つ。名前と与える値の対（ADR の「バインド変数」節）。
 *
 * 値は型を選ばせずすべて文字列として渡し、Oracle 側では `VARCHAR2` として
 * バインドする。`null` は NULL を意味する。名前に前置きの `:` は含めない。
 */
export type Bind = [name: string, value: string | null]

/** 接続先の指定方法（ADR 0006）。 */
export type ConnectTarget =
  | { method: 'ezConnect'; host: string; port: number; serviceName: string }
  | { method: 'descriptor'; descriptor: string }

/** 接続に必要な情報。 */
export interface ConnectionParams {
  username: string
  password: string
  target: ConnectTarget
  /** 読み取り専用で接続するか（ADR 0004）。データベース側で保証される。 */
  readOnly: boolean
  /**
   * 実行のたびに自動でコミットするか（ADR 0012）。
   *
   * 既定は偽（手動コミット）。読み取り専用のときは意味を持たない。
   */
  autoCommit: boolean
}

/** エラーの区分。 */
export type DbErrorKind =
  | 'clientUnavailable'
  | 'connect'
  | 'execute'
  | 'cancelled'
  | 'closed'
  /** 履歴や設定など、アプリ自身の保管庫の読み書きに失敗した（ADR 0005）。 */
  | 'storage'

/** データベース操作のエラー。 */
export interface DbError {
  kind: DbErrorKind
  message: string
}

/** Oracle Instant Client の状態（ADR 0001）。 */
export type ClientStatus =
  | { status: 'ready'; version: string }
  | { status: 'unavailable'; message: string; candidates: string[] }

/**
 * 値が `DbError` かどうかを判定する。
 *
 * Tauri のコマンドが返すエラーは `unknown` として届くため、型を絞るのに使う。
 *
 * @param value 判定する値
 */
export function isDbError(value: unknown): value is DbError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    'message' in value &&
    typeof (value as DbError).message === 'string'
  )
}

/**
 * 任意の例外を利用者に見せるメッセージへ変換する。
 *
 * @param value 捕捉した例外
 */
export function toErrorMessage(value: unknown): string {
  if (isDbError(value)) {
    return value.message
  }
  if (value instanceof Error) {
    return value.message
  }
  return String(value)
}

/** スキーマツリーの絞り込み条件（ADR 0007）。接続ごとに保存される。 */
export interface SchemaFilter {
  /** システムスキーマを除外する。既定は真。 */
  excludeSystem: boolean
  /** 参照可能なオブジェクトが無いスキーマを隠す。既定は真。 */
  hideEmpty: boolean
}

/** スキーマフィルタの既定値。 */
export const defaultSchemaFilter: SchemaFilter = {
  excludeSystem: true,
  hideEmpty: true,
}

/** スキーマ内のオブジェクトの種類。 */
export type ObjectKind =
  'table' | 'view' | 'materializedView' | 'function' | 'procedure' | 'package' | 'sequence'

/** スキーマ内のオブジェクト 1 件。 */
export interface SchemaObject {
  name: string
  kind: ObjectKind
}

/** スキーマ 1 つ。段階 1 で返る（ADR 0007）。 */
export interface SchemaNode {
  name: string
  /** 参照可能なオブジェクトの数。 */
  objectCount: number
  objects: SchemaObject[]
}

/** テーブルやビューの列 1 つ。段階 2 で返る。 */
export interface TableColumn {
  /** 属するオブジェクトの名前。 */
  objectName: string
  name: string
  /** `NUMBER(12,2)` のような表示用の型名。 */
  typeName: string
  nullable: boolean
  kind: CellKind
}

/**
 * 補完で挿入する識別子の綴り（ADR 0013）。
 *
 * Oracle のカタログは名前を大文字で持つため、`preserve` では `TABLE_NAME` が
 * そのまま入る。`lower` を選ぶと `table_name` になる。引用符を付けずに書いた
 * 識別子は Oracle が大文字へ畳んで解釈するため、どちらでも同じ表に解決される。
 */
export type IdentifierCase = 'lower' | 'upper' | 'preserve'

/** 補完の設定。接続ごとに `connections.toml` へ保存する（ADR 0013）。 */
export interface CompletionSettings {
  identifierCase: IdentifierCase
}

/** 補完の設定の既定値。カタログの綴りをそのまま出す。 */
export const defaultCompletionSettings: CompletionSettings = {
  identifierCase: 'preserve',
}

/** 保存する接続先の指定方法（ADR 0004・0006）。 */
export type SavedTarget =
  | { method: 'ezConnect'; host: string; port: number; serviceName: string }
  | { method: 'tns'; directory: string; alias: string }

/** 保存された接続 1 件。パスワードは含まない（ADR 0004）。 */
export interface SavedConnection {
  /** 一意 ID。キーチェーンのアカウント名にもなる。 */
  id: string
  name: string
  username: string
  readOnly: boolean
  /** 実行のたびに自動でコミットするか（ADR 0012）。既定は偽。 */
  autoCommit: boolean
  schemaFilter: SchemaFilter
  /** 補完の設定（ADR 0013）。省略された古い設定ファイルでは既定値になる。 */
  completion: CompletionSettings
  target: SavedTarget
}

/** tnsnames.ora の 1 エントリ（ADR 0006）。 */
export interface TnsEntry {
  aliases: string[]
  /** 正規化した接続記述子。そのまま接続文字列として使える。 */
  descriptor: string
}

/** tnsnames.ora を読んだ結果。 */
export interface TnsnamesFile {
  entries: TnsEntry[]
  /** 読み飛ばした箇所の説明。`IFILE` などが入る。 */
  warnings: string[]
}

/** 履歴に積む 1 件（ADR 0005）。 */
export interface NewHistoryEntry {
  sql: string
  connectionName: string
  /** 実行を始めた時刻（Unix エポックからのミリ秒）。 */
  startedAt: number
  elapsedMs: number
  rowCount: number | null
  succeeded: boolean
  errorMessage: string | null
}

/** 保存済みの履歴 1 件。 */
export interface HistoryEntry extends NewHistoryEntry {
  id: number
}

/** 履歴の絞り込み条件。 */
export interface HistoryQuery {
  /** 接続名。`null` なら全接続（サイドバーのスコープ切替に対応する）。 */
  connectionName: string | null
  /** SQL の部分一致で絞る語。 */
  search: string | null
  limit: number
}

/** 復元するエディタタブ 1 枚（ADR 0005）。 */
export interface SessionTab {
  id: string
  name: string
  filePath: string | null
  content: string
  dirty: boolean
}

/** ウィンドウ 1 つぶんの復元対象。 */
export interface SessionState {
  tabs: SessionTab[]
  activeTabId: string | null
  sidebarSegment: string | null
  /**
   * サイドバーの幅（px）。この 2 つを持たない古いセッションでは `null` になる。
   *
   * ペインの寸法はウィンドウごとに違ってよいため、`settings.toml` ではなく
   * セッションへ置く。
   */
  sidebarWidth: number | null
  /** エディタの高さ（px）。古いセッションでは `null`。 */
  editorHeight: number | null
}

/** CSV の区切り文字。 */
export type CsvDelimiter = 'comma' | 'tab' | 'semicolon'

/** CSV の文字コード。 */
export type CsvEncoding = 'utf8Bom' | 'utf8' | 'shiftJis'

/** CSV の NULL の表し方。 */
export type CsvNullText = 'blank' | 'word' | 'backslash'

/** CSV の書式（ADR の「CSV の書式」節）。 */
export interface CsvOptions {
  delimiter: CsvDelimiter
  encoding: CsvEncoding
  nullText: CsvNullText
}

/** CSV の書式の既定値。Excel が正しく開ける組み合わせにしてある。 */
export const defaultCsvOptions: CsvOptions = {
  delimiter: 'comma',
  encoding: 'utf8Bom',
  nullText: 'blank',
}

/** 設定画面で決める見た目の設定（ADR 0008）。 */
export interface AppearanceSettings {
  theme: string
  gridLines: boolean
  rowHeight: string
}

/** アプリ全体の設定。 */
export interface AppSettings {
  appearance: AppearanceSettings
  csv: CsvOptions
}
