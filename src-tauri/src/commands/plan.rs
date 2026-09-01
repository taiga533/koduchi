//! 実行計画のコマンド（ADR の「実行計画」節）。
//!
//! 実行計画の生成は履歴に記録しない（ADR 0005）。記録の判断は呼び出し側にある。

use crate::commands::{run_blocking, AppState, ConnectionId};
use crate::db::error::DbResult;
use tauri::State;

/// 見積りだけの実行計画をテキストで返す（`⌘E`）。
///
/// SQL は実行しない。
///
/// # 引数
///
/// * `id` - 接続の識別子
/// * `sql` - 計画を見たい SQL
#[tauri::command]
pub async fn explain_plan(
    state: State<'_, AppState>,
    id: ConnectionId,
    sql: String,
) -> DbResult<String> {
    let pool = state.require(&id)?;

    run_blocking(move || pool.explain_plan(&sql)).await
}

/// 実測付きの実行計画をテキストで返す（`⇧⌘E`）。
///
/// SQL を実際に最後まで実行する。`SELECT` 以外に対しては、呼び出し側が
/// 事前に確認ダイアログを出す。
///
/// # 引数
///
/// * `id` - 接続の識別子
/// * `sql` - 計画を見たい SQL
#[tauri::command]
pub async fn actual_plan(
    state: State<'_, AppState>,
    id: ConnectionId,
    sql: String,
) -> DbResult<String> {
    let pool = state.require(&id)?;

    run_blocking(move || pool.actual_plan(&sql)).await
}
