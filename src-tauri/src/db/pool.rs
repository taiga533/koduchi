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
    /// この割り当てで積んだ実行か続きの取り出しが、まだ返っていないか。
    ///
    /// 手放すときに中止を送るかを決めるのに使う（ADR 0003 への 2026-09-27 の
    /// 追記「閉じるときは手放す前に中止する」）。走っていない接続へ中止を送ると、
    /// 次に積まれた命令のほうが打ち切られうる。
    in_flight: bool,
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

    /// 控えた通し番号の割り当てに、積んだ命令が返っていないかを書く。
    ///
    /// 番号で引くのは `remove_serial` と同じ理由である。待っている間に同じタブが
    /// 受けた新しい割り当ての印を、古い命令の返事で降ろさない。
    ///
    /// # 引数
    ///
    /// * `serial` - 積むときに控えた通し番号
    /// * `in_flight` - まだ返っていないか
    fn set_in_flight(&mut self, serial: u64, in_flight: bool) {
        if let Some(lease) = self.leases.iter_mut().find(|lease| lease.serial == serial) {
            lease.in_flight = in_flight;
        }
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

/// 中止で打ち切られたことを表すエラーか。
///
/// ドライバが `Cancelled` を返す場合と、Oracle の `ORA-01013` がそのまま届く場合の
/// 両方を見る。どちらも「命令そのものは正しいが、中止に当たった」ことを表し、
/// 積み直せば通る。
///
/// # 引数
///
/// * `error` - 命令の失敗
fn is_cancelled_by_break(error: &DbError) -> bool {
    error.kind == DbErrorKind::Cancelled || error.message.contains("ORA-01013")
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
        // 手放したタブの割り当ては片付けの間だけ残っている（`release` を参照）。
        // 中止は `release` が自分で送るため、ここからは送らせない。
        if table.released.contains(tab_id) {
            return None;
        }
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
                in_flight: false,
            });
            return Ok((Arc::clone(&self.handles[slot]), serial, None));
        }

        // 空きが無ければ、最も長く使われていない割り当てを剥がす。手放したタブの
        // 片付け中の割り当て（`release` を参照）は後回しにする。そちらの接続には
        // 閉じたタブの文へ宛てた中止がまだ届いていないことがあり、引き継ぐと
        // こちらの文が打ち切られうる。全部が片付け中のときだけ、いちばん古い
        // ものを引き継ぐ（片付けのカーソルを閉じる命令は先に積まれている）。
        let index = table
            .leases
            .iter()
            .position(|lease| !table.released.contains(&lease.tab_id));
        let 片付け中を引き継ぐ = index.is_none();
        let 剥がす = table.leases.remove(index.unwrap_or(0));
        let handle = Arc::clone(&self.handles[剥がす.slot]);
        table.leases.push(Lease {
            tab_id: tab_id.to_string(),
            slot: 剥がす.slot,
            serial,
            in_flight: false,
        });

        // 片付け中のタブは閉じられており、「結果は破棄されました」を出す先が無い。
        let discarded_tab = (!片付け中を引き継ぐ).then_some(剥がす.tab_id);
        Ok((handle, serial, discarded_tab))
    }

    /// タブの割り当てを外す。
    ///
    /// タブを閉じたときに呼ぶ。カーソルも一緒に閉じる。以後このタブの実行には
    /// 接続を割り当てない（割り当てが無かったときも覚える。実行より先に手放しが
    /// 届いた場合こそ、覚えておかないと閉じたタブに接続を握らせる）。
    ///
    /// **そのタブの文が走っていれば、手放すより先に中止を送る**（ADR 0003 への
    /// 2026-09-27 の追記）。手放すだけでは閉じたタブの文がデータベースの上で
    /// 最後まで走り、接続を握り続ける。中止を別のコマンドで送ると、Tauri の
    /// コマンドは別々のスレッドで走るため手放しに追い越されることがあり、割り当てが
    /// 外れた後の中止は届かない。そこで走っているかを割り当てを外すのと同じ臨界区間で
    /// 読み、中止はここから送る。
    ///
    /// 割り当ては**カーソルを閉じ終えるまで表に残す**。表から消すと、中止が届く前に
    /// 閉じたタブの文が終わり、カーソルを閉じ、同じ接続を引き継いだ別のタブの文が
    /// 走り始めてから中止が届く、という順が残る。残しておけば別のタブはその接続を
    /// 取らない（`acquire` を参照）ため、中止が当たりうるのは閉じたタブの文と、
    /// その後に積まれたカーソルを閉じる命令だけである。中止は表を離してから送る。
    /// 表を握ったまま送ると、切れた回線で中止が返らないときにプールの全操作が止まる。
    ///
    /// # 引数
    ///
    /// * `tab_id` - 対象のタブ
    pub fn release(&self, tab_id: &str) -> DbResult<()> {
        let (pending, serial, 中止先) = {
            let mut table = self.leases.lock().expect("割り当て表のロックが壊れている");
            table.released.insert(tab_id.to_string());
            let Some(lease) = table.leases.iter().find(|lease| lease.tab_id == tab_id) else {
                return Ok(());
            };
            let (slot, serial, in_flight) = (lease.slot, lease.serial, lease.in_flight);
            let handle = Arc::clone(&self.handles[slot]);
            // 表を握ったまま積む。離してから積むと、この接続を引き継いだ別のタブの
            // 実行が先に積まれ、そのタブのカーソルを閉じてしまう。
            //
            // 積めなかったときは割り当てをその場で外す。タブは閉じられており、残すと
            // 終わったアクタースレッドの接続を閉じたタブが握り続ける。
            let pending = match handle.send_close_cursor() {
                Ok(pending) => pending,
                Err(error) => {
                    table.remove_serial(serial);
                    return Err(error);
                }
            };
            (pending, serial, in_flight.then_some(handle))
        };
        self.表を離した();

        // 中止もカーソルを閉じるのもデータベースへの往復であり、`見張る` を通す
        // （ADR 0026・0030）。中止に失敗してもカーソルは閉じに行き、割り当ても外す。
        let 中止を送った = 中止先.is_some();
        let 中止 = match 中止先 {
            Some(handle) => self.見張る(|| handle.cancel()),
            None => Ok(()),
        };
        let mut 閉じた = self.見張る(|| pending.wait());

        // 走っている印は、実行の返事を受けてから表を取り直して降ろすまでの間も
        // 立っている。その間に手放すと、文はもう終わっているのに中止を送り、
        // 中止はここで積んだカーソルを閉じる命令のほうに当たる。閉じ損ねたまま
        // 割り当てを外すと、カーソルが誰にも閉じられずに残るため、1 度だけ積み直す。
        if 中止を送った && 閉じた.as_ref().is_err_and(is_cancelled_by_break) {
            閉じた = self.close_cursor_again(serial);
        }

        let mut table = self.leases.lock().expect("割り当て表のロックが壊れている");
        table.remove_serial(serial);
        中止.and(閉じた)
    }

    /// 手放しの片付け中の割り当てへ、カーソルを閉じる命令を積み直して待つ。
    ///
    /// 積むのは表を握ったまま行う（`leases` の説明を参照）。割り当てが既に
    /// 無ければ（全接続が片付け中で別のタブに引き継がれた、など）何もしない。
    /// 引き継いだタブの実行は新しいカーソルを開く前に前のものを閉じるためである。
    ///
    /// # 引数
    ///
    /// * `serial` - 片付け中の割り当ての通し番号
    fn close_cursor_again(&self, serial: u64) -> DbResult<()> {
        let pending = {
            let table = self.leases.lock().expect("割り当て表のロックが壊れている");
            let Some(lease) = table.leases.iter().find(|lease| lease.serial == serial) else {
                return Ok(());
            };
            self.handles[lease.slot].send_close_cursor()?
        };
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
            // 積めなかったときに戻すための控え。割り当ての数は接続の本数（既定 4）
            // までなので、写しても安い。
            let 積む前 = table.leases.clone();
            let (handle, serial, discarded_tab) = self.acquire(&mut table, tab_id)?;
            // 剥がしたタブのカーソルは、同じ接続を使い回す前に閉じておく必要がある。
            // 実行そのものが前のカーソルを閉じるため、ここでは表からの削除だけでよい。
            // 積むのは表を握ったまま行う（`leases` の説明を参照）。
            match handle.send_execute(sql, binds, self.chunk_size) {
                Ok(pending) => {
                    table.set_in_flight(serial, true);
                    (pending, serial, discarded_tab)
                }
                Err(error) => {
                    // 積めないのはアクタースレッドが終わっているときである。命令は
                    // どの接続にも届いていないため、剥がしたタブのカーソルも手付かずで
                    // ある。割り当てだけが書き換わったまま残ると、剥がしたタブは
                    // 「破棄された」と読み、このタブには届いていない実行の割り当てが残る。
                    table.leases = 積む前;
                    return Err(error);
                }
            }
        };
        self.表を離した();

        let result = self.見張る(|| pending.wait());

        let mut table = self.leases.lock().expect("割り当て表のロックが壊れている");
        // 返事が来た以上、この割り当てで走っている文はもう無い。失敗でも降ろす。
        table.set_in_flight(serial, false);
        let outcome = result?;

        let 保持し続ける = matches!(
            &outcome,
            ExecuteOutcome::Query { chunk, .. } if !chunk.exhausted
        );

        if !保持し続ける {
            table.remove_serial(serial);
        }
        drop(table);

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
            // 手放したタブの割り当ては片付けの間だけ残っている（`release`）。
            // 閉じたタブのカーソルから読ませない。
            if table.released.contains(tab_id) {
                return Err(DbError::new(
                    DbErrorKind::Closed,
                    "結果は破棄されました。再実行してください",
                ));
            }
            let (handle, serial) = self.touch(&mut table, tab_id).ok_or_else(|| {
                DbError::new(
                    DbErrorKind::Closed,
                    "結果は破棄されました。再実行してください",
                )
            })?;
            // 表を握ったまま積む。離してから積むと、この割り当てを剥がした別のタブの
            // 実行が先に積まれ、そのタブの行を読んでしまう。
            //
            // 積めなかったときも表は戻さない。`touch` が動かすのは使った順だけで
            // あり、割り当ての有無は変わっていない。
            let pending = handle.send_fetch_more(self.chunk_size)?;
            table.set_in_flight(serial, true);
            (pending, serial)
        };
        self.表を離した();

        let result = self.見張る(|| pending.wait());

        let mut table = self.leases.lock().expect("割り当て表のロックが壊れている");
        table.set_in_flight(serial, false);
        let chunk = result?;

        // 尽きたら接続を明け渡す。
        if chunk.exhausted {
            table.remove_serial(serial);
        }
        drop(table);

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
    use std::time::Duration;

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

    /// この札で実行すると、アクタースレッドが落ちる。
    ///
    /// 以後その接続へ命令を積めなくなる。`send_*` が失敗する経路を、実データベース
    /// 抜きで通すためにある。
    const アクターを落とす: &str = "（アクターを落とす）";

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
            assert_ne!(sql, アクターを落とす, "アクタースレッドを落とす");
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
    fn 実行を積めなかったときは割り当ての表を書き換えない() {
        // Arrange: A の実行でアクタースレッドが落ち、A の割り当てだけが残る。
        // 1 本しかないので、B の実行は A の割り当てを剥がそうとする
        let (pool, _) = 一本のプールを組む();
        assert_eq!(
            pool.execute("A", アクターを落とす, &[]).unwrap_err().kind,
            DbErrorKind::Closed
        );

        // Act
        let 実行 = pool.execute("B", "B", &[]);

        // Assert: B には届いていない実行の割り当てを残さず、A からも剥がさない
        assert_eq!(実行.unwrap_err().kind, DbErrorKind::Closed);
        assert!(pool.leased("B").is_none());
        assert!(pool.leased("A").is_some());
    }

    /// 中止されるまで走り続ける文を持つドライバ（ADR 0003 への 2026-09-27 の追記）。
    ///
    /// 閉じたタブの文へ中止が届くか、別のタブの文へ誤って届かないかを、
    /// 実データベース抜きで確かめるためにある。`止まる` で実行すると中止されるまで
    /// 返らず、中止されたら `Cancelled` を返す。それ以外の SQL はすぐに返る。
    struct 止めるドライバ {
        /// プールの中での位置。どの接続で走ったかを見分ける。
        番号: usize,
        /// 中止の印と、それを待つための条件変数。接続ごとに持つ。
        中止: Arc<(Mutex<bool>, std::sync::Condvar)>,
        /// 送られた中止を接続の番号ごとに数える。
        中止した回数: Arc<Mutex<Vec<usize>>>,
        /// 走った文を（接続の番号, SQL）で記録する。
        走った: Arc<Mutex<Vec<(usize, String)>>>,
        /// 中止を送ると失敗するか。
        中止に失敗する: bool,
        /// 最初のカーソルを閉じる命令で、中止が届くのを待つか。
        ///
        /// 文が終わった後に届いた中止が、次に積まれたカーソルを閉じる命令に当たる
        /// 順を、決まった形で再現するためにある。
        閉じるときに中止を待つ: bool,
        /// 閉じる命令で中止を待ち終えたか。待つのは最初の 1 度だけである。
        閉じるときに待った: bool,
        /// カーソルが開いているか。閉じ損ねを見分けるために共有する。
        開いている: Arc<AtomicBool>,
    }

    /// 中止されるまで返らない文。
    const 止まる: &str = "止まる";

    /// 止めるドライバの中止経路。
    struct 印を立てる中止経路 {
        番号: usize,
        失敗する: bool,
        中止: Arc<(Mutex<bool>, std::sync::Condvar)>,
        中止した回数: Arc<Mutex<Vec<usize>>>,
    }

    impl Canceller for 印を立てる中止経路 {
        fn cancel(&self) -> DbResult<()> {
            self.中止した回数.lock().unwrap().push(self.番号);
            if self.失敗する {
                return Err(DbError::new(DbErrorKind::Execute, "中止に失敗した"));
            }
            let (印, 知らせ) = &*self.中止;
            *印.lock().unwrap() = true;
            知らせ.notify_all();
            Ok(())
        }
    }

    impl Driver for 止めるドライバ {
        fn canceller(&self) -> Box<dyn Canceller> {
            Box::new(印を立てる中止経路 {
                番号: self.番号,
                失敗する: self.中止に失敗する,
                中止: Arc::clone(&self.中止),
                中止した回数: Arc::clone(&self.中止した回数),
            })
        }

        fn execute(
            &mut self,
            sql: &str,
            _binds: &[Bind],
            _chunk_size: usize,
        ) -> DbResult<ExecuteOutcome> {
            self.走った
                .lock()
                .unwrap()
                .push((self.番号, sql.to_string()));
            if sql == 止まる {
                // 中止が届かないまま待ち続けると、壊れたときにテストが止まる。
                // 待つのは 5 秒までにし、届かなければ別の種類のエラーで返す。
                let (印, 知らせ) = &*self.中止;
                let (mut 中止された, _) = 知らせ
                    .wait_timeout_while(印.lock().unwrap(), Duration::from_secs(5), |届いた| {
                        !*届いた
                    })
                    .unwrap();
                if !*中止された {
                    return Err(DbError::new(DbErrorKind::Execute, "中止が届かなかった"));
                }
                *中止された = false;
                return Err(DbError::new(DbErrorKind::Cancelled, "ORA-01013"));
            }
            self.開いている.store(true, Ordering::SeqCst);
            Ok(ExecuteOutcome::Query {
                columns: Vec::new(),
                chunk: Chunk {
                    rows: Vec::new(),
                    exhausted: false,
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
            if self.閉じるときに中止を待つ && !self.閉じるときに待った {
                self.閉じるときに待った = true;
                let (印, 知らせ) = &*self.中止;
                let (mut 中止された, _) = 知らせ
                    .wait_timeout_while(印.lock().unwrap(), Duration::from_secs(5), |届いた| {
                        !*届いた
                    })
                    .unwrap();
                if *中止された {
                    // 走っている文の無いところへ届いた中止は、次の命令を打ち切る。
                    *中止された = false;
                    return Err(DbError::new(
                        DbErrorKind::Execute,
                        "ORA-01013: ユーザーによって現行の操作の取消しがリクエストされました",
                    ));
                }
            }
            self.開いている.store(false, Ordering::SeqCst);
            Ok(())
        }

        fn schema_overview(&mut self, _filter: &SchemaFilter) -> DbResult<Vec<SchemaNode>> {
            unimplemented!("中止のテストでは使わない")
        }

        fn schema_columns(&mut self, _owner: &str) -> DbResult<Vec<TableColumn>> {
            unimplemented!("中止のテストでは使わない")
        }

        fn commit(&mut self) -> DbResult<()> {
            unimplemented!("中止のテストでは使わない")
        }

        fn rollback(&mut self) -> DbResult<()> {
            unimplemented!("中止のテストでは使わない")
        }

        fn explain_plan(&mut self, _sql: &str, _binds: &[Bind]) -> DbResult<String> {
            unimplemented!("中止のテストでは使わない")
        }

        fn actual_plan(&mut self, _sql: &str, _binds: &[Bind]) -> DbResult<String> {
            unimplemented!("中止のテストでは使わない")
        }

        fn object_definition(
            &mut self,
            _owner: &str,
            _name: &str,
            _kind: ObjectKind,
        ) -> DbResult<ObjectDefinition> {
            unimplemented!("中止のテストでは使わない")
        }

        fn object_ddl(
            &mut self,
            _owner: &str,
            _name: &str,
            _kind: ObjectKind,
        ) -> DbResult<ObjectDdl> {
            unimplemented!("中止のテストでは使わない")
        }

        fn list_sessions(&mut self) -> DbResult<SessionOverview> {
            unimplemented!("中止のテストでは使わない")
        }

        fn kill_session(&mut self, _sid: u32, _serial: u32) -> DbResult<()> {
            unimplemented!("中止のテストでは使わない")
        }

        fn search_source(
            &mut self,
            _request: &SourceSearchRequest,
        ) -> DbResult<SourceSearchResult> {
            unimplemented!("中止のテストでは使わない")
        }

        fn source_context(
            &mut self,
            _target: &SourceTarget,
            _line: u32,
        ) -> DbResult<Vec<SourceLine>> {
            unimplemented!("中止のテストでは使わない")
        }
    }

    /// 止めるドライバのプールが記録するもの。
    struct 止めるプールの記録 {
        中止した回数: Arc<Mutex<Vec<usize>>>,
        走った: Arc<Mutex<Vec<(usize, String)>>>,
        /// 接続の番号ごとの、カーソルが開いているか。
        開いている: Vec<Arc<AtomicBool>>,
    }

    /// 止めるドライバの振る舞いの選び方。
    #[derive(Clone, Copy, Default)]
    struct 止め方 {
        /// 中止を送ると失敗させる。
        中止に失敗する: bool,
        /// 最初のカーソルを閉じる命令で中止が届くのを待たせる。
        閉じるときに中止を待つ: bool,
    }

    /// 止めるドライバを `本数` ぶん載せたプールを組む。
    ///
    /// # 引数
    ///
    /// * `本数` - プールに載せる接続の本数
    /// * `止め方` - ドライバの振る舞い
    fn 止めるプールを組む(
        本数: usize,
        止め方: 止め方,
    ) -> (Arc<ConnectionPool>, 止めるプールの記録) {
        let 中止した回数 = Arc::new(Mutex::new(Vec::new()));
        let 走った = Arc::new(Mutex::new(Vec::new()));
        let 開いている: Vec<_> = (0..本数)
            .map(|_| Arc::new(AtomicBool::new(false)))
            .collect();
        let drivers: Vec<_> = (0..本数)
            .map(|番号| {
                let 中止した回数 = Arc::clone(&中止した回数);
                let 走った = Arc::clone(&走った);
                let 開いている = Arc::clone(&開いている[番号]);
                move || {
                    Ok(止めるドライバ {
                        番号,
                        中止: Arc::new((Mutex::new(false), std::sync::Condvar::new())),
                        中止した回数,
                        走った,
                        中止に失敗する: 止め方.中止に失敗する,
                        閉じるときに中止を待つ: 止め方.閉じるときに中止を待つ,
                        閉じるときに待った: false,
                        開いている,
                    })
                }
            })
            .collect();
        let pool = Arc::new(pool_from_drivers(drivers, DEFAULT_CHUNK_SIZE).unwrap());
        (
            pool,
            止めるプールの記録 {
                中止した回数,
                走った,
                開いている,
            },
        )
    }

    #[test]
    fn 走っている文のタブを手放すとその接続へ中止を送る() {
        // Arrange: 実行が表を離した直後（文が走っている間）に、同じタブの
        // 手放しが割り込む。中止を別のコマンドにすると手放しに追い越されうるため、
        // 手放しそのものが中止を送る（ADR 0003）
        let (pool, 記録) = 止めるプールを組む(1, 止め方::default());
        let 手放す側 = Arc::clone(&pool);
        表を離した直後に割り込ませる(&pool, move || {
            手放す側.release("A").unwrap();
        });

        // Act
        let 実行 = pool.execute("A", 止まる, &[]);

        // Assert: 閉じたタブの文は中止され、割り当ても残らない
        assert_eq!(実行.unwrap_err().kind, DbErrorKind::Cancelled);
        assert_eq!(*記録.中止した回数.lock().unwrap(), vec![0]);
        assert!(pool.leases.lock().unwrap().leases.is_empty());
    }

    #[test]
    fn 走っていないタブを手放しても中止は送らない() {
        // Arrange: 走っていない接続へ中止を送ると、次に積まれた命令が打ち切られうる
        let (pool, 記録) = 止めるプールを組む(1, 止め方::default());
        pool.execute("A", "select 1 from dual", &[]).unwrap();

        // Act
        pool.release("A").unwrap();

        // Assert
        assert!(記録.中止した回数.lock().unwrap().is_empty());
    }

    #[test]
    fn 手放しの片付けが済むまで別のタブはその接続を取らない() {
        // Arrange: A の文が走っている間に A を手放す。手放しが表を離した直後に
        // B が実行する。A の接続を B が取ると、A へ宛てた中止が B の文に当たりうる
        let (pool, 記録) = 止めるプールを組む(2, 止め方::default());
        let 手放す側 = Arc::clone(&pool);
        let 実行する側 = Arc::clone(&pool);
        表を離した直後に割り込ませる(&pool, move || {
            let 差し込み先 = Arc::clone(&手放す側);
            表を離した直後に割り込ませる(&差し込み先, move || {
                実行する側.execute("B", "B", &[]).unwrap();
            });
            手放す側.release("A").unwrap();
        });

        // Act
        pool.execute("A", 止まる, &[]).unwrap_err();

        // Assert: B は空いている 2 本目で走り、中止は A の接続にだけ届いた
        let 走った = 記録.走った.lock().unwrap().clone();
        assert!(走った.contains(&(1, String::from("B"))));
        assert_eq!(*記録.中止した回数.lock().unwrap(), vec![0]);
    }

    #[test]
    fn 中止に失敗しても手放しはカーソルを閉じて割り当てを外す() {
        // Arrange: 中止が失敗したからといって、閉じたタブに接続を握らせない
        let (pool, 記録) = 止めるプールを組む(
            1,
            止め方 {
                中止に失敗する: true,
                ..止め方::default()
            },
        );
        let 手放す側 = Arc::clone(&pool);
        let 手放した結果 = Arc::new(Mutex::new(None));
        let 控え = Arc::clone(&手放した結果);
        表を離した直後に割り込ませる(&pool, move || {
            *控え.lock().unwrap() = Some(手放す側.release("A"));
        });

        // Act
        pool.execute("A", "select 1 from dual", &[]).unwrap();

        // Assert: 失敗は伝えるが、割り当ては残らない
        let 手放した結果 = 手放した結果.lock().unwrap().take().unwrap();
        assert_eq!(手放した結果.unwrap_err().message, "中止に失敗した");
        assert_eq!(*記録.中止した回数.lock().unwrap(), vec![0]);
        assert!(pool.leases.lock().unwrap().leases.is_empty());
    }

    #[test]
    fn 文が終わった直後に手放して中止が閉じる命令に当たってもカーソルは閉じる() {
        // Arrange: 実行の返事を受けてから走っている印を降ろすまでの間に手放すと、
        // 中止を送る。文はもう終わっているため、中止は手放しが積んだカーソルを
        // 閉じる命令に当たりうる（ADR 0003）
        let (pool, 記録) = 止めるプールを組む(
            1,
            止め方 {
                閉じるときに中止を待つ: true,
                ..止め方::default()
            },
        );
        let 手放す側 = Arc::clone(&pool);
        let 走った = Arc::clone(&記録.走った);
        let 手放した結果 = Arc::new(Mutex::new(None));
        let 控え = Arc::clone(&手放した結果);
        表を離した直後に割り込ませる(&pool, move || {
            // 文が走り終えるのを待ってから手放す。
            for _ in 0..1000 {
                if !走った.lock().unwrap().is_empty() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(1));
            }
            *控え.lock().unwrap() = Some(手放す側.release("A"));
        });

        // Act
        pool.execute("A", "A", &[]).unwrap();

        // Assert: 閉じ損ねたカーソルを残さない
        let 手放した結果 = 手放した結果.lock().unwrap().take().unwrap();
        assert!(手放した結果.is_ok(), "{手放した結果:?}");
        assert_eq!(*記録.中止した回数.lock().unwrap(), vec![0]);
        assert!(!記録.開いている[0].load(Ordering::SeqCst));
        assert!(pool.leases.lock().unwrap().leases.is_empty());
    }

    #[test]
    fn 剥がす先を選ぶときは片付け中の割り当てを後回しにする() {
        // Arrange: A が最も古いが、手放しの片付け中である。片付け中の接続には
        // A へ宛てた中止がまだ届いていないことがあり、引き継ぐと C の文が打ち切られうる
        let (pool, _) = 止めるプールを組む(2, 止め方::default());
        pool.execute("A", "A", &[]).unwrap();
        pool.execute("B", "B", &[]).unwrap();
        let 実行する側 = Arc::clone(&pool);
        let 剥がされた = Arc::new(Mutex::new(None));
        let 控え = Arc::clone(&剥がされた);
        表を離した直後に割り込ませる(&pool, move || {
            let 応答 = 実行する側.execute("C", "C", &[]).unwrap();
            *控え.lock().unwrap() = Some(応答.discarded_tab);
        });

        // Act
        pool.release("A").unwrap();

        // Assert: 片付け中でない B を剥がした
        assert_eq!(
            剥がされた.lock().unwrap().take().unwrap(),
            Some(String::from("B"))
        );
    }

    #[test]
    fn 全接続が片付け中なら最も古いものを引き継ぎ剥がしたタブは返さない() {
        // Arrange: 片付け中のタブは閉じられており、「結果は破棄されました」を
        // 出す先が無い
        let (pool, _) = 止めるプールを組む(1, 止め方::default());
        pool.execute("A", "A", &[]).unwrap();
        let 実行する側 = Arc::clone(&pool);
        let 剥がされた = Arc::new(Mutex::new(None));
        let 控え = Arc::clone(&剥がされた);
        表を離した直後に割り込ませる(&pool, move || {
            let 応答 = 実行する側.execute("B", "B", &[]).unwrap();
            *控え.lock().unwrap() = Some(応答.discarded_tab);
        });

        // Act
        pool.release("A").unwrap();

        // Assert: B が引き継ぎ、A の片付けは B の割り当てを外さない
        assert_eq!(剥がされた.lock().unwrap().take().unwrap(), None);
        assert!(pool.leased("B").is_some());
    }

    #[test]
    fn 片付け中のタブの続きの取り出しは断る() {
        // Arrange: 割り当ては片付けが済むまで表に残っているが、閉じたタブの
        // カーソルから読ませない
        let (pool, _) = 止めるプールを組む(1, 止め方::default());
        pool.execute("A", "A", &[]).unwrap();
        let 取り出す側 = Arc::clone(&pool);
        let 続き = Arc::new(Mutex::new(None));
        let 控え = Arc::clone(&続き);
        表を離した直後に割り込ませる(&pool, move || {
            *控え.lock().unwrap() = Some(取り出す側.fetch_more("A"));
        });

        // Act
        pool.release("A").unwrap();

        // Assert
        let 続き = 続き.lock().unwrap().take().unwrap();
        assert_eq!(続き.unwrap_err().kind, DbErrorKind::Closed);
    }

    #[test]
    fn 中止に当たった失敗だけを積み直しの対象にする() {
        // Arrange: ドライバの Cancelled と、Oracle の番号がそのまま届く場合の両方
        let 中止 = DbError::cancelled();
        let 番号 = DbError::new(
            DbErrorKind::Execute,
            "ORA-01013: 取消しがリクエストされました",
        );
        let 別の失敗 = DbError::new(DbErrorKind::Execute, "ORA-00942: 表が存在しません");

        // Act & Assert
        assert!(is_cancelled_by_break(&中止));
        assert!(is_cancelled_by_break(&番号));
        assert!(!is_cancelled_by_break(&別の失敗));
    }

    #[test]
    fn 手放したタブへの中止はプールの側からは送らない() {
        // Arrange: 手放しの片付け中に遅れて届いた `⌘.` が、片付けの後に同じ接続を
        // 引き継いだ別のタブへ当たらないようにする
        let (pool, 記録) = 止めるプールを組む(1, 止め方::default());
        pool.execute("A", "select 1 from dual", &[]).unwrap();
        pool.release("A").unwrap();

        // Act
        pool.cancel("A").unwrap();

        // Assert
        assert!(記録.中止した回数.lock().unwrap().is_empty());
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
