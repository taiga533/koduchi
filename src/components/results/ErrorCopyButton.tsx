/**
 * エラーの文言をクリップボードへ写すボタン（issue #56）。
 *
 * 写すのは画面に出ている文言そのままである。`ORA-` の番号も位置も Oracle が返した
 * 文言に含まれており、手を加えると検索や問い合わせに貼ったときに元の文言と
 * 突き合わせられなくなる。結果ペインのエラーは `select-text` の器に無いものもあり、
 * なぞって選ぶ道が無い場所があるためボタンで出す。
 */

import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { getClipboardApi } from '../../api/clipboard'

/** 「コピーしました」を出しておく時間（ミリ秒）。定義タブのコピーと揃える。 */
const NOTICE_MS = 2500

interface ErrorCopyButtonProps {
  /** 写すエラーの文言。 */
  text: string
}

export function ErrorCopyButton({ text }: ErrorCopyButtonProps) {
  /**
   * 出している一言。押すたびに新しい物を作り、同じ文言を続けて押しても時計を
   * 巻き戻す（定義タブのコピーと同じ形）。
   */
  const [notice, setNotice] = useState<{ copiedAt: number } | null>(null)

  useEffect(() => {
    if (notice === null) {
      return
    }
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [notice])

  /**
   * 書き込めたときだけ一言を出す。
   *
   * 失敗を握り潰さないため `catch` はしない。書けていないのに「コピーしました」と
   * 出すと、貼ってから初めて気づくことになる。
   */
  const copy = () => {
    void getClipboardApi()
      .writeText(text)
      .then(() => setNotice({ copiedAt: Date.now() }))
  }

  return (
    <span className="inline-flex items-center gap-8px">
      <button
        type="button"
        onClick={copy}
        className="flex items-center gap-6px px-9px py-4px rounded-7px border-none bg-fill text-11px text-fg cursor-pointer font-inherit"
      >
        {notice !== null ? (
          <Check size={12} className="text-ac" />
        ) : (
          <Copy size={12} className="text-fg4" />
        )}
        エラーをコピー
      </button>
      <span role="status" aria-live="polite" className="text-10.5px text-fg5 whitespace-nowrap">
        {notice !== null ? 'コピーしました' : ''}
      </span>
    </span>
  )
}
