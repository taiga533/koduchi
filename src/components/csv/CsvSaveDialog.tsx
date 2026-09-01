/**
 * CSV 保存ダイアログ（`⌥⌘S`）。
 *
 * 選ばせるのは区切り文字・文字コード・NULL の表現の 3 つだけである。
 * ヘッダー行あり・`"` 囲みの RFC 4180 エスケープ・改行 CRLF は固定とする
 * （ADR の「CSV の書式」節）。選んだ内容は次回のために保存される。
 *
 * 書き出しはカーソルを尽きるまで読み進めるため時間がかかる。進捗を出し、
 * 途中で中止できるようにする。
 */

import { X } from 'lucide-react'
import type { CsvDelimiter, CsvEncoding, CsvNullText, CsvOptions } from '../../types/db'

/** 区切り文字の選択肢。 */
const DELIMITERS: { id: CsvDelimiter; label: string }[] = [
  { id: 'comma', label: 'カンマ' },
  { id: 'tab', label: 'タブ' },
  { id: 'semicolon', label: 'セミコロン' },
]

/** 文字コードの選択肢。 */
const ENCODINGS: { id: CsvEncoding; label: string }[] = [
  { id: 'utf8Bom', label: 'UTF-8 (BOM 付き)' },
  { id: 'utf8', label: 'UTF-8 (BOM なし)' },
  { id: 'shiftJis', label: 'Shift_JIS' },
]

/** NULL の表現の選択肢。 */
const NULL_TEXTS: { id: CsvNullText; label: string }[] = [
  { id: 'blank', label: '空欄' },
  { id: 'word', label: 'NULL' },
  { id: 'backslash', label: '\\N' },
]

/** 書き出しの進み具合。`null` ならまだ始まっていない。 */
export interface CsvExportState {
  rows: number
  done: boolean
  error: string | null
}

interface CsvSaveDialogProps {
  options: CsvOptions
  /** 書式が変わったときに呼ぶ。次回のために保存される。 */
  onChange: (options: CsvOptions) => void
  /** 書き出しの状態。始まっていなければ `null`。 */
  progress: CsvExportState | null
  /** 保存先を選んで書き出しを始める。 */
  onStart: () => void
  /** 書き出しを中止する。書きかけのファイルは消える。 */
  onCancel: () => void
  /** ダイアログを閉じる。 */
  onClose: () => void
}

export function CsvSaveDialog({
  options,
  onChange,
  progress,
  onStart,
  onCancel,
  onClose,
}: CsvSaveDialogProps) {
  const running = progress !== null && !progress.done && progress.error === null

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-[rgba(24,28,38,.28)] p-24px">
      <section className="w-420px bg-panel rounded-10px border border-line p-18px flex flex-col gap-15px">
        <div className="flex items-center">
          <h2 className="flex-1 text-14px font-600 text-fg m-0">結果を CSV で保存</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="保存をやめる"
            className="flex items-center bg-transparent border-none p-0 text-fg4 cursor-pointer font-inherit"
          >
            <X size={15} />
          </button>
        </div>

        <Choice
          label="区切り文字"
          options={DELIMITERS}
          value={options.delimiter}
          disabled={running}
          onChange={(delimiter) => onChange({ ...options, delimiter })}
        />
        <Choice
          label="文字コード"
          options={ENCODINGS}
          value={options.encoding}
          disabled={running}
          onChange={(encoding) => onChange({ ...options, encoding })}
        />
        <Choice
          label="NULL の表現"
          options={NULL_TEXTS}
          value={options.nullText}
          disabled={running}
          onChange={(nullText) => onChange({ ...options, nullText })}
        />

        <p className="m-0 text-11px text-fg4 leading-[1.6]">
          ヘッダー行あり・引用符での囲み・改行 CRLF は固定です。
        </p>

        {progress ? (
          <p
            className={`m-0 text-11.5px ${progress.error ? 'text-err' : 'text-fg3'}`}
            role="status"
          >
            {progress.error ??
              (progress.done
                ? `${progress.rows.toLocaleString('ja-JP')} 行を書き出しました`
                : `${progress.rows.toLocaleString('ja-JP')} 行を書き出し中…`)}
          </p>
        ) : null}

        <div className="flex items-center gap-8px pt-2px border-t border-line2">
          <span className="flex-1" />
          {running ? (
            <button
              type="button"
              onClick={onCancel}
              className="px-14px py-6px rounded-7px bg-panel border border-line text-12.5px text-fg cursor-pointer font-inherit"
            >
              中止
            </button>
          ) : (
            <button
              type="button"
              onClick={onStart}
              className="px-16px py-6px rounded-7px bg-ac text-acfg text-12.5px font-600 border-none cursor-pointer font-inherit"
            >
              {progress?.done ? 'もう一度保存' : '保存先を選ぶ'}
            </button>
          )}
        </div>
      </section>
    </div>
  )
}

/** ラジオボタン 1 組。 */
function Choice<T extends string>({
  label,
  options,
  value,
  disabled,
  onChange,
}: {
  label: string
  options: { id: T; label: string }[]
  value: T
  disabled: boolean
  onChange: (value: T) => void
}) {
  return (
    <fieldset className="m-0 p-0 border-none flex flex-col gap-6px">
      <legend className="p-0 text-11.5px text-fg3">{label}</legend>
      <div className="flex flex-wrap gap-x-14px gap-y-5px">
        {options.map((option) => (
          <label key={option.id} className="flex items-center gap-6px text-12px text-fg">
            <input
              type="radio"
              name={label}
              checked={option.id === value}
              disabled={disabled}
              onChange={() => onChange(option.id)}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
