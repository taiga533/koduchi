//! スキーマツリーが扱う型（ADR 0007）。
//!
//! データベースに依らない形にしてある。Oracle 固有の列挙元（`ALL_USERS` /
//! `ALL_OBJECTS` / `ALL_TAB_COLUMNS`）とシステムスキーマの既知リストは
//! `oracle::schema` に置く。
//!
//! 取得は 3 段階に分かれる。段階 1 でスキーマ名・オブジェクト数・オブジェクト名を
//! 取り、段階 2 で列情報をスキーマごとに流し込む。段階 3 は読み込み済みの範囲を
//! 検索するだけなのでフロントエンド側の話になる。

use crate::db::value::CellKind;
use serde::{Deserialize, Serialize};

/// スキーマツリーの絞り込み条件（ADR 0007）。
///
/// 列挙元が `ALL_USERS` であるため、条件を外すと `SYS` を含む数十〜数百の
/// スキーマが並ぶ。2 つとも既定で有効にする。接続ごとに `connections.toml` へ
/// 保存する（ADR 0004）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaFilter {
    /// システムスキーマを除外する。
    pub exclude_system: bool,
    /// 参照可能なオブジェクトが無いスキーマを隠す。
    pub hide_empty: bool,
}

impl Default for SchemaFilter {
    fn default() -> Self {
        SchemaFilter {
            exclude_system: true,
            hide_empty: true,
        }
    }
}

/// スキーマ内のオブジェクトの種類。
///
/// ツリーのアイコンと、テーブル定義ビュー（器のみ）を開けるかどうかの判定に使う。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ObjectKind {
    Table,
    View,
    MaterializedView,
    Function,
    Procedure,
    Package,
    Sequence,
}

impl ObjectKind {
    /// データベースが返す種類名から変換する。
    ///
    /// 知らない種類は `None` にして落とす。ツリーに出せない種類を混ぜても
    /// 数だけが増えて役に立たないためである。
    ///
    /// # 引数
    ///
    /// * `raw` - `ALL_OBJECTS.OBJECT_TYPE` の値
    pub fn from_object_type(raw: &str) -> Option<Self> {
        match raw {
            "TABLE" => Some(ObjectKind::Table),
            "VIEW" => Some(ObjectKind::View),
            "MATERIALIZED VIEW" => Some(ObjectKind::MaterializedView),
            "FUNCTION" => Some(ObjectKind::Function),
            "PROCEDURE" => Some(ObjectKind::Procedure),
            "PACKAGE" => Some(ObjectKind::Package),
            "SEQUENCE" => Some(ObjectKind::Sequence),
            _ => None,
        }
    }

    /// 列を持ちうる種類か。
    ///
    /// 段階 2 の列情報を割り当てる先を決めるのに使う。
    pub fn has_columns(self) -> bool {
        matches!(
            self,
            ObjectKind::Table | ObjectKind::View | ObjectKind::MaterializedView
        )
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
    fn 知っているオブジェクト種別は変換できる() {
        // Arrange
        let raw = "MATERIALIZED VIEW";

        // Act
        let kind = ObjectKind::from_object_type(raw);

        // Assert
        assert_eq!(kind, Some(ObjectKind::MaterializedView));
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
}
