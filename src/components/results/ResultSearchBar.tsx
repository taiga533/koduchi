/**
 * 結果テーブルの検索バー（ADR 0027）。
 *
 * 結果テーブルに焦点があるときの `⌘F` で開き、列見出しの上に 1 段だけ載る。
 * 意匠はエディタの検索パネル（`src/components/editor/search.tsx`）に揃えてある。
 * あちらは `@codemirror/search` の素の DOM を日本語化したものだが、出す位置
 * （器の上端）・閉じるボタンの lucide のアイコン・欄の作りは同じ考えである。
 *
 * **件数の隣に「探した範囲」を必ず出す。** 結果は 1,000 行ずつの分割取得であり
 * （ADR 0003）、当たりの件数だけを出すと取得済みの一部を数えたものが全体の件数に
 * 読める。文言の組み立ては `resultSearch.ts` の `matchSummary` が持つ。
 *
 * **変換中の打鍵は何も起こさない**（ADR 0025）。ここは日本語を打つ欄であり、
 * `⏎` は「次の当たりへ」ではなく変換の確定であることが多い。`esc` も同じで、
 * 変換の取り消しでバーごと閉じてはならない。`<form>` にしていないため暗黙の送信は
 * 起きず、関所は `onKeyDown` の先頭 1 か所で足りる。
 */

import { useEffect, useRef } from 'react'
import { CaseSensitive, ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { isComposingKey } from '../../input/ime'

interface ResultSearchBarProps {
  /** 検索語。 */
  needle: string
  onNeedleChange: (needle: string) => void
  /** 大文字と小文字を区別するか。 */
  caseSensitive: boolean
  onCaseSensitiveChange: (caseSensitive: boolean) => void
  /** 件数と探した範囲の文言。 */
  summary: string
  /** 切り詰められた値を探したことの断り書き。無ければ `null`。 */
  note: string | null
  /** 次（または前）の当たりへ移る。 */
  onStep: (forward: boolean) => void
  /** バーを閉じる。 */
  onClose: () => void
  /** カーソルが尽きていないか。真なら「残りを読み込む」を出す。 */
  hasMore: boolean
  /** 残りを読み込んでいる最中か。 */
  loadingRest: boolean
  /** 残りの読み込みを始める・止める。 */
  onToggleRest: () => void
  /**
   * 入力欄へ焦点を当て直す合図。
   *
   * バーが開いている間に `⌘F` をもう一度押すと値が変わる。値が変わるたびに欄を
   * 選び直すため、打ち替えがそのまま効く。
   */
  focusToken: number
}

export function ResultSearchBar({
  needle,
  onNeedleChange,
  caseSensitive,
  onCaseSensitiveChange,
  summary,
  note,
  onStep,
  onClose,
  hasMore,
  loadingRest,
  onToggleRest,
  focusToken,
}: ResultSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  // `focusToken` の値そのものには意味が無く、変わったことだけが「欄へ焦点を戻せ」
  // という合図である。バーが出ている間は必ず 1 以上になっている。
  useEffect(() => {
    if (focusToken > 0) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [focusToken])

  /**
   * 検索欄の打鍵。
   *
   * `⏎` で次へ、`⇧⏎` で前へ、`esc` で閉じる。**変換中は何もしない**（ADR 0025）。
   */
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (isComposingKey(event)) {
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      onStep(!event.shiftKey)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    // `⌘G` / `⇧⌘G` は表の中と同じく次・前の当たりへ。
    if (event.metaKey && event.key.toLowerCase() === 'g') {
      event.preventDefault()
      onStep(!event.shiftKey)
      return
    }
    // 開いたまま `⌘F` を押し直したときは語を選び直すだけにする。`⇧⌘F` は
    // オブジェクトのソース検索（ADR 0021）なので、ここでは拾わずに通す。
    if (event.metaKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      inputRef.current?.select()
    }
  }

  return (
    <div
      data-testid="result-search-bar"
      className="shrink-0 flex items-center gap-8px px-8px py-5px bg-panel2 border-b border-line text-11.5px"
    >
      <div className="w-260px shrink-0 flex items-center gap-7px px-8px py-3px rounded-7px bg-fill">
        <Search size={13} className="text-fg5 shrink-0" />
        <input
          ref={inputRef}
          value={needle}
          onChange={(event) => onNeedleChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="表示中の結果を検索"
          aria-label="表示中の結果を検索"
          className="flex-1 min-w-0 bg-transparent border-none outline-none text-11.5px text-fg font-inherit placeholder:text-fg4"
        />
      </div>

      <button
        type="button"
        aria-label="大文字と小文字を区別"
        aria-pressed={caseSensitive}
        onClick={() => onCaseSensitiveChange(!caseSensitive)}
        className={`flex items-center p-3px rounded-6px border-none cursor-pointer font-inherit ${
          caseSensitive ? 'bg-fill2 text-fg' : 'bg-transparent text-fg4'
        }`}
      >
        <CaseSensitive size={14} />
      </button>

      <button
        type="button"
        aria-label="前の当たりへ"
        onClick={() => onStep(false)}
        className="flex items-center p-3px rounded-6px bg-transparent border-none text-fg4 cursor-pointer font-inherit"
      >
        <ChevronUp size={14} />
      </button>
      <button
        type="button"
        aria-label="次の当たりへ"
        onClick={() => onStep(true)}
        className="flex items-center p-3px rounded-6px bg-transparent border-none text-fg4 cursor-pointer font-inherit"
      >
        <ChevronDown size={14} />
      </button>

      <span data-testid="result-search-summary" className="text-11px text-fg3">
        {summary}
      </span>

      {hasMore ? (
        <button
          type="button"
          onClick={onToggleRest}
          className="px-9px py-2px rounded-6px bg-fill border-none text-11px text-fg2 cursor-pointer font-inherit"
        >
          {loadingRest ? '読み込みを止める' : '残りを読み込んで探す'}
        </button>
      ) : null}

      {note ? <span className="text-11px text-warn">{note}</span> : null}

      <span className="flex-1" />

      <button
        type="button"
        aria-label="検索を閉じる"
        onClick={onClose}
        className="flex items-center p-3px rounded-6px bg-transparent border-none text-fg4 cursor-pointer font-inherit"
      >
        <X size={13} />
      </button>
    </div>
  )
}
