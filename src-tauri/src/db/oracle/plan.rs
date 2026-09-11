//! 実行計画の生成（ADR の「実行計画」節）。
//!
//! `⌘E` は `EXPLAIN PLAN FOR` で見積りだけを取り、`⇧⌘E` は
//! `/*+ GATHER_PLAN_STATISTICS */` を注入して実際に実行してから
//! `DBMS_XPLAN.DISPLAY_CURSOR` で実測付きの計画を取る。E-Rows と A-Rows の
//! 乖離が見えるのは後者だけである。
//!
//! 出力は `DBMS_XPLAN` が整形したテキストをそのまま渡す。ツリー UI への
//! パースは行わない。

use crate::db::driver::Bind;
use crate::db::error::DbResult;
use crate::db::oracle::bind;
use crate::db::oracle::errors;
use oracle::Connection;

/// 実測を集めるためのヒント。
const GATHER_HINT: &str = "/*+ GATHER_PLAN_STATISTICS */";

/// ヒントを差し込む位置の目印になるキーワード。
const STATEMENT_KEYWORDS: [&str; 5] = ["SELECT", "INSERT", "UPDATE", "DELETE", "MERGE"];

/// SQL の先頭のキーワードが終わる位置を探す。
///
/// 文字列リテラル・引用符付き識別子・コメントの中は見ない。また括弧の内側も
/// 見ない。`WITH a AS (SELECT …) SELECT …` で、共通表式の中ではなく主問い合わせの
/// `SELECT` を選ぶためである。
///
/// # 引数
///
/// * `sql` - 走査する SQL
///
/// # 戻り値
///
/// キーワードの直後のバイト位置。見つからなければ `None`。
fn find_statement_keyword_end(sql: &str) -> Option<usize> {
    let bytes = sql.as_bytes();
    let mut index = 0usize;
    let mut depth = 0i32;
    let mut word_start: Option<usize> = None;

    /// 語が目印のキーワードかどうかを判定する。
    fn 目印か(word: &str) -> bool {
        STATEMENT_KEYWORDS
            .iter()
            .any(|keyword| word.eq_ignore_ascii_case(keyword))
    }

    while index < bytes.len() {
        let current = bytes[index];

        // 語の切れ目でだけ判定する。判定できたらその位置を返す。
        let 語を構成する = current.is_ascii_alphanumeric() || current == b'_' || current == b'$';
        if 語を構成する {
            if word_start.is_none() {
                word_start = Some(index);
            }
            index += 1;
            continue;
        }

        if let Some(start) = word_start.take() {
            if depth == 0 && 目印か(&sql[start..index]) {
                return Some(index);
            }
        }

        match current {
            b'-' if bytes.get(index + 1) == Some(&b'-') => {
                while index < bytes.len() && bytes[index] != b'\n' {
                    index += 1;
                }
            }
            b'/' if bytes.get(index + 1) == Some(&b'*') => {
                index += 2;
                while index < bytes.len() {
                    if bytes[index] == b'*' && bytes.get(index + 1) == Some(&b'/') {
                        index += 2;
                        break;
                    }
                    index += 1;
                }
            }
            b'\'' => {
                index += 1;
                while index < bytes.len() {
                    if bytes[index] == b'\'' {
                        // 連続する引用符はリテラルの中の引用符である。
                        if bytes.get(index + 1) == Some(&b'\'') {
                            index += 2;
                            continue;
                        }
                        index += 1;
                        break;
                    }
                    index += 1;
                }
            }
            b'"' => {
                index += 1;
                while index < bytes.len() && bytes[index] != b'"' {
                    index += 1;
                }
                index += 1;
            }
            b'(' => {
                depth += 1;
                index += 1;
            }
            b')' => {
                depth -= 1;
                index += 1;
            }
            _ => index += 1,
        }
    }

    // 末尾が語で終わっている場合。
    if let Some(start) = word_start {
        if depth == 0 && 目印か(&sql[start..]) {
            return Some(sql.len());
        }
    }

    None
}

/// SQL に `/*+ GATHER_PLAN_STATISTICS */` を差し込む。
///
/// 差し込み先が見つからなければ元の SQL をそのまま返す。その場合は実測が
/// 集まらないだけで、計画そのものは取得できる。
///
/// # 引数
///
/// * `sql` - 元の SQL
pub fn inject_gather_plan_statistics(sql: &str) -> String {
    match find_statement_keyword_end(sql) {
        Some(position) => format!("{} {GATHER_HINT}{}", &sql[..position], &sql[position..]),
        None => sql.to_string(),
    }
}

/// `DBMS_XPLAN` の出力を 1 つの文字列にまとめて取り出す。
///
/// # 引数
///
/// * `connection` - 使う接続
/// * `sql` - `plan_table_output` を返す問い合わせ
fn fetch_plan_text(connection: &Connection, sql: &str) -> DbResult<String> {
    let rows = connection
        .query_as::<Option<String>>(sql, &[])
        .map_err(|error| errors::map_execute_error("実行計画を取得できませんでした", &error))?;

    let mut lines = Vec::new();
    for row in rows {
        let line = row
            .map_err(|error| errors::map_execute_error("実行計画を取得できませんでした", &error))?;
        lines.push(line.unwrap_or_default());
    }

    Ok(lines.join("\n"))
}

/// 見積りだけの実行計画を取る（`⌘E`）。
///
/// `EXPLAIN PLAN` は `PLAN_TABLE` への書き込みを伴う。読み取り専用トランザクションの
/// 最中は実行できないため、呼び出し側があらかじめ解除しておく必要がある。
///
/// バインド変数を含む SQL でも計画は取れるが、値を与えないと `ORA-01008` になる。
/// 与えられた値をそのまま渡す（ADR の「バインド変数」節）。
///
/// # 引数
///
/// * `connection` - 使う接続
/// * `sql` - 計画を見たい SQL
/// * `binds` - SQL 中のバインド変数へ与える値
pub fn explain(connection: &Connection, sql: &str, binds: &[Bind]) -> DbResult<String> {
    let mut statement = connection
        .statement(&format!("explain plan for {sql}"))
        .build()
        .map_err(|error| errors::map_execute_error("実行計画を作れませんでした", &error))?;

    let bound = bind::bound_values(&statement, binds)?;

    statement
        .execute_named(&bind::params(&bound))
        .map_err(|error| errors::map_execute_error("実行計画を作れませんでした", &error))?;

    fetch_plan_text(
        connection,
        "select plan_table_output from table(dbms_xplan.display(null, null, 'ALL'))",
    )
}

/// 実測付きの実行計画を取る（`⇧⌘E`）。
///
/// SQL を実際に最後まで実行する。行は捨てるが、副作用のある文ではその副作用が
/// 起きる。呼び出し側は `SELECT` 以外に対して事前に確認を取る必要がある。
///
/// # 引数
///
/// * `connection` - 使う接続
/// * `sql` - 計画を見たい SQL
/// * `binds` - SQL 中のバインド変数へ与える値
pub fn actual(connection: &Connection, sql: &str, binds: &[Bind]) -> DbResult<String> {
    let hinted = inject_gather_plan_statistics(sql);

    let mut statement = connection
        .statement(&hinted)
        .build()
        .map_err(|error| errors::map_execute_error("", &error))?;

    let bound = bind::bound_values(&statement, binds)?;

    if statement.is_query() {
        // 実測は最後まで実行しないと揃わない。行そのものは使わないので捨てる。
        let rows = statement
            .into_result_set_named::<oracle::Row>(&bind::params(&bound))
            .map_err(|error| errors::map_execute_error("", &error))?;
        for row in rows {
            row.map_err(|error| errors::map_execute_error("", &error))?;
        }
    } else {
        statement
            .execute_named(&bind::params(&bound))
            .map_err(|error| errors::map_execute_error("", &error))?;
    }

    fetch_plan_text(
        connection,
        "select plan_table_output
         from table(dbms_xplan.display_cursor(null, null, 'ALLSTATS LAST'))",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selectの直後にヒントが入る() {
        // Arrange
        let sql = "select * from users";

        // Act
        let hinted = inject_gather_plan_statistics(sql);

        // Assert
        assert_eq!(hinted, "select /*+ GATHER_PLAN_STATISTICS */ * from users");
    }

    #[test]
    fn 大文字のselectにも入る() {
        // Arrange
        let sql = "SELECT 1 FROM DUAL";

        // Act
        let hinted = inject_gather_plan_statistics(sql);

        // Assert
        assert_eq!(hinted, "SELECT /*+ GATHER_PLAN_STATISTICS */ 1 FROM DUAL");
    }

    #[test]
    fn 共通表式では主問い合わせのselectに入る() {
        // Arrange
        let sql = "with recent as (select id from events) select * from recent";

        // Act
        let hinted = inject_gather_plan_statistics(sql);

        // Assert
        assert_eq!(
            hinted,
            "with recent as (select id from events) select /*+ GATHER_PLAN_STATISTICS */ * from recent"
        );
    }

    #[test]
    fn insertの直後にヒントが入る() {
        // Arrange
        let sql = "insert into users (id) select id from staging";

        // Act
        let hinted = inject_gather_plan_statistics(sql);

        // Assert
        assert_eq!(
            hinted,
            "insert /*+ GATHER_PLAN_STATISTICS */ into users (id) select id from staging"
        );
    }

    #[test]
    fn 先頭のコメントの中の語は目印にならない() {
        // Arrange
        let sql = "-- select を書いた説明\nselect 1 from dual";

        // Act
        let hinted = inject_gather_plan_statistics(sql);

        // Assert
        assert_eq!(
            hinted,
            "-- select を書いた説明\nselect /*+ GATHER_PLAN_STATISTICS */ 1 from dual"
        );
    }

    #[test]
    fn ブロックコメントの中の語も目印にならない() {
        // Arrange
        let sql = "/* select */ update users set name = 'a'";

        // Act
        let hinted = inject_gather_plan_statistics(sql);

        // Assert
        assert_eq!(
            hinted,
            "/* select */ update /*+ GATHER_PLAN_STATISTICS */ users set name = 'a'"
        );
    }

    #[test]
    fn 文字列リテラルの中の語も目印にならない() {
        // Arrange
        let sql = "delete from logs where message = 'select'";

        // Act
        let hinted = inject_gather_plan_statistics(sql);

        // Assert
        assert_eq!(
            hinted,
            "delete /*+ GATHER_PLAN_STATISTICS */ from logs where message = 'select'"
        );
    }

    #[test]
    fn 目印が無い文はそのまま返る() {
        // Arrange
        let sql = "begin say_hello; end;";

        // Act
        let hinted = inject_gather_plan_statistics(sql);

        // Assert
        assert_eq!(hinted, sql);
    }

    #[test]
    fn 括弧の中のselectだけの文は主問い合わせが無いのでそのまま返る() {
        // Arrange
        let sql = "(select 1 from dual)";

        // Act
        let hinted = inject_gather_plan_statistics(sql);

        // Assert
        assert_eq!(hinted, sql);
    }
}
