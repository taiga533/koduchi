//! PL/SQL のコンパイルエラーを `ALL_ERRORS` から引く（ADR 0045）。
//!
//! 「どの文がコンパイルエラーを出したか」は Oracle が `ORA-24344` の警告で
//! 教える。**「何を作ったか」は教えない。**そこで SQL を読んで名前を拾う代わりに、
//! 実行の間に `LAST_DDL_TIME` が動いたオブジェクトの `ALL_ERRORS` を引く
//! （ADR 0034 の「小槌は SQL を読んで決めない」を守るため）。実測で確かめたのは
//! 次の 3 点である。
//!
//! - `CREATE OR REPLACE` は、同じ本文の無効なオブジェクトに流し直しても
//!   `LAST_DDL_TIME` を進める。
//! - `ALTER ... COMPILE` も進める。SQL を読む方式ではここを別に書く必要がある。
//! - 巻き添えで無効になった依存先の `LAST_DDL_TIME` は動かない。

use crate::db::compilation::{
    lookback_seconds, CompilationReport, CompileDiagnostic, DiagnosticSeverity,
};
use crate::db::error::DbResult;
use crate::db::oracle::errors;
use oracle::Connection;
use std::time::Duration;

/// 「警告付きで成功」のうち、コンパイルエラーを示す番号。
const COMPILATION_WARNING: i32 = 24344;

/// 直前の実行が `ORA-24344` を受けていれば、その原文を返す。
///
/// `Connection::last_warning` は ODPI-C が実行の直後に控えた値を読むだけで、
/// **データベースへ往復しない。**そのため警告の無い大多数の実行では余計な
/// 往復が 1 つも増えない。
///
/// # 引数
///
/// * `connection` - 直前に文を実行した接続
pub fn compilation_warning(connection: &Connection) -> Option<String> {
    let warning = connection.last_warning()?;
    let code = warning.db_error().map(|error| error.code())?;
    (code == COMPILATION_WARNING).then(|| warning.to_string())
}

/// 実行の間に定義が変わったオブジェクトの `ALL_ERRORS` を引く。
///
/// 所有者で絞らないのは、`CREATE PROCEDURE other.p` のように他のスキーマへ
/// 作る文があるためである。同じ秒に別のセッションがコンパイルしたオブジェクトも
/// 拾いうるが、行ごとに名前を添えて出すため取り違えにはならない。**利用者の
/// オブジェクトを取りこぼす向きには外れない**ことを、広く拾う側へ倒した理由とする。
///
/// 読めなかったときは写し替え（ADR 0030）を通して返す。黙って空の報告に
/// すると、画面には「内容が見つからなかった」と嘘が出る。
///
/// # 引数
///
/// * `connection` - 直前に文を実行した接続
/// * `warning` - `compilation_warning` が返した原文
/// * `elapsed` - 文を投げてから応答が返るまでの時間
pub fn load_report(
    connection: &Connection,
    warning: String,
    elapsed: Duration,
) -> DbResult<CompilationReport> {
    const SQL: &str = "select e.owner, e.name, e.type, e.line, e.position, e.attribute, e.text
                         from all_errors e
                         join all_objects o
                           on o.owner = e.owner
                          and o.object_name = e.name
                          and o.object_type = e.type
                        where o.last_ddl_time >= sysdate - :seconds / 86400
                        order by o.last_ddl_time desc, e.owner, e.name, e.type, e.sequence";
    const CONTEXT: &str = "コンパイルエラーの内容を読めませんでした";

    let seconds = lookback_seconds(elapsed) as i64;
    let rows = connection
        .query_as::<(String, String, String, u32, u32, String, String)>(SQL, &[&seconds])
        .map_err(|error| errors::map_execute_error(CONTEXT, &error))?;

    let mut diagnostics = Vec::new();
    for row in rows {
        let (owner, name, object_type, line, position, attribute, text) =
            row.map_err(|error| errors::map_execute_error(CONTEXT, &error))?;
        diagnostics.push(CompileDiagnostic {
            owner,
            name,
            object_type,
            line,
            position,
            severity: DiagnosticSeverity::from_attribute(&attribute),
            // `ALL_ERRORS.TEXT` は末尾に改行を持つことがある。1 行に並べるため落とす。
            text: text.trim_end().to_string(),
        });
    }

    Ok(CompilationReport {
        warning,
        diagnostics,
    })
}
