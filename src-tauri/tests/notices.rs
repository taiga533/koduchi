//! 配布物に条文と第三者の著作権表示が同梱されることの見張り（ADR 0029）。
//!
//! MIT / Apache-2.0 / BSD / OFL はいずれも著作権表示を複製に含めることを求めており、
//! この義務は**バイナリの配布にも掛かる**。PolyForm Noncommercial License 1.0.0 の
//! Notices も、複製を受け取る者へ条文か URL を渡すよう求めている。
//!
//! `bundle.resources` から外れても手元の `bun run tauri dev` は何も変わらないため、
//! **リリースして配ってからでないと気づけない**。エンタイトルメント（ADR 0028）と
//! 同じ理由で、ファイルの指定と実在をテストで見張る。

use std::fs;
use std::path::PathBuf;

/// 配布物へ必ず同梱するファイル。`tauri.conf.json` からの相対パスで書く。
const REQUIRED_RESOURCES: [&str; 2] = ["../LICENSE", "../THIRD-PARTY-NOTICES.md"];

/// `src-tauri/` の中のパスを絶対パスにする。
///
/// # 引数
///
/// * `relative` - `src-tauri/` からの相対パス
fn manifest_path(relative: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relative)
}

/// `tauri.conf.json` の `bundle.resources` を読む。
fn bundle_resources() -> serde_json::Value {
    let text =
        fs::read_to_string(manifest_path("tauri.conf.json")).expect("tauri.conf.json を読めるはず");
    let config: serde_json::Value = serde_json::from_str(&text).expect("tauri.conf.json は JSON");

    config["bundle"]["resources"].clone()
}

#[test]
fn tauri設定は条文と第三者の著作権表示を同梱している() {
    // Arrange
    let resources = bundle_resources();

    // Act
    let map = resources
        .as_object()
        .expect("bundle.resources は source から target への表で書く");

    // Assert
    for required in REQUIRED_RESOURCES {
        assert!(
            map.contains_key(required),
            "{required} が bundle.resources から外れると、配布物が著作権表示の同梱義務を満たさなくなる"
        );
    }
}

#[test]
fn 同梱するファイルが実在する() {
    // Arrange
    let resources = bundle_resources();
    let map = resources.as_object().expect("bundle.resources は表");

    for (source, _target) in map {
        // Act
        let path = manifest_path(source);

        // Assert
        assert!(path.is_file(), "{} が無い", path.display());
    }
}

#[test]
fn 第三者の著作権表示は生成物であることを断っている() {
    // Arrange
    let notices = fs::read_to_string(manifest_path("../THIRD-PARTY-NOTICES.md"))
        .expect("THIRD-PARTY-NOTICES.md を読める");

    // Act
    let declares_generated = notices.contains("bun run notices");

    // Assert
    assert!(
        declares_generated,
        "手で編集すると次の生成で消える。生成物であることを本文に残しておく"
    );
}
