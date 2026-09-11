-- 表と列のコメントの見本（ADR 0033）。
--
-- 001〜007 の表にはコメントが 1 つも付いておらず、定義タブのコメント欄の
-- 見え方を統合テストで確かめられない。日本語の業務システムでは物理名が
-- `T_JUCHU_MEISAI` で論理名がコメントに入っていることが珍しくなく、
-- 「コメントが見えないと、その表が何なのかが分からない」というのが
-- ADR 0033 の出発点である。
--
-- 次の 4 つを揃える。
--
--   * 表そのもののコメント（パネルの見出しに出る）
--   * 列のコメント（列の内訳の 5 つめの欄に出る）
--   * **コメントの付いていない列**（外部結合で落ちないことを確かめる）
--   * コメントを 1 つも持たない表（欄そのものが出ないことを確かめる）
--   * ビューのコメント（`ALL_TAB_COMMENTS` はビューも載せる）
--
-- 006 と同じく、既にボリュームを持っている開発者はこのスクリプトを手で流す。

WHENEVER SQLERROR EXIT SQL.SQLCODE
SET DEFINE OFF
SET ECHO ON

ALTER SESSION SET CONTAINER = FREEPDB1;

-- 表そのもののコメント。
COMMENT ON TABLE koduchi.shipments IS '出荷。受注 1 件に対して 1 行が立つ';

-- 列のコメント。**`TRACKING_NO` にはあえて付けない。**外部結合が内部結合に
-- なっていれば、この列が一覧から消える。
COMMENT ON COLUMN koduchi.shipments.shipment_id IS '出荷番号';
COMMENT ON COLUMN koduchi.shipments.order_id IS '受注番号。KODUCHI.ORDERS を指す';
COMMENT ON COLUMN koduchi.shipments.carrier IS '配送業者コード';
COMMENT ON COLUMN koduchi.shipments.status IS '出荷状態。pending / shipped / delivered';
COMMENT ON COLUMN koduchi.shipments.shipped_at IS '出荷日時。未出荷なら NULL';

-- ビューにもコメントは付く。
COMMENT ON TABLE koduchi.session_rollup IS 'セッションの集計ビュー';

-- `koduchi.shipment_legs` と `koduchi.carrier_rates` にはコメントを付けない。
-- コメントを 1 つも持たない表では、列の内訳にコメントの欄そのものが出ない
-- （ADR 0033）。その状態を手元でも試せるようにしておく。

EXIT
