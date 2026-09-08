//! セッションとロックの確認（ADR 0017）。
//!
//! `V$SESSION` から読んだ一覧の型と、そこからブロッキングの連鎖を組み立てる
//! 純粋な関数を置く。データベースへの問い合わせそのものは
//! `crate::db::oracle::sessions` にあり、このモジュールは Oracle に依存しない。
//!
//! 連鎖の組み立てをここへ切り出したのは、循環・一覧に居ない待たせ手・別
//! インスタンスの待たせ手という 3 つの境界がすべてデータの形の問題であり、
//! データベース抜きで全パターンを試せるようにするためである。

use crate::db::error::{DbError, DbResult};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet};

/// `V$SESSION` の 1 行（ADR 0017）。
///
/// 出すのは `TYPE = 'USER'` のセッションだけである。バックグラウンドプロセスは
/// 調べものの対象にならない。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRow {
    /// `SID`。kill の対象を指すのに使う。
    pub sid: u32,
    /// `SERIAL#`。`SID` は使い回されるため、kill には両方が要る。
    pub serial: u32,
    pub username: Option<String>,
    /// `ACTIVE` / `INACTIVE` / `KILLED` など。
    pub status: String,
    pub osuser: Option<String>,
    pub machine: Option<String>,
    /// クライアント側のプロセス ID。
    ///
    /// 小槌自身の接続を見分けるのに使う。プール（ADR 0003）の 4 本も、別の
    /// ウィンドウの接続（ADR 0009）も、同じアプリのプロセスから張られるため
    /// `PROCESS` と `MACHINE` が揃う。
    pub process: Option<String>,
    pub program: Option<String>,
    pub module: Option<String>,
    /// 待機イベント。`enq: TX - row lock contention` などが入る。
    pub event: Option<String>,
    /// 今の待機に入ってからの秒数。
    pub seconds_in_wait: i64,
    pub sql_id: Option<String>,
    /// ログオン時刻（`YYYY-MM-DD HH24:MI:SS`）。
    pub logon_time: Option<String>,
    /// 待たせている側のセッション。待っていなければ `None`。
    ///
    /// `BLOCKING_SESSION_STATUS` が `VALID` のときだけ値が入る。
    pub blocking_session: Option<u32>,
    /// 待たせている側のインスタンス番号。
    pub blocking_instance: Option<u32>,
    /// 小槌自身が張っている接続か（ADR 0017）。
    ///
    /// 真の行は kill の対象にしない。自分自身だけでなく、同じプールの残りの
    /// 接続も、別のウィンドウの接続も含む。どれを落としても、以後の実行が
    /// `ORA-00028` で意味不明に失敗する。
    pub own: bool,
}

impl SessionRow {
    /// 待たせている側が今見ているインスタンスの外に居るか（ADR 0017）。
    ///
    /// `V$SESSION` は現インスタンスしか写さないため、この場合その相手は一覧に
    /// 並ばない。連鎖も繋がず、行にその旨を添えるだけにする。
    ///
    /// # 引数
    ///
    /// * `instance` - 今繋がっているインスタンスの番号
    pub fn blocked_from_other_instance(&self, instance: u32) -> bool {
        match (self.blocking_session, self.blocking_instance) {
            (Some(_), Some(blocking_instance)) => blocking_instance != instance,
            _ => false,
        }
    }
}

/// ブロッキングの連鎖 1 節点。
///
/// `sid` が待たせている相手を `blocked` に持つ。根は「誰かを待たせていて、
/// かつ自分は（この一覧の中の誰も）待っていない」セッションである。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockingNode {
    pub sid: u32,
    /// この節点が待たせているセッション。
    pub blocked: Vec<BlockingNode>,
}

/// セッション一覧 1 回ぶんの取得結果（ADR 0017）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionOverview {
    /// 今繋がっているインスタンスの番号。
    pub instance: u32,
    /// この問い合わせを投げた接続自身の `SID`。
    ///
    /// 自分自身を kill させないための材料であり、一覧の中で「この接続」と
    /// 印を付けるのにも使う。`SYS_CONTEXT('USERENV','SID')` から読むため、
    /// `V$SESSION` の権限が無くても分かる。
    pub current_sid: u32,
    pub sessions: Vec<SessionRow>,
    /// ブロッキングの連鎖。誰も待たせていなければ空になる。
    pub chains: Vec<BlockingNode>,
}

impl SessionOverview {
    /// 一覧から連鎖を組み立てて結果をまとめる。
    ///
    /// # 引数
    ///
    /// * `instance` - 今繋がっているインスタンスの番号
    /// * `current_sid` - この問い合わせを投げた接続自身の `SID`
    /// * `sessions` - `V$SESSION` から読んだ行
    pub fn new(instance: u32, current_sid: u32, sessions: Vec<SessionRow>) -> Self {
        let mut sessions = sessions;
        mark_own_sessions(current_sid, &mut sessions);
        let chains = build_blocking_chains(&sessions, instance);
        SessionOverview {
            instance,
            current_sid,
            sessions,
            chains,
        }
    }

    /// `SID` から行を引く。
    ///
    /// # 引数
    ///
    /// * `sid` - 探すセッション
    pub fn find(&self, sid: u32) -> Option<&SessionRow> {
        self.sessions.iter().find(|session| session.sid == sid)
    }
}

/// 小槌自身が張っている接続に印を付ける（ADR 0017）。
///
/// 印の付いた行は kill の対象から外れる。見分けるのはクライアントの
/// `PROCESS` と `MACHINE` であり、接続プールの 4 本（ADR 0003）も、別の
/// ウィンドウが持つ接続（ADR 0009）も、同じアプリのプロセスから張られるため
/// まとめて拾える。**自分自身だけを弾いても足りない。** 兄弟の接続を落とせば、
/// そのタブで次に実行したときに `ORA-00028` で失敗する。
///
/// `PROCESS` が読めなかったときは `SID` の一致だけで判定する。取りこぼしは
/// 出るが、少なくとも自分自身は必ず守れる。
///
/// # 引数
///
/// * `current_sid` - この問い合わせを投げた接続自身の `SID`
/// * `sessions` - 印を付ける対象
fn mark_own_sessions(current_sid: u32, sessions: &mut [SessionRow]) {
    let 自分 = sessions
        .iter()
        .find(|session| session.sid == current_sid)
        .map(|session| (session.process.clone(), session.machine.clone()));

    let 同じプロセス = match 自分 {
        Some((Some(process), machine)) => Some((process, machine)),
        _ => None,
    };

    for session in sessions.iter_mut() {
        session.own = session.sid == current_sid
            || match &同じプロセス {
                Some((process, machine)) => {
                    session.process.as_ref() == Some(process) && &session.machine == machine
                }
                None => false,
            };
    }
}

/// ブロッキングの連鎖を組み立てる（ADR 0017）。
///
/// 待たせている側を根とする木を返す。誰も待たせていなければ空の一覧になる。
/// 次の 3 つを取りこぼさない。
///
/// - **循環**: 1 度訪れた `SID` は再訪しない。どこにも属さない循環が残ったら、
///   `SID` の小さいほうを根として立てる。
/// - **一覧に居ない待たせ手**: `BLOCKING_SESSION` の指す先が一覧に無ければ
///   繋がない。待っている側が根になる。
/// - **別インスタンスの待たせ手**: `BLOCKING_INSTANCE` が `instance` と違えば
///   繋がない。`V$SESSION` には相手が写らないためである。
///
/// # 引数
///
/// * `sessions` - `V$SESSION` から読んだ行
/// * `instance` - 今繋がっているインスタンスの番号
///
/// # 戻り値
///
/// 根の並び。元の一覧の順序を保つ。
pub fn build_blocking_chains(sessions: &[SessionRow], instance: u32) -> Vec<BlockingNode> {
    let 一覧にある: HashSet<u32> = sessions.iter().map(|session| session.sid).collect();

    // 待っている側 → 待たせている側。繋げられる関係だけを載せる。
    let mut 待たせ手: HashMap<u32, u32> = HashMap::new();
    // 待たせている側 → 待たせられている側。`SID` の順に並べて出力を定める。
    let mut 待たせている相手: BTreeMap<u32, Vec<u32>> = BTreeMap::new();

    for session in sessions {
        let Some(blocker) = session.blocking_session else {
            continue;
        };

        // 自分自身を待つ行は読み取りの途中を写しただけであり、意味を持たない。
        if blocker == session.sid || !一覧にある.contains(&blocker) {
            continue;
        }

        if session.blocked_from_other_instance(instance) {
            continue;
        }

        待たせ手.insert(session.sid, blocker);
        待たせている相手
            .entry(blocker)
            .or_default()
            .push(session.sid);
    }

    let mut 訪れた: HashSet<u32> = HashSet::new();
    let mut roots = Vec::new();

    // 誰かを待たせていて、かつ自分は誰も待っていないセッションが根である。
    for session in sessions {
        let sid = session.sid;
        if 待たせている相手.contains_key(&sid) && !待たせ手.contains_key(&sid) {
            roots.push(節点を組む(sid, &待たせている相手, &mut 訪れた));
        }
    }

    // 循環だけで閉じた塊はどの根からも辿れない。取りこぼさないよう拾い直す。
    for session in sessions {
        let sid = session.sid;
        if 待たせている相手.contains_key(&sid) && !訪れた.contains(&sid) {
            roots.push(節点を組む(sid, &待たせている相手, &mut 訪れた));
        }
    }

    roots
}

/// 1 節点とその下を組み立てる。
///
/// 訪れた `SID` を記録しながら降りるため、循環があっても止まる。
///
/// # 引数
///
/// * `sid` - この節点のセッション
/// * `待たせている相手` - 待たせている側 → 待たせられている側の表
/// * `訪れた` - 既に木へ載せた `SID`
fn 節点を組む(
    sid: u32,
    待たせている相手: &BTreeMap<u32, Vec<u32>>,
    訪れた: &mut HashSet<u32>,
) -> BlockingNode {
    訪れた.insert(sid);

    let mut blocked = Vec::new();
    for 相手 in 待たせている相手.get(&sid).map(Vec::as_slice).unwrap_or(&[]) {
        if 訪れた.contains(相手) {
            continue;
        }
        blocked.push(節点を組む(*相手, 待たせている相手, 訪れた));
    }

    BlockingNode { sid, blocked }
}

/// kill してよいかを確かめる（ADR 0017 の関所 1 と 2）。
///
/// UI でボタンを隠すだけにはしない。フロントエンドを直せば通ってしまうためで
/// ある。読み取り専用の保証を Rust 側へ置く考え方は
/// [[0004-認証情報と接続設定の保存先]] と同じである。
///
/// `ALTER SYSTEM KILL SESSION` はデータを書かないため、読み取り専用トランザク
/// ションでは止まらない。この 1 つだけはクライアント側で弾くしかない。判定の
/// 材料は接続設定の真偽値 1 つであり、SQL の中身を解釈しないため、
/// `WITH ... INSERT` のようなすり抜けは起こらない。
///
/// 小槌自身の接続も弾く。自分自身に限らず、同じプールの残りの接続と別の
/// ウィンドウの接続を落としても、以後の実行が `ORA-00028` で失敗する。
///
/// # 引数
///
/// * `overview` - 直前に読んだセッションの一覧
/// * `target_sid` - 落とそうとしているセッション
/// * `read_only` - 読み取り専用で繋いだ接続か
///
/// # 戻り値
///
/// 発行してよければ `Ok(())`。弾いた場合は理由を述べたエラー。
pub fn check_kill_allowed(
    overview: &SessionOverview,
    target_sid: u32,
    read_only: bool,
) -> DbResult<()> {
    if read_only {
        return Err(DbError::permission(
            "読み取り専用の接続ではセッションを終了できません",
        ));
    }

    let Some(target) = overview.find(target_sid) else {
        return Err(DbError::execute(format!(
            "SID {target_sid} のセッションは見つかりません。一覧を更新してください"
        )));
    };

    if target_sid == overview.current_sid {
        return Err(DbError::execute(format!(
            "SID {target_sid} はこの接続自身のセッションです。自分自身は終了できません"
        )));
    }

    if target.own {
        return Err(DbError::execute(format!(
            "SID {target_sid} は小槌自身が張っている接続です。終了できません"
        )));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::error::DbErrorKind;

    /// 待たせ手だけを指定したセッションを作る。
    ///
    /// # 引数
    ///
    /// * `sid` - セッションの `SID`
    /// * `blocking` - 待たせている側の `SID`
    fn セッション(sid: u32, blocking: Option<u32>) -> SessionRow {
        SessionRow {
            sid,
            serial: sid * 10,
            username: Some(String::from("KODUCHI")),
            status: String::from("ACTIVE"),
            osuser: None,
            machine: Some(String::from("mac.local")),
            process: Some(format!("{sid}00")),
            program: None,
            module: None,
            event: None,
            seconds_in_wait: 0,
            sql_id: None,
            logon_time: None,
            blocking_session: blocking,
            blocking_instance: blocking.map(|_| 1),
            own: false,
        }
    }

    /// クライアントのプロセスを指定したセッションを作る。
    ///
    /// # 引数
    ///
    /// * `sid` - セッションの `SID`
    /// * `process` - クライアント側のプロセス ID
    fn 同じプロセスのセッション(sid: u32, process: &str) -> SessionRow {
        SessionRow {
            process: Some(String::from(process)),
            ..セッション(sid, None)
        }
    }

    #[test]
    fn 誰も待っていなければ連鎖は空になる() {
        // Arrange
        let sessions = vec![セッション(10, None), セッション(20, None)];

        // Act
        let chains = build_blocking_chains(&sessions, 1);

        // Assert
        assert!(chains.is_empty());
    }

    #[test]
    fn 待たせている側が根になる() {
        // Arrange: 20 が 10 を待っている
        let sessions = vec![セッション(10, None), セッション(20, Some(10))];

        // Act
        let chains = build_blocking_chains(&sessions, 1);

        // Assert
        assert_eq!(
            chains,
            vec![BlockingNode {
                sid: 10,
                blocked: vec![BlockingNode {
                    sid: 20,
                    blocked: Vec::new()
                }],
            }]
        );
    }

    #[test]
    fn 連鎖は何段でも辿れる() {
        // Arrange: 30 → 20 → 10 の順に待たされている
        let sessions = vec![
            セッション(10, None),
            セッション(20, Some(10)),
            セッション(30, Some(20)),
        ];

        // Act
        let chains = build_blocking_chains(&sessions, 1);

        // Assert
        assert_eq!(chains.len(), 1);
        assert_eq!(chains[0].sid, 10);
        assert_eq!(chains[0].blocked[0].sid, 20);
        assert_eq!(chains[0].blocked[0].blocked[0].sid, 30);
    }

    #[test]
    fn 一つのセッションが複数を待たせていれば枝分かれする() {
        // Arrange
        let sessions = vec![
            セッション(10, None),
            セッション(20, Some(10)),
            セッション(30, Some(10)),
        ];

        // Act
        let chains = build_blocking_chains(&sessions, 1);

        // Assert
        let 待たせている: Vec<u32> = chains[0].blocked.iter().map(|node| node.sid).collect();
        assert_eq!(待たせている, vec![20, 30]);
    }

    #[test]
    fn 一覧に居ない待たせ手は繋がず待っている側を根にする() {
        // Arrange: 999 はバックグラウンドプロセスなどで一覧に無い
        let sessions = vec![セッション(20, Some(999)), セッション(30, Some(20))];

        // Act
        let chains = build_blocking_chains(&sessions, 1);

        // Assert
        assert_eq!(chains.len(), 1);
        assert_eq!(chains[0].sid, 20);
        assert_eq!(chains[0].blocked[0].sid, 30);
    }

    #[test]
    fn 別インスタンスの待たせ手とは連鎖を繋がない() {
        // Arrange: 20 はインスタンス 2 のセッションに待たされている
        let mut 別インスタンスで待つ = セッション(20, Some(10));
        別インスタンスで待つ.blocking_instance = Some(2);
        let sessions = vec![セッション(10, None), 別インスタンスで待つ];

        // Act
        let chains = build_blocking_chains(&sessions, 1);

        // Assert
        assert!(chains.is_empty());
    }

    #[test]
    fn 別インスタンスに待たされているかを行から判定できる() {
        // Arrange
        let mut session = セッション(20, Some(10));
        session.blocking_instance = Some(2);

        // Act
        let 外にいる = session.blocked_from_other_instance(1);

        // Assert
        assert!(外にいる);
        assert!(!セッション(20, Some(10)).blocked_from_other_instance(1));
    }

    #[test]
    fn 循環していても組み立てが止まる() {
        // Arrange: 10 と 20 が互いを待っている
        let sessions = vec![セッション(10, Some(20)), セッション(20, Some(10))];

        // Act
        let chains = build_blocking_chains(&sessions, 1);

        // Assert: 片方を根として立て、同じ節点を二度は載せない
        assert_eq!(chains.len(), 1);
        assert_eq!(chains[0].sid, 10);
        assert_eq!(chains[0].blocked[0].sid, 20);
        assert!(chains[0].blocked[0].blocked.is_empty());
    }

    #[test]
    fn 自分自身を待つ行は無視する() {
        // Arrange
        let sessions = vec![セッション(10, Some(10))];

        // Act
        let chains = build_blocking_chains(&sessions, 1);

        // Assert
        assert!(chains.is_empty());
    }

    #[test]
    fn 取得結果は連鎖を伴って組み立てられる() {
        // Arrange
        let sessions = vec![セッション(10, None), セッション(20, Some(10))];

        // Act
        let overview = SessionOverview::new(1, 10, sessions);

        // Assert
        assert_eq!(overview.current_sid, 10);
        assert_eq!(overview.chains.len(), 1);
        assert_eq!(overview.chains[0].sid, 10);
    }

    #[test]
    fn 小槌が張った接続には印が付く() {
        // Arrange: 同じプロセスから 2 本張っている（プールの兄弟）
        let sessions = vec![
            同じプロセスのセッション(10, "4242"),
            同じプロセスのセッション(20, "4242"),
            同じプロセスのセッション(30, "9999"),
        ];

        // Act
        let overview = SessionOverview::new(1, 10, sessions);

        // Assert
        assert!(overview.find(10).unwrap().own);
        assert!(overview.find(20).unwrap().own);
        assert!(!overview.find(30).unwrap().own);
    }

    #[test]
    fn プロセスが読めないときも自分自身には印が付く() {
        // Arrange
        let sessions = vec![
            SessionRow {
                process: None,
                ..セッション(10, None)
            },
            SessionRow {
                process: None,
                ..セッション(20, None)
            },
        ];

        // Act
        let overview = SessionOverview::new(1, 10, sessions);

        // Assert
        assert!(overview.find(10).unwrap().own);
        assert!(!overview.find(20).unwrap().own);
    }

    #[test]
    fn 他人のセッションはkillできる() {
        // Arrange
        let overview = SessionOverview::new(
            1,
            10,
            vec![
                同じプロセスのセッション(10, "4242"),
                同じプロセスのセッション(20, "9999"),
            ],
        );

        // Act
        let result = check_kill_allowed(&overview, 20, false);

        // Assert
        assert!(result.is_ok());
    }

    #[test]
    fn 自分自身のセッションはkillできない() {
        // Arrange
        let overview = SessionOverview::new(1, 10, vec![同じプロセスのセッション(10, "4242")]);

        // Act
        let error = check_kill_allowed(&overview, 10, false).unwrap_err();

        // Assert
        assert_eq!(error.kind, DbErrorKind::Execute);
        assert!(error.message.contains("自分自身"));
    }

    #[test]
    fn 同じプールの別の接続もkillできない() {
        // Arrange: 兄弟の接続を落とすと、そのタブの次の実行が ORA-00028 で失敗する
        let overview = SessionOverview::new(
            1,
            10,
            vec![
                同じプロセスのセッション(10, "4242"),
                同じプロセスのセッション(20, "4242"),
            ],
        );

        // Act
        let error = check_kill_allowed(&overview, 20, false).unwrap_err();

        // Assert
        assert!(error.message.contains("小槌自身"));
    }

    #[test]
    fn 読み取り専用の接続ではkillできない() {
        // Arrange
        let overview = SessionOverview::new(
            1,
            10,
            vec![
                同じプロセスのセッション(10, "4242"),
                同じプロセスのセッション(20, "9999"),
            ],
        );

        // Act
        let error = check_kill_allowed(&overview, 20, true).unwrap_err();

        // Assert
        assert_eq!(error.kind, DbErrorKind::Permission);
        assert!(error.message.contains("読み取り専用"));
    }

    #[test]
    fn 読み取り専用の判定は一覧を引く前に効く() {
        // Arrange: 一覧に載っていない SID でも、読み取り専用なら理由はそちらになる
        let overview = SessionOverview::new(1, 10, vec![同じプロセスのセッション(10, "4242")]);

        // Act
        let error = check_kill_allowed(&overview, 999, true).unwrap_err();

        // Assert
        assert_eq!(error.kind, DbErrorKind::Permission);
    }

    #[test]
    fn 一覧に無いセッションはkillできない() {
        // Arrange: 一覧を読んでから消えたセッション
        let overview = SessionOverview::new(1, 10, vec![同じプロセスのセッション(10, "4242")]);

        // Act
        let error = check_kill_allowed(&overview, 999, false).unwrap_err();

        // Assert
        assert!(error.message.contains("見つかりません"));
    }

    #[test]
    fn セッションの一覧はキャメルケースでシリアライズされる() {
        // Arrange
        let overview = SessionOverview::new(1, 10, vec![セッション(10, None)]);

        // Act
        let json = serde_json::to_string(&overview).unwrap();

        // Assert
        assert!(json.contains(r#""currentSid":10"#));
        assert!(json.contains(r#""secondsInWait":0"#));
        assert!(json.contains(r#""blockingSession":null"#));
    }
}
