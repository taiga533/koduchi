-- 定義タブの見出しに出す統計とセグメントの大きさの見本（ADR 0044）。
--
-- 002〜008 の表の統計は自動統計収集のジョブが気まぐれに採り直すため、
-- `NUM_ROWS` も `LAST_ANALYZED` も統合テストで値を決め打ちできない。ここでは
-- 統計を採ってから**ロックした**表と、統計を消してからロックした表を作り、
-- ジョブが触れない状態で揃える。
--
-- 次の 6 つを揃える。
--
--   * 統計を採った表（索引と LOB を持つ。表・索引・LOB の 3 つに分けて測る）
--   * 統計を 1 度も採っていない表（行数は「不明」であって 0 ではない）。
--     行も無いため、遅延セグメント作成でセグメントがまだ無い
--   * パーティション表（セグメントがパーティションの数だけある）
--   * 索引構成表（表のセグメントが無く、行の本体は索引にある）
--   * 一時表（永続のセグメントを持たない）
--   * `SELECT_CATALOG_ROLE` を持たない利用者（他人の表の `DBA_SEGMENTS` が
--     読めない。権限が無いことを 0 と取り違えないことを確かめる）
--
-- 他の開発用スクリプトのオブジェクトには触れない。名前はすべて `STATS_` で
-- 始める。006 と同じく、既にボリュームを持っている開発者はこのスクリプトを
-- 手で流す。

WHENEVER SQLERROR EXIT SQL.SQLCODE
SET DEFINE OFF
SET ECHO ON

ALTER SESSION SET CONTAINER = FREEPDB1;

-- 統計を採った表。CLOB は行の外へ出るよう `DISABLE STORAGE IN ROW` にして、
-- LOB セグメントに中身が入るようにする。
CREATE TABLE koduchi.stats_sample (
  id   NUMBER(10) CONSTRAINT pk_stats_sample PRIMARY KEY,
  note VARCHAR2(40),
  body CLOB
) LOB (body) STORE AS (DISABLE STORAGE IN ROW);

INSERT INTO koduchi.stats_sample (id, note, body)
SELECT level, 'row ' || level, RPAD('x', 2000, 'x')
  FROM dual
CONNECT BY level <= 120;

COMMIT;

BEGIN
  DBMS_STATS.GATHER_TABLE_STATS('KODUCHI', 'STATS_SAMPLE');
  DBMS_STATS.LOCK_TABLE_STATS('KODUCHI', 'STATS_SAMPLE');
END;
/

-- 統計を 1 度も採っていない表。行も入れないため、セグメントもまだ無い。
-- 作った直後は統計が無いが、自動統計収集が採ってしまわないようロックする。
CREATE TABLE koduchi.stats_unanalyzed (
  id NUMBER(10)
);

BEGIN
  DBMS_STATS.DELETE_TABLE_STATS('KODUCHI', 'STATS_UNANALYZED');
  DBMS_STATS.LOCK_TABLE_STATS('KODUCHI', 'STATS_UNANALYZED');
END;
/

-- パーティション表。2 つのパーティションの両方に行を入れ、セグメントを 2 つ立てる。
CREATE TABLE koduchi.stats_partitioned (
  id NUMBER(10)
)
PARTITION BY RANGE (id) (
  PARTITION p_low  VALUES LESS THAN (100),
  PARTITION p_high VALUES LESS THAN (MAXVALUE)
);

INSERT INTO koduchi.stats_partitioned (id)
SELECT level FROM dual CONNECT BY level <= 200;

COMMIT;

BEGIN
  DBMS_STATS.GATHER_TABLE_STATS('KODUCHI', 'STATS_PARTITIONED');
  DBMS_STATS.LOCK_TABLE_STATS('KODUCHI', 'STATS_PARTITIONED');
END;
/

-- 索引構成表。表のセグメントは作られず、行の本体は主キーの索引にある。
CREATE TABLE koduchi.stats_iot (
  id   NUMBER(10) CONSTRAINT pk_stats_iot PRIMARY KEY,
  name VARCHAR2(40)
) ORGANIZATION INDEX;

INSERT INTO koduchi.stats_iot (id, name)
SELECT level, 'name ' || level FROM dual CONNECT BY level <= 50;

COMMIT;

-- 一時表。永続のセグメントを持たない。
CREATE GLOBAL TEMPORARY TABLE koduchi.stats_temp (
  id NUMBER(10)
) ON COMMIT PRESERVE ROWS;

-- `SELECT_CATALOG_ROLE` を持たない利用者。`KODUCHI.STATS_SAMPLE` だけが見える。
-- この利用者から見ると、統計（`ALL_TABLES`）は読めるが `DBA_SEGMENTS` は読めない。
CREATE USER koduchi_stats_viewer IDENTIFIED BY koduchi_dev;
GRANT CREATE SESSION TO koduchi_stats_viewer;
GRANT SELECT ON koduchi.stats_sample TO koduchi_stats_viewer;

EXIT
