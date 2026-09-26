/**
 * テスト用のネイティブのダイアログの窓口（ADR 0010）。
 *
 * `src/api/dialog.ts` を丸ごと差し替えて、尋ねた中身を記録し、決めておいた
 * 答えを返す。mock ライブラリを使わずに仲介者の裁定を確かめられる。
 */

import type { ConfirmOptions, DialogApi, FileFilter } from '../api/dialog'

/** 差し替えた窓口が返す答え。 */
export interface FakeDialogAnswers {
  /** `confirm` の答え。既定は「いいえ」。 */
  confirm?: boolean
  /** 保存先。`null` なら取り消したことになる。 */
  savePath?: string | null
  /** 開くファイル。`null` なら取り消したことになる。 */
  openPath?: string | null
}

/** 尋ねた中身の記録。 */
export interface FakeDialogCalls {
  confirm: { message: string; options: ConfirmOptions }[]
  save: { defaultPath: string; filters: FileFilter[] }[]
  open: { filters: FileFilter[] }[]
}

/**
 * 決めておいた答えを返す窓口を作る。
 *
 * @param answers 返す答え。省くと取り消し・「いいえ」になる
 */
export function createFakeDialogApi(answers: FakeDialogAnswers = {}): {
  api: DialogApi
  calls: FakeDialogCalls
} {
  const calls: FakeDialogCalls = { confirm: [], save: [], open: [] }
  const api: DialogApi = {
    confirm: async (message, options) => {
      calls.confirm.push({ message, options })
      return answers.confirm ?? false
    },
    save: async (options) => {
      calls.save.push(options)
      return answers.savePath ?? null
    },
    open: async (options) => {
      calls.open.push(options)
      return answers.openPath ?? null
    },
  }
  return { api, calls }
}
