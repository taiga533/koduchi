//! PL/SQL のコンパイルエラーの型（ADR 0045）。
//!
//! `CREATE OR REPLACE PROCEDURE` などがコンパイルエラー付きで作られても、
//! Oracle は「警告付きで成功」（`ORA-24344`）を返すだけで、どの行が悪いかは
//! 言わない。行・桁・文言は `ALL_ERRORS` にある。ここにはデータベースに依らない
//! 型と、引く範囲の決め方だけを置き、引き方は `oracle::compilation` に置く。

use crate::db::error::{DbError, DbErrorKind, DbResult};
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
    /// 空でありうる（見えない・読めなかったなど）。空だからといって「問題なし」と
    /// 読ませないよう、呼び出し側は `warning` と併せて扱う。
    pub diagnostics: Vec<CompileDiagnostic>,
    /// `ALL_ERRORS` を読めなかったときの理由。読めたときは `None`。
    pub lookup_error: Option<String>,
}

impl CompilationReport {
    /// `ALL_ERRORS` を引いた結末から報告を組み立てる（ADR 0045）。
    ///
    /// **読めなくても文の結果は成功（警告付き）のまま返す。**文は既に走り切り、
    /// DDL なら暗黙にコミットも済んでいる。ここでエラーにすると、未コミットの表示と
    /// `DBMS_OUTPUT` の通知が捨てられ、「作れていない」と誤解させる。`⌘.` の中止
    /// （`ORA-01013`）が報告の取得に当たったときなどに起きる。
    ///
    /// **接続断だけはエラーのまま返す。**断を報告の中へ畳むと、フロント側の見張り
    /// （ADR 0026）に届かず、切れたことに気付けない。
    ///
    /// # 引数
    ///
    /// * `warning` - Oracle が返した警告の原文
    /// * `lookup` - `ALL_ERRORS` を引いた結末。エラーは写し替え（ADR 0030）を通したもの
    pub fn settle(warning: String, lookup: DbResult<Vec<CompileDiagnostic>>) -> DbResult<Self> {
        match lookup {
            Ok(diagnostics) => Ok(CompilationReport {
                warning,
                diagnostics,
                lookup_error: None,
            }),
            Err(error) if error.kind == DbErrorKind::ConnectionLost => Err(error),
            Err(DbError { message, .. }) => Ok(CompilationReport {
                warning,
                diagnostics: Vec::new(),
                lookup_error: Some(message),
            }),
        }
    }
}

/// `LAST_DDL_TIME` を遡って見る秒数（ADR 0045）。
///
/// 起点は辞書の中でいちばん新しい `LAST_DDL_TIME` であり、`SYSDATE` ではない
/// （`SYSDATE` は構成によって辞書と別の時計を指す）。今しがたコンパイルした
/// オブジェクトは、起点から「文を投げてから応答までの時間」より昔にはならない。
/// そこへ 2 秒を足すのは、`LAST_DDL_TIME` が秒で切り捨てられた `DATE` であり、
/// 両端で 1 秒ずつ取りこぼしうるためである。
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

    fn 診断の見本() -> CompileDiagnostic {
        CompileDiagnostic {
            owner: String::from("KODUCHI"),
            name: String::from("P"),
            object_type: String::from("PROCEDURE"),
            line: 3,
            position: 7,
            severity: DiagnosticSeverity::Error,
            text: String::from("PLS-00201: identifier 'NUL' must be declared"),
        }
    }

    const 警告: &str = "ORA-24344: success with compilation error";

    #[test]
    fn 読めた診断はそのまま報告に載る() {
        // Arrange
        let lookup = Ok(vec![診断の見本()]);

        // Act
        let report = CompilationReport::settle(String::from(警告), lookup).unwrap();

        // Assert
        assert_eq!(report.diagnostics, vec![診断の見本()]);
        assert_eq!(report.lookup_error, None);
    }

    #[test]
    fn 読めなかったときは文を成功のまま理由を報告に添える() {
        // Arrange: 報告の取得に `⌘.` の中止が当たった
        let lookup = Err(DbError::execute(
            "コンパイルエラーの内容を読めませんでした: ORA-01013: user requested cancel",
        ));

        // Act
        let report = CompilationReport::settle(String::from(警告), lookup).unwrap();

        // Assert
        assert!(report.diagnostics.is_empty());
        assert_eq!(report.warning, 警告);
        assert_eq!(
            report.lookup_error.as_deref(),
            Some("コンパイルエラーの内容を読めませんでした: ORA-01013: user requested cancel")
        );
    }

    #[test]
    fn 権限で読めなかったときも文を成功のまま返す() {
        // Arrange
        let lookup = Err(DbError::permission("ORA-01031: insufficient privileges"));

        // Act
        let report = CompilationReport::settle(String::from(警告), lookup).unwrap();

        // Assert
        assert!(report.lookup_error.is_some());
    }

    #[test]
    fn 接続断は報告に畳まずエラーのまま返す() {
        // Arrange: 畳むとフロント側の断の見張りに届かない（ADR 0026）
        let lookup = Err(DbError::connection_lost("ORA-03113: end-of-file"));

        // Act
        let result = CompilationReport::settle(String::from(警告), lookup);

        // Assert
        assert_eq!(result.unwrap_err().kind, DbErrorKind::ConnectionLost);
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
            lookup_error: None,
        };

        // Act
        let json = serde_json::to_string(&report).unwrap();

        // Assert
        assert_eq!(
            json,
            r#"{"warning":"ORA-24344: success with compilation error","diagnostics":[{"owner":"KODUCHI","name":"P","objectType":"PACKAGE BODY","line":3,"position":7,"severity":"error","text":"PLS-00201: identifier 'NUL' must be declared"}],"lookupError":null}"#
        );
    }
}
