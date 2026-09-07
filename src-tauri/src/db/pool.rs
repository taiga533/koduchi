//! ウィンドウごとの接続プール（ADR 0003）。
//!
//! 結果セットのカーソルを開いたまま保つと、その接続は占有される。エディタタブは
//! 複数あり、それぞれが結果を保持しうるため、接続を 1 本にするとタブを持つ意味が
//! 無くなる。そこでウィンドウごとに数本の接続を持ち、結果を保持しているタブに
//! 1 本ずつ割り当てる。
//!
//! 本数を超えたときは、最も長く使われていないタブの結果セットを閉じる。閉じられた
//! タブには「結果は破棄されました。再実行してください」を出す。

use crate::db::actor::ConnectionHandle;
use crate::db::driver::{Chunk, ConnectionParams, Driver, ExecuteOutcome};
use crate::db::error::{DbError, DbResult};
use crate::db::schema::{SchemaFilter, SchemaNode, TableColumn};
use std::sync::{Arc, Mutex};

/// プールが持つ接続の既定の本数。
///
/// 4 本あればタブを行き来しながらスクロールできる（ADR 0003）。
pub const DEFAULT_POOL_SIZE: usize = 4;

/// 一度に取り出す行数（ADR 0003）。
pub const DEFAULT_CHUNK_SIZE: usize = 1_000;

/// タブへの接続の割り当て。
#[derive(Debug, Clone, PartialEq, Eq)]
struct Lease {
    /// 結果セットを保持しているタブ。
    tab_id: String,
    /// プール内での接続の位置。
    slot: usize,
}

/// 実行の結果と、その巻き添えで結果セットを閉じられたタブ。
#[derive(Debug)]
pub struct ExecuteResponse {
    pub outcome: ExecuteOutcome,
    /// 接続を明け渡すために結果セットを閉じられたタブ。
    ///
    /// このタブには「結果は破棄されました。再実行してください」を出す。
    pub discarded_tab: Option<String>,
}

/// ウィンドウ 1 つぶんの接続プール。
pub struct ConnectionPool {
    handles: Vec<Arc<ConnectionHandle>>,
    /// 割り当ての一覧。先頭ほど長く使われていない。
    leases: Mutex<Vec<Lease>>,
    chunk_size: usize,
}

impl ConnectionPool {
    /// 接続をまとめて確立し、プールを作る。
    ///
    /// 1 本でも確立できなければ全体を失敗とする。半端に繋がった状態で
    /// 「接続できました」と表示するのは嘘になるためである。
    ///
    /// # 引数
    ///
    /// * `params` - 接続先とユーザー
    /// * `size` - 確立する接続の本数
    /// * `chunk_size` - 一度に取り出す行数
    pub fn open(params: &ConnectionParams, size: usize, chunk_size: usize) -> DbResult<Self> {
        let mut handles = Vec::with_capacity(size);

        for _ in 0..size {
            let params = params.clone();
            let handle =
                ConnectionHandle::open(move || crate::db::oracle::OracleDriver::connect(&params))?;
            handles.push(Arc::new(handle));
        }

        Ok(ConnectionPool {
            handles,
            leases: Mutex::new(Vec::new()),
            chunk_size,
        })
    }

    /// 既にある手綱からプールを組み立てる。
    ///
    /// テストから任意のドライバでプールを作るために使う。
    ///
    /// # 引数
    ///
    /// * `handles` - プールが持つ接続
    /// * `chunk_size` - 一度に取り出す行数
    pub fn from_handles(handles: Vec<Arc<ConnectionHandle>>, chunk_size: usize) -> Self {
        ConnectionPool {
            handles,
            leases: Mutex::new(Vec::new()),
            chunk_size,
        }
    }

    /// プールが持つ接続の本数。
    pub fn size(&self) -> usize {
        self.handles.len()
    }

    /// 一度に取り出す行数。
    pub fn chunk_size(&self) -> usize {
        self.chunk_size
    }

    /// タブに割り当てられている接続を返す。
    ///
    /// 割り当てが無ければ `None`。順序は変えないため、中止のように「使った」と
    /// 見なしたくない操作から使う。
    ///
    /// # 引数
    ///
    /// * `tab_id` - 対象のタブ
    fn leased(&self, tab_id: &str) -> Option<Arc<ConnectionHandle>> {
        let leases = self.leases.lock().expect("割り当て表のロックが壊れている");
        leases
            .iter()
            .find(|lease| lease.tab_id == tab_id)
            .map(|lease| Arc::clone(&self.handles[lease.slot]))
    }

    /// タブに割り当てられている接続を返し、最近使ったものとして扱い直す。
    ///
    /// 続きの取得も接続の利用であるため、これを行わないと、スクロールし続けて
    /// いるタブが「最も長く使われていない」と見なされて閉じられてしまう。
    ///
    /// # 引数
    ///
    /// * `tab_id` - 対象のタブ
    fn touch(&self, tab_id: &str) -> Option<Arc<ConnectionHandle>> {
        let mut leases = self.leases.lock().expect("割り当て表のロックが壊れている");
        let index = leases.iter().position(|lease| lease.tab_id == tab_id)?;
        let lease = leases.remove(index);
        let handle = Arc::clone(&self.handles[lease.slot]);
        leases.push(lease);
        Some(handle)
    }

    /// タブに接続を割り当てる。
    ///
    /// 既に割り当てがあればそれを最近使ったものとして扱い直す。空きが無ければ、
    /// 最も長く使われていないタブの割り当てを剥がす。
    ///
    /// # 引数
    ///
    /// * `tab_id` - 対象のタブ
    ///
    /// # 戻り値
    ///
    /// 割り当てた接続と、剥がされたタブ。
    fn acquire(&self, tab_id: &str) -> (Arc<ConnectionHandle>, Option<String>) {
        let mut leases = self.leases.lock().expect("割り当て表のロックが壊れている");

        // 既にこのタブが持っている接続は、そのまま使い続ける。
        if let Some(index) = leases.iter().position(|lease| lease.tab_id == tab_id) {
            let lease = leases.remove(index);
            let handle = Arc::clone(&self.handles[lease.slot]);
            leases.push(lease);
            return (handle, None);
        }

        // 空いている接続があればそれを使う。
        let used: Vec<usize> = leases.iter().map(|lease| lease.slot).collect();
        if let Some(slot) = (0..self.handles.len()).find(|slot| !used.contains(slot)) {
            leases.push(Lease {
                tab_id: tab_id.to_string(),
                slot,
            });
            return (Arc::clone(&self.handles[slot]), None);
        }

        // 空きが無ければ、最も長く使われていない割り当てを剥がす。
        let 剥がす = leases.remove(0);
        let handle = Arc::clone(&self.handles[剥がす.slot]);
        leases.push(Lease {
            tab_id: tab_id.to_string(),
            slot: 剥がす.slot,
        });

        (handle, Some(剥がす.tab_id))
    }

    /// タブの割り当てを外す。
    ///
    /// タブを閉じたときに呼ぶ。カーソルも一緒に閉じる。
    ///
    /// # 引数
    ///
    /// * `tab_id` - 対象のタブ
    pub fn release(&self, tab_id: &str) -> DbResult<()> {
        let handle = {
            let mut leases = self.leases.lock().expect("割り当て表のロックが壊れている");
            let Some(index) = leases.iter().position(|lease| lease.tab_id == tab_id) else {
                return Ok(());
            };
            let lease = leases.remove(index);
            Arc::clone(&self.handles[lease.slot])
        };

        handle.close_cursor()
    }

    /// SQL を 1 文実行する。
    ///
    /// タブに接続を割り当てたうえで実行する。割り当てのために別のタブの結果セットを
    /// 閉じた場合は、そのタブの ID を添えて返す。
    ///
    /// 問い合わせがカーソルを残さずに終わった場合は、割り当てもその場で外す。
    /// 接続を掴んだままにしないためである。
    ///
    /// # 引数
    ///
    /// * `tab_id` - 実行元のタブ
    /// * `sql` - 実行する SQL
    pub fn execute(&self, tab_id: &str, sql: &str) -> DbResult<ExecuteResponse> {
        let (handle, discarded_tab) = self.acquire(tab_id);

        // 剥がしたタブのカーソルは、同じ接続を使い回す前に閉じておく必要がある。
        // 実行そのものが前のカーソルを閉じるため、ここでは表からの削除だけでよい。
        let outcome = handle.execute(sql, self.chunk_size)?;

        let 保持し続ける = matches!(
            &outcome,
            ExecuteOutcome::Query { chunk, .. } if !chunk.exhausted
        );

        if !保持し続ける {
            let mut leases = self.leases.lock().expect("割り当て表のロックが壊れている");
            leases.retain(|lease| lease.tab_id != tab_id);
        }

        Ok(ExecuteResponse {
            outcome,
            discarded_tab,
        })
    }

    /// タブの結果セットから続きを取り出す。
    ///
    /// 割り当てが無い（結果セットが既に閉じられている）場合はエラーを返す。
    /// 呼び出し側はそれを「結果は破棄されました」の表示に使う。
    ///
    /// # 引数
    ///
    /// * `tab_id` - 対象のタブ
    pub fn fetch_more(&self, tab_id: &str) -> DbResult<Chunk> {
        let handle = self.touch(tab_id).ok_or_else(|| {
            DbError::new(
                crate::db::error::DbErrorKind::Closed,
                "結果は破棄されました。再実行してください",
            )
        })?;

        let chunk = handle.fetch_more(self.chunk_size)?;

        // 尽きたら接続を明け渡す。
        if chunk.exhausted {
            let mut leases = self.leases.lock().expect("割り当て表のロックが壊れている");
            leases.retain(|lease| lease.tab_id != tab_id);
        }

        Ok(chunk)
    }

    /// 結果セットを保持していない接続を 1 本選ぶ。
    ///
    /// スキーマ取得と実行計画に使う。これらはカーソルを開かないため、割り当ての
    /// 表には載せない。空きが無ければ最も長く使われていない接続を借りる（その
    /// 接続のカーソルは閉じない。問い合わせが 1 つ増えるだけである）。
    fn background_handle(&self) -> DbResult<Arc<ConnectionHandle>> {
        let leases = self.leases.lock().expect("割り当て表のロックが壊れている");

        let used: Vec<usize> = leases.iter().map(|lease| lease.slot).collect();
        let slot = (0..self.handles.len())
            .find(|slot| !used.contains(slot))
            .or_else(|| leases.first().map(|lease| lease.slot))
            .ok_or_else(DbError::closed)?;

        Ok(Arc::clone(&self.handles[slot]))
    }

    /// スキーマツリーの段階 1 を取る（ADR 0007）。
    ///
    /// # 引数
    ///
    /// * `filter` - 絞り込み条件
    pub fn schema_overview(&self, filter: &SchemaFilter) -> DbResult<Vec<SchemaNode>> {
        self.background_handle()?.schema_overview(filter)
    }

    /// スキーマ 1 つぶんの列情報を取る（ADR 0007 の段階 2）。
    ///
    /// # 引数
    ///
    /// * `owner` - 対象のスキーマ名
    pub fn schema_columns(&self, owner: &str) -> DbResult<Vec<TableColumn>> {
        self.background_handle()?.schema_columns(owner)
    }

    /// 見積りだけの実行計画を取る（`⌘E`）。
    ///
    /// # 引数
    ///
    /// * `sql` - 計画を見たい SQL
    pub fn explain_plan(&self, sql: &str) -> DbResult<String> {
        self.background_handle()?.explain_plan(sql)
    }

    /// 実測付きの実行計画を取る（`⇧⌘E`）。
    ///
    /// # 引数
    ///
    /// * `sql` - 計画を見たい SQL
    pub fn actual_plan(&self, sql: &str) -> DbResult<String> {
        self.background_handle()?.actual_plan(sql)
    }

    /// トランザクションをコミットする（`⌥⌘C`、ADR 0012）。
    ///
    /// プールの全接続へ送る。DML はカーソルを残さないため実行後に割り当てが
    /// 外れ、どの接続で走ったかを割り当ての表から辿れない。未コミットの変更が
    /// 無い接続でコミットしても害は無いため、取りこぼさないほうを採る。
    pub fn commit(&self) -> DbResult<()> {
        self.全接続へ(|handle| handle.commit())
    }

    /// トランザクションをロールバックする（`⌥⌘R`、ADR 0012）。
    ///
    /// コミットと同じ理由でプールの全接続へ送る。
    pub fn rollback(&self) -> DbResult<()> {
        self.全接続へ(|handle| handle.rollback())
    }

    /// プールの全接続に同じ操作を行う。
    ///
    /// 途中で失敗しても残りの接続へは送り切る。1 本目で止めると、2 本目以降に
    /// 未コミットの変更が残ったままになるためである。最初のエラーを返す。
    ///
    /// # 引数
    ///
    /// * `操作` - 各接続に対して行うこと
    fn 全接続へ(&self, 操作: impl Fn(&ConnectionHandle) -> DbResult<()>) -> DbResult<()> {
        let mut 最初のエラー = None;

        for handle in &self.handles {
            if let Err(error) = 操作(handle) {
                最初のエラー.get_or_insert(error);
            }
        }

        match 最初のエラー {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }

    /// 実行中の文を中止する（`⌘.`）。
    ///
    /// # 引数
    ///
    /// * `tab_id` - 対象のタブ
    pub fn cancel(&self, tab_id: &str) -> DbResult<()> {
        let Some(handle) = self.leased(tab_id) else {
            return Ok(());
        };
        handle.cancel()
    }
}

/// テストからプールへ任意のドライバを載せるための入口。
///
/// 実データベースを使わずに、割り当ての付け替えと結果セットの破棄を確かめられる。
///
/// # 引数
///
/// * `drivers` - プールに載せるドライバを作る処理
/// * `chunk_size` - 一度に取り出す行数
pub fn pool_from_drivers<D, F>(drivers: Vec<F>, chunk_size: usize) -> DbResult<ConnectionPool>
where
    D: Driver,
    F: FnOnce() -> DbResult<D> + Send + 'static,
{
    let mut handles = Vec::with_capacity(drivers.len());
    for connect in drivers {
        handles.push(Arc::new(ConnectionHandle::open(connect)?));
    }
    Ok(ConnectionPool::from_handles(handles, chunk_size))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::driver::{Canceller, Column};
    use crate::db::value::CellKind;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// コミットとロールバックの回数だけを数えるドライバ。
    ///
    /// プールが全接続へ命令を配っているかを、実データベース抜きで確かめる。
    struct 数えるドライバ {
        コミットした回数: Arc<AtomicUsize>,
        ロールバックした回数: Arc<AtomicUsize>,
    }

    struct 何もしない中止経路;

    impl Canceller for 何もしない中止経路 {
        fn cancel(&self) -> DbResult<()> {
            Ok(())
        }
    }

    impl Driver for 数えるドライバ {
        fn canceller(&self) -> Box<dyn Canceller> {
            Box::new(何もしない中止経路)
        }

        fn execute(&mut self, _sql: &str, _chunk_size: usize) -> DbResult<ExecuteOutcome> {
            Ok(ExecuteOutcome::Query {
                columns: vec![Column {
                    name: String::from("N"),
                    type_name: String::from("NUMBER"),
                    kind: CellKind::Number,
                }],
                chunk: Chunk {
                    rows: Vec::new(),
                    exhausted: true,
                },
                elapsed_ms: 0,
                notices: Vec::new(),
                in_transaction: false,
            })
        }

        fn fetch_more(&mut self, _chunk_size: usize) -> DbResult<Chunk> {
            Ok(Chunk {
                rows: Vec::new(),
                exhausted: true,
            })
        }

        fn close_cursor(&mut self) -> DbResult<()> {
            Ok(())
        }

        fn schema_overview(&mut self, _filter: &SchemaFilter) -> DbResult<Vec<SchemaNode>> {
            Ok(Vec::new())
        }

        fn schema_columns(&mut self, _owner: &str) -> DbResult<Vec<TableColumn>> {
            Ok(Vec::new())
        }

        fn commit(&mut self) -> DbResult<()> {
            self.コミットした回数.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }

        fn rollback(&mut self) -> DbResult<()> {
            self.ロールバックした回数.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }

        fn explain_plan(&mut self, _sql: &str) -> DbResult<String> {
            Ok(String::new())
        }

        fn actual_plan(&mut self, _sql: &str) -> DbResult<String> {
            Ok(String::new())
        }
    }

    /// 数を数えるドライバを `本数` ぶん載せたプールを作る。
    fn 数えるプールを作る(
        本数: usize,
    ) -> (ConnectionPool, Arc<AtomicUsize>, Arc<AtomicUsize>) {
        let コミットした回数 = Arc::new(AtomicUsize::new(0));
        let ロールバックした回数 = Arc::new(AtomicUsize::new(0));

        let drivers: Vec<_> = (0..本数)
            .map(|_| {
                let コミット = Arc::clone(&コミットした回数);
                let ロールバック = Arc::clone(&ロールバックした回数);
                move || {
                    Ok(数えるドライバ {
                        コミットした回数: コミット,
                        ロールバックした回数: ロールバック,
                    })
                }
            })
            .collect();

        let pool = pool_from_drivers(drivers, DEFAULT_CHUNK_SIZE).unwrap();
        (pool, コミットした回数, ロールバックした回数)
    }

    #[test]
    fn コミットはプールの全接続へ届く() {
        // Arrange: DML はカーソルを残さず割り当ての表から消えるため、
        // どの接続で走ったかを辿れない（ADR 0012）
        let (pool, コミットした回数, _) = 数えるプールを作る(4);

        // Act
        pool.commit().unwrap();

        // Assert
        assert_eq!(コミットした回数.load(Ordering::SeqCst), 4);
    }

    #[test]
    fn ロールバックはプールの全接続へ届く() {
        // Arrange
        let (pool, _, ロールバックした回数) = 数えるプールを作る(4);

        // Act
        pool.rollback().unwrap();

        // Assert
        assert_eq!(ロールバックした回数.load(Ordering::SeqCst), 4);
    }
}
