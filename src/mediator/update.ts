/**
 * 自動アップデートの裁定（ADR 0042）。
 *
 * 確認・取得・再起動の段階は `update` ストアが持つ。ここが持つのは、アップデートと
 * 他の持ち場が交わるところだけである。
 *
 * - 起動時の確認をどのウィンドウで走らせるか。
 * - ウィンドウを閉じる関所（ADR 0012）で断られたとき、再起動の予約を取り消すこと。
 */

import { getUpdaterApi } from '../api/updater'
import { useUpdateStore } from '../stores/update'
import { CLOSE_WORDING } from '../transaction/pendingChanges'
import { resolvePendingTransaction } from './transaction'

/** 起動時の確認を走らせるウィンドウのラベル（`tauri.conf.json` の最初のウィンドウ）。 */
const LAUNCH_WINDOW_LABEL = 'main'

/**
 * 起動時の確認を走らせるか。
 *
 * 最初のウィンドウだけで走らせる。接続ごとにウィンドウを開く（ADR 0009）たびに
 * 問い合わせると、同じ版を何度も勧めることになる。開発中（`tauri dev`）は走らせない。
 * 動いているのは `.app` ではなく、入れ替える先が無いためである。
 *
 * @param windowLabel 今のウィンドウのラベル
 * @param isDev 開発中か
 */
export function shouldCheckOnLaunch(windowLabel: string, isDev: boolean): boolean {
  return windowLabel === LAUNCH_WINDOW_LABEL && !isDev
}

/**
 * 起動時に新しい版を確かめる。最新だったときと失敗したときは黙っている。
 *
 * @param windowLabel 今のウィンドウのラベル
 * @param isDev 開発中か
 */
export function checkForUpdateOnLaunch(windowLabel: string, isDev: boolean): void {
  if (shouldCheckOnLaunch(windowLabel, isDev)) {
    void useUpdateStore.getState().check('launch')
  }
}

/**
 * ウィンドウを閉じてよいかを決める（ADR 0012・0042）。
 *
 * 未コミットの関所をそのまま通し、断られたら再起動の予約を取り消す。アップデートの
 * 再起動はアプリの終了と同じく全ウィンドウへ閉じる要求を送るため、どのウィンドウで
 * 断られても予約を残してはならない（残すと、後で普通に終了したときに思いがけず
 * 起ち上がり直す）。再起動していないときに取り消しても何も起きない。
 *
 * 取り消しの往復は待たない。待っている間に失敗すると関所の答えが返らず、閉じるのを
 * 断ったはずのウィンドウが閉じてしまう。失敗は握らず、未処理の拒否として大域へ上げる。
 *
 * @returns 閉じてよいか
 */
export async function confirmWindowClose(): Promise<boolean> {
  const proceed = await resolvePendingTransaction(CLOSE_WORDING)
  if (!proceed) {
    void getUpdaterApi().cancelRestart()
    useUpdateStore.getState().restartDeclined()
  }
  return proceed
}
