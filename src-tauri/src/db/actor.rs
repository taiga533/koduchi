//! 接続ごとのアクタースレッド（ADR 0002）。
//!
//! `oracle` crate は ODPI-C の同期 API であり、実行はスレッドを塞ぐ。Tauri の
//! コマンドを async にしてもその中で同期的に塞げば tokio のワーカーを占有し、
//! UI が止まる。そこで接続ごとに専用の OS スレッドを立て、チャネルで命令を送る。
//!
//! 中止は別の経路から行う。実行中はアクタースレッドが塞がっているため、
//! 命令のチャネル越しには届かない。`Canceller` は `Send + Sync` であり、
//! 呼び出し元のスレッドから直接叩ける。

use crate::db::driver::{Canceller, Chunk, Driver, ExecuteOutcome};
use crate::db::error::{DbError, DbResult};
use crate::db::schema::{SchemaFilter, SchemaNode, TableColumn};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread::{self, JoinHandle};

/// アクタースレッドへ送る命令。
enum Command {
    /// SQL を 1 文実行し、結果を返信用チャネルへ返す。
    Execute {
        sql: String,
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
        respond: Sender<DbResult<String>>,
    },
    /// 実測付きの実行計画を取る（`⇧⌘E`）。
    ActualPlan {
        sql: String,
        respond: Sender<DbResult<String>>,
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
    /// * `chunk_size` - 一度に取り出す行数
    pub fn execute(&self, sql: &str, chunk_size: usize) -> DbResult<ExecuteOutcome> {
        let (respond, response) = mpsc::channel();

        self.commands
            .send(Command::Execute {
                sql: sql.to_string(),
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
    pub fn explain_plan(&self, sql: &str) -> DbResult<String> {
        let (respond, response) = mpsc::channel();

        self.commands
            .send(Command::ExplainPlan {
                sql: sql.to_string(),
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
    pub fn actual_plan(&self, sql: &str) -> DbResult<String> {
        let (respond, response) = mpsc::channel();

        self.commands
            .send(Command::ActualPlan {
                sql: sql.to_string(),
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
                chunk_size,
                respond,
            } => {
                let result = driver.execute(&sql, chunk_size);
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
            Command::ExplainPlan { sql, respond } => {
                let _ = respond.send(driver.explain_plan(&sql));
            }
            Command::ActualPlan { sql, respond } => {
                let _ = respond.send(driver.actual_plan(&sql));
            }
            Command::Close => break,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::driver::Column;
    use crate::db::value::{Cell, CellKind};
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::Arc;
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

        fn execute(&mut self, sql: &str, chunk_size: usize) -> DbResult<ExecuteOutcome> {
            if let Some(遅延) = self.実行を遅らせる {
                thread::sleep(遅延);
            }
            self.実行した回数.fetch_add(1, Ordering::SeqCst);

            if sql.contains("失敗") {
                return Err(DbError::execute("わざと失敗させた"));
            }

            self.読んだ位置 = 0;
            self.カーソルを開いている = true;
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
            }])
        }

        fn explain_plan(&mut self, sql: &str) -> DbResult<String> {
            Ok(format!("見積り: {sql}"))
        }

        fn actual_plan(&mut self, sql: &str) -> DbResult<String> {
            Ok(format!("実測: {sql}"))
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
        let outcome = handle.execute("select 1 from dual", 1000).unwrap();

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
        let outcome = handle.execute("select * from events", 1000).unwrap();

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
        handle.execute("select * from events", 1000).unwrap();

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
        handle.execute("select 1 from dual", 1000).unwrap();

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
        handle.execute("select * from events", 1000).unwrap();

        // Act
        handle.close_cursor().unwrap();
        let chunk = handle.fetch_more(1000).unwrap();

        // Assert
        assert!(chunk.rows.is_empty());
        assert!(chunk.exhausted);
    }

    #[test]
    fn 実行時のエラーがそのまま返る() {
        // Arrange
        let (driver, _, _) = ドライバを作る();
        let handle = ConnectionHandle::open(move || Ok(driver)).unwrap();

        // Act
        let result = handle.execute("失敗する SQL", 1000);

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
            handle.execute("select 1 from dual", 1000).unwrap();
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
        };
        let handle = Arc::new(ConnectionHandle::open(move || Ok(driver)).unwrap());

        // Act: 実行中に別スレッドから中止する
        let 実行側 = {
            let handle = Arc::clone(&handle);
            thread::spawn(move || handle.execute("select 1 from dual", 1000))
        };
        thread::sleep(Duration::from_millis(50));
        handle.cancel().unwrap();
        実行側.join().unwrap().unwrap();

        // Assert
        assert!(中止された.load(Ordering::SeqCst));
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
