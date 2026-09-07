//! 接続と SQL 実行のコマンド（ADR 0002・0003）。
//!
//! `oracle` crate は同期 API であり、実行はスレッドを塞ぐ。コマンドはブロッキング
//! 用のスレッドへ処理を移し、tokio のワーカーを占有しないようにする。

use crate::commands::{run_blocking, AppState, ConnectionId};
use crate::db::driver::{Bind, Chunk, ConnectionParams, ExecuteOutcome};
use crate::db::error::{DbError, DbResult};
use crate::db::pool::{ConnectionPool, DEFAULT_CHUNK_SIZE, DEFAULT_POOL_SIZE};
use serde::Serialize;
use std::sync::Arc;
use tauri::State;

/// フロントエンドへ返す実行結果。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteResponse {
    #[serde(flatten)]
    pub outcome: ExecuteOutcome,
    /// 接続を明け渡すために結果セットを閉じられたタブ（ADR 0003）。
    ///
    /// このタブには「結果は破棄されました。再実行してください」を出す。
    pub discarded_tab: Option<String>,
}

/// Oracle へ接続し、以後 `id` で参照できるようにする。
///
/// ウィンドウ 1 つぶんの接続プールを作る（ADR 0003）。既に同じ `id` の接続が
/// あれば置き換える。
///
/// # 引数
///
/// * `id` - フロントエンドが採番した接続の識別子
/// * `params` - 接続先とユーザー、読み取り専用の指定
#[tauri::command]
pub async fn connect(
    state: State<'_, AppState>,
    id: ConnectionId,
    params: ConnectionParams,
) -> DbResult<()> {
    let pool =
        run_blocking(move || ConnectionPool::open(&params, DEFAULT_POOL_SIZE, DEFAULT_CHUNK_SIZE))
            .await?;

    state.insert(id, Arc::new(pool));
    Ok(())
}

/// 接続を試すだけの確認（接続を作成する画面の「テスト接続」）。
///
/// 接続表には載せないため、成功しても以後 `id` で参照できるようにはならない。
/// 繋いだ結果をその場で捨てるのは、試した接続がプールを占有し続けないためである。
///
/// # 引数
///
/// * `params` - 接続先とユーザー、読み取り専用の指定
#[tauri::command]
pub async fn test_connection(params: ConnectionParams) -> DbResult<String> {
    run_blocking(move || crate::db::check_connection(&params)).await
}

/// SQL を 1 文実行する。
///
/// 問い合わせの場合は最初のかたまりだけを返し、カーソルは開いたままにする。
///
/// # 引数
///
/// * `id` - 接続の識別子
/// * `tab_id` - 実行元のエディタタブ
/// * `sql` - 実行する SQL。末尾のセミコロンは含まない
/// * `binds` - SQL 中のバインド変数へ与える値（ADR の「バインド変数」節）
#[tauri::command]
pub async fn execute(
    state: State<'_, AppState>,
    id: ConnectionId,
    tab_id: String,
    sql: String,
    binds: Vec<Bind>,
) -> DbResult<ExecuteResponse> {
    let pool = state.get(&id).ok_or_else(DbError::closed)?;

    let response = run_blocking(move || pool.execute(&tab_id, &sql, &binds)).await?;

    Ok(ExecuteResponse {
        outcome: response.outcome,
        discarded_tab: response.discarded_tab,
    })
}

/// 開いている結果セットから続きを取り出す（ADR 0003）。
///
/// スクロールが下端に近づくたびに呼ぶ。結果セットが既に閉じられている場合は
/// エラーになるため、呼び出し側は再実行を促す。
///
/// # 引数
///
/// * `id` - 接続の識別子
/// * `tab_id` - 対象のエディタタブ
#[tauri::command]
pub async fn fetch_more(
    state: State<'_, AppState>,
    id: ConnectionId,
    tab_id: String,
) -> DbResult<Chunk> {
    let pool = state.get(&id).ok_or_else(DbError::closed)?;

    run_blocking(move || pool.fetch_more(&tab_id)).await
}

/// タブの結果セットを閉じる。
///
/// タブを閉じたときに呼ぶ。開いたままのカーソルはデータベース側の資源を
/// 握り続けるため、不要になった時点で手放す（ADR 0003）。
///
/// # 引数
///
/// * `id` - 接続の識別子
/// * `tab_id` - 対象のエディタタブ
#[tauri::command]
pub async fn release_tab(
    state: State<'_, AppState>,
    id: ConnectionId,
    tab_id: String,
) -> DbResult<()> {
    let Some(pool) = state.get(&id) else {
        return Ok(());
    };

    run_blocking(move || pool.release(&tab_id)).await
}

/// 実行中の文を中止する（`⌘.`）。
///
/// 実行でアクタースレッドが塞がっている最中でも効く。
///
/// # 引数
///
/// * `id` - 接続の識別子
/// * `tab_id` - 実行中のエディタタブ
#[tauri::command]
pub async fn cancel(state: State<'_, AppState>, id: ConnectionId, tab_id: String) -> DbResult<()> {
    let pool = state.get(&id).ok_or_else(DbError::closed)?;

    // 中止はデータベースへの往復を伴うため、これもブロッキング側で待つ。
    run_blocking(move || pool.cancel(&tab_id)).await
}

/// 接続を閉じる。
///
/// 登録から外すだけでプールの全接続とアクタースレッドが終了する。既に
/// 閉じられていてもエラーにはしない。
///
/// # 引数
///
/// * `id` - 接続の識別子
#[tauri::command]
pub async fn disconnect(state: State<'_, AppState>, id: ConnectionId) -> DbResult<()> {
    let Some(pool) = state.remove(&id) else {
        return Ok(());
    };

    // アクタースレッドの join を伴うため、ブロッキング側で破棄する。
    run_blocking(move || {
        drop(pool);
        Ok(())
    })
    .await
}
