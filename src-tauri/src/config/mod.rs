//! 接続設定ファイル `connections.toml` の読み書き（ADR 0004）。
//!
//! パスワードはここに**書かない**。パスワードだけを OS キーチェーンへ逃がすことで、
//! この TOML は利用者が外部エディタで安全に編集できるプレーンな設定ファイルになる。
//!
//! スキーマツリーのフィルタ設定も接続ごとの項目としてここに持つ（ADR 0007）。

use crate::db::schema::SchemaFilter;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// 保存する接続先の指定方法。
///
/// `db::driver::ConnectTarget` と違い、TNS は**エイリアス名とディレクトリ**で持つ。
/// 記述子は接続のたびに `tnsnames.ora` から解決し直す（ADR 0006）。ファイルが
/// 更新されたときに古い記述子へ繋ぎに行かないためである。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "method", rename_all = "camelCase")]
pub enum SavedTarget {
    /// `host:port/service_name` の形式。
    #[serde(rename_all = "camelCase")]
    EzConnect {
        host: String,
        port: u16,
        service_name: String,
    },
    /// tnsnames.ora のディレクトリとエイリアス名。
    #[serde(rename_all = "camelCase")]
    Tns { directory: String, alias: String },
}

/// 保存された接続 1 件。パスワードは含まない。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedConnection {
    /// 一意 ID。キーチェーンのアカウント名にもなる（ADR 0004）。
    pub id: String,
    /// 利用者が付けた表示名。
    pub name: String,
    pub username: String,
    /// 読み取り専用で接続するか。データベース側のトランザクションで保証する。
    #[serde(default)]
    pub read_only: bool,
    /// 実行のたびに自動でコミットするか（ADR 0012）。
    ///
    /// 既定は偽（手動コミット）。読み取り専用のときは意味を持たない。
    #[serde(default)]
    pub auto_commit: bool,
    #[serde(default)]
    pub schema_filter: SchemaFilter,
    pub target: SavedTarget,
}

/// `connections.toml` の全体。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct ConnectionsFile {
    #[serde(default, rename = "connection")]
    pub connections: Vec<SavedConnection>,
}

impl ConnectionsFile {
    /// TOML 文字列から読む。
    ///
    /// 壊れたファイルで接続画面ごと使えなくなるのを避けるため、解析に失敗したら
    /// 空の一覧を返す。
    ///
    /// # 引数
    ///
    /// * `toml_text` - 設定ファイルの中身
    pub fn from_toml(toml_text: &str) -> Self {
        toml::from_str(toml_text).unwrap_or_default()
    }

    /// TOML 文字列へ書き出す。
    pub fn to_toml(&self) -> String {
        toml::to_string_pretty(self).unwrap_or_default()
    }

    /// 接続を追加または更新する。
    ///
    /// 同じ ID があれば置き換え、無ければ末尾に足す。
    ///
    /// # 引数
    ///
    /// * `connection` - 保存する接続
    pub fn upsert(&mut self, connection: SavedConnection) {
        match self
            .connections
            .iter_mut()
            .find(|saved| saved.id == connection.id)
        {
            Some(existing) => *existing = connection,
            None => self.connections.push(connection),
        }
    }

    /// 接続を削除する。削除できたら真を返す。
    ///
    /// # 引数
    ///
    /// * `id` - 削除する接続の ID
    pub fn remove(&mut self, id: &str) -> bool {
        let before = self.connections.len();
        self.connections.retain(|saved| saved.id != id);
        before != self.connections.len()
    }

    /// ID で接続を引く。
    ///
    /// # 引数
    ///
    /// * `id` - 探す接続の ID
    pub fn find(&self, id: &str) -> Option<&SavedConnection> {
        self.connections.iter().find(|saved| saved.id == id)
    }
}

/// ファイルから接続設定を読む。
///
/// ファイルが無ければ空の一覧を返す。初回起動を特別扱いしないためである。
///
/// # 引数
///
/// * `path` - `connections.toml` のパス
pub fn load(path: &Path) -> ConnectionsFile {
    match std::fs::read_to_string(path) {
        Ok(text) => ConnectionsFile::from_toml(&text),
        Err(_) => ConnectionsFile::default(),
    }
}

/// 接続設定をファイルへ書く。
///
/// 置き場所のディレクトリが無ければ作る。
///
/// # 引数
///
/// * `path` - `connections.toml` のパス
/// * `file` - 書き出す内容
pub fn save(path: &Path, file: &ConnectionsFile) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, file.to_toml())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn 接続を作る(id: &str) -> SavedConnection {
        SavedConnection {
            id: String::from(id),
            name: String::from("開発"),
            username: String::from("koduchi"),
            read_only: false,
            auto_commit: false,
            schema_filter: SchemaFilter::default(),
            target: SavedTarget::EzConnect {
                host: String::from("localhost"),
                port: 1521,
                service_name: String::from("FREEPDB1"),
            },
        }
    }

    #[test]
    fn 自動コミットの項目が無い設定ファイルは手動コミットとして読める() {
        // Arrange: 0012 より前に書かれた connections.toml を模す
        let toml_text = r#"
[[connection]]
id = "id-1"
name = "開発"
username = "koduchi"

[connection.target]
method = "ezConnect"
host = "localhost"
port = 1521
serviceName = "FREEPDB1"
"#;

        // Act
        let file = ConnectionsFile::from_toml(toml_text);

        // Assert
        assert!(!file.connections[0].auto_commit);
    }

    #[test]
    fn 自動コミットの指定は書き出して読み戻しても保たれる() {
        // Arrange
        let mut connection = 接続を作る("id-auto");
        connection.auto_commit = true;
        let mut file = ConnectionsFile::default();
        file.upsert(connection);

        // Act
        let restored = ConnectionsFile::from_toml(&file.to_toml());

        // Assert
        assert!(restored.connections[0].auto_commit);
    }

    #[test]
    fn 書き出した内容をそのまま読み戻せる() {
        // Arrange
        let mut file = ConnectionsFile::default();
        file.upsert(接続を作る("id-1"));

        // Act
        let restored = ConnectionsFile::from_toml(&file.to_toml());

        // Assert
        assert_eq!(restored, file);
    }

    #[test]
    fn tns接続はディレクトリとエイリアスで保存される() {
        // Arrange
        let mut connection = 接続を作る("id-tns");
        connection.target = SavedTarget::Tns {
            directory: String::from("/etc/oracle"),
            alias: String::from("PROD"),
        };
        let mut file = ConnectionsFile::default();
        file.upsert(connection.clone());

        // Act
        let restored = ConnectionsFile::from_toml(&file.to_toml());

        // Assert
        assert_eq!(restored.connections[0].target, connection.target);
    }

    #[test]
    fn 書き出した設定にパスワードは含まれない() {
        // Arrange
        let mut file = ConnectionsFile::default();
        file.upsert(接続を作る("id-1"));

        // Act
        let text = file.to_toml();

        // Assert
        assert!(!text.to_lowercase().contains("password"));
    }

    #[test]
    fn 同じidの接続は置き換えられる() {
        // Arrange
        let mut file = ConnectionsFile::default();
        file.upsert(接続を作る("id-1"));
        let mut updated = 接続を作る("id-1");
        updated.name = String::from("本番");

        // Act
        file.upsert(updated);

        // Assert
        assert_eq!(file.connections.len(), 1);
        assert_eq!(file.connections[0].name, "本番");
    }

    #[test]
    fn 違うidの接続は末尾に足される() {
        // Arrange
        let mut file = ConnectionsFile::default();
        file.upsert(接続を作る("id-1"));

        // Act
        file.upsert(接続を作る("id-2"));

        // Assert
        assert_eq!(file.connections.len(), 2);
        assert_eq!(file.connections[1].id, "id-2");
    }

    #[test]
    fn 削除すると一覧から消える() {
        // Arrange
        let mut file = ConnectionsFile::default();
        file.upsert(接続を作る("id-1"));

        // Act
        let removed = file.remove("id-1");

        // Assert
        assert!(removed);
        assert!(file.connections.is_empty());
    }

    #[test]
    fn 存在しないidの削除は偽を返す() {
        // Arrange
        let mut file = ConnectionsFile::default();

        // Act
        let removed = file.remove("id-x");

        // Assert
        assert!(!removed);
    }

    #[test]
    fn 壊れたtomlからは空の一覧になる() {
        // Arrange
        let broken = "これは TOML ではない [[[";

        // Act
        let file = ConnectionsFile::from_toml(broken);

        // Assert
        assert!(file.connections.is_empty());
    }

    #[test]
    fn ファイルが無ければ空の一覧を読む() {
        // Arrange
        let dir = tempdir().unwrap();
        let path = dir.path().join("connections.toml");

        // Act
        let file = load(&path);

        // Assert
        assert!(file.connections.is_empty());
    }

    #[test]
    fn 保存したファイルを読み戻せる() {
        // Arrange
        let dir = tempdir().unwrap();
        let path = dir.path().join("設定").join("connections.toml");
        let mut file = ConnectionsFile::default();
        file.upsert(接続を作る("id-1"));

        // Act
        save(&path, &file).unwrap();
        let restored = load(&path);

        // Assert
        assert_eq!(restored, file);
    }

    #[test]
    fn 読み取り専用とフィルタは省略しても既定値で読める() {
        // Arrange
        let text = r#"
[[connection]]
id = "id-1"
name = "開発"
username = "koduchi"

[connection.target]
method = "ezConnect"
host = "localhost"
port = 1521
serviceName = "FREEPDB1"
"#;

        // Act
        let file = ConnectionsFile::from_toml(text);

        // Assert
        assert!(!file.connections[0].read_only);
        assert_eq!(file.connections[0].schema_filter, SchemaFilter::default());
    }
}
