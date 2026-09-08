//! Oracle のエラーを区分へ写す（ADR 0017・0019・0021）。
//!
//! 「権限が無くて見えない」を「空だった」と混同させないための変換をここに
//! 集める。同じ判定を要る場所が 3 つある。
//!
//! | 引く先                  | 番号の並び              | ADR  |
//! | ----------------------- | ----------------------- | ---- |
//! | `V$SESSION`             | `PERMISSION_ERRORS`     | 0017 |
//! | `DBMS_METADATA.GET_DDL` | `DDL_PERMISSION_ERRORS` | 0019 |
//! | `ALL_SOURCE`            | `PERMISSION_ERRORS`     | 0021 |
//!
//! 最初は `oracle::sessions` の中にあったものを、2 つ目が要ったところで切り出した。
//! GET_DDL だけ番号の並びが違うため、判定する番号は引数に取る形にしてある。
//! 辞書ビューを引くだけの側（0017・0021）は `map_permission_error` を呼べばよく、
//! 番号の一覧を意識しなくてよい。
//!
//! データベースが返した原文はメッセージへそのまま残す。番号で写し替えるのは
//! 区分だけであり、文言を作り替えて事実を丸めることはしない。

use crate::db::error::DbError;

/// 権限が足りないことを示す Oracle のエラー番号。
///
/// `ORA-00942` は「表またはビューが存在しません」だが、`V$SESSION` や
/// `ALL_SOURCE` のような辞書ビューに対しては実際には参照権限が無いことを
/// 意味する。
pub const PERMISSION_ERRORS: [&str; 2] = ["ORA-00942", "ORA-01031"];

/// `DBMS_METADATA.GET_DDL` が権限不足のときに返しうる番号（ADR 0019）。
///
/// `ORA-31603` は「オブジェクトが見つかりません」だが、GET_DDL では
/// **他人のオブジェクトを見る権限が無いとき**にもこれが返る。オブジェクト名は
/// スキーマツリー（ADR 0007）が `ALL_OBJECTS` から取ってきたものであり、
/// 存在しないことはまず無い。そのため権限として扱い、案内にはその旨を書く。
pub const DDL_PERMISSION_ERRORS: [&str; 3] = ["ORA-00942", "ORA-01031", "ORA-31603"];

/// エラーの文言に、並べた番号のどれかが含まれるか。
///
/// # 引数
///
/// * `text` - データベースが返した文言
/// * `codes` - 探す番号
pub fn contains_error_code(text: &str, codes: &[&str]) -> bool {
    codes.iter().any(|code| text.contains(code))
}

/// Oracle のエラーを、権限不足なら `Permission` へ写す。
///
/// # 引数
///
/// * `context` - 何をしようとしていたか
/// * `error` - Oracle が返したエラー
/// * `hint` - 権限不足のときに添える案内
/// * `codes` - 権限不足と見なす番号
pub fn map_oracle_error(
    context: &str,
    error: &oracle::Error,
    hint: &str,
    codes: &[&str],
) -> DbError {
    let text = error.to_string();

    if contains_error_code(&text, codes) {
        return DbError::permission(format!("{context}{hint}（{text}）"));
    }

    DbError::execute(format!("{context}: {text}"))
}

/// 辞書ビューを引いたときのエラーを、権限不足なら `Permission` へ写す。
///
/// `PERMISSION_ERRORS` を当てる `map_oracle_error` の薄い包みである。
/// `V$SESSION`（ADR 0017）と `ALL_SOURCE`（ADR 0021）はどちらもこの並びで
/// 足りるため、呼び出し側が番号の一覧を持ち回らずに済む。
///
/// # 引数
///
/// * `context` - 何をしようとしていたか
/// * `error` - Oracle が返したエラー
/// * `hint` - 権限不足のときに添える案内
pub fn map_permission_error(context: &str, error: &oracle::Error, hint: &str) -> DbError {
    map_oracle_error(context, error, hint, &PERMISSION_ERRORS)
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
    fn 権限不足の番号を見分けられる() {
        // Arrange
        let text = "ORA-00942: table or view does not exist";

        // Act
        let 権限不足 = contains_error_code(text, &PERMISSION_ERRORS);

        // Assert
        assert!(権限不足);
    }

    #[test]
    fn 実行時のエラーは権限不足とは見なさない() {
        // Arrange
        let text = "ORA-00904: \"FOO\": invalid identifier";

        // Act & Assert
        assert!(!contains_error_code(text, &PERMISSION_ERRORS));
        assert!(!contains_error_code(text, &DDL_PERMISSION_ERRORS));
    }

    #[test]
    fn ddlのオブジェクト未検出は権限不足として扱う() {
        // Arrange: 名前は ALL_OBJECTS から取っている。存在しないことはまず無い
        let text = "ORA-31603: object \"ORDERS\" of type TABLE not found in schema \"KODUCHI\"";

        // Act & Assert
        assert!(contains_error_code(text, &DDL_PERMISSION_ERRORS));
        assert!(!contains_error_code(text, &PERMISSION_ERRORS));
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

    #[test]
    fn 当てる番号の並びで同じエラーの区分が変わる() {
        // Arrange: GET_DDL だけが ORA-31603 を権限として扱う（ADR 0019）
        let error =
            oracleのエラー("ORA-31603: object \"ORDERS\" of type TABLE not found in schema");

        // Act
        let ddlとして = map_oracle_error(
            "DDL を取得できません",
            &error,
            "。権限がありません",
            &DDL_PERMISSION_ERRORS,
        );
        let 辞書ビューとして =
            map_permission_error("DDL を取得できません", &error, "。権限がありません");

        // Assert
        assert_eq!(ddlとして.kind, DbErrorKind::Permission);
        assert_eq!(辞書ビューとして.kind, DbErrorKind::Execute);
    }
}
