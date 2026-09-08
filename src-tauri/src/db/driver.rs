//! データベース抽象化の境界（ADR 0002）。
//!
//! 上位層（Tauri コマンド・履歴記録・CSV 書き出し）をデータベース非依存に保つ
//! ための狭い trait を定義する。Oracle 固有の概念 — `DBMS_OUTPUT` の取得、
//! tnsnames.ora の解決、Instant Client の検出 — は trait の外に置き、Oracle
//! モジュールへ閉じ込める。
//!
//! 実装が 1 つしかない段階で広い trait を定義すると境界を必ず外すため、
//! 実装済みの操作だけを載せている。

use crate::db::definition::{ObjectDdl, ObjectDefinition};
use crate::db::error::DbResult;
use crate::db::schema::{ObjectKind, SchemaFilter, SchemaNode, TableColumn};
use crate::db::sessions::SessionOverview;
use crate::db::source::{SourceLine, SourceSearchRequest, SourceSearchResult, SourceTarget};
use crate::db::value::{Cell, CellKind};
use serde::{Deserialize, Serialize};

/// 接続先の指定方法（ADR 0006）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "method", rename_all = "camelCase")]
pub enum ConnectTarget {
    /// `host:port/service_name` の形式。
    #[serde(rename_all = "camelCase")]
    EzConnect {
        host: String,
        port: u16,
        service_name: String,
    },
    /// tnsnames.ora から解決した接続記述子をそのまま渡す形式。
    ///
    /// エイリアス名ではなく記述子を持つのは、ODPI-C の `TNS_ADMIN` が
    /// プロセス 1 回きりでしか設定できないためである（ADR 0006）。
    #[serde(rename_all = "camelCase")]
    Descriptor { descriptor: String },
}

impl ConnectTarget {
    /// `oracle` crate に渡す接続文字列を組み立てる。
    pub fn to_connect_string(&self) -> String {
        match self {
            ConnectTarget::EzConnect {
                host,
                port,
                service_name,
            } => format!("{host}:{port}/{service_name}"),
            ConnectTarget::Descriptor { descriptor } => descriptor.clone(),
        }
    }
}

/// 接続に必要な情報。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionParams {
    pub username: String,
    pub password: String,
    pub target: ConnectTarget,
    /// 読み取り専用で接続するか（ADR 0004）。
    ///
    /// クライアント側の SQL 判定ではなく、データベース側のトランザクションで
    /// 保証する。`WITH ... INSERT` や無名 PL/SQL ブロックをすり抜けないため。
    #[serde(default)]
    pub read_only: bool,
    /// 実行のたびに自動でコミットするか（ADR 0012）。
    ///
    /// 既定は偽（手動コミット）。Oracle クライアントの慣習に合わせ、誤爆した
    /// ときに取り返せるほうを既定にしてある。読み取り専用のときは意味を持たない。
    #[serde(default)]
    pub auto_commit: bool,
}

/// バインド変数へ与える型（ADR 0016）。
///
/// 値そのものは常に文字列で受け取り、この区分に従って Oracle の型へ変換して
/// バインドする。変換に失敗したら実行せずにエラーを返す。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BindKind {
    /// 文字列。既定であり、型を選ばなかったときはこれになる。
    #[default]
    Varchar2,
    /// 数値。桁を落とさないよう、文字列のまま `NUMBER` として渡す。
    Number,
    /// 日付。秒までを持つ。
    Date,
    /// タイムスタンプ。小数秒まで持てる。
    Timestamp,
}

impl BindKind {
    /// エラーメッセージに出す Oracle 側の型名を返す。
    pub fn type_name(self) -> &'static str {
        match self {
            BindKind::Varchar2 => "VARCHAR2",
            BindKind::Number => "NUMBER",
            BindKind::Date => "DATE",
            BindKind::Timestamp => "TIMESTAMP",
        }
    }
}

/// バインド変数 1 つ。名前・型・値の 3 つ組（ADR 0016）。
///
/// 値は常に文字列として受け取り、`kind` に従って Oracle の型へ変換する。
/// `value` が `None` なら型に関わらず NULL としてバインドする。
///
/// 名前に前置きの `:` は含めない。`serde` では
/// `{"name":"id","kind":"number","value":"42"}` の形で届く。`kind` を省いた
/// 古い形は `varchar2` として読む。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bind {
    pub name: String,
    #[serde(default)]
    pub kind: BindKind,
    #[serde(default)]
    pub value: Option<String>,
}

impl Bind {
    /// 名前・型・値を指定してバインド変数を作る。
    ///
    /// # 引数
    ///
    /// * `name` - 変数名（`:` は含めない）
    /// * `kind` - 与える型
    /// * `value` - 値。`None` は NULL
    pub fn new(name: impl Into<String>, kind: BindKind, value: Option<String>) -> Self {
        Bind {
            name: name.into(),
            kind,
            value,
        }
    }

    /// 文字列として渡すバインド変数を作る。
    ///
    /// # 引数
    ///
    /// * `name` - 変数名（`:` は含めない）
    /// * `value` - 値。`None` は NULL
    pub fn text(name: impl Into<String>, value: Option<&str>) -> Self {
        Self::new(name, BindKind::Varchar2, value.map(String::from))
    }
}

/// 結果セットの列。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    pub name: String,
    /// `NUMBER(12,2)` のようなデータベース上の型名。
    pub type_name: String,
    /// 列全体の既定の寄せ方を決めるための種類。
    pub kind: CellKind,
}

/// カーソルから一度に取り出した行のかたまり（ADR 0003）。
///
/// 数十万行を一括で IPC に載せると数百 MB の JSON がメインスレッドを固めるため、
/// 結果セットは開いたまま保持し、必要になった分だけ取り出す。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Chunk {
    pub rows: Vec<Vec<Cell>>,
    /// カーソルが尽きたか。
    ///
    /// 真になるまで総行数は分からない。行数の表示が 2 段階に分かれるのは
    /// このためである（取得中は「1,000 行 読み込み済み」、尽きた時点で
    /// 「142 行 · 84 ms」）。
    pub exhausted: bool,
}

/// SQL を 1 文実行した結果。
///
/// 問い合わせかどうかで返るものが違う。問い合わせでは最初のかたまりと列が、
/// それ以外では影響行数が返る。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ExecuteOutcome {
    /// 問い合わせ。カーソルは開いたまま保持される。
    #[serde(rename_all = "camelCase")]
    Query {
        columns: Vec<Column>,
        chunk: Chunk,
        elapsed_ms: u64,
        notices: Vec<String>,
        /// 未コミットのトランザクションが残っているか（ADR 0012）。
        ///
        /// クライアント側で DML を数えるのではなく、実行のたびにデータベースへ
        /// 聞いた結果である。`WITH ... INSERT` や無名 PL/SQL ブロックを
        /// すり抜けないため。
        in_transaction: bool,
    },
    /// 問い合わせ以外（DML・DDL・PL/SQL ブロック）。
    #[serde(rename_all = "camelCase")]
    Statement {
        affected_rows: u64,
        elapsed_ms: u64,
        notices: Vec<String>,
        /// 未コミットのトランザクションが残っているか（ADR 0012）。
        in_transaction: bool,
    },
}

/// 実行中の文を外部から中止するための手綱。
///
/// 実行はアクタースレッドを塞ぐため、中止は別のスレッドから呼ぶ必要がある
/// （ADR 0002）。そのため `Send + Sync` を要求する。
pub trait Canceller: Send + Sync + 'static {
    /// 実行中の文を中止する。
    fn cancel(&self) -> DbResult<()>;
}

/// データベース接続 1 本ぶんの操作。
///
/// 実装はアクタースレッド上でのみ触られる。接続の確立自体もそのスレッド上で
/// 行うため、実装型がスレッドをまたぐことはない。
pub trait Driver: 'static {
    /// 実行中の文を中止するための手綱を取り出す。
    ///
    /// 返された値は実行中の別スレッドから使われる。
    fn canceller(&self) -> Box<dyn Canceller>;

    /// SQL を 1 文実行する。
    ///
    /// 問い合わせの場合はカーソルを開いたままにし、最初のかたまりだけを返す。
    /// 既に開いているカーソルがあれば、実行の前に閉じる。
    ///
    /// # 引数
    ///
    /// * `sql` - 実行する SQL。末尾のセミコロンは含まない
    /// * `binds` - SQL 中のバインド変数へ与える値
    /// * `chunk_size` - 一度に取り出す行数
    fn execute(&mut self, sql: &str, binds: &[Bind], chunk_size: usize)
        -> DbResult<ExecuteOutcome>;

    /// 開いているカーソルから続きを取り出す。
    ///
    /// カーソルが開いていない場合や既に尽きている場合は、空のかたまりを返す。
    ///
    /// # 引数
    ///
    /// * `chunk_size` - 一度に取り出す行数
    fn fetch_more(&mut self, chunk_size: usize) -> DbResult<Chunk>;

    /// 開いているカーソルを閉じる。
    ///
    /// 長く開いたままのカーソルはデータベース側の資源を握り続けるため、
    /// 不要になった時点で明示的に閉じる（ADR 0003）。
    fn close_cursor(&mut self) -> DbResult<()>;

    /// スキーマツリーの段階 1 を取る（ADR 0007）。
    ///
    /// スキーマ名・オブジェクト数・オブジェクト名まで。列情報は含まない。
    ///
    /// # 引数
    ///
    /// * `filter` - 絞り込み条件
    fn schema_overview(&mut self, filter: &SchemaFilter) -> DbResult<Vec<SchemaNode>>;

    /// スキーマ 1 つぶんの列情報を取る（ADR 0007 の段階 2）。
    ///
    /// スキーマごとに分けるのは、進捗を出しながら少しずつ流し込むためである。
    ///
    /// # 引数
    ///
    /// * `owner` - 対象のスキーマ名
    fn schema_columns(&mut self, owner: &str) -> DbResult<Vec<TableColumn>>;

    /// 見積りだけの実行計画をテキストで返す（`⌘E`）。
    ///
    /// SQL は実行しない。
    ///
    /// # 引数
    ///
    /// * `sql` - 計画を見たい SQL
    /// * `binds` - SQL 中のバインド変数へ与える値
    fn explain_plan(&mut self, sql: &str, binds: &[Bind]) -> DbResult<String>;

    /// トランザクションをコミットする（`⌥⌘C`、ADR 0012）。
    ///
    /// 未コミットの変更が無いときに呼んでも害は無い。
    fn commit(&mut self) -> DbResult<()>;

    /// トランザクションをロールバックする（`⌥⌘R`、ADR 0012）。
    ///
    /// 未コミットの変更が無いときに呼んでも害は無い。
    fn rollback(&mut self) -> DbResult<()>;

    /// 実測付きの実行計画をテキストで返す（`⇧⌘E`）。
    ///
    /// SQL を実際に最後まで実行する。副作用のある文ではその副作用が起きるため、
    /// 呼び出し側は `SELECT` 以外に対して事前に確認を取る。
    ///
    /// # 引数
    ///
    /// * `sql` - 計画を見たい SQL
    /// * `binds` - SQL 中のバインド変数へ与える値
    fn actual_plan(&mut self, sql: &str, binds: &[Bind]) -> DbResult<String>;

    /// テーブル定義ビュー 1 枚ぶんの内容を取る（ADR 0019）。
    ///
    /// 列・制約・索引をまとめて返す。DDL は含まない。
    /// `DBMS_METADATA.GET_DDL` は重く権限にも敏感であるため、DDL タブを開いた
    /// ときに `object_ddl` で別に取る。定義ビュー全体が DDL の権限不足で
    /// 開けなくなるのを避けるためである。
    ///
    /// 結果セットのカーソルは開かない。利用者が見ている結果は壊れない。
    ///
    /// # 引数
    ///
    /// * `owner` - 所有者のスキーマ名
    /// * `name` - オブジェクト名
    /// * `kind` - オブジェクトの種類
    fn object_definition(
        &mut self,
        owner: &str,
        name: &str,
        kind: ObjectKind,
    ) -> DbResult<ObjectDefinition>;

    /// オブジェクト 1 つの DDL を取る（ADR 0019）。
    ///
    /// パッケージは仕様と本体の 2 つを返す。権限が無い場合は
    /// `DbErrorKind::Permission` のエラーを返す。空の定義を返してはならない。
    /// 「見えない」と「定義が空」は別物である。
    ///
    /// # 引数
    ///
    /// * `owner` - 所有者のスキーマ名
    /// * `name` - オブジェクト名
    /// * `kind` - オブジェクトの種類
    fn object_ddl(&mut self, owner: &str, name: &str, kind: ObjectKind) -> DbResult<ObjectDdl>;

    /// セッションの一覧とブロッキングの連鎖を取る（ADR 0017）。
    ///
    /// 結果セットのカーソルは開かない。利用者が見ている結果は壊れない。
    /// 参照権限が無い場合は `DbErrorKind::Permission` のエラーを返す。空の
    /// 一覧を返してはならない。「見えない」と「居ない」は別物である。
    fn list_sessions(&mut self) -> DbResult<SessionOverview>;

    /// セッションを 1 つ終了する（ADR 0017）。
    ///
    /// 読み取り専用の接続と、小槌自身が張っている接続は実装側が弾く。
    /// `ALTER SYSTEM KILL SESSION` はデータを書かないため、読み取り専用
    /// トランザクション（ADR 0004）では止まらないからである。
    ///
    /// # 引数
    ///
    /// * `sid` - 対象の `SID`
    /// * `serial` - 対象の `SERIAL#`。`SID` は使い回されるため両方が要る
    fn kill_session(&mut self, sid: u32, serial: u32) -> DbResult<()>;

    /// オブジェクトのソースを横断して検索する（ADR 0021）。
    ///
    /// 結果セットのカーソルは開かない。利用者が見ている結果は壊れない。
    /// 参照権限が無い場合は `DbErrorKind::Permission` のエラーを返す。空の
    /// 結果を返してはならない。「見えない」と「無い」は別物である。
    ///
    /// 当たり行数には必ず上限を置く。探し先は数十万〜数百万行になりうる。
    ///
    /// # 引数
    ///
    /// * `request` - 検索の求め
    fn search_source(&mut self, request: &SourceSearchRequest) -> DbResult<SourceSearchResult>;

    /// 当たった行の前後を読む（ADR 0021）。
    ///
    /// 当たった行だけでは「その名前をどう使っているのか」が読めない。全文では
    /// なく前後だけを読むのは、数千行のパッケージ本体でも持ち帰る量を一定に
    /// 保つためである。
    ///
    /// # 引数
    ///
    /// * `target` - 読むオブジェクト
    /// * `line` - 中心にする行
    fn source_context(&mut self, target: &SourceTarget, line: u32) -> DbResult<Vec<SourceLine>>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ezconnectの接続文字列はホストとポートとサービス名を繋いだ形になる() {
        // Arrange
        let target = ConnectTarget::EzConnect {
            host: String::from("localhost"),
            port: 1521,
            service_name: String::from("FREEPDB1"),
        };

        // Act
        let connect_string = target.to_connect_string();

        // Assert
        assert_eq!(connect_string, "localhost:1521/FREEPDB1");
    }

    #[test]
    fn 接続記述子はそのまま接続文字列になる() {
        // Arrange
        let descriptor = "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=db)(PORT=1521)))";
        let target = ConnectTarget::Descriptor {
            descriptor: String::from(descriptor),
        };

        // Act
        let connect_string = target.to_connect_string();

        // Assert
        assert_eq!(connect_string, descriptor);
    }

    #[test]
    fn 読み取り専用フラグは省略すると偽になる() {
        // Arrange
        let json = r#"{
            "username": "koduchi",
            "password": "koduchi_dev",
            "target": { "method": "ezConnect", "host": "localhost", "port": 1521, "serviceName": "FREEPDB1" }
        }"#;

        // Act
        let params: ConnectionParams = serde_json::from_str(json).unwrap();

        // Assert
        assert!(!params.read_only);
        assert_eq!(params.target.to_connect_string(), "localhost:1521/FREEPDB1");
    }

    #[test]
    fn 自動コミットは省略すると偽になる() {
        // Arrange: 既定は手動コミットである（ADR 0012）
        let json = r#"{
            "username": "koduchi",
            "password": "koduchi_dev",
            "target": { "method": "ezConnect", "host": "localhost", "port": 1521, "serviceName": "FREEPDB1" }
        }"#;

        // Act
        let params: ConnectionParams = serde_json::from_str(json).unwrap();

        // Assert
        assert!(!params.auto_commit);
    }

    #[test]
    fn 自動コミットは接続情報から読み取れる() {
        // Arrange
        let json = r#"{
            "username": "koduchi",
            "password": "koduchi_dev",
            "autoCommit": true,
            "target": { "method": "ezConnect", "host": "localhost", "port": 1521, "serviceName": "FREEPDB1" }
        }"#;

        // Act
        let params: ConnectionParams = serde_json::from_str(json).unwrap();

        // Assert
        assert!(params.auto_commit);
    }

    #[test]
    fn バインド変数は名前と型と値の組として届く() {
        // Arrange
        let json = r#"[
            { "name": "id", "kind": "number", "value": "42" },
            { "name": "memo", "kind": "varchar2", "value": null }
        ]"#;

        // Act
        let binds: Vec<Bind> = serde_json::from_str(json).unwrap();

        // Assert
        assert_eq!(
            binds[0],
            Bind::new("id", BindKind::Number, Some("42".into()))
        );
        assert_eq!(binds[1], Bind::text("memo", None));
    }

    #[test]
    fn 型を省いたバインド変数は文字列として読まれる() {
        // Arrange: 型の欄を持たない古い呼び出しでも読めるようにしてある
        let json = r#"[{ "name": "id", "value": "42" }]"#;

        // Act
        let binds: Vec<Bind> = serde_json::from_str(json).unwrap();

        // Assert
        assert_eq!(binds[0].kind, BindKind::Varchar2);
    }

    #[test]
    fn 日付とタイムスタンプの型はキャメルケースの名前で届く() {
        // Arrange
        let json = r#"[
            { "name": "from", "kind": "date", "value": "2024-01-02" },
            { "name": "to", "kind": "timestamp", "value": "2024-01-02 03:04:05" }
        ]"#;

        // Act
        let binds: Vec<Bind> = serde_json::from_str(json).unwrap();

        // Assert
        assert_eq!(binds[0].kind, BindKind::Date);
        assert_eq!(binds[1].kind, BindKind::Timestamp);
    }

    #[test]
    fn 問い合わせ以外の結果は影響行数を持つ() {
        // Arrange
        let notices = vec![String::from("小槌からの通知")];

        // Act
        let outcome = ExecuteOutcome::Statement {
            affected_rows: 3,
            elapsed_ms: 12,
            notices: notices.clone(),
            in_transaction: true,
        };

        // Assert
        match outcome {
            ExecuteOutcome::Statement {
                affected_rows,
                notices: got,
                in_transaction,
                ..
            } => {
                assert_eq!(affected_rows, 3);
                assert_eq!(got, notices);
                assert!(in_transaction);
            }
            _ => panic!("問い合わせ以外の結果になるはず"),
        }
    }

    #[test]
    fn 実行結果は種別つきでシリアライズされる() {
        // Arrange
        let outcome = ExecuteOutcome::Statement {
            affected_rows: 3,
            elapsed_ms: 12,
            notices: Vec::new(),
            in_transaction: false,
        };

        // Act
        let json = serde_json::to_string(&outcome).unwrap();

        // Assert
        assert_eq!(
            json,
            r#"{"kind":"statement","affectedRows":3,"elapsedMs":12,"notices":[],"inTransaction":false}"#
        );
    }
}
