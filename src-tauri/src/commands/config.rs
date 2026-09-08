//! 接続設定とアプリ設定のコマンド（ADR 0004）。
//!
//! 接続設定は `connections.toml`、パスワードは OS キーチェーンへ分けて置く。
//! 接続を削除したらキーチェーンのエントリも必ず消す。消し忘れると孤児の
//! エントリが残り続ける。

use crate::commands::config_path;
use crate::config::{self, SavedConnection};
use crate::csv::CsvOptions;
use crate::db::error::{DbError, DbResult};
use crate::keychain;
use serde::{Deserialize, Serialize};

/// 接続設定ファイルの名前。
const CONNECTIONS_FILE_NAME: &str = "connections.toml";

/// アプリ設定ファイルの名前。
///
/// Instant Client のパス（`instant_client.toml`）とは分けてある。あちらは
/// 接続以前にアプリが機能するかどうかを決めるファイルであり、寿命が違う。
const SETTINGS_FILE_NAME: &str = "settings.toml";

/// 設定画面で決める見た目の設定（ADR 0008）。
///
/// 値の意味はフロントエンドの `src/theme/appearance.ts` と対応する。Rust 側は
/// 保存と読み出しだけを行い、内容の解釈はしない。
///
/// **項目はすべて `#[serde(default)]` を持つ。**設定画面に項目が増えるたびに、
/// その項目を持たない `settings.toml` が世の中に残る。既定を持たせておかないと
/// 表そのものの読み取りが失敗し、`load_app_settings` の `unwrap_or_default()` が
/// テーマも行の高さもまとめて既定へ戻してしまう（新しい項目 1 つのために古い
/// 設定が全部飛ぶ）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSettings {
    /// `system` / `light` / `dark` のいずれか。
    #[serde(default = "default_theme")]
    pub theme: String,
    /// 結果テーブルの罫線を引くか。
    #[serde(default = "default_grid_lines")]
    pub grid_lines: bool,
    /// `compact` / `comfortable` のいずれか。
    #[serde(default = "default_row_height")]
    pub row_height: String,
    /// エディタの文字の大きさ。`small` / `medium` / `large` / `xlarge` のいずれか。
    #[serde(default = "default_editor_font_size")]
    pub editor_font_size: String,
}

/// テーマの既定。システム追従。
fn default_theme() -> String {
    String::from("system")
}

/// 罫線の既定。引く。
fn default_grid_lines() -> bool {
    true
}

/// 行の高さの既定。つめる。
fn default_row_height() -> String {
    String::from("compact")
}

/// エディタの文字の大きさの既定。デザインどおりの 12px にあたる段階。
fn default_editor_font_size() -> String {
    String::from("medium")
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        AppearanceSettings {
            theme: default_theme(),
            grid_lines: default_grid_lines(),
            row_height: default_row_height(),
            editor_font_size: default_editor_font_size(),
        }
    }
}

/// アプリ全体の設定。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default)]
    pub appearance: AppearanceSettings,
    /// CSV 保存ダイアログで前回選ばれた書式。
    #[serde(default)]
    pub csv: CsvOptions,
}

/// 保存済みの接続を読む。
#[tauri::command]
pub fn list_saved_connections(app: tauri::AppHandle) -> DbResult<Vec<SavedConnection>> {
    let path = config_path(&app, CONNECTIONS_FILE_NAME)?;
    Ok(config::load(&path).connections)
}

/// 接続を保存する。
///
/// パスワードが渡された場合だけキーチェーンへ書く。`None` は「変更しない」を
/// 意味する。設定だけを直したいときにパスワードを再入力させないためである。
///
/// # 引数
///
/// * `connection` - 保存する接続。パスワードは含まない
/// * `password` - 保存するパスワード。変更しないなら `None`
#[tauri::command]
pub fn save_connection(
    app: tauri::AppHandle,
    connection: SavedConnection,
    password: Option<String>,
) -> DbResult<()> {
    let path = config_path(&app, CONNECTIONS_FILE_NAME)?;
    let mut file = config::load(&path);

    if let Some(password) = password {
        keychain::save_password(&connection.id, &password)?;
    }

    file.upsert(connection);

    config::save(&path, &file)
        .map_err(|error| DbError::storage(format!("接続設定を書き込めませんでした: {error}")))
}

/// 接続を削除する。
///
/// キーチェーンのエントリも一緒に消す（ADR 0004）。
///
/// # 引数
///
/// * `id` - 削除する接続の ID
#[tauri::command]
pub fn delete_connection(app: tauri::AppHandle, id: String) -> DbResult<()> {
    let path = config_path(&app, CONNECTIONS_FILE_NAME)?;
    let mut file = config::load(&path);

    if !file.remove(&id) {
        return Ok(());
    }

    keychain::delete_password(&id)?;

    config::save(&path, &file)
        .map_err(|error| DbError::storage(format!("接続設定を書き込めませんでした: {error}")))
}

/// 保存済みのパスワードを取り出す。
///
/// 保存されていなければ `None` を返す。呼び出し側は入力を促す。
///
/// # 引数
///
/// * `id` - 接続の ID
#[tauri::command]
pub fn load_connection_password(id: String) -> DbResult<Option<String>> {
    keychain::load_password(&id)
}

/// アプリ設定を読む。
///
/// ファイルが無い場合も壊れている場合も既定値を返す。
#[tauri::command]
pub fn load_app_settings(app: tauri::AppHandle) -> DbResult<AppSettings> {
    let path = config_path(&app, SETTINGS_FILE_NAME)?;
    let Ok(text) = std::fs::read_to_string(path) else {
        return Ok(AppSettings::default());
    };
    Ok(toml::from_str(&text).unwrap_or_default())
}

/// アプリ設定を書く。
///
/// # 引数
///
/// * `settings` - 保存する設定
#[tauri::command]
pub fn save_app_settings(app: tauri::AppHandle, settings: AppSettings) -> DbResult<()> {
    let path = config_path(&app, SETTINGS_FILE_NAME)?;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            DbError::storage(format!("設定の置き場所を作れませんでした: {error}"))
        })?;
    }

    let text = toml::to_string_pretty(&settings)
        .map_err(|error| DbError::storage(format!("設定を書き出せませんでした: {error}")))?;

    std::fs::write(&path, text)
        .map_err(|error| DbError::storage(format!("設定を書き込めませんでした: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn アプリ設定の既定はシステム追従で罫線ありのつめた行と標準の文字になる() {
        // Arrange & Act
        let settings = AppSettings::default();

        // Assert
        assert_eq!(settings.appearance.theme, "system");
        assert!(settings.appearance.grid_lines);
        assert_eq!(settings.appearance.row_height, "compact");
        assert_eq!(settings.appearance.editor_font_size, "medium");
    }

    #[test]
    fn 文字の大きさを持たない古い設定でも他の項目が保たれ大きさは既定になる() {
        // Arrange
        // editorFontSize を足す前に書かれた settings.toml
        let old = "\
[appearance]
theme = \"dark\"
gridLines = false
rowHeight = \"comfortable\"
";

        // Act
        let settings: AppSettings = toml::from_str(old).unwrap();

        // Assert
        assert_eq!(settings.appearance.theme, "dark");
        assert!(!settings.appearance.grid_lines);
        assert_eq!(settings.appearance.row_height, "comfortable");
        assert_eq!(settings.appearance.editor_font_size, "medium");
    }

    #[test]
    fn 見た目の設定の表が空でもすべての項目が既定になる() {
        // Arrange
        let empty = "[appearance]\n";

        // Act
        let settings: AppSettings = toml::from_str(empty).unwrap();

        // Assert
        assert_eq!(settings.appearance, AppearanceSettings::default());
    }

    #[test]
    fn アプリ設定は書き出して読み戻せる() {
        // Arrange
        let settings = AppSettings {
            appearance: AppearanceSettings {
                theme: String::from("dark"),
                grid_lines: false,
                row_height: String::from("comfortable"),
                editor_font_size: String::from("xlarge"),
            },
            csv: CsvOptions::default(),
        };

        // Act
        let text = toml::to_string_pretty(&settings).unwrap();
        let restored: AppSettings = toml::from_str(&text).unwrap();

        // Assert
        assert_eq!(restored, settings);
    }

    #[test]
    fn 壊れた設定からは既定値になる() {
        // Arrange
        let broken = "これは TOML ではない [[[";

        // Act
        let settings: AppSettings = toml::from_str(broken).unwrap_or_default();

        // Assert
        assert_eq!(settings, AppSettings::default());
    }
}
