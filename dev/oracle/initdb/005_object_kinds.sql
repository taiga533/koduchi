-- スキーマツリーに並べるオブジェクト種別の見本（ADR 0014）。
--
-- 索引（002 の IX_EVENTS_* / IX_ORDERS_*）とテーブル・ビュー・関数・手続は
-- 既にあるため、ここでは残りの種別を足す。トリガー・シノニム・型の 3 つは
-- SYS からスキーマ修飾で作れる。
--
-- DB link だけはここで作らない。`CREATE DATABASE LINK` はスキーマ修飾を
-- 受け付けず、必ず接続中のユーザーのスキーマに作られるためである。代わりに
-- 権限だけを与え、統合テストが自分で作って自分で消す。

WHENEVER SQLERROR EXIT SQL.SQLCODE
SET DEFINE OFF
SET ECHO ON

ALTER SESSION SET CONTAINER = FREEPDB1;

-- 型。ツリーの「型」の束を空にしないためのもの。
CREATE OR REPLACE TYPE koduchi.order_summary AS OBJECT (
  order_id NUMBER(12),
  total    NUMBER(14, 2)
);
/

-- シノニム。別スキーマの表へ短い名前で届く。
CREATE OR REPLACE SYNONYM koduchi.daily_gmv FOR koduchi_analytics.daily_gmv;

-- トリガー。更新時刻を打ち直すだけの軽いもの。
CREATE OR REPLACE TRIGGER koduchi.trg_user_traits_touch
BEFORE UPDATE ON koduchi.user_traits
FOR EACH ROW
BEGIN
  :new.updated_at := SYSTIMESTAMP;
END;
/

-- 統合テストが DB link を作って消せるようにする。
GRANT CREATE DATABASE LINK TO koduchi;

EXIT
