//! Oracle のエラーを区分へ写す（ADR 0017・0019）。
//!
//! 「権限が無くて見えない」を「空だった」と混同させないための変換をここに
//! 集める。セッション一覧（ADR 0017）と `DBMS_METADATA.GET_DDL`（ADR 0019）が
//! 同じ判定を要るため、`oracle::sessions` から切り出した。
//!
//! データベースが返した原文はメッセージへそのまま残す。番号で写し替えるのは
//! 区分だけであり、文言を作り替えて事実を丸めることはしない。

use crate::db::error::DbError;

/// 権限が足りないことを示す Oracle のエラー番号。
///
/// `ORA-00942` は「表またはビューが存在しません」だが、`V$SESSION` のような
/// 辞書ビューに対しては実際には参照権限が無いことを意味する。
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
