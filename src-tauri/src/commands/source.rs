//! オブジェクトのソース検索のコマンド（ADR 0021）。
//!
//! どちらもプールの「結果セットを保持していない接続」で走るため、利用者が
//! 見ている結果セット（ADR 0003）は壊れない。`ALL_SOURCE` を舐める重い
//! 問い合わせであるほど、この性質が効く。

use crate::commands::{run_blocking, AppState, ConnectionId};
use crate::db::error::DbResult;
use crate::db::source::{SourceLine, SourceSearchRequest, SourceSearchResult, SourceTarget};
use tauri::State;

/// オブジェクトのソースを横断して検索する。
///
/// 検索語はバインド変数として渡され、SQL へ直に埋め込まれない。当たり行数には
/// 上限があり、達したときは `truncated` が真になる。参照権限が無い接続では
/// `permission` の区分でエラーが返る。空の結果ではない。
///
/// # 引数
///
/// * `id` - 接続の識別子
/// * `request` - 検索の求め
#[tauri::command]
pub async fn search_source(
    state: State<'_, AppState>,
    id: ConnectionId,
    request: SourceSearchRequest,
) -> DbResult<SourceSearchResult> {
    let pool = state.require(&id)?;

    run_blocking(move || pool.search_source(request)).await
}

/// 当たった行の前後を読む。
///
/// 全文ではなく前後だけを読むのは、数千行のパッケージ本体でも持ち帰る量を
/// 一定に保つためである。
///
/// # 引数
///
/// * `id` - 接続の識別子
/// * `target` - 読むオブジェクト
/// * `line` - 中心にする行
#[tauri::command]
pub async fn source_context(
    state: State<'_, AppState>,
    id: ConnectionId,
    target: SourceTarget,
    line: u32,
) -> DbResult<Vec<SourceLine>> {
    let pool = state.require(&id)?;

    run_blocking(move || pool.source_context(target, line)).await
}
