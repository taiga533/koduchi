//! Oracle のエラーが必ず写し替えを通ることの見張り（ADR 0026・0030）。
//!
//! 接続断は**どの往復でも**起こる。実行だけでなく、スキーマ取得・テーブル定義・
//! 実行計画・セッション一覧・ソース検索・値の取り出しでも同じ番号が返る。
//! それを `DbErrorKind::ConnectionLost` として返せるのは、Oracle のエラーを
//! `errors.rs` の写し替え（`map_execute_error` / `map_oracle_error` /
//! `map_permission_error`）に通した経路だけである。
//!
//! **通さずに `DbError::execute` を直に作ると、その経路だけが断に気付けない。**
//! フロントエンド側は `src/api/` の窓口を丸ごと包んで 1 箇所で見張っている
//! （ADR 0026）が、Rust 側が断を断として返さなければその見張りには何も届かない。
//! 実際、ADR 0026 の時点では SQL の実行だけが写し替えを通っており、スキーマ
//! ツリーを開いても定義タブを開いても切れたことに気付けなかった（ADR 0030）。
//!
//! 1 箇所ずつ「この経路で `ORA-03113` が来たら `connectionLost` になる」と
//! 書くと、**次に経路を足した人がまた抜かす。**そこで、抜けを構造として塞ぐ。
//! `src/db/oracle/` を数え上げ、直に作ってよい場所とその件数を決め打ちで
//! 見張る。決め打ちにしてあるのは、**許した場所の中で件数が増えたときにも
//! 落ちる**ようにするためである。落ちたら、その 1 件が本当にデータベースへ
//! 行っていない失敗なのかを考えること。

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

/// 探す綴り。これが現れたら写し替えを通していない。
const 直の組み立て: &str = "DbError::execute(";

/// `DbError::execute` を直に作ってよい場所と、そこにある件数。
///
/// - `errors.rs`: 写し替えそのものの実装。ここが最後の出口である。
/// - `bind.rs`: バインド変数へ与えられた値が読めないという**クライアント側の
///   失敗**。データベースへは行っていないため、接続断ではありえない。
const 直に作ってよい場所: &[(&str, usize)] = &[("errors.rs", 2), ("bind.rs", 1)];

/// `src/db/oracle/` の中の `.rs` を、ファイル名から中身へ引ける形で読む。
fn oracleのソース() -> BTreeMap<String, String> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/db/oracle");
    let mut sources = BTreeMap::new();

    for entry in fs::read_dir(&dir).expect("src/db/oracle を読めるはず") {
        let path = entry.expect("ディレクトリの項目を読めるはず").path();
        if path.extension().and_then(|e| e.to_str()) != Some("rs") {
            continue;
        }

        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .expect("ファイル名は UTF-8")
            .to_string();
        sources.insert(name, fs::read_to_string(&path).expect("ソースを読めるはず"));
    }

    sources
}

#[test]
fn oracleのエラーは写し替えを通さずにdberrorへならない() {
    // Arrange
    let sources = oracleのソース();
    let 許した: BTreeMap<&str, usize> = 直に作ってよい場所.iter().copied().collect();

    // Act: ファイルごとに、直に組み立てている件数を数える
    let 数えた: BTreeMap<&str, usize> = sources
        .iter()
        .map(|(name, text)| (name.as_str(), text.matches(直の組み立て).count()))
        .filter(|(_, count)| *count > 0)
        .collect();

    // Assert: 許した場所の、許した件数だけであること
    for (name, count) in &数えた {
        let 許した件数 = 許した.get(name).copied().unwrap_or(0);
        assert_eq!(
            *count, 許した件数,
            "{name} が `DbError::execute` を直に作っている件数が {許した件数} 件から {count} 件へ変わった。\
             Oracle のエラーであれば `errors::map_execute_error` を通すこと（ADR 0026・0030）。\
             データベースへ行っていない失敗であれば、このテストの `直に作ってよい場所` を直すこと"
        );
    }

    // 許したのに 1 件も無い、という取り残しも拾う
    for (name, 件数) in 直に作ってよい場所 {
        assert_eq!(
            数えた.get(name).copied().unwrap_or(0),
            *件数,
            "{name} に `DbError::execute` が {件数} 件あるはずが見つからない。\
             減ったのなら `直に作ってよい場所` も一緒に直すこと"
        );
    }
}

#[test]
fn ソースを実際に読めている() {
    // Arrange: 上のテストが「1 つも読めなかったから緑」になっていないことを見る

    // Act
    let sources = oracleのソース();

    // Assert
    assert!(sources.contains_key("errors.rs"));
    assert!(sources.contains_key("schema.rs"));
    assert!(sources.len() >= 8);
}
