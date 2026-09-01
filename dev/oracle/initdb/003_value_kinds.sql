-- 値の受け渡しを試すための表（ADR の「値の受け渡し」節）。
--
-- 各セルは { text, kind } として送る決まりであり、その分類と表示を実際の
-- データで確認できるようにする。特に次の 3 点を意図している。
--
--   1. NUMBER の 38 桁が f64 を経由せず文字列のまま届くこと
--   2. NULL と空文字列が区別されること（Oracle では VARCHAR2 の空文字列が
--      NULL になるため、区別できるのは CLOB など一部に限られる）
--   3. CLOB の 64KB 打ち切りと、BLOB / RAW のサイズ表示

WHENEVER SQLERROR EXIT SQL.SQLCODE
SET DEFINE OFF
SET ECHO ON

ALTER SESSION SET CONTAINER = FREEPDB1;

CREATE TABLE koduchi.value_kinds (
  id              NUMBER(4) PRIMARY KEY,
  label           VARCHAR2(80),
  huge_integer    NUMBER(38, 0),
  precise_decimal NUMBER(38, 20),
  small_int       NUMBER(6),
  float_value     BINARY_DOUBLE,
  text_value      VARCHAR2(400),
  national_text   NVARCHAR2(200),
  fixed_text      CHAR(10),
  date_value      DATE,
  timestamp_value TIMESTAMP(6),
  tz_value        TIMESTAMP(6) WITH TIME ZONE,
  interval_value  INTERVAL DAY(3) TO SECOND(0),
  clob_value      CLOB,
  blob_value      BLOB,
  raw_value       RAW(64)
);

-- 通常の値。
INSERT INTO koduchi.value_kinds VALUES (
  1,
  '通常の値',
  1234567890,
  3.14159265358979323846,
  42,
  1.5,
  'ふつうの文字列 with ASCII',
  N'国際化された文字列 🍶',
  'FIXED',
  DATE '2026-08-30',
  TIMESTAMP '2026-08-30 15:04:05.123456',
  TIMESTAMP '2026-08-30 15:04:05.123456 +09:00',
  INTERVAL '3 04:05:06' DAY TO SECOND,
  '短い CLOB',
  UTL_RAW.CAST_TO_RAW('小さな BLOB'),
  HEXTORAW('DEADBEEF')
);

-- NUMBER の限界値。f64 に入れると壊れるため、文字列のまま届く必要がある。
INSERT INTO koduchi.value_kinds (id, label, huge_integer, precise_decimal, small_int, text_value) VALUES (
  2,
  'NUMBER の 38 桁',
  99999999999999999999999999999999999999,
  0.00000000000000000001,
  -1,
  '桁が落ちていたら huge_integer の末尾が 0 になる'
);

-- すべて NULL。NULL の表示（淡色・斜体の NULL）を確認する。
INSERT INTO koduchi.value_kinds (id, label) VALUES (3, 'ほとんど NULL');

-- 空文字列。Oracle では VARCHAR2 の空文字列は NULL になるが、
-- CLOB の空文字列は NULL と区別できる。
INSERT INTO koduchi.value_kinds (id, label, text_value, clob_value) VALUES (
  4,
  '空文字列と NULL の区別',
  '',
  EMPTY_CLOB()
);

-- 64KB を超える CLOB。先頭 64KB までの打ち切りを確認する。
INSERT INTO koduchi.value_kinds (id, label, clob_value) VALUES (
  5,
  '64KB を超える CLOB',
  RPAD('あ', 1000, 'あ')
);

-- 連結で組み立てる。DBMS_LOB.WRITEAPPEND は CLOB の量を文字数で取るが、
-- マルチバイト文字のバッファではバイト長との突き合わせで ORA-22921 になる。
--
-- このデータベースは NLS_LENGTH_SEMANTICS = BYTE であるため、RPAD の長さは
-- バイト数として効く。'い' は 3 バイトなので 1 回の RPAD で 2,000 文字得られ、
-- 40 回で 80,000 文字（240,000 バイト）になる。文字数で数えてもバイト数で
-- 数えても 64KB を超えるため、打ち切りの確認に使える。
DECLARE
  v_clob CLOB;
BEGIN
  v_clob := RPAD('あ', 1000, 'あ');
  FOR i IN 1 .. 40 LOOP
    v_clob := v_clob || RPAD('い', 4000, 'い');
  END LOOP;
  UPDATE koduchi.value_kinds SET clob_value = v_clob WHERE id = 5;
  COMMIT;
END;
/

-- 大きめの BLOB。`[BLOB 12.0 KB]` のようなサイズ表示を確認する。
DECLARE
  v_blob BLOB;
BEGIN
  INSERT INTO koduchi.value_kinds (id, label, blob_value)
  VALUES (6, '大きめの BLOB', EMPTY_BLOB())
  RETURNING blob_value INTO v_blob;

  FOR i IN 1 .. 12 LOOP
    DBMS_LOB.WRITEAPPEND(v_blob, 1024, UTL_RAW.COPIES(HEXTORAW('A5'), 1024));
  END LOOP;
  COMMIT;
END;
/

-- 数値の符号と極端な値。結果テーブルの右寄せ判定を確認する。
INSERT INTO koduchi.value_kinds (id, label, huge_integer, precise_decimal, small_int, float_value) VALUES (
  7,
  '負値と極端な値',
  -99999999999999999999999999999999999999,
  -0.00000000000000000001,
  -999999,
  -1.7976931348623157E+308D
);

COMMIT;

EXIT
