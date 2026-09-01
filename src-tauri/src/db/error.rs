//! データベース操作のエラー。
//!
//! エラーの表示はメッセージタブのテキストのみとする方針であるため（ADR の
//! 「機能スコープ」節）、構造としては原因の区分とメッセージだけを持つ。
//! 候補の提示や自動修正のための情報は持たない。

use serde::Serialize;

/// エラーの区分。フロントエンドが表示先を選ぶのに使う。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DbErrorKind {
    /// Oracle Instant Client を読み込めない（ADR 0001）。
    ClientUnavailable,
    /// 接続を確立できない。
    Connect,
    /// SQL の実行に失敗した。
    Execute,
    /// 利用者の操作により中止された（`⌘.`）。
    Cancelled,
    /// 接続が既に閉じられている。
    Closed,
    /// 履歴や設定など、アプリ自身の保管庫の読み書きに失敗した（ADR 0005）。
    Storage,
}

/// データベース操作のエラー。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[error("{message}")]
pub struct DbError {
    pub kind: DbErrorKind,
    /// 利用者に見せるメッセージ。データベースが返した文言をそのまま含む。
    pub message: String,
}

impl DbError {
    /// 区分とメッセージを指定してエラーを作る。
    pub fn new(kind: DbErrorKind, message: impl Into<String>) -> Self {
        DbError {
            kind,
            message: message.into(),
        }
    }

    /// 接続の確立に失敗したことを表すエラーを作る。
    pub fn connect(message: impl Into<String>) -> Self {
        Self::new(DbErrorKind::Connect, message)
    }

    /// SQL の実行に失敗したことを表すエラーを作る。
    pub fn execute(message: impl Into<String>) -> Self {
        Self::new(DbErrorKind::Execute, message)
    }

    /// 接続が既に閉じられていることを表すエラーを作る。
    pub fn closed() -> Self {
        Self::new(DbErrorKind::Closed, "接続は既に閉じられています")
    }

    /// 利用者の操作で中止されたことを表すエラーを作る。
    pub fn cancelled() -> Self {
        Self::new(DbErrorKind::Cancelled, "実行を中止しました")
    }

    /// アプリ自身の保管庫の読み書きに失敗したことを表すエラーを作る。
    pub fn storage(message: impl Into<String>) -> Self {
        Self::new(DbErrorKind::Storage, message)
    }
}

/// データベース操作の結果。
pub type DbResult<T> = Result<T, DbError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn エラーはメッセージをそのまま表示する() {
        // Arrange
        let error = DbError::execute("ORA-00942: table or view does not exist");

        // Act
        let displayed = error.to_string();

        // Assert
        assert_eq!(displayed, "ORA-00942: table or view does not exist");
    }

    #[test]
    fn エラーは区分を含めてシリアライズされる() {
        // Arrange
        let error = DbError::connect("ORA-12541: TNS:no listener");

        // Act
        let json = serde_json::to_string(&error).unwrap();

        // Assert
        assert_eq!(
            json,
            r#"{"kind":"connect","message":"ORA-12541: TNS:no listener"}"#
        );
    }
}
