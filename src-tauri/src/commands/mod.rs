//! Tauri コマンド。
//!
//! コマンドは薄い層に留め、実処理はアクター（ADR 0002）へ委ねる。
//! `oracle` crate は同期 API であるため、待ちはブロッキング用のスレッドへ逃がし、
//! tokio のワーカーを塞がないようにする。

pub mod config;
pub mod connection;
pub mod csv;
pub mod files;
pub mod history;
pub mod instant_client;
pub mod plan;
pub mod schema;
pub mod sessions;
pub mod source;
pub mod tns;
pub mod window;

use crate::csv::CsvWriter;
use crate::db::error::{DbError, DbResult};
use crate::db::pool::ConnectionPool;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::Manager;

/// 接続を識別する ID。フロントエンドが採番し、そのまま鍵として使う。
pub type ConnectionId = String;

/// アプリ全体で共有する状態。
#[derive(Default)]
pub struct AppState {
    /// 開いている接続プール。ウィンドウをまたいで 1 つの表に載せ、ID で引く。
    connections: Mutex<HashMap<ConnectionId, Arc<ConnectionPool>>>,
    /// 書き出し中の CSV。タブごとに高々 1 つ。
    exports: Mutex<HashMap<String, CsvWriter>>,
}

impl AppState {
    /// 接続プールを登録する。同じ ID が既にあれば置き換え、古いものは閉じる。
    pub fn insert(&self, id: ConnectionId, connection: Arc<ConnectionPool>) {
        let mut connections = self.connections.lock().expect("接続表のロックが壊れている");
        connections.insert(id, connection);
    }

    /// 接続プールを取り出す。
    pub fn get(&self, id: &str) -> Option<Arc<ConnectionPool>> {
        let connections = self.connections.lock().expect("接続表のロックが壊れている");
        connections.get(id).cloned()
    }

    /// 接続プールを登録から外す。外したプールを返す。
    pub fn remove(&self, id: &str) -> Option<Arc<ConnectionPool>> {
        let mut connections = self.connections.lock().expect("接続表のロックが壊れている");
        connections.remove(id)
    }

    /// 接続プールを取り出す。無ければ「閉じられている」エラーにする。
    ///
    /// # 引数
    ///
    /// * `id` - 接続の識別子
    pub fn require(&self, id: &str) -> DbResult<Arc<ConnectionPool>> {
        self.get(id).ok_or_else(DbError::closed)
    }

    /// 書き出し中の CSV を登録する。
    ///
    /// # 引数
    ///
    /// * `export_id` - 書き出しの識別子
    /// * `writer` - 書き出し先
    pub fn insert_export(&self, export_id: String, writer: CsvWriter) {
        let mut exports = self.exports.lock().expect("書き出し表のロックが壊れている");
        exports.insert(export_id, writer);
    }

    /// 書き出し中の CSV を取り出して登録から外す。
    ///
    /// # 引数
    ///
    /// * `export_id` - 書き出しの識別子
    pub fn take_export(&self, export_id: &str) -> Option<CsvWriter> {
        let mut exports = self.exports.lock().expect("書き出し表のロックが壊れている");
        exports.remove(export_id)
    }

    /// 書き出し中の CSV へ処理を当てる。
    ///
    /// 書き出しは一連の呼び出しにまたがるため、状態を取り出さずにその場で使う。
    ///
    /// # 引数
    ///
    /// * `export_id` - 書き出しの識別子
    /// * `work` - 書き出し先に対して行う処理
    pub fn with_export<T>(
        &self,
        export_id: &str,
        work: impl FnOnce(&mut CsvWriter) -> DbResult<T>,
    ) -> DbResult<T> {
        let mut exports = self.exports.lock().expect("書き出し表のロックが壊れている");
        let writer = exports
            .get_mut(export_id)
            .ok_or_else(|| DbError::storage("書き出しは既に終わっています"))?;
        work(writer)
    }
}

/// アプリの設定ディレクトリの下のパスを求める。
///
/// # 引数
///
/// * `app` - アプリの手綱
/// * `file_name` - ファイル名
pub fn config_path(app: &tauri::AppHandle, file_name: &str) -> DbResult<PathBuf> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(file_name))
        .map_err(|error| DbError::storage(format!("設定の場所を決められませんでした: {error}")))
}

/// ブロッキング処理を専用スレッドへ逃がす。
///
/// アクターへの命令は同期的に待つため、tokio のワーカー上で直接呼ぶと
/// UI の応答が止まる。
///
/// # 引数
///
/// * `work` - 別スレッドで走らせる処理
pub async fn run_blocking<T, F>(work: F) -> DbResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> DbResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| DbError::execute(format!("処理を実行できませんでした: {error}")))?
}
