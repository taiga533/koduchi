//! Oracle のスキーマ取得（ADR 0007・0014）。
//!
//! 列挙元は `ALL_USERS` である。`ALL_TABLES` の `DISTINCT owner` から列挙すると
//! 常に権限のあるスキーマだけになり、フィルタのチェックボックスが意味を失う。
//!
//! 段階 1 は `ALL_USERS` に加えて次の 3 つのビューを引く。オブジェクトの種類に
//! よって置き場所が違うためである（ADR 0014）。
//!
//! | ビュー          | 取るもの                                                   |
//! | --------------- | ---------------------------------------------------------- |
//! | `ALL_OBJECTS`   | 表・ビュー・マテビュー・トリガー・順序・シノニム・型・関数・手続・パッケージ |
//! | `ALL_INDEXES`   | 索引。自動生成されたものは除く                             |
//! | `ALL_DB_LINKS`  | DB link。`ALL_OBJECTS` の所有者の考え方と噛み合わない       |
//!
//! 段階 2 は `ALL_TAB_COLUMNS` をスキーマ 1 つずつ引く。`ALL_TAB_COLUMNS` は
//! 中規模のデータベースでも 10 万行を超えるため、接続時に一括取得はできない。
//! コメント（`ALL_TAB_COMMENTS` / `ALL_COL_COMMENTS`）も段階 2 で引く（ADR 0043）。
//! 段階 1 は全スキーマぶんを 1 度に取るため、`SYS` の辞書ビューに付いた
//! 数千件のコメントまで拾ってしまう。
//!
//! 所有者が `PUBLIC` のオブジェクトは列挙しない。`PUBLIC` は `ALL_USERS` に
//! 載らない擬似的な所有者であり、そこに数万件の公開シノニムがぶら下がる。

use crate::db::definition::normalize_comment;
use crate::db::error::DbResult;
use crate::db::oracle::errors;
use crate::db::schema::{
    ObjectComment, ObjectKind, ObjectKindFilter, SchemaColumns, SchemaFilter, SchemaNode,
    SchemaObject, TableColumn,
};
use crate::db::value::CellKind;
use oracle::Connection;
use std::collections::{BTreeMap, BTreeSet};

/// `ALL_OBJECTS` から取る種別（ADR 0014）。
///
/// 索引と DB link はここに含めない。索引は `ALL_OBJECTS` だと制約や LOB のために
/// 自動生成された `SYS_C0012345` まで並んでしまい、DB link はそもそも
/// `ALL_OBJECTS` の所有者の考え方と噛み合わない。どちらも専用のビューから取る。
const OBJECT_VIEW_KINDS: [ObjectKind; 10] = [
    ObjectKind::Table,
    ObjectKind::View,
    ObjectKind::MaterializedView,
    ObjectKind::Trigger,
    ObjectKind::Sequence,
    ObjectKind::Synonym,
    ObjectKind::Type,
    ObjectKind::Function,
    ObjectKind::Procedure,
    ObjectKind::Package,
];

/// Oracle が内蔵するスキーマの名前。
///
/// 「システムスキーマを除外」が見るリストである。網羅ではなく、既定で ON の
/// フィルタとして実用に足りる範囲を並べてある。
pub const SYSTEM_SCHEMAS: [&str; 33] = [
    "ANONYMOUS",
    "APPQOSSYS",
    "AUDSYS",
    "CTXSYS",
    "DBSFWUSER",
    "DBSNMP",
    "DIP",
    "DVF",
    "DVSYS",
    "GGSYS",
    "GSMADMIN_INTERNAL",
    "GSMCATUSER",
    "GSMROOTUSER",
    "GSMUSER",
    "LBACSYS",
    "MDDATA",
    "MDSYS",
    "OJVMSYS",
    "OLAPSYS",
    "ORACLE_OCM",
    "ORDDATA",
    "ORDPLUGINS",
    "ORDSYS",
    "OUTLN",
    "REMOTE_SCHEDULER_AGENT",
    "SI_INFORMTN_SCHEMA",
    "SYS",
    "SYS$UMF",
    "SYSBACKUP",
    "SYSDG",
    "SYSKM",
    "SYSRAC",
    "SYSTEM",
];

/// 内蔵スキーマに使われる名前の接頭辞。
///
/// APEX とマルチテナントの共通ユーザーは版によって名前に番号が付くため、
/// 完全一致のリストでは追いつかない。
const SYSTEM_SCHEMA_PREFIXES: [&str; 5] = ["APEX_", "FLOWS_", "C##", "XDB", "WMSYS"];

/// システムスキーマかどうかを判定する。
///
/// # 引数
///
/// * `name` - スキーマ名
pub fn is_system_schema(name: &str) -> bool {
    let upper = name.to_uppercase();
    SYSTEM_SCHEMAS.contains(&upper.as_str())
        || SYSTEM_SCHEMA_PREFIXES
            .iter()
            .any(|prefix| upper.starts_with(prefix))
}

/// フィルタを当てる。
///
/// 2 つの条件はどちらも「隠す」方向にしか働かない。並び順は変えない。
///
/// # 引数
///
/// * `schemas` - 取得したままのスキーマ
/// * `filter` - 絞り込み条件
pub fn apply_filter(schemas: Vec<SchemaNode>, filter: &SchemaFilter) -> Vec<SchemaNode> {
    schemas
        .into_iter()
        .filter(|schema| !(filter.exclude_system && is_system_schema(&schema.name)))
        .filter(|schema| !(filter.hide_empty && schema.object_count == 0))
        .collect()
}

/// 列の型名を表示用に組み立てる。
///
/// `ALL_TAB_COLUMNS` は型名と桁を別々の列で返すため、`NUMBER(12,2)` の形へ
/// 組み立て直す必要がある。
///
/// # 引数
///
/// * `data_type` - `DATA_TYPE` の値
/// * `char_length` - 文字型の長さ。0 なら桁を付けない
/// * `precision` - `DATA_PRECISION`
/// * `scale` - `DATA_SCALE`
pub fn format_column_type(
    data_type: &str,
    char_length: i64,
    precision: Option<i64>,
    scale: Option<i64>,
) -> String {
    match data_type {
        "VARCHAR2" | "NVARCHAR2" | "CHAR" | "NCHAR" | "RAW" => {
            if char_length > 0 {
                format!("{data_type}({char_length})")
            } else {
                data_type.to_string()
            }
        }
        "NUMBER" => match (precision, scale) {
            (Some(precision), Some(0)) => format!("NUMBER({precision})"),
            (Some(precision), Some(scale)) => format!("NUMBER({precision},{scale})"),
            (Some(precision), None) => format!("NUMBER({precision})"),
            _ => String::from("NUMBER"),
        },
        _ => data_type.to_string(),
    }
}

/// 型名からセルの種類を求める。
///
/// 結果テーブルの右寄せ判定と同じ区分にそろえる。`convert::kind_of` は
/// `OracleType` を受け取るが、`ALL_TAB_COLUMNS` からは型名しか得られない。
///
/// # 引数
///
/// * `data_type` - `DATA_TYPE` の値
pub fn kind_of_type_name(data_type: &str) -> CellKind {
    if data_type.starts_with("TIMESTAMP") || data_type.starts_with("INTERVAL") {
        return CellKind::Datetime;
    }

    match data_type {
        "NUMBER" | "FLOAT" | "BINARY_FLOAT" | "BINARY_DOUBLE" => CellKind::Number,
        "DATE" => CellKind::Datetime,
        "BLOB" | "RAW" | "LONG RAW" | "BFILE" => CellKind::Binary,
        _ => CellKind::Text,
    }
}

/// 段階 1。スキーマ名・オブジェクト数・オブジェクト名を取る。
///
/// `ALL_USERS` で全スキーマを並べ、`ALL_OBJECTS` / `ALL_INDEXES` /
/// `ALL_DB_LINKS` で参照可能なオブジェクトを数と名前の両方に使う。種別の
/// 絞り込みは問い合わせの段で当て、隠す種別は取りにいかない（ADR 0014）。
/// スキーマの絞り込みは取得後に当てる。
///
/// # 引数
///
/// * `connection` - 使う接続
/// * `filter` - 絞り込み条件
pub fn load_overview(connection: &Connection, filter: &SchemaFilter) -> DbResult<Vec<SchemaNode>> {
    let mut schemas: BTreeMap<String, SchemaNode> = BTreeMap::new();

    let users = connection
        .query_as::<String>("select username from all_users order by username", &[])
        .map_err(|error| errors::map_execute_error("スキーマを取得できませんでした", &error))?;

    for user in users {
        let name = user
            .map_err(|error| errors::map_execute_error("スキーマを取得できませんでした", &error))?;
        schemas.insert(
            name.clone(),
            SchemaNode {
                name,
                object_count: 0,
                objects: Vec::new(),
            },
        );
    }

    let types = listed_object_types(&filter.kinds);
    // 無効なオブジェクトの印（ADR 0045）。本体の行は印のためだけに取る。
    let mut invalid = BTreeSet::new();
    if !types.is_empty() {
        let listed = object_type_condition(&types);
        let sql = format!(
            "select owner, object_name, object_type, status from all_objects
             where {listed} and owner <> 'PUBLIC'
             order by owner, object_name"
        );

        let objects = connection
            .query_as::<(String, String, String, String)>(&sql, &[])
            .map_err(|error| {
                errors::map_execute_error("オブジェクトを取得できませんでした", &error)
            })?;

        for object in objects {
            let (owner, object_name, object_type, status) = object.map_err(|error| {
                errors::map_execute_error("オブジェクトを取得できませんでした", &error)
            })?;

            if let Some(kind) = body_owner_kind(&object_type) {
                if status == "INVALID" {
                    invalid.insert((owner, object_name, kind));
                }
                continue;
            }

            let Some(kind) = ObjectKind::from_object_type(&object_type) else {
                continue;
            };

            if status == "INVALID" {
                invalid.insert((owner.clone(), object_name.clone(), kind));
            }
            push_object(&mut schemas, owner, object_name, kind);
        }
    }

    if filter.kinds.index {
        // 制約や LOB のために自動生成された索引（`SYS_C0012345` など）は名前が
        // 利用者の付けたものではなく、ツリーに並べても読めない。
        let sql = "select owner, index_name from all_indexes
                   where generated = 'N'
                   order by owner, index_name";

        let indexes = connection
            .query_as::<(String, String)>(sql, &[])
            .map_err(|error| errors::map_execute_error("索引を取得できませんでした", &error))?;

        for index in indexes {
            let (owner, index_name) = index
                .map_err(|error| errors::map_execute_error("索引を取得できませんでした", &error))?;
            push_object(&mut schemas, owner, index_name, ObjectKind::Index);
        }
    }

    if filter.kinds.database_link {
        let sql = "select owner, db_link from all_db_links
                   where owner <> 'PUBLIC'
                   order by owner, db_link";

        let links = connection
            .query_as::<(String, String)>(sql, &[])
            .map_err(|error| errors::map_execute_error("DB link を取得できませんでした", &error))?;

        for link in links {
            let (owner, db_link) = link.map_err(|error| {
                errors::map_execute_error("DB link を取得できませんでした", &error)
            })?;
            push_object(&mut schemas, owner, db_link, ObjectKind::DatabaseLink);
        }
    }

    let mut nodes: Vec<SchemaNode> = schemas.into_values().collect();
    for node in &mut nodes {
        sort_objects(&mut node.objects);
    }
    mark_invalid(&mut nodes, &invalid);

    Ok(apply_filter(nodes, filter))
}

/// 取ってきたオブジェクト 1 件をスキーマへ足す。
///
/// 列挙元が 3 つに分かれるため、足す手順だけを切り出してある。
///
/// # 引数
///
/// * `schemas` - 組み立て中のスキーマの表
/// * `owner` - 所有者のスキーマ名
/// * `name` - オブジェクト名
/// * `kind` - オブジェクトの種類
fn push_object(
    schemas: &mut BTreeMap<String, SchemaNode>,
    owner: String,
    name: String,
    kind: ObjectKind,
) {
    // `ALL_USERS` に無い所有者は通常あり得ないが、あれば節点を足しておく。
    let schema = schemas.entry(owner.clone()).or_insert_with(|| SchemaNode {
        name: owner,
        object_count: 0,
        objects: Vec::new(),
    });

    schema.object_count += 1;
    schema.objects.push(SchemaObject {
        name,
        kind,
        invalid: false,
    });
}

/// スキーマ 1 つぶんのオブジェクトを名前順に並べ直す。
///
/// 列挙元が 3 つに分かれた結果、ビューごとにかたまって並ぶ。名前が同じ別種別
/// （表と同名の索引など）もありうるため、種別を第 2 の鍵にして安定させる。
///
/// # 引数
///
/// * `objects` - 並べ直すオブジェクト
pub fn sort_objects(objects: &mut [SchemaObject]) {
    objects.sort_by(|left, right| left.name.cmp(&right.name).then(left.kind.cmp(&right.kind)));
}

/// フィルタが有効にしている `ALL_OBJECTS.OBJECT_TYPE` の並びを組み立てる。
///
/// `in (...)` の中身をそのまま返す。有効な種別が 1 つも無ければ空文字列を
/// 返し、呼び出し側は問い合わせそのものを飛ばす。
///
/// # 引数
///
/// * `kinds` - 種別ごとの表示可否
pub fn listed_object_types(kinds: &ObjectKindFilter) -> String {
    OBJECT_VIEW_KINDS
        .iter()
        .filter(|kind| kinds.allows(**kind))
        .map(|kind| format!("'{}'", kind.object_type()))
        .collect::<Vec<String>>()
        .join(",")
}

/// 段階 1 の `ALL_OBJECTS` を絞る条件を組み立てる（ADR 0045）。
///
/// 載せる種別に加え、**無効な**本体（`PACKAGE BODY` / `TYPE BODY`）だけを取る。
/// 本体はツリーに行として出さない（`ObjectKind::from_object_type`）が、仕様が有効の
/// まま本体だけが壊れるのが PL/SQL を書いている最中のいちばんよくある形であり、
/// 印のためには本体の状態が要る。有効な本体まで取ると、システムスキーマの数千件が
/// クライアント側の絞り込み（`exclude_system`）の手前まで流れてくる。
/// 別の問い合わせにせず同じ往復で取る。
///
/// # 引数
///
/// * `types` - `listed_object_types` が組み立てた並び。空でないこと
fn object_type_condition(types: &str) -> String {
    let bodies: Vec<&str> = [("'PACKAGE'", "'PACKAGE BODY'"), ("'TYPE'", "'TYPE BODY'")]
        .into_iter()
        .filter(|(spec, _)| types.split(',').any(|listed| listed == *spec))
        .map(|(_, body)| body)
        .collect();

    if bodies.is_empty() {
        return format!("object_type in ({types})");
    }

    format!(
        "(object_type in ({types}) or (object_type in ({}) and status = 'INVALID'))",
        bodies.join(",")
    )
}

/// 本体の種別名なら、印を付ける先（仕様）の種別を返す（ADR 0045）。
///
/// # 引数
///
/// * `raw` - `ALL_OBJECTS.OBJECT_TYPE` の値
fn body_owner_kind(raw: &str) -> Option<ObjectKind> {
    match raw {
        "PACKAGE BODY" => Some(ObjectKind::Package),
        "TYPE BODY" => Some(ObjectKind::Type),
        _ => None,
    }
}

/// 無効と分かったオブジェクトに印を立てる（ADR 0045）。
///
/// 本体の行は仕様の行より後に届くとは限らないため、読み終えてからまとめて当てる。
///
/// # 引数
///
/// * `nodes` - 組み立て終えたスキーマ
/// * `invalid` - 無効なオブジェクトの `(所有者, 名前, 種別)`
pub fn mark_invalid(nodes: &mut [SchemaNode], invalid: &BTreeSet<(String, String, ObjectKind)>) {
    if invalid.is_empty() {
        return;
    }
    for node in nodes {
        for object in &mut node.objects {
            object.invalid =
                invalid.contains(&(node.name.clone(), object.name.clone(), object.kind));
        }
    }
}

/// 段階 2 の列の問い合わせ（ADR 0007）。コメントを読まないとき。
const COLUMNS_SQL: &str = "select table_name, column_name, data_type, char_length,
       data_precision, data_scale, nullable, cast(null as varchar2(1)) comments
  from all_tab_columns
 where owner = :owner
 order by table_name, column_id";

/// 段階 2 の列の問い合わせ。列のコメントを混ぜるとき（ADR 0043）。
///
/// 定義タブ（ADR 0033）と同じく `LEFT JOIN` で混ぜ、往復を増やさない。鍵は
/// `(OWNER, TABLE_NAME, COLUMN_NAME)` の 3 つ揃いである。片方を欠くと列が
/// 重複し、内部結合にするとコメントの無い表で列が丸ごと消える。
const COLUMNS_WITH_COMMENTS_SQL: &str = "select c.table_name, c.column_name, c.data_type,
       c.char_length, c.data_precision, c.data_scale, c.nullable, cc.comments
  from all_tab_columns c
  left join all_col_comments cc
    on cc.owner = c.owner
   and cc.table_name = c.table_name
   and cc.column_name = c.column_name
 where c.owner = :owner
 order by c.table_name, c.column_id";

/// スキーマ 1 つぶんのオブジェクトのコメントを取る問い合わせ（ADR 0043）。
///
/// 列の問い合わせへ混ぜると同じ 4000 文字が列の数だけ返るため、別に引く
/// （ADR 0033 と同じ理由）。コメントの無い表も `ALL_TAB_COMMENTS` には 1 行
/// 載るため、`NULL` をここで落として運ぶ量を減らす。
const OBJECT_COMMENTS_SQL: &str = "select table_name, comments
  from all_tab_comments
 where owner = :owner and comments is not null
 order by table_name";

/// 段階 2 の列の問い合わせを選ぶ。
///
/// コメントを出さない設定では `ALL_COL_COMMENTS` へ行かない（ADR 0043）。
/// 結合は列の数だけ効くため、見ないもののために払わない。
///
/// # 引数
///
/// * `with_comments` - 列のコメントを混ぜるか
pub fn columns_sql(with_comments: bool) -> &'static str {
    if with_comments {
        COLUMNS_WITH_COMMENTS_SQL
    } else {
        COLUMNS_SQL
    }
}

/// 段階 2。スキーマ 1 つぶんの列情報と、要ればコメントを取る。
///
/// スキーマごとに分けて呼ぶのは、進捗（`列情報を読み込み中 8/23 スキーマ`）を
/// 出しながら少しずつ流し込むためである。
///
/// # 引数
///
/// * `connection` - 使う接続
/// * `owner` - 対象のスキーマ名
/// * `with_comments` - 表・ビュー・列のコメントも取るか（ADR 0043）
pub fn load_columns(
    connection: &Connection,
    owner: &str,
    with_comments: bool,
) -> DbResult<SchemaColumns> {
    type Row = (
        String,
        String,
        String,
        i64,
        Option<i64>,
        Option<i64>,
        String,
        Option<String>,
    );

    let rows = connection
        .query_as::<Row>(columns_sql(with_comments), &[&owner])
        .map_err(|error| errors::map_execute_error("列情報を取得できませんでした", &error))?;

    let mut columns = Vec::new();

    for row in rows {
        let (object_name, name, data_type, char_length, precision, scale, nullable, comments) =
            row.map_err(|error| errors::map_execute_error("列情報を取得できませんでした", &error))?;

        columns.push(TableColumn {
            object_name,
            name,
            type_name: format_column_type(&data_type, char_length, precision, scale),
            nullable: nullable == "Y",
            kind: kind_of_type_name(&data_type),
            comment: normalize_comment(comments),
        });
    }

    let object_comments = if with_comments {
        load_object_comments(connection, owner)?
    } else {
        Vec::new()
    };

    Ok(SchemaColumns {
        columns,
        object_comments,
    })
}

/// スキーマ 1 つぶんの表・ビュー・マテビューのコメントを取る（ADR 0043）。
///
/// # 引数
///
/// * `connection` - 使う接続
/// * `owner` - 対象のスキーマ名
fn load_object_comments(connection: &Connection, owner: &str) -> DbResult<Vec<ObjectComment>> {
    let rows = connection
        .query_as::<(String, Option<String>)>(OBJECT_COMMENTS_SQL, &[&owner])
        .map_err(|error| {
            errors::map_execute_error("オブジェクトのコメントを取得できませんでした", &error)
        })?;

    let mut comments = Vec::new();

    for row in rows {
        let (object_name, raw) = row.map_err(|error| {
            errors::map_execute_error("オブジェクトのコメントを取得できませんでした", &error)
        })?;
        // 空白だけのコメントは `is not null` を抜けてくる。
        if let Some(comment) = normalize_comment(raw) {
            comments.push(ObjectComment {
                object_name,
                comment,
            });
        }
    }

    Ok(comments)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn スキーマ(name: &str, object_count: usize) -> SchemaNode {
        SchemaNode {
            name: String::from(name),
            object_count,
            objects: Vec::new(),
        }
    }

    #[test]
    fn 既知のシステムスキーマを見分けられる() {
        // Arrange & Act & Assert
        assert!(is_system_schema("SYS"));
        assert!(is_system_schema("SYSTEM"));
        assert!(is_system_schema("OUTLN"));
    }

    #[test]
    fn 接頭辞で始まるスキーマもシステムスキーマとみなす() {
        // Arrange & Act & Assert
        assert!(is_system_schema("APEX_230200"));
        assert!(is_system_schema("C##CLOUD$SERVICE"));
        assert!(is_system_schema("XDB"));
    }

    #[test]
    fn 利用者のスキーマはシステムスキーマではない() {
        // Arrange & Act & Assert
        assert!(!is_system_schema("KODUCHI"));
        assert!(!is_system_schema("KODUCHI_ANALYTICS"));
    }

    #[test]
    fn システムスキーマの判定は大文字小文字を区別しない() {
        // Arrange
        let name = "sys";

        // Act
        let system = is_system_schema(name);

        // Assert
        assert!(system);
    }

    #[test]
    fn 既定のフィルタはシステムスキーマと空のスキーマを隠す() {
        // Arrange
        let schemas = vec![
            スキーマ("SYS", 900),
            スキーマ("KODUCHI", 8),
            スキーマ("KODUCHI_EMPTY", 0),
        ];

        // Act
        let filtered = apply_filter(schemas, &SchemaFilter::default());

        // Assert
        let names: Vec<&str> = filtered.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["KODUCHI"]);
    }

    #[test]
    fn システムスキーマの除外を外すとsysも並ぶ() {
        // Arrange
        let schemas = vec![スキーマ("SYS", 900), スキーマ("KODUCHI", 8)];
        let filter = SchemaFilter {
            exclude_system: false,
            ..SchemaFilter::default()
        };

        // Act
        let filtered = apply_filter(schemas, &filter);

        // Assert
        assert_eq!(filtered.len(), 2);
    }

    #[test]
    fn 空のスキーマを隠す条件を外すと空のスキーマも並ぶ() {
        // Arrange
        let schemas = vec![スキーマ("KODUCHI", 8), スキーマ("KODUCHI_EMPTY", 0)];
        let filter = SchemaFilter {
            hide_empty: false,
            ..SchemaFilter::default()
        };

        // Act
        let filtered = apply_filter(schemas, &filter);

        // Assert
        assert_eq!(filtered.len(), 2);
    }

    #[test]
    fn 既定の種別ではall_objectsから取る十種別が並ぶ() {
        // Arrange
        let kinds = ObjectKindFilter::default();

        // Act
        let types = listed_object_types(&kinds);

        // Assert: 索引と DB link は別のビューから取るため入らない
        assert_eq!(
            types,
            "'TABLE','VIEW','MATERIALIZED VIEW','TRIGGER','SEQUENCE','SYNONYM','TYPE','FUNCTION','PROCEDURE','PACKAGE'"
        );
    }

    #[test]
    fn all_objectsから取る種別は索引とdb_link以外のすべてである() {
        // Arrange: 種別を足したとき列挙元の割り当てを忘れないための歯止め
        let kinds = ObjectKindFilter::default();

        // Act
        let types = listed_object_types(&kinds);

        // Assert
        for kind in [
            ObjectKind::Table,
            ObjectKind::View,
            ObjectKind::MaterializedView,
            ObjectKind::Trigger,
            ObjectKind::Sequence,
            ObjectKind::Synonym,
            ObjectKind::Type,
            ObjectKind::Function,
            ObjectKind::Procedure,
            ObjectKind::Package,
        ] {
            assert!(
                types.contains(&format!("'{}'", kind.object_type())),
                "{:?} が ALL_OBJECTS の問い合わせから漏れている",
                kind
            );
        }
        assert!(!types.contains("'INDEX'"));
        assert!(!types.contains("'DATABASE LINK'"));
    }

    #[test]
    fn 落とした種別は問い合わせの並びから消える() {
        // Arrange
        let kinds = ObjectKindFilter {
            synonym: false,
            r#type: false,
            trigger: false,
            ..ObjectKindFilter::default()
        };

        // Act
        let types = listed_object_types(&kinds);

        // Assert
        assert!(!types.contains("SYNONYM"));
        assert!(!types.contains("'TYPE'"));
        assert!(!types.contains("TRIGGER"));
        assert!(types.contains("'TABLE'"));
    }

    #[test]
    fn 索引とdb_linkだけを残すとall_objectsは引かずに済む() {
        // Arrange: 索引と DB link は `ALL_OBJECTS` から取らない
        let kinds = ObjectKindFilter {
            table: false,
            view: false,
            materialized_view: false,
            trigger: false,
            sequence: false,
            synonym: false,
            r#type: false,
            function: false,
            procedure: false,
            package: false,
            index: true,
            database_link: true,
        };

        // Act
        let types = listed_object_types(&kinds);

        // Assert
        assert_eq!(types, "");
    }

    #[test]
    fn オブジェクトは名前順に並び同名は種別順になる() {
        // Arrange
        let mut objects = vec![
            SchemaObject {
                name: String::from("ORDERS"),
                kind: ObjectKind::Index,
                invalid: false,
            },
            SchemaObject {
                name: String::from("EVENTS"),
                kind: ObjectKind::Table,
                invalid: false,
            },
            SchemaObject {
                name: String::from("ORDERS"),
                kind: ObjectKind::Table,
                invalid: false,
            },
        ];

        // Act
        sort_objects(&mut objects);

        // Assert
        let 並び: Vec<(&str, ObjectKind)> = objects
            .iter()
            .map(|object| (object.name.as_str(), object.kind))
            .collect();
        assert_eq!(
            並び,
            vec![
                ("EVENTS", ObjectKind::Table),
                ("ORDERS", ObjectKind::Table),
                ("ORDERS", ObjectKind::Index),
            ]
        );
    }

    #[test]
    fn コメントを出さない設定では列のコメントを引きにいかない() {
        // Arrange & Act
        let sql = columns_sql(false);

        // Assert
        assert!(!sql.contains("all_col_comments"));
    }

    #[test]
    fn 列のコメントは3つ揃いの鍵で外部結合する() {
        // Arrange & Act
        let sql = columns_sql(true);

        // Assert: 内部結合にするとコメントの無い表で列が消える
        assert!(sql.contains("left join all_col_comments"));
        assert!(sql.contains("cc.owner = c.owner"));
        assert!(sql.contains("cc.table_name = c.table_name"));
        assert!(sql.contains("cc.column_name = c.column_name"));
    }

    #[test]
    fn 列の問い合わせはコメントの有無で列の並びが変わらない() {
        // Arrange: 同じ型の行として読むため、選ぶ列の数を揃えておく
        let count = |sql: &str| {
            let select = &sql[..sql.find("from").unwrap()];
            select.matches(',').count()
        };

        // Act & Assert
        assert_eq!(count(columns_sql(false)), count(columns_sql(true)));
    }

    #[test]
    fn オブジェクトのコメントはコメントの付いたものだけを引く() {
        // Arrange & Act & Assert
        assert!(OBJECT_COMMENTS_SQL.contains("all_tab_comments"));
        assert!(OBJECT_COMMENTS_SQL.contains("comments is not null"));
    }

    #[test]
    fn 文字型は長さ付きの型名になる() {
        // Arrange & Act
        let type_name = format_column_type("VARCHAR2", 120, None, None);

        // Assert
        assert_eq!(type_name, "VARCHAR2(120)");
    }

    #[test]
    fn 精度と位取りを持つ数値は両方付いた型名になる() {
        // Arrange & Act
        let type_name = format_column_type("NUMBER", 0, Some(12), Some(2));

        // Assert
        assert_eq!(type_name, "NUMBER(12,2)");
    }

    #[test]
    fn 位取りが零の数値は精度だけの型名になる() {
        // Arrange & Act
        let type_name = format_column_type("NUMBER", 0, Some(10), Some(0));

        // Assert
        assert_eq!(type_name, "NUMBER(10)");
    }

    #[test]
    fn 精度を持たない数値は桁の付かない型名になる() {
        // Arrange & Act
        let type_name = format_column_type("NUMBER", 0, None, None);

        // Assert
        assert_eq!(type_name, "NUMBER");
    }

    #[test]
    fn 日付や大きな値の型は型名がそのまま出る() {
        // Arrange & Act & Assert
        assert_eq!(format_column_type("DATE", 0, None, None), "DATE");
        assert_eq!(format_column_type("CLOB", 0, None, None), "CLOB");
    }

    #[test]
    fn 型名から右寄せに使う種類を求められる() {
        // Arrange & Act & Assert
        assert_eq!(kind_of_type_name("NUMBER"), CellKind::Number);
        assert_eq!(kind_of_type_name("VARCHAR2"), CellKind::Text);
        assert_eq!(kind_of_type_name("DATE"), CellKind::Datetime);
        assert_eq!(
            kind_of_type_name("TIMESTAMP(6) WITH TIME ZONE"),
            CellKind::Datetime
        );
        assert_eq!(kind_of_type_name("BLOB"), CellKind::Binary);
    }

    #[test]
    fn パッケージと型を載せるときは無効な本体だけを取りにいく() {
        // Arrange
        let types = "'TABLE','TYPE','PACKAGE'";

        // Act
        let condition = object_type_condition(types);

        // Assert
        assert_eq!(
            condition,
            "(object_type in ('TABLE','TYPE','PACKAGE') or (object_type in ('PACKAGE BODY','TYPE BODY') and status = 'INVALID'))"
        );
    }

    #[test]
    fn パッケージを落としたときは本体も取りにいかない() {
        // Arrange: 落とした種別は問い合わせにも行かない（ADR 0014）
        let types = "'TABLE','PROCEDURE'";

        // Act
        let condition = object_type_condition(types);

        // Assert
        assert_eq!(condition, "object_type in ('TABLE','PROCEDURE')");
    }

    #[test]
    fn 本体の種別は仕様の種別へ写る() {
        // Arrange & Act & Assert
        assert_eq!(body_owner_kind("PACKAGE BODY"), Some(ObjectKind::Package));
        assert_eq!(body_owner_kind("TYPE BODY"), Some(ObjectKind::Type));
        assert_eq!(body_owner_kind("PACKAGE"), None);
    }

    #[test]
    fn 無効なオブジェクトにだけ印が立つ() {
        // Arrange: 同名でも種別が違えば別のオブジェクトである
        let mut nodes = vec![SchemaNode {
            name: String::from("KODUCHI"),
            object_count: 2,
            objects: vec![
                SchemaObject {
                    name: String::from("BILLING"),
                    kind: ObjectKind::Package,
                    invalid: false,
                },
                SchemaObject {
                    name: String::from("BILLING"),
                    kind: ObjectKind::Table,
                    invalid: false,
                },
            ],
        }];
        let invalid = BTreeSet::from([(
            String::from("KODUCHI"),
            String::from("BILLING"),
            ObjectKind::Package,
        )]);

        // Act
        mark_invalid(&mut nodes, &invalid);

        // Assert
        let 印: Vec<bool> = nodes[0].objects.iter().map(|o| o.invalid).collect();
        assert_eq!(印, vec![true, false]);
    }

    #[test]
    fn 別のスキーマの同名オブジェクトには印が立たない() {
        // Arrange
        let mut nodes = vec![SchemaNode {
            name: String::from("ANALYTICS"),
            object_count: 1,
            objects: vec![SchemaObject {
                name: String::from("BILLING"),
                kind: ObjectKind::Package,
                invalid: false,
            }],
        }];
        let invalid = BTreeSet::from([(
            String::from("KODUCHI"),
            String::from("BILLING"),
            ObjectKind::Package,
        )]);

        // Act
        mark_invalid(&mut nodes, &invalid);

        // Assert
        assert!(!nodes[0].objects[0].invalid);
    }
}
