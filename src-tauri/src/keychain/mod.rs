//! OS キーチェーンへのパスワード保存（ADR 0004）。
//!
//! 保存するのはパスワードだけである。接続設定は `config` の TOML に置き、
//! そちらにはパスワードを書かない。
//!
//! `keyring` crate の薄い包みであり、ここでの仕事はサービス名の固定と、
//! エラーをアプリのエラー型へ寄せることの 2 つに限る。

use crate::db::error::{DbError, DbErrorKind};

/// キーチェーンのサービス名。アプリ識別子と同じにする。
pub const SERVICE: &str = "ninja.taiga533.koduchi";

/// キーチェーンのエントリを開く。
///
/// アカウント名には接続の一意 ID を使う。表示名は変更されうるため使わない。
///
/// # 引数
///
/// * `connection_id` - 接続の一意 ID
fn entry(connection_id: &str) -> Result<keyring::Entry, DbError> {
    keyring::Entry::new(SERVICE, connection_id).map_err(|error| {
        DbError::new(
            DbErrorKind::Connect,
            format!("キーチェーンを開けませんでした: {error}"),
        )
    })
}

/// パスワードを保存する。
///
/// # 引数
///
/// * `connection_id` - 接続の一意 ID
/// * `password` - 保存するパスワード
pub fn save_password(connection_id: &str, password: &str) -> Result<(), DbError> {
    entry(connection_id)?
        .set_password(password)
        .map_err(|error| {
            DbError::new(
                DbErrorKind::Connect,
                format!("パスワードを保存できませんでした: {error}"),
            )
        })
}

/// パスワードを取り出す。
///
/// 保存されていなければ `None` を返す。保存し忘れと読み取り失敗を、
/// 呼び出し側が区別できるようにするためである。
///
/// # 引数
///
/// * `connection_id` - 接続の一意 ID
pub fn load_password(connection_id: &str) -> Result<Option<String>, DbError> {
    match entry(connection_id)?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(DbError::new(
            DbErrorKind::Connect,
            format!("パスワードを取り出せませんでした: {error}"),
        )),
    }
}

/// パスワードを消す。
///
/// 接続を削除したときに必ず呼ぶ。呼ばないとキーチェーンに孤児のエントリが
/// 残り続ける（ADR 0004）。保存されていなくてもエラーにはしない。
///
/// # 引数
///
/// * `connection_id` - 接続の一意 ID
pub fn delete_password(connection_id: &str) -> Result<(), DbError> {
    match entry(connection_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(DbError::new(
            DbErrorKind::Connect,
            format!("パスワードを消せませんでした: {error}"),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// キーチェーンを実際に触るテストを走らせるかどうかの環境変数。
    ///
    /// 実行すると OS のキーチェーンに書き込みが起きるうえ、環境によっては
    /// 許可のダイアログが出る。Oracle の統合テストと同じ考え方で、明示的に
    /// 指定されたときだけ走らせる（ADR 0010）。
    const ENABLE_VAR: &str = "KODUCHI_TEST_KEYCHAIN";

    fn 有効か() -> bool {
        std::env::var_os(ENABLE_VAR).is_some()
    }

    #[test]
    fn 保存したパスワードを読み戻して消せる() {
        // Arrange
        if !有効か() {
            return;
        }
        let id = "koduchi-test-connection";

        // Act
        save_password(id, "秘密のことば").unwrap();
        let loaded = load_password(id).unwrap();
        delete_password(id).unwrap();
        let after = load_password(id).unwrap();

        // Assert
        assert_eq!(loaded, Some(String::from("秘密のことば")));
        assert_eq!(after, None);
    }

    #[test]
    fn 保存されていない接続のパスワードはnoneになる() {
        // Arrange
        if !有効か() {
            return;
        }

        // Act
        let loaded = load_password("koduchi-test-missing").unwrap();

        // Assert
        assert_eq!(loaded, None);
    }

    #[test]
    fn 保存されていない接続を消してもエラーにならない() {
        // Arrange
        if !有効か() {
            return;
        }

        // Act
        let result = delete_password("koduchi-test-missing");

        // Assert
        assert!(result.is_ok());
    }
}
