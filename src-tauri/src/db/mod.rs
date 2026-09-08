//! データベース層。
//!
//! `driver` が上位層との境界（ADR 0002）、`actor` が接続ごとのスレッド、
//! `oracle` が Oracle 固有の実装を持つ。PostgreSQL 対応時は `driver::Driver` の
//! 別実装として追加する。

pub mod actor;
pub mod driver;
pub mod error;
pub mod oracle;
pub mod pool;
pub mod schema;
pub mod sessions;
pub mod source;
pub mod value;

use crate::db::driver::ConnectionParams;
use crate::db::error::DbResult;

/// 接続できるかだけを確かめる（接続を作成する画面の「テスト接続」）。
///
/// 接続表には載せず、1 本だけ繋いですぐ閉じる。本番の接続と同じ手順を通るため、
/// 繋いでからでないと分からない失敗 — 読み取り専用トランザクションを張れない、
/// `DBMS_OUTPUT` を有効にできない — もここで拾える。
///
/// # 引数
///
/// * `params` - 接続先とユーザー、読み取り専用の指定
///
/// # 戻り値
///
/// 繋いだ先のデータベースのバージョン（`23.9.0.0.0` のような形）。
pub fn check_connection(params: &ConnectionParams) -> DbResult<String> {
    oracle::OracleDriver::connect(params)?.server_version()
}
