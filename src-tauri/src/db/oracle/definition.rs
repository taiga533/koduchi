//! Oracle のテーブル定義と DDL の取得（ADR 0019）。
//!
//! 問い合わせは `Connection` を直接使うため、`OracleDriver` が持つ結果セットの
//! カーソル（ADR 0003）には触れない。セッション一覧（ADR 0017）と同じ経路で
//! あり、呼び出し側はプールの `background_handle` で選んだ接続を渡す。
//!
//! # 列挙元
//!
//! | ビュー              | 取るもの                                     |
//! | ------------------- | -------------------------------------------- |
//! | `ALL_TAB_COLUMNS`   | 列。オブジェクト 1 つに絞って引き直す        |
//! | `ALL_COL_COMMENTS`  | 列のコメント。列の問い合わせへ外部結合で混ぜる |
//! | `ALL_TAB_COMMENTS`  | オブジェクトそのもののコメント（1 行）       |
//! | `ALL_CONSTRAINTS`   | 主キー・一意・外部キー・検査制約             |
//! | `ALL_CONS_COLUMNS`  | 制約が掛かっている列と、外部キーの参照先の列 |
//! | `ALL_INDEXES`       | 索引。**自動生成のものも落とさない**         |
//! | `ALL_IND_COLUMNS`   | 索引が並べている列                           |
//!
//! 列を段階 2（ADR 0007）のキャッシュから使い回さないのは、そのスキーマの
//! 読み込みがまだ終わっていない状態で定義ビューを開かれうるためである。
//! 半端な列の一覧を出すくらいなら、1 オブジェクトぶんを引き直すほうが速くて
//! 正しい。
//!
//! # DDL
//!
//! `DBMS_METADATA.GET_DDL` は `CLOB` を返す。素のままでは記憶域の属性
//! （`PCTFREE` / `INITRANS` / `STORAGE(...)` / `TABLESPACE`）が本文の倍近くを
//! 占め、読むための DDL にならない。`SET_TRANSFORM_PARAM` で 4 つを調整する。

use crate::db::definition::{
    assemble_constraints, assemble_indexes, normalize_comment, ConstraintColumnRow, ConstraintKind,
    ConstraintRow, DdlPart, IndexColumnRow, IndexRow, ObjectDdl, ObjectDefinition,
};
use crate::db::error::{DbError, DbResult};
use crate::db::oracle::errors::{map_oracle_error, DDL_PERMISSION_ERRORS};
use crate::db::oracle::schema::{format_column_type, kind_of_type_name};
use crate::db::schema::{ObjectKind, TableColumn};
use oracle::Connection;

/// オブジェクト 1 つぶんの列を、コメントごと取る問い合わせ（ADR 0007・0033）。
///
/// 段階 2（ADR 0007）と同じ列を、テーブル 1 つに絞って読む。**コメントは
/// 別の往復にせず `ALL_COL_COMMENTS` を外部結合して同じ 1 本で取る。**
///
/// 外部結合の鍵 `(OWNER, TABLE_NAME, COLUMN_NAME)` は `ALL_COL_COMMENTS` の
/// 主キーそのものであるため、**列が重複しない。**そして外部結合であるため、
/// **コメントの無い列も落ちない。**内部結合にすると、コメントを 1 つも付けて
/// いない表で列が丸ごと消える。
const COLUMNS_SQL: &str = "select c.column_name, c.data_type, c.char_length,
       c.data_precision, c.data_scale, c.nullable,
       cc.comments
  from all_tab_columns c
  left join all_col_comments cc
    on cc.owner = c.owner
   and cc.table_name = c.table_name
   and cc.column_name = c.column_name
 where c.owner = :owner and c.table_name = :name
 order by c.column_id";

/// オブジェクトそのもののコメントを取る問い合わせ（ADR 0033）。
///
/// 返るのは高々 1 行である。`ALL_TAB_COMMENTS` は表・ビュー・マテリアライズド
/// ビューを載せており、`OWNER` と `TABLE_NAME` が主キーである。コメントを
/// 付けていないオブジェクトも 1 行は載り、`COMMENTS` が `NULL` になる。
const TABLE_COMMENT_SQL: &str = "select comments
  from all_tab_comments
 where owner = :owner and table_name = :name";

/// 制約を取る問い合わせ。
///
/// `SEARCH_CONDITION` は `LONG` であり `oracle` crate では読めない。12c 以降の
/// `SEARCH_CONDITION_VC`（`VARCHAR2(4000)`）を使う。
///
/// 参照先の表は `R_OWNER` / `R_CONSTRAINT_NAME` を `ALL_CONSTRAINTS` へ
/// 外部結合して引く。参照先が見えない（権限が無い）ときは `NULL` になり、
/// その外部キーは参照先を持たないまま並ぶ。
const CONSTRAINTS_SQL: &str = "select c.constraint_name,
       c.constraint_type,
       c.search_condition_vc,
       c.status,
       c.delete_rule,
       r.owner,
       r.table_name
  from all_constraints c
  left join all_constraints r
    on r.owner = c.r_owner
   and r.constraint_name = c.r_constraint_name
 where c.owner = :owner
   and c.table_name = :name
   and c.constraint_type in ('P', 'U', 'R', 'C')
 order by c.constraint_name";

/// 制約が掛かっている列を取る問い合わせ。
const CONSTRAINT_COLUMNS_SQL: &str = "select cc.constraint_name, cc.column_name, cc.position
  from all_cons_columns cc
 where cc.owner = :owner and cc.table_name = :name
 order by cc.constraint_name, cc.position";

/// 外部キーの**参照先**の列を取る問い合わせ。
///
/// 参照先の列は参照先の表にぶら下がるため、`ALL_CONS_COLUMNS` を
/// `R_CONSTRAINT_NAME` 側で引き直す必要がある。
const REFERENCED_COLUMNS_SQL: &str = "select c.constraint_name, rc.column_name, rc.position
  from all_constraints c
  join all_cons_columns rc
    on rc.owner = c.r_owner
   and rc.constraint_name = c.r_constraint_name
 where c.owner = :owner
   and c.table_name = :name
   and c.constraint_type = 'R'
 order by c.constraint_name, rc.position";

/// 索引を取る問い合わせ。
///
/// ツリー（ADR 0014）と違い `GENERATED = 'N'` で絞らない。主キーや一意制約の
/// ために作られた索引が見えないと、「この列で引けるのか」が分からない。
const INDEXES_SQL: &str = "select i.index_name, i.owner, i.uniqueness, i.index_type,
       i.status, i.generated
  from all_indexes i
 where i.table_owner = :owner and i.table_name = :name
 order by i.index_name";

/// 索引が並べている列を取る問い合わせ。
const INDEX_COLUMNS_SQL: &str = "select ic.index_name, ic.column_name,
       ic.column_position, ic.descend
  from all_ind_columns ic
 where ic.table_owner = :owner and ic.table_name = :name
 order by ic.index_name, ic.column_position";

/// `DBMS_METADATA` の整形を読める形へ調整する PL/SQL ブロック（ADR 0019）。
///
/// 4 つを設定する。
///
/// - `SQLTERMINATOR` = 真 … 末尾に `;`（PL/SQL は `/`）を付ける。そのまま
///   エディタへ貼って実行できる形にするためである。
/// - `PRETTY` = 真 … 改行と字下げを入れる。既定でも真だが、明示しておく。
/// - `SEGMENT_ATTRIBUTES` = 偽 … `PCTFREE` / `INITRANS` / `TABLESPACE` を落とす。
/// - `STORAGE` = 偽 … `STORAGE(INITIAL … BUFFER_POOL …)` を落とす。
///
/// 記憶域の属性を落とすのは、読むための DDL だからである。素のままでは本文の
/// 倍近くを占め、列の並びを追うのが難しくなる。**そのまま流せば同じ物理設計が
/// 再現される DDL ではなくなる**が、それが要る場面は移行作業であり、小槌の
/// 定義ビューが担うところではない。
///
/// 設定はセッションに残る（`SESSION_TRANSFORM`）。この接続で GET_DDL を使うのは
/// この経路だけであるため、後始末はしない。
const SET_TRANSFORM_SQL: &str = "begin
  dbms_metadata.set_transform_param(dbms_metadata.session_transform, 'SQLTERMINATOR', true);
  dbms_metadata.set_transform_param(dbms_metadata.session_transform, 'PRETTY', true);
  dbms_metadata.set_transform_param(dbms_metadata.session_transform, 'SEGMENT_ATTRIBUTES', false);
  dbms_metadata.set_transform_param(dbms_metadata.session_transform, 'STORAGE', false);
end;";

/// `DBMS_METADATA.GET_DDL` を 1 回呼ぶ問い合わせ。
const GET_DDL_SQL: &str = "select dbms_metadata.get_ddl(:type, :name, :owner) from dual";

/// GET_DDL が権限で落ちたときに添える案内。
const DDL_PERMISSION_HINT: &str =
    "。この接続には他のスキーマの定義を読む権限がありません（SELECT_CATALOG_ROLE などが要ります）";

/// テーブル定義ビュー 1 枚ぶんの内容を取る（ADR 0019）。
///
/// 列を持たない種別では列も制約も索引も引かない。ビューは列だけを引く。
/// 引かないものを「空だった」として返すのではなく、そもそも問い合わせに
/// 行かない（ADR 0014 の「落とした種別は問い合わせにも行かない」と同じ考え方）。
///
/// # 引数
///
/// * `connection` - 使う接続
/// * `owner` - 所有者のスキーマ名
/// * `name` - オブジェクト名
/// * `kind` - オブジェクトの種類
pub fn load_definition(
    connection: &Connection,
    owner: &str,
    name: &str,
    kind: ObjectKind,
) -> DbResult<ObjectDefinition> {
    // コメントを持ちうるのは `ALL_TAB_COMMENTS` に載る 3 種別、すなわち列を
    // 持つ種別と同じである（ADR 0033）。シーケンスにもシノニムにも索引にも
    // コメントは無く、問い合わせにも行かない。
    let (columns, comment) = if kind.has_columns() {
        (
            load_columns(connection, owner, name)?,
            load_table_comment(connection, owner, name)?,
        )
    } else {
        (Vec::new(), None)
    };

    let (constraints, indexes) = if kind.has_table_details() {
        let constraints = assemble_constraints(
            load_constraint_rows(connection, owner, name)?,
            load_constraint_columns(connection, owner, name)?,
            load_referenced_columns(connection, owner, name)?,
        );
        let indexes = assemble_indexes(
            load_index_rows(connection, owner, name)?,
            load_index_columns(connection, owner, name)?,
        );
        (constraints, indexes)
    } else {
        (Vec::new(), Vec::new())
    };

    Ok(ObjectDefinition {
        owner: owner.to_string(),
        name: name.to_string(),
        kind,
        comment,
        columns,
        constraints,
        indexes,
    })
}

/// オブジェクトそのもののコメントを取る（ADR 0033）。
///
/// 行が 1 つも無い（`ALL_TAB_COMMENTS` に載らない種別を渡した）ときは `None` を
/// 返す。コメントを付けていないときも `None` である。どちらも画面では
/// 「コメントが無い」として同じ扱いになる。
///
/// **読めなかったときは列と同じく失敗させる。** `ALL_TAB_COMMENTS` は
/// `ALL_TAB_COLUMNS` と同じく PUBLIC へ与えられた辞書ビューであり、見え方は
/// 対象オブジェクトへの権限で決まる。列が読めてコメントだけが読めない状況は
/// 無い。`DBMS_METADATA.GET_DDL`（ADR 0019）がロールを要求するのとは事情が
/// 違うため、別のコマンドには分けていない。
///
/// # 引数
///
/// * `connection` - 使う接続
/// * `owner` - 所有者のスキーマ名
/// * `name` - オブジェクト名
fn load_table_comment(
    connection: &Connection,
    owner: &str,
    name: &str,
) -> DbResult<Option<String>> {
    let mut rows = connection
        .query_as::<Option<String>>(TABLE_COMMENT_SQL, &[&owner, &name])
        .map_err(|error| {
            DbError::execute(format!(
                "オブジェクトのコメントを取得できませんでした: {error}"
            ))
        })?;

    let Some(row) = rows.next() else {
        return Ok(None);
    };
    let comments = row.map_err(|error| {
        DbError::execute(format!(
            "オブジェクトのコメントを取得できませんでした: {error}"
        ))
    })?;

    Ok(normalize_comment(comments))
}

/// オブジェクト 1 つぶんの列を取る。
///
/// # 引数
///
/// * `connection` - 使う接続
/// * `owner` - 所有者のスキーマ名
/// * `name` - オブジェクト名
fn load_columns(connection: &Connection, owner: &str, name: &str) -> DbResult<Vec<TableColumn>> {
    type Row = (
        String,
        String,
        i64,
        Option<i64>,
        Option<i64>,
        String,
        Option<String>,
    );

    let rows = connection
        .query_as::<Row>(COLUMNS_SQL, &[&owner, &name])
        .map_err(|error| DbError::execute(format!("列情報を取得できませんでした: {error}")))?;

    let mut columns = Vec::new();

    for row in rows {
        let (column_name, data_type, char_length, precision, scale, nullable, comments) = row
            .map_err(|error| DbError::execute(format!("列情報を取得できませんでした: {error}")))?;

        columns.push(TableColumn {
            object_name: name.to_string(),
            name: column_name,
            type_name: format_column_type(&data_type, char_length, precision, scale),
            nullable: nullable == "Y",
            kind: kind_of_type_name(&data_type),
            comment: normalize_comment(comments),
        });
    }

    Ok(columns)
}

/// 制約の行を取る。
///
/// # 引数
///
/// * `connection` - 使う接続
/// * `owner` - 所有者のスキーマ名
/// * `name` - テーブル名
fn load_constraint_rows(
    connection: &Connection,
    owner: &str,
    name: &str,
) -> DbResult<Vec<ConstraintRow>> {
    type Row = (
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    );

    let rows = connection
        .query_as::<Row>(CONSTRAINTS_SQL, &[&owner, &name])
        .map_err(|error| DbError::execute(format!("制約を取得できませんでした: {error}")))?;

    let mut constraints = Vec::new();

    for row in rows {
        let (
            constraint_name,
            constraint_type,
            search_condition,
            status,
            delete_rule,
            referenced_owner,
            referenced_table,
        ) =
            row.map_err(|error| DbError::execute(format!("制約を取得できませんでした: {error}")))?;

        let Some(kind) = ConstraintKind::from_constraint_type(&constraint_type) else {
            continue;
        };

        constraints.push(ConstraintRow {
            name: constraint_name,
            kind,
            search_condition,
            referenced_owner,
            referenced_table,
            delete_rule,
            // `STATUS` は `ENABLED` / `DISABLED` のどちらかである。
            enabled: status.as_deref() != Some("DISABLED"),
        });
    }

    Ok(constraints)
}

/// 制約が掛かっている列を取る。
///
/// # 引数
///
/// * `connection` - 使う接続
/// * `owner` - 所有者のスキーマ名
/// * `name` - テーブル名
fn load_constraint_columns(
    connection: &Connection,
    owner: &str,
    name: &str,
) -> DbResult<Vec<ConstraintColumnRow>> {
    読み取る(connection, CONSTRAINT_COLUMNS_SQL, owner, name, "制約の列")
}

/// 外部キーの参照先の列を取る。
///
/// # 引数
///
/// * `connection` - 使う接続
/// * `owner` - 所有者のスキーマ名
/// * `name` - テーブル名
fn load_referenced_columns(
    connection: &Connection,
    owner: &str,
    name: &str,
) -> DbResult<Vec<ConstraintColumnRow>> {
    読み取る(
        connection,
        REFERENCED_COLUMNS_SQL,
        owner,
        name,
        "外部キーの参照先",
    )
}

/// 制約名・列名・位置の 3 つ組を読む。
///
/// 制約の列と参照先の列は形が同じであるため、問い合わせだけを差し替える。
///
/// **`ALL_CONS_COLUMNS.POSITION` は `NULL` になりうる。** 検査制約と
/// `NOT NULL` 制約では列の並び順に意味が無いためである。`NULL` は 0 として
/// 読む。この 2 つはどちらも列を 1 つしか持たず、並べ替えの結果は変わらない。
///
/// # 引数
///
/// * `connection` - 使う接続
/// * `sql` - 実行する問い合わせ
/// * `owner` - 所有者のスキーマ名
/// * `name` - テーブル名
/// * `何を` - エラーメッセージに出す対象の名前
fn 読み取る(
    connection: &Connection,
    sql: &str,
    owner: &str,
    name: &str,
    何を: &str,
) -> DbResult<Vec<ConstraintColumnRow>> {
    let rows = connection
        .query_as::<(String, String, Option<i64>)>(sql, &[&owner, &name])
        .map_err(|error| DbError::execute(format!("{何を}を取得できませんでした: {error}")))?;

    let mut columns = Vec::new();

    for row in rows {
        let (constraint_name, column_name, position) = row
            .map_err(|error| DbError::execute(format!("{何を}を取得できませんでした: {error}")))?;

        columns.push(ConstraintColumnRow {
            constraint_name,
            column_name,
            position: position.unwrap_or(0),
        });
    }

    Ok(columns)
}

/// 索引の行を取る。
///
/// # 引数
///
/// * `connection` - 使う接続
/// * `owner` - 所有者のスキーマ名
/// * `name` - テーブル名
fn load_index_rows(connection: &Connection, owner: &str, name: &str) -> DbResult<Vec<IndexRow>> {
    type Row = (String, String, String, String, Option<String>, String);

    let rows = connection
        .query_as::<Row>(INDEXES_SQL, &[&owner, &name])
        .map_err(|error| DbError::execute(format!("索引を取得できませんでした: {error}")))?;

    let mut indexes = Vec::new();

    for row in rows {
        let (index_name, index_owner, uniqueness, index_type, status, generated) =
            row.map_err(|error| DbError::execute(format!("索引を取得できませんでした: {error}")))?;

        indexes.push(IndexRow {
            name: index_name,
            owner: index_owner,
            unique: uniqueness == "UNIQUE",
            index_type,
            status,
            generated: generated == "Y",
        });
    }

    Ok(indexes)
}

/// 索引が並べている列を取る。
///
/// # 引数
///
/// * `connection` - 使う接続
/// * `owner` - 所有者のスキーマ名
/// * `name` - テーブル名
fn load_index_columns(
    connection: &Connection,
    owner: &str,
    name: &str,
) -> DbResult<Vec<IndexColumnRow>> {
    let rows = connection
        .query_as::<(String, String, i64, Option<String>)>(INDEX_COLUMNS_SQL, &[&owner, &name])
        .map_err(|error| DbError::execute(format!("索引の列を取得できませんでした: {error}")))?;

    let mut columns = Vec::new();

    for row in rows {
        let (index_name, column_name, position, descend) = row.map_err(|error| {
            DbError::execute(format!("索引の列を取得できませんでした: {error}"))
        })?;

        columns.push(IndexColumnRow {
            index_name,
            column_name,
            position,
            descending: descend.as_deref() == Some("DESC"),
        });
    }

    Ok(columns)
}

/// `DBMS_METADATA` の整形を読める形へ調整する（ADR 0019）。
///
/// 失敗しても DDL そのものは取れるため、エラーにはしない。整形が既定のままに
/// なるだけである。
///
/// # 引数
///
/// * `connection` - 使う接続
fn set_transform_params(connection: &Connection) {
    let _ = connection.execute(SET_TRANSFORM_SQL, &[]);
}

/// オブジェクト 1 つの DDL を取る（ADR 0019）。
///
/// パッケージは仕様と本体の 2 つを取る。`GET_DDL('PACKAGE', …)` は仕様しか
/// 返さないためである。本体が無いパッケージ（仕様だけを作った状態）でも
/// 落とさず、仕様だけを返す。
///
/// 権限で落ちたときは `DbErrorKind::Permission` を返す。「定義が空だった」と
/// 混同させないためである。
///
/// # 引数
///
/// * `connection` - 使う接続
/// * `owner` - 所有者のスキーマ名
/// * `name` - オブジェクト名
/// * `kind` - オブジェクトの種類
pub fn load_ddl(
    connection: &Connection,
    owner: &str,
    name: &str,
    kind: ObjectKind,
) -> DbResult<ObjectDdl> {
    set_transform_params(connection);

    let mut parts = vec![DdlPart {
        label: String::from(kind.ddl_label()),
        sql: get_ddl(connection, kind.ddl_object_type(), owner, name)?,
    }];

    if let Some(body_type) = kind.ddl_body_type() {
        // 本体はまだ作られていないことがある。仕様まで失わせない。
        if let Ok(sql) = get_ddl(connection, body_type, owner, name) {
            parts.push(DdlPart {
                label: String::from("パッケージ本体"),
                sql,
            });
        }
    }

    Ok(ObjectDdl {
        owner: owner.to_string(),
        name: name.to_string(),
        kind,
        parts,
    })
}

/// `DBMS_METADATA.GET_DDL` を 1 回呼ぶ。
///
/// 返るのは `CLOB` だが、`oracle` crate は既定で `String` として取り出す。
/// 結果テーブルのような 64KB の切り詰め（ADR の「値の受け渡し」節）は行わない。
/// 定義は途中で切れていては用を成さないためである。
///
/// # 引数
///
/// * `connection` - 使う接続
/// * `object_type` - `DBMS_METADATA` の型名
/// * `owner` - 所有者のスキーマ名
/// * `name` - オブジェクト名
fn get_ddl(
    connection: &Connection,
    object_type: &str,
    owner: &str,
    name: &str,
) -> DbResult<String> {
    connection
        .query_row_as::<String>(GET_DDL_SQL, &[&object_type, &name, &owner])
        .map(|ddl| ddl.trim().to_string())
        .map_err(|error| {
            map_oracle_error(
                &format!("{owner}.{name} の定義を取得できません"),
                &error,
                DDL_PERMISSION_HINT,
                &DDL_PERMISSION_ERRORS,
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 整形の設定は記憶域の属性を落とす() {
        // Arrange & Act & Assert: 素のままでは本文の倍近くを占める（ADR 0019）
        assert!(SET_TRANSFORM_SQL.contains("'SEGMENT_ATTRIBUTES', false"));
        assert!(SET_TRANSFORM_SQL.contains("'STORAGE', false"));
    }

    #[test]
    fn 整形の設定は文の区切りと字下げを入れる() {
        // Arrange & Act & Assert: そのままエディタへ貼って実行できる形にする
        assert!(SET_TRANSFORM_SQL.contains("'SQLTERMINATOR', true"));
        assert!(SET_TRANSFORM_SQL.contains("'PRETTY', true"));
    }

    #[test]
    fn 索引の問い合わせは自動生成を落とさない() {
        // Arrange & Act & Assert: ツリー（ADR 0014）とは扱いが違う
        assert!(!INDEXES_SQL.contains("generated = 'N'"));
        assert!(INDEXES_SQL.contains("i.generated"));
    }

    #[test]
    fn 列のコメントは外部結合で取るためコメントの無い列も落ちない() {
        // Arrange & Act & Assert: 内部結合にすると、コメントを 1 つも付けて
        // いない表で列が丸ごと消える（ADR 0033）
        assert!(COLUMNS_SQL.contains("left join all_col_comments"));
        assert!(COLUMNS_SQL.contains("cc.comments"));
    }

    #[test]
    fn 列のコメントの結合は主キーの三つ組で当てる() {
        // Arrange & Act & Assert: 鍵が欠けると列が重複する（ADR 0033）
        assert!(COLUMNS_SQL.contains("cc.owner = c.owner"));
        assert!(COLUMNS_SQL.contains("cc.table_name = c.table_name"));
        assert!(COLUMNS_SQL.contains("cc.column_name = c.column_name"));
    }

    #[test]
    fn 列のコメントは往復を増やさずに取る() {
        // Arrange & Act & Assert: 定義タブを開くたびの往復は 1 本だけ増える
        // （オブジェクトのコメントぶん）。列のコメントは列と同じ 1 本で取る
        assert_eq!(COLUMNS_SQL.matches("from all_tab_columns").count(), 1);
    }

    #[test]
    fn オブジェクトのコメントは名前を束縛変数で渡す() {
        // Arrange & Act & Assert: 名前を文字列で埋め込まない
        assert!(TABLE_COMMENT_SQL.contains("owner = :owner"));
        assert!(TABLE_COMMENT_SQL.contains("table_name = :name"));
        assert!(TABLE_COMMENT_SQL.contains("all_tab_comments"));
    }

    #[test]
    fn 検査条件はlongではない列から読む() {
        // Arrange & Act & Assert: `SEARCH_CONDITION` は LONG で読めない
        assert!(CONSTRAINTS_SQL.contains("search_condition_vc"));
    }
}
