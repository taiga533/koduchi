/**
 * 実行中で切断できないことを伝えるダイアログ。
 *
 * 走っている文があるまま接続を閉じると、その文は道半ばで打ち切られる。
 * 何が起きたのか分からないまま結果を失わせないため、切断を進めずに
 * 先へ中止を促す。中止はここからも掛けられるようにしてある（`⌘.` と同じ）。
 */

import { CircleAlert } from 'lucide-react'

interface DisconnectBlockedDialogProps {
  /** 実行中の文を中止する（`⌘.` と同じ）。 */
  onCancelExecution: () => void
  /** ダイアログを閉じる。切断は行わない。 */
  onClose: () => void
}

export function DisconnectBlockedDialog({
  onCancelExecution,
  onClose,
}: DisconnectBlockedDialogProps) {
  return (
    <div
      role="dialog"
      aria-label="実行中のため切断できません"
      className="absolute inset-0 z-20 flex items-center justify-center bg-[rgba(24,28,38,.28)] p-24px"
    >
      <section className="w-380px bg-panel rounded-10px border border-line p-18px flex flex-col gap-13px">
        <h2 className="flex items-center gap-8px text-14px font-600 text-fg m-0">
          <CircleAlert size={15} className="text-fg4" />
          実行中のため切断できません
        </h2>
        <p className="text-12px text-fg2 leading-[1.6] m-0">
          実行中の文があります。<code className="text-fg">⌘.</code> で中止してから切断してください。
        </p>
        <div className="flex justify-end gap-8px">
          <button
            type="button"
            onClick={onClose}
            className="px-12px py-6px rounded-7px bg-fill border-none text-11.5px text-fg cursor-pointer font-inherit"
          >
            閉じる
          </button>
          <button
            type="button"
            onClick={onCancelExecution}
            className="px-12px py-6px rounded-7px bg-ac border-none text-11.5px text-acfg cursor-pointer font-inherit"
          >
            実行を中止
          </button>
        </div>
      </section>
    </div>
  )
}
