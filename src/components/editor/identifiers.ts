/**
 * 補完の候補に載せる識別子の綴りを決める（ADR 0013）。
 *
 * Oracle は引用符を付けない識別子を大文字へ畳んでから解釈する。そのため
 * `select * from orders` と書いても `ORDERS` に解決される。カタログが持つ名前が
 * すべて大文字であれば、どの綴りで挿入しても同じ表を指す。
 *
 * 逆に `"MyTable"` のように引用符付きで作られた名前は、引用符を外すと別の名前に
 * なってしまう。この 2 つを見分け、**無引用で書いても同じ名前へ解決できるときだけ**
 * 指定された綴りへ変える。それ以外はカタログの綴りのまま引用符で囲む。
 */

import type { IdentifierCase } from '../../types/db'

/**
 * 引用符なしで書ける Oracle の識別子。
 *
 * 英字で始まり、以降は英数字と `_` `$` `#` のみ。すべて大文字であることを
 * 求めているのは、小文字を含む名前は引用符付きで作られたものであり、無引用で
 * 書くと別の名前へ解決されるためである。
 */
const UNQUOTED = /^[A-Z][A-Z0-9_$#]*$/

/**
 * 引用符なしでは識別子として使えない Oracle の予約語。
 *
 * 予約語は `UNQUOTED` に通ってしまうが、無引用で書くと構文エラーになる。
 * `"SELECT"` のように引用符付きで作られた表が実在しうるため、ここで弾く。
 */
const RESERVED = new Set(
  (
    'ACCESS ADD ALL ALTER AND ANY AS ASC AUDIT BETWEEN BY CHAR CHECK CLUSTER COLUMN COLUMN_VALUE ' +
    'COMMENT COMPRESS CONNECT CREATE CURRENT DATE DECIMAL DEFAULT DELETE DESC DISTINCT DROP ELSE ' +
    'EXCLUSIVE EXISTS FILE FLOAT FOR FROM GRANT GROUP HAVING IDENTIFIED IMMEDIATE IN INCREMENT ' +
    'INDEX INITIAL INSERT INTEGER INTERSECT INTO IS LEVEL LIKE LOCK LONG MAXEXTENTS MINUS MLSLABEL ' +
    'MODE MODIFY NESTED_TABLE_ID NOAUDIT NOCOMPRESS NOT NOWAIT NULL NUMBER OF OFFLINE ON ONLINE ' +
    'OPTION OR ORDER PCTFREE PRIOR PUBLIC RAW RENAME RESOURCE REVOKE ROW ROWID ROWNUM ROWS SELECT ' +
    'SESSION SET SHARE SIZE SMALLINT START SUCCESSFUL SYNONYM SYSDATE TABLE THEN TO TRIGGER UID ' +
    'UNION UNIQUE UPDATE USER VALIDATE VALUES VARCHAR VARCHAR2 VIEW WHENEVER WHERE WITH'
  ).split(' '),
)

/** 補完の候補 1 件ぶんの綴り。 */
export interface StyledIdentifier {
  /**
   * 候補一覧に出す文字列。
   *
   * 引用符は含めない。利用者は引用符を打たずに絞り込むためである。
   */
  label: string
  /** 実際に挿入する文字列。`label` をそのまま入れてよいときは `undefined`。 */
  apply?: string
}

/**
 * カタログの名前を引用符なしで書けるかどうかを判定する。
 *
 * @param name カタログが持っている綴りの名前
 */
export function isUnquotedSafe(name: string): boolean {
  return UNQUOTED.test(name) && !RESERVED.has(name)
}

/**
 * カタログの名前から、補完の候補に載せる綴りを作る。
 *
 * 引用符なしで書ける名前は指定された綴りへ変える。Oracle が大文字へ畳むため、
 * どの綴りで書いても同じ名前に解決される。書けない名前はカタログの綴りのまま
 * 引用符で囲む。小文字化して壊すよりも、囲って正しく動くほうを取る。
 *
 * @param name カタログが持っている綴りの名前
 * @param style 挿入したい綴り
 */
export function styleIdentifier(name: string, style: IdentifierCase): StyledIdentifier {
  if (!isUnquotedSafe(name)) {
    return { label: name, apply: `"${name}"` }
  }

  switch (style) {
    case 'lower':
      return { label: name.toLowerCase() }
    case 'upper':
      return { label: name.toUpperCase() }
    case 'preserve':
      return { label: name }
  }
}
