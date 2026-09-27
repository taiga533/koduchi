//! 既定のメニューの形の見張り（ADR 0040）。
//!
//! `menu::build` は差し込み先（先頭のアプリメニュー・`File`・`Edit`）が見つからないと
//! 起動を止める。Tauri の版上げでその形が変わったことに、配布物を起動する前に
//! 気付くため、実物の `Menu::default` の上で `build` を走らせる。
//!
//! muda は macOS でメニューを主スレッドでしか作らせないため、テストの枠組みを外し
//! （`Cargo.toml` の `harness = false`）、`main` から直に走らせる。

use koduchi_lib::menu::{
    self, CHECK_UPDATE, EDIT_SUBMENU_TEXT, FILE_SUBMENU_TEXT, FORMAT, OPEN_FILE, SETTINGS,
};
use tauri::menu::Submenu;
use tauri::test::{mock_app, MockRuntime};

fn main() {
    既定のメニューへ小槌の項目を差し込める();
    println!("test result: ok. 1 passed");
}

/// サブメニューが持つ項目の ID を並びどおりに集める。
fn item_ids(submenu: &Submenu<MockRuntime>) -> Vec<String> {
    submenu
        .items()
        .unwrap()
        .iter()
        .map(|item| item.id().as_ref().to_string())
        .collect()
}

/// 名前でサブメニューを引く。
fn submenu_named(submenus: &[Submenu<MockRuntime>], text: &str) -> Submenu<MockRuntime> {
    submenus
        .iter()
        .find(|submenu| submenu.text().unwrap() == text)
        .unwrap_or_else(|| panic!("{text} のメニューがありません"))
        .clone()
}

fn 既定のメニューへ小槌の項目を差し込める() {
    // Arrange
    let app = mock_app();

    // Act
    let menu = menu::build(app.handle()).expect("既定のメニューへ差し込めること");

    // Assert
    let submenus = menu
        .items()
        .unwrap()
        .into_iter()
        .filter_map(|item| item.as_submenu().cloned())
        .collect::<Vec<_>>();
    let app_menu = item_ids(&submenus[0]);
    assert!(app_menu.contains(&SETTINGS.menu_id.to_string()));
    // 「〜について」の直後に並ぶ（macOS の慣例）。
    assert_eq!(app_menu[1], CHECK_UPDATE.menu_id);
    assert_eq!(
        item_ids(&submenu_named(&submenus, FILE_SUBMENU_TEXT))[0],
        OPEN_FILE.menu_id
    );
    assert_eq!(
        item_ids(&submenu_named(&submenus, EDIT_SUBMENU_TEXT))
            .last()
            .unwrap(),
        FORMAT.menu_id
    );
}
