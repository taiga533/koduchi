/**
 * 自動アップデートのストア（ADR 0042）。
 *
 * 新しい版の確認・取得と入れ替え・再起動の段階を持つ。遷移は
 * `docs/state/update.d2` にあり、ここに無い遷移はストア自身が拒む。
 *
 * ダイアログを出すかは段階とは別に `dialogOpen` で持つ。起動時の確認は黙って
 * 走らせ、新しい版があったときだけ出す。手で確かめたときは「最新です」も
 * 失敗も出す。段階で出し分けようとすると、同じ「確認中」が見える場合と
 * 見えない場合とで段階が 2 つに割れるためである。
 *
 * 確認は同時に 1 本しか走らせない。走っている間の確認は新しく問い合わせず、
 * 手で押されたならダイアログを出すだけである。そのため待ちの後に試行が
 * 古くなっていることは無く、試行の識別子は持たない。
 */

import { create } from 'zustand'
import type { AvailableUpdate, DownloadProgress } from '../api/updater'
import { getUpdaterApi } from '../api/updater'
import { toErrorMessage } from '../types/db'

/** 段階。 */
export type UpdateStatus =
  /** 何もしていない。 */
  | 'idle'
  /** 新しい版を問い合わせている。 */
  | 'checking'
  /** 今の版が最新だった。 */
  | 'upToDate'
  /** 新しい版がある。取るかを利用者に尋ねている。 */
  | 'available'
  /** 新しい版を取ってきて入れ替えている。 */
  | 'downloading'
  /** 各ウィンドウを閉じて起ち上げ直している。 */
  | 'restarting'
  /** 入れ替え済みで、再起動を断られた。次に起動したときから新しい版になる。 */
  | 'installed'
  /** 確認・取得・再起動のどれかに失敗した。 */
  | 'failed'

/**
 * 確認のきっかけ。
 *
 * - `launch`: 起動時。最新だったときも失敗したときも黙っている。
 * - `manual`: 利用者がメニューかパレットから押した。結果を必ず見せる。
 */
export type CheckTrigger = 'launch' | 'manual'

interface UpdateState {
  status: UpdateStatus
  /** ダイアログを出しているか。 */
  dialogOpen: boolean
  /** 見つかった新しい版。 */
  update: AvailableUpdate | null
  /** 取得の進み具合。取得していなければ `null`。 */
  progress: DownloadProgress | null
  /** 失敗したときのメッセージ。 */
  error: string | null

  /** 新しい版を確かめる。 */
  check: (trigger: CheckTrigger) => Promise<void>
  /** 新しい版を取ってきて入れ替え、そのまま再起動に進む。 */
  install: () => Promise<void>
  /** 入れ替え済みの版で起ち上げ直す。 */
  restart: () => Promise<void>
  /** 再起動がこのウィンドウの関所で断られた。 */
  restartDeclined: () => void
  /** ダイアログを閉じる。取得と再起動の最中は閉じない。 */
  dismiss: () => void
}

/** 新しく問い合わせてよい段階。 */
const CHECKABLE: ReadonlySet<UpdateStatus> = new Set(['idle', 'upToDate', 'failed'])

/** 閉じてはならない段階。閉じても止められず、再起動は関所の確認として現れる。 */
const UNDISMISSABLE: ReadonlySet<UpdateStatus> = new Set(['downloading', 'restarting'])

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: 'idle',
  dialogOpen: false,
  update: null,
  progress: null,
  error: null,

  check: async (trigger) => {
    const { status } = get()
    if (!CHECKABLE.has(status)) {
      // 走っている確認や見つけた版はそのまま見せる。起動時の確認は何もしない。
      if (trigger === 'manual') {
        set({ dialogOpen: true })
      }
      return
    }
    // 起動時の確認を 2 度走らせない。失敗や最新の結果は既に黙って控えてある。
    if (trigger === 'launch' && status !== 'idle') {
      return
    }

    set({
      status: 'checking',
      dialogOpen: trigger === 'manual',
      update: null,
      progress: null,
      error: null,
    })

    try {
      const update = await getUpdaterApi().check()
      if (update === null) {
        set({ status: 'upToDate' })
        return
      }
      // 起動時の確認で見つけたらここで初めて出す。手で確かめたのに待ちの間に
      // 閉じられたなら、もう要らないと言われたものとして出し直さない。
      set((state) => ({
        status: 'available',
        update,
        dialogOpen: trigger === 'launch' ? true : state.dialogOpen,
      }))
    } catch (error) {
      set({ status: 'failed', error: toErrorMessage(error) })
    }
  },

  install: async () => {
    const { status, update } = get()
    if (status !== 'available' || update === null) {
      return
    }

    set({ status: 'downloading', dialogOpen: true, progress: { downloaded: 0, total: null } })
    try {
      await update.downloadAndInstall((progress) => set({ progress }))
    } catch (error) {
      set({ status: 'failed', error: toErrorMessage(error) })
      return
    }

    // 入れ替えただけでは古い版が動き続ける。尋ねたときに「再起動」まで承諾を
    // 得ているため、ここで続けて起ち上げ直す。
    set({ status: 'installed' })
    await get().restart()
  },

  restart: async () => {
    if (get().status !== 'installed') {
      return
    }

    set({ status: 'restarting', dialogOpen: true, error: null })
    try {
      await getUpdaterApi().restart()
    } catch (error) {
      set({ status: 'failed', error: toErrorMessage(error) })
    }
  },

  restartDeclined: () => {
    if (get().status !== 'restarting') {
      return
    }
    set({ status: 'installed', dialogOpen: true })
  },

  dismiss: () => {
    if (UNDISMISSABLE.has(get().status)) {
      return
    }
    set({ dialogOpen: false })
  },
}))
