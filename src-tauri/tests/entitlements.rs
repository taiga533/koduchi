//! 配布物のエンタイトルメントと `tauri.conf.json` の整合（ADR 0011）。
//!
//! ライブラリ検証を切るエンタイトルメントが外れると、配布物では Instant Client を
//! 読み込めなくなり、Oracle へ一切繋がらなくなる（ADR 0001）。手元の
//! `bun run tauri dev` は署名を伴わないため、この壊れ方は**リリースしてからでないと
//! 気づけない**。そのためファイルの存在と中身をテストで見張る。

use std::fs;
use std::path::PathBuf;

/// 別途インストールされた Instant Client を読み込むために要るエンタイトルメント。
const DISABLE_LIBRARY_VALIDATION: &str = "com.apple.security.cs.disable-library-validation";

/// `DYLD_LIBRARY_PATH` を効かせるためのエンタイトルメント。
const ALLOW_DYLD_ENVIRONMENT_VARIABLES: &str =
    "com.apple.security.cs.allow-dyld-environment-variables";

/// `src-tauri/` の中のパスを絶対パスにする。
///
/// テストの実行ディレクトリに依らないよう、`CARGO_MANIFEST_DIR` を起点にする。
///
/// # 引数
///
/// * `relative` - `src-tauri/` からの相対パス
fn manifest_path(relative: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relative)
}

/// `tauri.conf.json` の `bundle.macOS` を読む。
fn macos_bundle_config() -> serde_json::Value {
    let text =
        fs::read_to_string(manifest_path("tauri.conf.json")).expect("tauri.conf.json を読めるはず");
    let config: serde_json::Value = serde_json::from_str(&text).expect("tauri.conf.json は JSON");

    config["bundle"]["macOS"].clone()
}

#[test]
fn tauri設定はエンタイトルメントのファイルを指している() {
    // Arrange
    let macos = macos_bundle_config();

    // Act
    let entitlements = macos["entitlements"].as_str();

    // Assert
    assert_eq!(
        entitlements,
        Some("entitlements.plist"),
        "bundle.macOS.entitlements が外れると配布物でライブラリ検証が効き、Instant Client を読めなくなる"
    );
}

#[test]
fn 指されたエンタイトルメントのファイルが存在する() {
    // Arrange
    let macos = macos_bundle_config();
    let relative = macos["entitlements"]
        .as_str()
        .expect("entitlements の指定があるはず");

    // Act
    let path = manifest_path(relative);

    // Assert
    assert!(path.is_file(), "{} が無い", path.display());
}

#[test]
fn エンタイトルメントはライブラリ検証を切っている() {
    // Arrange
    let plist = fs::read_to_string(manifest_path("entitlements.plist"))
        .expect("entitlements.plist を読める");

    // Act
    let 含む = plist.contains(DISABLE_LIBRARY_VALIDATION);

    // Assert
    assert!(
        含む,
        "{DISABLE_LIBRARY_VALIDATION} が無いと、別途インストールされた libclntsh.dylib を読み込めない"
    );
}

#[test]
fn エンタイトルメントはdyldの環境変数を許している() {
    // Arrange
    let plist = fs::read_to_string(manifest_path("entitlements.plist"))
        .expect("entitlements.plist を読める");

    // Act
    let 含む = plist.contains(ALLOW_DYLD_ENVIRONMENT_VARIABLES);

    // Assert
    assert!(
        含む,
        "{ALLOW_DYLD_ENVIRONMENT_VARIABLES} が無いと、DYLD_LIBRARY_PATH での指定が効かない"
    );
}

#[test]
fn エンタイトルメントは必要な2つだけに絞られている() {
    // Arrange: エンタイトルメントは緩めるほど守りが減る。増えたら意図を問い直す。
    let plist = fs::read_to_string(manifest_path("entitlements.plist"))
        .expect("entitlements.plist を読める");

    // Act
    let 個数 = plist.matches("<key>").count();

    // Assert
    assert_eq!(
        個数, 2,
        "エンタイトルメントを増やすなら ADR 0011 に理由を残すこと"
    );
}

#[test]
fn エンタイトルメントにxmlのコメントを書いていない() {
    // Arrange: codesign の AMFI パーサはコメントを構文誤りとして弾く。
    // 書くとリリースのビルドだけが「syntax error near line N」で落ちる。
    let plist = fs::read_to_string(manifest_path("entitlements.plist"))
        .expect("entitlements.plist を読める");

    // Act
    let コメントを含む = plist.contains("<!--");

    // Assert
    assert!(
        !コメントを含む,
        "codesign がコメント付きの plist を読めない。意図は ADR 0011 に書くこと"
    );
}
