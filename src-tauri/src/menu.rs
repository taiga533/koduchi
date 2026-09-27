//! メニューバー（ADR 0036・0040）。
//!
//! Tauri の既定のメニューに小槌の項目を差し込むだけで、他は触らない。
//! 押されたら焦点のあるウィンドウへコマンドの表（ADR 0035）の識別子を送り、
//! そのウィンドウがキーやパレットと同じ裁定を走らせる。

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, EventTarget, Manager, Runtime};

/// メニューから操作を走らせるイベントの名前。フロントエンドの `src/appMenu.ts` と組である。
///
/// 中身はコマンドの表（`src/mediator/commands.ts`）の識別子である。項目ごとにイベントを
/// 分けないのは、受け手が表を引くだけで済み、項目を足すたびに口を増やさずに済むためである。
pub const MENU_COMMAND_EVENT: &str = "koduchi://menu-command";

/// 小槌が足したメニュー項目。
///
/// `command_id` はコマンドの表の識別子で、表と綴りを揃える（フロントエンドの
/// `appMenu.test.ts` が表に在ることを見張る）。
pub struct MenuCommand {
    /// メニュー項目の ID。押されたメニューの判別に使う。
    pub menu_id: &'static str,
    /// 送るコマンドの識別子。
    pub command_id: &'static str,
}

/// 「設定…」。`⌘,` はメニューが持つ（ADR 0036）。
pub const SETTINGS: MenuCommand = MenuCommand {
    menu_id: "koduchi.command.settings",
    command_id: "settings",
};

/// 「ファイルを開く…」。キーは表が持つため、アクセラレータは付けない（ADR 0040）。
pub const OPEN_FILE: MenuCommand = MenuCommand {
    menu_id: "koduchi.command.open-file",
    command_id: "open-file",
};

/// 「SQL を整形」。キーは表が持つため、アクセラレータは付けない（ADR 0040）。
pub const FORMAT: MenuCommand = MenuCommand {
    menu_id: "koduchi.command.format",
    command_id: "format",
};

/// 小槌が足した項目の一覧。押された項目の振り分けに使う。
pub const MENU_COMMANDS: [MenuCommand; 3] = [SETTINGS, OPEN_FILE, FORMAT];

/// 最初のウィンドウのラベル（`tauri.conf.json`）。焦点のあるウィンドウが無いときの受け手。
const MAIN_WINDOW_LABEL: &str = "main";

/// アプリメニューの中で「設定…」を差し込む位置。
///
/// macOS の慣例（「〜について」と区切り線の直後）に合わせる。既定のメニューの
/// アプリメニューは「〜について」「区切り線」「サービス」… の順に並ぶ。
const SETTINGS_POSITION: usize = 2;

/// 既定のメニューの File メニューの名前（tauri 2.11.5 の `Menu::default`）。
pub const FILE_SUBMENU_TEXT: &str = "File";

/// 既定のメニューの Edit メニューの名前（tauri 2.11.5 の `Menu::default`）。
pub const EDIT_SUBMENU_TEXT: &str = "Edit";

/// メニューバーを組み立てる。
///
/// 既定のメニューを丸ごと作り直さず、`Menu::default` に項目を差し込む。
/// WKWebView の `⌘C` / `⌘V` / `⌘A` / `⌘Z` は編集メニューの項目が受けており、
/// 自前で組み直すと 1 つ書き漏らしただけでその打鍵が効かなくなるためである。
///
/// 差し込み先が見つからないときは起動を止める。既定のメニューの形が Tauri の
/// 版上げで変わったとき、項目が黙って消えると気づくのは使ったときになるためである。
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = Menu::default(app)?;
    let submenus = menu
        .items()?
        .into_iter()
        .filter_map(|item| item.as_submenu().cloned())
        .collect::<Vec<_>>();

    // macOS では先頭がアプリメニューである。対象は macOS だけ（ADR 0001）。
    let app_menu = submenus.first().ok_or_else(|| missing("アプリメニュー"))?;
    let settings = MenuItem::with_id(app, SETTINGS.menu_id, "設定…", true, Some("CmdOrCtrl+,"))?;
    app_menu.insert_items(
        &[&settings, &PredefinedMenuItem::separator(app)?],
        SETTINGS_POSITION,
    )?;

    // 「ウィンドウを閉じる」より上に置くのは macOS の File メニューの並び
    // （開く・…・閉じる）に合わせるためである。
    let file_menu = find_submenu(&submenus, FILE_SUBMENU_TEXT)?;
    let open_file = MenuItem::with_id(
        app,
        OPEN_FILE.menu_id,
        "ファイルを開く…",
        true,
        None::<&str>,
    )?;
    file_menu.insert_items(&[&open_file, &PredefinedMenuItem::separator(app)?], 0)?;

    // 整形は本文を書き換える編集の操作であり、取り消しやペーストと並べる。
    let edit_menu = find_submenu(&submenus, EDIT_SUBMENU_TEXT)?;
    let format = MenuItem::with_id(app, FORMAT.menu_id, "SQL を整形", true, None::<&str>)?;
    edit_menu.append_items(&[&PredefinedMenuItem::separator(app)?, &format])?;

    Ok(menu)
}

/// 名前でサブメニューを探す。
///
/// 位置で決め打ちしないのは、既定のメニューの並びが版で変わっても取り違えないためである。
fn find_submenu<R: Runtime>(submenus: &[Submenu<R>], text: &str) -> tauri::Result<Submenu<R>> {
    for submenu in submenus {
        if submenu.text()? == text {
            return Ok(submenu.clone());
        }
    }
    Err(missing(text))
}

/// 差し込み先が無いことを表すエラーを作る。
fn missing(name: &str) -> tauri::Error {
    tauri::Error::Io(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        format!("既定のメニューに {name} が見つかりません"),
    ))
}

/// メニューの項目が押されたときの振り分け。
///
/// 小槌が足した項目以外（既定の項目）はメニュー側で完結しているため何もしない。
pub fn handle_event<R: Runtime>(app: &AppHandle<R>, event: &MenuEvent) -> tauri::Result<()> {
    if let Some(command_id) = command_for(event.id().as_ref()) {
        send_command(app, command_id)?;
    }
    Ok(())
}

/// 押されたメニュー項目から、送るコマンドの識別子を引く。
///
/// @param menu_id 押されたメニュー項目の ID
///
/// @returns コマンドの識別子。小槌が足した項目でなければ `None`
pub fn command_for(menu_id: &str) -> Option<&'static str> {
    MENU_COMMANDS
        .iter()
        .find(|command| command.menu_id == menu_id)
        .map(|command| command.command_id)
}

/// コマンドを走らせるウィンドウへイベントを送り、そのウィンドウを前へ出す。
///
/// 全ウィンドウへ配らないのは、1 接続 = 1 ウィンドウ（ADR 0009）で開いている
/// すべてのウィンドウで同じ操作が走るのを避けるためである。
fn send_command<R: Runtime>(app: &AppHandle<R>, command_id: &str) -> tauri::Result<()> {
    let windows = app.webview_windows();
    let candidates = windows
        .iter()
        .map(|(label, window)| Ok((label.as_str(), window.is_focused()?)))
        .collect::<tauri::Result<Vec<_>>>()?;
    let Some(label) = command_target(&candidates) else {
        return Ok(());
    };
    let window = &windows[label];
    // 最小化されたウィンドウへ送っても、利用者には何も起きていないように見える。
    window.unminimize()?;
    window.show()?;
    window.set_focus()?;
    app.emit_to(
        EventTarget::webview_window(label),
        MENU_COMMAND_EVENT,
        command_id,
    )
}

/// コマンドを走らせるウィンドウを選ぶ。
///
/// 焦点のあるウィンドウを選ぶ。メニューを押した利用者が見ているのはそこだからである。
/// 焦点のあるウィンドウが無い（すべて最小化した）ときも黙って何もしないと押し損に
/// なるため、最初のウィンドウ、それも無ければラベル順で先頭のウィンドウを選ぶ。
/// `HashMap` の並びに任せると押すたびに違うウィンドウが出うるため、順序を決めておく。
///
/// @param windows ラベルと焦点を持っているかの組
///
/// @returns 選んだウィンドウのラベル。ウィンドウが 1 つも無ければ `None`
pub fn command_target<'a>(windows: &[(&'a str, bool)]) -> Option<&'a str> {
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
        let target = command_target(&windows);

        // Assert
        assert_eq!(target, Some("connection-2"));
    }

    #[test]
    fn 焦点のあるウィンドウが無ければ最初のウィンドウを選ぶ() {
        // Arrange
        let windows = [("connection-2", false), ("main", false)];

        // Act
        let target = command_target(&windows);

        // Assert
        assert_eq!(target, Some("main"));
    }

    #[test]
    fn 焦点も最初のウィンドウも無ければラベル順で先頭を選ぶ() {
        // Arrange
        let windows = [("connection-3", false), ("connection-2", false)];

        // Act
        let target = command_target(&windows);

        // Assert
        assert_eq!(target, Some("connection-2"));
    }

    #[test]
    fn ウィンドウが無ければ選ばない() {
        // Arrange
        let windows: [(&str, bool); 0] = [];

        // Act
        let target = command_target(&windows);

        // Assert
        assert_eq!(target, None);
    }

    #[test]
    fn 小槌が足した項目からコマンドの識別子を引く() {
        // Arrange
        let menu_ids = [SETTINGS.menu_id, OPEN_FILE.menu_id, FORMAT.menu_id];

        // Act
        let commands = menu_ids.map(command_for);

        // Assert
        assert_eq!(
            commands,
            [Some("settings"), Some("open-file"), Some("format")]
        );
    }

    #[test]
    fn 既定の項目からはコマンドを引かない() {
        // Arrange
        let menu_id = "close_window";

        // Act
        let command = command_for(menu_id);

        // Assert
        assert_eq!(command, None);
    }

    #[test]
    fn 項目のidは重ならない() {
        // Arrange
        let mut menu_ids = MENU_COMMANDS.map(|command| command.menu_id).to_vec();

        // Act
        menu_ids.sort_unstable();
        menu_ids.dedup();

        // Assert
        assert_eq!(menu_ids.len(), MENU_COMMANDS.len());
    }
}
