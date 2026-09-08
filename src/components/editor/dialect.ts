/**
 * エディタが使う SQL の方言（ADR 0013）。
 *
 * `@codemirror/lang-sql` の `PLSQL` をそのまま使わず、`doubleQuotedStrings` だけを
 * 落としてある。Oracle で `"..."` は常に**引用符付きの識別子**であり、文字列は
 * `'...'` だからである。`PLSQL` の既定では `"MyTable"` が文字列として色付けされ、
 * 構文木にも `String` として載るため、`"MyTable".` と書いても列の補完が働かない。
 *
 * 方言を定義し直すと `LRLanguage` も新しくなる。補完ソースを言語データへ足すときは
 * **この方言の `language`** に足すこと。`PLSQL.language` へ足しても繋がらない。
 */

import { PLSQL, SQLDialect } from '@codemirror/lang-sql'

/** Oracle 向けの方言。`PLSQL` から二重引用符の扱いだけを変えてある。 */
export const koduchiOracleDialect = SQLDialect.define({
  ...PLSQL.spec,
  doubleQuotedStrings: false,
})
