/**
 * 未コミットのまま接続を手放させないための確認（ADR 0012）。
 *
 * 手動コミットの接続では、`INSERT` などの変更は明示的にコミットするまで確定
 * しない。そのまま切断すればデータベース側で暗黙にロールバックされ、「3 行に
 * 影響しました」と表示されたはずの変更が黙って消える。接続を手放す操作 —
 * ウィンドウを閉じる・アプリを終了する・切断する — の前に必ず一度尋ねる。
 *
 * `@tauri-apps/plugin-dialog` の確認は「はい / いいえ」の 2 択しか出せないため、
 * 「コミット / 破棄 / やめる」の 3 択は 2 段に分けて尋ねる。1 段目で進むかを
 * 決め、2 段目で変更をどうするかを決める。
 *
 * 確認そのものは差し替えられる形にしてある（`setPendingDialogs`）。ネイティブの
 * ダイアログは jsdom では開けないため、テストはこの境界を差し替えて確かめる
 * （ADR 0010 の「`src/api/` 層の差し替え」と同じ考え方）。
 */

import { confirm } from '@tauri-apps/plugin-dialog'

/** 未コミットの変更をどう扱うか。 */
export type PendingChoice =
  /** コミットしてから進む。 */
  | 'commit'
  /** 破棄して進む。 */
  | 'discard'
  /** 進むのをやめる。 */
  | 'cancel'

/**
 * 操作ごとに変わる文言。
 *
 * 問いかけと肯定側のラベルだけが「閉じる」と「切断」で変わる。
 */
export interface PendingWording {
  question: string
  okLabel: string
}

/** ウィンドウを閉じる / アプリを終了するときの文言。 */
export const CLOSE_WORDING: PendingWording = {
  question: '未コミットの変更があります。このまま閉じますか？',
  okLabel: '閉じる',
}

/** 切断・接続の切り替えのときの文言。 */
export const DISCONNECT_WORDING: PendingWording = {
  question: '未コミットの変更があります。このまま切断しますか？',
  okLabel: '切断',
}

/** 3 択を組み立てるための 2 つの確認。 */
export interface PendingDialogs {
  /** 進んでよいかを尋ねる。真なら進む、偽なら「やめる」。 */
  confirmProceed: () => Promise<boolean>
  /** 変更をコミットするかを尋ねる。真なら「コミット」、偽なら「破棄」。 */
  confirmCommit: () => Promise<boolean>
}

/** 文言から確認を組み立てる。 */
export type PendingDialogsFactory = (wording: PendingWording) => PendingDialogs

/** Tauri の確認ダイアログを使う実装。 */
const tauriPendingDialogs: PendingDialogsFactory = (wording) => ({
  confirmProceed: () =>
    confirm(wording.question, {
      title: '未コミットの変更',
      kind: 'warning',
      okLabel: wording.okLabel,
      cancelLabel: 'やめる',
    }),
  confirmCommit: () =>
    confirm('変更をコミットしますか？破棄すると失われます。', {
      title: '未コミットの変更',
      kind: 'warning',
      okLabel: 'コミット',
      cancelLabel: '破棄',
    }),
})

let current: PendingDialogsFactory = tauriPendingDialogs

/**
 * 未コミットの変更をどう扱うかを利用者に尋ねる。
 *
 * 「やめる」を選んだ時点で 2 段目は尋ねない。進まない以上、変更をどうするかを
 * 決める必要が無いためである。
 *
 * @param wording 操作ごとの問いかけと肯定側のラベル
 */
export async function askPendingChoice(wording: PendingWording): Promise<PendingChoice> {
  const dialogs = current(wording)

  if (!(await dialogs.confirmProceed())) {
    return 'cancel'
  }

  return (await dialogs.confirmCommit()) ? 'commit' : 'discard'
}

/**
 * 確認を差し替える。テストからのみ使う。
 *
 * @param factory 差し替える実装
 */
export function setPendingDialogs(factory: PendingDialogsFactory): void {
  current = factory
}

/** 確認を Tauri の実装へ戻す。テストの後片付けに使う。 */
export function resetPendingDialogs(): void {
  current = tauriPendingDialogs
}
