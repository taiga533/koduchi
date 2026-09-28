//! Oracle の表の統計とセグメントの大きさの取得（ADR 0044）。
//!
//! 定義（ADR 0019）と同じく `Connection` を直接使うため、`OracleDriver` が持つ
//! 結果セットのカーソル（ADR 0003）には触れない。呼び出し側はプールの
//! `background_handle` で選んだ接続を渡す。
//!
//! # 列挙元
//!
//! | ビュー               | 取るもの                                              |
//! | -------------------- | ----------------------------------------------------- |
//! | `ALL_TABLES`         | 行数・採った日時・パーティション・索引構成・一時表    |
//! | `ALL_TAB_STATISTICS` | 統計が古いか（`STALE_STATS`）。外部結合で混ぜる       |
//! | `USER_SEGMENTS`      | 自分の表のセグメント。権限が要らない                  |
//! | `DBA_SEGMENTS`       | 他人の表のセグメント。**権限が要る**（`ALL_` は無い） |
//! | `ALL_INDEXES`        | 表に付いた索引の名前                                  |
//! | `ALL_LOBS`           | LOB のセグメントと、その索引の名前                    |

use crate::db::error::{DbErrorKind, DbResult};
use crate::db::oracle::errors::{self, map_permission_error};
use crate::db::schema::ObjectKind;
use crate::db::stats::{
    parse_stale, segment_view, summarize_segments, ObjectStats, SegmentPart, SegmentSize,
    SegmentView,
};
use oracle::Connection;

/// 統計を取る問い合わせ（ADR 0044）。
///
/// **`USER` を同じ 1 本で返す。**どちらの辞書ビューでセグメントを測るかを
/// 決めるのに要り、そのためだけに往復を足さない。
///
/// 経った日数はデータベースの `SYSDATE` から引く。`LAST_ANALYZED` は
/// データベースの時計で書かれており、手元の時計と引くとタイムゾーンの差が
/// そのまま日数に混ざる。
///
/// `ALL_TAB_STATISTICS` はパーティションの行も持つため、`OBJECT_TYPE` を
/// `TABLE` に絞って表全体の 1 行だけを当てる。
const STATS_SQL: &str = "select t.num_rows,
       to_char(t.last_analyzed, 'YYYY-MM-DD HH24:MI'),
       floor(sysdate - t.last_analyzed),
       s.stale_stats,
       t.partitioned,
       t.iot_type,
       t.temporary,
       user
  from all_tables t
  left join all_tab_statistics s
    on s.owner = t.owner
   and s.table_name = t.table_name
   and s.object_type = 'TABLE'
 where t.owner = :owner and t.table_name = :name";

/// 他人の表のセグメントを測る問い合わせ（ADR 0044）。
///
/// 3 つを `union all` で繋ぎ、区分を付けて返す。
///
/// - **表** … 表と同じ名前のセグメント。表と索引は名前空間が別であり、表と
///   同じ名前の索引がありうるため、`SEGMENT_TYPE` でも絞る。
/// - **索引** … `ALL_INDEXES` から引いた名前のセグメント。索引構成表の主キーの
///   索引（`IOT - TOP`）は**行の本体そのもの**であるため表に数える。
/// - **LOB** … `ALL_LOBS` の LOB セグメントと、その索引。LOB の索引は
///   `ALL_INDEXES` に出ないため、`ALL_LOBS.INDEX_NAME` から引く。
const DBA_SEGMENTS_SQL: &str = "select 'TABLE', s.bytes
  from dba_segments s
 where s.owner = :owner
   and s.segment_name = :name
   and s.segment_type in ('TABLE', 'TABLE PARTITION', 'TABLE SUBPARTITION')
union all
select case when i.index_type = 'IOT - TOP' then 'TABLE' else 'INDEX' end, s.bytes
  from all_indexes i
  join dba_segments s
    on s.owner = i.owner
   and s.segment_name = i.index_name
 where i.table_owner = :owner
   and i.table_name = :name
   and i.index_type <> 'LOB'
   and s.segment_type in ('INDEX', 'INDEX PARTITION', 'INDEX SUBPARTITION')
union all
select 'LOB', s.bytes
  from all_lobs l
  join dba_segments s
    on s.owner = l.owner
   and s.segment_name in (l.segment_name, l.index_name)
 where l.owner = :owner
   and l.table_name = :name";

/// 自分の表のセグメントを測る問い合わせ（ADR 0044）。
///
/// `DBA_SEGMENTS_SQL` と同じ形で、`USER_SEGMENTS` を引く。`USER_SEGMENTS` には
/// `OWNER` が無いため、索引と LOB の所有者を `USER` に絞る。**他人のスキーマに
/// 作られた索引は数えない**（権限の要る `DBA_SEGMENTS` を引かないための割り切り
/// である。自分の表に他人が索引を張ることは稀である）。
const USER_SEGMENTS_SQL: &str = "select 'TABLE', s.bytes
  from user_segments s
 where s.segment_name = :name
   and s.segment_type in ('TABLE', 'TABLE PARTITION', 'TABLE SUBPARTITION')
union all
select case when i.index_type = 'IOT - TOP' then 'TABLE' else 'INDEX' end, s.bytes
  from all_indexes i
  join user_segments s
    on s.segment_name = i.index_name
 where i.owner = user
   and i.table_owner = :owner
   and i.table_name = :name
   and i.index_type <> 'LOB'
   and s.segment_type in ('INDEX', 'INDEX PARTITION', 'INDEX SUBPARTITION')
union all
select 'LOB', s.bytes
  from all_lobs l
  join user_segments s
    on s.segment_name in (l.segment_name, l.index_name)
 where l.owner = :owner
   and l.table_name = :name";

/// `DBA_SEGMENTS` が権限で読めなかったときの案内。
const SEGMENTS_PERMISSION_HINT: &str =
    "。この接続には他のスキーマのセグメントを読む権限がありません（SELECT_CATALOG_ROLE などが要ります）";

/// 表 1 つの統計とセグメントの大きさを取る（ADR 0044）。
///
/// **表とマテリアライズドビュー以外では問い合わせにも行かず `None` を返す。**
/// ビューは統計もセグメントも持たない。種別の集合は `has_table_details()`
/// （制約と索引を引く種別）と一致しており、同じものを別の名前で書かない。
///
/// `ALL_TABLES` に行が無い（見えない・消えた）ときも `None` である。
///
/// **セグメントの権限不足で統計まで失わせない。**`DBA_SEGMENTS` が読めない
/// ときは `SegmentSize::PermissionDenied` として返し、統計は並べて出す。
///
/// # 引数
///
/// * `connection` - 使う接続
/// * `owner` - 所有者のスキーマ名
/// * `name` - オブジェクト名
/// * `kind` - オブジェクトの種類
pub fn load_stats(
    connection: &Connection,
    owner: &str,
    name: &str,
    kind: ObjectKind,
) -> DbResult<Option<ObjectStats>> {
    if !kind.has_table_details() {
        return Ok(None);
    }

    type Row = (
        Option<i64>,
        Option<String>,
        Option<i64>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        String,
    );

    let 読めない =
        |error: oracle::Error| errors::map_execute_error("表の統計を取得できませんでした", &error);

    let mut rows = connection
        .query_as::<Row>(STATS_SQL, &[&owner, &name])
        .map_err(読めない)?;

    let Some(row) = rows.next() else {
        return Ok(None);
    };
    let (num_rows, last_analyzed, days, stale, partitioned, iot_type, temporary, session_user) =
        row.map_err(読めない)?;

    let temporary = temporary.as_deref() == Some("Y");
    let size = if temporary {
        SegmentSize::NotStored
    } else {
        load_segment_size(connection, owner, name, segment_view(owner, &session_user))?
    };

    Ok(Some(ObjectStats {
        num_rows: num_rows.and_then(|value| u64::try_from(value).ok()),
        last_analyzed,
        days_since_analyzed: days,
        stale: parse_stale(stale.as_deref()),
        partitioned: partitioned.as_deref() == Some("YES"),
        index_organized: iot_type.as_deref() == Some("IOT"),
        temporary,
        size,
    }))
}

/// セグメントの大きさを測る（ADR 0044）。
///
/// 権限不足は `PermissionDenied` として値で返す。**それ以外の失敗（接続断を
/// 含む）はエラーのまま返す。**写し替えは `errors.rs` を通すため、接続断は
/// 権限不足より先に見分けられる（ADR 0026・0030）。
///
/// # 引数
///
/// * `connection` - 使う接続
/// * `owner` - 所有者のスキーマ名
/// * `name` - 表の名前
/// * `view` - 測る辞書ビュー
fn load_segment_size(
    connection: &Connection,
    owner: &str,
    name: &str,
    view: SegmentView,
) -> DbResult<SegmentSize> {
    let sql = match view {
        SegmentView::User => USER_SEGMENTS_SQL,
        SegmentView::Dba => DBA_SEGMENTS_SQL,
    };

    let 読めない = |error: oracle::Error| {
        map_permission_error(
            &format!("{owner}.{name} のセグメントを取得できません"),
            &error,
            SEGMENTS_PERMISSION_HINT,
        )
    };

    let rows = match connection
        .query_as_named::<(String, i64)>(sql, &[("owner", &owner), ("name", &name)])
    {
        Ok(rows) => rows,
        Err(error) => {
            let error = 読めない(error);
            return match error.kind {
                DbErrorKind::Permission => Ok(SegmentSize::PermissionDenied),
                _ => Err(error),
            };
        }
    };

    let mut segments = Vec::new();

    for row in rows {
        let (label, bytes) = row.map_err(|error| {
            errors::map_execute_error("セグメントの大きさを読み取れませんでした", &error)
        })?;
        // 区分は問い合わせが 3 つしか返さない。知らない綴りは数えない。
        if let Some(part) = SegmentPart::from_label(&label) {
            segments.push((part, u64::try_from(bytes).unwrap_or(0)));
        }
    }

    Ok(summarize_segments(&segments))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 統計は同じ往復で接続している利用者も返す() {
        // Arrange & Act & Assert: どちらのビューで測るかを決めるための往復を足さない
        assert!(STATS_SQL.contains("\n       user\n"));
    }

    #[test]
    fn 統計の古さは表全体の行だけに当てる() {
        // Arrange & Act & Assert: パーティションの行が混ざると表が重複する
        assert!(STATS_SQL.contains("s.object_type = 'TABLE'"));
        assert!(STATS_SQL.contains("left join all_tab_statistics"));
    }

    #[test]
    fn 自分の表は権限の要らないビューだけを引く() {
        // Arrange & Act & Assert
        assert!(!USER_SEGMENTS_SQL.contains("dba_segments"));
        assert_eq!(USER_SEGMENTS_SQL.matches("user_segments").count(), 3);
    }

    #[test]
    fn 他人の表はdbaのビューだけを引く() {
        // Arrange & Act & Assert
        assert!(!DBA_SEGMENTS_SQL.contains("user_segments"));
        assert_eq!(DBA_SEGMENTS_SQL.matches("dba_segments").count(), 3);
    }

    #[test]
    fn 索引構成表の主キーの索引は表に数える() {
        // Arrange & Act & Assert: 行の本体が索引にある
        for sql in [USER_SEGMENTS_SQL, DBA_SEGMENTS_SQL] {
            assert!(sql.contains("when i.index_type = 'IOT - TOP' then 'TABLE'"));
        }
    }

    #[test]
    fn lobの索引は索引ではなくlobに数える() {
        // Arrange & Act & Assert: 二重に数えない
        for sql in [USER_SEGMENTS_SQL, DBA_SEGMENTS_SQL] {
            assert!(sql.contains("i.index_type <> 'LOB'"));
            assert!(sql.contains("in (l.segment_name, l.index_name)"));
        }
    }
}
