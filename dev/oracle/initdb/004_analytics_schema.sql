-- KODUCHI_ANALYTICS スキーマ（ADR 0007 のスキーマツリー確認用）。
--
-- 接続ユーザー KODUCHI から見て「自分以外のスキーマ」にあたる。ツリーが複数の
-- オーナーを扱えること、フィルタが効くことを確認するために置く。

WHENEVER SQLERROR EXIT SQL.SQLCODE
SET DEFINE OFF
SET ECHO ON

ALTER SESSION SET CONTAINER = FREEPDB1;

CREATE TABLE koduchi_analytics.daily_gmv (
  gmv_date   DATE          PRIMARY KEY,
  gross      NUMBER(14, 2) NOT NULL,
  refunds    NUMBER(14, 2) DEFAULT 0 NOT NULL,
  order_count NUMBER(8)    NOT NULL
);

CREATE TABLE koduchi_analytics.channel_cost (
  cost_date DATE          NOT NULL,
  channel   VARCHAR2(32)  NOT NULL,
  cost      NUMBER(12, 2) NOT NULL,
  CONSTRAINT pk_channel_cost PRIMARY KEY (cost_date, channel)
);

INSERT INTO koduchi_analytics.daily_gmv (gmv_date, gross, refunds, order_count)
SELECT
  TRUNC(SYSDATE) - LEVEL,
  ROUND(MOD(LEVEL * 7919, 3000000) + 500000, 2),
  ROUND(MOD(LEVEL * 131, 90000), 2),
  MOD(LEVEL * 13, 400) + 20
FROM dual
CONNECT BY LEVEL <= 180;

INSERT INTO koduchi_analytics.channel_cost (cost_date, channel, cost)
SELECT
  TRUNC(SYSDATE) - d.n,
  c.channel,
  ROUND(MOD(d.n * 977 + LENGTH(c.channel) * 31, 400000) + 10000, 2)
FROM (SELECT LEVEL AS n FROM dual CONNECT BY LEVEL <= 180) d
CROSS JOIN (
  SELECT 'organic search' AS channel FROM dual UNION ALL
  SELECT 'paid social' FROM dual UNION ALL
  SELECT 'email' FROM dual UNION ALL
  SELECT 'paid search' FROM dual
) c;

COMMIT;

CREATE OR REPLACE VIEW koduchi_analytics.gmv_by_week AS
SELECT
  TRUNC(gmv_date, 'IW') AS week,
  SUM(gross)            AS gross,
  SUM(refunds)          AS refunds,
  SUM(order_count)      AS order_count
FROM koduchi_analytics.daily_gmv
GROUP BY TRUNC(gmv_date, 'IW');

BEGIN
  DBMS_STATS.GATHER_SCHEMA_STATS('KODUCHI_ANALYTICS');
END;
/

EXIT
