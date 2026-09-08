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
//!
//! 所有者が `PUBLIC` のオブジェクトは列挙しない。`PUBLIC` は `ALL_USERS` に
//! 載らない擬似的な所有者であり、そこに数万件の公開シノニムがぶら下がる。

use crate::db::error::{DbError, DbResult};
use crate::db::schema::{
    ObjectKind, ObjectKindFilter, SchemaFilter, SchemaNode, SchemaObject, TableColumn,
};
use crate::db::value::CellKind;
use oracle::Connection;
use std::collections::BTreeMap;

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
        .map_err(|error| DbError::execute(format!("スキーマを取得できませんでした: {error}")))?;

    for user in users {
        let name = user.map_err(|error| {
            DbError::execute(format!("スキーマを取得できませんでした: {error}"))
        })?;
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
    if !types.is_empty() {
        let sql = format!(
            "select owner, object_name, object_type from all_objects
             where object_type in ({types}) and owner <> 'PUBLIC'
             order by owner, object_name"
        );

        let objects = connection
            .query_as::<(String, String, String)>(&sql, &[])
            .map_err(|error| {
                DbError::execute(format!("オブジェクトを取得できませんでした: {error}"))
            })?;

        for object in objects {
            let (owner, object_name, object_type) = object.map_err(|error| {
                DbError::execute(format!("オブジェクトを取得できませんでした: {error}"))
            })?;

            let Some(kind) = ObjectKind::from_object_type(&object_type) else {
                continue;
            };

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
            .map_err(|error| DbError::execute(format!("索引を取得できませんでした: {error}")))?;

        for index in indexes {
            let (owner, index_name) = index.map_err(|error| {
                DbError::execute(format!("索引を取得できませんでした: {error}"))
            })?;
            push_object(&mut schemas, owner, index_name, ObjectKind::Index);
        }
    }

    if filter.kinds.database_link {
        let sql = "select owner, db_link from all_db_links
                   where owner <> 'PUBLIC'
                   order by owner, db_link";

        let links = connection
            .query_as::<(String, String)>(sql, &[])
            .map_err(|error| {
                DbError::execute(format!("DB link を取得できませんでした: {error}"))
            })?;

        for link in links {
            let (owner, db_link) = link.map_err(|error| {
                DbError::execute(format!("DB link を取得できませんでした: {error}"))
            })?;
            push_object(&mut schemas, owner, db_link, ObjectKind::DatabaseLink);
        }
    }

    let mut nodes: Vec<SchemaNode> = schemas.into_values().collect();
    for node in &mut nodes {
        sort_objects(&mut node.objects);
    }

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
    schema.objects.push(SchemaObject { name, kind });
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

/// 段階 2。スキーマ 1 つぶんの列情報を取る。
///
/// スキーマごとに分けて呼ぶのは、進捗（`列情報を読み込み中 8/23 スキーマ`）を
/// 出しながら少しずつ流し込むためである。
///
/// # 引数
///
/// * `connection` - 使う接続
/// * `owner` - 対象のスキーマ名
pub fn load_columns(connection: &Connection, owner: &str) -> DbResult<Vec<TableColumn>> {
    let sql = "select table_name, column_name, data_type, char_length,
                      data_precision, data_scale, nullable
               from all_tab_columns
               where owner = :owner
               order by table_name, column_id";

    let rows = connection
        .query_as::<(
            String,
            String,
            String,
            i64,
            Option<i64>,
            Option<i64>,
            String,
        )>(sql, &[&owner])
        .map_err(|error| DbError::execute(format!("列情報を取得できませんでした: {error}")))?;

    let mut columns = Vec::new();

    for row in rows {
        let (object_name, name, data_type, char_length, precision, scale, nullable) = row
            .map_err(|error| DbError::execute(format!("列情報を取得できませんでした: {error}")))?;

        columns.push(TableColumn {
            object_name,
            name,
            type_name: format_column_type(&data_type, char_length, precision, scale),
            nullable: nullable == "Y",
            kind: kind_of_type_name(&data_type),
        });
    }

    Ok(columns)
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
            },
            SchemaObject {
                name: String::from("EVENTS"),
                kind: ObjectKind::Table,
            },
            SchemaObject {
                name: String::from("ORDERS"),
                kind: ObjectKind::Table,
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
}
