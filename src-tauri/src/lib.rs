//! 小槌（koduchi）— Oracle / PostgreSQL 対応の GUI データベースクライアント。
//!
//! このファイルはコマンドの登録だけを行う。実装は `commands` と `db` に置く。

pub mod commands;
pub mod config;
pub mod csv;
pub mod db;
pub mod history;
pub mod keychain;
pub mod tnsnames;

use commands::AppState;
use history::HistoryStore;
use tauri::Manager;

/// 履歴とセッション復元の SQLite ファイル名（ADR 0005）。
const HISTORY_FILE_NAME: &str = "history.sqlite3";

/// Tauri アプリケーションを起動する。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // ウィンドウの位置とサイズの復元はプラグインに任せる（ADR 0009）。
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(AppState::default())
        .setup(|app| {
            let path = app.path().app_config_dir()?.join(HISTORY_FILE_NAME);
            app.manage(HistoryStore::open(&path)?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::instant_client::instant_client_status,
            commands::instant_client::save_instant_client_lib_dir,
            commands::instant_client::find_instant_client_candidates,
            commands::connection::connect,
            commands::connection::test_connection,
            commands::connection::execute,
            commands::connection::fetch_more,
            commands::connection::release_tab,
            commands::connection::cancel,
            commands::connection::commit,
            commands::connection::rollback,
            commands::connection::disconnect,
            commands::config::list_saved_connections,
            commands::config::save_connection,
            commands::config::delete_connection,
            commands::config::load_connection_password,
            commands::config::load_app_settings,
            commands::config::save_app_settings,
            commands::history::record_history,
            commands::history::list_history,
            commands::history::delete_history,
            commands::history::clear_history,
            commands::history::save_session,
            commands::history::load_session,
            commands::schema::schema_overview,
            commands::schema::schema_columns,
            commands::plan::explain_plan,
            commands::plan::actual_plan,
            commands::tns::read_tnsnames,
            commands::files::read_text_file,
            commands::files::write_text_file,
            commands::csv::csv_start,
            commands::csv::csv_append,
            commands::csv::csv_finish,
            commands::csv::csv_abort,
            commands::window::open_connection_window,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // メニューの「終了」で直接落とさず、各ウィンドウへ閉じる要求を送る
            // （ADR 0012）。フロントエンドの関所を通し、未コミットの変更を
            // 黙って捨てさせないためである。
            if let tauri::RunEvent::ExitRequested { api, code, .. } = &event {
                // 終了コードを伴う要求は明示的な終了であり、割り込まない。
                if code.is_some() {
                    return;
                }

                let windows = app.webview_windows();
                // ウィンドウが残っていなければ、そのまま終了させる。
                if windows.is_empty() {
                    return;
                }

                api.prevent_exit();
                for window in windows.values() {
                    let _ = window.close();
                }
            }
        });
}
