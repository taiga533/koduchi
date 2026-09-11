/**
 * 保存済みクエリの名前を尋ねるダイアログ（`⇧⌘S`、ADR 0018）。
 *
 * 見た目と作りはバインド変数ダイアログ（`BindValuesDialog.tsx`）に揃えてある。
 * `⏎` で保存、`esc` で取り消す。キーバインドは足していない。
 *
 * 保存するのは SQL 本体だけである。バインド変数の値は渡さない（ADR 0005）。
 */

import { useState } from 'react'
import { X } from 'lucide-react'
import { blockComposingSubmit } from '../../input/ime'
import { useEscapeKey } from '../../input/useEscapeKey'

interface SaveQueryDialogProps {
  /** 名前欄の初期値。タブの名前から拡張子を落としたものを渡す。 */
  defaultName: string
  /** 保存する SQL。確かめられるよう先頭だけを見せる。 */
  sql: string
  /** `⏎`。この名前で保存する。 */
  onSubmit: (name: string) => void
  /** `esc` または ✕。保存を取り消す。 */
  onClose: () => void
}

export function SaveQueryDialog({ defaultName, sql, onSubmit, onClose }: SaveQueryDialogProps) {
  const [name, setName] = useState(defaultName)

  // `esc` は `window` で受ける（ADR 0031）。焦点が外れていても閉じられる。
  useEscapeKey(onClose)

  const 整えた名前 = name.trim()

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-[rgba(24,28,38,.28)] p-24px">
      <form
        className="w-420px bg-panel rounded-10px border border-line p-18px flex flex-col gap-15px"
        onKeyDown={blockComposingSubmit}
        onSubmit={(event) => {
          event.preventDefault()
          if (整えた名前 !== '') {
            onSubmit(整えた名前)
          }
        }}
      >
        <div className="flex items-center">
          <h2 className="flex-1 text-14px font-600 text-fg m-0">クエリを保存</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="保存をやめる"
            className="flex items-center bg-transparent border-none p-0 text-fg4 cursor-pointer font-inherit"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex flex-col gap-5px">
          <label htmlFor="saved-query-name" className="text-11.5px text-fg3">
            名前
          </label>
          <input
            id="saved-query-name"
            type="text"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="px-8px py-5px rounded-6px bg-bg border border-line text-12px text-fg font-inherit"
          />
        </div>

        <pre className="m-0 max-h-120px overflow-auto px-8px py-6px rounded-6px bg-bg border border-line text-11px text-fg4 whitespace-pre-wrap break-all">
          {sql}
        </pre>

        <p className="m-0 text-11px text-fg4 leading-[1.6]">
          保存するのは SQL 本体だけです。バインド変数の値は保存しません。
        </p>

        <div className="flex items-center gap-8px pt-2px border-t border-line2">
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="px-14px py-6px rounded-7px bg-panel border border-line text-12.5px text-fg cursor-pointer font-inherit"
          >
            取り消す
          </button>
          <button
            type="submit"
            disabled={整えた名前 === ''}
            className="px-16px py-6px rounded-7px bg-ac text-acfg text-12.5px font-600 border-none cursor-pointer font-inherit disabled:opacity-50"
          >
            保存
          </button>
        </div>
      </form>
    </div>
  )
}
