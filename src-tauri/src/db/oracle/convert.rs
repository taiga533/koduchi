//! Oracle の値をフロントエンドへ渡す表現へ変換する。
//!
//! 変換の要は 3 点ある（ADR の「値の受け渡し」節）。
//!
//! 1. `NUMBER` は最大 38 桁の 10 進数であり、`f64` に入れると精度が壊れる。
//!    そのため数値も**文字列のまま**取り出す。
//! 2. `CLOB` は先頭 64KB までに切り詰める。
//! 3. `BLOB` / `RAW` は内容を送らず `[BLOB 1.2 KB]` のような要約だけを送る。

use crate::db::error::{DbError, DbResult};
use crate::db::value::{
    format_binary_summary, truncate_at_char_boundary, Cell, CellKind, CLOB_LIMIT_BYTES,
};
use oracle::sql_type::OracleType;
use oracle::SqlValue;

/// Oracle の型から、結果テーブルの表示に使う種類を決める。
///
/// 数値を右寄せにする、バイナリを要約表示にする、といった出し分けに使う。
///
/// # 引数
///
/// * `oracle_type` - 列の Oracle 上の型
pub fn kind_of(oracle_type: &OracleType) -> CellKind {
    match oracle_type {
        OracleType::Number(..)
        | OracleType::Float(..)
        | OracleType::BinaryFloat
        | OracleType::BinaryDouble
        | OracleType::Int64
        | OracleType::UInt64 => CellKind::Number,

        OracleType::Date
        | OracleType::Timestamp(..)
        | OracleType::TimestampTZ(..)
        | OracleType::TimestampLTZ(..)
        | OracleType::IntervalDS(..)
        | OracleType::IntervalYM(..) => CellKind::Datetime,

        OracleType::Boolean => CellKind::Bool,

        OracleType::Raw(..) | OracleType::LongRaw | OracleType::BLOB | OracleType::BFILE => {
            CellKind::Binary
        }

        // 残りは文字列として扱う。ROWID・XML・JSON・オブジェクト型も
        // 表示上は文字列で足りる。
        _ => CellKind::Text,
    }
}

/// バイナリ型の要約に使う呼び名を返す。
///
/// `[BLOB 1.2 KB]` の `BLOB` にあたる部分。型ごとに呼び分けることで、
/// 何が入っているのか利用者に伝わる。
pub fn binary_label(oracle_type: &OracleType) -> &'static str {
    match oracle_type {
        OracleType::BLOB => "BLOB",
        OracleType::BFILE => "BFILE",
        OracleType::LongRaw => "LONG RAW",
        _ => "RAW",
    }
}

/// Oracle の値を 1 セルへ変換する。
///
/// # 引数
///
/// * `value` - 取り出す値
///
/// # 戻り値
///
/// 表示用のセル。NULL は `CellKind::Null` になり、空文字列と区別できる。
pub fn to_cell(value: &SqlValue) -> DbResult<Cell> {
    let is_null = value
        .is_null()
        .map_err(|error| DbError::execute(error.to_string()))?;
    if is_null {
        return Ok(Cell::null());
    }

    let oracle_type = value
        .oracle_type()
        .map_err(|error| DbError::execute(error.to_string()))?
        .clone();
    let kind = kind_of(&oracle_type);

    if kind == CellKind::Binary {
        let bytes: Vec<u8> = value
            .get()
            .map_err(|error| DbError::execute(error.to_string()))?;
        let summary = format_binary_summary(binary_label(&oracle_type), bytes.len() as u64);
        return Ok(Cell::new(CellKind::Binary, summary));
    }

    // 数値も日付も文字列として取り出す。NUMBER を f64 に通さないことが
    // 38 桁の精度を保つ唯一の方法である。
    let text: String = value
        .get()
        .map_err(|error| DbError::execute(error.to_string()))?;

    let text = if matches!(oracle_type, OracleType::CLOB | OracleType::NCLOB) {
        let (truncated, _) = truncate_at_char_boundary(&text, CLOB_LIMIT_BYTES);
        truncated.to_string()
    } else {
        text
    };

    Ok(Cell::new(kind, text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numberは数値として扱われる() {
        // Arrange
        let oracle_type = OracleType::Number(38, 0);

        // Act
        let kind = kind_of(&oracle_type);

        // Assert
        assert_eq!(kind, CellKind::Number);
    }

    #[test]
    fn binary_doubleは数値として扱われる() {
        // Arrange
        let oracle_type = OracleType::BinaryDouble;

        // Act
        let kind = kind_of(&oracle_type);

        // Assert
        assert_eq!(kind, CellKind::Number);
    }

    #[test]
    fn varchar2は文字列として扱われる() {
        // Arrange
        let oracle_type = OracleType::Varchar2(400);

        // Act
        let kind = kind_of(&oracle_type);

        // Assert
        assert_eq!(kind, CellKind::Text);
    }

    #[test]
    fn clobは文字列として扱われる() {
        // Arrange
        let oracle_type = OracleType::CLOB;

        // Act
        let kind = kind_of(&oracle_type);

        // Assert
        assert_eq!(kind, CellKind::Text);
    }

    #[test]
    fn timestampは日時として扱われる() {
        // Arrange
        let oracle_type = OracleType::Timestamp(6);

        // Act
        let kind = kind_of(&oracle_type);

        // Assert
        assert_eq!(kind, CellKind::Datetime);
    }

    #[test]
    fn 期間型も日時として扱われる() {
        // Arrange
        let oracle_type = OracleType::IntervalDS(3, 0);

        // Act
        let kind = kind_of(&oracle_type);

        // Assert
        assert_eq!(kind, CellKind::Datetime);
    }

    #[test]
    fn blobはバイナリとして扱われる() {
        // Arrange
        let oracle_type = OracleType::BLOB;

        // Act
        let kind = kind_of(&oracle_type);

        // Assert
        assert_eq!(kind, CellKind::Binary);
    }

    #[test]
    fn rawはバイナリとして扱われる() {
        // Arrange
        let oracle_type = OracleType::Raw(64);

        // Act
        let kind = kind_of(&oracle_type);

        // Assert
        assert_eq!(kind, CellKind::Binary);
    }

    #[test]
    fn booleanは真偽値として扱われる() {
        // Arrange
        let oracle_type = OracleType::Boolean;

        // Act
        let kind = kind_of(&oracle_type);

        // Assert
        assert_eq!(kind, CellKind::Bool);
    }

    #[test]
    fn バイナリの呼び名は型ごとに変わる() {
        // Arrange
        let types = [
            OracleType::BLOB,
            OracleType::Raw(64),
            OracleType::LongRaw,
            OracleType::BFILE,
        ];

        // Act
        let labels: Vec<&str> = types.iter().map(binary_label).collect();

        // Assert
        assert_eq!(labels, vec!["BLOB", "RAW", "LONG RAW", "BFILE"]);
    }
}
