//! Oracle の値をフロントエンドへ渡す表現へ変換する。
//!
//! 変換の要は 3 点ある（ADR の「値の受け渡し」節）。
//!
//! 1. `NUMBER` は最大 38 桁の 10 進数であり、`f64` に入れると精度が壊れる。
//!    そのため数値も**文字列のまま**取り出す。
//! 2. `CLOB` は先頭 64KB までに切り詰め、切り詰めたことをセルの `truncated` に
//!    残す（ADR 0021 の「黙って切り詰めない」）。
//! 3. `BLOB` / `RAW` は内容を送らず `[BLOB 1.2 KB]` のような要約だけを送る。

use crate::db::error::DbResult;
use crate::db::oracle::errors;
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
        .map_err(|error| errors::map_execute_error("", &error))?;
    if is_null {
        return Ok(Cell::null());
    }

    let oracle_type = value
        .oracle_type()
        .map_err(|error| errors::map_execute_error("", &error))?
        .clone();
    let kind = kind_of(&oracle_type);

    if kind == CellKind::Binary {
        let bytes: Vec<u8> = value
            .get()
            .map_err(|error| errors::map_execute_error("", &error))?;
        let summary = format_binary_summary(binary_label(&oracle_type), bytes.len() as u64);
        return Ok(Cell::new(CellKind::Binary, summary));
    }

    // 数値も日付も文字列として取り出す。NUMBER を f64 に通さないことが
    // 38 桁の精度を保つ唯一の方法である。
    let text: String = value
        .get()
        .map_err(|error| errors::map_execute_error("", &error))?;

    Ok(text_cell(&oracle_type, kind, text))
}

/// 取り出した文字列から 1 セルを組み立てる。
///
/// `CLOB` / `NCLOB` だけは先頭 64KB までに切り詰め、**切り詰めた事実をセルに
/// 残す**（ADR 0021 の「黙って切り詰めない」）。切れていることが届かないと、
/// 詳細パネルは末尾の無い文字列を全文の顔で出してしまう。
///
/// Oracle への接続なしに「切り詰めの真偽値を捨てていないか」を見張れるよう、
/// 純粋な関数として切り出してある。
///
/// # 引数
///
/// * `oracle_type` - 列の Oracle 上の型
/// * `kind` - 表示に使う種類
/// * `text` - 取り出した文字列
pub fn text_cell(oracle_type: &OracleType, kind: CellKind, text: String) -> Cell {
    if !matches!(oracle_type, OracleType::CLOB | OracleType::NCLOB) {
        return Cell::new(kind, text);
    }

    let (head, was_truncated) = truncate_at_char_boundary(&text, CLOB_LIMIT_BYTES);
    if was_truncated {
        Cell::new_truncated(kind, head)
    } else {
        Cell::new(kind, text)
    }
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
    /// 上限を 1 バイト超える CLOB の本文を作る。
    fn 上限を超える本文() -> String {
        "a".repeat(CLOB_LIMIT_BYTES + 1)
    }

    #[test]
    fn 上限を超えるclobは切り詰めたことをセルに残す() {
        // Arrange
        let text = 上限を超える本文();

        // Act
        let cell = text_cell(&OracleType::CLOB, CellKind::Text, text);

        // Assert
        assert!(cell.truncated);
        assert_eq!(cell.text.len(), CLOB_LIMIT_BYTES);
    }

    #[test]
    fn 上限以下のclobには切り詰めの印を付けない() {
        // Arrange
        let text = String::from("{\"id\":1}");

        // Act
        let cell = text_cell(&OracleType::CLOB, CellKind::Text, text.clone());

        // Assert
        assert!(!cell.truncated);
        assert_eq!(cell.text, text);
    }

    #[test]
    fn nclobも同じように切り詰めの印が付く() {
        // Arrange
        let text = 上限を超える本文();

        // Act
        let cell = text_cell(&OracleType::NCLOB, CellKind::Text, text);

        // Assert
        assert!(cell.truncated);
    }

    #[test]
    fn clob以外は上限を超えても切り詰めない() {
        // Arrange: LONG は CLOB と違い上限を掛けていない
        let text = 上限を超える本文();
        let 長さ = text.len();

        // Act
        let cell = text_cell(&OracleType::Long, CellKind::Text, text);

        // Assert
        assert!(!cell.truncated);
        assert_eq!(cell.text.len(), 長さ);
    }

    #[test]
    fn clobのセルは切り詰めの印と本文の長さが食い違わない() {
        // Arrange: 上限の前後をまたぐ長さを並べる。この不変条件が崩れていたのが
        // 「切り詰めの真偽値を `_` で捨てていた」不具合の正体である。
        let 長さの候補 = [
            0,
            1,
            CLOB_LIMIT_BYTES - 1,
            CLOB_LIMIT_BYTES,
            CLOB_LIMIT_BYTES + 1,
            CLOB_LIMIT_BYTES * 2,
        ];

        for 長さ in 長さの候補 {
            let text = "a".repeat(長さ);

            // Act
            let cell = text_cell(&OracleType::CLOB, CellKind::Text, text.clone());

            // Assert: 本文が短くなったときは必ず印が立ち、立っていないときは
            // 本文がそのまま残っている
            assert_eq!(
                cell.truncated,
                cell.text.len() < text.len(),
                "長さ {長さ} のとき、切り詰めの印と本文の長さが食い違った"
            );
        }
    }

    #[test]
    fn マルチバイトのclobは文字境界で切り詰めても印が立つ() {
        // Arrange: 'あ' は 3 バイトで、上限は 3 の倍数ではない
        let text = "あ".repeat(CLOB_LIMIT_BYTES);

        // Act
        let cell = text_cell(&OracleType::CLOB, CellKind::Text, text);

        // Assert
        assert!(cell.truncated);
        assert!(cell.text.len() <= CLOB_LIMIT_BYTES);
        assert!(cell.text.chars().all(|c| c == 'あ'));
    }
}
