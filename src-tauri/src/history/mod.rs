//! クエリ履歴とセッション復元の保管庫（ADR 0005）。
//!
//! 履歴は全接続を横断する 1 つの保管庫である。サイドバーの「この接続のみ /
//! 全接続」の切替がある以上、接続ごとにファイルを分けることはできない。
//! 保持期間は無制限とし、代わりに一括削除と 1 件ごとの削除を用意する。
//!
//! セッション復元（エディタタブ・サイドバーの選択セグメント・ペインの寸法）も
//! 同じ SQLite に置く。テーブルが 1 つ増えるだけで済むためである。結果セット・
//! スキーマツリーの展開状態・接続そのものは復元しない。
//!
//! 保存済みクエリ（ADR 0018）も同じ保管庫に置く。履歴と同じく全接続を横断する
//! 1 つの表であり、保存したときの接続名を添えてスコープ絞り込みに使う。

use crate::db::error::{DbError, DbErrorKind};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

/// 履歴に積む 1 件。実行が終わった時点で記録する。
///
/// `⌘E` / `⇧⌘E` による実行計画の生成は記録しない（ADR 0005）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewHistoryEntry {
    /// SQL 全文。切り詰めない。
    pub sql: String,
    /// 実行した接続の表示名。
    pub connection_name: String,
    /// 実行を始めた時刻（Unix エポックからのミリ秒）。
    pub started_at: i64,
    pub elapsed_ms: i64,
    /// 取得できた行数。問い合わせ以外や失敗では `None`。
    pub row_count: Option<i64>,
    pub succeeded: bool,
    /// 失敗したときのメッセージ。
    pub error_message: Option<String>,
}

/// 保存済みの履歴 1 件。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: i64,
    pub sql: String,
    pub connection_name: String,
    pub started_at: i64,
    pub elapsed_ms: i64,
    pub row_count: Option<i64>,
    pub succeeded: bool,
    pub error_message: Option<String>,
}

/// 履歴の絞り込み条件。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HistoryQuery {
    /// 接続名。`None` なら全接続（サイドバーのスコープ切替に対応する）。
    #[serde(default)]
    pub connection_name: Option<String>,
    /// SQL の部分一致で絞る語。
    #[serde(default)]
    pub search: Option<String>,
    /// 取り出す最大件数。
    pub limit: u32,
}

/// 保存するクエリ 1 件（ADR 0018）。
///
/// バインド変数の**値**は保存しない。履歴と同じく個人情報が入りうるためである
/// （ADR 0005）。保存するのは SQL 本体だけである。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSavedQuery {
    /// 一覧に出す名前。重複は許す。
    pub name: String,
    /// SQL 全文。切り詰めない。
    pub sql: String,
    /// 保存したときの接続の表示名。スコープ絞り込みに使う。
    pub connection_name: String,
    /// 保存した時刻（Unix エポックからのミリ秒）。
    pub saved_at: i64,
}

/// 保存済みのクエリ 1 件。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedQuery {
    pub id: i64,
    pub name: String,
    pub sql: String,
    pub connection_name: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 保存済みクエリの絞り込み条件。
///
/// 形は `HistoryQuery` に揃えてある。サイドバーのスコープ切替と検索欄が
/// 履歴と同じ作りであるためである。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SavedQueryQuery {
    /// 接続名。`None` なら全接続。
    #[serde(default)]
    pub connection_name: Option<String>,
    /// 名前または SQL の部分一致で絞る語。
    #[serde(default)]
    pub search: Option<String>,
    /// 取り出す最大件数。
    pub limit: u32,
}

/// 復元するエディタタブ 1 枚。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTab {
    pub id: String,
    /// 小槌が付ける自動の名前（`無題-1.sql` やファイル名）。
    pub name: String,
    /// 利用者が付け直した名前（ADR 0032）。付け直していなければ `None`。
    ///
    /// この項目を持たない古いセッションを読んでも落ちないよう、省略できる。
    #[serde(default)]
    pub custom_name: Option<String>,
    /// 保存先のファイル。未保存のバッファでは `None`。
    pub file_path: Option<String>,
    /// 未保存のバッファも含めて丸ごと保存する。タブの `●` 印が前提とする挙動である。
    pub content: String,
    pub dirty: bool,
}

/// ウィンドウ 1 つぶんの復元対象。
///
/// ペインの寸法（サイドバーの幅・エディタの高さ）もここに置く。ウィンドウごとに
/// 違ってよい値であり、`settings.toml` ではなくセッションに属するためである。
/// この 2 つを持たない古いセッションを読んでも落ちないよう、どちらも省略できる。
///
/// `PartialEq` は導出するが `Eq` は導出しない。寸法が `f64` だからである。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionState {
    /// 並び順のままのタブ。
    pub tabs: Vec<SessionTab>,
    pub active_tab_id: Option<String>,
    /// サイドバーの選択セグメント。
    pub sidebar_segment: Option<String>,
    /// サイドバーの幅（px）。保存されていなければ `None`。
    #[serde(default)]
    pub sidebar_width: Option<f64>,
    /// エディタの高さ（px）。保存されていなければ `None`。
    #[serde(default)]
    pub editor_height: Option<f64>,
}

/// テーブル定義。起動のたびに流しても安全な形で書く。
const SCHEMA: &str = r#"
create table if not exists query_history (
    id integer primary key autoincrement,
    sql text not null,
    connection_name text not null,
    started_at integer not null,
    elapsed_ms integer not null,
    row_count integer,
    succeeded integer not null,
    error_message text
);
create index if not exists idx_query_history_started_at
    on query_history (started_at desc);

create table if not exists session_tab (
    window_label text not null,
    position integer not null,
    id text not null,
    name text not null,
    custom_name text,
    file_path text,
    content text not null,
    dirty integer not null,
    primary key (window_label, id)
);

create table if not exists session_state (
    window_label text primary key,
    active_tab_id text,
    sidebar_segment text
);

create table if not exists saved_query (
    id integer primary key autoincrement,
    name text not null,
    sql text not null,
    connection_name text not null,
    created_at integer not null,
    updated_at integer not null
);
create index if not exists idx_saved_query_updated_at
    on saved_query (updated_at desc);
"#;

/// `session_state` に後から足した列。
///
/// `create table if not exists` は既にあるテーブルへ列を足さない。ペインの寸法を
/// 導入する前に作られたファイルでも動くよう、無ければ足す。
const SESSION_STATE_ADDED_COLUMNS: &[(&str, &str)] =
    &[("sidebar_width", "real"), ("editor_height", "real")];

/// `session_tab` に後から足した列。
///
/// 利用者が付け直したタブの名前（ADR 0032）である。理由は
/// `SESSION_STATE_ADDED_COLUMNS` と同じで、古いファイルをそのまま開くためである。
const SESSION_TAB_ADDED_COLUMNS: &[(&str, &str)] = &[("custom_name", "text")];

/// SQLite のエラーをアプリのエラーへ変換する。
fn to_db_error(context: &str, error: rusqlite::Error) -> DbError {
    DbError::new(DbErrorKind::Storage, format!("{context}: {error}"))
}

/// 履歴とセッションの保管庫。
///
/// `rusqlite::Connection` は `Sync` ではないため `Mutex` で包む。履歴の書き込みは
/// SQL 実行 1 回につき 1 度しか起きず、待ちが問題になる場面は無い。
pub struct HistoryStore {
    connection: Mutex<Connection>,
}

impl HistoryStore {
    /// ファイルを開く。無ければ作る。
    ///
    /// # 引数
    ///
    /// * `path` - SQLite ファイルのパス
    pub fn open(path: &Path) -> Result<Self, DbError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                DbError::new(
                    DbErrorKind::Storage,
                    format!("履歴の置き場所を作れませんでした: {error}"),
                )
            })?;
        }

        let connection =
            Connection::open(path).map_err(|error| to_db_error("履歴を開けませんでした", error))?;
        Self::from_connection(connection)
    }

    /// メモリ上の保管庫を作る。テストで使う。
    pub fn open_in_memory() -> Result<Self, DbError> {
        let connection = Connection::open_in_memory()
            .map_err(|error| to_db_error("履歴を開けませんでした", error))?;
        Self::from_connection(connection)
    }

    /// 接続にテーブルを用意して保管庫を組み立てる。
    fn from_connection(connection: Connection) -> Result<Self, DbError> {
        connection
            .execute_batch(SCHEMA)
            .map_err(|error| to_db_error("履歴のテーブルを作れませんでした", error))?;
        add_missing_columns(&connection, "session_state", SESSION_STATE_ADDED_COLUMNS)?;
        add_missing_columns(&connection, "session_tab", SESSION_TAB_ADDED_COLUMNS)?;
        Ok(HistoryStore {
            connection: Mutex::new(connection),
        })
    }

    /// ロック済みの接続を借りる。
    fn locked(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.connection.lock().expect("履歴のロックが壊れている")
    }

    /// 履歴を 1 件記録し、採番された ID を返す。
    ///
    /// 成功・失敗を問わず記録する。
    ///
    /// # 引数
    ///
    /// * `entry` - 記録する内容
    pub fn record(&self, entry: &NewHistoryEntry) -> Result<i64, DbError> {
        let connection = self.locked();
        connection
            .execute(
                "insert into query_history
                     (sql, connection_name, started_at, elapsed_ms, row_count, succeeded, error_message)
                 values (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    entry.sql,
                    entry.connection_name,
                    entry.started_at,
                    entry.elapsed_ms,
                    entry.row_count,
                    entry.succeeded,
                    entry.error_message,
                ],
            )
            .map_err(|error| to_db_error("履歴を記録できませんでした", error))?;
        Ok(connection.last_insert_rowid())
    }

    /// 履歴を新しい順に取り出す。
    ///
    /// # 引数
    ///
    /// * `query` - 絞り込み条件
    pub fn list(&self, query: &HistoryQuery) -> Result<Vec<HistoryEntry>, DbError> {
        let connection = self.locked();

        // 条件は 2 つとも省略できるため、`is null or …` で分岐を SQL 側へ寄せる。
        let mut statement = connection
            .prepare(
                "select id, sql, connection_name, started_at, elapsed_ms,
                        row_count, succeeded, error_message
                 from query_history
                 where (?1 is null or connection_name = ?1)
                   and (?2 is null or sql like ?2 escape '\\')
                 order by started_at desc, id desc
                 limit ?3",
            )
            .map_err(|error| to_db_error("履歴を読み出せませんでした", error))?;

        let pattern = query
            .search
            .as_deref()
            .map(|search| format!("%{}%", escape_like(search)));

        let rows = statement
            .query_map(
                params![query.connection_name, pattern, query.limit],
                |row| {
                    Ok(HistoryEntry {
                        id: row.get(0)?,
                        sql: row.get(1)?,
                        connection_name: row.get(2)?,
                        started_at: row.get(3)?,
                        elapsed_ms: row.get(4)?,
                        row_count: row.get(5)?,
                        succeeded: row.get(6)?,
                        error_message: row.get(7)?,
                    })
                },
            )
            .map_err(|error| to_db_error("履歴を読み出せませんでした", error))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| to_db_error("履歴を読み出せませんでした", error))
    }

    /// 履歴を 1 件削除する。
    ///
    /// `alter user … identified by …` のような SQL が平文で残るのを消すための
    /// 操作である（ADR 0005）。
    ///
    /// # 引数
    ///
    /// * `id` - 削除する履歴の ID
    pub fn delete(&self, id: i64) -> Result<bool, DbError> {
        let connection = self.locked();
        let deleted = connection
            .execute("delete from query_history where id = ?1", params![id])
            .map_err(|error| to_db_error("履歴を削除できませんでした", error))?;
        Ok(deleted > 0)
    }

    /// 履歴を全件削除し、消した件数を返す。設定画面の一括削除に対応する。
    pub fn delete_all(&self) -> Result<usize, DbError> {
        let connection = self.locked();
        connection
            .execute("delete from query_history", [])
            .map_err(|error| to_db_error("履歴を削除できませんでした", error))
    }

    /// クエリを 1 件保存し、採番された ID を返す（ADR 0018）。
    ///
    /// 同じ名前を弾かない。名前は目印であって鍵ではないためである。
    ///
    /// # 引数
    ///
    /// * `query` - 保存する内容
    pub fn save_query(&self, query: &NewSavedQuery) -> Result<i64, DbError> {
        let connection = self.locked();
        connection
            .execute(
                "insert into saved_query
                     (name, sql, connection_name, created_at, updated_at)
                 values (?1, ?2, ?3, ?4, ?4)",
                params![query.name, query.sql, query.connection_name, query.saved_at,],
            )
            .map_err(|error| to_db_error("クエリを保存できませんでした", error))?;
        Ok(connection.last_insert_rowid())
    }

    /// 保存済みクエリを新しい順に取り出す。
    ///
    /// 並びは更新日時の降順である。使うたびに名前を直したものが上に来るほうが、
    /// 手元でよく使うものへ早く届く。
    ///
    /// # 引数
    ///
    /// * `query` - 絞り込み条件
    pub fn list_queries(&self, query: &SavedQueryQuery) -> Result<Vec<SavedQuery>, DbError> {
        let connection = self.locked();

        // 条件は 2 つとも省略できるため、`is null or …` で分岐を SQL 側へ寄せる。
        // 検索語は名前と SQL の両方へ当てる。名前を思い出せなくても中身で辿れる。
        let mut statement = connection
            .prepare(
                "select id, name, sql, connection_name, created_at, updated_at
                 from saved_query
                 where (?1 is null or connection_name = ?1)
                   and (?2 is null
                        or name like ?2 escape '\\'
                        or sql like ?2 escape '\\')
                 order by updated_at desc, id desc
                 limit ?3",
            )
            .map_err(|error| to_db_error("保存済みクエリを読み出せませんでした", error))?;

        let pattern = query
            .search
            .as_deref()
            .map(|search| format!("%{}%", escape_like(search)));

        let rows = statement
            .query_map(
                params![query.connection_name, pattern, query.limit],
                |row| {
                    Ok(SavedQuery {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        sql: row.get(2)?,
                        connection_name: row.get(3)?,
                        created_at: row.get(4)?,
                        updated_at: row.get(5)?,
                    })
                },
            )
            .map_err(|error| to_db_error("保存済みクエリを読み出せませんでした", error))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| to_db_error("保存済みクエリを読み出せませんでした", error))
    }

    /// 保存済みクエリの名前と SQL を書き換える。
    ///
    /// 名前の変更も本文の上書きもこの 1 つで済ませる。作成日時は動かさない。
    ///
    /// # 引数
    ///
    /// * `id` - 対象の ID
    /// * `name` - 新しい名前
    /// * `sql` - 新しい SQL
    /// * `updated_at` - 更新した時刻（Unix エポックからのミリ秒）
    pub fn update_query(
        &self,
        id: i64,
        name: &str,
        sql: &str,
        updated_at: i64,
    ) -> Result<bool, DbError> {
        let connection = self.locked();
        let updated = connection
            .execute(
                "update saved_query set name = ?2, sql = ?3, updated_at = ?4 where id = ?1",
                params![id, name, sql, updated_at],
            )
            .map_err(|error| to_db_error("保存済みクエリを更新できませんでした", error))?;
        Ok(updated > 0)
    }

    /// 保存済みクエリを 1 件削除する。
    ///
    /// # 引数
    ///
    /// * `id` - 削除する ID
    pub fn delete_query(&self, id: i64) -> Result<bool, DbError> {
        let connection = self.locked();
        let deleted = connection
            .execute("delete from saved_query where id = ?1", params![id])
            .map_err(|error| to_db_error("保存済みクエリを削除できませんでした", error))?;
        Ok(deleted > 0)
    }

    /// ウィンドウ 1 つぶんのセッションを保存する。
    ///
    /// 以前の内容は消してから入れ直す。タブの削除と並べ替えを別々に追跡するより
    /// 単純で、量も高々数十件である。
    ///
    /// # 引数
    ///
    /// * `window_label` - ウィンドウのラベル（ADR 0009）
    /// * `state` - 保存する内容
    pub fn save_session(&self, window_label: &str, state: &SessionState) -> Result<(), DbError> {
        let mut connection = self.locked();
        let transaction = connection
            .transaction()
            .map_err(|error| to_db_error("セッションを保存できませんでした", error))?;

        transaction
            .execute(
                "delete from session_tab where window_label = ?1",
                params![window_label],
            )
            .map_err(|error| to_db_error("セッションを保存できませんでした", error))?;

        for (position, tab) in state.tabs.iter().enumerate() {
            transaction
                .execute(
                    "insert into session_tab
                         (window_label, position, id, name, custom_name, file_path, content, dirty)
                     values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![
                        window_label,
                        position as i64,
                        tab.id,
                        tab.name,
                        tab.custom_name,
                        tab.file_path,
                        tab.content,
                        tab.dirty,
                    ],
                )
                .map_err(|error| to_db_error("セッションを保存できませんでした", error))?;
        }

        transaction
            .execute(
                "insert into session_state
                     (window_label, active_tab_id, sidebar_segment, sidebar_width, editor_height)
                 values (?1, ?2, ?3, ?4, ?5)
                 on conflict (window_label) do update set
                     active_tab_id = excluded.active_tab_id,
                     sidebar_segment = excluded.sidebar_segment,
                     sidebar_width = excluded.sidebar_width,
                     editor_height = excluded.editor_height",
                params![
                    window_label,
                    state.active_tab_id,
                    state.sidebar_segment,
                    state.sidebar_width,
                    state.editor_height,
                ],
            )
            .map_err(|error| to_db_error("セッションを保存できませんでした", error))?;

        transaction
            .commit()
            .map_err(|error| to_db_error("セッションを保存できませんでした", error))
    }

    /// ウィンドウ 1 つぶんのセッションを読む。
    ///
    /// 保存されていなければ空の状態を返す。初回起動を特別扱いしないためである。
    ///
    /// # 引数
    ///
    /// * `window_label` - ウィンドウのラベル
    pub fn load_session(&self, window_label: &str) -> Result<SessionState, DbError> {
        let connection = self.locked();

        let mut statement = connection
            .prepare(
                "select id, name, custom_name, file_path, content, dirty
                 from session_tab where window_label = ?1 order by position",
            )
            .map_err(|error| to_db_error("セッションを読み出せませんでした", error))?;

        let tabs = statement
            .query_map(params![window_label], |row| {
                Ok(SessionTab {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    custom_name: row.get(2)?,
                    file_path: row.get(3)?,
                    content: row.get(4)?,
                    dirty: row.get(5)?,
                })
            })
            .map_err(|error| to_db_error("セッションを読み出せませんでした", error))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| to_db_error("セッションを読み出せませんでした", error))?;

        type Meta = (Option<String>, Option<String>, Option<f64>, Option<f64>);
        let meta: Option<Meta> = connection
            .query_row(
                "select active_tab_id, sidebar_segment, sidebar_width, editor_height
                 from session_state where window_label = ?1",
                params![window_label],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()
            .map_err(|error| to_db_error("セッションを読み出せませんでした", error))?;

        let (active_tab_id, sidebar_segment, sidebar_width, editor_height) =
            meta.unwrap_or((None, None, None, None));

        Ok(SessionState {
            tabs,
            active_tab_id,
            sidebar_segment,
            sidebar_width,
            editor_height,
        })
    }
}

/// 後から足した列を、無ければ足す。
///
/// 古いファイルをそのまま開けるようにするための移行である。列を消すことはしない。
/// `create table if not exists` は既にあるテーブルへ列を足さないため、ここで補う。
///
/// # 引数
///
/// * `connection` - 対象の接続
/// * `table` - 対象のテーブル名
/// * `columns` - 足すべき列の名前と型
fn add_missing_columns(
    connection: &Connection,
    table: &str,
    columns: &[(&str, &str)],
) -> Result<(), DbError> {
    let existing: Vec<String> = {
        let mut statement = connection
            .prepare(&format!("select name from pragma_table_info('{table}')"))
            .map_err(|error| to_db_error("セッションの列を調べられませんでした", error))?;
        let names = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| to_db_error("セッションの列を調べられませんでした", error))?;
        names
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| to_db_error("セッションの列を調べられませんでした", error))?
    };

    for (name, kind) in columns {
        if existing.iter().any(|column| column == name) {
            continue;
        }
        connection
            .execute_batch(&format!("alter table {table} add column {name} {kind}"))
            .map_err(|error| to_db_error("セッションの列を足せませんでした", error))?;
    }

    Ok(())
}

/// `like` のワイルドカードを打ち消す。
///
/// 利用者の入力する検索語に `%` や `_` が含まれても、字面どおりに探せるようにする。
///
/// # 引数
///
/// * `search` - 検索語
fn escape_like(search: &str) -> String {
    search
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn 履歴を作る(sql: &str, connection_name: &str, started_at: i64) -> NewHistoryEntry {
        NewHistoryEntry {
            sql: String::from(sql),
            connection_name: String::from(connection_name),
            started_at,
            elapsed_ms: 12,
            row_count: Some(3),
            succeeded: true,
            error_message: None,
        }
    }

    fn 全件() -> HistoryQuery {
        HistoryQuery {
            connection_name: None,
            search: None,
            limit: 100,
        }
    }

    #[test]
    fn 記録した履歴を読み戻せる() {
        // Arrange
        let store = HistoryStore::open_in_memory().unwrap();
        let entry = 履歴を作る("select 1 from dual", "開発", 1_700_000_000_000);

        // Act
        let id = store.record(&entry).unwrap();
        let listed = store.list(&全件()).unwrap();

        // Assert
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, id);
        assert_eq!(listed[0].sql, "select 1 from dual");
        assert_eq!(listed[0].connection_name, "開発");
        assert_eq!(listed[0].row_count, Some(3));
        assert!(listed[0].succeeded);
    }

    #[test]
    fn 失敗した実行も記録される() {
        // Arrange
        let store = HistoryStore::open_in_memory().unwrap();
        let mut entry = 履歴を作る("select * from nowhere", "開発", 1);
        entry.succeeded = false;
        entry.row_count = None;
        entry.error_message = Some(String::from("ORA-00942"));

        // Act
        store.record(&entry).unwrap();
        let listed = store.list(&全件()).unwrap();

        // Assert
        assert!(!listed[0].succeeded);
        assert_eq!(listed[0].error_message, Some(String::from("ORA-00942")));
        assert_eq!(listed[0].row_count, None);
    }

    #[test]
    fn 履歴は新しい順に並ぶ() {
        // Arrange
        let store = HistoryStore::open_in_memory().unwrap();
        store.record(&履歴を作る("古い", "開発", 100)).unwrap();
        store.record(&履歴を作る("新しい", "開発", 300)).unwrap();
        store.record(&履歴を作る("中くらい", "開発", 200)).unwrap();

        // Act
        let listed = store.list(&全件()).unwrap();

        // Assert
        let sqls: Vec<&str> = listed.iter().map(|entry| entry.sql.as_str()).collect();
        assert_eq!(sqls, vec!["新しい", "中くらい", "古い"]);
    }

    #[test]
    fn 接続名を指定するとその接続の履歴だけが返る() {
        // Arrange
        let store = HistoryStore::open_in_memory().unwrap();
        store.record(&履歴を作る("開発の SQL", "開発", 1)).unwrap();
        store.record(&履歴を作る("本番の SQL", "本番", 2)).unwrap();

        // Act
        let listed = store
            .list(&HistoryQuery {
                connection_name: Some(String::from("本番")),
                ..全件()
            })
            .unwrap();

        // Assert
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].sql, "本番の SQL");
    }

    #[test]
    fn 接続名を省略すると全接続の履歴が返る() {
        // Arrange
        let store = HistoryStore::open_in_memory().unwrap();
        store.record(&履歴を作る("開発の SQL", "開発", 1)).unwrap();
        store.record(&履歴を作る("本番の SQL", "本番", 2)).unwrap();

        // Act
        let listed = store.list(&全件()).unwrap();

        // Assert
        assert_eq!(listed.len(), 2);
    }

    #[test]
    fn 検索語はsqlの部分一致で絞り込む() {
        // Arrange
        let store = HistoryStore::open_in_memory().unwrap();
        store
            .record(&履歴を作る("select * from users", "開発", 1))
            .unwrap();
        store
            .record(&履歴を作る("select * from orders", "開発", 2))
            .unwrap();

        // Act
        let listed = store
            .list(&HistoryQuery {
                search: Some(String::from("users")),
                ..全件()
            })
            .unwrap();

        // Assert
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].sql, "select * from users");
    }

    #[test]
    fn 検索語のワイルドカードは字面どおりに扱われる() {
        // Arrange
        let store = HistoryStore::open_in_memory().unwrap();
        store
            .record(&履歴を作る("select '100%' from dual", "開発", 1))
            .unwrap();
        store
            .record(&履歴を作る("select 1 from dual", "開発", 2))
            .unwrap();

        // Act
        let listed = store
            .list(&HistoryQuery {
                search: Some(String::from("100%")),
                ..全件()
            })
            .unwrap();

        // Assert
        assert_eq!(listed.len(), 1);
    }

    #[test]
    fn 件数の上限を超えた履歴は返らない() {
        // Arrange
        let store = HistoryStore::open_in_memory().unwrap();
        for index in 0..5 {
            store
                .record(&履歴を作る("select 1", "開発", index))
                .unwrap();
        }

        // Act
        let listed = store
            .list(&HistoryQuery {
                limit: 2, ..全件()
            })
            .unwrap();

        // Assert
        assert_eq!(listed.len(), 2);
    }

    #[test]
    fn 履歴を一件だけ削除できる() {
        // Arrange
        let store = HistoryStore::open_in_memory().unwrap();
        let id = store.record(&履歴を作る("消す", "開発", 1)).unwrap();
        store.record(&履歴を作る("残す", "開発", 2)).unwrap();

        // Act
        let deleted = store.delete(id).unwrap();
        let listed = store.list(&全件()).unwrap();

        // Assert
        assert!(deleted);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].sql, "残す");
    }

    #[test]
    fn 存在しない履歴の削除は偽を返す() {
        // Arrange
        let store = HistoryStore::open_in_memory().unwrap();

        // Act
        let deleted = store.delete(999).unwrap();

        // Assert
        assert!(!deleted);
    }

    #[test]
    fn 履歴を一括削除できる() {
        // Arrange
        let store = HistoryStore::open_in_memory().unwrap();
        store.record(&履歴を作る("a", "開発", 1)).unwrap();
        store.record(&履歴を作る("b", "開発", 2)).unwrap();

        // Act
        let deleted = store.delete_all().unwrap();

        // Assert
        assert_eq!(deleted, 2);
        assert!(store.list(&全件()).unwrap().is_empty());
    }

    fn 保存クエリを作る(name: &str, sql: &str, connection_name: &str) -> NewSavedQuery {
        NewSavedQuery {
            name: String::from(name),
            sql: String::from(sql),
            connection_name: String::from(connection_name),
            saved_at: 1_700_000_000_000,
        }
    }

    fn 保存クエリ全件() -> SavedQueryQuery {
        SavedQueryQuery {
            connection_name: None,
            search: None,
            limit: 100,
        }
    }

    #[test]
    fn 保存したクエリを読み戻せる() {
        // Arrange
        let store = HistoryStore::open_in_memory().unwrap();
        let query = 保存クエリを作る("今日の売上", "select * from sales", "開発");

        // Act
        let id = store.save_query(&query).unwrap();
        let listed = store.list_queries(&保存クエリ全件()).unwrap();

        // Assert
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, id);
        assert_eq!(listed[0].name, "今日の売上");
        assert_eq!(listed[0].sql, "select * from sales");
        assert_eq!(listed[0].connection_name, "開発");
        assert_eq!(listed[0].created_at, 1_700_000_000_000);
        assert_eq!(listed[0].updated_at, 1_700_000_000_000);
    }

    #[test]
    fn 保存クエリは更新日時の新しい順に並ぶ() {
        // Arrange
        let store = HistoryStore::open_in_memory().unwrap();
        let mut 古い = 保存クエリを作る("古い", "select 1 from dual", "開発");
        古い.saved_at = 1_000;
        let mut 新しい = 保存クエリを作る("新しい", "select 2 from dual", "開発");
        新しい.saved_at = 2_000;
        store.save_query(&古い).unwrap();
        store.save_query(&新しい).unwrap();

        // Act
        let listed = store.list_queries(&保存クエリ全件()).unwrap();

        // Assert
        assert_eq!(
            listed.iter().map(|q| q.name.as_str()).collect::<Vec<_>>(),
            vec!["新しい", "古い"]
        );
    }

    #[test]
    fn 接続名を指定すると保存クエリはその接続のものだけになる() {
        // Arrange
        let store = HistoryStore::open_in_memory().unwrap();
        store
            .save_query(&保存クエリを作る(
                "開発の",
                "select 1 from dual",
                "開発",
            ))
            .unwrap();
        store
            .save_query(&保存クエリを作る(
                "本番の",
                "select 2 from dual",
                "本番",
            ))
            .unwrap();

        // Act
        let listed = store
            .list_queries(&SavedQueryQuery {
                connection_name: Some(String::from("本番")),
                ..保存クエリ全件()
            })
            .unwrap();

        // Assert
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "本番の");
    }

    #[test]
    fn 保存クエリの検索語は名前とsqlの両方に当たる() {
        // Arrange
        let store = HistoryStore::open_in_memory().unwrap();
        store
            .save_query(&保存クエリを作る(
                "売上",
                "select 1 from dual",
                "開発",
            ))
            .unwrap();
        store
            .save_query(&保存クエリを作る(
                "在庫",
                "select * from sales",
                "開発",
            ))
            .unwrap();
        store
            .save_query(&保存クエリを作る(
                "無関係",
                "select 2 from dual",
                "開発",
            ))
            .unwrap();

        // Act
        let 名前で当たる = store
            .list_queries(&SavedQueryQuery {
                search: Some(String::from("売上")),
                ..保存クエリ全件()
            })
            .unwrap();
        let sqlで当たる = store
            .list_queries(&SavedQueryQuery {
                search: Some(String::from("sales")),
                ..保存クエリ全件()
            })
            .unwrap();

        // Assert
        assert_eq!(名前で当たる.len(), 1);
        assert_eq!(名前で当たる[0].name, "売上");
        assert_eq!(sqlで当たる.len(), 1);
        assert_eq!(sqlで当たる[0].name, "在庫");
    }

    #[test]
    fn 保存クエリの検索語のワイルドカードは字面どおりに扱われる() {
        // Arrange
        let store = HistoryStore::open_in_memory().unwrap();
        store
            .save_query(&保存クエリを作る(
                "100%の集計",
                "select 1 from dual",
                "開発",
            ))
            .unwrap();
        store
            .save_query(&保存クエリを作る(
                "ただの集計",
                "select 2 from dual",
                "開発",
            ))
            .unwrap();

        // Act
        let listed = store
            .list_queries(&SavedQueryQuery {
                search: Some(String::from("%の")),
                ..保存クエリ全件()
            })
            .unwrap();

        // Assert
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "100%の集計");
    }

    #[test]
    fn 保存クエリの名前とsqlを更新できる() {
        // Arrange
        let store = HistoryStore::open_in_memory().unwrap();
        let id = store
            .save_query(&保存クエリを作る(
                "仮の名前",
                "select 1 from dual",
                "開発",
            ))
            .unwrap();

        // Act
        let 更新できた = store
            .update_query(id, "本当の名前", "select 2 from dual", 1_700_000_009_999)
            .unwrap();
        let listed = store.list_queries(&保存クエリ全件()).unwrap();

        // Assert
        assert!(更新できた);
        assert_eq!(listed[0].name, "本当の名前");
        assert_eq!(listed[0].sql, "select 2 from dual");
        assert_eq!(listed[0].created_at, 1_700_000_000_000);
        assert_eq!(listed[0].updated_at, 1_700_000_009_999);
    }

    #[test]
    fn 存在しない保存クエリの更新は偽を返す() {
        // Arrange
        let store = HistoryStore::open_in_memory().unwrap();

        // Act
        let 更新できた = store
            .update_query(999, "名前", "select 1 from dual", 1)
            .unwrap();

        // Assert
        assert!(!更新できた);
    }

    #[test]
    fn 保存クエリを一件だけ削除できる() {
        // Arrange
        let store = HistoryStore::open_in_memory().unwrap();
        let id = store
            .save_query(&保存クエリを作る(
                "消す",
                "select 1 from dual",
                "開発",
            ))
            .unwrap();
        store
            .save_query(&保存クエリを作る(
                "残す",
                "select 2 from dual",
                "開発",
            ))
            .unwrap();

        // Act
        let 消せた = store.delete_query(id).unwrap();
        let listed = store.list_queries(&保存クエリ全件()).unwrap();

        // Assert
        assert!(消せた);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "残す");
    }

    #[test]
    fn 存在しない保存クエリの削除は偽を返す() {
        // Arrange
        let store = HistoryStore::open_in_memory().unwrap();

        // Act
        let 消せた = store.delete_query(999).unwrap();

        // Assert
        assert!(!消せた);
    }

    #[test]
    fn 保存クエリの表が無い古いファイルでも開ける() {
        // Arrange: 保存済みクエリを導入する前と同じ、履歴の表だけを持つファイル
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.sqlite3");
        {
            let connection = Connection::open(&path).unwrap();
            connection
                .execute_batch(
                    "create table query_history (
                         id integer primary key autoincrement,
                         sql text not null,
                         connection_name text not null,
                         started_at integer not null,
                         elapsed_ms integer not null,
                         row_count integer,
                         succeeded integer not null,
                         error_message text
                     );
                     insert into query_history
                         (sql, connection_name, started_at, elapsed_ms, succeeded)
                     values ('select 1 from dual', '開発', 1, 2, 1);",
                )
                .unwrap();
        }

        // Act
        let store = HistoryStore::open(&path).unwrap();
        let id = store
            .save_query(&保存クエリを作る(
                "新しく保存",
                "select 1 from dual",
                "開発",
            ))
            .unwrap();

        // Assert: 既存の履歴は残り、保存済みクエリの表が足されている
        assert_eq!(store.list(&全件()).unwrap().len(), 1);
        assert_eq!(store.list_queries(&保存クエリ全件()).unwrap()[0].id, id);
    }

    #[test]
    fn 保存したセッションを並び順のまま読み戻せる() {
        // Arrange
        let store = HistoryStore::open_in_memory().unwrap();
        let state = SessionState {
            tabs: vec![
                SessionTab {
                    id: String::from("t1"),
                    name: String::from("無題-1.sql"),
                    custom_name: None,
                    file_path: None,
                    content: String::from("select 1"),
                    dirty: true,
                },
                SessionTab {
                    id: String::from("t2"),
                    name: String::from("users.sql"),
                    custom_name: None,
                    file_path: Some(String::from("/tmp/users.sql")),
                    content: String::from("select * from users"),
                    dirty: false,
                },
            ],
            active_tab_id: Some(String::from("t2")),
            sidebar_segment: Some(String::from("history")),
            sidebar_width: Some(320.0),
            editor_height: Some(400.0),
        };

        // Act
        store.save_session("main", &state).unwrap();
        let restored = store.load_session("main").unwrap();

        // Assert
        assert_eq!(restored, state);
    }

    #[test]
    fn セッションを保存し直すと古いタブは残らない() {
        // Arrange
        let store = HistoryStore::open_in_memory().unwrap();
        let 二枚 = SessionState {
            tabs: vec![
                SessionTab {
                    id: String::from("t1"),
                    name: String::from("a.sql"),
                    custom_name: None,
                    file_path: None,
                    content: String::new(),
                    dirty: false,
                },
                SessionTab {
                    id: String::from("t2"),
                    name: String::from("b.sql"),
                    custom_name: None,
                    file_path: None,
                    content: String::new(),
                    dirty: false,
                },
            ],
            active_tab_id: Some(String::from("t1")),
            sidebar_segment: None,
            sidebar_width: None,
            editor_height: None,
        };
        store.save_session("main", &二枚).unwrap();

        // Act
        let 一枚 = SessionState {
            tabs: vec![二枚.tabs[1].clone()],
            active_tab_id: Some(String::from("t2")),
            sidebar_segment: None,
            sidebar_width: None,
            editor_height: None,
        };
        store.save_session("main", &一枚).unwrap();
        let restored = store.load_session("main").unwrap();

        // Assert
        assert_eq!(restored.tabs.len(), 1);
        assert_eq!(restored.tabs[0].id, "t2");
    }

    /// タブ 1 枚ぶんの試験用の値を作る。
    ///
    /// # 引数
    ///
    /// * `id` - タブの ID。名前は `<id>.sql` にする
    fn 試験用のタブ(id: &str) -> SessionTab {
        SessionTab {
            id: String::from(id),
            name: format!("{id}.sql"),
            custom_name: None,
            file_path: None,
            content: String::new(),
            dirty: false,
        }
    }

    #[test]
    fn 並べ替えたタブはその順序で復元される() {
        // Arrange: 3 枚を保存したあと、1 枚目を末尾へ動かして保存し直す（ADR 0023）
        let store = HistoryStore::open_in_memory().unwrap();
        let 元の順 = SessionState {
            tabs: vec![試験用のタブ("t1"), 試験用のタブ("t2"), 試験用のタブ("t3")],
            active_tab_id: Some(String::from("t1")),
            sidebar_segment: None,
            sidebar_width: None,
            editor_height: None,
        };
        store.save_session("main", &元の順).unwrap();

        // Act
        let 並べ替えた順 = SessionState {
            tabs: vec![試験用のタブ("t2"), 試験用のタブ("t3"), 試験用のタブ("t1")],
            ..元の順.clone()
        };
        store.save_session("main", &並べ替えた順).unwrap();
        let restored = store.load_session("main").unwrap();

        // Assert
        let ids: Vec<&str> = restored.tabs.iter().map(|tab| tab.id.as_str()).collect();
        assert_eq!(ids, vec!["t2", "t3", "t1"]);
    }

    #[test]
    fn ウィンドウごとにセッションは独立している() {
        // Arrange
        let store = HistoryStore::open_in_memory().unwrap();
        let state = SessionState {
            tabs: vec![SessionTab {
                id: String::from("t1"),
                name: String::from("a.sql"),
                custom_name: None,
                file_path: None,
                content: String::new(),
                dirty: false,
            }],
            active_tab_id: Some(String::from("t1")),
            sidebar_segment: None,
            sidebar_width: None,
            editor_height: None,
        };
        store.save_session("main", &state).unwrap();

        // Act
        let 別ウィンドウ = store.load_session("connection-2").unwrap();

        // Assert
        assert_eq!(別ウィンドウ, SessionState::default());
    }

    #[test]
    fn 保存されていないセッションは空の状態になる() {
        // Arrange
        let store = HistoryStore::open_in_memory().unwrap();

        // Act
        let restored = store.load_session("main").unwrap();

        // Assert
        assert!(restored.tabs.is_empty());
        assert_eq!(restored.active_tab_id, None);
    }

    #[test]
    fn ペインの寸法もセッションとして読み戻せる() {
        // Arrange
        let store = HistoryStore::open_in_memory().unwrap();
        let state = SessionState {
            tabs: Vec::new(),
            active_tab_id: None,
            sidebar_segment: None,
            sidebar_width: Some(312.0),
            editor_height: Some(180.0),
        };

        // Act
        store.save_session("main", &state).unwrap();
        let restored = store.load_session("main").unwrap();

        // Assert
        assert_eq!(restored.sidebar_width, Some(312.0));
        assert_eq!(restored.editor_height, Some(180.0));
    }

    #[test]
    fn 寸法を持たないセッションを読んでもエラーにならない() {
        // Arrange
        let store = HistoryStore::open_in_memory().unwrap();
        store
            .save_session("main", &SessionState::default())
            .unwrap();

        // Act
        let restored = store.load_session("main").unwrap();

        // Assert
        assert_eq!(restored.sidebar_width, None);
        assert_eq!(restored.editor_height, None);
    }

    #[test]
    fn 付け直したタブの名前は保存して読み戻せる() {
        // Arrange
        let store = HistoryStore::open_in_memory().unwrap();
        let mut tab = 試験用のタブ("t1");
        tab.custom_name = Some(String::from("売上集計"));
        let state = SessionState {
            tabs: vec![tab],
            active_tab_id: Some(String::from("t1")),
            sidebar_segment: None,
            sidebar_width: None,
            editor_height: None,
        };

        // Act
        store.save_session("main", &state).unwrap();
        let restored = store.load_session("main").unwrap();

        // Assert
        assert_eq!(restored.tabs.len(), 1);
        assert_eq!(restored.tabs[0].custom_name, Some(String::from("売上集計")));
        // 自動の名前は付け直しても残る（ADR 0032）。
        assert_eq!(restored.tabs[0].name, String::from("t1.sql"));
    }

    #[test]
    fn 名前を付け直していないタブは空のまま読み戻せる() {
        // Arrange
        let store = HistoryStore::open_in_memory().unwrap();
        let state = SessionState {
            tabs: vec![試験用のタブ("t1")],
            active_tab_id: Some(String::from("t1")),
            sidebar_segment: None,
            sidebar_width: None,
            editor_height: None,
        };

        // Act
        store.save_session("main", &state).unwrap();
        let restored = store.load_session("main").unwrap();

        // Assert
        assert_eq!(restored.tabs[0].custom_name, None);
    }

    #[test]
    fn 付け直した名前の列が無い古いファイルでも開ける() {
        // Arrange: `custom_name` を導入する前と同じ形のテーブルだけを作る
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.sqlite3");
        {
            let connection = Connection::open(&path).unwrap();
            connection
                .execute_batch(
                    "create table session_tab (
                         window_label text not null,
                         position integer not null,
                         id text not null,
                         name text not null,
                         file_path text,
                         content text not null,
                         dirty integer not null,
                         primary key (window_label, id)
                     );
                     insert into session_tab
                         (window_label, position, id, name, file_path, content, dirty)
                     values ('main', 0, 't1', '無題-1.sql', null, 'select 1', 0);",
                )
                .unwrap();
        }

        // Act
        let store = HistoryStore::open(&path).unwrap();
        let restored = store.load_session("main").unwrap();

        // Assert
        assert_eq!(restored.tabs.len(), 1);
        assert_eq!(restored.tabs[0].name, String::from("無題-1.sql"));
        assert_eq!(restored.tabs[0].custom_name, None);
        assert_eq!(restored.tabs[0].content, String::from("select 1"));
    }

    #[test]
    fn 付け直した名前を持たないタブでもjsonから読める() {
        // Arrange: `customName` が無い、古い形の JSON
        let json = r#"{"id":"t1","name":"無題-1.sql","filePath":null,"content":"","dirty":false}"#;

        // Act
        let tab: SessionTab = serde_json::from_str(json).unwrap();

        // Assert
        assert_eq!(tab.custom_name, None);
        assert_eq!(tab.name, String::from("無題-1.sql"));
    }

    #[test]
    fn 寸法の列が無い古いファイルでも開ける() {
        // Arrange: 寸法を導入する前と同じ形のテーブルだけを作る
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.sqlite3");
        {
            let connection = Connection::open(&path).unwrap();
            connection
                .execute_batch(
                    "create table session_state (
                         window_label text primary key,
                         active_tab_id text,
                         sidebar_segment text
                     );
                     insert into session_state (window_label, active_tab_id, sidebar_segment)
                     values ('main', 't1', 'history');",
                )
                .unwrap();
        }

        // Act
        let store = HistoryStore::open(&path).unwrap();
        let restored = store.load_session("main").unwrap();

        // Assert
        assert_eq!(restored.active_tab_id, Some(String::from("t1")));
        assert_eq!(restored.sidebar_segment, Some(String::from("history")));
        assert_eq!(restored.sidebar_width, None);
        assert_eq!(restored.editor_height, None);
    }

    #[test]
    fn 寸法を持たないセッションでもjsonから読める() {
        // Arrange: ペインの寸法が無い、古い形の JSON
        let json = r#"{"tabs":[],"activeTabId":null,"sidebarSegment":"schema"}"#;

        // Act
        let state: SessionState = serde_json::from_str(json).unwrap();

        // Assert
        assert_eq!(state.sidebar_width, None);
        assert_eq!(state.editor_height, None);
    }

    #[test]
    fn ファイルに保存した履歴は開き直しても残る() {
        // Arrange
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("履歴").join("history.sqlite3");
        {
            let store = HistoryStore::open(&path).unwrap();
            store.record(&履歴を作る("select 1", "開発", 1)).unwrap();
        }

        // Act
        let store = HistoryStore::open(&path).unwrap();
        let listed = store.list(&全件()).unwrap();

        // Assert
        assert_eq!(listed.len(), 1);
    }
}
