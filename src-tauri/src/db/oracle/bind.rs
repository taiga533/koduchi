//! バインド変数の受け渡し（ADR 0016）。
//!
//! 値はダイアログで入力された文字列として届き、一緒に届く型（`BindKind`）に
//! 従って Oracle の型へ変換してからバインドする。日付や数値の列と文字列を
//! 比べると暗黙変換が挟まり、索引が効かなくなるためである。
//!
//! 変換はここで行い、失敗したら**実行そのものを始めない**。Oracle へ渡して
//! しまうと `ORA-01858` のような文言だけが返り、どの変数のどの値が悪いのかが
//! 利用者に伝わらない。
//!
//! `String` をそのまま `oracle` crate へ渡すと `NVARCHAR2` になる。国別文字集合の
//! 型は `VARCHAR2` の列との比較でさらに変換を挟むため、型を明示するための包みを
//! 介す。

use crate::db::driver::{Bind, BindKind};
use crate::db::error::{DbError, DbResult};
use oracle::sql_type::{OracleType, Timestamp, ToSql};
use oracle::{SqlValue, Statement};

/// 型が決まったバインド値 1 つ。
///
/// `None` は NULL としてバインドする。型に関わらず NULL は NULL である。
#[derive(Debug)]
pub enum BoundValue {
    /// 文字列。入力された値をそのまま渡す。
    Varchar2(Option<String>),
    /// 数値。`NUMBER` は最大 38 桁であり `f64` では桁が落ちるため、検証だけを
    /// 済ませた 10 進表記の文字列のまま渡す。
    Number(Option<String>),
    /// 日付。小数秒は持たない。
    Date(Option<Timestamp>),
    /// タイムスタンプ。小数秒を持てる。
    Timestamp(Option<Timestamp>),
}

impl ToSql for BoundValue {
    fn oratype(&self, _connection: &oracle::Connection) -> oracle::Result<OracleType> {
        Ok(match self {
            BoundValue::Varchar2(text) => {
                // 長さ 0 の `VARCHAR2` は作れないため、空でも 1 バイトぶんは確保する。
                let length = text.as_ref().map_or(0, |text| text.len()).max(1);
                OracleType::Varchar2(length as u32)
            }
            // 精度と位取りを 0 にすると、制約の無い `NUMBER` になる。
            BoundValue::Number(_) => OracleType::Number(0, 0),
            BoundValue::Date(_) => OracleType::Date,
            BoundValue::Timestamp(_) => OracleType::Timestamp(9),
        })
    }

    fn to_sql(&self, value: &mut SqlValue) -> oracle::Result<()> {
        match self {
            BoundValue::Varchar2(Some(text)) | BoundValue::Number(Some(text)) => value.set(text),
            BoundValue::Date(Some(moment)) | BoundValue::Timestamp(Some(moment)) => {
                value.set(moment)
            }
            _ => value.set_null(),
        }
    }
}

/// 日付とタイムスタンプを組み立てるための、桁ごとに分けた値。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DateTimeParts {
    year: i32,
    month: u32,
    day: u32,
    hour: u32,
    minute: u32,
    second: u32,
    nanosecond: u32,
}

/// 入力された文字列を、選ばれた型の値へ変換する。
///
/// 変換できない値はここで弾き、どの変数のどの値が読めなかったのかを含む
/// メッセージを返す。NULL は型に関わらずそのまま NULL になる。
///
/// # 引数
///
/// * `bind` - 名前・型・値の 3 つ組
///
/// # 戻り値
///
/// バインドできる形になった値。変換できなければ実行エラー。
pub fn convert(bind: &Bind) -> DbResult<BoundValue> {
    let Some(text) = bind.value.as_deref() else {
        return Ok(match bind.kind {
            BindKind::Varchar2 => BoundValue::Varchar2(None),
            BindKind::Number => BoundValue::Number(None),
            BindKind::Date => BoundValue::Date(None),
            BindKind::Timestamp => BoundValue::Timestamp(None),
        });
    };

    match bind.kind {
        BindKind::Varchar2 => Ok(BoundValue::Varchar2(Some(text.to_string()))),
        BindKind::Number => normalize_number(text)
            .map(|number| BoundValue::Number(Some(number)))
            .ok_or_else(|| {
                conversion_error(
                    bind,
                    text,
                    "数字・符号・小数点だけで書いてください（例: 42、-3.14、1.5e3）。",
                )
            }),
        BindKind::Date => parse_date_time(text)
            .and_then(|parts| parts.truncate_to_second().to_timestamp())
            .map(|moment| BoundValue::Date(Some(moment)))
            .ok_or_else(|| {
                conversion_error(
                    bind,
                    text,
                    "YYYY-MM-DD または YYYY-MM-DD HH:MI:SS の形式で書いてください。",
                )
            }),
        BindKind::Timestamp => parse_date_time(text)
            .and_then(|parts| parts.to_timestamp())
            .map(|moment| BoundValue::Timestamp(Some(moment)))
            .ok_or_else(|| {
                conversion_error(
                    bind,
                    text,
                    "YYYY-MM-DD HH:MI:SS[.ffffff] の形式で書いてください。",
                )
            }),
    }
}

/// 変換に失敗したことを伝えるエラーを組み立てる。
///
/// # 引数
///
/// * `bind` - 対象のバインド変数
/// * `text` - 読めなかった値
/// * `hint` - 期待する書き方の説明
fn conversion_error(bind: &Bind, text: &str, hint: &str) -> DbError {
    DbError::execute(format!(
        "バインド変数 :{} の値「{}」を {} として読み取れません。{}",
        bind.name,
        text,
        bind.kind.type_name(),
        hint
    ))
}

/// 数値の表記を検証し、Oracle が受け取れる形へ整える。
///
/// 前後の空白は落とし、先頭の `+` と、小数点しか無い側の 0 を補う。
/// `1,000` のような桁区切りや全角数字は受け付けない。
///
/// # 引数
///
/// * `text` - 入力された値
///
/// # 戻り値
///
/// 整えた 10 進表記。数値として読めなければ `None`。
fn normalize_number(text: &str) -> Option<String> {
    let trimmed = text.trim();
    let (sign, rest) = match trimmed.strip_prefix('-') {
        Some(rest) => ("-", rest),
        None => ("", trimmed.strip_prefix('+').unwrap_or(trimmed)),
    };

    let (mantissa, exponent) = match rest.find(['e', 'E']) {
        Some(index) => (&rest[..index], Some(&rest[index + 1..])),
        None => (rest, None),
    };

    let (integer, fraction) = match mantissa.split_once('.') {
        Some((integer, fraction)) => (integer, fraction),
        None => (mantissa, ""),
    };

    if integer.is_empty() && fraction.is_empty() {
        return None;
    }
    if !is_all_digits(integer) || !is_all_digits(fraction) {
        return None;
    }

    let mut normalized = String::from(sign);
    normalized.push_str(if integer.is_empty() { "0" } else { integer });
    if !fraction.is_empty() {
        normalized.push('.');
        normalized.push_str(fraction);
    }

    if let Some(exponent) = exponent {
        let (exponent_sign, digits) = match exponent.strip_prefix('-') {
            Some(digits) => ("-", digits),
            None => ("", exponent.strip_prefix('+').unwrap_or(exponent)),
        };
        if digits.is_empty() || !is_all_digits(digits) {
            return None;
        }
        normalized.push('e');
        normalized.push_str(exponent_sign);
        normalized.push_str(digits);
    }

    Some(normalized)
}

/// すべて半角数字であるかを判定する。
///
/// 空文字列は真を返す。「その部分が無い」場合の扱いは呼び出し側が決める。
///
/// # 引数
///
/// * `text` - 判定する文字列
fn is_all_digits(text: &str) -> bool {
    text.chars().all(|character| character.is_ascii_digit())
}

/// 日付と時刻の表記を読み取る。
///
/// 受け付ける形は `YYYY-MM-DD` と `YYYY/MM/DD` で、続けて空白か `T` を挟んで
/// `HH:MI`・`HH:MI:SS`・`HH:MI:SS.ffffff` を書ける。時刻を省くと 0 時 0 分 0 秒に
/// なる。時間帯の表記（`Z` や `+09:00`）は受け付けない。Oracle の `DATE` と
/// `TIMESTAMP` は時間帯を持たないためである。
///
/// # 引数
///
/// * `text` - 入力された値
///
/// # 戻り値
///
/// 桁ごとに分けた値。暦として成り立たない値（`2024-02-30` など）は `None`。
fn parse_date_time(text: &str) -> Option<DateTimeParts> {
    let trimmed = text.trim();
    let (date_text, time_text) = match trimmed.find([' ', 'T', 't']) {
        Some(index) => (&trimmed[..index], trimmed[index + 1..].trim()),
        None => (trimmed, ""),
    };

    let separator = if date_text.contains('/') { '/' } else { '-' };
    let mut fields = date_text.split(separator);
    let year = parse_field(fields.next()?, 4)?;
    let month = parse_field(fields.next()?, 2)?;
    let day = parse_field(fields.next()?, 2)?;
    if fields.next().is_some() {
        return None;
    }

    let (hour, minute, second, nanosecond) = parse_time(time_text)?;

    if !(1..=9999).contains(&year) || !(1..=12).contains(&month) {
        return None;
    }
    if day < 1 || day > days_in_month(year, month) {
        return None;
    }
    if hour > 23 || minute > 59 || second > 59 {
        return None;
    }

    Some(DateTimeParts {
        year: year as i32,
        month,
        day,
        hour,
        minute,
        second,
        nanosecond,
    })
}

/// 時刻の部分を読み取る。
///
/// 空文字列は 0 時 0 分 0 秒として扱う。
///
/// # 引数
///
/// * `text` - `HH:MI[:SS[.ffffff]]` の形の文字列
///
/// # 戻り値
///
/// 時・分・秒・ナノ秒。形が違えば `None`。
fn parse_time(text: &str) -> Option<(u32, u32, u32, u32)> {
    if text.is_empty() {
        return Some((0, 0, 0, 0));
    }

    let mut fields = text.split(':');
    let hour = parse_field(fields.next()?, 2)?;
    let minute = parse_field(fields.next()?, 2)?;

    let (second, nanosecond) = match fields.next() {
        Some(field) => match field.split_once('.') {
            Some((second, fraction)) => (parse_field(second, 2)?, parse_nanosecond(fraction)?),
            None => (parse_field(field, 2)?, 0),
        },
        None => (0, 0),
    };

    if fields.next().is_some() {
        return None;
    }

    Some((hour, minute, second, nanosecond))
}

/// 小数秒をナノ秒へ直す。
///
/// 9 桁に満たなければ 0 で埋め、超える桁は捨てる。Oracle の `TIMESTAMP` は
/// 最大でナノ秒までしか持てないためである。
///
/// # 引数
///
/// * `fraction` - 小数点以下の数字
fn parse_nanosecond(fraction: &str) -> Option<u32> {
    if fraction.is_empty() || !is_all_digits(fraction) {
        return None;
    }
    let mut digits = String::from(&fraction[..fraction.len().min(9)]);
    while digits.len() < 9 {
        digits.push('0');
    }
    digits.parse().ok()
}

/// 日付や時刻の 1 項目を読み取る。
///
/// 桁数の上限を超える数字は受け付けない。`2024-1-2` のように桁を詰めた書き方は
/// 許すが、`20240102` のような区切りの無い書き方は弾く。
///
/// # 引数
///
/// * `text` - 読み取る数字
/// * `max_digits` - 許す桁数
fn parse_field(text: &str, max_digits: usize) -> Option<u32> {
    if text.is_empty() || text.len() > max_digits || !is_all_digits(text) {
        return None;
    }
    text.parse().ok()
}

/// その年月の日数を返す。
///
/// # 引数
///
/// * `year` - 年
/// * `month` - 月（1〜12）
fn days_in_month(year: u32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap_year(year) => 29,
        2 => 28,
        _ => 0,
    }
}

/// 閏年かどうかを判定する。
///
/// # 引数
///
/// * `year` - 年
fn is_leap_year(year: u32) -> bool {
    (year.is_multiple_of(4) && !year.is_multiple_of(100)) || year.is_multiple_of(400)
}

impl DateTimeParts {
    /// `oracle` crate の `Timestamp` へ直す。
    fn to_timestamp(self) -> Option<Timestamp> {
        Timestamp::new(
            self.year,
            self.month,
            self.day,
            self.hour,
            self.minute,
            self.second,
            self.nanosecond,
        )
        .ok()
    }

    /// 小数秒を落とす。`DATE` は秒までしか持てないためである。
    fn truncate_to_second(self) -> Self {
        DateTimeParts {
            nanosecond: 0,
            ..self
        }
    }
}

/// 文に実在するバインド変数だけを取り出し、型を決めた値として束ねる。
///
/// 文に無い名前を渡すと `oracle` crate はエラーにする。名前の抽出はフロントエンド
/// 側の自前パーサが行っており、その見立てが Oracle のそれと食い違うことはありうる。
/// 余分な名前で実行そのものを落とさないよう、ここで文の側の名前に合わせて絞る。
/// 逆に足りない場合は Oracle が `ORA-01008` を返し、その旨が利用者に届く。
///
/// 絞ったあとの値だけを変換する。文で使われない変数の値が読めなくても、実行を
/// 妨げる理由は無いためである。
///
/// 名前の比較は大文字小文字を区別しない。Oracle のバインド名がそうであるため。
///
/// # 引数
///
/// * `statement` - 実行する文
/// * `binds` - 与えられた値
///
/// # 戻り値
///
/// 名前と値の組。`params` へ渡して使う。変換できない値があればエラー。
pub fn bound_values(statement: &Statement, binds: &[Bind]) -> DbResult<Vec<(String, BoundValue)>> {
    let names = statement.bind_names();

    binds
        .iter()
        .filter(|bind| {
            names
                .iter()
                .any(|declared| declared.eq_ignore_ascii_case(&bind.name))
        })
        .map(|bind| Ok((bind.name.clone(), convert(bind)?)))
        .collect()
}

/// `execute_named` などへ渡す形へ変換する。
///
/// 借用のためだけに分けてある。`bound_values` の戻り値を保ったまま呼ぶ。
///
/// # 引数
///
/// * `values` - `bound_values` が返した組
pub fn params(values: &[(String, BoundValue)]) -> Vec<(&str, &dyn ToSql)> {
    values
        .iter()
        .map(|(name, value)| (name.as_str(), value as &dyn ToSql))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 変換した値から、日付として持っている桁を取り出す。
    fn 日時の桁(value: &BoundValue) -> Option<(i32, u32, u32, u32, u32, u32, u32)> {
        let moment = match value {
            BoundValue::Date(Some(moment)) | BoundValue::Timestamp(Some(moment)) => moment,
            _ => return None,
        };
        Some((
            moment.year(),
            moment.month(),
            moment.day(),
            moment.hour(),
            moment.minute(),
            moment.second(),
            moment.nanosecond(),
        ))
    }

    #[test]
    fn 文字列の値はそのまま渡る() {
        // Arrange
        let bind = Bind::text("memo", Some(" 42 "));

        // Act
        let value = convert(&bind).unwrap();

        // Assert
        match value {
            BoundValue::Varchar2(Some(text)) => assert_eq!(text, " 42 "),
            _ => panic!("文字列になるはず"),
        }
    }

    #[test]
    fn 数値は前後の空白と先頭の符号を整えて渡る() {
        // Arrange
        let bind = Bind::new("id", BindKind::Number, Some(String::from(" +0042 ")));

        // Act
        let value = convert(&bind).unwrap();

        // Assert
        match value {
            BoundValue::Number(Some(text)) => assert_eq!(text, "0042"),
            _ => panic!("数値になるはず"),
        }
    }

    #[test]
    fn 数値は三十八桁でも桁を落とさずに渡る() {
        // Arrange: `NUMBER` は最大 38 桁であり `f64` を経由すると壊れる
        let digits = "1".repeat(38);
        let bind = Bind::new("huge", BindKind::Number, Some(digits.clone()));

        // Act
        let value = convert(&bind).unwrap();

        // Assert
        match value {
            BoundValue::Number(Some(text)) => assert_eq!(text, digits),
            _ => panic!("数値になるはず"),
        }
    }

    #[test]
    fn 小数と指数の表記も数値として読める() {
        // Arrange
        let 小数 = Bind::new("rate", BindKind::Number, Some(String::from("-.5")));
        let 指数 = Bind::new("big", BindKind::Number, Some(String::from("1.5E+3")));

        // Act
        let 小数の値 = convert(&小数).unwrap();
        let 指数の値 = convert(&指数).unwrap();

        // Assert
        match (小数の値, 指数の値) {
            (BoundValue::Number(Some(小数)), BoundValue::Number(Some(指数))) => {
                assert_eq!(小数, "-0.5");
                assert_eq!(指数, "1.5e3");
            }
            _ => panic!("どちらも数値になるはず"),
        }
    }

    #[test]
    fn 数値として読めない値はどの変数のどの値かを添えて失敗する() {
        // Arrange
        let bind = Bind::new("id", BindKind::Number, Some(String::from("1,000")));

        // Act
        let error = convert(&bind).unwrap_err();

        // Assert
        assert!(
            error.message.contains(":id") && error.message.contains("1,000"),
            "メッセージ: {}",
            error.message
        );
        assert!(
            error.message.contains("NUMBER"),
            "メッセージ: {}",
            error.message
        );
    }

    #[test]
    fn 全角数字は数値として読めない() {
        // Arrange
        let bind = Bind::new("id", BindKind::Number, Some(String::from("４２")));

        // Act
        let result = convert(&bind);

        // Assert
        assert!(result.is_err());
    }

    #[test]
    fn 日付は年月日だけの表記で読める() {
        // Arrange
        let bind = Bind::new("day", BindKind::Date, Some(String::from("2024-02-29")));

        // Act
        let value = convert(&bind).unwrap();

        // Assert
        assert_eq!(日時の桁(&value), Some((2024, 2, 29, 0, 0, 0, 0)));
    }

    #[test]
    fn 日付は斜線区切りと時刻付きでも読める() {
        // Arrange
        let bind = Bind::new(
            "moment",
            BindKind::Date,
            Some(String::from("2024/03/04 05:06:07")),
        );

        // Act
        let value = convert(&bind).unwrap();

        // Assert
        assert_eq!(日時の桁(&value), Some((2024, 3, 4, 5, 6, 7, 0)));
    }

    #[test]
    fn 日付は小数秒を落として渡る() {
        // Arrange: Oracle の `DATE` は秒までしか持てない
        let bind = Bind::new(
            "moment",
            BindKind::Date,
            Some(String::from("2024-03-04T05:06:07.123456")),
        );

        // Act
        let value = convert(&bind).unwrap();

        // Assert
        assert_eq!(日時の桁(&value), Some((2024, 3, 4, 5, 6, 7, 0)));
    }

    #[test]
    fn タイムスタンプは小数秒をナノ秒まで保って渡る() {
        // Arrange
        let bind = Bind::new(
            "moment",
            BindKind::Timestamp,
            Some(String::from("2024-03-04 05:06:07.123456")),
        );

        // Act
        let value = convert(&bind).unwrap();

        // Assert
        assert_eq!(日時の桁(&value), Some((2024, 3, 4, 5, 6, 7, 123_456_000)));
    }

    #[test]
    fn 暦として成り立たない日付は失敗する() {
        // Arrange: 2023 年は閏年ではない
        let bind = Bind::new("day", BindKind::Date, Some(String::from("2023-02-29")));

        // Act
        let error = convert(&bind).unwrap_err();

        // Assert
        assert!(
            error.message.contains("2023-02-29") && error.message.contains("DATE"),
            "メッセージ: {}",
            error.message
        );
    }

    #[test]
    fn 時間帯付きの表記は日付として読めない() {
        // Arrange: Oracle の DATE と TIMESTAMP は時間帯を持たない
        let bind = Bind::new(
            "moment",
            BindKind::Timestamp,
            Some(String::from("2024-03-04T05:06:07Z")),
        );

        // Act
        let result = convert(&bind);

        // Assert
        assert!(result.is_err());
    }

    #[test]
    fn 区切りの無い日付は読めない() {
        // Arrange
        let bind = Bind::new("day", BindKind::Date, Some(String::from("20240304")));

        // Act
        let result = convert(&bind);

        // Assert
        assert!(result.is_err());
    }

    #[test]
    fn nullは型に関わらずnullとして渡る() {
        // Arrange
        let binds = [
            Bind::new("a", BindKind::Varchar2, None),
            Bind::new("b", BindKind::Number, None),
            Bind::new("c", BindKind::Date, None),
            Bind::new("d", BindKind::Timestamp, None),
        ];

        // Act
        let values: Vec<BoundValue> = binds.iter().map(|bind| convert(bind).unwrap()).collect();

        // Assert
        assert!(matches!(values[0], BoundValue::Varchar2(None)));
        assert!(matches!(values[1], BoundValue::Number(None)));
        assert!(matches!(values[2], BoundValue::Date(None)));
        assert!(matches!(values[3], BoundValue::Timestamp(None)));
    }
}
