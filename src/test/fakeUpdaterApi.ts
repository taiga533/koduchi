/**
 * テスト用の自動アップデートの窓口（ADR 0042）。
 *
 * 確認・取得・再起動の応答をテストが手で返せるようにし、呼ばれた順を記録する。
 * 待ちの最中に別の操作が割り込む順序を再現するためである。
 */

import type { AvailableUpdate, DownloadProgress, UpdaterApi } from '../api/updater'

/** 手で解ける約束。 */
export interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

/** 手で解ける約束を作る。 */
export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** 手で返す窓口と、呼ばれた記録。 */
export interface FakeUpdaterApi {
  api: UpdaterApi
  /** `check` の呼び出しごとの約束。呼ばれた順に積まれる。 */
  checks: Deferred<AvailableUpdate | null>[]
  /** `downloadAndInstall` の呼び出しごとの約束と、進み具合を送る口。 */
  downloads: { deferred: Deferred<void>; report: (progress: DownloadProgress) => void }[]
  /** 呼ばれた操作の名前。 */
  calls: string[]
  /** 次の `restart` を失敗させる。 */
  failRestartWith: (error: unknown) => void
}

/**
 * 新しい版を 1 つ作る。取得は `downloads` に積まれ、テストが解くまで終わらない。
 *
 * @param fake 積み先
 * @param version 新しい版
 */
export function availableUpdate(fake: FakeUpdaterApi, version = '0.3.0'): AvailableUpdate {
  return {
    version,
    currentVersion: '0.2.0',
    downloadAndInstall: (onProgress) => {
      const entry = { deferred: deferred<void>(), report: onProgress }
      fake.downloads.push(entry)
      fake.calls.push('downloadAndInstall')
      return entry.deferred.promise
    },
  }
}

/** 手で返す窓口を作る。 */
export function createFakeUpdaterApi(): FakeUpdaterApi {
  let restartError: unknown = null
  const fake: FakeUpdaterApi = {
    checks: [],
    downloads: [],
    calls: [],
    failRestartWith: (error) => {
      restartError = error
    },
    api: {
      check: () => {
        const entry = deferred<AvailableUpdate | null>()
        fake.checks.push(entry)
        fake.calls.push('check')
        return entry.promise
      },
      restart: async () => {
        fake.calls.push('restart')
        if (restartError !== null) {
          throw restartError
        }
      },
      cancelRestart: async () => {
        fake.calls.push('cancelRestart')
      },
      openReleaseNotes: async (version) => {
        fake.calls.push(`openReleaseNotes:${version}`)
      },
    },
  }
  return fake
}
