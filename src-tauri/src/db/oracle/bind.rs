//! バインド変数の受け渡し（ADR の「バインド変数」節）。
//!
//! 値は型を選ばせず、すべて文字列として受け取る。Oracle 側では `VARCHAR2` として
//! バインドする。日付や数値の列と比べるときは暗黙変換が起き、索引が効かなくなる
//! 場合があることは承知のうえで、まずは動くことを取っている。
//!
//! `String` をそのまま `oracle` crate へ渡すと `NVARCHAR2` になる。国別文字集合の
//! 型は `VARCHAR2` の列との比較でさらに変換を挟むため、型を明示するための包みを
//! 介す。

use crate::db::driver::Bind;
use oracle::sql_type::{OracleType, ToSql};
use oracle::{SqlValue, Statement};

/// `VARCHAR2` としてバインドする 1 つの値。
///
/// `None` は NULL としてバインドする。
pub struct Varchar2Bind(Option<String>);

impl ToSql for Varchar2Bind {
    fn oratype(&self, _connection: &oracle::Connection) -> oracle::Result<OracleType> {
        // 長さ 0 の `VARCHAR2` は作れないため、空でも 1 バイトぶんは確保する。
        let length = self.0.as_ref().map_or(0, |text| text.len()).max(1);
        Ok(OracleType::Varchar2(length as u32))
    }

    fn to_sql(&self, value: &mut SqlValue) -> oracle::Result<()> {
        match &self.0 {
            Some(text) => value.set(text),
            None => value.set_null(),
        }
    }
}

/// 文に実在するバインド変数だけを取り出し、`VARCHAR2` の値として束ねる。
///
/// 文に無い名前を渡すと `oracle` crate はエラーにする。名前の抽出はフロントエンド
/// 側の自前パーサが行っており、その見立てが Oracle のそれと食い違うことはありうる。
/// 余分な名前で実行そのものを落とさないよう、ここで文の側の名前に合わせて絞る。
/// 逆に足りない場合は Oracle が `ORA-01008` を返し、その旨が利用者に届く。
///
/// 名前の比較は大文字小文字を区別しない。Oracle のバインド名がそうであるため。
///
/// # 引数
///
/// * `statement` - 実行する文
/// * `binds` - 与えられた値
///
/// # 戻り値
///
/// 名前と値の組。`params` へ渡して使う。
pub fn bound_values(statement: &Statement, binds: &[Bind]) -> Vec<(String, Varchar2Bind)> {
    let names = statement.bind_names();

    binds
        .iter()
        .filter(|(name, _)| {
            names
                .iter()
                .any(|declared| declared.eq_ignore_ascii_case(name))
        })
        .map(|(name, value)| (name.clone(), Varchar2Bind(value.clone())))
        .collect()
}

/// `execute_named` などへ渡す形へ変換する。
///
/// 借用のためだけに分けてある。`bound_values` の戻り値を保ったまま呼ぶ。
///
/// # 引数
///
/// * `values` - `bound_values` が返した組
pub fn params(values: &[(String, Varchar2Bind)]) -> Vec<(&str, &dyn ToSql)> {
    values
        .iter()
        .map(|(name, value)| (name.as_str(), value as &dyn ToSql))
        .collect()
}
