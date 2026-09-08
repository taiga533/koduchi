//! Oracle 向けの `Driver` 実装（ADR 0001・0002・0003）。
//!
//! `DBMS_OUTPUT` の取得のような Oracle 固有の都合は、`Driver` trait には出さず
//! このモジュールに閉じ込める。

pub mod bind;
pub mod convert;
pub mod definition;
pub mod errors;
pub mod instant_client;
pub mod plan;
pub mod schema;
pub mod sessions;
pub mod source;

use crate::db::definition::{ObjectDdl, ObjectDefinition};
use crate::db::driver::{Bind, Canceller, Chunk, Column, ConnectionParams, Driver, ExecuteOutcome};
use crate::db::error::{DbError, DbResult};
use crate::db::schema::{ObjectKind, SchemaFilter, SchemaNode, TableColumn};
use crate::db::sessions::SessionOverview;
use crate::db::source::{SourceLine, SourceSearchRequest, SourceSearchResult, SourceTarget};
use oracle::sql_type::OracleType;
use oracle::{Connection, ResultSet, Row};
use std::sync::Arc;
use std::time::Instant;

/// 開いたままの結果セット（ADR 0003）。
///
/// `Statement` の所有権ごと受け取った結果セットを保持する。スクロールが下端に
/// 近づくたびに、ここから次のかたまりを取り出す。
struct OpenCursor {
    rows: ResultSet<'static, Row>,
    /// 行を取り尽くしたか。
    exhausted: bool,
}

/// Oracle への接続 1 本。
///
/// アクタースレッドの上でのみ触られる（ADR 0002）。
pub struct OracleDriver {
    connection: Arc<Connection>,
    /// 開いている結果セット。接続 1 本につき高々 1 つ。
    cursor: Option<OpenCursor>,
    /// 読み取り専用トランザクションの最中か（ADR 0004）。
    ///
    /// `EXPLAIN PLAN` は `PLAN_TABLE` への書き込みを伴うため、この最中は
    /// 実行できない。計画を取る前後で解除と再開が要る。
    read_only: bool,
    /// 実行のたびに自動でコミットするか（ADR 0012）。
    ///
    /// 真のときは未コミットの状態が生じないため、データベースへ問い合わせずに
    /// 「未コミットではない」と答えられる。
    auto_commit: bool,
}

/// 実行中の文を中止する経路。
///
/// `oracle::Connection` は `Send + Sync` を実装するため、`Arc` の複製を別の
/// スレッドが持ち、実行中に `break_execution()` を呼べる。
struct OracleCanceller {
    connection: Arc<Connection>,
}

impl Canceller for OracleCanceller {
    fn cancel(&self) -> DbResult<()> {
        self.connection
            .break_execution()
            .map_err(|error| DbError::execute(error.to_string()))
    }
}

impl OracleDriver {
    /// Oracle へ接続する。
    ///
    /// 接続直後に次の 2 つを行う。
    ///
    /// 1. `DBMS_OUTPUT` を有効にする。これをしないと無名 PL/SQL ブロックを
    ///    実行しても通知が一切見えない。
    /// 2. 読み取り専用が指定されていれば読み取り専用トランザクションを開始する。
    ///    クライアント側の SQL 判定では `WITH ... INSERT` などをすり抜けるため、
    ///    データベース側に保証させる（ADR 0004）。
    ///
    /// 自動コミットが指定されていれば、その設定は接続直後に入れる（ADR 0012）。
    /// 読み取り専用とは併用しない。読み取り専用トランザクションの中では
    /// そもそもコミットする変更が生じないためである。
    ///
    /// # 引数
    ///
    /// * `params` - 接続先とユーザー、読み取り専用と自動コミットの指定
    pub fn connect(params: &ConnectionParams) -> DbResult<Self> {
        let mut connection = Connection::connect(
            &params.username,
            &params.password,
            params.target.to_connect_string(),
        )
        .map_err(|error| DbError::connect(error.to_string()))?;

        let auto_commit = params.auto_commit && !params.read_only;
        // `set_autocommit` は `&mut Connection` を要するため、`Arc` に包む前に呼ぶ。
        connection.set_autocommit(auto_commit);

        let driver = OracleDriver {
            connection: Arc::new(connection),
            cursor: None,
            read_only: params.read_only,
            auto_commit,
        };

        driver.enable_dbms_output()?;

        if params.read_only {
            driver.begin_read_only_transaction()?;
        }

        Ok(driver)
    }

    /// 繋いだ先のデータベースのバージョンを返す。
    ///
    /// ODPI-C が接続時に受け取った値を読むだけであり、問い合わせを投げない。
    /// `V$VERSION` は参照権限を要するため、テスト接続の確認には使えない。
    pub fn server_version(&self) -> DbResult<String> {
        self.connection
            .server_version()
            .map(|(version, _banner)| instant_client::format_version(&version))
            .map_err(|error| DbError::connect(format!("バージョンを取得できませんでした: {error}")))
    }

    /// `DBMS_OUTPUT` を有効にする。
    ///
    /// バッファ長に `NULL` を渡すと上限なしになる。
    fn enable_dbms_output(&self) -> DbResult<()> {
        self.connection
            .execute("begin dbms_output.enable(NULL); end;", &[])
            .map(|_| ())
            .map_err(|error| {
                DbError::connect(format!("DBMS_OUTPUT を有効にできませんでした: {error}"))
            })
    }

    /// 読み取り専用トランザクションを開始する（ADR 0004）。
    ///
    /// この保証はトランザクションが続く間だけ効く。コミットや DDL による暗黙の
    /// コミットが起きると解除されるが、読み取り専用の接続でそれらを行う経路は
    /// そもそも塞がれている。
    fn begin_read_only_transaction(&self) -> DbResult<()> {
        self.connection
            .execute("set transaction read only", &[])
            .map(|_| ())
            .map_err(|error| {
                DbError::connect(format!(
                    "読み取り専用トランザクションを開始できませんでした: {error}"
                ))
            })
    }

    /// トランザクションを戻して終わらせる。
    ///
    /// `SET TRANSACTION` はトランザクションの先頭でしか使えないため、
    /// 読み取り専用へ戻す前にこれを呼ぶ必要がある。
    fn rollback_transaction(&self) -> DbResult<()> {
        self.connection.rollback().map_err(|error| {
            DbError::execute(format!("トランザクションを戻せませんでした: {error}"))
        })
    }

    /// 未コミットのトランザクションが残っているかをデータベースに聞く（ADR 0012）。
    ///
    /// クライアント側で「DML を実行したから未コミット」と数えると、
    /// `WITH ... INSERT` や無名 PL/SQL ブロックをすり抜ける。読み取り専用を
    /// データベース側のトランザクションで保証しているのと同じ理由である。
    ///
    /// `DBMS_TRANSACTION.LOCAL_TRANSACTION_ID` は、トランザクションが始まって
    /// いれば識別子を、無ければ `NULL` を返す。この問い合わせ自体は
    /// トランザクションを開始しない。
    ///
    /// 読み取り専用と自動コミットの接続では、コミットすべき変更がそもそも
    /// 生じないため、往復せずに偽を返す。読み取り専用は
    /// `SET TRANSACTION READ ONLY` 自体がトランザクションを開くため、
    /// 聞けば必ず真になってしまう。
    ///
    /// 取得に失敗しても実行そのものは成功しているため、エラーにはせず偽を返す。
    fn in_transaction(&self) -> bool {
        if self.read_only || self.auto_commit {
            return false;
        }

        const LOCAL_TRANSACTION_ID: &str = "select dbms_transaction.local_transaction_id from dual";

        self.connection
            .query_row_as::<Option<String>>(LOCAL_TRANSACTION_ID, &[])
            .map(|id| id.is_some())
            .unwrap_or(false)
    }

    /// 直前の実行が `DBMS_OUTPUT` へ書いた行をすべて取り出す。
    ///
    /// `GET_LINES` は配列バインドを要するため、1 行ずつ取る `GET_LINE` を使う。
    /// 通知の量は多くないため、往復の回数は問題にならない。
    ///
    /// 取得に失敗しても実行そのものは成功しているため、エラーにはせず
    /// 空の一覧を返す。
    fn fetch_dbms_output(&self) -> Vec<String> {
        const GET_LINE: &str = "begin dbms_output.get_line(:line, :status); end;";
        const MAX_LINES: usize = 10_000;

        let Ok(mut statement) = self.connection.statement(GET_LINE).build() else {
            return Vec::new();
        };

        let mut lines = Vec::new();

        for _ in 0..MAX_LINES {
            // OUT バインドは、値の代わりに型を渡すことで宣言する。
            if statement
                .execute(&[&OracleType::Varchar2(32767), &OracleType::Int64])
                .is_err()
            {
                break;
            }

            // status が 0 以外なら、取り出せる行はもう無い。
            match statement.bind_value::<usize, i64>(2) {
                Ok(0) => {}
                _ => break,
            }

            match statement.bind_value::<usize, Option<String>>(1) {
                // 空行は NULL として返る。行そのものは存在するため空文字列を積む。
                Ok(line) => lines.push(line.unwrap_or_default()),
                Err(_) => break,
            }
        }

        lines
    }
}

/// 開いている結果セットから、最大 `chunk_size` 行を取り出す。
///
/// 取り出せる行が尽きたら `exhausted` を立てる。ちょうど `chunk_size` 行取れた
/// 場合は、続きがあるかどうかは次に取りにいくまで分からないため立てない。
///
/// # 引数
///
/// * `cursor` - 取り出し元のカーソル
/// * `chunk_size` - 取り出す行数の上限
fn take_chunk(cursor: &mut OpenCursor, chunk_size: usize) -> DbResult<Chunk> {
    if cursor.exhausted {
        return Ok(Chunk {
            rows: Vec::new(),
            exhausted: true,
        });
    }

    let mut rows = Vec::with_capacity(chunk_size);

    for _ in 0..chunk_size {
        match cursor.rows.next() {
            Some(Ok(row)) => {
                let cells = row
                    .sql_values()
                    .iter()
                    .map(convert::to_cell)
                    .collect::<DbResult<Vec<_>>>()?;
                rows.push(cells);
            }
            Some(Err(error)) => return Err(DbError::execute(error.to_string())),
            None => {
                cursor.exhausted = true;
                break;
            }
        }
    }

    Ok(Chunk {
        rows,
        exhausted: cursor.exhausted,
    })
}

impl Driver for OracleDriver {
    fn canceller(&self) -> Box<dyn Canceller> {
        Box::new(OracleCanceller {
            connection: Arc::clone(&self.connection),
        })
    }

    fn execute(
        &mut self,
        sql: &str,
        binds: &[Bind],
        chunk_size: usize,
    ) -> DbResult<ExecuteOutcome> {
        // 前の結果セットを開いたままにしない（ADR 0003）。
        self.close_cursor()?;

        let started = Instant::now();

        let mut statement = self
            .connection
            .statement(sql)
            .build()
            .map_err(|error| DbError::execute(error.to_string()))?;

        let bound = bind::bound_values(&statement, binds)?;

        if statement.is_query() {
            let result_set = statement
                .into_result_set_named::<Row>(&bind::params(&bound))
                .map_err(|error| DbError::execute(error.to_string()))?;

            let columns: Vec<Column> = result_set
                .column_info()
                .iter()
                .map(|info| Column {
                    name: info.name().to_string(),
                    type_name: info.oracle_type().to_string(),
                    kind: convert::kind_of(info.oracle_type()),
                })
                .collect();

            let mut cursor = OpenCursor {
                rows: result_set,
                exhausted: false,
            };
            let chunk = take_chunk(&mut cursor, chunk_size)?;
            let elapsed_ms = started.elapsed().as_millis() as u64;
            let notices = self.fetch_dbms_output();
            let in_transaction = self.in_transaction();

            // 1 回で尽きたならカーソルを持ち続ける意味がない。
            if !chunk.exhausted {
                self.cursor = Some(cursor);
            }

            return Ok(ExecuteOutcome::Query {
                columns,
                chunk,
                elapsed_ms,
                notices,
                in_transaction,
            });
        }

        statement
            .execute_named(&bind::params(&bound))
            .map_err(|error| DbError::execute(error.to_string()))?;

        let affected_rows = statement.row_count().unwrap_or(0);
        let elapsed_ms = started.elapsed().as_millis() as u64;

        Ok(ExecuteOutcome::Statement {
            affected_rows,
            elapsed_ms,
            notices: self.fetch_dbms_output(),
            in_transaction: self.in_transaction(),
        })
    }

    fn fetch_more(&mut self, chunk_size: usize) -> DbResult<Chunk> {
        let Some(cursor) = self.cursor.as_mut() else {
            return Ok(Chunk {
                rows: Vec::new(),
                exhausted: true,
            });
        };

        let chunk = take_chunk(cursor, chunk_size)?;

        if chunk.exhausted {
            self.cursor = None;
        }

        Ok(chunk)
    }

    fn close_cursor(&mut self) -> DbResult<()> {
        // 結果セットを落とすと、内部で保持している文も一緒に閉じられる。
        self.cursor = None;
        Ok(())
    }

    fn schema_overview(&mut self, filter: &SchemaFilter) -> DbResult<Vec<SchemaNode>> {
        schema::load_overview(&self.connection, filter)
    }

    fn schema_columns(&mut self, owner: &str) -> DbResult<Vec<TableColumn>> {
        schema::load_columns(&self.connection, owner)
    }

    fn commit(&mut self) -> DbResult<()> {
        self.connection
            .commit()
            .map_err(|error| DbError::execute(format!("コミットできませんでした: {error}")))?;

        // 読み取り専用の保証はトランザクションが続く間だけ効く（ADR 0004）。
        // コミットで切れてしまうため、その場で張り直す。
        if self.read_only {
            self.begin_read_only_transaction()?;
        }

        Ok(())
    }

    fn rollback(&mut self) -> DbResult<()> {
        self.rollback_transaction()?;

        if self.read_only {
            self.begin_read_only_transaction()?;
        }

        Ok(())
    }

    fn explain_plan(&mut self, sql: &str, binds: &[Bind]) -> DbResult<String> {
        if !self.read_only {
            return plan::explain(&self.connection, sql, binds);
        }

        // 読み取り専用トランザクションの最中は `PLAN_TABLE` へ書けない。
        // いったん解除し、計画を読み終えてから読み取り専用へ戻す。
        // 解除している間に走る SQL は、この関数が発行するものだけである。
        self.rollback_transaction()?;
        let result = plan::explain(&self.connection, sql, binds);
        self.rollback_transaction()?;
        self.begin_read_only_transaction()?;
        result
    }

    fn actual_plan(&mut self, sql: &str, binds: &[Bind]) -> DbResult<String> {
        // 実行そのものは読み取り専用トランザクションの中でも行える。
        // 書き込みを伴う文はデータベース側が拒む（ADR 0004）。
        plan::actual(&self.connection, sql, binds)
    }

    fn object_definition(
        &mut self,
        owner: &str,
        name: &str,
        kind: ObjectKind,
    ) -> DbResult<ObjectDefinition> {
        definition::load_definition(&self.connection, owner, name, kind)
    }

    fn object_ddl(&mut self, owner: &str, name: &str, kind: ObjectKind) -> DbResult<ObjectDdl> {
        definition::load_ddl(&self.connection, owner, name, kind)
    }

    fn list_sessions(&mut self) -> DbResult<SessionOverview> {
        sessions::load_sessions(&self.connection)
    }

    fn kill_session(&mut self, sid: u32, serial: u32) -> DbResult<()> {
        sessions::kill_session(&self.connection, sid, serial, self.read_only)
    }

    fn search_source(&mut self, request: &SourceSearchRequest) -> DbResult<SourceSearchResult> {
        source::search_source(&self.connection, request)
    }

    fn source_context(&mut self, target: &SourceTarget, line: u32) -> DbResult<Vec<SourceLine>> {
        source::source_context(&self.connection, target, line)
    }
}
