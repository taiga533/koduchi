//! スキーマツリーが扱う型（ADR 0007・0014）。
//!
//! データベースに依らない形にしてある。Oracle 固有の列挙元（`ALL_USERS` /
//! `ALL_OBJECTS` / `ALL_INDEXES` / `ALL_DB_LINKS` / `ALL_TAB_COLUMNS`）と
//! システムスキーマの既知リストは `oracle::schema` に置く。
//!
//! 取得は 3 段階に分かれる。段階 1 でスキーマ名・オブジェクト数・オブジェクト名を
//! 取り、段階 2 で列情報をスキーマごとに流し込む。段階 3 は読み込み済みの範囲を
//! 検索するだけなのでフロントエンド側の話になる。

use crate::db::value::CellKind;
use serde::{Deserialize, Serialize};

/// スキーマツリーの絞り込み条件（ADR 0007・0014）。
///
/// 列挙元が `ALL_USERS` であるため、条件を外すと `SYS` を含む数十〜数百の
/// スキーマが並ぶ。前 2 つは既定で有効にする。接続ごとに `connections.toml` へ
/// 保存する（ADR 0004）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaFilter {
    /// システムスキーマを除外する。
    pub exclude_system: bool,
    /// 参照可能なオブジェクトが無いスキーマを隠す。
    pub hide_empty: bool,
    /// ツリーに載せるオブジェクトの種別（ADR 0014）。
    ///
    /// 項目を持たない古い設定ファイルでは全種別が有効になる。
    #[serde(default)]
    pub kinds: ObjectKindFilter,
}

impl Default for SchemaFilter {
    fn default() -> Self {
        SchemaFilter {
            exclude_system: true,
            hide_empty: true,
            kinds: ObjectKindFilter::default(),
        }
    }
}

/// `serde` の既定値に使う真。
///
/// 種別を後から足したとき、既存の `connections.toml` でもその種別が見えるように
/// するためである。項目ごとに既定を与えないと、構造体の一部が欠けた設定ファイルで
/// 新しい種別が偽になってしまう。
fn default_true() -> bool {
    true
}

/// 種別ごとの表示可否（ADR 0014）。
///
/// 索引やシノニムまで載せると 1 スキーマあたりのオブジェクト数が跳ね上がり、
/// 段階 1 の問い合わせが重くなる。切りたい利用者のための逃げ道である。
/// 項目名は `ObjectKind` の名前とそろえてあり、フロントエンドでは
/// `Record<ObjectKind, boolean>` として扱える。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectKindFilter {
    #[serde(default = "default_true")]
    pub table: bool,
    #[serde(default = "default_true")]
    pub view: bool,
    #[serde(default = "default_true")]
    pub materialized_view: bool,
    #[serde(default = "default_true")]
    pub index: bool,
    #[serde(default = "default_true")]
    pub trigger: bool,
    #[serde(default = "default_true")]
    pub sequence: bool,
    #[serde(default = "default_true")]
    pub synonym: bool,
    #[serde(default = "default_true")]
    pub r#type: bool,
    #[serde(default = "default_true")]
    pub function: bool,
    #[serde(default = "default_true")]
    pub procedure: bool,
    #[serde(default = "default_true")]
    pub package: bool,
    #[serde(default = "default_true")]
    pub database_link: bool,
}

impl Default for ObjectKindFilter {
    fn default() -> Self {
        ObjectKindFilter {
            table: true,
            view: true,
            materialized_view: true,
            index: true,
            trigger: true,
            sequence: true,
            synonym: true,
            r#type: true,
            function: true,
            procedure: true,
            package: true,
            database_link: true,
        }
    }
}

impl ObjectKindFilter {
    /// その種別をツリーに載せるか。
    ///
    /// # 引数
    ///
    /// * `kind` - 判定する種別
    pub fn allows(&self, kind: ObjectKind) -> bool {
        match kind {
            ObjectKind::Table => self.table,
            ObjectKind::View => self.view,
            ObjectKind::MaterializedView => self.materialized_view,
            ObjectKind::Index => self.index,
            ObjectKind::Trigger => self.trigger,
            ObjectKind::Sequence => self.sequence,
            ObjectKind::Synonym => self.synonym,
            ObjectKind::Type => self.r#type,
            ObjectKind::Function => self.function,
            ObjectKind::Procedure => self.procedure,
            ObjectKind::Package => self.package,
            ObjectKind::DatabaseLink => self.database_link,
        }
    }
}

/// スキーマ内のオブジェクトの種類。
///
/// ツリーのアイコン・種別ごとの束ね方と、テーブル定義ビュー（器のみ）を
/// 開けるかどうかの判定に使う。並び順はツリーに束を出す順でもある。
///
/// 制約（`ALL_CONSTRAINTS`）はここに入れていない。理由は ADR 0014 にある。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ObjectKind {
    Table,
    View,
    MaterializedView,
    Index,
    Trigger,
    Sequence,
    Synonym,
    Type,
    Function,
    Procedure,
    Package,
    DatabaseLink,
}

impl ObjectKind {
    /// データベースが返す種類名から変換する。
    ///
    /// 知らない種類は `None` にして落とす。ツリーに出せない種類を混ぜても
    /// 数だけが増えて役に立たないためである。`PACKAGE BODY` と `TYPE BODY` は
    /// 本体と同じ名前で並んでしまうため、あえて落としている。
    ///
    /// # 引数
    ///
    /// * `raw` - `ALL_OBJECTS.OBJECT_TYPE` の値
    pub fn from_object_type(raw: &str) -> Option<Self> {
        match raw {
            "TABLE" => Some(ObjectKind::Table),
            "VIEW" => Some(ObjectKind::View),
            "MATERIALIZED VIEW" => Some(ObjectKind::MaterializedView),
            "INDEX" => Some(ObjectKind::Index),
            "TRIGGER" => Some(ObjectKind::Trigger),
            "SEQUENCE" => Some(ObjectKind::Sequence),
            "SYNONYM" => Some(ObjectKind::Synonym),
            "TYPE" => Some(ObjectKind::Type),
            "FUNCTION" => Some(ObjectKind::Function),
            "PROCEDURE" => Some(ObjectKind::Procedure),
            "PACKAGE" => Some(ObjectKind::Package),
            "DATABASE LINK" => Some(ObjectKind::DatabaseLink),
            _ => None,
        }
    }

    /// `ALL_OBJECTS.OBJECT_TYPE` として書いたときの綴り。
    ///
    /// 段階 1 の `in (...)` を組み立てるのに使う。`ALL_OBJECTS` に出てこない
    /// 種別（索引の一部と DB link）でも綴りは定義できるが、列挙元が別なので
    /// 呼び出し側が使い分ける。
    pub fn object_type(self) -> &'static str {
        match self {
            ObjectKind::Table => "TABLE",
            ObjectKind::View => "VIEW",
            ObjectKind::MaterializedView => "MATERIALIZED VIEW",
            ObjectKind::Index => "INDEX",
            ObjectKind::Trigger => "TRIGGER",
            ObjectKind::Sequence => "SEQUENCE",
            ObjectKind::Synonym => "SYNONYM",
            ObjectKind::Type => "TYPE",
            ObjectKind::Function => "FUNCTION",
            ObjectKind::Procedure => "PROCEDURE",
            ObjectKind::Package => "PACKAGE",
            ObjectKind::DatabaseLink => "DATABASE LINK",
        }
    }

    /// 列を持ちうる種類か。
    ///
    /// 段階 2 の列情報を割り当てる先を決めるのに使う。シノニムは指す先が
    /// 列を持つが、`ALL_TAB_COLUMNS` はシノニム名では引けないため含めない。
    pub fn has_columns(self) -> bool {
        matches!(
            self,
            ObjectKind::Table | ObjectKind::View | ObjectKind::MaterializedView
        )
    }

    /// 制約と索引を持ちうる種類か（ADR 0019）。
    ///
    /// テーブル定義ビューが `ALL_CONSTRAINTS` と `ALL_INDEXES` を引きにいくかの
    /// 判定に使う。ビューは列を持つが制約も索引も持たないため、`has_columns` とは
    /// 別の判定が要る。マテリアライズドビューは実体が表であり、索引を張れる。
    pub fn has_table_details(self) -> bool {
        matches!(self, ObjectKind::Table | ObjectKind::MaterializedView)
    }

    /// `DBMS_METADATA.GET_DDL` に渡す型名（ADR 0019）。
    ///
    /// `ALL_OBJECTS.OBJECT_TYPE` の綴りとは一致しない。`MATERIALIZED VIEW` は
    /// `MATERIALIZED_VIEW`、`DATABASE LINK` は `DB_LINK` であり、どちらも
    /// 空白ではなくアンダースコアで繋ぐ。`object_type()` を渡すと
    /// `ORA-31600`（無効な入力値）で落ちる。
    pub fn ddl_object_type(self) -> &'static str {
        match self {
            ObjectKind::Table => "TABLE",
            ObjectKind::View => "VIEW",
            ObjectKind::MaterializedView => "MATERIALIZED_VIEW",
            ObjectKind::Index => "INDEX",
            ObjectKind::Trigger => "TRIGGER",
            ObjectKind::Sequence => "SEQUENCE",
            ObjectKind::Synonym => "SYNONYM",
            ObjectKind::Type => "TYPE",
            ObjectKind::Function => "FUNCTION",
            ObjectKind::Procedure => "PROCEDURE",
            ObjectKind::Package => "PACKAGE",
            ObjectKind::DatabaseLink => "DB_LINK",
        }
    }

    /// 仕様とは別に本体を取る必要がある種類の、本体側の型名（ADR 0019）。
    ///
    /// パッケージだけが該当する。`GET_DDL('PACKAGE', …)` は仕様しか返さない。
    /// ADR 0014 が `PACKAGE BODY` をツリーから落としているぶん、本体を見る道は
    /// ここにしかない。
    pub fn ddl_body_type(self) -> Option<&'static str> {
        match self {
            ObjectKind::Package => Some("PACKAGE_BODY"),
            _ => None,
        }
    }

    /// DDL の断片に付ける見出し（ADR 0019）。
    ///
    /// 断片が 1 つしか無い種別では、その 1 つの見出しになる。
    pub fn ddl_label(self) -> &'static str {
        match self {
            ObjectKind::Package => "パッケージ仕様",
            _ => "定義",
        }
    }
}

/// スキーマ内のオブジェクト 1 件。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaObject {
    pub name: String,
    pub kind: ObjectKind,
}

/// スキーマ 1 つ。段階 1 で返る。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaNode {
    pub name: String,
    /// 参照可能なオブジェクトの数。デザインがスキーマ行の右に出している数である。
    pub object_count: usize,
    pub objects: Vec<SchemaObject>,
}

/// テーブルやビューの列 1 つ。段階 2 で返る。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableColumn {
    /// 属するオブジェクトの名前。
    pub object_name: String,
    pub name: String,
    /// `NUMBER(12,2)` のような表示用の型名。
    pub type_name: String,
    pub nullable: bool,
    /// 右寄せ判定と補完の並べ替えに使う種類。
    pub kind: CellKind,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn スキーマフィルタの既定は両方とも有効である() {
        // Arrange & Act
        let filter = SchemaFilter::default();

        // Assert
        assert!(filter.exclude_system);
        assert!(filter.hide_empty);
    }

    #[test]
    fn 種別の既定はすべて表示である() {
        // Arrange & Act
        let kinds = ObjectKindFilter::default();

        // Assert
        assert!(kinds.allows(ObjectKind::Table));
        assert!(kinds.allows(ObjectKind::Index));
        assert!(kinds.allows(ObjectKind::Trigger));
        assert!(kinds.allows(ObjectKind::Synonym));
        assert!(kinds.allows(ObjectKind::Type));
        assert!(kinds.allows(ObjectKind::DatabaseLink));
    }

    #[test]
    fn 種別を落とすとその種別だけが偽になる() {
        // Arrange
        let kinds = ObjectKindFilter {
            index: false,
            ..ObjectKindFilter::default()
        };

        // Act & Assert
        assert!(!kinds.allows(ObjectKind::Index));
        assert!(kinds.allows(ObjectKind::Table));
    }

    #[test]
    fn 種別の項目が無い設定は全種別を表示として読める() {
        // Arrange: 0014 より前に書かれた schemaFilter を模す
        let json = r#"{ "excludeSystem": true, "hideEmpty": true }"#;

        // Act
        let filter: SchemaFilter = serde_json::from_str(json).unwrap();

        // Assert
        assert_eq!(filter.kinds, ObjectKindFilter::default());
    }

    #[test]
    fn 種別の一部だけを書いた設定は残りが表示のまま読める() {
        // Arrange
        let json = r#"{ "excludeSystem": true, "hideEmpty": true, "kinds": { "index": false } }"#;

        // Act
        let filter: SchemaFilter = serde_json::from_str(json).unwrap();

        // Assert
        assert!(!filter.kinds.index);
        assert!(filter.kinds.trigger);
    }

    #[test]
    fn 知っているオブジェクト種別は変換できる() {
        // Arrange
        let raw = "MATERIALIZED VIEW";

        // Act
        let kind = ObjectKind::from_object_type(raw);

        // Assert
        assert_eq!(kind, Some(ObjectKind::MaterializedView));
    }

    #[test]
    fn 追加した種別も変換できる() {
        // Arrange & Act & Assert
        assert_eq!(
            ObjectKind::from_object_type("INDEX"),
            Some(ObjectKind::Index)
        );
        assert_eq!(
            ObjectKind::from_object_type("TRIGGER"),
            Some(ObjectKind::Trigger)
        );
        assert_eq!(
            ObjectKind::from_object_type("SYNONYM"),
            Some(ObjectKind::Synonym)
        );
        assert_eq!(ObjectKind::from_object_type("TYPE"), Some(ObjectKind::Type));
        assert_eq!(
            ObjectKind::from_object_type("DATABASE LINK"),
            Some(ObjectKind::DatabaseLink)
        );
    }

    #[test]
    fn 本体の定義は種別として扱わない() {
        // Arrange & Act & Assert: 本体は名前が仕様と同じで二重に並ぶ
        assert_eq!(ObjectKind::from_object_type("PACKAGE BODY"), None);
        assert_eq!(ObjectKind::from_object_type("TYPE BODY"), None);
    }

    #[test]
    fn 知らないオブジェクト種別は落とす() {
        // Arrange
        let raw = "JAVA CLASS";

        // Act
        let kind = ObjectKind::from_object_type(raw);

        // Assert
        assert_eq!(kind, None);
    }

    #[test]
    fn 種別名は元の綴りへ戻せる() {
        // Arrange
        let kind = ObjectKind::MaterializedView;

        // Act
        let raw = kind.object_type();

        // Assert
        assert_eq!(raw, "MATERIALIZED VIEW");
        assert_eq!(ObjectKind::from_object_type(raw), Some(kind));
    }

    #[test]
    fn テーブルとビューは列を持ちうる() {
        // Arrange & Act & Assert
        assert!(ObjectKind::Table.has_columns());
        assert!(ObjectKind::View.has_columns());
        assert!(ObjectKind::MaterializedView.has_columns());
    }

    #[test]
    fn 関数やシーケンスは列を持たない() {
        // Arrange & Act & Assert
        assert!(!ObjectKind::Function.has_columns());
        assert!(!ObjectKind::Sequence.has_columns());
    }

    #[test]
    fn 追加した種別はどれも列を持たない() {
        // Arrange & Act & Assert: シノニムは指す先が列を持つが名前では引けない
        assert!(!ObjectKind::Index.has_columns());
        assert!(!ObjectKind::Trigger.has_columns());
        assert!(!ObjectKind::Synonym.has_columns());
        assert!(!ObjectKind::Type.has_columns());
        assert!(!ObjectKind::DatabaseLink.has_columns());
    }

    #[test]
    fn 制約と索引を持つのはテーブルとマテビューだけである() {
        // Arrange & Act & Assert: ビューは列を持つが制約も索引も持たない
        assert!(ObjectKind::Table.has_table_details());
        assert!(ObjectKind::MaterializedView.has_table_details());
        assert!(!ObjectKind::View.has_table_details());
        assert!(!ObjectKind::Function.has_table_details());
    }

    #[test]
    fn get_ddlの型名は空白ではなくアンダースコアで繋ぐ() {
        // Arrange & Act & Assert: `object_type()` の綴りでは ORA-31600 になる
        assert_eq!(
            ObjectKind::MaterializedView.ddl_object_type(),
            "MATERIALIZED_VIEW"
        );
        assert_eq!(ObjectKind::DatabaseLink.ddl_object_type(), "DB_LINK");
    }

    #[test]
    fn 全種別がget_ddlの型名を持つ() {
        // Arrange: 種別を足したとき DDL の型名を忘れないための歯止め
        let kinds = [
            (ObjectKind::Table, "TABLE"),
            (ObjectKind::View, "VIEW"),
            (ObjectKind::MaterializedView, "MATERIALIZED_VIEW"),
            (ObjectKind::Index, "INDEX"),
            (ObjectKind::Trigger, "TRIGGER"),
            (ObjectKind::Sequence, "SEQUENCE"),
            (ObjectKind::Synonym, "SYNONYM"),
            (ObjectKind::Type, "TYPE"),
            (ObjectKind::Function, "FUNCTION"),
            (ObjectKind::Procedure, "PROCEDURE"),
            (ObjectKind::Package, "PACKAGE"),
            (ObjectKind::DatabaseLink, "DB_LINK"),
        ];

        // Act & Assert
        for (kind, expected) in kinds {
            assert_eq!(kind.ddl_object_type(), expected, "{kind:?} の型名が違う");
            // 空白を含む綴りは DBMS_METADATA が受け付けない。
            assert!(
                !kind.ddl_object_type().contains(' '),
                "{kind:?} の型名に空白が入っている"
            );
        }
    }

    #[test]
    fn パッケージだけが本体を別に取る() {
        // Arrange & Act & Assert: GET_DDL('PACKAGE', …) は仕様しか返さない
        assert_eq!(ObjectKind::Package.ddl_body_type(), Some("PACKAGE_BODY"));
        assert_eq!(ObjectKind::Table.ddl_body_type(), None);
        assert_eq!(ObjectKind::Type.ddl_body_type(), None);
    }

    #[test]
    fn パッケージのddlの見出しは仕様と分かる文言になる() {
        // Arrange & Act & Assert
        assert_eq!(ObjectKind::Package.ddl_label(), "パッケージ仕様");
        assert_eq!(ObjectKind::Table.ddl_label(), "定義");
    }

    #[test]
    fn 種別はツリーに束を出す順に並ぶ() {
        // Arrange
        let mut kinds = vec![
            ObjectKind::DatabaseLink,
            ObjectKind::View,
            ObjectKind::Table,
            ObjectKind::Index,
        ];

        // Act
        kinds.sort();

        // Assert
        assert_eq!(
            kinds,
            vec![
                ObjectKind::Table,
                ObjectKind::View,
                ObjectKind::Index,
                ObjectKind::DatabaseLink,
            ]
        );
    }
}
