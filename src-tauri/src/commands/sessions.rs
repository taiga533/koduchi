//! セッションとロックのコマンド（ADR 0017）。
//!
//! どちらもプールの「結果セットを保持していない接続」で走るため、利用者が
//! 見ている結果セット（ADR 0003）は壊れない。

use crate::commands::{run_blocking, AppState, ConnectionId};
use crate::db::error::DbResult;
use crate::db::sessions::SessionOverview;
use tauri::State;

/// セッションの一覧とブロッキングの連鎖を取る。
///
/// 参照権限が無い接続では `permission` の区分でエラーが返る。空の一覧では
/// ない。「見えない」と「居ない」は別物である。
///
/// # 引数
///
/// * `id` - 接続の識別子
#[tauri::command]
pub async fn list_sessions(
    state: State<'_, AppState>,
    id: ConnectionId,
) -> DbResult<SessionOverview> {
    let pool = state.require(&id)?;

    run_blocking(move || pool.list_sessions()).await
}

/// セッションを 1 つ終了する（`ALTER SYSTEM KILL SESSION`）。
///
/// 読み取り専用の接続と、小槌自身が張っている接続は Rust 側で弾く。
/// 確認ダイアログはフロントエンドが出す（ADR 0017 の関所 3）。
///
/// # 引数
///
/// * `id` - 接続の識別子
/// * `sid` - 対象の `SID`
/// * `serial` - 対象の `SERIAL#`
#[tauri::command]
pub async fn kill_session(
    state: State<'_, AppState>,
    id: ConnectionId,
    sid: u32,
    serial: u32,
) -> DbResult<()> {
    let pool = state.require(&id)?;

    run_blocking(move || pool.kill_session(sid, serial)).await
}
