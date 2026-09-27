//! 自動アップデートの設定の見張り（ADR 0042）。
//!
//! 確認先・公開鍵・権限のどれかが外れても、手元の `tauri dev` は何も変わらない。
//! 気付くのは配った版が更新を見つけられなかったときであり、そのときには利用者に
//! 手で入れ直してもらうしかない。エンタイトルメント（ADR 0028）と同じ理由で、
//! 設定をテストで見張る。

use base64::Engine;
use std::fs;
use std::path::PathBuf;

/// 確認先。公開済みの最新のリリースに添付した latest.json を指す。
const ENDPOINT: &str = "https://github.com/taiga533/koduchi/releases/latest/download/latest.json";

/// `src-tauri/` の中のファイルを JSON として読む。
///
/// # 引数
///
/// * `relative` - `src-tauri/` からの相対パス
fn read_json(relative: &str) -> serde_json::Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relative);
    let text = fs::read_to_string(&path).unwrap_or_else(|_| panic!("{relative} を読めるはず"));
    serde_json::from_str(&text).unwrap_or_else(|_| panic!("{relative} は JSON"))
}

#[test]
fn 確認先は公開済みの最新リリースのlatest_jsonだけである() {
    // Arrange
    let config = read_json("tauri.conf.json");

    // Act
    let endpoints = &config["plugins"]["updater"]["endpoints"];

    // Assert
    assert_eq!(endpoints, &serde_json::json!([ENDPOINT]));
}

#[test]
fn 公開鍵はminisignの公開鍵として読める() {
    // Arrange
    let config = read_json("tauri.conf.json");
    let pubkey = config["plugins"]["updater"]["pubkey"]
        .as_str()
        .expect("plugins.updater.pubkey は文字列");

    // Act
    // tauri-plugin-updater と同じく、base64 を解いてから minisign の公開鍵として読む。
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(pubkey)
        .expect("公開鍵は base64 で書く");
    let text = String::from_utf8(decoded).expect("公開鍵を解いた中身は文字列");
    let key = minisign_verify::PublicKey::decode(&text);

    // Assert
    assert!(key.is_ok(), "minisign の公開鍵として読めない: {key:?}");
}

#[test]
fn 更新用の成果物の生成を手元のビルドに課さない() {
    // Arrange
    let config = read_json("tauri.conf.json");

    // Act
    let create_updater_artifacts = &config["bundle"]["createUpdaterArtifacts"];

    // Assert
    // 書くと手元の `tauri build` まで署名鍵を要求する。リリースの CI が `--config` で足す。
    assert!(
        create_updater_artifacts.is_null(),
        "createUpdaterArtifacts は release.yml の --config で渡す"
    );
}

#[test]
fn 権限は更新の確認と入れ替えを許している() {
    // Arrange
    let capability = read_json("capabilities/default.json");

    // Act
    let permissions = capability["permissions"]
        .as_array()
        .expect("permissions は配列");

    // Assert
    assert!(permissions.contains(&serde_json::json!("updater:default")));
}
