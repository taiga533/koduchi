//! 接続ごとのアクタースレッド（ADR 0002）。
//!
//! `oracle` crate は ODPI-C の同期 API であり、実行はスレッドを塞ぐ。Tauri の
//! コマンドを async にしてもその中で同期的に塞げば tokio のワーカーを占有し、
//! UI が止まる。そこで接続ごとに専用の OS スレッドを立て、チャネルで命令を送る。
//!
//! 中止は別の経路から行う。実行中はアクタースレッドが塞がっているため、
//! 命令のチャネル越しには届かない。`Canceller` は `Send + Sync` であり、
//! 呼び出し元のスレッドから直接叩ける。

use crate::db::definition::{ObjectDdl, ObjectDefinition};
use crate::db::driver::{Bind, Canceller, Chunk, Driver, ExecuteOutcome};
use crate::db::error::{DbError, DbResult};
use crate::db::schema::{ObjectKind, SchemaFilter, SchemaNode, TableColumn};
use crate::db::sessions::SessionOverview;
use crate::db::source::{SourceLine, SourceSearchRequest, SourceSearchResult, SourceTarget};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread::{self, JoinHandle};

/// アクタースレッドへ送る命令。
enum Command {
    /// SQL を 1 文実行し、結果を返信用チャネルへ返す。
    Execute {
        sql: String,
        binds: Vec<Bind>,
        chunk_size: usize,
        respond: Sender<DbResult<ExecuteOutcome>>,
    },
    /// 開いているカーソルから続きを取り出す。
    FetchMore {
        chunk_size: usize,
        respond: Sender<DbResult<Chunk>>,
    },
    /// 開いているカーソルを閉じる。
    CloseCursor { respond: Sender<DbResult<()>> },
    /// スキーマツリーの段階 1 を取る（ADR 0007）。
    SchemaOverview {
        filter: SchemaFilter,
        respond: Sender<DbResult<Vec<SchemaNode>>>,
    },
    /// スキーマ 1 つぶんの列情報を取る（ADR 0007 の段階 2）。
    SchemaColumns {
        owner: String,
        respond: Sender<DbResult<Vec<TableColumn>>>,
    },
    /// 見積りだけの実行計画を取る（`⌘E`）。
    ExplainPlan {
        sql: String,
        binds: Vec<Bind>,
        respond: Sender<DbResult<String>>,
    },
    /// 実測付きの実行計画を取る（`⇧⌘E`）。
    ActualPlan {
        sql: String,
        binds: Vec<Bind>,
        respond: Sender<DbResult<String>>,
    },
    /// トランザクションをコミットする（`⌥⌘C`、ADR 0012）。
    Commit { respond: Sender<DbResult<()>> },
    /// トランザクションをロールバックする（`⌥⌘R`、ADR 0012）。
    Rollback { respond: Sender<DbResult<()>> },
    /// テーブル定義ビュー 1 枚ぶんの内容を取る（ADR 0019）。
    ObjectDefinition {
        owner: String,
        name: String,
        kind: ObjectKind,
        respond: Sender<DbResult<ObjectDefinition>>,
    },
    /// オブジェクト 1 つの DDL を取る（ADR 0019）。
    ObjectDdl {
        owner: String,
        name: String,
        kind: ObjectKind,
        respond: Sender<DbResult<ObjectDdl>>,
    },
    /// セッションの一覧を取る（ADR 0017）。
    ListSessions {
        respond: Sender<DbResult<SessionOverview>>,
    },
    /// セッションを 1 つ終了する（ADR 0017）。
    KillSession {
        sid: u32,
        serial: u32,
        respond: Sender<DbResult<()>>,
    },
    /// オブジェクトのソースを横断して検索する（ADR 0021）。
    SearchSource {
        request: SourceSearchRequest,
        respond: Sender<DbResult<SourceSearchResult>>,
    },
    /// 当たった行の前後を読む（ADR 0021）。
    SourceContext {
        target: SourceTarget,
        line: u32,
        respond: Sender<DbResult<Vec<SourceLine>>>,
    },
    /// スレッドを終了する。
    Close,
}

/// 接続 1 本を表す手綱。
///
/// 実体はアクタースレッドの上にあり、この構造体は命令を送る口と中止の経路だけを
/// 持つ。破棄するとアクタースレッドも終了する。
pub struct ConnectionHandle {
    commands: Sender<Command>,
    canceller: Box<dyn Canceller>,
    /// `Drop` で join するため `Option` にしてある。
    thread: Option<JoinHandle<()>>,
}

impl ConnectionHandle {
    /// アクタースレッドを立て、その上で接続を確立する。
    ///
    /// 接続の確立自体も時間がかかるため、呼び出し元のスレッドではなく
    /// アクタースレッドの上で行う。確立できるまで呼び出し元は待つ。
    ///
    /// # 引数
    ///
    /// * `connect` - アクタースレッド上で呼ばれる接続処理
    ///
    /// # 戻り値
    ///
    /// 接続できた場合は手綱。接続に失敗した場合はそのエラー。
    pub fn open<D, F>(connect: F) -> DbResult<Self>
    where
        D: Driver,
        F: FnOnce() -> DbResult<D> + Send + 'static,
    {
        let (command_sender, command_receiver) = mpsc::channel::<Command>();
        let (ready_sender, ready_receiver) = mpsc::channel::<DbResult<Box<dyn Canceller>>>();

        let thread = thread::Builder::new()
            .name(String::from("koduchi-db-connection"))
            .spawn(move || run_actor(connect, ready_sender, command_receiver))
            .map_err(|error| {
                DbError::connect(format!("接続用のスレッドを起動できませんでした: {error}"))
            })?;

        // アクタースレッドが接続を終えるまで待つ。スレッドが応答を返さずに
        // 終わった場合は、接続処理が panic したことを意味する。
        let canceller = ready_receiver
            .recv()
            .map_err(|_| DbError::connect("接続処理が異常終了しました"))??;

        Ok(ConnectionHandle {
            commands: command_sender,
            canceller,
            thread: Some(thread),
        })
    }

    /// SQL を 1 文実行する。
    ///
    /// アクタースレッドが実行を終えるまで待つ。呼び出し元を塞ぐため、Tauri の
    /// コマンドからはブロッキング用のスレッドを介して呼ぶ。
    ///
    /// # 引数
    ///
    /// * `sql` - 実行する SQL
    /// * `binds` - SQL 中のバインド変数へ与える値
    /// * `chunk_size` - 一度に取り出す行数
    pub fn execute(
        &self,
        sql: &str,
        binds: &[Bind],
        chunk_size: usize,
    ) -> DbResult<ExecuteOutcome> {
        let (respond, response) = mpsc::channel();

        self.commands
            .send(Command::Execute {
                sql: sql.to_string(),
                binds: binds.to_vec(),
                chunk_size,
                respond,
            })
            .map_err(|_| DbError::closed())?;

        response.recv().map_err(|_| DbError::closed())?
    }

    /// 開いているカーソルから続きを取り出す（ADR 0003）。
    ///
    /// # 引数
    ///
    /// * `chunk_size` - 一度に取り出す行数
    pub fn fetch_more(&self, chunk_size: usize) -> DbResult<Chunk> {
        let (respond, response) = mpsc::channel();

        self.commands
            .send(Command::FetchMore {
                chunk_size,
                respond,
            })
            .map_err(|_| DbError::closed())?;

        response.recv().map_err(|_| DbError::closed())?
    }

    /// 開いているカーソルを閉じる。
    ///
    /// タブを閉じたときや、結果セットを手放すときに呼ぶ。
    pub fn close_cursor(&self) -> DbResult<()> {
        let (respond, response) = mpsc::channel();

        self.commands
            .send(Command::CloseCursor { respond })
            .map_err(|_| DbError::closed())?;

        response.recv().map_err(|_| DbError::closed())?
    }

    /// スキーマツリーの段階 1 を取る（ADR 0007）。
    ///
    /// # 引数
    ///
    /// * `filter` - 絞り込み条件
    pub fn schema_overview(&self, filter: &SchemaFilter) -> DbResult<Vec<SchemaNode>> {
        let (respond, response) = mpsc::channel();

        self.commands
            .send(Command::SchemaOverview {
                filter: *filter,
                respond,
            })
            .map_err(|_| DbError::closed())?;

        response.recv().map_err(|_| DbError::closed())?
    }

    /// スキーマ 1 つぶんの列情報を取る（ADR 0007 の段階 2）。
    ///
    /// # 引数
    ///
    /// * `owner` - 対象のスキーマ名
    pub fn schema_columns(&self, owner: &str) -> DbResult<Vec<TableColumn>> {
        let (respond, response) = mpsc::channel();

        self.commands
            .send(Command::SchemaColumns {
                owner: owner.to_string(),
                respond,
            })
            .map_err(|_| DbError::closed())?;

        response.recv().map_err(|_| DbError::closed())?
    }

    /// 見積りだけの実行計画を取る（`⌘E`）。
    ///
    /// # 引数
    ///
    /// * `sql` - 計画を見たい SQL
    /// * `binds` - SQL 中のバインド変数へ与える値
    pub fn explain_plan(&self, sql: &str, binds: &[Bind]) -> DbResult<String> {
        let (respond, response) = mpsc::channel();

        self.commands
            .send(Command::ExplainPlan {
                sql: sql.to_string(),
                binds: binds.to_vec(),
                respond,
            })
            .map_err(|_| DbError::closed())?;

        response.recv().map_err(|_| DbError::closed())?
    }

    /// 実測付きの実行計画を取る（`⇧⌘E`）。
    ///
    /// # 引数
    ///
    /// * `sql` - 計画を見たい SQL
    /// * `binds` - SQL 中のバインド変数へ与える値
    pub fn actual_plan(&self, sql: &str, binds: &[Bind]) -> DbResult<String> {
        let (respond, response) = mpsc::channel();

        self.commands
            .send(Command::ActualPlan {
                sql: sql.to_string(),
                binds: binds.to_vec(),
                respond,
            })
            .map_err(|_| DbError::closed())?;

        response.recv().map_err(|_| DbError::closed())?
    }

    /// トランザクションをコミットする（`⌥⌘C`、ADR 0012）。
    ///
    /// 未コミットの変更が無いときに呼んでも害は無い。
    pub fn commit(&self) -> DbResult<()> {
        let (respond, response) = mpsc::channel();

        self.commands
            .send(Command::Commit { respond })
            .map_err(|_| DbError::closed())?;

        response.recv().map_err(|_| DbError::closed())?
    }

    /// トランザクションをロールバックする（`⌥⌘R`、ADR 0012）。
    ///
    /// 未コミットの変更が無いときに呼んでも害は無い。
    pub fn rollback(&self) -> DbResult<()> {
        let (respond, response) = mpsc::channel();

        self.commands
            .send(Command::Rollback { respond })
            .map_err(|_| DbError::closed())?;

        response.recv().map_err(|_| DbError::closed())?
    }

    /// テーブル定義ビュー 1 枚ぶんの内容を取る（ADR 0019）。
    ///
    /// # 引数
    ///
    /// * `owner` - 所有者のスキーマ名
    /// * `name` - オブジェクト名
    /// * `kind` - オブジェクトの種類
    pub fn object_definition(
        &self,
        owner: &str,
        name: &str,
        kind: ObjectKind,
    ) -> DbResult<ObjectDefinition> {
        let (respond, response) = mpsc::channel();

        self.commands
            .send(Command::ObjectDefinition {
                owner: owner.to_string(),
                name: name.to_string(),
                kind,
                respond,
            })
            .map_err(|_| DbError::closed())?;

        response.recv().map_err(|_| DbError::closed())?
    }

    /// オブジェクト 1 つの DDL を取る（ADR 0019）。
    ///
    /// # 引数
    ///
    /// * `owner` - 所有者のスキーマ名
    /// * `name` - オブジェクト名
    /// * `kind` - オブジェクトの種類
    pub fn object_ddl(&self, owner: &str, name: &str, kind: ObjectKind) -> DbResult<ObjectDdl> {
        let (respond, response) = mpsc::channel();

        self.commands
            .send(Command::ObjectDdl {
                owner: owner.to_string(),
                name: name.to_string(),
                kind,
                respond,
            })
            .map_err(|_| DbError::closed())?;

        response.recv().map_err(|_| DbError::closed())?
    }

    /// セッションの一覧とブロッキングの連鎖を取る（ADR 0017）。
    ///
    /// 結果セットのカーソルは開かないため、この接続が保持している結果は
    /// 壊れない。
    pub fn list_sessions(&self) -> DbResult<SessionOverview> {
        let (respond, response) = mpsc::channel();

        self.commands
            .send(Command::ListSessions { respond })
            .map_err(|_| DbError::closed())?;

        response.recv().map_err(|_| DbError::closed())?
    }

    /// セッションを 1 つ終了する（ADR 0017）。
    ///
    /// # 引数
    ///
    /// * `sid` - 対象の `SID`
    /// * `serial` - 対象の `SERIAL#`
    pub fn kill_session(&self, sid: u32, serial: u32) -> DbResult<()> {
        let (respond, response) = mpsc::channel();

        self.commands
            .send(Command::KillSession {
                sid,
                serial,
                respond,
            })
            .map_err(|_| DbError::closed())?;

        response.recv().map_err(|_| DbError::closed())?
    }

    /// オブジェクトのソースを横断して検索する（ADR 0021）。
    ///
    /// 結果セットのカーソルは開かないため、この接続が保持している結果は
    /// 壊れない。
    ///
    /// # 引数
    ///
    /// * `request` - 検索の求め
    pub fn search_source(&self, request: SourceSearchRequest) -> DbResult<SourceSearchResult> {
        let (respond, response) = mpsc::channel();

        self.commands
            .send(Command::SearchSource { request, respond })
            .map_err(|_| DbError::closed())?;

        response.recv().map_err(|_| DbError::closed())?
    }

    /// 当たった行の前後を読む（ADR 0021）。
    ///
    /// # 引数
    ///
    /// * `target` - 読むオブジェクト
    /// * `line` - 中心にする行
    pub fn source_context(&self, target: SourceTarget, line: u32) -> DbResult<Vec<SourceLine>> {
        let (respond, response) = mpsc::channel();

        self.commands
            .send(Command::SourceContext {
                target,
                line,
                respond,
            })
            .map_err(|_| DbError::closed())?;

        response.recv().map_err(|_| DbError::closed())?
    }

    /// 実行中の文を中止する。
    ///
    /// アクタースレッドが実行で塞がっている最中でも効く。
    pub fn cancel(&self) -> DbResult<()> {
        self.canceller.cancel()
    }
}

impl Drop for ConnectionHandle {
    fn drop(&mut self) {
        // 送信に失敗するのはスレッドが既に終わっている場合であり、
        // その場合は join するだけでよい。
        let _ = self.commands.send(Command::Close);

        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// アクタースレッドの本体。
///
/// 接続を確立して手綱を返信したあと、命令を 1 つずつ処理する。命令のチャネルが
/// 閉じられるか `Close` を受け取ると終了する。
fn run_actor<D, F>(
    connect: F,
    ready: Sender<DbResult<Box<dyn Canceller>>>,
    commands: Receiver<Command>,
) where
    D: Driver,
    F: FnOnce() -> DbResult<D>,
{
    let mut driver = match connect() {
        Ok(driver) => driver,
        Err(error) => {
            let _ = ready.send(Err(error));
            return;
        }
    };

    if ready.send(Ok(driver.canceller())).is_err() {
        // 呼び出し元が既に諦めている。接続を開いたままにしないよう終了する。
        return;
    }

    while let Ok(command) = commands.recv() {
        match command {
            Command::Execute {
                sql,
                binds,
                chunk_size,
                respond,
            } => {
                let result = driver.execute(&sql, &binds, chunk_size);
                // 返信先が消えていても、実行そのものは完了している。
                let _ = respond.send(result);
            }
            Command::FetchMore {
                chunk_size,
                respond,
            } => {
                let _ = respond.send(driver.fetch_more(chunk_size));
            }
            Command::CloseCursor { respond } => {
                let _ = respond.send(driver.close_cursor());
            }
            Command::SchemaOverview { filter, respond } => {
                let _ = respond.send(driver.schema_overview(&filter));
            }
            Command::SchemaColumns { owner, respond } => {
                let _ = respond.send(driver.schema_columns(&owner));
            }
            Command::ExplainPlan {
                sql,
                binds,
                respond,
            } => {
                let _ = respond.send(driver.explain_plan(&sql, &binds));
            }
            Command::ActualPlan {
                sql,
                binds,
                respond,
            } => {
                let _ = respond.send(driver.actual_plan(&sql, &binds));
            }
            Command::Commit { respond } => {
                let _ = respond.send(driver.commit());
            }
            Command::Rollback { respond } => {
                let _ = respond.send(driver.rollback());
            }
            Command::ObjectDefinition {
                owner,
                name,
                kind,
                respond,
            } => {
                let _ = respond.send(driver.object_definition(&owner, &name, kind));
            }
            Command::ObjectDdl {
                owner,
                name,
                kind,
                respond,
            } => {
                let _ = respond.send(driver.object_ddl(&owner, &name, kind));
            }
            Command::ListSessions { respond } => {
                let _ = respond.send(driver.list_sessions());
            }
            Command::KillSession {
                sid,
                serial,
                respond,
            } => {
                let _ = respond.send(driver.kill_session(sid, serial));
            }
            Command::SearchSource { request, respond } => {
                let _ = respond.send(driver.search_source(&request));
            }
            Command::SourceContext {
                target,
                line,
                respond,
            } => {
                let _ = respond.send(driver.source_context(&target, line));
            }
            Command::Close => break,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::driver::{BindKind, Column};
    use crate::db::value::{Cell, CellKind};
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    /// テスト用のドライバ。
    ///
    /// アクタースレッドの挙動そのものを確かめるために置く。実データベースを
    /// 使わずに、命令の受け渡し・中止・終了を検証できる。
    ///
    /// 問い合わせは、あらかじめ持たせた行を `chunk_size` ずつ返す。
    struct テスト用ドライバ {
        実行した回数: Arc<AtomicUsize>,
        中止された: Arc<AtomicBool>,
        実行を遅らせる: Option<Duration>,
        /// 実行すると返す行。カーソルの分割取得を確かめるのに使う。
        用意した行: Vec<Vec<Cell>>,
        /// まだ返していない行の位置。
        読んだ位置: usize,
        /// カーソルが開いているか。
        カーソルを開いている: bool,
        /// 未コミットのトランザクションがあるか。実行すると真になる。
        未コミット: Arc<AtomicBool>,
        /// コミットされた回数。
        コミットした回数: Arc<AtomicUsize>,
        /// 直前の実行で受け取ったバインド変数。素通しの確認に使う。
        受け取ったバインド: Arc<Mutex<Vec<Bind>>>,
        /// kill を頼まれたセッション（ADR 0017）。
        killした相手: Arc<Mutex<Vec<(u32, u32)>>>,
    }

    struct テスト用の中止経路 {
        中止された: Arc<AtomicBool>,
    }

    impl Canceller for テスト用の中止経路 {
        fn cancel(&self) -> DbResult<()> {
            self.中止された.store(true, Ordering::SeqCst);
            Ok(())
        }
    }

    impl テスト用ドライバ {
        /// 未読の行から最大 `chunk_size` 行を取り出す。
        fn かたまりを取る(&mut self, chunk_size: usize) -> Chunk {
            let 終わり = (self.読んだ位置 + chunk_size).min(self.用意した行.len());
            let rows = self.用意した行[self.読んだ位置..終わり].to_vec();
            self.読んだ位置 = 終わり;

            let exhausted = self.読んだ位置 >= self.用意した行.len();
            if exhausted {
                self.カーソルを開いている = false;
            }

            Chunk { rows, exhausted }
        }
    }

    impl Driver for テスト用ドライバ {
        fn canceller(&self) -> Box<dyn Canceller> {
            Box::new(テスト用の中止経路 {
                中止された: Arc::clone(&self.中止された),
            })
        }

        fn execute(
            &mut self,
            sql: &str,
            binds: &[Bind],
            chunk_size: usize,
        ) -> DbResult<ExecuteOutcome> {
            *self.受け取ったバインド.lock().unwrap() = binds.to_vec();

            if let Some(遅延) = self.実行を遅らせる {
                thread::sleep(遅延);
            }
            self.実行した回数.fetch_add(1, Ordering::SeqCst);

            if sql.contains("失敗") {
                return Err(DbError::execute("わざと失敗させた"));
            }

            self.読んだ位置 = 0;
            self.カーソルを開いている = true;
            self.未コミット.store(true, Ordering::SeqCst);
            let chunk = self.かたまりを取る(chunk_size);

            Ok(ExecuteOutcome::Query {
                columns: vec![Column {
                    name: String::from("N"),
                    type_name: String::from("NUMBER(38,0)"),
                    kind: CellKind::Number,
                }],
                chunk,
                elapsed_ms: 1,
                notices: Vec::new(),
                in_transaction: self.未コミット.load(Ordering::SeqCst),
            })
        }

        fn fetch_more(&mut self, chunk_size: usize) -> DbResult<Chunk> {
            if !self.カーソルを開いている {
                return Ok(Chunk {
                    rows: Vec::new(),
                    exhausted: true,
                });
            }
            Ok(self.かたまりを取る(chunk_size))
        }

        fn close_cursor(&mut self) -> DbResult<()> {
            self.カーソルを開いている = false;
            Ok(())
        }

        fn schema_overview(
            &mut self,
            filter: &crate::db::schema::SchemaFilter,
        ) -> DbResult<Vec<crate::db::schema::SchemaNode>> {
            // フィルタが素通しされていることだけを見せる。
            Ok(vec![crate::db::schema::SchemaNode {
                name: String::from(if filter.exclude_system {
                    "KODUCHI"
                } else {
                    "SYS"
                }),
                object_count: 1,
                objects: Vec::new(),
            }])
        }

        fn schema_columns(&mut self, owner: &str) -> DbResult<Vec<crate::db::schema::TableColumn>> {
            Ok(vec![crate::db::schema::TableColumn {
                object_name: format!("{owner}.USERS"),
                name: String::from("ID"),
                type_name: String::from("NUMBER(10)"),
                nullable: false,
                kind: CellKind::Number,
                comment: None,
            }])
        }

        fn commit(&mut self) -> DbResult<()> {
            self.コミットした回数.fetch_add(1, Ordering::SeqCst);
            self.未コミット.store(false, Ordering::SeqCst);
            Ok(())
        }

        fn rollback(&mut self) -> DbResult<()> {
            self.未コミット.store(false, Ordering::SeqCst);
            Ok(())
        }

        fn explain_plan(&mut self, sql: &str, binds: &[Bind]) -> DbResult<String> {
            *self.受け取ったバインド.lock().unwrap() = binds.to_vec();
            Ok(format!("見積り: {sql}"))
        }

        fn actual_plan(&mut self, sql: &str, binds: &[Bind]) -> DbResult<String> {
            *self.受け取ったバインド.lock().unwrap() = binds.to_vec();
            Ok(format!("実測: {sql}"))
        }

        fn object_definition(
            &mut self,
            owner: &str,
            name: &str,
            kind: crate::db::schema::ObjectKind,
        ) -> DbResult<crate::db::definition::ObjectDefinition> {
            Ok(crate::db::definition::ObjectDefinition {
                owner: owner.to_string(),
                name: name.to_string(),
                kind,
                comment: None,
                columns: Vec::new(),
                constraints: Vec::new(),
                indexes: Vec::new(),
            })
        }

        fn object_ddl(
            &mut self,
            owner: &str,
            name: &str,
            kind: crate::db::schema::ObjectKind,
        ) -> DbResult<crate::db::definition::ObjectDdl> {
            Ok(crate::db::definition::ObjectDdl {
                owner: owner.to_string(),
                name: name.to_string(),
                kind,
                parts: vec![crate::db::definition::DdlPart {
                    label: String::from(kind.ddl_label()),
                    sql: format!("create table {owner}.{name} (id number)"),
                }],
            })
        }

        fn list_sessions(&mut self) -> DbResult<crate::db::sessions::SessionOverview> {
            Ok(crate::db::sessions::SessionOverview::new(1, 10, Vec::new()))
        }

        fn kill_session(&mut self, sid: u32, serial: u32) -> DbResult<()> {
            self.killした相手.lock().unwrap().push((sid, serial));
            Ok(())
        }

        fn search_source(
            &mut self,
            request: &crate::db::source::SourceSearchRequest,
        ) -> DbResult<crate::db::source::SourceSearchResult> {
            Ok(crate::db::source::group_matches(
                vec![crate::db::source::RawSourceMatch {
                    owner: String::from("KODUCHI"),
                    name: request.needle.to_uppercase(),
                    kind: crate::db::source::SourceKind::PackageBody,
                    line: 1,
                    text: String::from("begin\n"),
                }],
                request.effective_limit(),
            ))
        }

        fn source_context(
            &mut self,
            target: &crate::db::source::SourceTarget,
            line: u32,
        ) -> DbResult<Vec<crate::db::source::SourceLine>> {
            Ok(vec![crate::db::source::SourceLine {
                line,
                text: target.name.clone(),
            }])
        }
    }

    /// 連番の行を `件数` ぶん作る。
    fn 行を作る(件数: usize) -> Vec<Vec<Cell>> {
        (0..件数)
            .map(|n| vec![Cell::new(CellKind::Number, n.to_string())])
            .collect()
    }

    fn ドライバを作る() -> (テスト用ドライバ, Arc<AtomicUsize>, Arc<AtomicBool>) {
        let 実行した回数 = Arc::new(AtomicUsize::new(0));
        let 中止された = Arc::new(AtomicBool::new(false));
        let driver = テスト用ドライバ {
            実行した回数: Arc::clone(&実行した回数),
            中止された: Arc::clone(&中止された),
            実行を遅らせる: None,
            用意した行: 行を作る(1),
            読んだ位置: 0,
            カーソルを開いている: false,
            未コミット: Arc::new(AtomicBool::new(false)),
            コミットした回数: Arc::new(AtomicUsize::new(0)),
            受け取ったバインド: Arc::new(Mutex::new(Vec::new())),
            killした相手: Arc::new(Mutex::new(Vec::new())),
        };
        (driver, 実行した回数, 中止された)
    }

    #[test]
    fn 接続に成功すると手綱が返る() {
        // Arrange
        let (driver, 実行した回数, _) = ドライバを作る();

        // Act
        let handle = ConnectionHandle::open(move || Ok(driver)).unwrap();

        // Assert
        assert_eq!(実行した回数.load(Ordering::SeqCst), 0);
        drop(handle);
    }

    #[test]
    fn 接続に失敗するとエラーがそのまま返る() {
        // Arrange
        let 接続処理 = || -> DbResult<テスト用ドライバ> {
            Err(DbError::connect("ORA-12541: TNS:no listener"))
        };

        // Act
        let result = ConnectionHandle::open(接続処理);

        // Assert
        let error = match result {
            Ok(_) => panic!("接続に成功してしまった"),
            Err(error) => error,
        };
        assert_eq!(error.message, "ORA-12541: TNS:no listener");
    }

    #[test]
    fn 実行結果がアクタースレッドから返る() {
        // Arrange
        let (driver, _, _) = ドライバを作る();
        let handle = ConnectionHandle::open(move || Ok(driver)).unwrap();

        // Act
        let outcome = handle.execute("select 1 from dual", &[], 1000).unwrap();

        // Assert
        match outcome {
            ExecuteOutcome::Query { columns, chunk, .. } => {
                assert_eq!(columns.len(), 1);
                assert_eq!(chunk.rows.len(), 1);
                assert!(chunk.exhausted);
            }
            _ => panic!("問い合わせの結果になるはず"),
        }
    }

    #[test]
    fn 行が多いときは指定した数だけ返りカーソルが残る() {
        // Arrange: 2,500 行を 1,000 行ずつ取り出す
        let (mut driver, _, _) = ドライバを作る();
        driver.用意した行 = 行を作る(2500);
        let handle = ConnectionHandle::open(move || Ok(driver)).unwrap();

        // Act
        let outcome = handle.execute("select * from events", &[], 1000).unwrap();

        // Assert
        match outcome {
            ExecuteOutcome::Query { chunk, .. } => {
                assert_eq!(chunk.rows.len(), 1000);
                assert!(!chunk.exhausted);
            }
            _ => panic!("問い合わせの結果になるはず"),
        }
    }

    #[test]
    fn 続きを取り出すと残りの行が順に返る() {
        // Arrange
        let (mut driver, _, _) = ドライバを作る();
        driver.用意した行 = 行を作る(2500);
        let handle = ConnectionHandle::open(move || Ok(driver)).unwrap();
        handle.execute("select * from events", &[], 1000).unwrap();

        // Act
        let 二つ目 = handle.fetch_more(1000).unwrap();
        let 三つ目 = handle.fetch_more(1000).unwrap();

        // Assert
        assert_eq!(二つ目.rows.len(), 1000);
        assert!(!二つ目.exhausted);
        assert_eq!(三つ目.rows.len(), 500);
        assert!(三つ目.exhausted);
        assert_eq!(三つ目.rows[499][0].text, "2499");
    }

    #[test]
    fn 尽きたカーソルから取り出すと空のかたまりが返る() {
        // Arrange
        let (driver, _, _) = ドライバを作る();
        let handle = ConnectionHandle::open(move || Ok(driver)).unwrap();
        handle.execute("select 1 from dual", &[], 1000).unwrap();

        // Act
        let chunk = handle.fetch_more(1000).unwrap();

        // Assert
        assert!(chunk.rows.is_empty());
        assert!(chunk.exhausted);
    }

    #[test]
    fn カーソルを閉じると続きが取り出せなくなる() {
        // Arrange
        let (mut driver, _, _) = ドライバを作る();
        driver.用意した行 = 行を作る(2500);
        let handle = ConnectionHandle::open(move || Ok(driver)).unwrap();
        handle.execute("select * from events", &[], 1000).unwrap();

        // Act
        handle.close_cursor().unwrap();
        let chunk = handle.fetch_more(1000).unwrap();

        // Assert
        assert!(chunk.rows.is_empty());
        assert!(chunk.exhausted);
    }

    #[test]
    fn バインド変数はドライバまでそのまま届く() {
        // Arrange
        let (driver, _, _) = ドライバを作る();
        let 受け取ったバインド = Arc::clone(&driver.受け取ったバインド);
        let handle = ConnectionHandle::open(move || Ok(driver)).unwrap();
        let binds = vec![
            Bind::new("id", BindKind::Number, Some(String::from("42"))),
            Bind::text("memo", None),
        ];

        // Act
        handle
            .execute("select * from users where id = :id", &binds, 1000)
            .unwrap();

        // Assert
        assert_eq!(*受け取ったバインド.lock().unwrap(), binds);
    }

    #[test]
    fn 実行時のエラーがそのまま返る() {
        // Arrange
        let (driver, _, _) = ドライバを作る();
        let handle = ConnectionHandle::open(move || Ok(driver)).unwrap();

        // Act
        let result = handle.execute("失敗する SQL", &[], 1000);

        // Assert
        assert_eq!(result.unwrap_err().message, "わざと失敗させた");
    }

    #[test]
    fn 複数の実行は同じスレッドで順に処理される() {
        // Arrange
        let (driver, 実行した回数, _) = ドライバを作る();
        let handle = ConnectionHandle::open(move || Ok(driver)).unwrap();

        // Act
        for _ in 0..5 {
            handle.execute("select 1 from dual", &[], 1000).unwrap();
        }

        // Assert
        assert_eq!(実行した回数.load(Ordering::SeqCst), 5);
    }

    #[test]
    fn 中止は実行中でも別スレッドから届く() {
        // Arrange: 実行に 200ms かかるドライバを用意する
        let 実行した回数 = Arc::new(AtomicUsize::new(0));
        let 中止された = Arc::new(AtomicBool::new(false));
        let driver = テスト用ドライバ {
            実行した回数: Arc::clone(&実行した回数),
            中止された: Arc::clone(&中止された),
            実行を遅らせる: Some(Duration::from_millis(200)),
            用意した行: 行を作る(1),
            読んだ位置: 0,
            カーソルを開いている: false,
            未コミット: Arc::new(AtomicBool::new(false)),
            コミットした回数: Arc::new(AtomicUsize::new(0)),
            受け取ったバインド: Arc::new(Mutex::new(Vec::new())),
            killした相手: Arc::new(Mutex::new(Vec::new())),
        };
        let handle = Arc::new(ConnectionHandle::open(move || Ok(driver)).unwrap());

        // Act: 実行中に別スレッドから中止する
        let 実行側 = {
            let handle = Arc::clone(&handle);
            thread::spawn(move || handle.execute("select 1 from dual", &[], 1000))
        };
        thread::sleep(Duration::from_millis(50));
        handle.cancel().unwrap();
        実行側.join().unwrap().unwrap();

        // Assert
        assert!(中止された.load(Ordering::SeqCst));
    }

    #[test]
    fn コミットはアクタースレッドへ届く() {
        // Arrange
        let (driver, _, _) = ドライバを作る();
        let コミットした回数 = Arc::clone(&driver.コミットした回数);
        let handle = ConnectionHandle::open(move || Ok(driver)).unwrap();

        // Act
        handle.commit().unwrap();

        // Assert
        assert_eq!(コミットした回数.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn 実行のあとにロールバックすると未コミットが解消する() {
        // Arrange
        let (driver, _, _) = ドライバを作る();
        let 未コミット = Arc::clone(&driver.未コミット);
        let handle = ConnectionHandle::open(move || Ok(driver)).unwrap();
        handle.execute("select 1 from dual", &[], 1000).unwrap();
        assert!(未コミット.load(Ordering::SeqCst));

        // Act
        handle.rollback().unwrap();

        // Assert
        assert!(!未コミット.load(Ordering::SeqCst));
    }

    #[test]
    fn 実行結果は未コミットかどうかを伴って返る() {
        // Arrange
        let (driver, _, _) = ドライバを作る();
        let handle = ConnectionHandle::open(move || Ok(driver)).unwrap();

        // Act
        let outcome = handle.execute("select 1 from dual", &[], 1000).unwrap();

        // Assert
        match outcome {
            ExecuteOutcome::Query { in_transaction, .. } => assert!(in_transaction),
            _ => panic!("問い合わせの結果になるはず"),
        }
    }

    #[test]
    fn セッションの一覧はアクタースレッドから返る() {
        // Arrange
        let (driver, _, _) = ドライバを作る();
        let handle = ConnectionHandle::open(move || Ok(driver)).unwrap();

        // Act
        let overview = handle.list_sessions().unwrap();

        // Assert
        assert_eq!(overview.current_sid, 10);
    }

    #[test]
    fn killの指定はsidとserialのままドライバへ届く() {
        // Arrange
        let (driver, _, _) = ドライバを作る();
        let killした相手 = Arc::clone(&driver.killした相手);
        let handle = ConnectionHandle::open(move || Ok(driver)).unwrap();

        // Act
        handle.kill_session(123, 45678).unwrap();

        // Assert
        assert_eq!(*killした相手.lock().unwrap(), vec![(123, 45678)]);
    }

    #[test]
    fn ソース検索はアクタースレッドから返る() {
        // Arrange
        let (driver, _, _) = ドライバを作る();
        let handle = ConnectionHandle::open(move || Ok(driver)).unwrap();
        let request = crate::db::source::SourceSearchRequest {
            needle: String::from("orders"),
            owner: None,
            kinds: crate::db::source::SourceKindFilter::default(),
            case_sensitive: false,
            limit: crate::db::source::SOURCE_SEARCH_DEFAULT_LIMIT,
        };

        // Act
        let result = handle.search_source(request).unwrap();

        // Assert
        assert_eq!(result.objects[0].name, "ORDERS");
    }

    #[test]
    fn ソースの前後を読む求めはそのままドライバへ届く() {
        // Arrange
        let (driver, _, _) = ドライバを作る();
        let handle = ConnectionHandle::open(move || Ok(driver)).unwrap();
        let target = crate::db::source::SourceTarget {
            owner: String::from("KODUCHI"),
            name: String::from("ORDER_STATS"),
            kind: crate::db::source::SourceKind::PackageBody,
        };

        // Act
        let lines = handle.source_context(target, 12).unwrap();

        // Assert
        assert_eq!(lines[0].line, 12);
        assert_eq!(lines[0].text, "ORDER_STATS");
    }

    #[test]
    fn 手綱を破棄するとアクタースレッドが終了する() {
        // Arrange
        let (driver, _, _) = ドライバを作る();
        let handle = ConnectionHandle::open(move || Ok(driver)).unwrap();

        // Act
        drop(handle);

        // Assert: Drop が join まで行うため、ここへ到達すれば終了している
    }
}
