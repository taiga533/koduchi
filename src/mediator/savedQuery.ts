/**
 * 保存済みクエリの裁定（ADR 0018・0035・0041）。
 *
 * SQL を受け取り、名前を尋ね、接続名を添えて保存済みへ積む。SQL の出どころは
 * エディタ（`⌃⌘S`）と履歴の行（右クリック）の 2 つで、名前を尋ねるところと
 * 積むところは共有する（`askQueryName` と `savedQuery` ストアの `save`）。
 * 入口ごとに違うのは「どの SQL を」「どの接続名で」の 2 点だけである。
 */

import { tabBaseName } from '../components/editor/tabNaming'
import { useConnectionStore } from '../stores/connection'
import { useSavedQueryStore } from '../stores/savedQuery'
import { selectActiveSqlTab, useTabStore } from '../stores/tab'
import type { HistoryEntry } from '../types/db'
import type { Ask } from './ask'
import type { EditorCursor } from './execution'

/** 履歴から作る名前の既定値の長さの上限。ダイアログの名前欄に収まる長さに留める。 */
const DEFAULT_NAME_MAX = 40

/**
 * 履歴の SQL から名前の既定値を作る（ADR 0041）。
 *
 * 履歴にはタブの名前のような手掛かりが無い。一覧が 1 行目を見出しにしている
 * （`HistoryList.tsx`）ので、名前もそれに揃えれば一覧で見た行と結び付く。
 * 空にしないのは、空の既定値では `⏎` 1 つで保存できなくなるためである。
 */
export function nameFromSql(sql: string): string {
  const firstLine = sql
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .find((line) => line !== '')
  if (firstLine === undefined) {
    return ''
  }
  return firstLine.length > DEFAULT_NAME_MAX
    ? `${firstLine.slice(0, DEFAULT_NAME_MAX)}…`
    : firstLine
}

/**
 * 同じ SQL が既に保存されていれば知らせたうえで、名前を尋ねる（ADR 0041）。
 *
 * 重複は弾かない。同じ SQL を別の名前で持ちたい場合があり、名前は目印であって
 * 鍵ではない（ADR 0018）。ただ、履歴は同じ SQL を何度も並べるため、黙って
 * 積むと気付かないうちに同じものが増える。そこで尋ねる前に探し、ダイアログで告げる。
 *
 * @returns 決まった名前。取り消されたら `null`
 */
async function askQueryName(sql: string, defaultName: string, ask: Ask): Promise<string | null> {
  const existing = await useSavedQueryStore.getState().findBySql(sql)
  return ask({ kind: 'saveQuery', defaultName, sql, existingName: existing?.name ?? null })
}

/**
 * `⌃⌘S`。今のタブの内容を保存済みクエリにする（ADR 0018）。
 *
 * 選択範囲があればその中だけを保存する。名前の既定値はタブの名前から
 * `.sql` を落としたものである。空白だけの SQL は保存しない。
 *
 * @param cursor 押された時点のカーソル
 * @param ask 利用者への尋ね方
 */
export async function saveQueryFromEditor(cursor: EditorCursor, ask: Ask): Promise<void> {
  const tab = selectActiveSqlTab(useTabStore.getState())
  if (!tab) {
    return
  }
  const sql = cursor.selectedText ?? tab.content
  if (sql.trim() === '') {
    return
  }

  const name = await askQueryName(sql, tabBaseName(tab), ask)
  // 接続は名前が決まった時点のものを添える。尋ねている間に切断されていれば積まない。
  const active = useConnectionStore.getState().connection
  if (name === null || !active) {
    return
  }
  await useSavedQueryStore.getState().save(name, sql, active.name)
}

/**
 * 履歴の 1 件を保存済みクエリにする（ADR 0041）。
 *
 * 添える接続名は今の接続ではなく**履歴の行のもの**である。その SQL が実際に
 * 流れた先であり、全接続の履歴を見ているときに今の接続名を付けると、保存済みの
 * 「この接続のみ」で違う接続の SQL が混ざる。今の接続に依らないため、尋ねている
 * 間に切断されても積んでよい。
 *
 * @returns 積めたときはその名前。取り消し・失敗なら `null`（一言を出すかの判断に使う）
 */
export async function saveQueryFromHistory(entry: HistoryEntry, ask: Ask): Promise<string | null> {
  if (entry.sql.trim() === '') {
    return null
  }
  const name = await askQueryName(entry.sql, nameFromSql(entry.sql), ask)
  if (name === null) {
    return null
  }
  const saved = await useSavedQueryStore.getState().save(name, entry.sql, entry.connectionName)
  return saved ? name : null
}
