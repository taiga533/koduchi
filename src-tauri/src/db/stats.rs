//! 定義タブの見出しに出す表の統計とセグメントの大きさ（ADR 0044）。
//!
//! データベースに依らない形にしてある。Oracle 固有の列挙元
//! （`ALL_TABLES` / `ALL_TAB_STATISTICS` / `USER_SEGMENTS` / `DBA_SEGMENTS`）は
//! `oracle::stats` に置く。
//!
//! ここへ切り出したのは、セグメントの行を「表・索引・LOB」の 3 つへ畳む作業と
//! 「どちらの辞書ビューで測るか」の判断が、どちらもデータの形だけで決まる
//! からである。データベース抜きで境界（パーティションが複数ある・セグメントが
//! 1 つも無い）を試せる側に置く（ADR 0010）。

use serde::Serialize;

/// 表 1 つの統計とセグメントの大きさ（ADR 0044）。
///
/// **`num_rows` は統計を採った時点の行数であり、今の行数ではない。** 画面では
/// 必ず `last_analyzed` と並べて出す。統計を採っていない表では `None` であり、
/// 0 行と取り違えさせない。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectStats {
    /// 統計を採った時点の行数（`ALL_TABLES.NUM_ROWS`）。
    pub num_rows: Option<u64>,
    /// 統計を採った日時（`YYYY-MM-DD HH24:MI`）。データベースの時計で書く。
    pub last_analyzed: Option<String>,
    /// 統計を採ってから経った日数。データベースの時計同士で引いてある。
    pub days_since_analyzed: Option<i64>,
    /// 統計が古いとデータベースが見なしているか（`ALL_TAB_STATISTICS.STALE_STATS`）。
    ///
    /// 統計が無い表や、監視の対象外の表では `None` になる。
    pub stale: Option<bool>,
    /// パーティション表か。
    pub partitioned: bool,
    /// 索引構成表か。
    pub index_organized: bool,
    /// 一時表か。一時表は永続のセグメントを持たない。
    pub temporary: bool,
    /// セグメントの大きさ。
    pub size: SegmentSize,
}

/// セグメントの大きさ、または測れなかった理由（ADR 0044）。
///
/// **権限が無くて測れないことを 0 バイトとして返さない。** 「空の表」と
/// 「見えない表」を取り違えさせないためである（ADR 0017 と同じ考え方）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SegmentSize {
    /// 測れた。
    Measured {
        /// 表の本体。パーティションは足し上げ、索引構成表では主キーの索引を含む。
        table_bytes: u64,
        /// 表に付いた索引（LOB の索引を除く）。
        index_bytes: u64,
        /// LOB のセグメントと、その索引。
        lob_bytes: u64,
        /// 数えたセグメントの数。0 なら、まだセグメントが作られていない。
        segment_count: u64,
    },
    /// `DBA_SEGMENTS` を読む権限が無い。
    PermissionDenied,
    /// 一時表であり、永続のセグメントを持たない。
    NotStored,
}

/// セグメント 1 つが何の一部か（ADR 0044）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SegmentPart {
    Table,
    Index,
    Lob,
}

impl SegmentPart {
    /// 問い合わせが返す区分の綴りから変換する。
    ///
    /// 知らない綴りは `None` にする。問い合わせ側で 3 つしか返さないため、
    /// 通常は起きない。
    ///
    /// # 引数
    ///
    /// * `raw` - 問い合わせが返した区分（`TABLE` / `INDEX` / `LOB`）
    pub fn from_label(raw: &str) -> Option<Self> {
        match raw {
            "TABLE" => Some(SegmentPart::Table),
            "INDEX" => Some(SegmentPart::Index),
            "LOB" => Some(SegmentPart::Lob),
            _ => None,
        }
    }
}

/// セグメントを測る辞書ビュー（ADR 0044）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SegmentView {
    /// `USER_SEGMENTS`。権限が要らない。
    User,
    /// `DBA_SEGMENTS`。`SELECT_CATALOG_ROLE` などが要る。
    Dba,
}

/// どちらの辞書ビューで測るかを決める（ADR 0044）。
///
/// **`ALL_SEGMENTS` は存在しない。** 他人の表を測る道は `DBA_SEGMENTS` だけで
/// あり、これには権限が要る。自分の表なら権限の要らない `USER_SEGMENTS` で
/// 足りるため、権限の有無で同じ表の見え方が変わらないよう、自分の表では
/// 常にこちらを使う。
///
/// # 引数
///
/// * `owner` - 表の所有者
/// * `session_user` - 接続している利用者（`USER`）
pub fn segment_view(owner: &str, session_user: &str) -> SegmentView {
    if owner == session_user {
        SegmentView::User
    } else {
        SegmentView::Dba
    }
}

/// セグメントの行を表・索引・LOB の 3 つへ足し上げる（ADR 0044）。
///
/// パーティション表はセグメントがパーティションの数だけあるため、1 行ずつ
/// ではなく区分ごとに足す。
///
/// # 引数
///
/// * `rows` - 区分と大きさ（バイト）の組
pub fn summarize_segments(rows: &[(SegmentPart, u64)]) -> SegmentSize {
    let mut table_bytes = 0;
    let mut index_bytes = 0;
    let mut lob_bytes = 0;

    for (part, bytes) in rows {
        match part {
            SegmentPart::Table => table_bytes += bytes,
            SegmentPart::Index => index_bytes += bytes,
            SegmentPart::Lob => lob_bytes += bytes,
        }
    }

    SegmentSize::Measured {
        table_bytes,
        index_bytes,
        lob_bytes,
        segment_count: rows.len() as u64,
    }
}

/// `STALE_STATS` の綴りを真偽へ読む（ADR 0044）。
///
/// `YES` / `NO` のほかに、統計が無い表では `NULL` が返る。それを「古くない」と
/// 読むと、統計を 1 度も採っていない表が健全に見える。
///
/// # 引数
///
/// * `raw` - `ALL_TAB_STATISTICS.STALE_STATS` の値
pub fn parse_stale(raw: Option<&str>) -> Option<bool> {
    match raw {
        Some("YES") => Some(true),
        Some("NO") => Some(false),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 自分の表は権限の要らないビューで測る() {
        // Arrange & Act
        let view = segment_view("KODUCHI", "KODUCHI");

        // Assert
        assert_eq!(view, SegmentView::User);
    }

    #[test]
    fn 他人の表はdbaのビューで測る() {
        // Arrange & Act: `ALL_SEGMENTS` は無い
        let view = segment_view("KODUCHI_ANALYTICS", "KODUCHI");

        // Assert
        assert_eq!(view, SegmentView::Dba);
    }

    #[test]
    fn パーティションごとのセグメントは足し上げる() {
        // Arrange
        let rows = [
            (SegmentPart::Table, 8_388_608),
            (SegmentPart::Table, 8_388_608),
            (SegmentPart::Index, 65_536),
            (SegmentPart::Lob, 1_000),
            (SegmentPart::Lob, 24),
        ];

        // Act
        let size = summarize_segments(&rows);

        // Assert
        assert_eq!(
            size,
            SegmentSize::Measured {
                table_bytes: 16_777_216,
                index_bytes: 65_536,
                lob_bytes: 1_024,
                segment_count: 5,
            }
        );
    }

    #[test]
    fn セグメントが無ければ数は0で測れたことになる() {
        // Arrange & Act: 遅延セグメント作成で、行を入れるまでセグメントは無い
        let size = summarize_segments(&[]);

        // Assert
        assert_eq!(
            size,
            SegmentSize::Measured {
                table_bytes: 0,
                index_bytes: 0,
                lob_bytes: 0,
                segment_count: 0,
            }
        );
    }

    #[test]
    fn 区分の綴りを読める() {
        // Arrange & Act & Assert
        assert_eq!(SegmentPart::from_label("TABLE"), Some(SegmentPart::Table));
        assert_eq!(SegmentPart::from_label("INDEX"), Some(SegmentPart::Index));
        assert_eq!(SegmentPart::from_label("LOB"), Some(SegmentPart::Lob));
        assert_eq!(SegmentPart::from_label("CLUSTER"), None);
    }

    #[test]
    fn 統計が無い表は古いとも新しいとも言わない() {
        // Arrange & Act & Assert
        assert_eq!(parse_stale(Some("YES")), Some(true));
        assert_eq!(parse_stale(Some("NO")), Some(false));
        assert_eq!(parse_stale(None), None);
    }

    #[test]
    fn 権限不足は0バイトではなく区分として送る() {
        // Arrange
        let size = SegmentSize::PermissionDenied;

        // Act
        let json = serde_json::to_value(&size).unwrap();

        // Assert
        assert_eq!(json, serde_json::json!({ "status": "permissionDenied" }));
    }

    #[test]
    fn 測れた大きさはキャメルケースで送る() {
        // Arrange
        let size = SegmentSize::Measured {
            table_bytes: 1,
            index_bytes: 2,
            lob_bytes: 3,
            segment_count: 4,
        };

        // Act
        let json = serde_json::to_value(&size).unwrap();

        // Assert
        assert_eq!(
            json,
            serde_json::json!({
                "status": "measured",
                "tableBytes": 1,
                "indexBytes": 2,
                "lobBytes": 3,
                "segmentCount": 4,
            })
        );
    }
}
