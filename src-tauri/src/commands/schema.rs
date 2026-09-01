//! スキーマツリーのコマンド（ADR 0007）。
//!
//! 段階 1（スキーマ名・オブジェクト数・オブジェクト名）と段階 2（列情報）を
//! 別のコマンドに分けてある。フロントエンドは段階 1 を待ってツリーを描き、
//! 段階 2 をスキーマごとに呼びながら進捗を出す。

use crate::commands::{run_blocking, AppState, ConnectionId};
use crate::db::error::DbResult;
use crate::db::schema::{SchemaFilter, SchemaNode, TableColumn};
use tauri::State;

/// スキーマツリーの段階 1 を取る。
///
/// # 引数
///
/// * `id` - 接続の識別子
/// * `filter` - 絞り込み条件
#[tauri::command]
pub async fn schema_overview(
    state: State<'_, AppState>,
    id: ConnectionId,
    filter: SchemaFilter,
) -> DbResult<Vec<SchemaNode>> {
    let pool = state.require(&id)?;

    run_blocking(move || pool.schema_overview(&filter)).await
}

/// スキーマ 1 つぶんの列情報を取る（段階 2）。
///
/// # 引数
///
/// * `id` - 接続の識別子
/// * `owner` - 対象のスキーマ名
#[tauri::command]
pub async fn schema_columns(
    state: State<'_, AppState>,
    id: ConnectionId,
    owner: String,
) -> DbResult<Vec<TableColumn>> {
    let pool = state.require(&id)?;

    run_blocking(move || pool.schema_columns(&owner)).await
}
