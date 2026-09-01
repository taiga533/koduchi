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
pub mod value;
