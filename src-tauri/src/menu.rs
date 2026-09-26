//! メニューバー（ADR 0036）。
//!
//! Tauri の既定のメニューに「設定…」（`⌘,`）を 1 つ足すだけで、他は触らない。
//! 押されたら焦点のあるウィンドウへイベントを送り、そのウィンドウが自分の
//! 設定画面を開く。

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::{AppHandle, Emitter, EventTarget, Manager, Runtime};

/// 「設定…」のメニュー項目の ID。押されたメニューの判別に使う。
pub const OPEN_SETTINGS_MENU_ID: &str = "koduchi.open-settings";

/// 設定画面を開かせるイベントの名前。フロントエンドの `src/appMenu.ts` と組である。
pub const OPEN_SETTINGS_EVENT: &str = "koduchi://open-settings";

/// 最初のウィンドウのラベル（`tauri.conf.json`）。焦点のあるウィンドウが無いときの受け手。
const MAIN_WINDOW_LABEL: &str = "main";

/// アプリメニューの中で「設定…」を差し込む位置。
///
/// macOS の慣例（「〜について」と区切り線の直後）に合わせる。既定のメニューの
/// アプリメニューは「〜について」「区切り線」「サービス」… の順に並ぶ。
const SETTINGS_POSITION: usize = 2;

/// メニューバーを組み立てる。
///
/// 既定のメニューを丸ごと作り直さず、`Menu::default` に 1 項目を差し込む。
/// WKWebView の `⌘C` / `⌘V` / `⌘A` / `⌘Z` は編集メニューの項目が受けており、
/// 自前で組み直すと 1 つ書き漏らしただけでその打鍵が効かなくなるためである。
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = Menu::default(app)?;
    // macOS では先頭がアプリメニューである。対象は macOS だけ（ADR 0001）。
    if let Some(app_menu) = menu.items()?.first().and_then(|item| item.as_submenu()) {
        let settings = MenuItem::with_id(
            app,
            OPEN_SETTINGS_MENU_ID,
            "設定…",
            true,
            Some("CmdOrCtrl+,"),
        )?;
        let separator = PredefinedMenuItem::separator(app)?;
        app_menu.insert_items(&[&settings, &separator], SETTINGS_POSITION)?;
    }
    Ok(menu)
}

/// メニューの項目が押されたときの振り分け。
///
/// 小槌が足した項目以外（既定の項目）はメニュー側で完結しているため何もしない。
pub fn handle_event<R: Runtime>(app: &AppHandle<R>, event: &MenuEvent) -> tauri::Result<()> {
    if event.id() == OPEN_SETTINGS_MENU_ID {
        open_settings(app)?;
    }
    Ok(())
}

/// 設定画面を開かせるウィンドウへイベントを送り、そのウィンドウを前へ出す。
///
/// 全ウィンドウへ配らないのは、1 接続 = 1 ウィンドウ（ADR 0009）で開いている
/// すべてのウィンドウに同じパネルが重なるのを避けるためである。
fn open_settings<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let windows = app.webview_windows();
    let candidates = windows
        .iter()
        .map(|(label, window)| Ok((label.as_str(), window.is_focused()?)))
        .collect::<tauri::Result<Vec<_>>>()?;
    let Some(label) = settings_target(&candidates) else {
        return Ok(());
    };
    let window = &windows[label];
    // 最小化されたウィンドウへ送っても、利用者には何も起きていないように見える。
    window.unminimize()?;
    window.show()?;
    window.set_focus()?;
    app.emit_to(EventTarget::webview_window(label), OPEN_SETTINGS_EVENT, ())
}

/// 設定画面を開かせるウィンドウを選ぶ。
///
/// 焦点のあるウィンドウを選ぶ。メニューを押した利用者が見ているのはそこだからである。
/// 焦点のあるウィンドウが無い（すべて最小化した）ときも黙って何もしないと押し損に
/// なるため、最初のウィンドウ、それも無ければラベル順で先頭のウィンドウを選ぶ。
/// `HashMap` の並びに任せると押すたびに違うウィンドウが出うるため、順序を決めておく。
///
/// @param windows ラベルと焦点を持っているかの組
///
/// @returns 選んだウィンドウのラベル。ウィンドウが 1 つも無ければ `None`
pub fn settings_target<'a>(windows: &[(&'a str, bool)]) -> Option<&'a str> {
    if let Some((label, _)) = windows.iter().find(|(_, focused)| *focused) {
        return Some(label);
    }
    if let Some((label, _)) = windows
        .iter()
        .find(|(label, _)| *label == MAIN_WINDOW_LABEL)
    {
        return Some(label);
    }
    windows.iter().map(|(label, _)| *label).min()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 焦点のあるウィンドウを選ぶ() {
        // Arrange
        let windows = [
            ("main", false),
            ("connection-2", true),
            ("connection-3", false),
        ];

        // Act
        let target = settings_target(&windows);

        // Assert
        assert_eq!(target, Some("connection-2"));
    }

    #[test]
    fn 焦点のあるウィンドウが無ければ最初のウィンドウを選ぶ() {
        // Arrange
        let windows = [("connection-2", false), ("main", false)];

        // Act
        let target = settings_target(&windows);

        // Assert
        assert_eq!(target, Some("main"));
    }

    #[test]
    fn 焦点も最初のウィンドウも無ければラベル順で先頭を選ぶ() {
        // Arrange
        let windows = [("connection-3", false), ("connection-2", false)];

        // Act
        let target = settings_target(&windows);

        // Assert
        assert_eq!(target, Some("connection-2"));
    }

    #[test]
    fn ウィンドウが無ければ選ばない() {
        // Arrange
        let windows: [(&str, bool); 0] = [];

        // Act
        let target = settings_target(&windows);

        // Assert
        assert_eq!(target, None);
    }
}
