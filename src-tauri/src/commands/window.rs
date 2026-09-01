//! ウィンドウを開くコマンド（ADR 0009）。
//!
//! 1 接続 = 1 ウィンドウであるため、別の接続を開くにはウィンドウごと増やす。
//! Rust 側の接続プールはウィンドウではなく接続 ID で分かれているので、
//! ここで作るのはウィンドウだけでよい。
//!
//! 新しいウィンドウの見た目は `tauri.conf.json` の設定をそのまま複製する。
//! 信号機の位置（ADR 0009）を 2 箇所に書かないためである。

use crate::db::error::{DbError, DbResult};
use std::sync::atomic::{AtomicU64, Ordering};

/// 新しいウィンドウのラベルに使う連番。
static NEXT_WINDOW_NUMBER: AtomicU64 = AtomicU64::new(1);

/// 動的に作るウィンドウのラベルの接頭辞。
///
/// 権限（capabilities）の対象を `connection-*` で指定するため、この接頭辞は
/// `src-tauri/capabilities/default.json` と対応している。
pub const WINDOW_LABEL_PREFIX: &str = "connection-";

/// 別の接続のためのウィンドウを開く（`⌃⌘N`）。
///
/// 開いたウィンドウのラベルを返す。ラベルはセッション復元の鍵になる
/// （ADR 0005）。
#[tauri::command]
pub async fn open_connection_window(app: tauri::AppHandle) -> DbResult<String> {
    let label = format!(
        "{WINDOW_LABEL_PREFIX}{}",
        NEXT_WINDOW_NUMBER.fetch_add(1, Ordering::SeqCst)
    );

    let mut config = app
        .config()
        .app
        .windows
        .first()
        .cloned()
        .ok_or_else(|| DbError::storage("ウィンドウの設定が見つかりません"))?;
    config.label = label.clone();

    tauri::WebviewWindowBuilder::from_config(&app, &config)
        .map_err(|error| DbError::storage(format!("ウィンドウを作れませんでした: {error}")))?
        .build()
        .map_err(|error| DbError::storage(format!("ウィンドウを開けませんでした: {error}")))?;

    Ok(label)
}
