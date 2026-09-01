//! データベース抽象化の境界（ADR 0002）。
//!
//! 上位層（Tauri コマンド・履歴記録・CSV 書き出し）をデータベース非依存に保つ
//! ための狭い trait を定義する。Oracle 固有の概念 — `DBMS_OUTPUT` の取得、
//! tnsnames.ora の解決、Instant Client の検出 — は trait の外に置き、Oracle
//! モジュールへ閉じ込める。
//!
//! 実装が 1 つしかない段階で広い trait を定義すると境界を必ず外すため、
//! 実装済みの操作だけを載せている。

use crate::db::error::DbResult;
use crate::db::schema::{SchemaFilter, SchemaNode, TableColumn};
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
    },
    /// 問い合わせ以外（DML・DDL・PL/SQL ブロック）。
    #[serde(rename_all = "camelCase")]
    Statement {
        affected_rows: u64,
        elapsed_ms: u64,
        notices: Vec<String>,
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
    /// * `chunk_size` - 一度に取り出す行数
    fn execute(&mut self, sql: &str, chunk_size: usize) -> DbResult<ExecuteOutcome>;

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
    fn explain_plan(&mut self, sql: &str) -> DbResult<String>;

    /// 実測付きの実行計画をテキストで返す（`⇧⌘E`）。
    ///
    /// SQL を実際に最後まで実行する。副作用のある文ではその副作用が起きるため、
    /// 呼び出し側は `SELECT` 以外に対して事前に確認を取る。
    ///
    /// # 引数
    ///
    /// * `sql` - 計画を見たい SQL
    fn actual_plan(&mut self, sql: &str) -> DbResult<String>;
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
    fn 問い合わせ以外の結果は影響行数を持つ() {
        // Arrange
        let notices = vec![String::from("小槌からの通知")];

        // Act
        let outcome = ExecuteOutcome::Statement {
            affected_rows: 3,
            elapsed_ms: 12,
            notices: notices.clone(),
        };

        // Assert
        match outcome {
            ExecuteOutcome::Statement {
                affected_rows,
                notices: got,
                ..
            } => {
                assert_eq!(affected_rows, 3);
                assert_eq!(got, notices);
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
        };

        // Act
        let json = serde_json::to_string(&outcome).unwrap();

        // Assert
        assert_eq!(
            json,
            r#"{"kind":"statement","affectedRows":3,"elapsedMs":12,"notices":[]}"#
        );
    }
}
