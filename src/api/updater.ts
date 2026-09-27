/**
 * 自動アップデートの窓口（ADR 0042）。
 *
 * `src/api/clipboard.ts` と同じ考え方で、`@tauri-apps/plugin-updater` と再起動の
 * コマンドをこの層に閉じ込める。更新の確認はネットワークへ出るうえ、入れ替えは
 * 動いているアプリそのものを書き換えるため、テストでは窓口ごと差し替える。
 *
 * Rust 側では `tauri_plugin_updater` を登録し、`capabilities/default.json` に
 * `updater:default` を足してある。確認先と公開鍵は `tauri.conf.json` の
 * `plugins.updater` にある。
 */

import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import type { DownloadEvent } from '@tauri-apps/plugin-updater'
import { check } from '@tauri-apps/plugin-updater'

/** リリースの置き場所。版ごとのリリースノートの URL を組み立てる。 */
const RELEASES_URL = 'https://github.com/taiga533/koduchi/releases'

/** ダウンロードの進み具合。 */
export interface DownloadProgress {
  /** 受け取ったバイト数。 */
  downloaded: number
  /** 全体のバイト数。サーバが告げなければ `null`。 */
  total: number | null
}

/** 見つかった新しい版。 */
export interface AvailableUpdate {
  /** 新しい版。 */
  version: string
  /** 今動いている版。 */
  currentVersion: string
  /**
   * 新しい版を取ってきて入れ替える。入れ替えただけでは今の版が動き続ける。
   *
   * @param onProgress 進み具合を受け取る
   */
  downloadAndInstall(onProgress: (progress: DownloadProgress) => void): Promise<void>
}

/** 自動アップデートの窓口。 */
export interface UpdaterApi {
  /** 新しい版を確かめる。無ければ `null`。 */
  check(): Promise<AvailableUpdate | null>
  /**
   * 新しい版で起ち上げ直す。
   *
   * その場では再起動しない。各ウィンドウが未コミットの関所（ADR 0012）を通って
   * 閉じ終えたときに Rust 側が起ち上げ直す。
   */
  restart(): Promise<void>
  /** 再起動の予約を取り消す。ウィンドウが閉じるのを断ったときに呼ぶ。 */
  cancelRestart(): Promise<void>
  /** 版のリリースノートをブラウザで開く。 */
  openReleaseNotes(version: string): Promise<void>
}

/**
 * プラグインの知らせ 1 つを受けて、進み具合を進める。
 *
 * プラグインは「始まり（全体の大きさ）」「かたまり 1 つぶん」「終わり」を別々に
 * 知らせるため、画面が要る「いくつ中いくつ」はこちらで足し上げる。
 *
 * @param progress ここまでの進み具合
 * @param event プラグインからの知らせ
 *
 * @returns 次の進み具合
 */
export function nextProgress(progress: DownloadProgress, event: DownloadEvent): DownloadProgress {
  switch (event.event) {
    case 'Started':
      return { downloaded: 0, total: event.data.contentLength ?? null }
    case 'Progress':
      return { ...progress, downloaded: progress.downloaded + event.data.chunkLength }
    case 'Finished':
      return progress
  }
}

/**
 * プラグインの `Update` を窓口の形へ包む。
 *
 * @param update プラグインが返した新しい版
 */
function wrap(update: NonNullable<Awaited<ReturnType<typeof check>>>): AvailableUpdate {
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    downloadAndInstall: async (onProgress) => {
      let progress: DownloadProgress = { downloaded: 0, total: null }
      await update.downloadAndInstall((event) => {
        progress = nextProgress(progress, event)
        onProgress(progress)
      })
    },
  }
}

/** Tauri のプラグインとコマンドを呼ぶ実装。 */
const tauriUpdaterApi: UpdaterApi = {
  check: async () => {
    const update = await check()
    return update === null ? null : wrap(update)
  },
  restart: () => invoke('restart_for_update'),
  cancelRestart: () => invoke('cancel_update_restart'),
  openReleaseNotes: (version) => openUrl(`${RELEASES_URL}/tag/v${version}`),
}

let current: UpdaterApi = tauriUpdaterApi

/** 現在使われている窓口を返す。 */
export function getUpdaterApi(): UpdaterApi {
  return current
}

/**
 * 窓口を差し替える。テストからのみ使う。
 *
 * @param api 差し替える実装
 */
export function setUpdaterApi(api: UpdaterApi): void {
  current = api
}

/** 窓口を Tauri の実装へ戻す。テストの後片付けに使う。 */
export function resetUpdaterApi(): void {
  current = tauriUpdaterApi
}
