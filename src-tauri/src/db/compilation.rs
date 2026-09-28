//! PL/SQL のコンパイルエラーの型（ADR 0045）。
//!
//! `CREATE OR REPLACE PROCEDURE` などがコンパイルエラー付きで作られても、
//! Oracle は「警告付きで成功」（`ORA-24344`）を返すだけで、どの行が悪いかは
//! 言わない。行・桁・文言は `ALL_ERRORS` にある。ここにはデータベースに依らない
//! 型と、引く範囲の決め方だけを置き、引き方は `oracle::compilation` に置く。

use serde::Serialize;
use std::time::Duration;

/// `ALL_ERRORS.ATTRIBUTE` の区分。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DiagnosticSeverity {
    /// コンパイルエラー。オブジェクトは `INVALID` のまま残る。
    Error,
    /// `PLSQL_WARNINGS` による警告（`PLW-`）。オブジェクトは有効である。
    Warning,
}

impl DiagnosticSeverity {
    /// `ALL_ERRORS.ATTRIBUTE` の値から変換する。
    ///
    /// `WARNING` 以外はすべてエラーに倒す。知らない値を警告として扱うと、
    /// 無効なオブジェクトを「成功」と見せる向きに外れるためである（ADR 0045）。
    ///
    /// # 引数
    ///
    /// * `raw` - `ATTRIBUTE` の値
    pub fn from_attribute(raw: &str) -> Self {
        if raw == "WARNING" {
            DiagnosticSeverity::Warning
        } else {
            DiagnosticSeverity::Error
        }
    }
}

/// `ALL_ERRORS` の 1 行。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileDiagnostic {
    pub owner: String,
    pub name: String,
    /// `ALL_ERRORS.TYPE`（`PROCEDURE` / `PACKAGE BODY` など）。
    pub object_type: String,
    /// オブジェクトのソース（`ALL_SOURCE`）の上の行。エディタの行ではない。
    pub line: u32,
    /// 行の中の桁。
    pub position: u32,
    pub severity: DiagnosticSeverity,
    /// Oracle の文言そのまま（`PLS-00201: ...`）。
    pub text: String,
}

/// コンパイルの警告を受けた文の報告（ADR 0045）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompilationReport {
    /// Oracle が返した警告の原文（`ORA-24344: success with compilation error`）。
    pub warning: String,
    /// 実行の間に定義が変わったオブジェクトの `ALL_ERRORS`。
    ///
    /// 空でありうる（権限で見えないなど）。空だからといって「問題なし」と
    /// 読ませないよう、呼び出し側は `warning` と併せて扱う。
    pub diagnostics: Vec<CompileDiagnostic>,
}

/// `LAST_DDL_TIME` を遡って見る秒数（ADR 0045）。
///
/// 文を投げてから応答が返るまでの時間に 2 秒を足す。`LAST_DDL_TIME` と
/// `SYSDATE` はどちらも秒で切り捨てられた `DATE` であり、両端で 1 秒ずつ
/// 取りこぼしうるためである。データベース側の時計どうしで比べるので、
/// 手元の時計とのずれは効かない。
///
/// # 引数
///
/// * `elapsed` - 文を投げてから応答が返るまでの時間
pub fn lookback_seconds(elapsed: Duration) -> u64 {
    elapsed.as_secs() + 2
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn warningの属性は警告になる() {
        // Arrange
        let raw = "WARNING";

        // Act
        let severity = DiagnosticSeverity::from_attribute(raw);

        // Assert
        assert_eq!(severity, DiagnosticSeverity::Warning);
    }

    #[test]
    fn errorの属性はエラーになる() {
        // Arrange
        let raw = "ERROR";

        // Act
        let severity = DiagnosticSeverity::from_attribute(raw);

        // Assert
        assert_eq!(severity, DiagnosticSeverity::Error);
    }

    #[test]
    fn 知らない属性はエラーに倒す() {
        // Arrange: 警告に倒すと無効なオブジェクトを成功と見せてしまう
        let raw = "INFO";

        // Act
        let severity = DiagnosticSeverity::from_attribute(raw);

        // Assert
        assert_eq!(severity, DiagnosticSeverity::Error);
    }

    #[test]
    fn 一瞬で終わった文でも前後の切り捨てぶんを遡る() {
        // Arrange
        let elapsed = Duration::from_millis(30);

        // Act
        let seconds = lookback_seconds(elapsed);

        // Assert
        assert_eq!(seconds, 2);
    }

    #[test]
    fn 時間のかかった文はかかった秒数ぶん余計に遡る() {
        // Arrange
        let elapsed = Duration::from_millis(3_400);

        // Act
        let seconds = lookback_seconds(elapsed);

        // Assert
        assert_eq!(seconds, 5);
    }

    #[test]
    fn 報告はキャメルケースで届く() {
        // Arrange
        let report = CompilationReport {
            warning: String::from("ORA-24344: success with compilation error"),
            diagnostics: vec![CompileDiagnostic {
                owner: String::from("KODUCHI"),
                name: String::from("P"),
                object_type: String::from("PACKAGE BODY"),
                line: 3,
                position: 7,
                severity: DiagnosticSeverity::Error,
                text: String::from("PLS-00201: identifier 'NUL' must be declared"),
            }],
        };

        // Act
        let json = serde_json::to_string(&report).unwrap();

        // Assert
        assert_eq!(
            json,
            r#"{"warning":"ORA-24344: success with compilation error","diagnostics":[{"owner":"KODUCHI","name":"P","objectType":"PACKAGE BODY","line":3,"position":7,"severity":"error","text":"PLS-00201: identifier 'NUL' must be declared"}]}"#
        );
    }
}
