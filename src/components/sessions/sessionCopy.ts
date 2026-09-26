/**
 * セッションの一覧の行をクリップボードへ載せる文字列の組み立て（ADR 0038）。
 *
 * kill を DBA に頼むときは `SID,SERIAL#` を伝えることになり、画面から手で
 * 書き写すと取り違える。行の右クリックから写せるようにした。**kill そのものは
 * メニューに置かない**（取り返しの付かない操作は行のボタンと確認の先にだけ
 * ある。ADR 0017）。
 *
 * 1 行のコピーは画面の欄の並びのタブ区切りで、**見出しは付けない**
 * （定義タブの 1 行のコピーと同じ考え）。「この接続」「小槌」の札は小槌の中の
 * 事情であって、貼り先では意味を持たないため写さない。
 */

import type { SessionRow } from '../../types/db'

/** 空の欄。画面の表と同じ字を使う。 */
const 空欄 = '—'

/**
 * `SID,SERIAL#`。`ALTER SYSTEM KILL SESSION` がそのまま受け取る綴りである。
 *
 * @param session 対象のセッション
 */
export function sessionIdentity(session: SessionRow): string {
  return `${session.sid},${session.serial}`
}

/**
 * 待たせている相手の表示。無ければ `null`。
 *
 * 別インスタンスの相手は一覧に並ばないため、その旨を添える（ADR 0017）。
 * 画面とコピーで同じ文言にするため、ここに 1 つだけ置く。
 *
 * @param session 対象のセッション
 * @param instance 今の接続のインスタンス番号
 */
export function blockedByLabel(session: SessionRow, instance: number): string | null {
  if (session.blockingSession === null) {
    return null
  }
  const 別インスタンス = session.blockingInstance !== null && session.blockingInstance !== instance
  return `SID ${session.blockingSession}${
    別インスタンス ? `（インスタンス ${session.blockingInstance}）` : ''
  }`
}

/**
 * 行 1 つを、画面の欄の並びのタブ区切りにする。
 *
 * @param session 対象のセッション
 * @param instance 今の接続のインスタンス番号
 */
export function buildSessionRowCopyText(session: SessionRow, instance: number): string {
  return [
    sessionIdentity(session),
    session.username ?? 空欄,
    session.status,
    session.event ?? 空欄,
    `${session.secondsInWait} 秒`,
    session.program ?? 空欄,
    blockedByLabel(session, instance) ?? 空欄,
  ].join('\t')
}
