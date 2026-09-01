//! Oracle Instant Client の検出と初期化（ADR 0001）。
//!
//! Instant Client はアプリに同梱せず、利用者が別途インストールする前提とする。
//! 起動時に初期化を試み、失敗したら案内画面を出してライブラリのディレクトリを
//! 指定してもらう。
//!
//! `oracle::InitParams::init()` は成功するとプロセス 1 回きりで、以後のパラメータは
//! 効かない。そのため指定されたパスは設定ファイルへ保存し、次回起動時の初期化に
//! 使う。指定した直後は再起動を促す。

use serde::{Deserialize, Serialize};
use std::fmt;
use std::path::{Path, PathBuf};

/// Instant Client の共有ライブラリのファイル名。
///
/// ODPI-C はこの名前でライブラリを探す。ディレクトリの妥当性判定にも使う。
const LIBRARY_FILE_NAMES: [&str; 3] = ["libclntsh.dylib", "libclntsh.so", "oci.dll"];

/// Instant Client の設定。`connections.toml` とは別のファイルに保存する。
///
/// 接続設定とは寿命も編集の頻度も違ううえ、これが読めないと接続設定を読む前に
/// アプリが機能しないため、ファイルを分けてある。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct InstantClientSettings {
    /// 利用者が指定したライブラリのディレクトリ。未指定なら ODPI-C の既定の探索に任せる。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lib_dir: Option<PathBuf>,
}

impl InstantClientSettings {
    /// TOML 文字列から設定を読む。
    ///
    /// 壊れたファイルでアプリが起動しなくなるのを避けるため、解析に失敗したら
    /// 既定値を返す。
    ///
    /// # 引数
    ///
    /// * `toml_text` - 設定ファイルの中身
    pub fn from_toml(toml_text: &str) -> Self {
        toml::from_str(toml_text).unwrap_or_default()
    }

    /// 設定を TOML 文字列へ書き出す。
    pub fn to_toml(&self) -> String {
        toml::to_string_pretty(self).unwrap_or_default()
    }
}

/// Instant Client の初期化結果。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ClientStatus {
    /// 初期化に成功し、Oracle へ接続できる状態。
    Ready {
        /// Instant Client のバージョン（`23.9.0.25.7` のような形）。
        version: String,
    },
    /// 初期化に失敗した状態。案内画面を出す。
    Unavailable {
        /// ODPI-C が返したエラーメッセージ。原因の切り分けに使う。
        message: String,
        /// 探索して見つかった候補のディレクトリ。案内画面で選択肢として出す。
        candidates: Vec<PathBuf>,
    },
}

/// Instant Client を探すときに見に行く既定のディレクトリを返す。
///
/// Homebrew の tap（`InstantClientTap/instantclient`）と、Oracle の配布物を
/// 手で展開したときによく使われる場所を並べてある。ODPI-C 自身も
/// `DYLD_LIBRARY_PATH` などを見るため、ここに無くても動くことはある。
pub fn default_search_roots() -> Vec<PathBuf> {
    let mut roots = vec![
        PathBuf::from("/opt/homebrew/lib"),
        PathBuf::from("/usr/local/lib"),
        PathBuf::from("/opt/oracle"),
    ];

    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        roots.push(home.join("lib"));
        roots.push(home.join("Downloads"));
        // Oracle の配布物を展開しただけの `~/instantclient_23_9` のような
        // 置き方も拾えるよう、ホーム直下も探索元に含める。
        roots.push(home);
    }

    roots
}

/// 与えられたディレクトリが Instant Client のライブラリを含むかを判定する。
///
/// ディレクトリ直下だけを見る。再帰探索はしない。
///
/// # 引数
///
/// * `dir` - 判定するディレクトリ
pub fn contains_client_library(dir: &Path) -> bool {
    LIBRARY_FILE_NAMES
        .iter()
        .any(|name| dir.join(name).is_file())
}

/// 候補となるディレクトリを探す。
///
/// 各探索元について、そのディレクトリ自身と直下の子ディレクトリを 1 段だけ見る。
/// Oracle の配布物は `instantclient_23_3` のような名前のディレクトリに展開される
/// ため、1 段潜る必要がある。
///
/// # 引数
///
/// * `roots` - 探索の起点となるディレクトリの一覧
///
/// # 戻り値
///
/// ライブラリが見つかったディレクトリ。重複は除いてある。
pub fn find_candidate_lib_dirs(roots: &[PathBuf]) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = Vec::new();

    let push_unique = |dir: PathBuf, found: &mut Vec<PathBuf>| {
        if !found.contains(&dir) {
            found.push(dir);
        }
    };

    for root in roots {
        if contains_client_library(root) {
            push_unique(root.clone(), &mut found);
        }

        let Ok(entries) = std::fs::read_dir(root) else {
            continue;
        };

        let mut children: Vec<PathBuf> = entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.is_dir())
            .collect();
        // read_dir の順序は環境依存であるため、結果を安定させるために並べ替える。
        children.sort();

        for child in children {
            if contains_client_library(&child) {
                push_unique(child, &mut found);
            }
        }
    }

    found
}

/// Instant Client を初期化する。
///
/// `lib_dir` が指定されていればそれを使い、指定が無ければ ODPI-C の既定の探索に
/// 任せる。失敗した場合は候補のディレクトリを添えて `Unavailable` を返す。
///
/// 呼び出しはプロセスにつき 1 回だけ意味を持つ。成功後に別のパスで呼び直しても
/// 効果は無いため、パスを変えたときはアプリを再起動する必要がある。
///
/// # 引数
///
/// * `lib_dir` - 利用者が指定したライブラリのディレクトリ
pub fn initialize(lib_dir: Option<&Path>) -> ClientStatus {
    let mut params = oracle::InitParams::new();

    if let Some(dir) = lib_dir {
        // パスに UTF-8 でない文字が含まれる場合や、ODPI-C が受け付けない場合は
        // 指定を諦め、既定の探索に任せる。
        if let Some(dir) = dir.to_str() {
            let _ = params.oracle_client_lib_dir(dir);
        }
    }

    match params.init() {
        Ok(_) => match oracle::Version::client() {
            Ok(version) => ClientStatus::Ready {
                version: format_version(&version),
            },
            // 初期化には成功しているため、バージョンが読めなくても接続はできる。
            Err(_) => ClientStatus::Ready {
                version: String::from("unknown"),
            },
        },
        Err(error) => ClientStatus::Unavailable {
            message: error.to_string(),
            candidates: find_candidate_lib_dirs(&default_search_roots()),
        },
    }
}

/// Instant Client のバージョンを `23.9.0.25.7` の形に整える。
fn format_version(version: &oracle::Version) -> String {
    format!(
        "{}.{}.{}.{}.{}",
        version.major(),
        version.minor(),
        version.update(),
        version.patch(),
        version.port_update()
    )
}

impl fmt::Display for ClientStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ClientStatus::Ready { version } => {
                write!(f, "Instant Client {version} を読み込みました")
            }
            ClientStatus::Unavailable { message, .. } => {
                write!(f, "Instant Client を読み込めませんでした: {message}")
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// ライブラリファイルを 1 つ置いたディレクトリを作る。
    fn ライブラリを置く(dir: &Path) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join("libclntsh.dylib"), b"dummy").unwrap();
    }

    #[test]
    fn ライブラリを含むディレクトリを見分けられる() {
        // Arrange
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("instantclient");
        ライブラリを置く(&dir);

        // Act
        let found = contains_client_library(&dir);

        // Assert
        assert!(found);
    }

    #[test]
    fn ライブラリを含まないディレクトリは候補にならない() {
        // Arrange
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("empty");
        fs::create_dir_all(&dir).unwrap();

        // Act
        let found = contains_client_library(&dir);

        // Assert
        assert!(!found);
    }

    #[test]
    fn 存在しないディレクトリを渡しても失敗しない() {
        // Arrange
        let dir = PathBuf::from("/この/パスは/存在しない");

        // Act
        let found = contains_client_library(&dir);

        // Assert
        assert!(!found);
    }

    #[test]
    fn 探索元の直下にあるライブラリを見つけられる() {
        // Arrange
        let temp = tempfile::tempdir().unwrap();
        ライブラリを置く(temp.path());

        // Act
        let candidates = find_candidate_lib_dirs(&[temp.path().to_path_buf()]);

        // Assert
        assert_eq!(candidates, vec![temp.path().to_path_buf()]);
    }

    #[test]
    fn 探索元の子ディレクトリにあるライブラリを見つけられる() {
        // Arrange: Oracle の配布物は instantclient_23_3 のような名前で展開される
        let temp = tempfile::tempdir().unwrap();
        let child = temp.path().join("instantclient_23_3");
        ライブラリを置く(&child);

        // Act
        let candidates = find_candidate_lib_dirs(&[temp.path().to_path_buf()]);

        // Assert
        assert_eq!(candidates, vec![child]);
    }

    #[test]
    fn 孫ディレクトリまでは探索しない() {
        // Arrange
        let temp = tempfile::tempdir().unwrap();
        let grandchild = temp.path().join("a").join("b");
        ライブラリを置く(&grandchild);

        // Act
        let candidates = find_candidate_lib_dirs(&[temp.path().to_path_buf()]);

        // Assert
        assert!(candidates.is_empty());
    }

    #[test]
    fn 同じディレクトリが複数の探索元から見つかっても重複しない() {
        // Arrange
        let temp = tempfile::tempdir().unwrap();
        ライブラリを置く(temp.path());
        let roots = vec![temp.path().to_path_buf(), temp.path().to_path_buf()];

        // Act
        let candidates = find_candidate_lib_dirs(&roots);

        // Assert
        assert_eq!(candidates.len(), 1);
    }

    #[test]
    fn 複数の候補は探索元の順に並ぶ() {
        // Arrange
        let temp = tempfile::tempdir().unwrap();
        let first = temp.path().join("first");
        let second = temp.path().join("second");
        ライブラリを置く(&first);
        ライブラリを置く(&second);

        // Act
        let candidates = find_candidate_lib_dirs(&[first.clone(), second.clone()]);

        // Assert
        assert_eq!(candidates, vec![first, second]);
    }

    #[test]
    fn 設定は往復してもパスを保つ() {
        // Arrange
        let settings = InstantClientSettings {
            lib_dir: Some(PathBuf::from("/opt/homebrew/lib")),
        };

        // Act
        let restored = InstantClientSettings::from_toml(&settings.to_toml());

        // Assert
        assert_eq!(restored, settings);
    }

    #[test]
    fn パス未指定の設定はキーを書き出さない() {
        // Arrange
        let settings = InstantClientSettings { lib_dir: None };

        // Act
        let toml_text = settings.to_toml();

        // Assert
        assert!(!toml_text.contains("lib_dir"));
    }

    #[test]
    fn 壊れた設定ファイルは既定値として読まれる() {
        // Arrange
        let broken = "これは TOML ではない [[[";

        // Act
        let settings = InstantClientSettings::from_toml(broken);

        // Assert
        assert_eq!(settings, InstantClientSettings::default());
    }

    #[test]
    fn 既定の探索元にはhomebrewのライブラリ置き場が含まれる() {
        // Arrange
        // 環境変数に依存しない項目だけを確認する

        // Act
        let roots = default_search_roots();

        // Assert
        assert!(roots.contains(&PathBuf::from("/opt/homebrew/lib")));
        assert!(roots.contains(&PathBuf::from("/usr/local/lib")));
    }
}
