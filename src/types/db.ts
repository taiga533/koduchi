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
  /**
   * 上限を超えて切り詰められた値か（ADR 0021 の「黙って切り詰めない」）。
   *
   * `CLOB` は先頭 64KB までしか運ばない（「値の受け渡し」節）。切れていない
   * セルでは Rust 側が項目そのものを省くため、省略可能である。**真のときは
   * 「これで全部だ」と読ませてはならない。**
   */
  truncated?: boolean
}

/**
 * `CLOB` を運ぶ上限（バイト）。
 *
 * Rust 側の `CLOB_LIMIT_BYTES` と同じ値である。切り詰めたことを伝える文言に
 * 「先頭 64 KB」と書くために持つ。
 */
export const CLOB_LIMIT_BYTES = 64 * 1024

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
 * バインド変数へ与える型（ADR 0016）。
 *
 * 値そのものは常に文字列で渡し、Rust 側がこの区分に従って Oracle の型へ
 * 変換する。読み取れない値は実行を始める前にエラーになる。
 */
export type BindKind = 'varchar2' | 'number' | 'date' | 'timestamp'

/** 型を選ぶ欄に並べる順。既定の `varchar2` を先頭に置く。 */
export const bindKinds: BindKind[] = ['varchar2', 'number', 'date', 'timestamp']

/** 型を選ぶ欄に出す表示名。Oracle の型名をそのまま使う。 */
export const bindKindLabels: Record<BindKind, string> = {
  varchar2: 'VARCHAR2',
  number: 'NUMBER',
  date: 'DATE',
  timestamp: 'TIMESTAMP',
}

/**
 * バインド変数 1 つ。名前・型・値の 3 つ組（ADR 0016）。
 *
 * 値は常に文字列として渡し、`kind` の型へ Rust 側で変換する。`value` が `null`
 * なら型に関わらず NULL としてバインドする。名前に前置きの `:` は含めない。
 */
export interface Bind {
  name: string
  kind: BindKind
  value: string | null
}

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
  /**
   * 権限が足りず、見ることも行うこともできない（ADR 0017）。
   *
   * 「権限が無くて見えない」を「空だった」と混同させないための区分である。
   */
  | 'permission'

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

/** スキーマツリーの絞り込み条件（ADR 0007・0014）。接続ごとに保存される。 */
export interface SchemaFilter {
  /** システムスキーマを除外する。既定は真。 */
  excludeSystem: boolean
  /** 参照可能なオブジェクトが無いスキーマを隠す。既定は真。 */
  hideEmpty: boolean
  /** ツリーに載せるオブジェクトの種別。既定はすべて真（ADR 0014）。 */
  kinds: ObjectKindFilter
}

/**
 * スキーマ内のオブジェクトの種類（ADR 0014）。
 *
 * 制約は含まない。`ALL_OBJECTS` に出てこないうえ、名前の大半が
 * `SYS_C0012345` の自動生成であるためである（ADR 0014）。
 */
export type ObjectKind =
  | 'table'
  | 'view'
  | 'materializedView'
  | 'index'
  | 'trigger'
  | 'sequence'
  | 'synonym'
  | 'type'
  | 'function'
  | 'procedure'
  | 'package'
  | 'databaseLink'

/**
 * ツリーに束を出す順。
 *
 * Rust 側の `ObjectKind` の宣言順と同じである。よく見るものを先に置く。
 */
export const OBJECT_KIND_ORDER: ObjectKind[] = [
  'table',
  'view',
  'materializedView',
  'index',
  'trigger',
  'sequence',
  'synonym',
  'type',
  'function',
  'procedure',
  'package',
  'databaseLink',
]

/** 種別の表示名。ツリーの束の見出しと絞り込みメニューに出す。 */
export const OBJECT_KIND_LABELS: Record<ObjectKind, string> = {
  table: 'テーブル',
  view: 'ビュー',
  materializedView: 'マテリアライズドビュー',
  index: '索引',
  trigger: 'トリガー',
  sequence: 'シーケンス',
  synonym: 'シノニム',
  type: '型',
  function: 'ファンクション',
  procedure: 'プロシージャ',
  package: 'パッケージ',
  databaseLink: 'DB link',
}

/**
 * 種別ごとの表示可否（ADR 0014）。
 *
 * 鍵は `ObjectKind` そのものであり、Rust 側の `ObjectKindFilter` の項目名と
 * 一致する。`filter.kinds[kind]` で直に引ける。
 */
export type ObjectKindFilter = Record<ObjectKind, boolean>

/** 種別の絞り込みの既定値。すべて表示する。 */
export const defaultObjectKindFilter: ObjectKindFilter = {
  table: true,
  view: true,
  materializedView: true,
  index: true,
  trigger: true,
  sequence: true,
  synonym: true,
  type: true,
  function: true,
  procedure: true,
  package: true,
  databaseLink: true,
}

/** スキーマフィルタの既定値。 */
export const defaultSchemaFilter: SchemaFilter = {
  excludeSystem: true,
  hideEmpty: true,
  kinds: defaultObjectKindFilter,
}

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

/**
 * 接続に付けられる色（ADR 0015）。
 *
 * 決め打ちのパレットであり、任意の色は入れられない。カラーピッカーを置くと
 * テーマとの整合が取れなくなるためである。値は `src/theme/tokens.css` の
 * `--cn-*` トークンと 1 対 1 で対応する。Rust 側の `ConnectionColor` と同じ。
 */
export const CONNECTION_COLORS = [
  'none',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'gray',
] as const

/** 接続に付けられる色。 */
export type ConnectionColor = (typeof CONNECTION_COLORS)[number]

/** 色の既定値。付けなければ色は出ない。 */
export const defaultConnectionColor: ConnectionColor = 'none'

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
  /** 接続に付けた色（ADR 0015）。省略された古い設定ファイルでは `none` になる。 */
  color: ConnectionColor
  /** 接続を束ねるグループ名（ADR 0015）。未指定なら `null`。入れ子は作らない。 */
  group: string | null
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

/**
 * 保存するクエリ 1 件（ADR 0018）。
 *
 * バインド変数の**値**は保存しない。履歴と同じく個人情報が入りうるためである
 * （ADR 0005）。保存するのは SQL 本体だけである。
 */
export interface NewSavedQuery {
  /** 一覧に出す名前。重複は許す。 */
  name: string
  sql: string
  /** 保存したときの接続の表示名。スコープ絞り込みに使う。 */
  connectionName: string
  /** 保存した時刻（Unix エポックからのミリ秒）。 */
  savedAt: number
}

/** 保存済みのクエリ 1 件。 */
export interface SavedQuery {
  id: number
  name: string
  sql: string
  connectionName: string
  createdAt: number
  updatedAt: number
}

/** 保存済みクエリの絞り込み条件。形は `HistoryQuery` に揃えてある。 */
export interface SavedQueryQuery {
  /** 接続名。`null` なら全接続。 */
  connectionName: string | null
  /** 名前または SQL の部分一致で絞る語。 */
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

/**
 * `V$SESSION` の 1 行（ADR 0017）。
 *
 * 並ぶのは `TYPE = 'USER'` のセッションだけである。バックグラウンドプロセスは
 * 調べものの対象にならない。
 */
export interface SessionRow {
  /** `SID`。kill の対象を指すのに使う。 */
  sid: number
  /** `SERIAL#`。`SID` は使い回されるため、kill には両方が要る。 */
  serial: number
  username: string | null
  /** `ACTIVE` / `INACTIVE` / `KILLED` など。 */
  status: string
  osuser: string | null
  machine: string | null
  /** クライアント側のプロセス ID。小槌自身の接続を見分けるのに使う。 */
  process: string | null
  program: string | null
  module: string | null
  /** 待機イベント。`enq: TX - row lock contention` などが入る。 */
  event: string | null
  /** 今の待機に入ってからの秒数。 */
  secondsInWait: number
  sqlId: string | null
  /** ログオン時刻（`YYYY-MM-DD HH24:MI:SS`）。 */
  logonTime: string | null
  /** 待たせている側のセッション。待っていなければ `null`。 */
  blockingSession: number | null
  /** 待たせている側のインスタンス番号。 */
  blockingInstance: number | null
  /**
   * 小槌自身が張っている接続か（ADR 0017）。
   *
   * 真の行には kill のボタンを出さない。自分自身だけでなく、同じプールの
   * 残りの接続も、別のウィンドウの接続も含む。
   */
  own: boolean
}

/** ブロッキングの連鎖 1 節点（ADR 0017）。 */
export interface BlockingNode {
  sid: number
  /** この節点が待たせているセッション。 */
  blocked: BlockingNode[]
}

/** セッション一覧 1 回ぶんの取得結果（ADR 0017）。 */
export interface SessionOverview {
  /** 今繋がっているインスタンスの番号。 */
  instance: number
  /** この一覧を読んだ接続自身の `SID`。 */
  currentSid: number
  sessions: SessionRow[]
  /** ブロッキングの連鎖。誰も待たせていなければ空になる。 */
  chains: BlockingNode[]
}

/**
 * 制約の種類（ADR 0019）。
 *
 * `ALL_CONSTRAINTS.CONSTRAINT_TYPE` の 4 つだけを扱う。ビューにしか付かない
 * 種類（`WITH CHECK OPTION` と読み取り専用）は落としてある。
 */
export type ConstraintKind = 'primaryKey' | 'unique' | 'foreignKey' | 'check'

/** 制約の種類の表示名。定義ビューの「制約」タブに出す。 */
export const CONSTRAINT_KIND_LABELS: Record<ConstraintKind, string> = {
  primaryKey: '主キー',
  unique: '一意',
  foreignKey: '外部キー',
  check: '検査',
}

/** テーブルに付いている制約 1 つ（ADR 0019）。 */
export interface TableConstraint {
  name: string
  kind: ConstraintKind
  /** 制約が掛かっている列。定義した順に並ぶ。 */
  columns: string[]
  /** 検査制約の条件。`check` 以外では `null`。 */
  searchCondition: string | null
  /** 外部キーの参照先スキーマ。 */
  referencedOwner: string | null
  /** 外部キーの参照先テーブル。 */
  referencedTable: string | null
  /** 外部キーの参照先の列。`columns` と同じ順で対応する。 */
  referencedColumns: string[]
  /** 外部キーの削除規則（`CASCADE` / `SET NULL` / `NO ACTION`）。 */
  deleteRule: string | null
  /** 制約が有効か。 */
  enabled: boolean
}

/** 索引が並べている列 1 つ。 */
export interface IndexColumn {
  name: string
  /** 降順の索引列か。 */
  descending: boolean
}

/** テーブルに付いている索引 1 つ（ADR 0019）。 */
export interface TableIndex {
  name: string
  /** 索引の所有者。表と別のスキーマに作れるため、名前だけでは足りない。 */
  owner: string
  unique: boolean
  /** `NORMAL` / `BITMAP` / `FUNCTION-BASED NORMAL` など。 */
  indexType: string
  /** `VALID` / `UNUSABLE` など。 */
  status: string | null
  /**
   * 自動生成された索引か（ADR 0019）。
   *
   * ツリー（ADR 0014）では落としているが、定義ビューでは出す。主キーや
   * 一意制約の索引が見えないと「この列で引けるのか」が分からない。
   */
  generated: boolean
  /** 索引が並べている列。定義した順に並ぶ。 */
  columns: IndexColumn[]
}

/**
 * テーブル定義ビュー 1 枚ぶんの内容（ADR 0019）。
 *
 * DDL は含まない。`DBMS_METADATA.GET_DDL` は重く権限にも敏感であるため、
 * DDL タブを開いたときに `objectDdl` で別に取る。
 */
export interface ObjectDefinition {
  owner: string
  name: string
  kind: ObjectKind
  /** 列。列を持たない種別では空。 */
  columns: TableColumn[]
  /** 制約。テーブルとマテリアライズドビュー以外では空。 */
  constraints: TableConstraint[]
  /** 索引。テーブルとマテリアライズドビュー以外では空。 */
  indexes: TableIndex[]
}

/** `DBMS_METADATA.GET_DDL` で取った定義の断片 1 つ（ADR 0019）。 */
export interface DdlPart {
  /** 見出し（`パッケージ仕様` など）。 */
  label: string
  sql: string
}

/** オブジェクト 1 つの DDL（ADR 0019）。 */
export interface ObjectDdl {
  owner: string
  name: string
  kind: ObjectKind
  /** 定義の断片。パッケージだけが 2 つになる。 */
  parts: DdlPart[]
}

/**
 * 定義ビューを開く対象（ADR 0019）。
 *
 * スキーマツリーの行がそのまま指す 3 つ組である。
 */
export interface DefinitionTarget {
  owner: string
  name: string
  kind: ObjectKind
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

/**
 * `ALL_SOURCE` に本文が載る種別（ADR 0021）。
 *
 * `ObjectKind`（ADR 0014）とは別の語彙である。ツリーが落としている
 * `PACKAGE BODY` と `TYPE BODY` をここでは持つ。ソース検索では**本体こそが
 * 探し先**だからである。表・ビュー・索引はここに無い。`ALL_SOURCE` に本文を
 * 持たないためである。
 */
export type SourceKind =
  'function' | 'procedure' | 'package' | 'packageBody' | 'trigger' | 'type' | 'typeBody'

/**
 * 種別を並べる順。
 *
 * Rust 側の `SourceKind` の宣言順と同じである。絞り込みのチェックの並びでもある。
 */
export const SOURCE_KIND_ORDER: SourceKind[] = [
  'function',
  'procedure',
  'package',
  'packageBody',
  'trigger',
  'type',
  'typeBody',
]

/** 種別の表示名。当たった行の見出しと絞り込みに出す。 */
export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  function: 'ファンクション',
  procedure: 'プロシージャ',
  package: 'パッケージ',
  packageBody: 'パッケージ本体',
  trigger: 'トリガー',
  type: '型',
  typeBody: '型の本体',
}

/**
 * 検索する種別ごとの可否（ADR 0021）。
 *
 * 鍵は `SourceKind` そのものであり、Rust 側の `SourceKindFilter` の項目名と
 * 一致する。落とした種別は問い合わせにも行かない。
 */
export type SourceKindFilter = Record<SourceKind, boolean>

/** 種別の絞り込みの既定値。すべて探す。 */
export const defaultSourceKindFilter: SourceKindFilter = {
  function: true,
  procedure: true,
  package: true,
  packageBody: true,
  trigger: true,
  type: true,
  typeBody: true,
}

/**
 * 検索語の最短の長さ（文字数）。
 *
 * Rust 側の `SOURCE_SEARCH_MIN_LENGTH` と同じ値である。短い語は投げても
 * 上限まで拾って終わるだけであるため、押す前に画面でも止める。
 */
export const SOURCE_SEARCH_MIN_LENGTH = 2

/** ソース検索 1 回ぶんの求め（ADR 0021）。 */
export interface SourceSearchRequest {
  /** 探す文字列。`%` や `_` は文字そのものとして扱う。 */
  needle: string
  /** 探す先のスキーマ。`null` は「すべてのスキーマ（システムを除く）」。 */
  owner: string | null
  kinds: SourceKindFilter
  /** 大文字と小文字を区別するか。既定は偽。 */
  caseSensitive: boolean
  /** 持ち帰る当たり行数の上限。 */
  limit: number
}

/** ソースの 1 行。 */
export interface SourceLine {
  /** `ALL_SOURCE.LINE`。1 始まり。 */
  line: number
  /** 行末の改行を落とした本文。字下げはそのまま残る。 */
  text: string
}

/** 当たったオブジェクト 1 つ（ADR 0021）。 */
export interface SourceObjectMatches {
  owner: string
  name: string
  kind: SourceKind
  /** 当たった行。行番号の昇順。 */
  lines: SourceLine[]
}

/** ソース検索 1 回ぶんの結果（ADR 0021）。 */
export interface SourceSearchResult {
  objects: SourceObjectMatches[]
  /** 当たった行の総数。 */
  matchedLines: number
  /**
   * 上限に達して打ち切ったか。
   *
   * 真のときは「これで全部だ」と読ませてはならない。
   */
  truncated: boolean
}

/** 前後の行を読むときの相手（ADR 0021）。 */
export interface SourceTarget {
  owner: string
  name: string
  kind: SourceKind
}
