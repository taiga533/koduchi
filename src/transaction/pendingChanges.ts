/**
 * 未コミットのまま閉じさせないための確認（ADR 0012）。
 *
 * 手動コミットの接続では、`INSERT` などの変更は明示的にコミットするまで確定
 * しない。そのまま切断すればデータベース側で暗黙にロールバックされ、「3 行に
 * 影響しました」と表示されたはずの変更が黙って消える。閉じる前に必ず一度尋ねる。
 *
 * `@tauri-apps/plugin-dialog` の確認は「はい / いいえ」の 2 択しか出せないため、
 * 「コミット / 破棄 / やめる」の 3 択は 2 段に分けて尋ねる。1 段目で閉じるかを
 * 決め、2 段目で変更をどうするかを決める。
 */

/** 未コミットの変更をどう扱うか。 */
export type PendingChoice =
  /** コミットしてから閉じる。 */
  | 'commit'
  /** 破棄して閉じる。 */
  | 'discard'
  /** 閉じるのをやめる。 */
  | 'cancel'

/** 3 択を組み立てるための 2 つの確認。 */
export interface PendingDialogs {
  /** 閉じてよいかを尋ねる。真なら進む、偽なら「やめる」。 */
  confirmClose: () => Promise<boolean>
  /** 変更をコミットするかを尋ねる。真なら「コミット」、偽なら「破棄」。 */
  confirmCommit: () => Promise<boolean>
}

/**
 * 未コミットの変更をどう扱うかを利用者に尋ねる。
 *
 * 「やめる」を選んだ時点で 2 段目は尋ねない。閉じない以上、変更をどうするかを
 * 決める必要が無いためである。
 *
 * @param dialogs 2 段の確認
 */
export async function askPendingChoice(dialogs: PendingDialogs): Promise<PendingChoice> {
  if (!(await dialogs.confirmClose())) {
    return 'cancel'
  }

  return (await dialogs.confirmCommit()) ? 'commit' : 'discard'
}
