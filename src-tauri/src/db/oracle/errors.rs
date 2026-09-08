//! Oracle のエラーを小槌の区分へ写す（ADR 0017・0021）。
//!
//! 辞書ビュー（`V$SESSION` / `ALL_SOURCE`）は参照権限を要する。権限が無い接続で
//! 引くと `ORA-00942` になるが、これを素の実行エラーとして流すと、画面には
//! 「取れなかった」としか出ない。**「権限が無くて見えない」を「空だった」と
//! 混同させない**ため、権限不足だけは `DbErrorKind::Permission` へ写す。

use crate::db::error::DbError;

/// 権限が足りないことを示す Oracle のエラー番号。
///
/// `ORA-00942` は「表またはビューが存在しません」だが、辞書ビューに対しては
/// 実際には参照権限が無いことを意味する。
const PERMISSION_ERRORS: [&str; 2] = ["ORA-00942", "ORA-01031"];

/// Oracle のエラーを、権限不足なら `Permission` へ写す。
///
/// データベースが返した原文はどちらの区分でもそのまま残す。利用者が Oracle の
/// 文書を引けるようにするためである。
///
/// # 引数
///
/// * `context` - 何をしようとしていたか
/// * `error` - Oracle が返したエラー
/// * `hint` - 権限不足のときに添える案内
pub fn map_permission_error(context: &str, error: &oracle::Error, hint: &str) -> DbError {
    let text = error.to_string();

    if PERMISSION_ERRORS.iter().any(|code| text.contains(code)) {
        return DbError::permission(format!("{context}{hint}（{text}）"));
    }

    DbError::execute(format!("{context}: {text}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::error::DbErrorKind;

    /// Oracle のエラーを組み立てる。
    ///
    /// 実際に届くのはドライバが作ったエラーだが、判定が見るのは文言だけである。
    /// 番号を含む文言を載せたエラーで代用する。
    ///
    /// # 引数
    ///
    /// * `message` - エラーの文言
    fn oracleのエラー(message: &str) -> oracle::Error {
        oracle::Error::new(oracle::ErrorKind::OciError, String::from(message))
    }

    #[test]
    fn 表が見えないエラーは権限不足として扱われる() {
        // Arrange
        let error = oracleのエラー("ORA-00942: table or view does not exist");

        // Act
        let mapped =
            map_permission_error("ALL_SOURCE を参照できません", &error, "。権限がありません");

        // Assert
        assert_eq!(mapped.kind, DbErrorKind::Permission);
        assert!(mapped.message.contains("権限がありません"));
        assert!(mapped.message.contains("ORA-00942"));
    }

    #[test]
    fn 権限不足のエラーも同じ区分になる() {
        // Arrange
        let error = oracleのエラー("ORA-01031: insufficient privileges");

        // Act
        let mapped = map_permission_error("読めません", &error, "。権限がありません");

        // Assert
        assert_eq!(mapped.kind, DbErrorKind::Permission);
    }

    #[test]
    fn 権限と関わらないエラーは実行エラーのままである() {
        // Arrange: 「見えない」と「失敗した」を取り違えないこと
        let error = oracleのエラー("ORA-00933: SQL command not properly ended");

        // Act
        let mapped = map_permission_error("読めません", &error, "。権限がありません");

        // Assert
        assert_eq!(mapped.kind, DbErrorKind::Execute);
        assert!(mapped.message.contains("ORA-00933"));
    }
}
