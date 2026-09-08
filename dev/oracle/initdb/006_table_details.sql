-- テーブル定義ビューが出す制約と索引の見本（ADR 0019）。
--
-- 002 の表には外部キーはあるが、次の 3 つが無く、定義ビューの見え方を試せない。
--
--   * 複数列の主キーと、それを指す**複合の**外部キー
--   * 名前を明示した検査制約（`SYS_C0012345` ではないもの）
--   * 複数列の索引
--
-- 制約は名前をすべて明示してある。名前を書かずに作ると Oracle が
-- `SYS_C0012345` を割り当て、統合テストが名前で拾えなくなるためである
-- （実際のデータベースではその形が過半であり、それは定義ビューの表示側で
-- 引き受ける）。

WHENEVER SQLERROR EXIT SQL.SQLCODE
SET DEFINE OFF
SET ECHO ON

ALTER SESSION SET CONTAINER = FREEPDB1;

-- 複合の主キーを持つ表。外部キーの参照先になる。
CREATE TABLE koduchi.carrier_rates (
  carrier VARCHAR2(32),
  zone    VARCHAR2(8),
  rate    NUMBER(10, 2) NOT NULL,
  CONSTRAINT pk_carrier_rates PRIMARY KEY (carrier, zone)
);

-- 単一列の外部キー・名前付きの検査制約・名前付きの一意制約を持つ表。
CREATE TABLE koduchi.shipments (
  shipment_id NUMBER(12)   CONSTRAINT pk_shipments PRIMARY KEY,
  order_id    NUMBER(12)   NOT NULL,
  carrier     VARCHAR2(32) NOT NULL,
  tracking_no VARCHAR2(64),
  status      VARCHAR2(16) NOT NULL,
  shipped_at  TIMESTAMP,
  CONSTRAINT fk_shipments_order FOREIGN KEY (order_id)
    REFERENCES koduchi.orders (order_id) ON DELETE CASCADE,
  CONSTRAINT ck_shipments_status
    CHECK (status IN ('pending', 'shipped', 'delivered')),
  CONSTRAINT uq_shipments_tracking UNIQUE (carrier, tracking_no)
);

-- 複合の外部キーを持つ表。参照先の列が 2 つ並ぶことを確かめられる。
CREATE TABLE koduchi.shipment_legs (
  shipment_id NUMBER(12)   NOT NULL,
  leg_no      NUMBER(4)    NOT NULL,
  carrier     VARCHAR2(32) NOT NULL,
  zone        VARCHAR2(8)  NOT NULL,
  CONSTRAINT pk_shipment_legs PRIMARY KEY (shipment_id, leg_no),
  CONSTRAINT fk_shipment_legs_shipment FOREIGN KEY (shipment_id)
    REFERENCES koduchi.shipments (shipment_id) ON DELETE CASCADE,
  CONSTRAINT fk_shipment_legs_rate FOREIGN KEY (carrier, zone)
    REFERENCES koduchi.carrier_rates (carrier, zone)
);

-- 複合の索引。列が `COLUMN_POSITION` の順に並ぶことを確かめられる。
CREATE INDEX koduchi.ix_shipments_order_status
  ON koduchi.shipments (order_id, status);

INSERT INTO koduchi.carrier_rates (carrier, zone, rate)
SELECT 'yamato', 'east', 800 FROM dual
UNION ALL SELECT 'yamato', 'west', 950 FROM dual
UNION ALL SELECT 'sagawa', 'east', 780 FROM dual;

INSERT INTO koduchi.shipments (shipment_id, order_id, carrier, tracking_no, status, shipped_at)
SELECT
  o.order_id,
  o.order_id,
  CASE MOD(o.order_id, 2) WHEN 0 THEN 'yamato' ELSE 'sagawa' END,
  'TRK-' || LPAD(o.order_id, 8, '0'),
  CASE MOD(o.order_id, 3)
    WHEN 0 THEN 'pending'
    WHEN 1 THEN 'shipped'
    ELSE 'delivered'
  END,
  o.created_at + NUMTODSINTERVAL(1, 'DAY')
FROM koduchi.orders o
WHERE o.status = 'paid' AND ROWNUM <= 500;

INSERT INTO koduchi.shipment_legs (shipment_id, leg_no, carrier, zone)
SELECT s.shipment_id, 1, s.carrier, 'east'
FROM koduchi.shipments s;

COMMIT;

BEGIN
  DBMS_STATS.GATHER_SCHEMA_STATS('KODUCHI');
END;
/

EXIT
