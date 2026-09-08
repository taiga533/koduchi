//! Oracle のソース検索（ADR 0021）。
//!
//! `ALL_SOURCE` を横断して「この文字列を含む処理はどれか」を探す。問い合わせは
//! `Connection` を直接使うため、`OracleDriver` が持つ結果セットのカーソル
//! （ADR 0003）には触れない。`crate::db::oracle::sessions` と同じ形である。
//!
//! **`ALL_SOURCE` は重い。** 中規模のデータベースでも数十万〜数百万行になり、
//! 素の `upper(text) like '%語%'` は全表走査になる。次の 3 つで抑えている。
//!
//! 1. 検索語の最短の長さを入口で確かめる（`SourceSearchRequest::validated_needle`）
//! 2. 所有者と種別の絞り込みを `like` より先に効かせる
//! 3. `rownum` で当たり行数に上限を置き、Oracle に途中で走査を止めさせる
//!
//! 3 のために `order by` を付けない。付けると全件を拾ってから並べることになり、
//! 上限が効かなくなる。並べ直しは `crate::db::source::group_matches` が行う。

use crate::db::error::{DbError, DbResult};
use crate::db::oracle::errors::map_permission_error;
use crate::db::oracle::schema::SYSTEM_SCHEMAS;
use crate::db::source::{
    context_range, group_matches, RawSourceMatch, SourceKind, SourceKindFilter, SourceLine,
    SourceSearchRequest, SourceSearchResult, SourceTarget, SOURCE_CONTEXT_RADIUS,
};
use oracle::Connection;

/// `ALL_SOURCE` を参照できないときに添える案内。
const SOURCE_PERMISSION_HINT: &str =
    "。この接続には参照権限がありません（SELECT_CATALOG_ROLE などが要ります）";

/// `like` のパターンで特別な意味を持つ文字を打ち消す。
///
/// 検索語は利用者が打った文字列であり、`%` や `_` は文字そのものとして扱う。
/// 打ち消さないと `_` が「任意の 1 文字」になり、`user_traits` の検索が
/// `userXtraits` にも当たる。
///
/// 打ち消しの記号自身（`\`）も打ち消す。順序を誤ると二重に効くため、`\` を
/// 最初に置き換える。
///
/// # 引数
///
/// * `needle` - 利用者が打った検索語
///
/// # 戻り値
///
/// `%語%` の形にした `like` のパターン。`escape '\'` と組にして使う。
pub fn like_pattern(needle: &str) -> String {
    let escaped = needle
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");

    format!("%{escaped}%")
}

/// フィルタが有効にしている `ALL_SOURCE.TYPE` の並びを組み立てる。
///
/// `in (...)` の中身をそのまま返す。有効な種別が 1 つも無ければ空文字列を返し、
/// 呼び出し側は問い合わせそのものを飛ばす（`crate::db::oracle::schema` の
/// `listed_object_types` と同じ作法である）。
///
/// 綴りは `SourceKind` が持つ定数であり、利用者の入力は混じらない。
///
/// # 引数
///
/// * `kinds` - 種別ごとの可否
pub fn listed_source_types(kinds: &SourceKindFilter) -> String {
    kinds
        .enabled()
        .into_iter()
        .map(|kind| format!("'{}'", kind.source_type()))
        .collect::<Vec<_>>()
        .join(", ")
}

/// 「すべてのスキーマ」のときに外す所有者の並びを組み立てる。
///
/// 所有者を選ばずに探すと `SYS` の PL/SQL が大半を占め、上限がそれだけで
/// 埋まる。スキーマツリーの「システムスキーマを除外」（ADR 0007）と同じ一覧を
/// 使い、同じものを外す。
///
/// 綴りは定数の一覧であり、利用者の入力は混じらない。
fn system_schema_list() -> String {
    SYSTEM_SCHEMAS
        .iter()
        .map(|name| format!("'{name}'"))
        .collect::<Vec<_>>()
        .join(", ")
}

/// ソース検索の問い合わせを組み立てる（ADR 0021）。
///
/// 検索語は `:needle` として渡す。**SQL へ直に埋め込まない。** 所有者も
/// `:owner` として渡す。埋め込むのは種別の綴りとシステムスキーマの名前だけで
/// あり、どちらもプログラムが持つ定数である。
///
/// 上限は `rownum` で当てる。`order by` を付けないのは、Oracle に上限へ達した
/// 時点で走査を止めさせるためである（`COUNT STOPKEY`）。並べ直しは Rust 側で
/// 行う。上限より 1 行多く取り、打ち切りが起きたかどうかを見分けられるように
/// してある。
///
/// # 引数
///
/// * `request` - 検索の求め
///
/// # 戻り値
///
/// 組み立てた SQL。有効な種別が 1 つも無ければ `None`。
pub fn build_search_sql(request: &SourceSearchRequest) -> Option<String> {
    let types = listed_source_types(&request.kinds);
    if types.is_empty() {
        return None;
    }

    let owner_predicate = match request.owner {
        // 選ばれたスキーマ 1 つに絞る。値はバインド変数で渡す。
        Some(_) => String::from("and s.owner = :owner"),
        // すべてのスキーマではシステムスキーマを外す（ADR 0007 と同じ一覧）。
        None => format!("and s.owner not in ({})", system_schema_list()),
    };

    // 大文字小文字を区別しないときは、両辺を Oracle 側で畳む。Rust 側で畳むと
    // Oracle の畳み方とずれる文字が出て、当たるはずのものを取りこぼす。
    let text_predicate = if request.case_sensitive {
        "s.text like :needle escape '\\'"
    } else {
        "upper(s.text) like upper(:needle) escape '\\'"
    };

    // 上限 + 1 行を取る。あふれたら打ち切りとして伝える。
    let fetch = request.effective_limit() + 1;

    Some(format!(
        "select owner, name, type, line, text
           from (select s.owner, s.name, s.type, s.line, s.text
                   from all_source s
                  where s.type in ({types})
                    {owner_predicate}
                    and {text_predicate})
          where rownum <= {fetch}"
    ))
}

/// 前後の行を読む問い合わせ。
///
/// 所有者・名前・種別・行の範囲をすべてバインド変数で渡す。当たった行の周りだけ
/// を読むため、数千行のパッケージ本体でも持ち帰る量は一定である。
const CONTEXT_SQL: &str = "select line, text
  from all_source
 where owner = :owner
   and name = :name
   and type = :type
   and line between :from_line and :to_line
 order by line";

/// `ALL_SOURCE` を横断して検索する（ADR 0021）。
///
/// 参照権限が無い接続では `DbErrorKind::Permission` を返す。空の結果を返しては
/// ならない。「見えない」と「無い」は別物である。
///
/// # 引数
///
/// * `connection` - 使う接続
/// * `request` - 検索の求め
pub fn search_source(
    connection: &Connection,
    request: &SourceSearchRequest,
) -> DbResult<SourceSearchResult> {
    let needle = request.validated_needle()?;
    let limit = request.effective_limit();

    // 種別を 1 つも選んでいなければ、問い合わせにも行かない。
    let Some(sql) = build_search_sql(request) else {
        return Ok(group_matches(Vec::new(), limit));
    };

    let pattern = like_pattern(needle);
    let 読めない = |error: oracle::Error| {
        map_permission_error("ソースを検索できません", &error, SOURCE_PERMISSION_HINT)
    };

    let rows = match &request.owner {
        Some(owner) => connection.query_named(
            &sql,
            &[("owner", &owner.as_str()), ("needle", &pattern.as_str())],
        ),
        None => connection.query_named(&sql, &[("needle", &pattern.as_str())]),
    }
    .map_err(読めない)?;

    let mut matches = Vec::new();

    for row in rows {
        let row = row.map_err(読めない)?;

        let 読み取れない = |error: oracle::Error| {
            DbError::execute(format!("ソースの行を読み取れませんでした: {error}"))
        };

        let source_type = row.get::<usize, String>(2).map_err(読み取れない)?;
        // 知らない種別は落とす。問い合わせは種別を絞っているため通常は起きない。
        let Some(kind) = SourceKind::from_source_type(&source_type) else {
            continue;
        };

        matches.push(RawSourceMatch {
            owner: row.get::<usize, String>(0).map_err(読み取れない)?,
            name: row.get::<usize, String>(1).map_err(読み取れない)?,
            kind,
            line: row.get::<usize, u32>(3).map_err(読み取れない)?,
            text: row
                .get::<usize, Option<String>>(4)
                .map_err(読み取れない)?
                .unwrap_or_default(),
        });
    }

    Ok(group_matches(matches, limit))
}

/// 当たった行の前後を読む（ADR 0021）。
///
/// 当たった行だけでは「その表をどう触っているのか」が読めない。前後を添えると
/// その場で判断が付く。全文ではなく前後だけを読むのは、数千行のパッケージ本体
/// でも持ち帰る量を一定に保つためである。
///
/// # 引数
///
/// * `connection` - 使う接続
/// * `target` - 読むオブジェクト
/// * `line` - 中心にする行
pub fn source_context(
    connection: &Connection,
    target: &SourceTarget,
    line: u32,
) -> DbResult<Vec<SourceLine>> {
    let (from_line, to_line) = context_range(line, SOURCE_CONTEXT_RADIUS);

    let rows = connection
        .query_named(
            CONTEXT_SQL,
            &[
                ("owner", &target.owner.as_str()),
                ("name", &target.name.as_str()),
                ("type", &target.kind.source_type()),
                ("from_line", &from_line),
                ("to_line", &to_line),
            ],
        )
        .map_err(|error| {
            map_permission_error("ソースを読み取れません", &error, SOURCE_PERMISSION_HINT)
        })?;

    let mut lines = Vec::new();

    for row in rows {
        let row = row.map_err(|error| {
            DbError::execute(format!("ソースの行を読み取れませんでした: {error}"))
        })?;

        let 読み取れない = |error: oracle::Error| {
            DbError::execute(format!("ソースの行を読み取れませんでした: {error}"))
        };

        lines.push(SourceLine {
            line: row.get::<usize, u32>(0).map_err(読み取れない)?,
            text: row
                .get::<usize, Option<String>>(1)
                .map_err(読み取れない)?
                .unwrap_or_default()
                .trim_end_matches(['\n', '\r'])
                .to_string(),
        });
    }

    Ok(lines)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::source::SOURCE_SEARCH_DEFAULT_LIMIT;

    /// 既定の求めを作る。
    ///
    /// # 引数
    ///
    /// * `needle` - 探す文字列
    fn 求め(needle: &str) -> SourceSearchRequest {
        SourceSearchRequest {
            needle: String::from(needle),
            owner: None,
            kinds: SourceKindFilter::default(),
            case_sensitive: false,
            limit: SOURCE_SEARCH_DEFAULT_LIMIT,
        }
    }

    #[test]
    fn 検索語は前後を挟んだlikeのパターンになる() {
        // Arrange & Act
        let pattern = like_pattern("orders");

        // Assert
        assert_eq!(pattern, "%orders%");
    }

    #[test]
    fn likeの特別な文字は打ち消される() {
        // Arrange: `_` を打ち消さないと user_traits が userXtraits にも当たる
        let pattern = like_pattern("user_traits");

        // Assert
        assert_eq!(pattern, "%user\\_traits%");
    }

    #[test]
    fn 打ち消しの記号自身も打ち消される() {
        // Arrange & Act
        let pattern = like_pattern("a\\_b%c");

        // Assert: `\` を先に置き換えるため、二重に効かない
        assert_eq!(pattern, "%a\\\\\\_b\\%c%");
    }

    #[test]
    fn 有効な種別だけが問い合わせの種別に並ぶ() {
        // Arrange
        let kinds = SourceKindFilter {
            function: false,
            procedure: false,
            package: false,
            r#type: false,
            type_body: false,
            ..SourceKindFilter::default()
        };

        // Act
        let types = listed_source_types(&kinds);

        // Assert
        assert_eq!(types, "'PACKAGE BODY', 'TRIGGER'");
    }

    #[test]
    fn 種別を一つも選ばなければ問い合わせを組み立てない() {
        // Arrange
        let mut request = 求め("orders");
        request.kinds = SourceKindFilter {
            function: false,
            procedure: false,
            package: false,
            package_body: false,
            trigger: false,
            r#type: false,
            type_body: false,
        };

        // Act
        let sql = build_search_sql(&request);

        // Assert
        assert_eq!(sql, None);
    }

    #[test]
    fn 検索語はバインド変数として渡される() {
        // Arrange
        let request = 求め("orders");

        // Act
        let sql = build_search_sql(&request).unwrap();

        // Assert: 検索語そのものは SQL に現れない
        assert!(sql.contains(":needle"));
        assert!(!sql.contains("orders"));
    }

    #[test]
    fn 所有者を選ぶとその条件がバインド変数で加わる() {
        // Arrange
        let mut request = 求め("orders");
        request.owner = Some(String::from("KODUCHI"));

        // Act
        let sql = build_search_sql(&request).unwrap();

        // Assert
        assert!(sql.contains("s.owner = :owner"));
        assert!(!sql.contains("KODUCHI"));
        assert!(!sql.contains("not in"));
    }

    #[test]
    fn 所有者を選ばないとシステムスキーマが外れる() {
        // Arrange: 外さないと SYS の PL/SQL だけで上限が埋まる
        let request = 求め("orders");

        // Act
        let sql = build_search_sql(&request).unwrap();

        // Assert
        assert!(sql.contains("s.owner not in ("));
        assert!(sql.contains("'SYS'"));
        assert!(sql.contains("'SYSTEM'"));
    }

    #[test]
    fn 既定では大文字と小文字を区別しない() {
        // Arrange
        let request = 求め("orders");

        // Act
        let sql = build_search_sql(&request).unwrap();

        // Assert: 両辺を Oracle 側で畳む
        assert!(sql.contains("upper(s.text) like upper(:needle)"));
    }

    #[test]
    fn 区別するときは畳まずに当てる() {
        // Arrange
        let mut request = 求め("orders");
        request.case_sensitive = true;

        // Act
        let sql = build_search_sql(&request).unwrap();

        // Assert
        assert!(sql.contains("s.text like :needle"));
        assert!(!sql.contains("upper(s.text)"));
    }

    #[test]
    fn 上限より一行多く取って打ち切りを見分ける() {
        // Arrange
        let mut request = 求め("orders");
        request.limit = 100;

        // Act
        let sql = build_search_sql(&request).unwrap();

        // Assert
        assert!(sql.contains("rownum <= 101"));
        // 上限を効かせるため並べ替えは付けない（並べ直しは Rust 側で行う）
        assert!(!sql.contains("order by"));
    }

    #[test]
    fn 打ち消しの指定はlikeに付く() {
        // Arrange
        let request = 求め("orders");

        // Act
        let sql = build_search_sql(&request).unwrap();

        // Assert
        assert!(sql.contains("escape '\\'"));
    }

    #[test]
    fn 前後を読む問い合わせは行の範囲をバインド変数で受ける() {
        // Arrange & Act & Assert
        assert!(CONTEXT_SQL.contains(":from_line"));
        assert!(CONTEXT_SQL.contains(":to_line"));
        assert!(CONTEXT_SQL.contains("order by line"));
    }
}
