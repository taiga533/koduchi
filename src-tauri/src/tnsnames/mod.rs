//! tnsnames.ora の自前パーサ（ADR 0006）。
//!
//! `oracle` crate の `InitParams::oracle_client_config_dir()`（`TNS_ADMIN` 相当）は
//! プロセス 1 回きりでしか効かず、接続ごとに切り替えられない。そこで
//! `tnsnames.ora` を自前で読み、得た接続記述子をそのまま接続文字列として渡す。
//! こうすると ODPI-C の `TNS_ADMIN` に一切依存しなくなる。
//!
//! 対応するのは括弧構文の再帰・`#` コメント・複数エントリ・カンマ区切りの別名・
//! 複数 `ADDRESS`・`DESCRIPTION_LIST` である。`IFILE` は非対応で、見つけたら
//! 警告として返す。

use serde::Serialize;

/// tnsnames.ora の 1 エントリ。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TnsEntry {
    /// エイリアス名。カンマ区切りの別名はすべて並ぶ。
    pub aliases: Vec<String>,
    /// 正規化した接続記述子。そのまま接続文字列として使える。
    pub descriptor: String,
}

/// tnsnames.ora を読んだ結果。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TnsnamesFile {
    pub entries: Vec<TnsEntry>,
    /// 読み飛ばした箇所の説明。空でなければ利用者に伝える。
    pub warnings: Vec<String>,
}

/// 括弧構文の 1 節点。
///
/// `(KEY=value)` の葉と `(KEY=(子)(子))` の枝の 2 種類しかない。
#[derive(Debug, Clone, PartialEq, Eq)]
enum TnsNode {
    Leaf { key: String, value: String },
    Branch { key: String, children: Vec<TnsNode> },
}

impl TnsNode {
    /// 記述子の文字列へ戻す。
    ///
    /// 空白と改行を落とした 1 行にする。接続文字列として渡せる形である。
    fn render(&self) -> String {
        match self {
            TnsNode::Leaf { key, value } => format!("({key}={value})"),
            TnsNode::Branch { key, children } => {
                let mut rendered = String::new();
                rendered.push('(');
                rendered.push_str(key);
                rendered.push('=');
                for child in children {
                    rendered.push_str(&child.render());
                }
                rendered.push(')');
                rendered
            }
        }
    }
}

/// 文字列を 1 文字ずつ辿る読み取り位置。
struct Scanner {
    chars: Vec<char>,
    pos: usize,
}

impl Scanner {
    fn new(source: &str) -> Self {
        Scanner {
            chars: source.chars().collect(),
            pos: 0,
        }
    }

    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).copied()
    }

    fn bump(&mut self) -> Option<char> {
        let current = self.peek();
        if current.is_some() {
            self.pos += 1;
        }
        current
    }

    /// 空白と `#` コメントを読み飛ばす。
    fn skip_trivia(&mut self) {
        loop {
            match self.peek() {
                Some(c) if c.is_whitespace() => {
                    self.pos += 1;
                }
                Some('#') => self.skip_line(),
                _ => return,
            }
        }
    }

    /// 行末まで読み飛ばす。
    fn skip_line(&mut self) {
        while let Some(c) = self.bump() {
            if c == '\n' {
                return;
            }
        }
    }

    /// 括弧の対応を数えながら 1 ブロックを読み飛ばす。
    ///
    /// 構文の壊れたエントリを捨てて次のエントリへ進むために使う。
    fn skip_block(&mut self) {
        let mut depth = 0usize;
        while let Some(c) = self.bump() {
            match c {
                '(' => depth += 1,
                ')' => {
                    depth -= 1;
                    if depth == 0 {
                        return;
                    }
                }
                _ => {}
            }
        }
    }
}

/// `(KEY=…)` を 1 つ読む。
///
/// 読み取りに失敗したら `None` を返す。呼び出し側はそのエントリを捨てる。
fn parse_node(scanner: &mut Scanner) -> Option<TnsNode> {
    scanner.skip_trivia();
    if scanner.peek() != Some('(') {
        return None;
    }
    scanner.bump();

    let mut key = String::new();
    loop {
        match scanner.peek() {
            Some('=') => {
                scanner.bump();
                break;
            }
            Some(')') | None => return None,
            Some(c) => {
                key.push(c);
                scanner.bump();
            }
        }
    }
    let key = key.trim().to_uppercase();
    if key.is_empty() {
        return None;
    }

    scanner.skip_trivia();

    if scanner.peek() == Some('(') {
        let mut children = Vec::new();
        loop {
            scanner.skip_trivia();
            match scanner.peek() {
                Some('(') => children.push(parse_node(scanner)?),
                Some(')') => {
                    scanner.bump();
                    return Some(TnsNode::Branch { key, children });
                }
                _ => return None,
            }
        }
    }

    let mut value = String::new();
    loop {
        match scanner.peek() {
            Some(')') => {
                scanner.bump();
                return Some(TnsNode::Leaf {
                    key,
                    value: value.trim().to_string(),
                });
            }
            None => return None,
            Some(c) => {
                value.push(c);
                scanner.bump();
            }
        }
    }
}

/// エイリアス名を分解する。
///
/// `alias1, alias2` のようにカンマで別名を並べられる。
///
/// # 引数
///
/// * `raw` - `=` の左側の文字列
fn split_aliases(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(|alias| alias.trim())
        .filter(|alias| !alias.is_empty())
        .map(|alias| alias.to_string())
        .collect()
}

/// tnsnames.ora の内容をパースする。
///
/// 壊れたエントリや `IFILE` は読み飛ばし、その旨を `warnings` に積む。
/// 途中で失敗しても読めたエントリは返す。
///
/// # 引数
///
/// * `source` - tnsnames.ora の中身
pub fn parse_tnsnames(source: &str) -> TnsnamesFile {
    let mut scanner = Scanner::new(source);
    let mut entries: Vec<TnsEntry> = Vec::new();
    let mut warnings = Vec::new();

    loop {
        scanner.skip_trivia();
        let Some(current) = scanner.peek() else {
            break;
        };

        // エイリアス名の無い括弧ブロックは対応関係が分からないため捨てる。
        if current == '(' {
            scanner.skip_block();
            warnings.push(String::from("エイリアス名の無い記述子を読み飛ばしました"));
            continue;
        }

        let mut name = String::new();
        loop {
            match scanner.peek() {
                Some('=') => {
                    scanner.bump();
                    break;
                }
                Some('\n') | None => break,
                Some(c) => {
                    name.push(c);
                    scanner.bump();
                }
            }
        }

        let name = name.trim().to_string();
        if name.is_empty() {
            continue;
        }

        // IFILE は別ファイルの取り込み指示である。対応範囲の外なので警告する。
        if name.eq_ignore_ascii_case("ifile") {
            let mut path = String::new();
            while let Some(c) = scanner.peek() {
                if c == '\n' {
                    break;
                }
                path.push(c);
                scanner.bump();
            }
            warnings.push(format!(
                "IFILE には対応していません: {}",
                path.trim().trim_matches('"')
            ));
            continue;
        }

        let aliases = split_aliases(&name);
        if aliases.is_empty() {
            continue;
        }

        scanner.skip_trivia();
        let Some(node) = parse_node(&mut scanner) else {
            warnings.push(format!("{} の記述子を読み取れませんでした", aliases[0]));
            continue;
        };

        entries.push(TnsEntry {
            aliases,
            descriptor: node.render(),
        });
    }

    TnsnamesFile { entries, warnings }
}

/// エイリアス名から接続記述子を引く。
///
/// 大文字小文字は区別しない。Oracle のエイリアスは大文字小文字を問わない。
///
/// # 引数
///
/// * `file` - パース済みの tnsnames.ora
/// * `alias` - 探すエイリアス名
pub fn find_descriptor(file: &TnsnamesFile, alias: &str) -> Option<String> {
    file.entries
        .iter()
        .find(|entry| {
            entry
                .aliases
                .iter()
                .any(|candidate| candidate.eq_ignore_ascii_case(alias))
        })
        .map(|entry| entry.descriptor.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 単純なエントリからエイリアスと記述子を取り出す() {
        // Arrange
        let source = r#"
FREEPDB1 =
  (DESCRIPTION =
    (ADDRESS = (PROTOCOL = TCP)(HOST = localhost)(PORT = 1521))
    (CONNECT_DATA = (SERVICE_NAME = FREEPDB1))
  )
"#;

        // Act
        let parsed = parse_tnsnames(source);

        // Assert
        assert_eq!(parsed.entries.len(), 1);
        assert_eq!(parsed.entries[0].aliases, vec!["FREEPDB1"]);
        assert_eq!(
            parsed.entries[0].descriptor,
            "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=localhost)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=FREEPDB1)))"
        );
        assert!(parsed.warnings.is_empty());
    }

    #[test]
    fn カンマ区切りの別名はすべてエイリアスになる() {
        // Arrange
        let source = "prod, prod.world , PRODUCTION = (DESCRIPTION=(CONNECT_DATA=(SID=orcl)))";

        // Act
        let parsed = parse_tnsnames(source);

        // Assert
        assert_eq!(
            parsed.entries[0].aliases,
            vec!["prod", "prod.world", "PRODUCTION"]
        );
    }

    #[test]
    fn 井桁から行末まではコメントとして無視される() {
        // Arrange
        let source = r#"
# これは説明
DB1 = (DESCRIPTION=(ADDRESS=(HOST=a))) # 行末のコメント
# DB2 = (DESCRIPTION=(ADDRESS=(HOST=b)))
"#;

        // Act
        let parsed = parse_tnsnames(source);

        // Assert
        assert_eq!(parsed.entries.len(), 1);
        assert_eq!(parsed.entries[0].aliases, vec!["DB1"]);
    }

    #[test]
    fn 複数のエントリを順に読み取る() {
        // Arrange
        let source = r#"
A = (DESCRIPTION=(CONNECT_DATA=(SERVICE_NAME=a)))
B = (DESCRIPTION=(CONNECT_DATA=(SERVICE_NAME=b)))
C = (DESCRIPTION=(CONNECT_DATA=(SERVICE_NAME=c)))
"#;

        // Act
        let parsed = parse_tnsnames(source);

        // Assert
        let aliases: Vec<&str> = parsed
            .entries
            .iter()
            .map(|entry| entry.aliases[0].as_str())
            .collect();
        assert_eq!(aliases, vec!["A", "B", "C"]);
    }

    #[test]
    fn 複数のアドレスを持つ記述子はすべてのアドレスを残す() {
        // Arrange
        let source = r#"
HA =
  (DESCRIPTION =
    (ADDRESS_LIST =
      (ADDRESS = (PROTOCOL = TCP)(HOST = node1)(PORT = 1521))
      (ADDRESS = (PROTOCOL = TCP)(HOST = node2)(PORT = 1521))
    )
    (CONNECT_DATA = (SERVICE_NAME = ha))
  )
"#;

        // Act
        let parsed = parse_tnsnames(source);

        // Assert
        assert_eq!(
            parsed.entries[0].descriptor,
            "(DESCRIPTION=(ADDRESS_LIST=(ADDRESS=(PROTOCOL=TCP)(HOST=node1)(PORT=1521))(ADDRESS=(PROTOCOL=TCP)(HOST=node2)(PORT=1521)))(CONNECT_DATA=(SERVICE_NAME=ha)))"
        );
    }

    #[test]
    fn description_listも入れ子のまま読み取れる() {
        // Arrange
        let source = r#"
FAILOVER =
  (DESCRIPTION_LIST =
    (DESCRIPTION = (ADDRESS = (HOST = primary))(CONNECT_DATA = (SERVICE_NAME = svc)))
    (DESCRIPTION = (ADDRESS = (HOST = standby))(CONNECT_DATA = (SERVICE_NAME = svc)))
  )
"#;

        // Act
        let parsed = parse_tnsnames(source);

        // Assert
        assert_eq!(
            parsed.entries[0].descriptor,
            "(DESCRIPTION_LIST=(DESCRIPTION=(ADDRESS=(HOST=primary))(CONNECT_DATA=(SERVICE_NAME=svc)))(DESCRIPTION=(ADDRESS=(HOST=standby))(CONNECT_DATA=(SERVICE_NAME=svc))))"
        );
    }

    #[test]
    fn ifileは警告になり他のエントリは読み取れる() {
        // Arrange
        let source = r#"
IFILE = /etc/oracle/tnsnames_common.ora
LOCAL = (DESCRIPTION=(CONNECT_DATA=(SERVICE_NAME=local)))
"#;

        // Act
        let parsed = parse_tnsnames(source);

        // Assert
        assert_eq!(parsed.entries.len(), 1);
        assert_eq!(parsed.entries[0].aliases, vec!["LOCAL"]);
        assert_eq!(
            parsed.warnings,
            vec!["IFILE には対応していません: /etc/oracle/tnsnames_common.ora"]
        );
    }

    #[test]
    fn 括弧の閉じていないエントリは警告して読み飛ばす() {
        // Arrange
        let source = "BROKEN = (DESCRIPTION=(ADDRESS=(HOST=a)";

        // Act
        let parsed = parse_tnsnames(source);

        // Assert
        assert!(parsed.entries.is_empty());
        assert_eq!(
            parsed.warnings,
            vec!["BROKEN の記述子を読み取れませんでした"]
        );
    }

    #[test]
    fn 空のファイルからは何も取れない() {
        // Arrange
        let source = "\n#  空\n\n";

        // Act
        let parsed = parse_tnsnames(source);

        // Assert
        assert_eq!(parsed, TnsnamesFile::default());
    }

    #[test]
    fn キーは大文字に正規化され値はそのまま残る() {
        // Arrange
        let source = "db = (description=(connect_data=(service_name=MixedCase)))";

        // Act
        let parsed = parse_tnsnames(source);

        // Assert
        assert_eq!(
            parsed.entries[0].descriptor,
            "(DESCRIPTION=(CONNECT_DATA=(SERVICE_NAME=MixedCase)))"
        );
    }

    #[test]
    fn エイリアスの検索は大文字小文字を区別しない() {
        // Arrange
        let parsed = parse_tnsnames("Prod = (DESCRIPTION=(CONNECT_DATA=(SERVICE_NAME=p)))");

        // Act
        let descriptor = find_descriptor(&parsed, "PROD");

        // Assert
        assert_eq!(
            descriptor,
            Some(String::from(
                "(DESCRIPTION=(CONNECT_DATA=(SERVICE_NAME=p)))"
            ))
        );
    }

    #[test]
    fn 見つからないエイリアスにはnoneを返す() {
        // Arrange
        let parsed = parse_tnsnames("A = (DESCRIPTION=(CONNECT_DATA=(SERVICE_NAME=a)))");

        // Act
        let descriptor = find_descriptor(&parsed, "B");

        // Assert
        assert_eq!(descriptor, None);
    }
}
