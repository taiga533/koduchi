//! クエリ履歴とセッション復元の保管庫（ADR 0005）。
//!
//! 履歴は全接続を横断する 1 つの保管庫である。サイドバーの「この接続のみ /
//! 全接続」の切替がある以上、接続ごとにファイルを分けることはできない。
//! 保持期間は無制限とし、代わりに一括削除と 1 件ごとの削除を用意する。
//!
//! セッション復元（エディタタブ・サイドバーの選択セグメント・ペインの寸法）も
//! 同じ SQLite に置く。テーブルが 1 つ増えるだけで済むためである。結果セット・
//! スキーマツリーの展開状態・接続そのものは復元しない。

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

/// 復元するエディタタブ 1 枚。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTab {
    pub id: String,
    pub name: String,
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
"#;

/// `session_state` に後から足した列。
///
/// `create table if not exists` は既にあるテーブルへ列を足さない。ペインの寸法を
/// 導入する前に作られたファイルでも動くよう、無ければ足す。
const SESSION_STATE_ADDED_COLUMNS: &[(&str, &str)] =
    &[("sidebar_width", "real"), ("editor_height", "real")];

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
        migrate_session_state(&connection)?;
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
                         (window_label, position, id, name, file_path, content, dirty)
                     values (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        window_label,
                        position as i64,
                        tab.id,
                        tab.name,
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
                "select id, name, file_path, content, dirty
                 from session_tab where window_label = ?1 order by position",
            )
            .map_err(|error| to_db_error("セッションを読み出せませんでした", error))?;

        let tabs = statement
            .query_map(params![window_label], |row| {
                Ok(SessionTab {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    file_path: row.get(2)?,
                    content: row.get(3)?,
                    dirty: row.get(4)?,
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

/// `session_state` に後から足した列を、無ければ足す。
///
/// 古いファイルをそのまま開けるようにするための移行である。列を消すことはしない。
///
/// # 引数
///
/// * `connection` - 対象の接続
fn migrate_session_state(connection: &Connection) -> Result<(), DbError> {
    let existing: Vec<String> = {
        let mut statement = connection
            .prepare("select name from pragma_table_info('session_state')")
            .map_err(|error| to_db_error("セッションの列を調べられませんでした", error))?;
        let names = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| to_db_error("セッションの列を調べられませんでした", error))?;
        names
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| to_db_error("セッションの列を調べられませんでした", error))?
    };

    for (name, kind) in SESSION_STATE_ADDED_COLUMNS {
        if existing.iter().any(|column| column == name) {
            continue;
        }
        connection
            .execute_batch(&format!(
                "alter table session_state add column {name} {kind}"
            ))
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

    #[test]
    fn 保存したセッションを並び順のまま読み戻せる() {
        // Arrange
        let store = HistoryStore::open_in_memory().unwrap();
        let state = SessionState {
            tabs: vec![
                SessionTab {
                    id: String::from("t1"),
                    name: String::from("無題-1.sql"),
                    file_path: None,
                    content: String::from("select 1"),
                    dirty: true,
                },
                SessionTab {
                    id: String::from("t2"),
                    name: String::from("users.sql"),
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
                    file_path: None,
                    content: String::new(),
                    dirty: false,
                },
                SessionTab {
                    id: String::from("t2"),
                    name: String::from("b.sql"),
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

    #[test]
    fn ウィンドウごとにセッションは独立している() {
        // Arrange
        let store = HistoryStore::open_in_memory().unwrap();
        let state = SessionState {
            tabs: vec![SessionTab {
                id: String::from("t1"),
                name: String::from("a.sql"),
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
