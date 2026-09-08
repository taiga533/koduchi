/**
 * バインド変数の値を尋ねるダイアログ（ADR の「バインド変数」節・ADR 0016）。
 *
 * `⌘⏎` / `⇧⌘⏎` / `⌘E` / `⇧⌘E` の実行対象にバインド変数が含まれていたら、実行の
 * 前にここで値を尋ねる。値は文字列として入力し、型は行ごとに選ぶ。既定の型は
 * 呼び出し側が推し量って入れてあり、ここで選び直せる。NULL を渡したいときは行ごとの
 * チェックを付ける。
 *
 * 見た目と作りは CSV 保存ダイアログ（`src/components/csv/CsvSaveDialog.tsx`）に
 * 揃えてある。`⏎` で実行、`esc` で取り消し。
 */

import { X } from 'lucide-react'
import type { BindInput } from '../../stores/tab'
import { applyBindText, emptyBindInput } from '../../stores/tab'
import type { BindKind } from '../../types/db'
import { bindKindLabels, bindKinds } from '../../types/db'

interface BindValuesDialogProps {
  /** 尋ねる変数の名前。SQL に出てきた順。 */
  names: string[]
  /** 現在の入力。変数名をキーにした表。 */
  values: Record<string, BindInput>
  /** 入力が変わったときに呼ぶ。前回の値としてタブに覚えられる。 */
  onChange: (values: Record<string, BindInput>) => void
  /** `⏎`。この値で実行する。 */
  onSubmit: () => void
  /** `esc` または ✕。実行を取り消す。 */
  onClose: () => void
}

export function BindValuesDialog({
  names,
  values,
  onChange,
  onSubmit,
  onClose,
}: BindValuesDialogProps) {
  /** 変数 1 つぶんの入力を差し替える。 */
  const 差し替える = (name: string, patch: Partial<BindInput>): void => {
    const current = values[name] ?? emptyBindInput
    onChange({ ...values, [name]: { ...current, ...patch } })
  }

  /** 値を打ち直す。まだ型を選び直していなければ、型も値の見た目に合わせる。 */
  const 値を打ち直す = (name: string, text: string): void => {
    const current = values[name] ?? emptyBindInput
    onChange({ ...values, [name]: applyBindText(current, text) })
  }

  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-[rgba(24,28,38,.28)] p-24px"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
        }
      }}
    >
      <form
        className="w-420px bg-panel rounded-10px border border-line p-18px flex flex-col gap-15px"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <div className="flex items-center">
          <h2 className="flex-1 text-14px font-600 text-fg m-0">バインド変数の値</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="実行をやめる"
            className="flex items-center bg-transparent border-none p-0 text-fg4 cursor-pointer font-inherit"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex flex-col gap-10px max-h-260px overflow-y-auto">
          {names.map((name, index) => {
            const input = values[name] ?? emptyBindInput
            return (
              <div key={name} className="flex flex-col gap-5px">
                <label htmlFor={`bind-${name}`} className="text-11.5px text-fg3">
                  {`:${name}`}
                </label>
                <div className="flex items-center gap-10px">
                  <select
                    aria-label={`:${name} の型`}
                    value={input.kind}
                    onChange={(event) => 差し替える(name, { kind: event.target.value as BindKind })}
                    className="px-6px py-5px rounded-6px bg-bg border border-line text-11.5px text-fg font-inherit outline-none focus:border-ac"
                  >
                    {bindKinds.map((kind) => (
                      <option key={kind} value={kind}>
                        {bindKindLabels[kind]}
                      </option>
                    ))}
                  </select>
                  <input
                    id={`bind-${name}`}
                    type="text"
                    autoFocus={index === 0}
                    value={input.text}
                    disabled={input.isNull}
                    onChange={(event) => 値を打ち直す(name, event.target.value)}
                    className="flex-1 min-w-0 px-8px py-5px rounded-6px bg-bg border border-line text-12px text-fg font-inherit"
                  />
                  <label className="flex items-center gap-5px text-12px text-fg whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={input.isNull}
                      onChange={(event) => 差し替える(name, { isNull: event.target.checked })}
                    />
                    NULL
                  </label>
                </div>
              </div>
            )
          })}
        </div>

        <p className="m-0 text-11px text-fg4 leading-[1.6]">
          値は選んだ型に直して渡します。日付は YYYY-MM-DD、時刻を含めるときは YYYY-MM-DD HH:MI:SS
          の形式で書きます。⏎ で実行、esc で取り消します。
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
            className="px-16px py-6px rounded-7px bg-ac text-acfg text-12.5px font-600 border-none cursor-pointer font-inherit"
          >
            この値で実行
          </button>
        </div>
      </form>
    </div>
  )
}
