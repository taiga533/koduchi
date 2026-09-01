//! tnsnames.ora を読むコマンド（ADR 0006）。
//!
//! ODPI-C の `TNS_ADMIN` は使わない。自前でパースして得た接続記述子を、
//! そのまま接続文字列として渡す。

use crate::db::error::{DbError, DbResult};
use crate::tnsnames::{self, TnsnamesFile};
use std::path::PathBuf;

/// tnsnames.ora のファイル名。
const FILE_NAME: &str = "tnsnames.ora";

/// 指定されたディレクトリの tnsnames.ora を読む。
///
/// 読み取れなかったエントリは `warnings` に理由が入る。読めたエントリだけでも
/// 返すため、`IFILE` を含むファイルでも残りは使える。
///
/// # 引数
///
/// * `directory` - tnsnames.ora が置かれたディレクトリ
#[tauri::command]
pub fn read_tnsnames(directory: PathBuf) -> DbResult<TnsnamesFile> {
    let path = directory.join(FILE_NAME);

    let text = std::fs::read_to_string(&path).map_err(|error| {
        DbError::storage(format!(
            "{} を読めませんでした: {error}",
            path.to_string_lossy()
        ))
    })?;

    Ok(tnsnames::parse_tnsnames(&text))
}
