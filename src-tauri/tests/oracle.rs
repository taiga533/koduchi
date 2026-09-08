//! Oracle を実際に使う統合テスト（ADR 0010）。
//!
//! 環境変数 `KODUCHI_TEST_ORACLE_URL` が設定されているときだけ実行する。
//! 未設定なら何もせずに成功として抜けるため、Docker の無い環境でも
//! `cargo test` は緑になる。
//!
//! ```bash
//! docker compose up -d
//! export KODUCHI_TEST_ORACLE_URL='koduchi/koduchi_dev@localhost:1521/FREEPDB1'
//! cargo test
//! ```
//!
//! `oracle::InitParams::init()` がプロセス 1 回きりであるため、テストは
//! `serial_test` で直列に走らせる。

use koduchi_lib::db::driver::{
    Bind, BindKind, Chunk, ConnectTarget, ConnectionParams, ExecuteOutcome,
};
use koduchi_lib::db::error::DbErrorKind;
use koduchi_lib::db::oracle::instant_client::{self, ClientStatus};
use koduchi_lib::db::pool::{ConnectionPool, DEFAULT_CHUNK_SIZE};
use koduchi_lib::db::schema::{ObjectKind, ObjectKindFilter, SchemaFilter};
use koduchi_lib::db::value::{Cell, CellKind};
use serial_test::serial;

/// 統合テストで使うタブの識別子。
const TAB: &str = "tab-1";

/// 統合テスト用の接続情報を環境変数から読む。
///
/// 形式は `ユーザー/パスワード@接続文字列`。未設定なら `None` を返し、
/// 呼び出し側はテストをスキップする。
fn 接続情報を読む() -> Option<ConnectionParams> {
    let raw = std::env::var("KODUCHI_TEST_ORACLE_URL").ok()?;
    接続情報を解析する(&raw)
}

/// `ユーザー/パスワード@ホスト:ポート/サービス名` を接続情報へ解析する。
///
/// パスワードに `@` が含まれてもよいよう、`@` は右端から探す。
fn 接続情報を解析する(raw: &str) -> Option<ConnectionParams> {
    let (credentials, connect_string) = raw.rsplit_once('@')?;
    let (username, password) = credentials.split_once('/')?;
    let (host_port, service_name) = connect_string.rsplit_once('/')?;
    let (host, port) = host_port.rsplit_once(':')?;

    Some(ConnectionParams {
        username: username.to_string(),
        password: password.to_string(),
        target: ConnectTarget::EzConnect {
            host: host.to_string(),
            port: port.parse().ok()?,
            service_name: service_name.to_string(),
        },
        read_only: false,
        auto_commit: false,
    })
}

/// Instant Client を初期化し、接続プールを開く。
///
/// Instant Client が無い場合や環境変数が未設定の場合は `None` を返し、
/// 呼び出し側のテストは何も検証せずに終わる。
///
/// # 引数
///
/// * `read_only` - 読み取り専用で接続するか
/// * `size` - プールが持つ接続の本数
/// * `chunk_size` - 一度に取り出す行数
fn プールを開く(read_only: bool, size: usize, chunk_size: usize) -> Option<ConnectionPool> {
    let mut params = 接続に使う情報()?;
    params.read_only = read_only;

    Some(ConnectionPool::open(&params, size, chunk_size).unwrap())
}

/// Instant Client を初期化し、統合テスト用の接続情報を返す。
///
/// Instant Client が無い場合や環境変数が未設定の場合は `None` を返し、
/// 呼び出し側のテストは何も検証せずに終わる。
fn 接続に使う情報() -> Option<ConnectionParams> {
    let params = 接続情報を読む()?;

    let candidates =
        instant_client::find_candidate_lib_dirs(&instant_client::default_search_roots());
    let status = instant_client::initialize(candidates.first().map(|dir| dir.as_path()));
    if let ClientStatus::Unavailable { message, .. } = status {
        eprintln!("Instant Client を読み込めないためスキップします: {message}");
        return None;
    }

    Some(params)
}

/// 既定の設定でプールを開く。
fn 接続を開く() -> Option<ConnectionPool> {
    プールを開く(false, 1, DEFAULT_CHUNK_SIZE)
}

/// 自動コミットを有効にしたプールを 1 本開く（ADR 0012）。
fn 自動コミットの接続を開く() -> Option<ConnectionPool> {
    let mut params = 接続に使う情報()?;
    params.auto_commit = true;

    Some(ConnectionPool::open(&params, 1, DEFAULT_CHUNK_SIZE).unwrap())
}

/// 実行結果から未コミットかどうかを取り出す（ADR 0012）。
fn 未コミットか(pool: &ConnectionPool, sql: &str) -> bool {
    match pool.execute(TAB, sql, &[]).unwrap().outcome {
        ExecuteOutcome::Query { in_transaction, .. } => in_transaction,
        ExecuteOutcome::Statement { in_transaction, .. } => in_transaction,
    }
}

/// 統合テストで書き換える 1 行を、テストの前後で元の値へ戻せるよう読み出す。
fn セグメントを読む(pool: &ConnectionPool) -> String {
    一つのセル(
        pool,
        "select segment from koduchi.user_traits where user_id = 1",
    )
    .text
}

/// 問い合わせを実行し、列と最初のかたまりを取り出す。
///
/// 問い合わせ以外の結果が返ったらテストを失敗させる。
fn 問い合わせる(
    pool: &ConnectionPool,
    sql: &str,
) -> (Vec<koduchi_lib::db::driver::Column>, Chunk) {
    match pool.execute(TAB, sql, &[]).unwrap().outcome {
        ExecuteOutcome::Query { columns, chunk, .. } => (columns, chunk),
        other => panic!("問い合わせの結果になるはず: {other:?}"),
    }
}

/// 問い合わせを実行し、最初のセルだけを取り出す。
fn 一つのセル(pool: &ConnectionPool, sql: &str) -> Cell {
    let (_, chunk) = 問い合わせる(pool, sql);
    chunk.rows[0][0].clone()
}

#[test]
fn 接続情報の文字列を解析できる() {
    // Arrange
    let raw = "koduchi/koduchi_dev@localhost:1521/FREEPDB1";

    // Act
    let params = 接続情報を解析する(raw).unwrap();

    // Assert
    assert_eq!(params.username, "koduchi");
    assert_eq!(params.password, "koduchi_dev");
    assert_eq!(params.target.to_connect_string(), "localhost:1521/FREEPDB1");
}

#[test]
fn パスワードにアットマークが含まれても解析できる() {
    // Arrange
    let raw = "koduchi/pa@ss@localhost:1521/FREEPDB1";

    // Act
    let params = 接続情報を解析する(raw).unwrap();

    // Assert
    assert_eq!(params.password, "pa@ss");
}

#[test]
#[serial]
fn 単純な問い合わせの結果を取得できる() {
    // Arrange
    let Some(pool) = 接続を開く() else {
        return;
    };

    // Act
    let (columns, chunk) = 問い合わせる(&pool, "select 1 as n, 'あ' as s from dual");

    // Assert
    assert_eq!(columns.len(), 2);
    assert_eq!(columns[0].name, "N");
    assert_eq!(columns[0].kind, CellKind::Number);
    assert_eq!(columns[1].kind, CellKind::Text);
    assert_eq!(chunk.rows.len(), 1);
    assert!(chunk.exhausted);
    assert_eq!(chunk.rows[0][0].text, "1");
    assert_eq!(chunk.rows[0][1].text, "あ");
}

#[test]
#[serial]
fn number型の38桁が精度を落とさずに届く() {
    // Arrange
    let Some(pool) = 接続を開く() else {
        return;
    };

    // Act
    let cell = 一つのセル(
        &pool,
        "select huge_integer from koduchi.value_kinds where id = 2",
    );

    // Assert
    assert_eq!(cell.text, "99999999999999999999999999999999999999");
}

#[test]
#[serial]
fn nullは空文字列と区別して届く() {
    // Arrange
    let Some(pool) = 接続を開く() else {
        return;
    };

    // Act
    let (_, chunk) = 問い合わせる(
        &pool,
        "select text_value, label from koduchi.value_kinds where id = 3",
    );

    // Assert
    assert_eq!(chunk.rows[0][0].kind, CellKind::Null);
    assert_eq!(chunk.rows[0][1].kind, CellKind::Text);
}

#[test]
#[serial]
fn blobは内容ではなくサイズの要約が届く() {
    // Arrange
    let Some(pool) = 接続を開く() else {
        return;
    };

    // Act
    let cell = 一つのセル(
        &pool,
        "select blob_value from koduchi.value_kinds where id = 6",
    );

    // Assert
    assert_eq!(cell.kind, CellKind::Binary);
    assert_eq!(cell.text, "[BLOB 12.0 KB]");
}

#[test]
#[serial]
fn clobは64kbまでで打ち切られる() {
    // Arrange
    let Some(pool) = 接続を開く() else {
        return;
    };

    // Act
    let cell = 一つのセル(
        &pool,
        "select clob_value from koduchi.value_kinds where id = 5",
    );

    // Assert
    assert_eq!(cell.kind, CellKind::Text);
    assert!(cell.text.len() <= 64 * 1024);
    assert!(cell.text.starts_with('あ'));
}

#[test]
#[serial]
fn 誤ったsqlはエラーとして返る() {
    // Arrange
    let Some(pool) = 接続を開く() else {
        return;
    };

    // Act
    let result = pool.execute(TAB, "select * from 存在しない表", &[]);

    // Assert
    let error = result.expect_err("エラーになるはず");
    assert_eq!(error.kind, DbErrorKind::Execute);
    assert!(
        error.message.contains("ORA-"),
        "想定と違うエラー: {}",
        error.message
    );
}

#[test]
#[serial]
fn dbms_outputの通知が実行結果に添えられる() {
    // Arrange
    let Some(pool) = 接続を開く() else {
        return;
    };

    // Act
    let outcome = pool
        .execute(TAB, "begin koduchi.say_hello(2); end;", &[])
        .unwrap()
        .outcome;

    // Assert
    match outcome {
        ExecuteOutcome::Statement { notices, .. } => assert_eq!(
            notices,
            vec!["小槌からの通知 1 件目", "小槌からの通知 2 件目"]
        ),
        other => panic!("問い合わせ以外の結果になるはず: {other:?}"),
    }
}

#[test]
#[serial]
fn 読み取り専用接続では書き込みが拒まれる() {
    // Arrange
    let Some(pool) = プールを開く(true, 1, DEFAULT_CHUNK_SIZE) else {
        return;
    };

    // Act
    let result = pool.execute(TAB, "update koduchi.user_traits set segment = 'power'", &[]);

    // Assert
    let error = result.expect_err("読み取り専用なので失敗するはず");
    assert!(
        error.message.contains("ORA-01456"),
        "想定と違うエラー: {}",
        error.message
    );
}

#[test]
#[serial]
fn 行が多い問い合わせは千行ずつ返る() {
    // Arrange
    let Some(pool) = 接続を開く() else {
        return;
    };

    // Act
    let (_, chunk) = 問い合わせる(
        &pool,
        "select event_id from koduchi.events where rownum <= 2500",
    );

    // Assert
    assert_eq!(chunk.rows.len(), 1000);
    assert!(!chunk.exhausted);
}

#[test]
#[serial]
fn 続きを取り出すと全行を読み切れる() {
    // Arrange
    let Some(pool) = 接続を開く() else {
        return;
    };
    let (_, 最初) = 問い合わせる(
        &pool,
        "select event_id from koduchi.events where rownum <= 2500",
    );

    // Act
    let 二つ目 = pool.fetch_more(TAB).unwrap();
    let 三つ目 = pool.fetch_more(TAB).unwrap();

    // Assert
    assert_eq!(
        最初.rows.len() + 二つ目.rows.len() + 三つ目.rows.len(),
        2500
    );
    assert!(三つ目.exhausted);
}

#[test]
#[serial]
fn 読み切ったカーソルは閉じられ続きを取り出せなくなる() {
    // Arrange
    let Some(pool) = 接続を開く() else {
        return;
    };
    問い合わせる(&pool, "select 1 from dual");

    // Act
    let result = pool.fetch_more(TAB);

    // Assert
    let error = result.expect_err("カーソルは閉じられているはず");
    assert_eq!(error.kind, DbErrorKind::Closed);
    assert!(error.message.contains("再実行"));
}

#[test]
#[serial]
fn プールの本数を超えると最も古い結果セットが閉じられる() {
    // Arrange: 2 本のプールで 3 つのタブから実行する
    let Some(pool) = プールを開く(false, 2, 10) else {
        return;
    };
    let 多い行 = "select event_id from koduchi.events where rownum <= 100";
    pool.execute("tab-a", 多い行, &[]).unwrap();
    pool.execute("tab-b", 多い行, &[]).unwrap();

    // Act
    let 三つ目 = pool.execute("tab-c", 多い行, &[]).unwrap();

    // Assert
    assert_eq!(三つ目.discarded_tab.as_deref(), Some("tab-a"));
    let error = pool.fetch_more("tab-a").expect_err("閉じられているはず");
    assert!(error.message.contains("再実行"));
}

#[test]
#[serial]
fn 使い続けているタブは閉じられない() {
    // Arrange: 2 本のプールで、tab-a を挟んで使い続ける
    let Some(pool) = プールを開く(false, 2, 10) else {
        return;
    };
    let 多い行 = "select event_id from koduchi.events where rownum <= 100";
    pool.execute("tab-a", 多い行, &[]).unwrap();
    pool.execute("tab-b", 多い行, &[]).unwrap();
    pool.fetch_more("tab-a").unwrap();

    // Act
    let 三つ目 = pool.execute("tab-c", 多い行, &[]).unwrap();

    // Assert
    assert_eq!(三つ目.discarded_tab.as_deref(), Some("tab-b"));
    assert!(pool.fetch_more("tab-a").is_ok());
}

#[test]
#[serial]
fn タブを閉じると接続が明け渡される() {
    // Arrange: 1 本のプールを tab-a が占有している状態
    let Some(pool) = プールを開く(false, 1, 10) else {
        return;
    };
    let 多い行 = "select event_id from koduchi.events where rownum <= 100";
    pool.execute("tab-a", 多い行, &[]).unwrap();

    // Act
    pool.release("tab-a").unwrap();
    let 次 = pool.execute("tab-b", 多い行, &[]).unwrap();

    // Assert
    assert_eq!(次.discarded_tab, None);
}

#[test]
#[serial]
fn 同じタブで実行し直すと前の結果セットが閉じられる() {
    // Arrange
    let Some(pool) = プールを開く(false, 1, 10) else {
        return;
    };
    let 多い行 = "select event_id from koduchi.events where rownum <= 100";
    pool.execute(TAB, 多い行, &[]).unwrap();

    // Act
    let (_, chunk) = 問い合わせる(&pool, 多い行);
    let 続き = pool.fetch_more(TAB).unwrap();

    // Assert: 読み直しになるため、続きは 11 行目からになる
    assert_eq!(chunk.rows.len(), 10);
    assert_eq!(続き.rows.len(), 10);
}

#[test]
#[serial]
fn スキーマ一覧に開発用のスキーマが並ぶ() {
    // Arrange
    let Some(pool) = 接続を開く() else {
        return;
    };

    // Act
    let schemas = pool.schema_overview(&SchemaFilter::default()).unwrap();

    // Assert
    let names: Vec<&str> = schemas.iter().map(|schema| schema.name.as_str()).collect();
    assert!(names.contains(&"KODUCHI"));
    assert!(names.contains(&"KODUCHI_ANALYTICS"));
}

#[test]
#[serial]
fn 既定のフィルタではシステムスキーマが並ばない() {
    // Arrange
    let Some(pool) = 接続を開く() else {
        return;
    };

    // Act
    let schemas = pool.schema_overview(&SchemaFilter::default()).unwrap();

    // Assert
    let names: Vec<&str> = schemas.iter().map(|schema| schema.name.as_str()).collect();
    assert!(!names.contains(&"SYS"));
    assert!(!names.contains(&"SYSTEM"));
}

#[test]
#[serial]
fn 既定のフィルタではオブジェクトの無いスキーマが隠れる() {
    // Arrange
    let Some(pool) = 接続を開く() else {
        return;
    };

    // Act
    let schemas = pool.schema_overview(&SchemaFilter::default()).unwrap();

    // Assert
    let names: Vec<&str> = schemas.iter().map(|schema| schema.name.as_str()).collect();
    assert!(!names.contains(&"KODUCHI_EMPTY"));
}

#[test]
#[serial]
fn フィルタを外すとシステムスキーマも並ぶ() {
    // Arrange
    let Some(pool) = 接続を開く() else {
        return;
    };
    let filter = SchemaFilter {
        exclude_system: false,
        hide_empty: false,
        ..SchemaFilter::default()
    };

    // Act
    let schemas = pool.schema_overview(&filter).unwrap();

    // Assert
    let names: Vec<&str> = schemas.iter().map(|schema| schema.name.as_str()).collect();
    assert!(names.contains(&"SYS"));
    assert!(names.contains(&"KODUCHI_EMPTY"));
}

#[test]
#[serial]
fn スキーマはオブジェクトの名前と数を持つ() {
    // Arrange
    let Some(pool) = 接続を開く() else {
        return;
    };

    // Act
    let schemas = pool.schema_overview(&SchemaFilter::default()).unwrap();

    // Assert
    let koduchi = schemas
        .iter()
        .find(|schema| schema.name == "KODUCHI")
        .expect("KODUCHI スキーマがあるはず");
    assert_eq!(koduchi.object_count, koduchi.objects.len());
    assert!(koduchi.objects.iter().any(|object| object.name == "EVENTS"));
    assert!(koduchi
        .objects
        .iter()
        .any(|object| object.name == "SESSION_ROLLUP" && object.kind == ObjectKind::View));
}

/// スキーマ 1 つぶんのオブジェクトから、種別の合う名前を取り出す。
///
/// # 引数
///
/// * `schemas` - 段階 1 の結果
/// * `owner` - 見たいスキーマ名
/// * `kind` - 見たい種別
fn 種別の名前(
    schemas: &[koduchi_lib::db::schema::SchemaNode],
    owner: &str,
    kind: ObjectKind,
) -> Vec<String> {
    schemas
        .iter()
        .find(|schema| schema.name == owner)
        .map(|schema| {
            schema
                .objects
                .iter()
                .filter(|object| object.kind == kind)
                .map(|object| object.name.clone())
                .collect()
        })
        .unwrap_or_default()
}

#[test]
#[serial]
fn 索引とトリガーとシノニムと型がツリーに並ぶ() {
    // Arrange
    let Some(pool) = 接続を開く() else {
        return;
    };

    // Act
    let schemas = pool.schema_overview(&SchemaFilter::default()).unwrap();

    // Assert
    assert!(種別の名前(&schemas, "KODUCHI", ObjectKind::Index)
        .contains(&String::from("IX_EVENTS_CREATED")));
    assert!(種別の名前(&schemas, "KODUCHI", ObjectKind::Trigger)
        .contains(&String::from("TRG_USER_TRAITS_TOUCH")));
    assert!(
        種別の名前(&schemas, "KODUCHI", ObjectKind::Synonym).contains(&String::from("DAILY_GMV"))
    );
    assert!(
        種別の名前(&schemas, "KODUCHI", ObjectKind::Type).contains(&String::from("ORDER_SUMMARY"))
    );
}

#[test]
#[serial]
fn all_objectsから取る種別がひととおり並ぶ() {
    // Arrange: 種別を足したとき列挙元の割り当てを忘れないための歯止め
    let Some(pool) = 接続を開く() else {
        return;
    };

    // Act
    let schemas = pool.schema_overview(&SchemaFilter::default()).unwrap();

    // Assert
    assert!(種別の名前(&schemas, "KODUCHI", ObjectKind::Table).contains(&String::from("EVENTS")));
    assert!(
        種別の名前(&schemas, "KODUCHI", ObjectKind::View).contains(&String::from("SESSION_ROLLUP"))
    );
    assert!(種別の名前(&schemas, "KODUCHI", ObjectKind::Function)
        .contains(&String::from("ORDER_TOTAL")));
    assert!(
        種別の名前(&schemas, "KODUCHI", ObjectKind::Procedure).contains(&String::from("SAY_HELLO"))
    );
    assert!(
        種別の名前(&schemas, "KODUCHI", ObjectKind::Package).contains(&String::from("ORDER_STATS"))
    );

    // 仕様と本体で 2 行にならない（`PACKAGE BODY` は種別として扱わない）
    let 同名 = schemas
        .iter()
        .find(|schema| schema.name == "KODUCHI")
        .expect("KODUCHI スキーマがあるはず")
        .objects
        .iter()
        .filter(|object| object.name == "ORDER_STATS")
        .count();
    assert_eq!(同名, 1);
}

#[test]
#[serial]
fn 自動生成された索引は並ばない() {
    // Arrange: 主キーの索引は SYS_C0012345 のような名前で作られる
    let Some(pool) = 接続を開く() else {
        return;
    };

    // Act
    let schemas = pool.schema_overview(&SchemaFilter::default()).unwrap();

    // Assert
    let 索引 = 種別の名前(&schemas, "KODUCHI", ObjectKind::Index);
    assert!(!索引.is_empty());
    assert!(!索引.iter().any(|name| name.starts_with("SYS_")));
}

#[test]
#[serial]
fn 種別を落とすとその種別が並ばなくなる() {
    // Arrange
    let Some(pool) = 接続を開く() else {
        return;
    };
    let filter = SchemaFilter {
        kinds: ObjectKindFilter {
            index: false,
            trigger: false,
            ..ObjectKindFilter::default()
        },
        ..SchemaFilter::default()
    };

    // Act
    let schemas = pool.schema_overview(&filter).unwrap();

    // Assert
    assert!(種別の名前(&schemas, "KODUCHI", ObjectKind::Index).is_empty());
    assert!(種別の名前(&schemas, "KODUCHI", ObjectKind::Trigger).is_empty());
    assert!(!種別の名前(&schemas, "KODUCHI", ObjectKind::Table).is_empty());
}

#[test]
#[serial]
fn 公開シノニムはツリーに並ばない() {
    // Arrange: PUBLIC は ALL_USERS に載らない擬似的な所有者である
    let Some(pool) = 接続を開く() else {
        return;
    };
    let filter = SchemaFilter {
        exclude_system: false,
        hide_empty: false,
        ..SchemaFilter::default()
    };

    // Act
    let schemas = pool.schema_overview(&filter).unwrap();

    // Assert
    let names: Vec<&str> = schemas.iter().map(|schema| schema.name.as_str()).collect();
    assert!(!names.contains(&"PUBLIC"));
}

#[test]
#[serial]
fn db_linkは所有者のスキーマに並ぶ() {
    // Arrange: DB link は接続中のユーザーのスキーマにしか作れない
    let Some(pool) = 接続を開く() else {
        return;
    };
    let _ = pool.execute(TAB, "drop database link koduchi_selflink", &[]);
    pool.execute(
        TAB,
        "create database link koduchi_selflink
         connect to koduchi identified by koduchi_dev
         using 'localhost:1521/FREEPDB1'",
        &[],
    )
    .unwrap();

    // Act
    let schemas = pool.schema_overview(&SchemaFilter::default()).unwrap();

    // Assert
    let links = 種別の名前(&schemas, "KODUCHI", ObjectKind::DatabaseLink);
    pool.execute(TAB, "drop database link koduchi_selflink", &[])
        .unwrap();
    assert!(links
        .iter()
        .any(|name| name.starts_with("KODUCHI_SELFLINK")));
}

#[test]
#[serial]
fn スキーマの列情報を取り出せる() {
    // Arrange
    let Some(pool) = 接続を開く() else {
        return;
    };

    // Act
    let columns = pool.schema_columns("KODUCHI").unwrap();

    // Assert
    let user_id = columns
        .iter()
        .find(|column| column.object_name == "USERS" && column.name == "USER_ID")
        .expect("USERS.USER_ID があるはず");
    assert_eq!(user_id.kind, CellKind::Number);
    assert_eq!(user_id.type_name, "NUMBER(12)");

    let email = columns
        .iter()
        .find(|column| column.object_name == "USERS" && column.name == "EMAIL")
        .expect("USERS.EMAIL があるはず");
    assert_eq!(email.type_name, "VARCHAR2(255)");
    assert!(!email.nullable);
}

#[test]
#[serial]
fn バインド変数へ与えた値で絞り込める() {
    // Arrange
    let Some(pool) = 接続を開く() else {
        return;
    };
    let binds = vec![Bind::text("keyword", Some("dual"))];

    // Act
    let outcome = pool
        .execute(TAB, "select :keyword from dual", &binds)
        .unwrap()
        .outcome;

    // Assert
    match outcome {
        ExecuteOutcome::Query { chunk, .. } => assert_eq!(chunk.rows[0][0].text, "dual"),
        other => panic!("問い合わせの結果になるはず: {other:?}"),
    }
}

#[test]
#[serial]
fn nullを与えたバインド変数はnullとして届く() {
    // Arrange
    let Some(pool) = 接続を開く() else {
        return;
    };
    let binds = vec![Bind::text("memo", None)];

    // Act
    let outcome = pool
        .execute(
            TAB,
            "select case when :memo is null then 'NULL である' else 'NULL でない' end from dual",
            &binds,
        )
        .unwrap()
        .outcome;

    // Assert
    match outcome {
        ExecuteOutcome::Query { chunk, .. } => assert_eq!(chunk.rows[0][0].text, "NULL である"),
        other => panic!("問い合わせの結果になるはず: {other:?}"),
    }
}

#[test]
#[serial]
fn 文に無いバインド変数を渡しても実行できる() {
    // Arrange: 抽出の見立てが Oracle とずれても実行そのものは落とさない
    let Some(pool) = 接続を開く() else {
        return;
    };
    let binds = vec![
        Bind::text("id", Some("1")),
        Bind::text("使わない", Some("x")),
    ];

    // Act
    let outcome = pool
        .execute(TAB, "select :id from dual", &binds)
        .unwrap()
        .outcome;

    // Assert
    match outcome {
        ExecuteOutcome::Query { chunk, .. } => assert_eq!(chunk.rows[0][0].text, "1"),
        other => panic!("問い合わせの結果になるはず: {other:?}"),
    }
}

#[test]
#[serial]
fn 選んだ型のままoracleへ届く() {
    // Arrange: `DUMP` の `Typ` はデータ型の番号で、1 が VARCHAR2、2 が NUMBER、
    // 12 が DATE、180 が TIMESTAMP である（ADR 0016）
    let Some(pool) = 接続を開く() else {
        return;
    };
    let binds = vec![
        Bind::text("t", Some("42")),
        Bind::new("n", BindKind::Number, Some(String::from("42"))),
        Bind::new("d", BindKind::Date, Some(String::from("2024-03-04"))),
        Bind::new(
            "s",
            BindKind::Timestamp,
            Some(String::from("2024-03-04 05:06:07.123456")),
        ),
    ];

    // Act
    let outcome = pool
        .execute(
            TAB,
            "select dump(:t), dump(:n), dump(:d), dump(:s) from dual",
            &binds,
        )
        .unwrap()
        .outcome;

    // Assert
    match outcome {
        ExecuteOutcome::Query { chunk, .. } => {
            let 型番号: Vec<&str> = chunk.rows[0]
                .iter()
                .map(|cell| cell.text.split(['=', ' ']).nth(1).unwrap_or(""))
                .collect();
            assert_eq!(型番号, vec!["1", "2", "12", "180"]);
        }
        other => panic!("問い合わせの結果になるはず: {other:?}"),
    }
}

#[test]
#[serial]
fn 日付として渡した値は時刻まで保たれる() {
    // Arrange
    let Some(pool) = 接続を開く() else {
        return;
    };
    let binds = vec![Bind::new(
        "day",
        BindKind::Date,
        Some(String::from("2024-03-04 05:06:07")),
    )];

    // Act
    let outcome = pool
        .execute(
            TAB,
            "select to_char(:day, 'YYYY-MM-DD HH24:MI:SS') from dual",
            &binds,
        )
        .unwrap()
        .outcome;

    // Assert
    match outcome {
        ExecuteOutcome::Query { chunk, .. } => {
            assert_eq!(chunk.rows[0][0].text, "2024-03-04 05:06:07")
        }
        other => panic!("問い合わせの結果になるはず: {other:?}"),
    }
}

#[test]
#[serial]
fn 型として読めない値は実行する前にエラーになる() {
    // Arrange: `ORA-` の文言ではなく、どの変数のどの値かが分かる形で返す
    let Some(pool) = 接続を開く() else {
        return;
    };
    let binds = vec![Bind::new(
        "day",
        BindKind::Date,
        Some(String::from("きのう")),
    )];

    // Act
    let error = pool
        .execute(TAB, "select :day from dual", &binds)
        .unwrap_err();

    // Assert
    assert_eq!(error.kind, DbErrorKind::Execute);
    assert!(
        error.message.contains(":day") && error.message.contains("きのう"),
        "メッセージ: {}",
        error.message
    );
}

#[test]
#[serial]
fn バインド変数を含む文でも見積りの実行計画を取れる() {
    // Arrange
    let Some(pool) = 接続を開く() else {
        return;
    };
    let binds = vec![Bind::new(
        "user_id",
        BindKind::Number,
        Some(String::from("1")),
    )];

    // Act
    let plan = pool
        .explain_plan("select * from users where user_id = :user_id", &binds)
        .unwrap();

    // Assert
    assert!(plan.contains("SELECT STATEMENT"), "計画の中身: {plan}");
}

#[test]
#[serial]
fn バインド変数を含む文でも実測付きの実行計画を取れる() {
    // Arrange
    let Some(pool) = 接続を開く() else {
        return;
    };
    let binds = vec![Bind::new(
        "user_id",
        BindKind::Number,
        Some(String::from("1")),
    )];

    // Act
    let plan = pool
        .actual_plan(
            "select count(*) from users where user_id = :user_id",
            &binds,
        )
        .unwrap();

    // Assert
    assert!(plan.contains("A-Rows"), "計画の中身: {plan}");
}

#[test]
#[serial]
fn 見積りの実行計画を取り出せる() {
    // Arrange
    let Some(pool) = 接続を開く() else {
        return;
    };

    // Act
    let plan = pool
        .explain_plan("select * from users where user_id = 1", &[])
        .unwrap();

    // Assert
    assert!(plan.contains("SELECT STATEMENT"), "計画の中身: {plan}");
}

#[test]
#[serial]
fn 実測付きの実行計画には実際の行数が並ぶ() {
    // Arrange
    let Some(pool) = 接続を開く() else {
        return;
    };

    // Act
    let plan = pool.actual_plan("select count(*) from users", &[]).unwrap();

    // Assert
    assert!(plan.contains("A-Rows"), "計画の中身: {plan}");
}

#[test]
#[serial]
fn 読み取り専用の接続でも見積りの実行計画を取れる() {
    // Arrange
    let Some(pool) = プールを開く(true, 1, DEFAULT_CHUNK_SIZE) else {
        return;
    };

    // Act
    let plan = pool.explain_plan("select * from users", &[]).unwrap();

    // Assert
    assert!(plan.contains("SELECT STATEMENT"), "計画の中身: {plan}");
}

#[test]
#[serial]
fn 実行計画を取った後も読み取り専用は保たれる() {
    // Arrange
    let Some(pool) = プールを開く(true, 1, DEFAULT_CHUNK_SIZE) else {
        return;
    };
    pool.explain_plan("select * from users", &[]).unwrap();

    // Act
    let error = pool
        .execute(
            TAB,
            "insert into users (email) values ('x@example.com')",
            &[],
        )
        .expect_err("読み取り専用なので書き込めないはず");

    // Assert
    assert_eq!(error.kind, DbErrorKind::Execute);
    assert!(
        error.message.contains("ORA-01456"),
        "実際: {}",
        error.message
    );
}

#[test]
#[serial]
fn テスト接続は繋いだ先のバージョンを返す() {
    // Arrange
    let Some(params) = 接続に使う情報() else {
        return;
    };

    // Act
    let version = koduchi_lib::db::check_connection(&params).unwrap();

    // Assert
    assert_eq!(
        version.split('.').count(),
        5,
        "5 つの数字を並べた形になるはず: {version}"
    );
}

#[test]
#[serial]
fn テスト接続は誤ったパスワードを接続のエラーとして返す() {
    // Arrange
    let Some(mut params) = 接続に使う情報() else {
        return;
    };
    params.password = String::from("誤ったパスワード");

    // Act
    let error = koduchi_lib::db::check_connection(&params).unwrap_err();

    // Assert
    assert_eq!(error.kind, DbErrorKind::Connect);
}

#[test]
#[serial]
fn 問い合わせだけでは未コミットにならない() {
    // Arrange
    let Some(pool) = 接続を開く() else {
        return;
    };

    // Act
    let 未コミット = 未コミットか(&pool, "select 1 from dual");

    // Assert
    assert!(!未コミット);
}

#[test]
#[serial]
fn 手動コミットの接続では更新の直後が未コミットになる() {
    // Arrange
    let Some(pool) = 接続を開く() else {
        return;
    };

    // Act
    let 未コミット = 未コミットか(
        &pool,
        "update koduchi.user_traits set sessions_28d = sessions_28d where user_id = 1",
    );

    // Assert
    assert!(未コミット);
    pool.rollback().unwrap();
}

#[test]
#[serial]
fn 無名plsqlブロックの書き込みも未コミットとして拾える() {
    // Arrange: 先頭キーワードの判定ではすり抜ける形（ADR 0012）
    let Some(pool) = 接続を開く() else {
        return;
    };

    // Act
    let 未コミット = 未コミットか(
        &pool,
        "begin update koduchi.user_traits set sessions_28d = sessions_28d where user_id = 1; end;",
    );

    // Assert
    assert!(未コミット);
    pool.rollback().unwrap();
}

#[test]
#[serial]
fn ロールバックすると未コミットが解消し変更も消える() {
    // Arrange
    let Some(pool) = 接続を開く() else {
        return;
    };
    let 元の値 = セグメントを読む(&pool);
    pool.execute(
        TAB,
        "update koduchi.user_traits set segment = 'ロールバックされる' where user_id = 1",
        &[],
    )
    .unwrap();

    // Act
    pool.rollback().unwrap();

    // Assert
    assert_eq!(セグメントを読む(&pool), 元の値);
    assert!(!未コミットか(&pool, "select 1 from dual"));
}

#[test]
#[serial]
fn コミットすると変更が残り未コミットも解消する() {
    // Arrange
    let Some(pool) = 接続を開く() else {
        return;
    };
    let 元の値 = セグメントを読む(&pool);
    pool.execute(
        TAB,
        "update koduchi.user_traits set segment = 'コミットされる' where user_id = 1",
        &[],
    )
    .unwrap();

    // Act
    pool.commit().unwrap();

    // Assert
    assert_eq!(セグメントを読む(&pool), "コミットされる");
    assert!(!未コミットか(&pool, "select 1 from dual"));

    // 後片付け: 元の値へ戻す
    pool.execute(
        TAB,
        &format!("update koduchi.user_traits set segment = '{元の値}' where user_id = 1"),
        &[],
    )
    .unwrap();
    pool.commit().unwrap();
}

#[test]
#[serial]
fn 自動コミットの接続では更新の直後も未コミットにならない() {
    // Arrange
    let Some(pool) = 自動コミットの接続を開く() else {
        return;
    };
    let 元の値 = セグメントを読む(&pool);

    // Act
    let 未コミット = 未コミットか(
        &pool,
        "update koduchi.user_traits set segment = '自動コミット' where user_id = 1",
    );

    // Assert
    assert!(!未コミット);
    assert_eq!(セグメントを読む(&pool), "自動コミット");

    // 後片付け
    pool.execute(
        TAB,
        &format!("update koduchi.user_traits set segment = '{元の値}' where user_id = 1"),
        &[],
    )
    .unwrap();
}

#[test]
#[serial]
fn 読み取り専用の接続は未コミットにならない() {
    // Arrange: `SET TRANSACTION READ ONLY` 自体はトランザクションを開くが、
    // コミットすべき変更は生じない（ADR 0012）
    let Some(pool) = プールを開く(true, 1, DEFAULT_CHUNK_SIZE) else {
        return;
    };

    // Act
    let 未コミット = 未コミットか(&pool, "select count(*) from koduchi.user_traits");

    // Assert
    assert!(!未コミット);
}

#[test]
#[serial]
fn 読み取り専用の接続はコミットしても読み取り専用のままである() {
    // Arrange
    let Some(pool) = プールを開く(true, 1, DEFAULT_CHUNK_SIZE) else {
        return;
    };

    // Act
    pool.commit().unwrap();

    // Assert
    let error = pool
        .execute(TAB, "update koduchi.user_traits set segment = 'power'", &[])
        .expect_err("読み取り専用なので書き込めないはず");
    assert!(
        error.message.contains("ORA-01456"),
        "想定と違うエラー: {}",
        error.message
    );
}

#[test]
#[serial]
fn セッションの一覧は自分自身を含む() {
    // Arrange: 一覧は結果セットを保持していない接続で読む（ADR 0017）
    let Some(pool) = 接続を開く() else {
        return;
    };

    // Act
    let overview = pool.list_sessions().unwrap();

    // Assert
    let 自分 = overview
        .find(overview.current_sid)
        .expect("自分自身のセッションが一覧に居るはず");
    assert!(自分.own, "自分自身には小槌の接続として印が付くはず");
    assert!(overview.instance >= 1);
}

#[test]
#[serial]
fn 同じプールの接続はすべて小槌のものとして印が付く() {
    // Arrange: プールの 4 本は同じクライアントプロセスから張られる
    let Some(pool) = プールを開く(false, 4, DEFAULT_CHUNK_SIZE) else {
        return;
    };

    // Act
    let overview = pool.list_sessions().unwrap();

    // Assert
    let 小槌の接続 = overview.sessions.iter().filter(|s| s.own).count();
    assert!(
        小槌の接続 >= 4,
        "プールの 4 本すべてに印が付くはず: {小槌の接続}"
    );
}

#[test]
#[serial]
fn セッションの一覧を読んでも結果セットは壊れない() {
    // Arrange: 開いたままのカーソルを持たせてから一覧を読む（ADR 0003・0017）
    let Some(pool) = 接続を開く() else {
        return;
    };
    pool.execute(TAB, "select event_id from koduchi.events", &[])
        .unwrap();

    // Act
    pool.list_sessions().unwrap();

    // Assert
    let chunk = pool.fetch_more(TAB).unwrap();
    assert_eq!(chunk.rows.len(), DEFAULT_CHUNK_SIZE);
}

#[test]
#[serial]
fn 自分自身のセッションはkillできない() {
    // Arrange
    let Some(pool) = 接続を開く() else {
        return;
    };
    let overview = pool.list_sessions().unwrap();
    let 自分 = overview.find(overview.current_sid).unwrap().clone();

    // Act
    let error = pool
        .kill_session(自分.sid, 自分.serial)
        .expect_err("自分自身は落とせないはず");

    // Assert
    assert!(
        error.message.contains("自分自身") || error.message.contains("小槌自身"),
        "想定と違うエラー: {}",
        error.message
    );
}

#[test]
#[serial]
fn 読み取り専用の接続ではkillできない() {
    // Arrange: `ALTER SYSTEM` は読み取り専用トランザクションでは止まらないため、
    // クライアント側で弾く（ADR 0017）
    let Some(pool) = プールを開く(true, 1, DEFAULT_CHUNK_SIZE) else {
        return;
    };

    // Act
    let error = pool
        .kill_session(1, 1)
        .expect_err("読み取り専用なので落とせないはず");

    // Assert
    assert_eq!(error.kind, DbErrorKind::Permission);
}
