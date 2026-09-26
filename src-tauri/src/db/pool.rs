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
use crate::db::driver::{Bind, Chunk, ConnectionParams, Driver, ExecuteOutcome, Liveness};
use crate::db::error::{DbError, DbErrorKind, DbResult};
use crate::db::schema::{ObjectKind, SchemaFilter, SchemaNode, TableColumn};
use crate::db::sessions::SessionOverview;
use crate::db::source::{SourceLine, SourceSearchRequest, SourceSearchResult, SourceTarget};
use serde::Serialize;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

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

/// 手放したタブから実行を求められたときの文言（ADR 0003）。
///
/// 閉じたタブの応答であり、フロントエンドはタブの世代で結果ペインへの書き戻しを
/// 捨てる。**ただしメッセージタブのログと履歴には、失敗した実行としてこの文言が
/// そのまま残る**（どちらもタブではなくウィンドウと接続をまたぐ記録であるため）。
/// 閉じる前に投げた文が流れなかったことを利用者が読める言い方にしてある。
const RELEASED_TAB_MESSAGE: &str = "このタブは既に閉じられています";

/// ステータスバーへ返す接続の様子（ADR 0030）。
///
/// **どちらの項目もデータベースへ往復せずに作る。**生存確認の問い合わせを
/// 投げればアイドル時間が戻り、サーバ側が設定した `IDLE_TIME` を骨抜きに
/// してしまう（ADR 0026）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionHealth {
    /// サーバ側から切られていることが分かったか。
    ///
    /// **偽は「繋がっている」ではない。**回線が落ちただけの断はクライアントに
    /// 見えないため、切れていても偽のままになる。
    pub disconnected: bool,
    /// 最後にデータベースと往復できた時刻（UNIX ミリ秒）。
    ///
    /// 「いつまで確かだったか」を利用者へ正直に見せるための値である。接続を
    /// 確立した時刻が初期値になる。
    pub last_round_trip_ms: u64,
}

/// 現在時刻を UNIX ミリ秒で返す。
///
/// 表示のためだけに使う値であるため、時計が巻き戻っていても落とさず 0 を返す。
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|経過| 経過.as_millis() as u64)
        .unwrap_or(0)
}

/// タブへの接続の割り当て。
#[derive(Debug, Clone, PartialEq, Eq)]
struct Lease {
    /// 結果セットを保持しているタブ。
    tab_id: String,
    /// プール内での接続の位置。
    slot: usize,
    /// 割り当ての通し番号（ADR 0003 への 2026-09-27 の追記）。
    ///
    /// 新しいカーソルを開くたびに採り直す。実行と続きの取り出しは、待った後に
    /// 割り当てを外すことがある。タブの ID だけで外すと、待っている間に同じタブが
    /// 受けた新しい割り当て（実行し直しのカーソル）まで外し、割り当ての無い
    /// カーソルが残る。積むときに控えた番号と一致するものだけを外す。
    serial: u64,
}

/// 割り当ての表。
///
/// 割り当ての並びと手放したタブを 1 つのロックの下に置く。別々のロックにすると、
/// 「手放した」の書き込みと割り当ての間に別の操作が挟まりうる。
#[derive(Debug, Default)]
struct LeaseTable {
    /// 割り当ての一覧。先頭ほど長く使われていない。
    leases: Vec<Lease>,
    /// 手放したタブ（ADR 0003 への 2026-09-27 の追記）。
    ///
    /// Tauri のコマンドは `run_blocking` で別々のスレッドに載るため、タブを閉じる
    /// 前に送った実行が手放しより後に届くことがある。覚えておかないと、閉じた
    /// タブに接続が割り当てられ、LRU で剥がされるまで接続とカーソルを握り続ける。
    /// タブの ID は使い回されず（UUID）、接続を張り直せばプールごと作り直すため、
    /// 1 つのプールの中で「手放したタブがまた使われる」ことは無い。
    released: HashSet<String>,
    /// 次に採る割り当ての通し番号。
    next_serial: u64,
}

impl LeaseTable {
    /// 割り当ての通し番号を採る。
    ///
    /// プールごとに単調に増やせば足りる。プールより長く生きる割り当ては無い。
    fn next_serial(&mut self) -> u64 {
        self.next_serial += 1;
        self.next_serial
    }

    /// 控えた通し番号の割り当てだけを外す。
    ///
    /// 待っている間に同じタブが新しい割り当てを受けていれば、番号が違うため
    /// 外さない（`Lease::serial` を参照）。
    ///
    /// # 引数
    ///
    /// * `serial` - 積むときに控えた通し番号
    fn remove_serial(&mut self, serial: u64) {
        self.leases.retain(|lease| lease.serial != serial);
    }
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
    /// 割り当ての表。
    ///
    /// **カーソルに触れる命令（実行・続きの取り出し・カーソルを閉じる）は、
    /// この表を握ったままアクタースレッドへ積む。**アクタースレッドは積まれた順に
    /// 処理するため、そうすれば接続ごとの処理の順が表の書き換えの順と揃う。
    /// 表を離してから積むと、同じ接続を引き継いだ別のタブの命令と追い越し合い、
    /// そのタブのカーソルを閉じたり、そのタブの行を読んだりする。
    leases: Mutex<LeaseTable>,
    chunk_size: usize,
    /// サーバ側で接続が切れたか（ADR 0026）。
    ///
    /// **1 本でも切れたらプールごと切れたものとして扱う。**立った後は往復せず、
    /// その場で `ConnectionLost` を返す。
    lost: AtomicBool,
    /// 最後にデータベースと往復できた時刻（UNIX ミリ秒、ADR 0030）。
    ///
    /// `見張る` が成功したときにだけ進める。往復していない操作で進めると、
    /// 「いつまで確かだったか」の表示が実際より新しくなる。
    last_round_trip: AtomicU64,
    /// 割り当ての表を離した直後に 1 度だけ呼ぶ差し込み口（テスト専用）。
    ///
    /// 表を離してから返事を待つまでの間へ別のタブの操作を割り込ませ、Tauri の
    /// コマンドが別々のスレッドで走ったときに起こりうる順序を決まった形で
    /// 再現するためにある。本番の組み立てには存在しない。
    #[cfg(test)]
    表を離した直後: Mutex<Option<Box<dyn FnOnce() + Send>>>,
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
            leases: Mutex::new(LeaseTable::default()),
            chunk_size,
            lost: AtomicBool::new(false),
            // 接続の確立そのものが往復である。
            last_round_trip: AtomicU64::new(now_ms()),
            #[cfg(test)]
            表を離した直後: Mutex::new(None),
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
            leases: Mutex::new(LeaseTable::default()),
            chunk_size,
            lost: AtomicBool::new(false),
            last_round_trip: AtomicU64::new(now_ms()),
            #[cfg(test)]
            表を離した直後: Mutex::new(None),
        }
    }

    /// 割り当ての表を離したことをテストの差し込み口へ知らせる。
    ///
    /// 本番の組み立てでは何もしない。
    fn 表を離した(&self) {
        #[cfg(test)]
        {
            let 差し込み = self
                .表を離した直後
                .lock()
                .expect("差し込み口のロックが壊れている")
                .take();
            if let Some(差し込み) = 差し込み {
                差し込み();
            }
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
        let mut table = self.leases.lock().expect("割り当て表のロックが壊れている");
        table.leases.clear();
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

        match &result {
            Ok(_) => {
                // 往復できた時刻はここでしか進めない（ADR 0030）。
                self.last_round_trip.store(now_ms(), Ordering::SeqCst);
            }
            Err(error) => {
                if error.kind == DbErrorKind::ConnectionLost {
                    self.mark_lost();
                }
            }
        }

        result
    }

    /// 往復を起こさずに接続の様子を覗く（ADR 0030）。
    ///
    /// **問い合わせは投げない。**OCI がクライアント側に持っている状態を
    /// 読むだけであり、アイドル時間は戻らない（ADR 0026 の「定期的な生存確認は
    /// しない」を守る）。
    ///
    /// 1 本でも切られていると分かればプールごと切れたものとして印を立てる
    /// （ADR 0026）。断の原因は接続を選ばないためである。
    pub fn probe(&self) -> Liveness {
        if self.is_lost() {
            return Liveness::Disconnected;
        }

        for handle in &self.handles {
            if handle.probe() == Liveness::Disconnected {
                self.mark_lost();
                return Liveness::Disconnected;
            }
        }

        Liveness::Unknown
    }

    /// ステータスバーへ返す接続の様子を作る（ADR 0030）。
    pub fn health(&self) -> ConnectionHealth {
        ConnectionHealth {
            disconnected: self.probe() == Liveness::Disconnected,
            last_round_trip_ms: self.last_round_trip.load(Ordering::SeqCst),
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
        let table = self.leases.lock().expect("割り当て表のロックが壊れている");
        table
            .leases
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
    /// * `table` - 握っている割り当ての表
    /// * `tab_id` - 対象のタブ
    ///
    /// # 戻り値
    ///
    /// 割り当てられている接続と、その割り当ての通し番号。
    fn touch(&self, table: &mut LeaseTable, tab_id: &str) -> Option<(Arc<ConnectionHandle>, u64)> {
        let index = table
            .leases
            .iter()
            .position(|lease| lease.tab_id == tab_id)?;
        let lease = table.leases.remove(index);
        let handle = Arc::clone(&self.handles[lease.slot]);
        let serial = lease.serial;
        table.leases.push(lease);
        Some((handle, serial))
    }

    /// タブに接続を割り当てる。
    ///
    /// 既に割り当てがあればそれを最近使ったものとして扱い直す。空きが無ければ、
    /// 最も長く使われていないタブの割り当てを剥がす。手放したタブには割り当てない。
    ///
    /// # 引数
    ///
    /// * `table` - 握っている割り当ての表
    /// * `tab_id` - 対象のタブ
    ///
    /// # 戻り値
    ///
    /// 割り当てた接続・その割り当ての通し番号・剥がされたタブ。通し番号は
    /// 既に持っている接続を使い続ける場合も採り直す。実行は新しいカーソルを
    /// 開くため、前のカーソルの続きを待っている側に外させてはならない。
    fn acquire(
        &self,
        table: &mut LeaseTable,
        tab_id: &str,
    ) -> DbResult<(Arc<ConnectionHandle>, u64, Option<String>)> {
        if table.released.contains(tab_id) {
            return Err(DbError::new(DbErrorKind::Closed, RELEASED_TAB_MESSAGE));
        }

        let serial = table.next_serial();

        // 既にこのタブが持っている接続は、そのまま使い続ける。
        if let Some((handle, _)) = self.touch(table, tab_id) {
            if let Some(lease) = table.leases.last_mut() {
                lease.serial = serial;
            }
            return Ok((handle, serial, None));
        }

        // 空いている接続があればそれを使う。
        let used: Vec<usize> = table.leases.iter().map(|lease| lease.slot).collect();
        if let Some(slot) = (0..self.handles.len()).find(|slot| !used.contains(slot)) {
            table.leases.push(Lease {
                tab_id: tab_id.to_string(),
                slot,
                serial,
            });
            return Ok((Arc::clone(&self.handles[slot]), serial, None));
        }

        // 空きが無ければ、最も長く使われていない割り当てを剥がす。
        let 剥がす = table.leases.remove(0);
        let handle = Arc::clone(&self.handles[剥がす.slot]);
        table.leases.push(Lease {
            tab_id: tab_id.to_string(),
            slot: 剥がす.slot,
            serial,
        });

        Ok((handle, serial, Some(剥がす.tab_id)))
    }

    /// タブの割り当てを外す。
    ///
    /// タブを閉じたときに呼ぶ。カーソルも一緒に閉じる。以後このタブの実行には
    /// 接続を割り当てない（割り当てが無かったときも覚える。実行より先に手放しが
    /// 届いた場合こそ、覚えておかないと閉じたタブに接続を握らせる）。
    ///
    /// # 引数
    ///
    /// * `tab_id` - 対象のタブ
    pub fn release(&self, tab_id: &str) -> DbResult<()> {
        let pending = {
            let mut table = self.leases.lock().expect("割り当て表のロックが壊れている");
            table.released.insert(tab_id.to_string());
            let Some(index) = table.leases.iter().position(|lease| lease.tab_id == tab_id) else {
                return Ok(());
            };
            let lease = table.leases.remove(index);
            // 表を握ったまま積む。離してから積むと、この接続を引き継いだ別のタブの
            // 実行が先に積まれ、そのタブのカーソルを閉じてしまう。
            self.handles[lease.slot].send_close_cursor()?
        };
        self.表を離した();

        // 割り当てがあるときだけカーソルを閉じに行く。往復するのはここからで
        // あるため、`見張る` を通すのもここだけでよい（ADR 0026・0030）。
        self.見張る(|| pending.wait())
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

        let (pending, serial, discarded_tab) = {
            let mut table = self.leases.lock().expect("割り当て表のロックが壊れている");
            let (handle, serial, discarded_tab) = self.acquire(&mut table, tab_id)?;
            // 剥がしたタブのカーソルは、同じ接続を使い回す前に閉じておく必要がある。
            // 実行そのものが前のカーソルを閉じるため、ここでは表からの削除だけでよい。
            // 積むのは表を握ったまま行う（`leases` の説明を参照）。
            (
                handle.send_execute(sql, binds, self.chunk_size)?,
                serial,
                discarded_tab,
            )
        };
        self.表を離した();

        let outcome = self.見張る(|| pending.wait())?;

        let 保持し続ける = matches!(
            &outcome,
            ExecuteOutcome::Query { chunk, .. } if !chunk.exhausted
        );

        if !保持し続ける {
            let mut table = self.leases.lock().expect("割り当て表のロックが壊れている");
            table.remove_serial(serial);
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

        let (pending, serial) = {
            let mut table = self.leases.lock().expect("割り当て表のロックが壊れている");
            let (handle, serial) = self.touch(&mut table, tab_id).ok_or_else(|| {
                DbError::new(
                    DbErrorKind::Closed,
                    "結果は破棄されました。再実行してください",
                )
            })?;
            // 表を握ったまま積む。離してから積むと、この割り当てを剥がした別のタブの
            // 実行が先に積まれ、そのタブの行を読んでしまう。
            (handle.send_fetch_more(self.chunk_size)?, serial)
        };
        self.表を離した();

        let chunk = self.見張る(|| pending.wait())?;

        // 尽きたら接続を明け渡す。
        if chunk.exhausted {
            let mut table = self.leases.lock().expect("割り当て表のロックが壊れている");
            table.remove_serial(serial);
        }

        Ok(chunk)
    }

    /// 結果セットを保持していない接続を 1 本選ぶ。
    ///
    /// スキーマ取得と実行計画に使う。これらはカーソルを開かないため、割り当ての
    /// 表には載せない。空きが無ければ最も長く使われていない接続を借りる（その
    /// 接続のカーソルは閉じない。問い合わせが 1 つ増えるだけである）。
    fn background_handle(&self) -> DbResult<Arc<ConnectionHandle>> {
        let table = self.leases.lock().expect("割り当て表のロックが壊れている");

        let used: Vec<usize> = table.leases.iter().map(|lease| lease.slot).collect();
        let slot = (0..self.handles.len())
            .find(|slot| !used.contains(slot))
            .or_else(|| table.leases.first().map(|lease| lease.slot))
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
    /// 中止は命令の列を通らない（塞がっているアクタースレッドへ届かせるため。
    /// ADR 0002）。そのため「表を握ったまま積む」決まりでは順序を揃えられず、
    /// 割り当てを覗いてから中止が届くまでの間に同じ接続で別のタブの文が
    /// 走り始めれば、そちらを中止しうる。表を握ったまま中止を送ると、切れた
    /// 回線で中止が返らないときにプールの全操作が止まるため、そうはしていない
    /// （ADR 0003 への 2026-09-27 の追記）。
    ///
    /// # 引数
    ///
    /// * `tab_id` - 対象のタブ
    pub fn cancel(&self, tab_id: &str) -> DbResult<()> {
        let Some(handle) = self.leased(tab_id) else {
            return Ok(());
        };
        // 中止もデータベースへの往復である。断に気付く経路から外さない
        // （ADR 0026）。
        self.見張る(|| handle.cancel())
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
    use crate::db::driver::{Bind, Canceller, Column, Prober};
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
        /// 往復なしの覗きに「切られている」と答えるか（ADR 0030）。
        切られている: Arc<AtomicBool>,
    }

    struct 何もしない中止経路;

    /// 印を読むだけの覗き手（ADR 0030）。
    ///
    /// 実データベース抜きで、往復しない覗きがプールへどう効くかを確かめる。
    struct 印を見る覗き手 {
        切られている: Arc<AtomicBool>,
    }

    impl Prober for 印を見る覗き手 {
        fn probe(&self) -> Liveness {
            if self.切られている.load(Ordering::SeqCst) {
                Liveness::Disconnected
            } else {
                Liveness::Unknown
            }
        }
    }

    impl Canceller for 何もしない中止経路 {
        fn cancel(&self) -> DbResult<()> {
            Ok(())
        }
    }

    impl Driver for 数えるドライバ {
        fn canceller(&self) -> Box<dyn Canceller> {
            Box::new(何もしない中止経路)
        }

        fn prober(&self) -> Box<dyn Prober> {
            Box::new(印を見る覗き手 {
                切られている: Arc::clone(&self.切られている),
            })
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
        let (pool, 回数, _) = 覗けるプールを組む(本数);
        (pool, 回数)
    }

    /// 数を数えるプールを、往復なしの覗きの答えを差し替えられる形で組む。
    ///
    /// 返す印を真にすると、以後の覗きが「サーバ側から切られている」と答える
    /// （ADR 0030）。
    ///
    /// # 引数
    ///
    /// * `本数` - プールに載せる接続の本数
    fn 覗けるプールを組む(
        本数: usize,
    ) -> (ConnectionPool, 数えた回数, Arc<AtomicBool>) {
        let 回数 = 数えた回数::default();
        let 切られている = Arc::new(AtomicBool::new(false));

        let drivers: Vec<_> = (0..本数)
            .map(|_| {
                let 回数 = 回数.clone();
                let 切られている = Arc::clone(&切られている);
                move || {
                    Ok(数えるドライバ {
                        コミットした回数: 回数.コミット,
                        ロールバックした回数: 回数.ロールバック,
                        一覧を求められた回数: 回数.一覧,
                        検索を求められた回数: 回数.検索,
                        定義を求められた回数: 回数.定義,
                        切られている,
                    })
                }
            })
            .collect();

        let pool = pool_from_drivers(drivers, DEFAULT_CHUNK_SIZE).unwrap();
        (pool, 回数, 切られている)
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
    fn 往復なしの覗きで切られていると分かればプールごと切れたものとして扱う() {
        // Arrange: 断の原因は接続を選ばない（ADR 0026）。往復しない覗きで
        // 分かったときも同じ扱いにする（ADR 0030）
        let (pool, _, 切られている) = 覗けるプールを組む(4);
        切られている.store(true, Ordering::SeqCst);

        // Act
        let 様子 = pool.probe();

        // Assert
        assert_eq!(様子, Liveness::Disconnected);
        assert!(pool.is_lost());
    }

    #[test]
    fn 覗いて切られていると分からなければ接続断の印は立たない() {
        // Arrange: 分からないことを切れていると言わない（ADR 0030）
        let (pool, _, _) = 覗けるプールを組む(4);

        // Act
        let 様子 = pool.probe();

        // Assert
        assert_eq!(様子, Liveness::Unknown);
        assert!(!pool.is_lost());
    }

    #[test]
    fn 覗いて切られていると分かった後は問い合わせも往復せずに断を返す() {
        // Arrange: 印が立った後は往復しない（ADR 0026）
        let (pool, 回数, 切られている) = 覗けるプールを組む(4);
        切られている.store(true, Ordering::SeqCst);
        pool.probe();

        // Act
        let 一覧 = pool.list_sessions();

        // Assert
        assert_eq!(一覧.unwrap_err().kind, DbErrorKind::ConnectionLost);
        assert_eq!(回数.一覧.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn 往復に成功すると最後に往復できた時刻が進む() {
        // Arrange: 「いつまで確かだったか」を出すための値である（ADR 0030）
        let (pool, _, _) = 覗けるプールを組む(4);
        pool.last_round_trip.store(0, Ordering::SeqCst);

        // Act
        pool.list_sessions().unwrap();

        // Assert
        assert!(pool.health().last_round_trip_ms > 0);
    }

    #[test]
    fn 往復に失敗したときは最後に往復できた時刻を進めない() {
        // Arrange: 届かなかった往復を「確かめられた」と数えない（ADR 0030）
        let pool = 切れているプールを組む();
        pool.last_round_trip.store(0, Ordering::SeqCst);

        // Act
        pool.list_sessions().unwrap_err();

        // Assert
        assert_eq!(pool.health().last_round_trip_ms, 0);
    }

    #[test]
    fn 割り当ての無いタブを手放しても最後に往復できた時刻は進まない() {
        // Arrange: カーソルを持たないタブを閉じてもデータベースへは行かない。
        // 行かなかった操作で時刻を進めると、表示が実際より新しくなる（ADR 0030）
        let (pool, _, _) = 覗けるプールを組む(4);
        pool.last_round_trip.store(0, Ordering::SeqCst);

        // Act
        pool.release("結果を持たないタブ").unwrap();

        // Assert
        assert_eq!(pool.health().last_round_trip_ms, 0);
    }

    #[test]
    fn 接続の様子は切れていることと最後に往復できた時刻の両方を持つ() {
        // Arrange: ステータスバーはこの 2 つで「接続中」を出してよいかを決める
        let (pool, _, 切られている) = 覗けるプールを組む(4);
        pool.list_sessions().unwrap();
        切られている.store(true, Ordering::SeqCst);

        // Act
        let 様子 = pool.health();

        // Assert
        assert!(様子.disconnected);
        assert!(様子.last_round_trip_ms > 0);
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

    /// 開いているカーソルがどの文のものかを覚えているドライバ。
    ///
    /// 命令がアクタースレッドへ届く順を、実データベース抜きで見分けるために
    /// ある。取り出した行には、そのカーソルを開いた SQL をそのまま載せる。
    /// 別のタブの行を読んだり、別のタブのカーソルを閉じたりすれば、行の中身と
    /// 「カーソルが無い」のエラーで分かる。
    struct 札を付けるドライバ {
        /// 開いているカーソルを開いた SQL。閉じていれば `None`。
        ///
        /// 割り当ての表に載っていないカーソルが残っていないかを、テストの側から
        /// 覗けるように共有してある。
        開いている: Arc<Mutex<Option<String>>>,
    }

    /// 札を付けるドライバが、カーソルの無いところから取り出そうとしたときの文言。
    const カーソルが無い: &str = "カーソルが開いていない";

    /// 札に含めると、その実行は最初のかたまりで尽きる。
    ///
    /// 実行を待った後に割り当てを外す経路（`!保持し続ける`）を通すためにある。
    const 実行で尽きる: &str = "（実行で尽きる）";

    /// 札に含めると、そのカーソルの続きの取り出しは尽きる。
    ///
    /// 続きの取り出しを待った後に割り当てを外す経路を通すためにある。
    const 続きで尽きる: &str = "（続きで尽きる）";

    /// 札を載せた 1 行ぶんのかたまりを作る。
    ///
    /// # 引数
    ///
    /// * `札` - カーソルを開いた SQL
    /// * `exhausted` - カーソルが尽きたか
    fn 札の付いたかたまり(札: &str, exhausted: bool) -> Chunk {
        Chunk {
            rows: vec![vec![crate::db::value::Cell::new(CellKind::Text, 札)]],
            exhausted,
        }
    }

    impl Driver for 札を付けるドライバ {
        fn canceller(&self) -> Box<dyn Canceller> {
            Box::new(何もしない中止経路)
        }

        fn execute(
            &mut self,
            sql: &str,
            _binds: &[Bind],
            _chunk_size: usize,
        ) -> DbResult<ExecuteOutcome> {
            *self.開いている.lock().unwrap() = Some(sql.to_string());
            Ok(ExecuteOutcome::Query {
                columns: vec![Column {
                    name: String::from("札"),
                    type_name: String::from("VARCHAR2"),
                    kind: CellKind::Text,
                }],
                chunk: 札の付いたかたまり(sql, sql.contains(実行で尽きる)),
                elapsed_ms: 0,
                notices: Vec::new(),
                in_transaction: false,
            })
        }

        fn fetch_more(&mut self, _chunk_size: usize) -> DbResult<Chunk> {
            match self.開いている.lock().unwrap().as_deref() {
                Some(札) => Ok(札の付いたかたまり(札, 札.contains(続きで尽きる))),
                None => Err(DbError::new(DbErrorKind::Closed, カーソルが無い)),
            }
        }

        fn close_cursor(&mut self) -> DbResult<()> {
            *self.開いている.lock().unwrap() = None;
            Ok(())
        }

        fn schema_overview(&mut self, _filter: &SchemaFilter) -> DbResult<Vec<SchemaNode>> {
            unimplemented!("カーソルの順序のテストでは使わない")
        }

        fn schema_columns(&mut self, _owner: &str) -> DbResult<Vec<TableColumn>> {
            unimplemented!("カーソルの順序のテストでは使わない")
        }

        fn commit(&mut self) -> DbResult<()> {
            unimplemented!("カーソルの順序のテストでは使わない")
        }

        fn rollback(&mut self) -> DbResult<()> {
            unimplemented!("カーソルの順序のテストでは使わない")
        }

        fn explain_plan(&mut self, _sql: &str, _binds: &[Bind]) -> DbResult<String> {
            unimplemented!("カーソルの順序のテストでは使わない")
        }

        fn actual_plan(&mut self, _sql: &str, _binds: &[Bind]) -> DbResult<String> {
            unimplemented!("カーソルの順序のテストでは使わない")
        }

        fn object_definition(
            &mut self,
            _owner: &str,
            _name: &str,
            _kind: ObjectKind,
        ) -> DbResult<ObjectDefinition> {
            unimplemented!("カーソルの順序のテストでは使わない")
        }

        fn object_ddl(
            &mut self,
            _owner: &str,
            _name: &str,
            _kind: ObjectKind,
        ) -> DbResult<ObjectDdl> {
            unimplemented!("カーソルの順序のテストでは使わない")
        }

        fn list_sessions(&mut self) -> DbResult<SessionOverview> {
            unimplemented!("カーソルの順序のテストでは使わない")
        }

        fn kill_session(&mut self, _sid: u32, _serial: u32) -> DbResult<()> {
            unimplemented!("カーソルの順序のテストでは使わない")
        }

        fn search_source(
            &mut self,
            _request: &SourceSearchRequest,
        ) -> DbResult<SourceSearchResult> {
            unimplemented!("カーソルの順序のテストでは使わない")
        }

        fn source_context(
            &mut self,
            _target: &SourceTarget,
            _line: u32,
        ) -> DbResult<Vec<SourceLine>> {
            unimplemented!("カーソルの順序のテストでは使わない")
        }
    }

    /// 札を付けるドライバを 1 本だけ載せたプールと、そのカーソルの様子を返す。
    ///
    /// 1 本にするのは、別のタブが必ず同じ接続を引き継ぐようにするためである。
    fn 一本のプールを組む() -> (Arc<ConnectionPool>, Arc<Mutex<Option<String>>>) {
        let 開いている = Arc::new(Mutex::new(None));
        let 共有 = Arc::clone(&開いている);
        let drivers = vec![move || {
            Ok(札を付けるドライバ {
                開いている: 共有
            })
        }];
        let pool = Arc::new(pool_from_drivers(drivers, DEFAULT_CHUNK_SIZE).unwrap());
        (pool, 開いている)
    }

    /// 次にプールが割り当ての表を離した直後に、`割り込み` を走らせる。
    ///
    /// Tauri のコマンドは `run_blocking` で別々のスレッドに載るため、ある操作が
    /// 表を離してから返事を待つまでの間に、別の操作がまるごと走りうる。その順を
    /// 決まった形で再現する。
    ///
    /// # 引数
    ///
    /// * `pool` - 割り込ませる先のプール
    /// * `割り込み` - 割り込ませる操作
    fn 表を離した直後に割り込ませる(
        pool: &ConnectionPool,
        割り込み: impl FnOnce() + Send + 'static,
    ) {
        *pool.表を離した直後.lock().unwrap() = Some(Box::new(割り込み));
    }

    #[test]
    fn 閉じたタブの実行が手放しより後に届いても割り当ては残らない() {
        // Arrange: コマンドは run_blocking で走るため、閉じる前に送った実行が
        // 手放しより後に処理されることがある（ADR 0003）
        let (pool, 開いている) = 一本のプールを組む();
        pool.release("閉じたタブ").unwrap();

        // Act
        let 実行 = pool.execute("閉じたタブ", "A", &[]);

        // Assert: 閉じたタブに接続もカーソルも握らせない
        assert_eq!(実行.unwrap_err().kind, DbErrorKind::Closed);
        assert!(pool.leased("閉じたタブ").is_none());
        assert_eq!(*開いている.lock().unwrap(), None);
    }

    #[test]
    fn 閉じたタブの続きの取り出しは破棄されたものとして断る() {
        // Arrange: 手放しの後に届いた続きの取り出しも、閉じたタブのものである
        let (pool, _) = 一本のプールを組む();
        pool.execute("閉じたタブ", "A", &[]).unwrap();
        pool.release("閉じたタブ").unwrap();

        // Act
        let 続き = pool.fetch_more("閉じたタブ");

        // Assert
        assert_eq!(続き.unwrap_err().kind, DbErrorKind::Closed);
    }

    #[test]
    fn 実行の最中に手放されたタブのカーソルは開いたまま残らない() {
        // Arrange: 実行が表を離した直後に、同じタブの手放しが割り込む
        let (pool, 開いている) = 一本のプールを組む();
        let 手放す側 = Arc::clone(&pool);
        表を離した直後に割り込ませる(&pool, move || {
            手放す側.release("A").unwrap();
        });

        // Act
        pool.execute("A", "A", &[]).unwrap();

        // Assert: 割り当ての無いカーソルは、誰も閉じに来ない
        assert!(pool.leased("A").is_none());
        assert_eq!(*開いている.lock().unwrap(), None);
    }

    #[test]
    fn 手放しの直後に別のタブが同じ接続で実行しても別のタブのカーソルは閉じられない() {
        // Arrange: 1 本しかないので、B は A が手放した接続を引き継ぐ
        let (pool, _) = 一本のプールを組む();
        pool.execute("A", "A", &[]).unwrap();
        let 実行する側 = Arc::clone(&pool);
        表を離した直後に割り込ませる(&pool, move || {
            実行する側.execute("B", "B", &[]).unwrap();
        });

        // Act
        pool.release("A").unwrap();

        // Assert: B の割り当てがある以上、B のカーソルは開いたままである
        let 続き = pool.fetch_more("B").unwrap();
        assert_eq!(続き.rows[0][0].text, "B");
    }

    #[test]
    fn 続きの取り出しの直後に割り当てを剥がされても別のタブの行を取らない() {
        // Arrange: 1 本しかないので、B の実行は A の割り当てを剥がす
        let (pool, _) = 一本のプールを組む();
        pool.execute("A", "A", &[]).unwrap();
        let 実行する側 = Arc::clone(&pool);
        表を離した直後に割り込ませる(&pool, move || {
            実行する側.execute("B", "B", &[]).unwrap();
        });

        // Act
        let 続き = pool.fetch_more("A").unwrap();

        // Assert: A が受け取るのは A の行であり、B の行を 1 かたまり奪ってもいない
        assert_eq!(続き.rows[0][0].text, "A");
        assert_eq!(pool.fetch_more("B").unwrap().rows[0][0].text, "B");
    }

    #[test]
    fn 尽きた実行を待つ間に同じタブが受けた新しい割り当ては外されない() {
        // Arrange: 尽きた実行は待った後に割り当てを外す。その間に同じタブの
        // 次の実行が割り当てを受け、新しいカーソルを開く
        let (pool, 開いている) = 一本のプールを組む();
        let 実行する側 = Arc::clone(&pool);
        表を離した直後に割り込ませる(&pool, move || {
            実行する側.execute("A", "A2", &[]).unwrap();
        });

        // Act
        let 実行 = format!("A1{実行で尽きる}");
        pool.execute("A", &実行, &[]).unwrap();

        // Assert: 次の実行のカーソルには割り当てが残り、続きを取れる
        assert!(pool.leased("A").is_some());
        assert_eq!(開いている.lock().unwrap().as_deref(), Some("A2"));
        assert_eq!(pool.fetch_more("A").unwrap().rows[0][0].text, "A2");
    }

    #[test]
    fn 尽きた続きの取り出しを待つ間に同じタブが受けた新しい割り当ては外されない() {
        // Arrange: 続きが尽きると待った後に割り当てを外す。その間に同じタブの
        // 実行し直しが割り当てを受け、新しいカーソルを開く
        let (pool, 開いている) = 一本のプールを組む();
        let 最初 = format!("A1{続きで尽きる}");
        pool.execute("A", &最初, &[]).unwrap();
        let 実行する側 = Arc::clone(&pool);
        表を離した直後に割り込ませる(&pool, move || {
            実行する側.execute("A", "A2", &[]).unwrap();
        });

        // Act
        let 続き = pool.fetch_more("A").unwrap();

        // Assert
        assert!(続き.exhausted);
        assert!(pool.leased("A").is_some());
        assert_eq!(開いている.lock().unwrap().as_deref(), Some("A2"));
        assert_eq!(pool.fetch_more("A").unwrap().rows[0][0].text, "A2");
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
