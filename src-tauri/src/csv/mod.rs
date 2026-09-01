//! 結果セットの CSV 書き出し。
//!
//! 書式は ADR の「CSV の書式」節に従う。選べるのは区切り文字・文字コード・
//! NULL の表現の 3 つで、ヘッダー行あり・`"` 囲みの RFC 4180 エスケープ・
//! 改行 CRLF は固定である。
//!
//! 書き出しは 1 度に全部ではなく、フロントエンドがカーソルから取り出した
//! かたまりを順に追記する形にする（ADR 0003）。数十万行を IPC に一括で載せずに
//! 済み、途中で中止できる。

use crate::db::driver::Column;
use crate::db::error::{DbError, DbResult};
use crate::db::value::{Cell, CellKind};
use encoding_rs::{SHIFT_JIS, UTF_8};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};

/// 行の区切り。RFC 4180 では CRLF と定められている。
const LINE_BREAK: &str = "\r\n";

/// UTF-8 の BOM。Excel が文字コードを取り違えないようにするために付ける。
const UTF8_BOM: [u8; 3] = [0xEF, 0xBB, 0xBF];

/// 区切り文字。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum CsvDelimiter {
    #[default]
    Comma,
    Tab,
    Semicolon,
}

impl CsvDelimiter {
    /// 実際に書き出す文字を返す。
    pub fn as_char(self) -> char {
        match self {
            CsvDelimiter::Comma => ',',
            CsvDelimiter::Tab => '\t',
            CsvDelimiter::Semicolon => ';',
        }
    }
}

/// 文字コード。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum CsvEncoding {
    /// UTF-8（BOM 付き）。Excel が既定で正しく開けるのはこれである。
    #[default]
    Utf8Bom,
    Utf8,
    ShiftJis,
}

/// NULL の表し方。空文字列と区別が付かなくなるのを承知で選ばせる。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum CsvNullText {
    /// 空欄。既定。
    #[default]
    Blank,
    /// `NULL` の 4 文字。
    Word,
    /// `\N`。PostgreSQL の `COPY` と同じ表し方。
    Backslash,
}

impl CsvNullText {
    /// 実際に書き出す文字列を返す。
    pub fn as_str(self) -> &'static str {
        match self {
            CsvNullText::Blank => "",
            CsvNullText::Word => "NULL",
            CsvNullText::Backslash => "\\N",
        }
    }
}

/// CSV の書式。保存ダイアログで選ばせ、次回のために保存する。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CsvOptions {
    #[serde(default)]
    pub delimiter: CsvDelimiter,
    #[serde(default)]
    pub encoding: CsvEncoding,
    #[serde(default)]
    pub null_text: CsvNullText,
}

/// 1 つの値を CSV の 1 項目へ変換する。
///
/// 区切り文字・`"`・改行のいずれかを含むときだけ `"` で囲み、中の `"` は 2 つに
/// する（RFC 4180）。
///
/// # 引数
///
/// * `text` - 元の文字列
/// * `delimiter` - 区切り文字
pub fn escape_field(text: &str, delimiter: char) -> String {
    let needs_quotes = text
        .chars()
        .any(|c| c == delimiter || c == '"' || c == '\n' || c == '\r');

    if !needs_quotes {
        return text.to_string();
    }

    let mut escaped = String::with_capacity(text.len() + 2);
    escaped.push('"');
    for c in text.chars() {
        if c == '"' {
            escaped.push('"');
        }
        escaped.push(c);
    }
    escaped.push('"');
    escaped
}

/// ヘッダー行を組み立てる。改行は含まない。
///
/// # 引数
///
/// * `columns` - 結果セットの列
/// * `options` - CSV の書式
pub fn format_header(columns: &[Column], options: &CsvOptions) -> String {
    let delimiter = options.delimiter.as_char();
    columns
        .iter()
        .map(|column| escape_field(&column.name, delimiter))
        .collect::<Vec<_>>()
        .join(&delimiter.to_string())
}

/// データ行を組み立てる。改行は含まない。
///
/// NULL は書式で選ばれた表し方にする。それ以外はセルの表示文字列をそのまま使う。
///
/// # 引数
///
/// * `row` - 1 行ぶんのセル
/// * `options` - CSV の書式
pub fn format_row(row: &[Cell], options: &CsvOptions) -> String {
    let delimiter = options.delimiter.as_char();
    row.iter()
        .map(|cell| {
            let text = if cell.kind == CellKind::Null {
                options.null_text.as_str()
            } else {
                cell.text.as_str()
            };
            escape_field(text, delimiter)
        })
        .collect::<Vec<_>>()
        .join(&delimiter.to_string())
}

/// 文字列を指定の文字コードのバイト列へ変換する。
///
/// Shift_JIS に無い文字は encoding_rs が数値文字参照へ置き換える。落とすよりは
/// 元の文字が分かるほうが良いと判断した。
///
/// # 引数
///
/// * `text` - 変換する文字列
/// * `encoding` - 文字コード
pub fn encode(text: &str, encoding: CsvEncoding) -> Vec<u8> {
    match encoding {
        CsvEncoding::Utf8 | CsvEncoding::Utf8Bom => UTF_8.encode(text).0.into_owned(),
        CsvEncoding::ShiftJis => SHIFT_JIS.encode(text).0.into_owned(),
    }
}

/// 書き出し中の CSV ファイル。
///
/// 作った時点でヘッダー行まで書く。以後は `append` でかたまりを追記し、
/// 最後に `finish` で閉じる。中止されたら `abort` でファイルごと消す。
pub struct CsvWriter {
    file: File,
    path: PathBuf,
    options: CsvOptions,
    rows_written: u64,
}

impl CsvWriter {
    /// ファイルを作り、BOM とヘッダー行を書く。
    ///
    /// # 引数
    ///
    /// * `path` - 保存先
    /// * `columns` - 結果セットの列
    /// * `options` - CSV の書式
    pub fn create(path: &Path, columns: &[Column], options: CsvOptions) -> DbResult<Self> {
        let mut file = File::create(path)
            .map_err(|error| DbError::storage(format!("CSV を作れませんでした: {error}")))?;

        if options.encoding == CsvEncoding::Utf8Bom {
            file.write_all(&UTF8_BOM)
                .map_err(|error| DbError::storage(format!("CSV を書けませんでした: {error}")))?;
        }

        let header = format!("{}{LINE_BREAK}", format_header(columns, &options));
        file.write_all(&encode(&header, options.encoding))
            .map_err(|error| DbError::storage(format!("CSV を書けませんでした: {error}")))?;

        Ok(CsvWriter {
            file,
            path: path.to_path_buf(),
            options,
            rows_written: 0,
        })
    }

    /// 行を追記し、これまでに書いた総行数を返す。
    ///
    /// # 引数
    ///
    /// * `rows` - 追記する行
    pub fn append(&mut self, rows: &[Vec<Cell>]) -> DbResult<u64> {
        let mut text = String::new();
        for row in rows {
            text.push_str(&format_row(row, &self.options));
            text.push_str(LINE_BREAK);
        }

        self.file
            .write_all(&encode(&text, self.options.encoding))
            .map_err(|error| DbError::storage(format!("CSV を書けませんでした: {error}")))?;

        self.rows_written += rows.len() as u64;
        Ok(self.rows_written)
    }

    /// これまでに書いた行数を返す。進捗表示に使う。
    pub fn rows_written(&self) -> u64 {
        self.rows_written
    }

    /// 書き出しを終える。
    pub fn finish(mut self) -> DbResult<u64> {
        self.file
            .flush()
            .map_err(|error| DbError::storage(format!("CSV を書けませんでした: {error}")))?;
        Ok(self.rows_written)
    }

    /// 書き出しを中止し、途中まで書いたファイルを消す。
    ///
    /// 中途半端な CSV を残すと、利用者が完全な出力と取り違える。
    pub fn abort(self) {
        drop(self.file);
        let _ = std::fs::remove_file(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn 列(name: &str) -> Column {
        Column {
            name: String::from(name),
            type_name: String::from("VARCHAR2(20)"),
            kind: CellKind::Text,
        }
    }

    fn 文字列セル(text: &str) -> Cell {
        Cell {
            text: String::from(text),
            kind: CellKind::Text,
        }
    }

    fn nullセル() -> Cell {
        Cell {
            text: String::new(),
            kind: CellKind::Null,
        }
    }

    #[test]
    fn 区切り文字を含まない値はそのまま書かれる() {
        // Arrange
        let text = "koduchi";

        // Act
        let field = escape_field(text, ',');

        // Assert
        assert_eq!(field, "koduchi");
    }

    #[test]
    fn 区切り文字を含む値は引用符で囲まれる() {
        // Arrange
        let text = "小槌, こづち";

        // Act
        let field = escape_field(text, ',');

        // Assert
        assert_eq!(field, r#""小槌, こづち""#);
    }

    #[test]
    fn 引用符を含む値は引用符を二重にして囲む() {
        // Arrange
        let text = r#"彼は "はい" と言った"#;

        // Act
        let field = escape_field(text, ',');

        // Assert
        assert_eq!(field, r#""彼は ""はい"" と言った""#);
    }

    #[test]
    fn 改行を含む値は引用符で囲まれる() {
        // Arrange
        let text = "1 行目\n2 行目";

        // Act
        let field = escape_field(text, ',');

        // Assert
        assert_eq!(field, "\"1 行目\n2 行目\"");
    }

    #[test]
    fn 区切り文字をタブにするとカンマは囲まれない() {
        // Arrange
        let text = "a,b";

        // Act
        let field = escape_field(text, '\t');

        // Assert
        assert_eq!(field, "a,b");
    }

    #[test]
    fn ヘッダー行は列名を区切り文字で繋ぐ() {
        // Arrange
        let columns = vec![列("ID"), 列("NAME")];

        // Act
        let header = format_header(&columns, &CsvOptions::default());

        // Assert
        assert_eq!(header, "ID,NAME");
    }

    #[test]
    fn nullは既定では空欄になる() {
        // Arrange
        let row = vec![文字列セル("a"), nullセル(), 文字列セル("c")];

        // Act
        let line = format_row(&row, &CsvOptions::default());

        // Assert
        assert_eq!(line, "a,,c");
    }

    #[test]
    fn nullの表現をnullという語にできる() {
        // Arrange
        let row = vec![nullセル()];
        let options = CsvOptions {
            null_text: CsvNullText::Word,
            ..CsvOptions::default()
        };

        // Act
        let line = format_row(&row, &options);

        // Assert
        assert_eq!(line, "NULL");
    }

    #[test]
    fn nullの表現を円マークnにできる() {
        // Arrange
        let row = vec![nullセル()];
        let options = CsvOptions {
            null_text: CsvNullText::Backslash,
            ..CsvOptions::default()
        };

        // Act
        let line = format_row(&row, &options);

        // Assert
        assert_eq!(line, r"\N");
    }

    #[test]
    fn 空文字列とnullは表現を変えれば区別できる() {
        // Arrange
        let row = vec![文字列セル(""), nullセル()];
        let options = CsvOptions {
            null_text: CsvNullText::Word,
            ..CsvOptions::default()
        };

        // Act
        let line = format_row(&row, &options);

        // Assert
        assert_eq!(line, ",NULL");
    }

    #[test]
    fn shift_jisで書くと日本語がバイト列に変換される() {
        // Arrange
        let text = "あ";

        // Act
        let bytes = encode(text, CsvEncoding::ShiftJis);

        // Assert
        assert_eq!(bytes, vec![0x82, 0xA0]);
    }

    #[test]
    fn utf8で書くと日本語はそのままのバイト列になる() {
        // Arrange
        let text = "あ";

        // Act
        let bytes = encode(text, CsvEncoding::Utf8);

        // Assert
        assert_eq!(bytes, "あ".as_bytes());
    }

    #[test]
    fn bom付きで書き出すとファイルの先頭にbomが付く() {
        // Arrange
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("out.csv");
        let columns = vec![列("ID")];

        // Act
        let writer = CsvWriter::create(&path, &columns, CsvOptions::default()).unwrap();
        writer.finish().unwrap();
        let bytes = std::fs::read(&path).unwrap();

        // Assert
        assert_eq!(&bytes[0..3], &UTF8_BOM);
    }

    #[test]
    fn bom無しを選ぶとbomは付かない() {
        // Arrange
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("out.csv");
        let options = CsvOptions {
            encoding: CsvEncoding::Utf8,
            ..CsvOptions::default()
        };

        // Act
        let writer = CsvWriter::create(&path, &[列("ID")], options).unwrap();
        writer.finish().unwrap();
        let bytes = std::fs::read(&path).unwrap();

        // Assert
        assert_ne!(&bytes[0..3], &UTF8_BOM);
    }

    #[test]
    fn 追記した行はcrlf区切りでファイルへ書かれる() {
        // Arrange
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("out.csv");
        let options = CsvOptions {
            encoding: CsvEncoding::Utf8,
            ..CsvOptions::default()
        };
        let mut writer = CsvWriter::create(&path, &[列("ID"), 列("NAME")], options).unwrap();

        // Act
        writer
            .append(&[
                vec![文字列セル("1"), 文字列セル("小槌")],
                vec![文字列セル("2"), nullセル()],
            ])
            .unwrap();
        let written = writer.finish().unwrap();
        let text = std::fs::read_to_string(&path).unwrap();

        // Assert
        assert_eq!(written, 2);
        assert_eq!(text, "ID,NAME\r\n1,小槌\r\n2,\r\n");
    }

    #[test]
    fn 追記のたびに書いた行数が積み上がる() {
        // Arrange
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("out.csv");
        let mut writer = CsvWriter::create(&path, &[列("ID")], CsvOptions::default()).unwrap();

        // Act
        writer.append(&[vec![文字列セル("1")]]).unwrap();
        let total = writer
            .append(&[vec![文字列セル("2")], vec![文字列セル("3")]])
            .unwrap();

        // Assert
        assert_eq!(total, 3);
        assert_eq!(writer.rows_written(), 3);
    }

    #[test]
    fn 中止すると書きかけのファイルは残らない() {
        // Arrange
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("out.csv");
        let mut writer = CsvWriter::create(&path, &[列("ID")], CsvOptions::default()).unwrap();
        writer.append(&[vec![文字列セル("1")]]).unwrap();

        // Act
        writer.abort();

        // Assert
        assert!(!path.exists());
    }
}
