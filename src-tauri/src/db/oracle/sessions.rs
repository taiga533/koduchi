//! Oracle のセッション一覧と kill（ADR 0017）。
//!
//! `V$SESSION` を 1 度の問い合わせで読み、ブロッキングの連鎖の組み立ては
//! `crate::db::sessions` の純粋な関数へ渡す。問い合わせは `Connection` を直接
//! 使うため、`OracleDriver` が持つ結果セットのカーソル（ADR 0003）には触れない。
//!
//! `V$SESSION` の参照は権限を要する。持っていない接続では `ORA-00942` になるため、
//! そのときは `DbErrorKind::Permission` へ写して「空だった」と混同させない。

use crate::db::error::DbResult;
use crate::db::oracle::errors::{self, map_permission_error};
use crate::db::sessions::{check_kill_allowed, SessionOverview, SessionRow};
use oracle::Connection;

/// `V$SESSION` から読む列。
///
/// `TYPE = 'USER'` で絞るのは、バックグラウンドプロセスが調べものの対象に
/// ならないためである。`BLOCKING_SESSION` は `BLOCKING_SESSION_STATUS` が
/// `VALID` のときだけ意味を持つため、それ以外は `NULL` へ畳む。
const SESSIONS_SQL: &str = "select s.sid,
       s.serial#,
       s.username,
       s.status,
       s.osuser,
       s.machine,
       s.process,
       s.program,
       s.module,
       s.event,
       s.seconds_in_wait,
       s.sql_id,
       to_char(s.logon_time, 'YYYY-MM-DD HH24:MI:SS'),
       case when s.blocking_session_status = 'VALID' then s.blocking_session end,
       case when s.blocking_session_status = 'VALID' then s.blocking_instance end
  from v$session s
 where s.type = 'USER'
 order by s.sid";

/// 自分自身のセッション ID とインスタンス番号を読む問い合わせ。
///
/// `SYS_CONTEXT` は V$ ビューの権限を要さない。`V$SESSION` が見えない接続でも
/// 「自分がどのセッションか」だけは分かる。
const IDENTITY_SQL: &str =
    "select sys_context('userenv','sid'), sys_context('userenv','instance') from dual";

/// `V$SESSION` を参照できないときに添える案内。
const SESSION_PERMISSION_HINT: &str =
    "。この接続には参照権限がありません（SELECT_CATALOG_ROLE などが要ります）";

/// `SYS_CONTEXT` の返す文字列を番号として読む。
///
/// 読めない値が返ることは想定しないが、`NULL` や空文字列でも落とさずに 0 を
/// 返す。0 はどのセッションとも一致しないため、kill の関所は閉じたままになる。
///
/// # 引数
///
/// * `raw` - `SYS_CONTEXT` が返した文字列
fn 番号として読む(raw: Option<String>) -> u32 {
    raw.and_then(|value| value.trim().parse::<u32>().ok())
        .unwrap_or(0)
}

/// 自分自身のセッション ID とインスタンス番号を読む。
///
/// # 引数
///
/// * `connection` - 使う接続
///
/// # 戻り値
///
/// `(SID, インスタンス番号)`。
pub fn load_identity(connection: &Connection) -> DbResult<(u32, u32)> {
    let (sid, instance) = connection
        .query_row_as::<(Option<String>, Option<String>)>(IDENTITY_SQL, &[])
        .map_err(|error| {
            errors::map_execute_error("自分自身のセッションを特定できませんでした", &error)
        })?;

    Ok((番号として読む(sid), 番号として読む(instance)))
}

/// `V$SESSION` を読んでセッション一覧を組み立てる（ADR 0017）。
///
/// 連鎖の組み立ては `SessionOverview::new` が行う。
///
/// # 引数
///
/// * `connection` - 使う接続
pub fn load_sessions(connection: &Connection) -> DbResult<SessionOverview> {
    let (current_sid, instance) = load_identity(connection)?;

    let rows = connection.query(SESSIONS_SQL, &[]).map_err(|error| {
        map_permission_error(
            "V$SESSION を参照できません",
            &error,
            SESSION_PERMISSION_HINT,
        )
    })?;

    let mut sessions = Vec::new();

    for row in rows {
        let row = row.map_err(|error| {
            map_permission_error(
                "V$SESSION を参照できません",
                &error,
                SESSION_PERMISSION_HINT,
            )
        })?;

        let 読めない = |error: oracle::Error| {
            errors::map_execute_error("セッションを読み取れませんでした", &error)
        };

        sessions.push(SessionRow {
            sid: row.get::<usize, u32>(0).map_err(読めない)?,
            serial: row.get::<usize, u32>(1).map_err(読めない)?,
            username: row.get::<usize, Option<String>>(2).map_err(読めない)?,
            status: row
                .get::<usize, Option<String>>(3)
                .map_err(読めない)?
                .unwrap_or_default(),
            osuser: row.get::<usize, Option<String>>(4).map_err(読めない)?,
            machine: row.get::<usize, Option<String>>(5).map_err(読めない)?,
            process: row.get::<usize, Option<String>>(6).map_err(読めない)?,
            program: row.get::<usize, Option<String>>(7).map_err(読めない)?,
            module: row.get::<usize, Option<String>>(8).map_err(読めない)?,
            event: row.get::<usize, Option<String>>(9).map_err(読めない)?,
            seconds_in_wait: row
                .get::<usize, Option<i64>>(10)
                .map_err(読めない)?
                .unwrap_or(0),
            sql_id: row.get::<usize, Option<String>>(11).map_err(読めない)?,
            logon_time: row.get::<usize, Option<String>>(12).map_err(読めない)?,
            blocking_session: row.get::<usize, Option<u32>>(13).map_err(読めない)?,
            blocking_instance: row.get::<usize, Option<u32>>(14).map_err(読めない)?,
            // 印は `SessionOverview::new` が全行を見てから付ける。
            own: false,
        });
    }

    Ok(SessionOverview::new(instance, current_sid, sessions))
}

/// `ALTER SYSTEM KILL SESSION` の文を組み立てる。
///
/// `SID` と `SERIAL#` は数値としてしか受け取らないため、文字列を組み立てても
/// SQL の注入は起こらない。`ALTER SYSTEM` はバインド変数を受け付けないため、
/// この形にするほかない。
///
/// `IMMEDIATE` を付けるのは、セッションが確実に落ちるまで待たずに制御を返す
/// ためである。付けないと、待ちに入っているセッションでは
/// 「marked for kill」のまま何も起きないように見える。
///
/// # 引数
///
/// * `sid` - 対象の `SID`
/// * `serial` - 対象の `SERIAL#`
pub fn kill_statement(sid: u32, serial: u32) -> String {
    format!("alter system kill session '{sid},{serial}' immediate")
}

/// セッションを 1 つ終了する（ADR 0017）。
///
/// 発行の前に関所を 2 つ通す。読み取り専用の接続からは発行せず、小槌自身が
/// 張っている接続も対象にしない。3 つ目の関所（確認ダイアログ）は
/// フロントエンドにある。
///
/// 判定のために一覧を読み直す。UI が持っている一覧は古くなりうるうえ、
/// `SID` は使い回されるためである。破壊的な操作は 1 度きりであり、
/// `V$SESSION` を 1 回読む代償は釣り合う。読み直した `SERIAL#` は
/// `check_kill_allowed` が呼び出し側の指定と突き合わせる。古い `SERIAL#` の
/// まま撃たせない。
///
/// # 引数
///
/// * `connection` - 使う接続
/// * `sid` - 対象の `SID`
/// * `serial` - 対象の `SERIAL#`
/// * `read_only` - 読み取り専用で繋いだ接続か
pub fn kill_session(
    connection: &Connection,
    sid: u32,
    serial: u32,
    read_only: bool,
) -> DbResult<()> {
    // 読み取り専用は一覧を読むまでもなく弾く。空の一覧を渡しても順序は同じだが、
    // 無駄な往復をしないよう先に確かめる。
    if read_only {
        return check_kill_allowed(&SessionOverview::new(0, 0, Vec::new()), sid, serial, true);
    }

    let overview = load_sessions(connection)?;
    check_kill_allowed(&overview, sid, serial, read_only)?;

    connection
        .execute(&kill_statement(sid, serial), &[])
        .map(|_| ())
        .map_err(|error| {
            map_permission_error(
                &format!("SID {sid} を終了できません"),
                &error,
                "。この接続には ALTER SYSTEM 権限がありません",
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn killの文はsidとserialを繋いだ形になる() {
        // Arrange & Act
        let sql = kill_statement(123, 45678);

        // Assert
        assert_eq!(sql, "alter system kill session '123,45678' immediate");
    }

    #[test]
    fn sys_contextの値は番号として読める() {
        // Arrange & Act & Assert
        assert_eq!(番号として読む(Some(String::from("123"))), 123);
        assert_eq!(番号として読む(Some(String::from(" 1 "))), 1);
    }

    #[test]
    fn 読めない値は零になり誰とも一致しない() {
        // Arrange & Act & Assert: 0 はどのセッションとも一致しないため、
        // kill の関所は閉じたままになる
        assert_eq!(番号として読む(None), 0);
        assert_eq!(番号として読む(Some(String::new())), 0);
    }
}
