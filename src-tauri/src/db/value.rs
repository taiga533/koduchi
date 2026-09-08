//! データベースの値をフロントエンドへ渡すための表現。
//!
//! すべてのセルは `{ text, kind }` の 2 つ組で送る（ADR の「値の受け渡し」節）。
//! 数値を数値型のまま送らないのは、Oracle の `NUMBER` が最大 38 桁の 10 進数で
//! あり、JSON の数値（実質 `f64`）に載せると精度が壊れるためである。
//!
//! `kind` は結果テーブルが右寄せの判定と NULL の描き分けに使う。
//!
//! 上限を超えて切り詰めた値だけは `truncated` を添える。切れたことを伝えない
//! 表示は、末尾の無い文字列を全文だと信じさせる（ADR 0021 の「黙って切り詰め
//! ない」）。

use serde::{Deserialize, Serialize};

/// CLOB を読み込む上限（バイト）。これを超えた分は切り捨てる。
pub const CLOB_LIMIT_BYTES: usize = 64 * 1024;

/// セルの値の種類。結果テーブルの表示の出し分けに使う。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CellKind {
    /// 数値。右寄せで表示する。
    Number,
    /// 文字列。左寄せで表示する。
    Text,
    /// 日付・時刻・期間。
    Datetime,
    /// 真偽値。
    Bool,
    /// バイナリ。内容は送らず `[BLOB 1.2 KB]` のような要約だけを送る。
    Binary,
    /// NULL。空文字列と区別するために独立した種類にしてある。
    Null,
}

/// 偽のときに `truncated` をシリアライズから省くための判定。
///
/// 結果セットは 1,000 行 × 列数のセルを IPC に載せる（ADR 0003）。切り詰めが
/// 起きるのは CLOB のごく一部であり、すべてのセルに `"truncated":false` を
/// 積むと無駄が大きい。省いた側は `#[serde(default)]` で偽として読める。
fn is_false(value: &bool) -> bool {
    !*value
}

/// 結果テーブルの 1 セル。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Cell {
    /// 表示に使う文字列。`kind` が `Null` のときは空文字列。
    pub text: String,
    pub kind: CellKind,
    /// 上限を超えて切り詰めた値か。
    ///
    /// `CLOB` は先頭 64KB までしか運ばない（ADR の「値の受け渡し」節）。切れて
    /// いることを伝えないと、利用者は末尾の無い文字列を全文だと信じてしまう。
    /// **打ち切ったときも黙って切り詰めない**（ADR 0021 で決めた原則）ため、
    /// 事実をセルに載せて運ぶ。切り詰めは `kind` の区分ではない（`kind` は
    /// 右寄せの判定と NULL の描き分けに使う）ので、独立した項目にしてある。
    #[serde(default, skip_serializing_if = "is_false")]
    pub truncated: bool,
}

impl Cell {
    /// NULL のセルを作る。
    pub fn null() -> Self {
        Cell {
            text: String::new(),
            kind: CellKind::Null,
            truncated: false,
        }
    }

    /// 種類と表示文字列を指定してセルを作る。
    pub fn new(kind: CellKind, text: impl Into<String>) -> Self {
        Cell {
            text: text.into(),
            kind,
            truncated: false,
        }
    }

    /// 切り詰めた値のセルを作る。
    ///
    /// `text` には切り詰めた**後**の文字列を渡す。
    pub fn new_truncated(kind: CellKind, text: impl Into<String>) -> Self {
        Cell {
            text: text.into(),
            kind,
            truncated: true,
        }
    }
}

/// バイナリ値の要約表示を組み立てる。
///
/// 内容そのものは送らず、`[BLOB 1.2 KB]` のようにサイズだけを示す。
/// 単位は 1024 進で、1KB 未満はバイト、それ以上は小数第 1 位まで表示する。
///
/// # 引数
///
/// * `label` - `BLOB` や `RAW` といった型の呼び名
/// * `len` - 値のバイト数
pub fn format_binary_summary(label: &str, len: u64) -> String {
    const KIB: u64 = 1024;
    const MIB: u64 = KIB * 1024;
    const GIB: u64 = MIB * 1024;

    let size = if len < KIB {
        format!("{len} B")
    } else if len < MIB {
        format!("{:.1} KB", len as f64 / KIB as f64)
    } else if len < GIB {
        format!("{:.1} MB", len as f64 / MIB as f64)
    } else {
        format!("{:.1} GB", len as f64 / GIB as f64)
    };

    format!("[{label} {size}]")
}

/// 文字列を指定バイト数までに切り詰める。
///
/// UTF-8 の文字境界を跨がないよう、上限を超えない最大の境界で切る。
/// 切り詰めが起きたかどうかも返す。呼び出し側はその旨を表示に添えられる。
///
/// # 引数
///
/// * `text` - 元の文字列
/// * `limit` - 残すバイト数の上限
///
/// # 戻り値
///
/// 切り詰めた文字列と、切り詰めが起きたかどうか。
pub fn truncate_at_char_boundary(text: &str, limit: usize) -> (&str, bool) {
    if text.len() <= limit {
        return (text, false);
    }

    let mut end = limit;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }

    (&text[..end], true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn バイナリの要約は_1kb未満をバイトで表示する() {
        // Arrange
        let len = 512;

        // Act
        let summary = format_binary_summary("BLOB", len);

        // Assert
        assert_eq!(summary, "[BLOB 512 B]");
    }

    #[test]
    fn バイナリの要約は_1kb以上をキロバイトで表示する() {
        // Arrange
        let len = 1229;

        // Act
        let summary = format_binary_summary("BLOB", len);

        // Assert
        assert_eq!(summary, "[BLOB 1.2 KB]");
    }

    #[test]
    fn バイナリの要約は_1mb以上をメガバイトで表示する() {
        // Arrange
        let len = 3 * 1024 * 1024 + 512 * 1024;

        // Act
        let summary = format_binary_summary("BLOB", len);

        // Assert
        assert_eq!(summary, "[BLOB 3.5 MB]");
    }

    #[test]
    fn バイナリの要約はラベルを差し替えられる() {
        // Arrange
        let len = 4;

        // Act
        let summary = format_binary_summary("RAW", len);

        // Assert
        assert_eq!(summary, "[RAW 4 B]");
    }

    #[test]
    fn 上限以下の文字列は切り詰められない() {
        // Arrange
        let text = "あいうえお";

        // Act
        let (truncated, was_truncated) = truncate_at_char_boundary(text, 64);

        // Assert
        assert_eq!(truncated, "あいうえお");
        assert!(!was_truncated);
    }

    #[test]
    fn 上限を超える文字列は文字境界で切り詰められる() {
        // Arrange: 'あ' は 3 バイトなので、上限 7 バイトでは 2 文字までしか入らない
        let text = "あいうえお";

        // Act
        let (truncated, was_truncated) = truncate_at_char_boundary(text, 7);

        // Assert
        assert_eq!(truncated, "あい");
        assert!(was_truncated);
    }

    #[test]
    fn 切り詰めの結果が空になっても文字境界は壊れない() {
        // Arrange
        let text = "あ";

        // Act
        let (truncated, was_truncated) = truncate_at_char_boundary(text, 1);

        // Assert
        assert_eq!(truncated, "");
        assert!(was_truncated);
    }

    #[test]
    fn nullのセルは空文字列と区別できる() {
        // Arrange
        let empty = Cell::new(CellKind::Text, "");

        // Act
        let null = Cell::null();

        // Assert
        assert_ne!(null, empty);
        assert_eq!(null.kind, CellKind::Null);
        assert_eq!(empty.kind, CellKind::Text);
    }

    #[test]
    fn セルはkindを小文字の文字列としてシリアライズする() {
        // Arrange
        let cell = Cell::new(CellKind::Datetime, "2026-08-30 15:04:05");

        // Act
        let json = serde_json::to_string(&cell).unwrap();

        // Assert
        assert_eq!(json, r#"{"text":"2026-08-30 15:04:05","kind":"datetime"}"#);
    }
    #[test]
    fn 切り詰めたセルは切り詰めの印を持つ() {
        // Arrange
        let text = "あい";

        // Act
        let cell = Cell::new_truncated(CellKind::Text, text);

        // Assert
        assert!(cell.truncated);
        assert_eq!(cell.text, "あい");
    }

    #[test]
    fn 切り詰めていないセルはtruncatedを送らない() {
        // Arrange
        let cell = Cell::new(CellKind::Text, "abc");

        // Act
        let json = serde_json::to_string(&cell).unwrap();

        // Assert: 大多数のセルに `"truncated":false` を積まないための省略
        assert_eq!(json, r#"{"text":"abc","kind":"text"}"#);
    }

    #[test]
    fn 切り詰めたセルはtruncatedを真として送る() {
        // Arrange
        let cell = Cell::new_truncated(CellKind::Text, "abc");

        // Act
        let json = serde_json::to_string(&cell).unwrap();

        // Assert
        assert_eq!(json, r#"{"text":"abc","kind":"text","truncated":true}"#);
    }

    #[test]
    fn truncatedを持たない古い形のjsonも読める() {
        // Arrange
        let json = r#"{"text":"abc","kind":"text"}"#;

        // Act
        let cell: Cell = serde_json::from_str(json).unwrap();

        // Assert
        assert_eq!(cell, Cell::new(CellKind::Text, "abc"));
        assert!(!cell.truncated);
    }
}
