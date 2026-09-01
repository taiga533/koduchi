//! CSV 書き出しのコマンド（`⌥⌘S`）。
//!
//! 書き出しは 3 つの呼び出しに分かれる。フロントエンドがカーソルから
//! 取り出したかたまりを `csv_append` で順に渡し、尽きたら `csv_finish` を呼ぶ。
//! 中止されたら `csv_abort` で書きかけのファイルごと消す。
//!
//! 数十万行を 1 度の IPC に載せずに済み、進捗も出せる（ADR 0003）。

use crate::commands::AppState;
use crate::csv::{CsvOptions, CsvWriter};
use crate::db::driver::Column;
use crate::db::error::DbResult;
use crate::db::value::Cell;
use std::path::PathBuf;
use tauri::State;

/// CSV の書き出しを始める。BOM とヘッダー行までを書く。
///
/// # 引数
///
/// * `export_id` - この書き出しの識別子。以後の呼び出しで使う
/// * `path` - 保存先
/// * `columns` - 結果セットの列
/// * `options` - 区切り文字・文字コード・NULL の表現
#[tauri::command]
pub fn csv_start(
    state: State<'_, AppState>,
    export_id: String,
    path: PathBuf,
    columns: Vec<Column>,
    options: CsvOptions,
) -> DbResult<()> {
    let writer = CsvWriter::create(&path, &columns, options)?;
    state.insert_export(export_id, writer);
    Ok(())
}

/// 行を追記し、これまでに書いた総行数を返す。
///
/// # 引数
///
/// * `export_id` - 書き出しの識別子
/// * `rows` - 追記する行
#[tauri::command]
pub fn csv_append(
    state: State<'_, AppState>,
    export_id: String,
    rows: Vec<Vec<Cell>>,
) -> DbResult<u64> {
    state.with_export(&export_id, |writer| writer.append(&rows))
}

/// 書き出しを終え、書いた総行数を返す。
///
/// # 引数
///
/// * `export_id` - 書き出しの識別子
#[tauri::command]
pub fn csv_finish(state: State<'_, AppState>, export_id: String) -> DbResult<u64> {
    match state.take_export(&export_id) {
        Some(writer) => writer.finish(),
        None => Ok(0),
    }
}

/// 書き出しを中止し、書きかけのファイルを消す。
///
/// 既に終わっていても何もしない。中止と完了が競っても壊れないようにするため。
///
/// # 引数
///
/// * `export_id` - 書き出しの識別子
#[tauri::command]
pub fn csv_abort(state: State<'_, AppState>, export_id: String) -> DbResult<()> {
    if let Some(writer) = state.take_export(&export_id) {
        writer.abort();
    }
    Ok(())
}
