//! 小槌（koduchi）— Oracle / PostgreSQL 対応の GUI データベースクライアント。
//!
//! このファイルはコマンドの登録だけを行う。実装は `commands` と `db` に置く。

pub mod commands;
pub mod config;
pub mod csv;
pub mod db;
pub mod history;
pub mod keychain;
pub mod menu;
pub mod tnsnames;
pub mod updater;

use commands::AppState;
use history::HistoryStore;
use tauri::Manager;
use updater::{ExitDecision, RestartReservation};

/// 履歴とセッション復元の SQLite ファイル名（ADR 0005）。
const HISTORY_FILE_NAME: &str = "history.sqlite3";

/// Tauri アプリケーションを起動する。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // 結果テーブルの ⌘C / ⇧⌘C が使う。
        .plugin(tauri_plugin_clipboard_manager::init())
        // ウィンドウの位置とサイズの復元はプラグインに任せる（ADR 0009）。
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // 新しい版の確認と入れ替え（ADR 0042）。再起動は下の終了の受け手が担う。
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::default())
        .manage(RestartReservation::default())
        // 既定のメニューに「設定…」などを差し込む（ADR 0036・0040）。
        .menu(menu::build)
        .on_menu_event(|app, event| {
            // メニューの押下には結果を返す相手がいない。ここが大域の受け手である。
            if let Err(error) = menu::handle_event(app, &event) {
                eprintln!("メニューの操作に失敗しました: {error}");
            }
        })
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
            commands::connection::connection_health,
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
            commands::history::create_saved_query,
            commands::history::list_saved_queries,
            commands::history::update_saved_query,
            commands::history::delete_saved_query,
            commands::history::save_session,
            commands::history::load_session,
            commands::schema::schema_overview,
            commands::schema::schema_columns,
            commands::definition::object_definition,
            commands::definition::object_ddl,
            commands::definition::object_stats,
            commands::sessions::list_sessions,
            commands::sessions::kill_session,
            commands::source::search_source,
            commands::source::source_context,
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
            commands::updater::restart_for_update,
            commands::updater::cancel_update_restart,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // メニューの「終了」で直接落とさず、各ウィンドウへ閉じる要求を送る
            // （ADR 0012）。フロントエンドの関所を通し、未コミットの変更を
            // 黙って捨てさせないためである。アップデートの再起動も同じ道を通り、
            // すべて閉じ終えたところで起ち上げ直す（ADR 0042）。
            if let tauri::RunEvent::ExitRequested { api, code, .. } = &event {
                let open_windows = app.webview_windows().len();
                let reserved = app.state::<RestartReservation>().is_reserved();
                match updater::decide_exit(*code, open_windows, reserved) {
                    ExitDecision::Proceed => {}
                    ExitDecision::CloseWindows => {
                        api.prevent_exit();
                        updater::close_all_windows(app);
                    }
                    ExitDecision::Restart => {
                        // 終了コードを伴う要求として出し直され、次の受け手は割り込まない。
                        api.prevent_exit();
                        app.request_restart();
                    }
                }
            }
        });
}
