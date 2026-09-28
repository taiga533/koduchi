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
 *
 * 焦点を最初の項目へ移すのは、利用者がボタンで開いたときだけである
 * （`takeFocusRequest`）。開いたまま再実行すると欄は消えて描き直されるが、そのとき
 * に焦点をエディタから奪ってはならない。
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
  /**
   * 描かれた直後に焦点を取ってよいかを尋ねる。真は 1 度だけ返る。
   *
   * 欄は再実行やタブの行き来で消えては描き直される。描かれるたびに焦点を取ると、
   * 実行直後にエディタで打った文字がチェックボックスへ入る。焦点を移すのは利用者が
   * ボタンで開いたときだけにする。
   */
  takeFocusRequest: () => boolean
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
  takeFocusRequest,
}: ResultDisplayBarProps) {
  useEscapeKey(onClose)

  const firstRef = useRef<HTMLInputElement>(null)

  // ボタンで開いたときだけ、すぐキーボードで切り替えられるよう最初の項目へ焦点を移す。
  useEffect(() => {
    if (takeFocusRequest()) {
      firstRef.current?.focus()
    }
    // 描かれた直後の 1 度だけ尋ねる。描き直しで尋ね直すと焦点を奪う。
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
