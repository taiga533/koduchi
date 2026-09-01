//! `.sql` ファイルの読み書き（`⌘O` / `⌘S`）。
//!
//! 開く / 保存の場所はダイアログプラグインで選ばせ、読み書き自体はここで行う。
//! ファイルシステムのプラグインを使わないのは、任意の場所を選ぶ用途に対して
//! 許可の範囲を絞りきれないためである。

use crate::db::error::{DbError, DbResult};
use std::path::PathBuf;

/// テキストファイルを読む。
///
/// # 引数
///
/// * `path` - 読むファイル
#[tauri::command]
pub fn read_text_file(path: PathBuf) -> DbResult<String> {
    std::fs::read_to_string(&path).map_err(|error| {
        DbError::storage(format!(
            "{} を読めませんでした: {error}",
            path.to_string_lossy()
        ))
    })
}

/// テキストファイルを書く。
///
/// # 引数
///
/// * `path` - 書くファイル
/// * `content` - 書き込む内容
#[tauri::command]
pub fn write_text_file(path: PathBuf, content: String) -> DbResult<()> {
    std::fs::write(&path, content).map_err(|error| {
        DbError::storage(format!(
            "{} を書けませんでした: {error}",
            path.to_string_lossy()
        ))
    })
}
