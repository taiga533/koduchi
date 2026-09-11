//! ウィンドウごとの接続プール（ADR 0003）。
//!
//! 結果セットのカーソルを開いたまま保つと、その接続は占有される。エディタタブは
//! 複数あり、それぞれが結果を保持しうるため、接続を 1 本にするとタブを持つ意味が
//! 無くなる。そこでウィンドウごとに数本の接続を持ち、結果を保持しているタブに
//! 1 本ずつ割り当てる。
//!
//! 本数を超えたときは、最も長く使われていないタブの結果セットを閉じる。閉じられた
//! タブには「結果は破棄されました。再実行してください」を出す。
//!
//! **1 本がサーバ側で切れたら、プールの全部を切れたものとして扱う**（ADR 0026）。
//! 断の原因（アイドル時間の超過・VPN の切断・サーバの再起動）はどれも接続を
//! 選ばず、4 本が同じプロファイルの同じ経路で張られている以上、1 本が切れたなら
//! 残りも切れているか、じきに切れる。1 本ずつ差し替えると、タブによって
//! 「生きている接続」と「死んだ接続」が混ざり、全接続へ配るコミット
//! （ADR 0012）の意味が壊れる。

use crate::db::actor::ConnectionHandle;
use crate::db::definition::{ObjectDdl, ObjectDefinition};
use crate::db::driver::{Bind, Chunk, ConnectionParams, Driver, ExecuteOutcome};
use crate::db::error::{DbError, DbErrorKind, DbResult};
use crate::db::schema::{ObjectKind, SchemaFilter, SchemaNode, TableColumn};
use crate::db::sessions::SessionOverview;
use crate::db::source::{SourceLine, SourceSearchRequest, SourceSearchResult, SourceTarget};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// プールが持つ接続の既定の本数。
///
/// 4 本あればタブを行き来しながらスクロールできる（ADR 0003）。
pub const DEFAULT_POOL_SIZE: usize = 4;

/// 一度に取り出す行数（ADR 0003）。
pub const DEFAULT_CHUNK_SIZE: usize = 1_000;

/// 接続が切れているプールを使おうとしたときの文言（ADR 0026）。
///
/// 往復せずにその場で返す。切れていると分かっている接続へ投げ直しても、
/// 待たされたうえで同じ番号が返るだけである。
pub const CONNECTION_LOST_MESSAGE: &str = "接続が切れています。再接続してください";

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
    /// サーバ側で接続が切れたか（ADR 0026）。
    ///
    /// **1 本でも切れたらプールごと切れたものとして扱う。**立った後は往復せず、
    /// その場で `ConnectionLost` を返す。
    lost: AtomicBool,
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
            lost: AtomicBool::new(false),
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
            lost: AtomicBool::new(false),
        }
    }

    /// サーバ側で接続が切れているか（ADR 0026）。
    pub fn is_lost(&self) -> bool {
        self.lost.load(Ordering::SeqCst)
    }

    /// 接続が切れたものとして印を立てる（ADR 0026）。
    ///
    /// 割り当ての表も空にする。切れた接続のカーソルはサーバ側にもう無いため、
    /// 表に残しておくと「続きを取れる」と読める嘘になる。
    fn mark_lost(&self) {
        self.lost.store(true, Ordering::SeqCst);
        let mut leases = self.leases.lock().expect("割り当て表のロックが壊れている");
        leases.clear();
    }

    /// データベースへの往復を見張る（ADR 0026）。
    ///
    /// 既に切れていれば往復しない。往復の結果が接続断であれば、プールごと
    /// 切れたものとして印を立てる。**接続を要る操作はすべてこれを通す。**
    /// 経路ごとに書き足す形にすると、足した経路だけが断に気付けなくなる。
    ///
    /// # 引数
    ///
    /// * `往復` - データベースへ投げる処理
    fn 見張る<T>(&self, 往復: impl FnOnce() -> DbResult<T>) -> DbResult<T> {
        if self.is_lost() {
            return Err(DbError::connection_lost(CONNECTION_LOST_MESSAGE));
        }

        let result = 往復();

        if let Err(error) = &result {
            if error.kind == DbErrorKind::ConnectionLost {
                self.mark_lost();
            }
        }

        result
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
    /// * `binds` - SQL 中のバインド変数へ与える値
    pub fn execute(&self, tab_id: &str, sql: &str, binds: &[Bind]) -> DbResult<ExecuteResponse> {
        if self.is_lost() {
            return Err(DbError::connection_lost(CONNECTION_LOST_MESSAGE));
        }

        let (handle, discarded_tab) = self.acquire(tab_id);

        // 剥がしたタブのカーソルは、同じ接続を使い回す前に閉じておく必要がある。
        // 実行そのものが前のカーソルを閉じるため、ここでは表からの削除だけでよい。
        let outcome = self.見張る(|| handle.execute(sql, binds, self.chunk_size))?;

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
        // 切れているときに「結果は破棄されました」と言わない。原因が違う（ADR 0026）。
        if self.is_lost() {
            return Err(DbError::connection_lost(CONNECTION_LOST_MESSAGE));
        }

        let handle = self.touch(tab_id).ok_or_else(|| {
            DbError::new(
                crate::db::error::DbErrorKind::Closed,
                "結果は破棄されました。再実行してください",
            )
        })?;

        let chunk = self.見張る(|| handle.fetch_more(self.chunk_size))?;

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
        self.見張る(|| self.background_handle()?.schema_overview(filter))
    }

    /// スキーマ 1 つぶんの列情報を取る（ADR 0007 の段階 2）。
    ///
    /// # 引数
    ///
    /// * `owner` - 対象のスキーマ名
    pub fn schema_columns(&self, owner: &str) -> DbResult<Vec<TableColumn>> {
        self.見張る(|| self.background_handle()?.schema_columns(owner))
    }

    /// 見積りだけの実行計画を取る（`⌘E`）。
    ///
    /// # 引数
    ///
    /// * `sql` - 計画を見たい SQL
    /// * `binds` - SQL 中のバインド変数へ与える値
    pub fn explain_plan(&self, sql: &str, binds: &[Bind]) -> DbResult<String> {
        self.見張る(|| self.background_handle()?.explain_plan(sql, binds))
    }

    /// 実測付きの実行計画を取る（`⇧⌘E`）。
    ///
    /// # 引数
    ///
    /// * `sql` - 計画を見たい SQL
    /// * `binds` - SQL 中のバインド変数へ与える値
    pub fn actual_plan(&self, sql: &str, binds: &[Bind]) -> DbResult<String> {
        self.見張る(|| self.background_handle()?.actual_plan(sql, binds))
    }

    /// トランザクションをコミットする（`⌥⌘C`、ADR 0012）。
    ///
    /// プールの全接続へ送る。DML はカーソルを残さないため実行後に割り当てが
    /// 外れ、どの接続で走ったかを割り当ての表から辿れない。未コミットの変更が
    /// 無い接続でコミットしても害は無いため、取りこぼさないほうを採る。
    pub fn commit(&self) -> DbResult<()> {
        self.見張る(|| self.全接続へ(|handle| handle.commit()))
    }

    /// トランザクションをロールバックする（`⌥⌘R`、ADR 0012）。
    ///
    /// コミットと同じ理由でプールの全接続へ送る。
    pub fn rollback(&self) -> DbResult<()> {
        self.見張る(|| self.全接続へ(|handle| handle.rollback()))
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

    /// テーブル定義ビュー 1 枚ぶんの内容を取る（ADR 0019）。
    ///
    /// 結果セットを保持していない接続で読むため、利用者が見ている結果は
    /// 壊れない。スキーマ取得・実行計画・セッション一覧と同じ経路である。
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
        self.見張る(|| {
            self.background_handle()?
                .object_definition(owner, name, kind)
        })
    }

    /// オブジェクト 1 つの DDL を取る（ADR 0019）。
    ///
    /// 定義の取得と同じく、結果セットを保持していない接続で読む。
    ///
    /// # 引数
    ///
    /// * `owner` - 所有者のスキーマ名
    /// * `name` - オブジェクト名
    /// * `kind` - オブジェクトの種類
    pub fn object_ddl(&self, owner: &str, name: &str, kind: ObjectKind) -> DbResult<ObjectDdl> {
        self.見張る(|| self.background_handle()?.object_ddl(owner, name, kind))
    }

    /// セッションの一覧とブロッキングの連鎖を取る（ADR 0017）。
    ///
    /// 結果セットを保持していない接続で読むため、利用者が見ている結果は
    /// 壊れない。スキーマ取得や実行計画と同じ経路である。
    pub fn list_sessions(&self) -> DbResult<SessionOverview> {
        self.見張る(|| self.background_handle()?.list_sessions())
    }

    /// セッションを 1 つ終了する（ADR 0017）。
    ///
    /// 読み取り専用の接続と、小槌自身が張っている接続はドライバが弾く。
    ///
    /// # 引数
    ///
    /// * `sid` - 対象の `SID`
    /// * `serial` - 対象の `SERIAL#`
    pub fn kill_session(&self, sid: u32, serial: u32) -> DbResult<()> {
        self.見張る(|| self.background_handle()?.kill_session(sid, serial))
    }

    /// オブジェクトのソースを横断して検索する（ADR 0021）。
    ///
    /// セッションの一覧やスキーマ取得と同じく、結果セットを保持していない接続で
    /// 読む。`ALL_SOURCE` を舐める重い問い合わせであっても、利用者が開いている
    /// 結果セットは壊れない。
    ///
    /// # 引数
    ///
    /// * `request` - 検索の求め
    pub fn search_source(&self, request: SourceSearchRequest) -> DbResult<SourceSearchResult> {
        self.見張る(|| self.background_handle()?.search_source(request))
    }

    /// 当たった行の前後を読む（ADR 0021）。
    ///
    /// # 引数
    ///
    /// * `target` - 読むオブジェクト
    /// * `line` - 中心にする行
    pub fn source_context(&self, target: SourceTarget, line: u32) -> DbResult<Vec<SourceLine>> {
        self.見張る(|| self.background_handle()?.source_context(target, line))
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
    use crate::db::driver::{Bind, Canceller, Column};
    use crate::db::value::CellKind;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// 何を求められても接続断で断るドライバ（ADR 0026）。
    ///
    /// 実データベース抜きで「1 本が切れたらプールごと切れる」を確かめる。
    /// 断は実行だけでなくスキーマ取得やコミットでも起こりうるため、
    /// すべての口で同じエラーを返す。
    struct 切れているドライバ;

    /// 切れているドライバが返すエラー。
    fn 断のエラー() -> DbError {
        DbError::connection_lost("ORA-02396: 最大アイドル時間を超過しました")
    }

    impl Driver for 切れているドライバ {
        fn canceller(&self) -> Box<dyn Canceller> {
            Box::new(何もしない中止経路)
        }

        fn execute(
            &mut self,
            _sql: &str,
            _binds: &[Bind],
            _chunk_size: usize,
        ) -> DbResult<ExecuteOutcome> {
            Err(断のエラー())
        }

        fn fetch_more(&mut self, _chunk_size: usize) -> DbResult<Chunk> {
            Err(断のエラー())
        }

        fn close_cursor(&mut self) -> DbResult<()> {
            Ok(())
        }

        fn schema_overview(&mut self, _filter: &SchemaFilter) -> DbResult<Vec<SchemaNode>> {
            Err(断のエラー())
        }

        fn schema_columns(&mut self, _owner: &str) -> DbResult<Vec<TableColumn>> {
            Err(断のエラー())
        }

        fn commit(&mut self) -> DbResult<()> {
            Err(断のエラー())
        }

        fn rollback(&mut self) -> DbResult<()> {
            Err(断のエラー())
        }

        fn explain_plan(&mut self, _sql: &str, _binds: &[Bind]) -> DbResult<String> {
            Err(断のエラー())
        }

        fn actual_plan(&mut self, _sql: &str, _binds: &[Bind]) -> DbResult<String> {
            Err(断のエラー())
        }

        fn object_definition(
            &mut self,
            _owner: &str,
            _name: &str,
            _kind: ObjectKind,
        ) -> DbResult<ObjectDefinition> {
            Err(断のエラー())
        }

        fn object_ddl(
            &mut self,
            _owner: &str,
            _name: &str,
            _kind: ObjectKind,
        ) -> DbResult<ObjectDdl> {
            Err(断のエラー())
        }

        fn list_sessions(&mut self) -> DbResult<SessionOverview> {
            Err(断のエラー())
        }

        fn kill_session(&mut self, _sid: u32, _serial: u32) -> DbResult<()> {
            Err(断のエラー())
        }

        fn search_source(
            &mut self,
            _request: &SourceSearchRequest,
        ) -> DbResult<SourceSearchResult> {
            Err(断のエラー())
        }

        fn source_context(
            &mut self,
            _target: &SourceTarget,
            _line: u32,
        ) -> DbResult<Vec<SourceLine>> {
            Err(断のエラー())
        }
    }

    /// 切れているドライバを 4 本載せたプールを組む。
    fn 切れているプールを組む() -> ConnectionPool {
        let drivers: Vec<_> = (0..4).map(|_| || Ok(切れているドライバ)).collect();
        pool_from_drivers(drivers, DEFAULT_CHUNK_SIZE).unwrap()
    }

    /// コミットとロールバックの回数だけを数えるドライバ。
    ///
    /// プールが全接続へ命令を配っているかを、実データベース抜きで確かめる。
    struct 数えるドライバ {
        コミットした回数: Arc<AtomicUsize>,
        ロールバックした回数: Arc<AtomicUsize>,
        /// セッションの一覧を求められた回数（ADR 0017）。
        一覧を求められた回数: Arc<AtomicUsize>,
        /// ソース検索を求められた回数（ADR 0021）。
        検索を求められた回数: Arc<AtomicUsize>,
        /// DDL を求められた回数（ADR 0019）。
        定義を求められた回数: Arc<AtomicUsize>,
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

        fn execute(
            &mut self,
            _sql: &str,
            _binds: &[Bind],
            _chunk_size: usize,
        ) -> DbResult<ExecuteOutcome> {
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

        fn explain_plan(&mut self, _sql: &str, _binds: &[Bind]) -> DbResult<String> {
            Ok(String::new())
        }

        fn actual_plan(&mut self, _sql: &str, _binds: &[Bind]) -> DbResult<String> {
            Ok(String::new())
        }

        fn object_definition(
            &mut self,
            owner: &str,
            name: &str,
            kind: ObjectKind,
        ) -> DbResult<ObjectDefinition> {
            Ok(ObjectDefinition {
                owner: owner.to_string(),
                name: name.to_string(),
                kind,
                comment: None,
                columns: Vec::new(),
                constraints: Vec::new(),
                indexes: Vec::new(),
            })
        }

        fn object_ddl(&mut self, owner: &str, name: &str, kind: ObjectKind) -> DbResult<ObjectDdl> {
            self.定義を求められた回数.fetch_add(1, Ordering::SeqCst);
            Ok(ObjectDdl {
                owner: owner.to_string(),
                name: name.to_string(),
                kind,
                parts: Vec::new(),
            })
        }

        fn list_sessions(&mut self) -> DbResult<SessionOverview> {
            self.一覧を求められた回数.fetch_add(1, Ordering::SeqCst);
            Ok(SessionOverview::new(1, 10, Vec::new()))
        }

        fn kill_session(&mut self, _sid: u32, _serial: u32) -> DbResult<()> {
            Ok(())
        }

        fn search_source(&mut self, request: &SourceSearchRequest) -> DbResult<SourceSearchResult> {
            self.検索を求められた回数.fetch_add(1, Ordering::SeqCst);
            Ok(crate::db::source::group_matches(
                Vec::new(),
                request.effective_limit(),
            ))
        }

        fn source_context(
            &mut self,
            _target: &SourceTarget,
            _line: u32,
        ) -> DbResult<Vec<SourceLine>> {
            Ok(Vec::new())
        }
    }

    /// プールに配られた命令の回数。
    ///
    /// 数えるものが増えるたびに戻り値の組が伸びるため、名前の付いた 1 つの型に
    /// まとめてある。読む側は要る欄だけを見ればよい。
    #[derive(Clone, Default)]
    struct 数えた回数 {
        コミット: Arc<AtomicUsize>,
        ロールバック: Arc<AtomicUsize>,
        /// セッションの一覧（ADR 0017）。
        一覧: Arc<AtomicUsize>,
        /// ソース検索（ADR 0021）。
        検索: Arc<AtomicUsize>,
        /// DDL の取得（ADR 0019）。
        定義: Arc<AtomicUsize>,
    }

    /// 数を数えるドライバを `本数` ぶん載せたプールと、数えている値を返す。
    ///
    /// # 引数
    ///
    /// * `本数` - プールに載せる接続の本数
    fn 数えるプールを組む(本数: usize) -> (ConnectionPool, 数えた回数) {
        let 回数 = 数えた回数::default();

        let drivers: Vec<_> = (0..本数)
            .map(|_| {
                let 回数 = 回数.clone();
                move || {
                    Ok(数えるドライバ {
                        コミットした回数: 回数.コミット,
                        ロールバックした回数: 回数.ロールバック,
                        一覧を求められた回数: 回数.一覧,
                        検索を求められた回数: 回数.検索,
                        定義を求められた回数: 回数.定義,
                    })
                }
            })
            .collect();

        let pool = pool_from_drivers(drivers, DEFAULT_CHUNK_SIZE).unwrap();
        (pool, 回数)
    }

    #[test]
    fn コミットはプールの全接続へ届く() {
        // Arrange: DML はカーソルを残さず割り当ての表から消えるため、
        // どの接続で走ったかを辿れない（ADR 0012）
        let (pool, 回数) = 数えるプールを組む(4);

        // Act
        pool.commit().unwrap();

        // Assert
        assert_eq!(回数.コミット.load(Ordering::SeqCst), 4);
    }

    #[test]
    fn セッションの一覧は一本の接続だけで読む() {
        // Arrange: 一覧はコミットと違い、全接続へ配る必要が無い（ADR 0017）
        let (pool, 回数) = 数えるプールを組む(4);

        // Act
        pool.list_sessions().unwrap();

        // Assert
        assert_eq!(回数.一覧.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn ソース検索も一本の接続だけで読む() {
        // Arrange: 重い問い合わせであるほど、全接続へ配らないことが効く（ADR 0021）
        let (pool, 回数) = 数えるプールを組む(4);
        let request = SourceSearchRequest {
            needle: String::from("orders"),
            owner: None,
            kinds: crate::db::source::SourceKindFilter::default(),
            case_sensitive: false,
            limit: crate::db::source::SOURCE_SEARCH_DEFAULT_LIMIT,
        };

        // Act
        pool.search_source(request).unwrap();

        // Assert
        assert_eq!(回数.検索.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn ddlの取得は一本の接続だけで読む() {
        // Arrange: 定義もコミットと違い、全接続へ配る必要が無い（ADR 0019）
        let (pool, 回数) = 数えるプールを組む(4);

        // Act
        pool.object_ddl("KODUCHI", "ORDERS", ObjectKind::Table)
            .unwrap();

        // Assert
        assert_eq!(回数.定義.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn 接続断は最初は立っていない() {
        // Arrange & Act
        let (pool, _) = 数えるプールを組む(4);

        // Assert
        assert!(!pool.is_lost());
    }

    #[test]
    fn 一本が切れるとプールごと切れたものとして扱う() {
        // Arrange: 断の原因は接続を選ばない（ADR 0026）
        let pool = 切れているプールを組む();

        // Act
        let 実行 = pool.execute("t1", "select 1 from dual", &[]);

        // Assert
        assert_eq!(実行.unwrap_err().kind, DbErrorKind::ConnectionLost);
        assert!(pool.is_lost());
    }

    #[test]
    fn 切れたあとは往復せずに接続断を返す() {
        // Arrange: 切れていると分かっている相手へ投げ直しても、待たされて
        // 同じ番号が返るだけである（ADR 0026）
        let pool = 切れているプールを組む();
        pool.execute("t1", "select 1 from dual", &[]).unwrap_err();

        // Act
        let 二度目 = pool.execute("t1", "select 1 from dual", &[]);

        // Assert
        let error = 二度目.unwrap_err();
        assert_eq!(error.kind, DbErrorKind::ConnectionLost);
        assert_eq!(error.message, CONNECTION_LOST_MESSAGE);
    }

    #[test]
    fn 実行で切れたあとはスキーマ取得もコミットも通さない() {
        // Arrange: 1 本の断を他の口が知らないと、タブによって挙動が変わる
        let pool = 切れているプールを組む();
        pool.execute("t1", "select 1 from dual", &[]).unwrap_err();

        // Act & Assert
        assert_eq!(
            pool.schema_overview(&SchemaFilter::default())
                .unwrap_err()
                .kind,
            DbErrorKind::ConnectionLost
        );
        assert_eq!(pool.commit().unwrap_err().kind, DbErrorKind::ConnectionLost);
        assert_eq!(
            pool.rollback().unwrap_err().kind,
            DbErrorKind::ConnectionLost
        );
    }

    #[test]
    fn 切れると割り当ての表は空になる() {
        // Arrange: 切れた接続のカーソルはサーバ側にもう無い（ADR 0026）
        let (pool, _) = 数えるプールを組む(1);
        pool.execute("t1", "select 1 from dual", &[]).unwrap();
        pool.mark_lost();

        // Act
        let 続き = pool.fetch_more("t1");

        // Assert: 「結果は破棄されました」ではなく接続断として告げる
        assert_eq!(続き.unwrap_err().kind, DbErrorKind::ConnectionLost);
    }

    #[test]
    fn 切れていないプールの実行エラーは印を立てない() {
        // Arrange: 綴りの誤りで「接続が切れた」と言わない
        let pool = 数えるプールを組む(4).0;

        // Act
        pool.execute("t1", "select 1 from dual", &[]).unwrap();

        // Assert
        assert!(!pool.is_lost());
    }

    #[test]
    fn ロールバックはプールの全接続へ届く() {
        // Arrange
        let (pool, 回数) = 数えるプールを組む(4);

        // Act
        pool.rollback().unwrap();

        // Assert
        assert_eq!(回数.ロールバック.load(Ordering::SeqCst), 4);
    }
}
