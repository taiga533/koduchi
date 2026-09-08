//! オブジェクトのソース検索（ADR 0021）。
//!
//! `ALL_SOURCE` を横断して「この文字列を含む処理はどれか」を探すための型と、
//! 取ってきた行をオブジェクト単位へまとめ直す純粋な関数を置く。実際の
//! 問い合わせは `crate::db::oracle::source` にあり、このモジュールは Oracle に
//! 依存しない（`crate::db::sessions` と同じ立て付けである）。
//!
//! ここに置く種別（`SourceKind`）は、スキーマツリーの `ObjectKind`（ADR 0014）
//! とは別の語彙である。ツリーは `PACKAGE BODY` と `TYPE BODY` を落としているが、
//! ソース検索では**本体こそが探し先**であり、落とすと機能が成り立たない。
//! ツリーの決定は「同じ名前で 2 行並べない」ためのものであり、本文を探す話とは
//! 目的が違う。

use crate::db::error::{DbError, DbResult};
use serde::{Deserialize, Serialize};

/// 検索語の最短の長さ（文字数）。
///
/// 1 文字の検索は `ALL_SOURCE` の全行に当たり、上限まで拾って終わるだけである。
/// 待たせたうえで役に立たない結果を返さないよう、入口で弾く。
pub const SOURCE_SEARCH_MIN_LENGTH: usize = 2;

/// 1 度の検索で持ち帰る当たり行数の既定の上限。
pub const SOURCE_SEARCH_DEFAULT_LIMIT: usize = 500;

/// 上限として受け付ける最大値。
///
/// フロントエンドから届いた値はここへ丸める。`ALL_SOURCE` は中規模の
/// データベースでも数十万〜数百万行あり、上限を外す道は用意しない。
pub const SOURCE_SEARCH_MAX_LIMIT: usize = 2_000;

/// 当たった行の前後に添える行数（ADR 0021）。
pub const SOURCE_CONTEXT_RADIUS: u32 = 5;

/// `ALL_SOURCE` に本文が載る種別（ADR 0021）。
///
/// `ObjectKind`（ADR 0014）と重なるが別の列挙である。ツリーが落としている
/// `PACKAGE BODY` と `TYPE BODY` をここでは持ち、逆にツリーにある表・ビュー・
/// 索引などは `ALL_SOURCE` に本文を持たないため無い。
///
/// ビューの本文は `ALL_VIEWS.TEXT` にあるが、ここには含めない。理由は
/// ADR 0021 に書いてある。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceKind {
    Function,
    Procedure,
    Package,
    PackageBody,
    Trigger,
    Type,
    TypeBody,
}

/// 束の並び順。フロントエンドの見出しの順でもある。
pub const SOURCE_KIND_ORDER: [SourceKind; 7] = [
    SourceKind::Function,
    SourceKind::Procedure,
    SourceKind::Package,
    SourceKind::PackageBody,
    SourceKind::Trigger,
    SourceKind::Type,
    SourceKind::TypeBody,
];

impl SourceKind {
    /// `ALL_SOURCE.TYPE` の値から変換する。
    ///
    /// 知らない種別は `None` にして落とす。`JAVA SOURCE` は `ALL_SOURCE` に
    /// 載るが PL/SQL ではなく、PL/SQL を探しに来た利用者の一覧を汚すだけで
    /// あるため拾わない。
    ///
    /// # 引数
    ///
    /// * `raw` - `ALL_SOURCE.TYPE` の値
    pub fn from_source_type(raw: &str) -> Option<Self> {
        match raw {
            "FUNCTION" => Some(SourceKind::Function),
            "PROCEDURE" => Some(SourceKind::Procedure),
            "PACKAGE" => Some(SourceKind::Package),
            "PACKAGE BODY" => Some(SourceKind::PackageBody),
            "TRIGGER" => Some(SourceKind::Trigger),
            "TYPE" => Some(SourceKind::Type),
            "TYPE BODY" => Some(SourceKind::TypeBody),
            _ => None,
        }
    }

    /// `ALL_SOURCE.TYPE` として書いたときの綴り。
    ///
    /// 問い合わせの `in (...)` を組み立てるのに使う。
    pub fn source_type(self) -> &'static str {
        match self {
            SourceKind::Function => "FUNCTION",
            SourceKind::Procedure => "PROCEDURE",
            SourceKind::Package => "PACKAGE",
            SourceKind::PackageBody => "PACKAGE BODY",
            SourceKind::Trigger => "TRIGGER",
            SourceKind::Type => "TYPE",
            SourceKind::TypeBody => "TYPE BODY",
        }
    }
}

/// 項目を省いたときの既定値（真）。
fn default_true() -> bool {
    true
}

/// 検索する種別ごとの可否（ADR 0021）。
///
/// 項目ごとに `#[serde(default)]` を付けてあるのは `ObjectKindFilter`
/// （ADR 0014）と同じ理由である。後から種別を足したとき、古い呼び出しでも
/// その種別が検索対象に入る。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceKindFilter {
    #[serde(default = "default_true")]
    pub function: bool,
    #[serde(default = "default_true")]
    pub procedure: bool,
    #[serde(default = "default_true")]
    pub package: bool,
    #[serde(default = "default_true")]
    pub package_body: bool,
    #[serde(default = "default_true")]
    pub trigger: bool,
    #[serde(default = "default_true")]
    pub r#type: bool,
    #[serde(default = "default_true")]
    pub type_body: bool,
}

impl Default for SourceKindFilter {
    fn default() -> Self {
        SourceKindFilter {
            function: true,
            procedure: true,
            package: true,
            package_body: true,
            trigger: true,
            r#type: true,
            type_body: true,
        }
    }
}

impl SourceKindFilter {
    /// その種別を検索するか。
    ///
    /// # 引数
    ///
    /// * `kind` - 判定する種別
    pub fn allows(&self, kind: SourceKind) -> bool {
        match kind {
            SourceKind::Function => self.function,
            SourceKind::Procedure => self.procedure,
            SourceKind::Package => self.package,
            SourceKind::PackageBody => self.package_body,
            SourceKind::Trigger => self.trigger,
            SourceKind::Type => self.r#type,
            SourceKind::TypeBody => self.type_body,
        }
    }

    /// 有効になっている種別を宣言順に並べる。
    pub fn enabled(&self) -> Vec<SourceKind> {
        SOURCE_KIND_ORDER
            .into_iter()
            .filter(|kind| self.allows(*kind))
            .collect()
    }
}

/// 検索語の当て方（ADR 0021）。
fn default_limit() -> usize {
    SOURCE_SEARCH_DEFAULT_LIMIT
}

/// ソース検索 1 回ぶんの求め（ADR 0021）。
///
/// 検索語は必ずバインド変数として渡す。SQL へ直に埋め込まない。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSearchRequest {
    /// 探す文字列。`%` や `_` は文字そのものとして扱う。
    pub needle: String,
    /// 探す先のスキーマ。`None` は「すべてのスキーマ（システムを除く）」。
    #[serde(default)]
    pub owner: Option<String>,
    /// 探す種別。落とした種別は問い合わせにも行かない。
    #[serde(default)]
    pub kinds: SourceKindFilter,
    /// 大文字と小文字を区別するか。既定は偽。
    ///
    /// 識別子は大文字で格納されるが、本文には利用者が書いたままの綴りが入る。
    /// 区別しないほうが実用的である。
    #[serde(default)]
    pub case_sensitive: bool,
    /// 持ち帰る当たり行数の上限。
    #[serde(default = "default_limit")]
    pub limit: usize,
}

impl SourceSearchRequest {
    /// 上限を許される範囲へ丸める。
    ///
    /// 0 を渡されたら既定値にする。上限を外す道は用意しない。
    pub fn effective_limit(&self) -> usize {
        if self.limit == 0 {
            return SOURCE_SEARCH_DEFAULT_LIMIT;
        }
        self.limit.min(SOURCE_SEARCH_MAX_LIMIT)
    }

    /// 検索語として成り立っているかを確かめる。
    ///
    /// 短すぎる語は `ALL_SOURCE` の全行に当たるだけであり、投げる前に弾く。
    ///
    /// # 戻り値
    ///
    /// 投げてよければ、前後の空白を落とした検索語。
    pub fn validated_needle(&self) -> DbResult<&str> {
        let needle = self.needle.trim();

        if needle.chars().count() < SOURCE_SEARCH_MIN_LENGTH {
            return Err(DbError::execute(format!(
                "検索語は {SOURCE_SEARCH_MIN_LENGTH} 文字以上で指定してください"
            )));
        }

        Ok(needle)
    }
}

/// ソースの 1 行。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceLine {
    /// `ALL_SOURCE.LINE`。1 始まり。
    pub line: u32,
    /// `ALL_SOURCE.TEXT` から行末の改行だけを落としたもの。
    pub text: String,
}

/// まとめる前の当たり 1 行。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawSourceMatch {
    pub owner: String,
    pub name: String,
    pub kind: SourceKind,
    pub line: u32,
    pub text: String,
}

/// オブジェクト 1 つぶんの当たり（ADR 0021）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceObjectMatches {
    pub owner: String,
    pub name: String,
    pub kind: SourceKind,
    /// 当たった行。行番号の昇順。
    pub lines: Vec<SourceLine>,
}

/// ソース検索 1 回ぶんの結果（ADR 0021）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSearchResult {
    /// 当たったオブジェクト。所有者・名前・種別の順。
    pub objects: Vec<SourceObjectMatches>,
    /// 当たった行の総数。
    pub matched_lines: usize,
    /// 上限に達して打ち切ったか。
    ///
    /// 真のときは「これで全部だ」と読ませてはならない。黙って切り詰めると、
    /// 一覧に出ていないことを「無い」と読まれる。
    pub truncated: bool,
}

/// 前後の行を読むときの相手（ADR 0021）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceTarget {
    pub owner: String,
    pub name: String,
    pub kind: SourceKind,
}

/// 行末の改行だけを落とす。
///
/// `ALL_SOURCE.TEXT` は行末の改行を含む。字下げは意味を持つため、行頭の空白は
/// 触らない。
///
/// # 引数
///
/// * `text` - `ALL_SOURCE.TEXT` の値
fn strip_line_break(text: &str) -> String {
    text.trim_end_matches(['\n', '\r']).to_string()
}

/// 当たった行をオブジェクト単位へまとめ直す（ADR 0021）。
///
/// 問い合わせは早く打ち切れるよう `ORDER BY` を付けずに投げるため、並べ直しは
/// ここで行う。上限より 1 行多く受け取り、あふれていたら打ち切ったことを伝える。
///
/// # 引数
///
/// * `rows` - 取ってきたままの当たり行。上限 + 1 行まで
/// * `limit` - 持ち帰る当たり行数の上限
pub fn group_matches(rows: Vec<RawSourceMatch>, limit: usize) -> SourceSearchResult {
    let truncated = rows.len() > limit;

    let mut rows = rows;
    rows.truncate(limit);
    rows.sort_by(|left, right| {
        left.owner
            .cmp(&right.owner)
            .then(left.name.cmp(&right.name))
            .then(left.kind.cmp(&right.kind))
            .then(left.line.cmp(&right.line))
    });

    let matched_lines = rows.len();
    let mut objects: Vec<SourceObjectMatches> = Vec::new();

    for row in rows {
        let line = SourceLine {
            line: row.line,
            text: strip_line_break(&row.text),
        };

        match objects.last_mut() {
            Some(last)
                if last.owner == row.owner && last.name == row.name && last.kind == row.kind =>
            {
                last.lines.push(line);
            }
            _ => objects.push(SourceObjectMatches {
                owner: row.owner,
                name: row.name,
                kind: row.kind,
                lines: vec![line],
            }),
        }
    }

    SourceSearchResult {
        objects,
        matched_lines,
        truncated,
    }
}

/// 当たった行の前後を読む範囲を求める。
///
/// 行番号は 1 始まりであり、先頭より前へはみ出さない。末尾は分からないため
/// 丸めない。実在しない行はデータベース側が返さないだけである。
///
/// # 引数
///
/// * `line` - 当たった行
/// * `radius` - 前後に添える行数
///
/// # 戻り値
///
/// `(始まりの行, 終わりの行)`。どちらも境界を含む。
pub fn context_range(line: u32, radius: u32) -> (u32, u32) {
    let from = line.saturating_sub(radius).max(1);
    (from, line.saturating_add(radius))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 当たり 1 行を組み立てる。
    ///
    /// # 引数
    ///
    /// * `name` - オブジェクト名
    /// * `kind` - 種別
    /// * `line` - 行番号
    fn 当たり(name: &str, kind: SourceKind, line: u32) -> RawSourceMatch {
        RawSourceMatch {
            owner: String::from("KODUCHI"),
            name: String::from(name),
            kind,
            line,
            text: format!("  -- {line} 行目\n"),
        }
    }

    #[test]
    fn パッケージ本体の種別を読み取れる() {
        // Arrange & Act
        let kind = SourceKind::from_source_type("PACKAGE BODY");

        // Assert: ツリーは本体を落とすが、ソース検索では本体こそが探し先である
        assert_eq!(kind, Some(SourceKind::PackageBody));
        assert_eq!(SourceKind::PackageBody.source_type(), "PACKAGE BODY");
    }

    #[test]
    fn plsql以外の種別は読み捨てられる() {
        // Arrange & Act & Assert
        assert_eq!(SourceKind::from_source_type("JAVA SOURCE"), None);
        assert_eq!(SourceKind::from_source_type("VIEW"), None);
    }

    #[test]
    fn 種別の既定はすべて有効である() {
        // Arrange
        let kinds = SourceKindFilter::default();

        // Act
        let enabled = kinds.enabled();

        // Assert
        assert_eq!(enabled, SOURCE_KIND_ORDER.to_vec());
    }

    #[test]
    fn 落とした種別は有効な種別に並ばない() {
        // Arrange
        let kinds = SourceKindFilter {
            trigger: false,
            r#type: false,
            type_body: false,
            ..SourceKindFilter::default()
        };

        // Act
        let enabled = kinds.enabled();

        // Assert
        assert_eq!(
            enabled,
            vec![
                SourceKind::Function,
                SourceKind::Procedure,
                SourceKind::Package,
                SourceKind::PackageBody,
            ]
        );
    }

    #[test]
    fn 種別を省いた求めはすべての種別を探す() {
        // Arrange: 後から種別が増えても古い呼び出しがその種別を落とさない
        let json = r#"{ "needle": "orders", "kinds": { "function": false } }"#;

        // Act
        let request: SourceSearchRequest = serde_json::from_str(json).unwrap();

        // Assert
        assert!(!request.kinds.function);
        assert!(request.kinds.package_body);
        assert_eq!(request.owner, None);
        assert!(!request.case_sensitive);
        assert_eq!(request.limit, SOURCE_SEARCH_DEFAULT_LIMIT);
    }

    #[test]
    fn 短すぎる検索語は投げる前に弾かれる() {
        // Arrange
        let request = SourceSearchRequest {
            needle: String::from(" a "),
            owner: None,
            kinds: SourceKindFilter::default(),
            case_sensitive: false,
            limit: SOURCE_SEARCH_DEFAULT_LIMIT,
        };

        // Act
        let error = request
            .validated_needle()
            .expect_err("1 文字では弾かれるはず");

        // Assert
        assert!(error.message.contains("2 文字以上"));
    }

    #[test]
    fn 検索語は前後の空白を落として使う() {
        // Arrange
        let request = SourceSearchRequest {
            needle: String::from("  user_traits  "),
            owner: None,
            kinds: SourceKindFilter::default(),
            case_sensitive: false,
            limit: SOURCE_SEARCH_DEFAULT_LIMIT,
        };

        // Act
        let needle = request.validated_needle().unwrap();

        // Assert
        assert_eq!(needle, "user_traits");
    }

    #[test]
    fn 上限は許される範囲へ丸められる() {
        // Arrange
        let 求め = |limit: usize| SourceSearchRequest {
            needle: String::from("orders"),
            owner: None,
            kinds: SourceKindFilter::default(),
            case_sensitive: false,
            limit,
        };

        // Act & Assert
        assert_eq!(求め(0).effective_limit(), SOURCE_SEARCH_DEFAULT_LIMIT);
        assert_eq!(求め(10).effective_limit(), 10);
        assert_eq!(求め(100_000).effective_limit(), SOURCE_SEARCH_MAX_LIMIT);
    }

    #[test]
    fn 当たり行はオブジェクト単位にまとまる() {
        // Arrange: 問い合わせは並び順を約束しないため、ばらばらに届く
        let rows = vec![
            当たり("ORDER_STATS", SourceKind::PackageBody, 12),
            当たり("ORDER_TOTAL", SourceKind::Function, 3),
            当たり("ORDER_STATS", SourceKind::PackageBody, 4),
        ];

        // Act
        let result = group_matches(rows, 10);

        // Assert
        assert_eq!(result.objects.len(), 2);
        assert_eq!(result.objects[0].name, "ORDER_STATS");
        assert_eq!(
            result.objects[0]
                .lines
                .iter()
                .map(|l| l.line)
                .collect::<Vec<_>>(),
            vec![4, 12]
        );
        assert_eq!(result.objects[1].name, "ORDER_TOTAL");
        assert_eq!(result.matched_lines, 3);
        assert!(!result.truncated);
    }

    #[test]
    fn 同じ名前でも種別が違えば別のオブジェクトになる() {
        // Arrange: 仕様と本体は同じ名前で並ぶ
        let rows = vec![
            当たり("ORDER_STATS", SourceKind::PackageBody, 4),
            当たり("ORDER_STATS", SourceKind::Package, 2),
        ];

        // Act
        let result = group_matches(rows, 10);

        // Assert
        assert_eq!(result.objects.len(), 2);
        assert_eq!(result.objects[0].kind, SourceKind::Package);
        assert_eq!(result.objects[1].kind, SourceKind::PackageBody);
    }

    #[test]
    fn 上限を超えた分は切り詰めて打ち切りを伝える() {
        // Arrange: 上限 + 1 行を受け取ったときが打ち切りである
        let rows = vec![
            当たり("A", SourceKind::Function, 1),
            当たり("B", SourceKind::Function, 1),
            当たり("C", SourceKind::Function, 1),
        ];

        // Act
        let result = group_matches(rows, 2);

        // Assert
        assert!(result.truncated);
        assert_eq!(result.matched_lines, 2);
        assert_eq!(result.objects.len(), 2);
    }

    #[test]
    fn 行末の改行は落とし字下げは残す() {
        // Arrange
        let rows = vec![RawSourceMatch {
            owner: String::from("KODUCHI"),
            name: String::from("SAY_HELLO"),
            kind: SourceKind::Procedure,
            line: 2,
            text: String::from("    select 1 from dual;\r\n"),
        }];

        // Act
        let result = group_matches(rows, 10);

        // Assert
        assert_eq!(result.objects[0].lines[0].text, "    select 1 from dual;");
    }

    #[test]
    fn 前後の範囲は先頭より前へはみ出さない() {
        // Arrange & Act & Assert
        assert_eq!(context_range(1, 5), (1, 6));
        assert_eq!(context_range(20, 5), (15, 25));
    }
}
