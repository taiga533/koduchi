-- 定義タブの見出しに出す統計とセグメントの大きさの見本（ADR 0044）。
--
-- 002〜008 の表の統計は自動統計収集のジョブが気まぐれに採り直すため、
-- `NUM_ROWS` も `LAST_ANALYZED` も統合テストで値を決め打ちできない。ここでは
-- 統計を採ってから**ロックした**表と、統計を消してからロックした表を作り、
-- ジョブが触れない状態で揃える。
--
-- 次の 7 つを揃える。
--
--   * 統計を採った表（索引と LOB を持つ。表・索引・LOB の 3 つに分けて測る）
--   * 統計を 1 度も採っていない表（行数は「不明」であって 0 ではない）。
--     行も無いため、遅延セグメント作成でセグメントがまだ無い
--   * パーティション表（セグメントがパーティションの数だけある）
--   * 索引構成表（表のセグメントが無く、行の本体は索引にある）
--   * 一時表（永続のセグメントを持たない）
--   * セグメントを測っても表の大きさにならない表（クラスタ化表・外部表）と、
--     表と別の名前のセグメントを持つ表（overflow 付きの索引構成表・ネストした表）
--   * `SELECT_CATALOG_ROLE` を持たない利用者（他人の表の `DBA_SEGMENTS` が
--     読めない。権限が無いことを 0 と取り違えないことを確かめる）
--
-- 他の開発用スクリプトのオブジェクトには触れない。名前にはすべて `STATS` を
-- 含める。006 と同じく、既にボリュームを持っている開発者はこのスクリプトを
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

-- セグメントの大きさを表 1 つに帰せない表と、表と別の名前のセグメントを持つ表。
-- 「セグメントが 0 個」を「行が無い」と取り違えないことと、別名のセグメントを
-- 取りこぼさないことを確かめる。

-- クラスタ化表。行はクラスタのセグメントにあり、表のセグメントは無い。
CREATE CLUSTER koduchi.stats_cluster (id NUMBER(10));
CREATE INDEX koduchi.ix_stats_cluster ON CLUSTER koduchi.stats_cluster;
CREATE TABLE koduchi.stats_clustered (
  id NUMBER(10)
) CLUSTER koduchi.stats_cluster (id);

INSERT INTO koduchi.stats_clustered (id)
SELECT level FROM dual CONNECT BY level <= 20;

COMMIT;

-- 外部表。行はデータベースの外のファイルにあり、セグメントを持たない。
-- 作るだけならファイルは要らない（読むときに初めて探す）。
CREATE DIRECTORY koduchi_stats_dir AS '/tmp';
GRANT READ ON DIRECTORY koduchi_stats_dir TO koduchi;
CREATE TABLE koduchi.stats_external (
  id NUMBER(10)
)
ORGANIZATION EXTERNAL (
  TYPE ORACLE_LOADER
  DEFAULT DIRECTORY koduchi_stats_dir
  LOCATION ('koduchi_stats_external.csv')
);

-- overflow 付きの索引構成表。`ID` より後ろの列は `SYS_IOT_OVER_*` の
-- セグメントに入る。
CREATE TABLE koduchi.stats_iot_overflow (
  id   NUMBER(10) CONSTRAINT pk_stats_iot_overflow PRIMARY KEY,
  body VARCHAR2(2000)
) ORGANIZATION INDEX INCLUDING id OVERFLOW;

INSERT INTO koduchi.stats_iot_overflow (id, body)
SELECT level, RPAD('x', 1500, 'x') FROM dual CONNECT BY level <= 200;

COMMIT;

-- ネストした表。入れ子の行は `STATS_NESTED_TAGS` のセグメント（区分は
-- `NESTED TABLE`）に入る。
CREATE TYPE koduchi.stats_tag_list AS TABLE OF VARCHAR2(40);
/

CREATE TABLE koduchi.stats_nested (
  id   NUMBER(10),
  tags koduchi.stats_tag_list
) NESTED TABLE tags STORE AS stats_nested_tags;

-- 格納表には Oracle が `SYS_FK…` の索引を `GENERATED = 'N'` で作る。スキーマ
-- ツリーは自動生成でない索引として並べてしまい（ADR 0014 の見本と食い違う）、
-- この見本の目的にも要らないため落とす。
BEGIN
  FOR ix IN (
    SELECT owner, index_name FROM dba_indexes
     WHERE table_owner = 'KODUCHI' AND table_name = 'STATS_NESTED_TAGS'
  ) LOOP
    EXECUTE IMMEDIATE 'DROP INDEX "' || ix.owner || '"."' || ix.index_name || '"';
  END LOOP;
END;
/

INSERT INTO koduchi.stats_nested (id, tags)
SELECT level, koduchi.stats_tag_list('a', 'b', 'c') FROM dual CONNECT BY level <= 50;

COMMIT;

EXIT
