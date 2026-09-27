/**
 * アップデートの取得の進み具合の表し方（ADR 0042）。
 *
 * サーバが全体の大きさを告げないこともあるため、割合を出せないときは受け取った量
 * だけを出す。「0%」のまま止まって見えると、固まったのか進んでいるのか分からない。
 */

import type { DownloadProgress } from '../../api/updater'

/** 1 MB のバイト数。 */
const MEGABYTE = 1024 * 1024

/**
 * バイト数を MB で表す。
 *
 * 配布物は十数 MB であり、KB では桁が多く GB では 0 が並ぶ。
 *
 * @param bytes バイト数
 */
function megabytes(bytes: number): string {
  return `${(bytes / MEGABYTE).toFixed(1)} MB`
}

/**
 * 進み具合を割合で返す。全体の大きさが分からなければ `null`。
 *
 * @param progress 進み具合
 *
 * @returns 0 から 1 の割合
 */
export function progressRatio(progress: DownloadProgress): number | null {
  if (progress.total === null || progress.total <= 0) {
    return null
  }
  return Math.min(progress.downloaded / progress.total, 1)
}

/**
 * 進み具合を文字にする。
 *
 * @param progress 進み具合
 *
 * @returns `3.2 MB / 15.1 MB` か、全体が分からなければ `3.2 MB`
 */
export function formatProgress(progress: DownloadProgress): string {
  if (progressRatio(progress) === null || progress.total === null) {
    return megabytes(progress.downloaded)
  }
  return `${megabytes(progress.downloaded)} / ${megabytes(progress.total)}`
}
