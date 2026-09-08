-- ソース検索の見本（ADR 0021）。
--
-- `ALL_SOURCE` に本文が載る 7 種別のうち、開発用データベースに無かったものを
-- 足す。002 に関数（ORDER_TOTAL）と手続（SAY_HELLO）が、005 にパッケージ
-- （ORDER_STATS の仕様と本体）とトリガー（TRG_USER_TRAITS_TOUCH）が既にある。
-- ここで足すのは型の本体（TYPE BODY）と、探し先として使うパッケージである。
--
-- 006 はテーブル定義ビューの見本（ADR 0019）であり、こちらは 007 に置く。
--
-- 統合テストが当てにする決まりごとは 2 つある。
--   * `KODUCHI_SOURCE_MARK` という綴りを、パッケージ本体だけに置く。
--     仕様には置かない。**本体だけが当たること**を確かめるためである
--     （スキーマツリーは本体を出さないが、ソース検索は出す）。
--   * `user_traits` という綴りを、本体の中に小文字で書く。既定で大文字と
--     小文字を区別しないことを確かめるためである。

WHENEVER SQLERROR EXIT SQL.SQLCODE
SET DEFINE OFF
SET ECHO ON

ALTER SESSION SET CONTAINER = FREEPDB1;

-- 型の本体。005 の ORDER_SUMMARY はメソッドを持たないため本体を作れない。
-- 本体を持つ型をここで別に立てる。
CREATE OR REPLACE TYPE koduchi.order_label AS OBJECT (
  order_id NUMBER(12),
  MEMBER FUNCTION label RETURN VARCHAR2
);
/

CREATE OR REPLACE TYPE BODY koduchi.order_label AS
  MEMBER FUNCTION label RETURN VARCHAR2 IS
  BEGIN
    RETURN '注文 #' || TO_CHAR(order_id);
  END label;
END;
/

-- ソース検索の探し先になるパッケージ。仕様には目印を置かない。
CREATE OR REPLACE PACKAGE koduchi.order_audit AS
  -- この行に目印は無い。仕様と本体を見分けるためである。
  PROCEDURE touch_segment(p_user_id IN NUMBER, p_segment IN VARCHAR2);
  FUNCTION refunded_count RETURN NUMBER;
END order_audit;
/

CREATE OR REPLACE PACKAGE BODY koduchi.order_audit AS
  -- KODUCHI_SOURCE_MARK: ソース検索の統合テストが当てにする目印。
  PROCEDURE touch_segment(p_user_id IN NUMBER, p_segment IN VARCHAR2) IS
  BEGIN
    -- 小文字で書く。既定で大文字と小文字を区別しないことの確認に使う。
    UPDATE koduchi.user_traits
       SET segment = p_segment
     WHERE user_id = p_user_id;
  END touch_segment;

  FUNCTION refunded_count RETURN NUMBER IS
    v_count NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v_count FROM koduchi.orders WHERE status = 'refunded';
    RETURN v_count;
  END refunded_count;
END order_audit;
/

EXIT
