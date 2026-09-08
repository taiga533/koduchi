//! クエリ履歴とセッション復元のコマンド（ADR 0005）。
//!
//! 履歴は全接続を横断する 1 つの SQLite に入る。ウィンドウが複数あっても
//! 保管庫は 1 つで、`HistoryStore` が内部で排他する。保存済みクエリ（ADR 0018）
//! も同じ保管庫に置くため、コマンドはここへまとめる。

use crate::db::error::DbResult;
use crate::history::{
    HistoryEntry, HistoryQuery, HistoryStore, NewHistoryEntry, NewSavedQuery, SavedQuery,
    SavedQueryQuery, SessionState,
};
use tauri::State;

/// 履歴を 1 件記録し、採番された ID を返す。
///
/// 成功・失敗を問わず記録する。`⌘E` / `⇧⌘E` による実行計画の生成は
/// 呼び出し側が記録しない。
///
/// # 引数
///
/// * `entry` - 記録する内容
#[tauri::command]
pub fn record_history(store: State<'_, HistoryStore>, entry: NewHistoryEntry) -> DbResult<i64> {
    store.record(&entry)
}

/// 履歴を新しい順に取り出す。
///
/// # 引数
///
/// * `query` - 絞り込み条件。接続名を省略すると全接続が対象になる
#[tauri::command]
pub fn list_history(
    store: State<'_, HistoryStore>,
    query: HistoryQuery,
) -> DbResult<Vec<HistoryEntry>> {
    store.list(&query)
}

/// 履歴を 1 件削除する。
///
/// # 引数
///
/// * `id` - 削除する履歴の ID
#[tauri::command]
pub fn delete_history(store: State<'_, HistoryStore>, id: i64) -> DbResult<bool> {
    store.delete(id)
}

/// 履歴を全件削除し、消した件数を返す。設定画面の一括削除に対応する。
#[tauri::command]
pub fn clear_history(store: State<'_, HistoryStore>) -> DbResult<usize> {
    store.delete_all()
}

/// クエリを 1 件保存し、採番された ID を返す（ADR 0018）。
///
/// バインド変数の値は渡さない。保存するのは SQL 本体だけである。
///
/// # 引数
///
/// * `query` - 保存する内容
#[tauri::command]
pub fn create_saved_query(store: State<'_, HistoryStore>, query: NewSavedQuery) -> DbResult<i64> {
    store.save_query(&query)
}

/// 保存済みクエリを更新日時の新しい順に取り出す。
///
/// # 引数
///
/// * `query` - 絞り込み条件。接続名を省略すると全接続が対象になる
#[tauri::command]
pub fn list_saved_queries(
    store: State<'_, HistoryStore>,
    query: SavedQueryQuery,
) -> DbResult<Vec<SavedQuery>> {
    store.list_queries(&query)
}

/// 保存済みクエリの名前と SQL を書き換える。
///
/// # 引数
///
/// * `id` - 対象の ID
/// * `name` - 新しい名前
/// * `sql` - 新しい SQL
/// * `updated_at` - 更新した時刻（Unix エポックからのミリ秒）
#[tauri::command]
pub fn update_saved_query(
    store: State<'_, HistoryStore>,
    id: i64,
    name: String,
    sql: String,
    updated_at: i64,
) -> DbResult<bool> {
    store.update_query(id, &name, &sql, updated_at)
}

/// 保存済みクエリを 1 件削除する。
///
/// # 引数
///
/// * `id` - 削除する ID
#[tauri::command]
pub fn delete_saved_query(store: State<'_, HistoryStore>, id: i64) -> DbResult<bool> {
    store.delete_query(id)
}

/// ウィンドウ 1 つぶんのセッションを保存する。
///
/// # 引数
///
/// * `window_label` - ウィンドウのラベル（ADR 0009）
/// * `state` - エディタタブとサイドバーの選択セグメント
#[tauri::command]
pub fn save_session(
    store: State<'_, HistoryStore>,
    window_label: String,
    state: SessionState,
) -> DbResult<()> {
    store.save_session(&window_label, &state)
}

/// ウィンドウ 1 つぶんのセッションを読む。
///
/// 保存されていなければ空の状態を返す。
///
/// # 引数
///
/// * `window_label` - ウィンドウのラベル
#[tauri::command]
pub fn load_session(
    store: State<'_, HistoryStore>,
    window_label: String,
) -> DbResult<SessionState> {
    store.load_session(&window_label)
}
