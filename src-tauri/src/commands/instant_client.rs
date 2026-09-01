//! Oracle Instant Client の状態を扱うコマンド（ADR 0001）。

use crate::db::error::{DbError, DbErrorKind};
use crate::db::oracle::instant_client::{self, ClientStatus, InstantClientSettings};
use std::path::PathBuf;
use tauri::Manager;

/// Instant Client の設定ファイル名。
///
/// 接続設定（`connections.toml`）とは寿命も編集の頻度も違うため分けてある。
const SETTINGS_FILE_NAME: &str = "instant_client.toml";

/// 設定ファイルのパスを求める。
fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, DbError> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(SETTINGS_FILE_NAME))
        .map_err(|error| {
            DbError::new(
                DbErrorKind::ClientUnavailable,
                format!("設定ファイルの場所を決められませんでした: {error}"),
            )
        })
}

/// 保存済みの Instant Client 設定を読む。
///
/// ファイルが無い場合も壊れている場合も既定値を返す。設定が読めないことで
/// アプリが起動しなくなるのを避けるためである。
fn load_settings(app: &tauri::AppHandle) -> InstantClientSettings {
    let Ok(path) = settings_path(app) else {
        return InstantClientSettings::default();
    };

    match std::fs::read_to_string(path) {
        Ok(text) => InstantClientSettings::from_toml(&text),
        Err(_) => InstantClientSettings::default(),
    }
}

/// Instant Client を初期化し、その状態を返す。
///
/// 保存済みのパスがあればそれを使う。`init()` はプロセス 1 回きりであるため、
/// 2 回目以降の呼び出しは最初の結果と同じ状態を返す。
#[tauri::command]
pub fn instant_client_status(app: tauri::AppHandle) -> ClientStatus {
    let settings = load_settings(&app);
    instant_client::initialize(settings.lib_dir.as_deref())
}

/// Instant Client のライブラリのディレクトリを保存する。
///
/// 保存しただけでは反映されない。`init()` がプロセス 1 回きりであるため、
/// 呼び出し側は利用者にアプリの再起動を促す必要がある（ADR 0001）。
///
/// # 引数
///
/// * `lib_dir` - `libclntsh.dylib` を含むディレクトリ
#[tauri::command]
pub fn save_instant_client_lib_dir(app: tauri::AppHandle, lib_dir: PathBuf) -> Result<(), DbError> {
    if !instant_client::contains_client_library(&lib_dir) {
        return Err(DbError::new(
            DbErrorKind::ClientUnavailable,
            "指定されたディレクトリに Instant Client のライブラリが見つかりません",
        ));
    }

    let path = settings_path(&app)?;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            DbError::new(
                DbErrorKind::ClientUnavailable,
                format!("設定ファイルの置き場所を作れませんでした: {error}"),
            )
        })?;
    }

    let settings = InstantClientSettings {
        lib_dir: Some(lib_dir),
    };

    std::fs::write(&path, settings.to_toml()).map_err(|error| {
        DbError::new(
            DbErrorKind::ClientUnavailable,
            format!("設定ファイルを書き込めませんでした: {error}"),
        )
    })
}

/// Instant Client の候補となるディレクトリを探す。
///
/// 案内画面で選択肢として提示する。
#[tauri::command]
pub fn find_instant_client_candidates() -> Vec<PathBuf> {
    instant_client::find_candidate_lib_dirs(&instant_client::default_search_roots())
}
