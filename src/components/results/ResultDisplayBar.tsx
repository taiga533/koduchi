/**
 * 結果ペインのヘッダーを広げて出す表示調整の欄（ADR 0048）。
 *
 * ヘッダー右端の `sliders-horizontal` で開閉する。オーバーレイにしないのは、
 * 切り替えた結果を表で確かめながら触るものだからである。重ねると、変えた表示が
 * 欄の下に隠れる。
 *
 * ここで変えるのは**この結果タブだけ**である。既定は設定画面で変える。
 * 見た目だけが変わり、コピーと CSV は元の値のままであることを欄の中に書いておく
 * （見えているものと写したものが違うことに、貼ってから気づかせない）。
 *
 * `esc` は `useEscapeKey` で受ける（ADR 0031）。オーバーレイではないが、`esc` の
 * 受け手を 2 種類にしないためである。後から開いた詳細パネルやメニューが先に閉じる
 * 順序も、積みがそのまま守る。
 */

import { useEffect, useRef } from 'react'
import { useEscapeKey } from '../../input/useEscapeKey'
import type { ResultDisplay } from './resultDisplay'

interface ResultDisplayBarProps {
  /** 欄の要素の ID。開閉のボタンの `aria-controls` と揃える。 */
  id: string
  /** このタブで効いている表示調整。 */
  display: ResultDisplay
  /** このタブで既定から変えているか。「既定に戻す」を出すかを決める。 */
  overridden: boolean
  /** このタブだけ表示調整を変える。 */
  onChange: (patch: Partial<ResultDisplay>) => void
  /** このタブの表示調整を既定へ戻す。 */
  onReset: () => void
  /** 欄を閉じる。 */
  onClose: () => void
}

/** 並べる項目。並びは設定画面と揃える。 */
const OPTIONS: { key: keyof ResultDisplay; label: string }[] = [
  { key: 'thousandsSeparator', label: '数値を 3 桁で区切る' },
  { key: 'showWhitespace', label: '前後の空白・タブ・改行を記号で見せる' },
]

export function ResultDisplayBar({
  id,
  display,
  overridden,
  onChange,
  onReset,
  onClose,
}: ResultDisplayBarProps) {
  useEscapeKey(onClose)

  const firstRef = useRef<HTMLInputElement>(null)

  // 開いたらすぐキーボードで切り替えられるよう、最初の項目へ焦点を移す。
  useEffect(() => {
    firstRef.current?.focus()
  }, [])

  return (
    <div
      id={id}
      role="group"
      aria-label="結果の表示の調整"
      data-testid="result-display-bar"
      className="flex flex-wrap items-center gap-x-16px gap-y-6px px-12px py-7px border-t border-line2 bg-panel2 text-12px text-fg"
    >
      {OPTIONS.map((option, index) => (
        <label key={option.key} className="flex items-center gap-6px cursor-pointer">
          <input
            ref={index === 0 ? firstRef : undefined}
            type="checkbox"
            checked={display[option.key]}
            onChange={(event) => onChange({ [option.key]: event.target.checked })}
          />
          {option.label}
        </label>
      ))}
      <span className="flex-1" />
      <span className="text-11px text-fg4">見た目だけ。コピーと CSV は元の値のまま</span>
      {overridden ? (
        <button
          type="button"
          onClick={onReset}
          className="px-8px py-3px rounded-6px bg-fill border-none text-11.5px text-fg cursor-pointer font-inherit"
        >
          既定に戻す
        </button>
      ) : null}
    </div>
  )
}
