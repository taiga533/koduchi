//! テーブル定義ビューが扱う型（ADR 0019）。
//!
//! データベースに依らない形にしてある。Oracle 固有の列挙元
//! （`ALL_TAB_COLUMNS` / `ALL_CONSTRAINTS` / `ALL_CONS_COLUMNS` /
//! `ALL_INDEXES` / `ALL_IND_COLUMNS`）と `DBMS_METADATA.GET_DDL` の呼び出しは
//! `oracle::definition` に置く。
//!
//! 制約と索引の組み立てをここへ切り出したのは、どちらも「1 行 1 列」で返る
//! 表を「1 行 = 制約 1 つ、列は並び順を持つ」形へ畳み直す作業であり、
//! 境界（列を 1 つも持たない制約・並び順の飛び・参照先を持たない外部キー）が
//! すべてデータの形の問題だからである。データベース抜きで全パターンを試せる
//! 側に置く（ADR 0010）。

use crate::db::schema::{ObjectKind, TableColumn};
use serde::Serialize;
use std::collections::BTreeMap;

/// 制約の種類（ADR 0019）。
///
/// `ALL_CONSTRAINTS.CONSTRAINT_TYPE` の 4 つだけを扱う。`V`（ビューの
/// `WITH CHECK OPTION`）と `O`（ビューの読み取り専用）はテーブルに付かず、
/// 定義ビューで読み手が取る行動も変わらないため落とす。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ConstraintKind {
    PrimaryKey,
    Unique,
    ForeignKey,
    Check,
}

impl ConstraintKind {
    /// `ALL_CONSTRAINTS.CONSTRAINT_TYPE` の 1 文字から変換する。
    ///
    /// 知らない種類は `None` にして落とす。
    ///
    /// # 引数
    ///
    /// * `raw` - `CONSTRAINT_TYPE` の値
    pub fn from_constraint_type(raw: &str) -> Option<Self> {
        match raw {
            "P" => Some(ConstraintKind::PrimaryKey),
            "U" => Some(ConstraintKind::Unique),
            "R" => Some(ConstraintKind::ForeignKey),
            "C" => Some(ConstraintKind::Check),
            _ => None,
        }
    }
}

/// テーブルに付いている制約 1 つ（ADR 0019）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableConstraint {
    pub name: String,
    pub kind: ConstraintKind,
    /// 制約が掛かっている列。`ALL_CONS_COLUMNS.POSITION` の順に並ぶ。
    pub columns: Vec<String>,
    /// 検査制約の条件。`CHECK` 以外では `None`。
    pub search_condition: Option<String>,
    /// 外部キーの参照先スキーマ。
    pub referenced_owner: Option<String>,
    /// 外部キーの参照先テーブル。
    pub referenced_table: Option<String>,
    /// 外部キーの参照先の列。`columns` と同じ順で対応する。
    pub referenced_columns: Vec<String>,
    /// 外部キーの削除規則（`CASCADE` / `SET NULL` / `NO ACTION`）。
    pub delete_rule: Option<String>,
    /// 制約が有効か（`ENABLED`）。
    pub enabled: bool,
}

/// 索引が並べている列 1 つ。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexColumn {
    pub name: String,
    /// 降順の索引列か（`ALL_IND_COLUMNS.DESCEND` が `DESC`）。
    pub descending: bool,
}

/// テーブルに付いている索引 1 つ（ADR 0019）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableIndex {
    pub name: String,
    /// 索引の所有者。表と別のスキーマに作れるため、名前だけでは足りない。
    pub owner: String,
    pub unique: bool,
    /// `NORMAL` / `BITMAP` / `FUNCTION-BASED NORMAL` など。
    pub index_type: String,
    /// `VALID` / `UNUSABLE` など。読めなければ `None`。
    pub status: Option<String>,
    /// 自動生成された索引か（`ALL_INDEXES.GENERATED` が `Y`）。
    ///
    /// ツリー（ADR 0014）では落としているが、定義ビューでは出す。主キーや
    /// 一意制約の索引が見えないと「この列で引けるのか」が分からない。
    pub generated: bool,
    /// 索引が並べている列。`COLUMN_POSITION` の順に並ぶ。
    pub columns: Vec<IndexColumn>,
}

/// テーブル定義ビュー 1 枚ぶんの内容（ADR 0019）。
///
/// DDL は含まない。`DBMS_METADATA.GET_DDL` は重く権限にも敏感であるため、
/// DDL タブを開いたときに別のコマンドで取る。定義ビュー全体が GET_DDL の
/// 権限不足で開けなくなるのを避けるためである。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectDefinition {
    pub owner: String,
    pub name: String,
    pub kind: ObjectKind,
    /// 列。列を持たない種別では空になる。
    pub columns: Vec<TableColumn>,
    /// 制約。テーブルとマテリアライズドビュー以外では空になる。
    pub constraints: Vec<TableConstraint>,
    /// 索引。テーブルとマテリアライズドビュー以外では空になる。
    pub indexes: Vec<TableIndex>,
}

/// `DBMS_METADATA.GET_DDL` で取った定義 1 つ分（ADR 0019）。
///
/// パッケージは仕様と本体で 2 度取るため、1 つのオブジェクトが複数の
/// 断片を持ちうる。`label` はタブの中の見出しに出す。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DdlPart {
    /// 見出し（`パッケージ仕様` など）。
    pub label: String,
    pub sql: String,
}

/// オブジェクト 1 つの DDL（ADR 0019）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectDdl {
    pub owner: String,
    pub name: String,
    pub kind: ObjectKind,
    /// 定義の断片。パッケージだけが 2 つになる。
    pub parts: Vec<DdlPart>,
}

/// `ALL_CONSTRAINTS` から読んだ 1 行（列は別に取る）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConstraintRow {
    pub name: String,
    pub kind: ConstraintKind,
    pub search_condition: Option<String>,
    pub referenced_owner: Option<String>,
    pub referenced_table: Option<String>,
    pub delete_rule: Option<String>,
    pub enabled: bool,
}

/// `ALL_CONS_COLUMNS` から読んだ 1 行。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConstraintColumnRow {
    pub constraint_name: String,
    pub column_name: String,
    /// `POSITION`。値が飛んでいても順序だけを使う。
    pub position: i64,
}

/// `ALL_INDEXES` から読んだ 1 行（列は別に取る）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexRow {
    pub name: String,
    pub owner: String,
    pub unique: bool,
    pub index_type: String,
    pub status: Option<String>,
    pub generated: bool,
}

/// `ALL_IND_COLUMNS` から読んだ 1 行。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexColumnRow {
    pub index_name: String,
    pub column_name: String,
    pub position: i64,
    pub descending: bool,
}

/// 検査制約の条件が `NOT NULL` を言っているだけかを判定する（ADR 0019）。
///
/// Oracle は列に付けた `NOT NULL` を検査制約として持つ。実際のデータベースでは
/// 制約の過半がこれであり、名前も `SYS_C0012345` になる。列の一覧に
/// 「NULL 可」の欄が既にある以上、同じことを 2 度並べても読み手の手掛かりは
/// 増えない。定義ビューでは落とす。
///
/// 判定は条件の綴りで行う。`"COL" IS NOT NULL` の形だけを落とし、
/// `"A" IS NOT NULL AND "B" > 0` のような複合条件は残す。
///
/// # 引数
///
/// * `condition` - `SEARCH_CONDITION_VC` の値
pub fn is_not_null_check(condition: &str) -> bool {
    let trimmed = condition.trim();
    let Some(head) = trimmed.strip_suffix("IS NOT NULL") else {
        // 大文字小文字は Oracle が保存したままであり、通常は大文字である。
        // 念のため畳んでもう一度だけ試す。
        let upper = trimmed.to_uppercase();
        return match upper.strip_suffix("IS NOT NULL") {
            Some(head) => 単一の列名か(head),
            None => false,
        };
    };

    単一の列名か(head)
}

/// `IS NOT NULL` の手前が列名 1 つだけかを判定する。
///
/// 引用符の有無は問わない。空白を除いた残りに空白・演算子・括弧が含まれて
/// いれば、複合条件であると見なして残す。
///
/// # 引数
///
/// * `head` - `IS NOT NULL` を除いた前半
fn 単一の列名か(head: &str) -> bool {
    let name = head.trim().trim_matches('"');

    !name.is_empty() && !name.contains(char::is_whitespace) && !name.contains(['(', ')', ',', '"'])
}

/// 制約の行と列の行から制約の一覧を組み立てる（ADR 0019）。
///
/// 列は `POSITION` の順に並べ直す。`NOT NULL` を言っているだけの検査制約は
/// 落とす。外部キーの参照先の列は別に渡す。
///
/// 並びは種別（主キー → 一意 → 外部キー → 検査）、同じ種別の中は名前順に
/// 揃える。取得元の並びに任せると、`ALL_CONSTRAINTS` の返す順がデータベースの
/// 版や統計で変わる。
///
/// # 引数
///
/// * `rows` - `ALL_CONSTRAINTS` から読んだ行
/// * `columns` - `ALL_CONS_COLUMNS` から読んだ行
/// * `referenced` - 外部キーの参照先の列（制約名ごと）
pub fn assemble_constraints(
    rows: Vec<ConstraintRow>,
    columns: Vec<ConstraintColumnRow>,
    referenced: Vec<ConstraintColumnRow>,
) -> Vec<TableConstraint> {
    let 列の表 = 列を制約ごとに畳む(columns);
    let 参照先の表 = 列を制約ごとに畳む(referenced);

    let mut constraints: Vec<TableConstraint> = rows
        .into_iter()
        .filter(|row| {
            // `NOT NULL` だけの検査制約は落とす。列の一覧が同じことを言っている。
            !(row.kind == ConstraintKind::Check
                && row
                    .search_condition
                    .as_deref()
                    .is_some_and(is_not_null_check))
        })
        .map(|row| TableConstraint {
            columns: 列の表.get(&row.name).cloned().unwrap_or_default(),
            referenced_columns: 参照先の表.get(&row.name).cloned().unwrap_or_default(),
            name: row.name,
            kind: row.kind,
            search_condition: row.search_condition,
            referenced_owner: row.referenced_owner,
            referenced_table: row.referenced_table,
            delete_rule: row.delete_rule,
            enabled: row.enabled,
        })
        .collect();

    constraints.sort_by(|left, right| left.kind.cmp(&right.kind).then(left.name.cmp(&right.name)));
    constraints
}

/// 索引の行と列の行から索引の一覧を組み立てる（ADR 0019）。
///
/// 列は `COLUMN_POSITION` の順に並べ直す。自動生成された索引も落とさない。
/// 主キーの索引が見えないと「この列で引けるのか」が分からないためである
/// （ツリーの扱いとは違う。ADR 0014・0019）。
///
/// 並びは名前順に揃える。
///
/// # 引数
///
/// * `rows` - `ALL_INDEXES` から読んだ行
/// * `columns` - `ALL_IND_COLUMNS` から読んだ行
pub fn assemble_indexes(rows: Vec<IndexRow>, columns: Vec<IndexColumnRow>) -> Vec<TableIndex> {
    let mut 列の表: BTreeMap<String, Vec<(i64, IndexColumn)>> = BTreeMap::new();
    for column in columns {
        列の表.entry(column.index_name).or_default().push((
            column.position,
            IndexColumn {
                name: column.column_name,
                descending: column.descending,
            },
        ));
    }
    for 並び in 列の表.values_mut() {
        並び.sort_by_key(|(position, _)| *position);
    }

    let mut indexes: Vec<TableIndex> = rows
        .into_iter()
        .map(|row| TableIndex {
            columns: 列の表
                .get(&row.name)
                .map(|並び| 並び.iter().map(|(_, column)| column.clone()).collect())
                .unwrap_or_default(),
            name: row.name,
            owner: row.owner,
            unique: row.unique,
            index_type: row.index_type,
            status: row.status,
            generated: row.generated,
        })
        .collect();

    indexes.sort_by(|left, right| left.name.cmp(&right.name));
    indexes
}

/// 制約名ごとに列を `POSITION` の順で畳む。
///
/// `POSITION` は 1 から始まるが、値が飛んでいても順序だけを使う。
///
/// # 引数
///
/// * `columns` - 制約名と列名と位置の組
fn 列を制約ごとに畳む(columns: Vec<ConstraintColumnRow>) -> BTreeMap<String, Vec<String>> {
    let mut 表: BTreeMap<String, Vec<(i64, String)>> = BTreeMap::new();

    for column in columns {
        表.entry(column.constraint_name)
            .or_default()
            .push((column.position, column.column_name));
    }

    表.into_iter()
        .map(|(name, mut 並び)| {
            並び.sort_by_key(|(position, _)| *position);
            (name, 並び.into_iter().map(|(_, name)| name).collect())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn 制約(name: &str, kind: ConstraintKind) -> ConstraintRow {
        ConstraintRow {
            name: String::from(name),
            kind,
            search_condition: None,
            referenced_owner: None,
            referenced_table: None,
            delete_rule: None,
            enabled: true,
        }
    }

    fn 制約の列(constraint: &str, column: &str, position: i64) -> ConstraintColumnRow {
        ConstraintColumnRow {
            constraint_name: String::from(constraint),
            column_name: String::from(column),
            position,
        }
    }

    fn 索引(name: &str) -> IndexRow {
        IndexRow {
            name: String::from(name),
            owner: String::from("KODUCHI"),
            unique: false,
            index_type: String::from("NORMAL"),
            status: Some(String::from("VALID")),
            generated: false,
        }
    }

    fn 索引の列(index: &str, column: &str, position: i64) -> IndexColumnRow {
        IndexColumnRow {
            index_name: String::from(index),
            column_name: String::from(column),
            position,
            descending: false,
        }
    }

    #[test]
    fn 制約の種別は一文字から変換できる() {
        // Arrange & Act & Assert
        assert_eq!(
            ConstraintKind::from_constraint_type("P"),
            Some(ConstraintKind::PrimaryKey)
        );
        assert_eq!(
            ConstraintKind::from_constraint_type("U"),
            Some(ConstraintKind::Unique)
        );
        assert_eq!(
            ConstraintKind::from_constraint_type("R"),
            Some(ConstraintKind::ForeignKey)
        );
        assert_eq!(
            ConstraintKind::from_constraint_type("C"),
            Some(ConstraintKind::Check)
        );
    }

    #[test]
    fn ビューにしか付かない制約の種別は落とす() {
        // Arrange & Act & Assert: `V` は WITH CHECK OPTION、`O` は読み取り専用
        assert_eq!(ConstraintKind::from_constraint_type("V"), None);
        assert_eq!(ConstraintKind::from_constraint_type("O"), None);
    }

    #[test]
    fn not_nullだけの検査条件を見分けられる() {
        // Arrange & Act & Assert
        assert!(is_not_null_check(r#""USER_ID" IS NOT NULL"#));
        assert!(is_not_null_check("USER_ID IS NOT NULL"));
        assert!(is_not_null_check(r#"  "AMOUNT" IS NOT NULL  "#));
    }

    #[test]
    fn 複合した検査条件はnot_nullだけとは見なさない() {
        // Arrange & Act & Assert: 利用者が書いた条件は残す
        assert!(!is_not_null_check(r#""A" IS NOT NULL AND "B" IS NOT NULL"#));
        assert!(!is_not_null_check(r#"status in ('paid','refunded')"#));
        assert!(!is_not_null_check(r#"nvl("A", 0) IS NOT NULL"#));
        assert!(!is_not_null_check(""));
    }

    #[test]
    fn not_nullだけの検査制約は一覧から落ちる() {
        // Arrange: 列の一覧が「NULL 可」を既に出している（ADR 0019）
        let mut not_null = 制約("SYS_C0012345", ConstraintKind::Check);
        not_null.search_condition = Some(String::from(r#""USER_ID" IS NOT NULL"#));
        let mut 利用者の条件 = 制約("CK_ORDERS_STATUS", ConstraintKind::Check);
        利用者の条件.search_condition = Some(String::from("status in ('paid','pending')"));

        // Act
        let constraints =
            assemble_constraints(vec![not_null, 利用者の条件], Vec::new(), Vec::new());

        // Assert
        let names: Vec<&str> = constraints.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec!["CK_ORDERS_STATUS"]);
    }

    #[test]
    fn 制約の列は位置の順に並ぶ() {
        // Arrange: 取得元が返す順は保証されない
        let rows = vec![制約("PK_SHIPMENT_LEGS", ConstraintKind::PrimaryKey)];
        let columns = vec![
            制約の列("PK_SHIPMENT_LEGS", "LEG_NO", 2),
            制約の列("PK_SHIPMENT_LEGS", "SHIPMENT_ID", 1),
        ];

        // Act
        let constraints = assemble_constraints(rows, columns, Vec::new());

        // Assert
        assert_eq!(constraints[0].columns, vec!["SHIPMENT_ID", "LEG_NO"]);
    }

    #[test]
    fn 外部キーは参照先の表と列を持つ() {
        // Arrange
        let mut fk = 制約("FK_SHIPMENT_LEGS_RATE", ConstraintKind::ForeignKey);
        fk.referenced_owner = Some(String::from("KODUCHI"));
        fk.referenced_table = Some(String::from("CARRIER_RATES"));
        fk.delete_rule = Some(String::from("NO ACTION"));
        let columns = vec![
            制約の列("FK_SHIPMENT_LEGS_RATE", "CARRIER", 1),
            制約の列("FK_SHIPMENT_LEGS_RATE", "ZONE", 2),
        ];
        let referenced = vec![
            制約の列("FK_SHIPMENT_LEGS_RATE", "ZONE", 2),
            制約の列("FK_SHIPMENT_LEGS_RATE", "CARRIER", 1),
        ];

        // Act
        let constraints = assemble_constraints(vec![fk], columns, referenced);

        // Assert
        assert_eq!(constraints[0].columns, vec!["CARRIER", "ZONE"]);
        assert_eq!(
            constraints[0].referenced_table.as_deref(),
            Some("CARRIER_RATES")
        );
        assert_eq!(constraints[0].referenced_columns, vec!["CARRIER", "ZONE"]);
    }

    #[test]
    fn 制約は種別ごとに並び同じ種別では名前順になる() {
        // Arrange
        let rows = vec![
            制約("CK_B", ConstraintKind::Check),
            制約("FK_A", ConstraintKind::ForeignKey),
            制約("UQ_A", ConstraintKind::Unique),
            制約("PK_A", ConstraintKind::PrimaryKey),
            制約("CK_A", ConstraintKind::Check),
        ];

        // Act
        let constraints = assemble_constraints(rows, Vec::new(), Vec::new());

        // Assert
        let names: Vec<&str> = constraints.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec!["PK_A", "UQ_A", "FK_A", "CK_A", "CK_B"]);
    }

    #[test]
    fn 列を一つも持たない制約でも落ちない() {
        // Arrange: 検査制約は `ALL_CONS_COLUMNS` に載らないことがある
        let mut check = 制約("CK_ORDERS_STATUS", ConstraintKind::Check);
        check.search_condition = Some(String::from("status in ('paid')"));

        // Act
        let constraints = assemble_constraints(vec![check], Vec::new(), Vec::new());

        // Assert
        assert!(constraints[0].columns.is_empty());
    }

    #[test]
    fn 索引の列は位置の順に並ぶ() {
        // Arrange
        let columns = vec![
            索引の列("IX_SHIPMENTS_ORDER_STATUS", "STATUS", 2),
            索引の列("IX_SHIPMENTS_ORDER_STATUS", "ORDER_ID", 1),
        ];

        // Act
        let indexes = assemble_indexes(vec![索引("IX_SHIPMENTS_ORDER_STATUS")], columns);

        // Assert
        let 並び: Vec<&str> = indexes[0]
            .columns
            .iter()
            .map(|column| column.name.as_str())
            .collect();
        assert_eq!(並び, vec!["ORDER_ID", "STATUS"]);
    }

    #[test]
    fn 降順の索引列にはその印が付く() {
        // Arrange
        let mut column = 索引の列("IX_EVENTS_CREATED", "CREATED_AT", 1);
        column.descending = true;

        // Act
        let indexes = assemble_indexes(vec![索引("IX_EVENTS_CREATED")], vec![column]);

        // Assert
        assert!(indexes[0].columns[0].descending);
    }

    #[test]
    fn 自動生成された索引も定義ビューには並ぶ() {
        // Arrange: ツリーでは落とすが、主キーの索引が見えないと困る（ADR 0019）
        let mut 自動生成 = 索引("SYS_C0012345");
        自動生成.generated = true;
        自動生成.unique = true;

        // Act
        let indexes = assemble_indexes(vec![自動生成], Vec::new());

        // Assert
        assert_eq!(indexes.len(), 1);
        assert!(indexes[0].generated);
        assert!(indexes[0].unique);
    }

    #[test]
    fn 索引は名前順に並ぶ() {
        // Arrange
        let rows = vec![索引("IX_B"), 索引("IX_A")];

        // Act
        let indexes = assemble_indexes(rows, Vec::new());

        // Assert
        let names: Vec<&str> = indexes.iter().map(|index| index.name.as_str()).collect();
        assert_eq!(names, vec!["IX_A", "IX_B"]);
    }

    #[test]
    fn 別の索引の列が混ざらない() {
        // Arrange
        let rows = vec![索引("IX_A"), 索引("IX_B")];
        let columns = vec![
            索引の列("IX_A", "ORDER_ID", 1),
            索引の列("IX_B", "USER_ID", 1),
        ];

        // Act
        let indexes = assemble_indexes(rows, columns);

        // Assert
        assert_eq!(indexes[0].columns.len(), 1);
        assert_eq!(indexes[0].columns[0].name, "ORDER_ID");
        assert_eq!(indexes[1].columns[0].name, "USER_ID");
    }
}
