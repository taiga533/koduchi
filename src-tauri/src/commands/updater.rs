//! 自動アップデートの再起動のコマンド（ADR 0042）。
//!
//! 新しい版の取得と入れ替えは `tauri-plugin-updater` のコマンドをフロントエンドが
//! 直に呼ぶ。ここは入れ替えた後の再起動の予約と取り消しだけを持つ。

use crate::updater::{self, RestartReservation};
use tauri::State;

/// 新しい版で起ち上げ直す。
///
/// その場では再起動しない。予約してから各ウィンドウへ閉じる要求を送り、未コミットの
/// 関所（ADR 0012）を通ってすべてのウィンドウが閉じたときに `lib.rs` の終了の受け手が
/// 起ち上げ直す。
#[tauri::command]
pub fn restart_for_update(app: tauri::AppHandle, reservation: State<'_, RestartReservation>) {
    reservation.reserve();
    updater::close_all_windows(&app);
}

/// 再起動の予約を取り消す。
///
/// どこかのウィンドウが閉じるのを断ったら、フロントエンドがこれを呼ぶ。予約を
/// 残したままだと、後で普通に終了したときに思いがけず起ち上がり直す。
#[tauri::command]
pub fn cancel_update_restart(reservation: State<'_, RestartReservation>) {
    reservation.cancel();
}
