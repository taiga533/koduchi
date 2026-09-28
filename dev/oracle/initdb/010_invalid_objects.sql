-- 無効なオブジェクトの見本（ADR 0045）。
--
-- スキーマツリーの `INVALID` の印を統合テストで確かめるために、わざと
-- コンパイルエラーを残したオブジェクトを 2 つ置く。
--   * KODUCHI_ADR45_INVALID_PROC: 手続きそのものが無効。
--   * KODUCHI_ADR45_INVALID_PKG: 仕様は有効で、本体だけが無効。ツリーは本体を
--     出さないため、仕様の行に印が立つことを確かめる。
--
-- コンパイルエラーは SQL*Plus では警告であり `WHENEVER SQLERROR` に掛からない。
-- 作られたうえで無効のまま残る。

WHENEVER SQLERROR EXIT SQL.SQLCODE
SET DEFINE OFF
SET ECHO ON

ALTER SESSION SET CONTAINER = FREEPDB1;

CREATE OR REPLACE PROCEDURE koduchi.koduchi_adr45_invalid_proc IS
BEGIN
  koduchi_adr45_no_such_thing;
END;
/

CREATE OR REPLACE PACKAGE koduchi.koduchi_adr45_invalid_pkg IS
  PROCEDURE run;
END;
/

CREATE OR REPLACE PACKAGE BODY koduchi.koduchi_adr45_invalid_pkg IS
  PROCEDURE run IS
  BEGIN
    koduchi_adr45_no_such_thing;
  END run;
END;
/

EXIT
