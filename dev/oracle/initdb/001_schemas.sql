-- 開発用スキーマの作成（ADR 0010）。
--
-- このスクリプトは SYS として CDB ルート（FREE）に接続した状態で実行される。
-- 最初に PDB へ切り替える必要がある。
--
-- 3 つのスキーマを作るのは、スキーマツリーのフィルタ（ADR 0007）を実際に
-- 試せるようにするためである。
--   KODUCHI           … 主なテーブルを置く。APP_USER として既に作成済み
--   KODUCHI_ANALYTICS … 別スキーマの参照を試すためのもの
--   KODUCHI_EMPTY     … 「参照可能なオブジェクトが無いスキーマを隠す」の確認用

WHENEVER SQLERROR EXIT SQL.SQLCODE
SET DEFINE OFF
SET ECHO ON

ALTER SESSION SET CONTAINER = FREEPDB1;

CREATE USER koduchi_analytics IDENTIFIED BY koduchi_dev;
GRANT CONNECT, RESOURCE TO koduchi_analytics;
ALTER USER koduchi_analytics QUOTA UNLIMITED ON USERS;

CREATE USER koduchi_empty IDENTIFIED BY koduchi_dev;
GRANT CONNECT TO koduchi_empty;

-- 接続ユーザーが自分のスキーマ以外も覗けることを確認するための権限。
-- ALL_* ビューは権限のあるオブジェクトしか返さないため、これが無いと
-- KODUCHI_ANALYTICS のテーブルがスキーマツリーに現れない。
GRANT SELECT ANY TABLE TO koduchi;

-- 実行計画（DBMS_XPLAN）とセッション統計の参照に必要な権限。
GRANT SELECT_CATALOG_ROLE TO koduchi;

EXIT
