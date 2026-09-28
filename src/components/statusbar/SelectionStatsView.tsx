/**
 * 結果テーブルで選んだセルの件数と集計（ADR 0049）。
 *
 * 件数はいつも出し、合計 / 平均 / 最小 / 最大はそのうち 1 つだけを出す。どれを出すかは
 * 「接続中」の表示と同じ形の、押すと上へ開くメニューで切り替える。4 つを並べ続けると
 * ステータスバーの幅が足りなくなるうえ、ふだん見たいのはたいてい 1 つである。
 * メニューの項目には 4 つの値をすべて添え、切り替えずに見比べられるようにする。
 *
 * 値は**なぞって写せる**（`select-text`）。コピーのボタンは置かない。ステータスバーは
 * `app.css` で選べないようにしてあるため、値の 1 箇所だけを選べるようにしている。
 *
 * 値の欄は幅を抑えて `…` で省く。`BINARY_DOUBLE` の 1e300 は 300 桁を超える 10 進で
 * 届き、そのまま出すと右の「接続中」を画面の外へ押し出す。省いた部分も DOM には
 * あるため、`title` で読め、なぞって（三度押しで）全文を写せる。
 *
 * 大きな選択の集計は細切れに走る（`useSelectionStats`）。終わるまでは件数と注意の印
 * だけを出し、値の欄は「集計中」にする。件数と印は範囲の広さから決まり、待たない。
 *
 * 切り替えのボタンとメニューは押し下げで焦点を奪わない。奪うと結果テーブルから
 * 焦点が抜け、選択が見えたまま `⌘C` が表へ届かなくなる（CLAUDE.md「結果テーブルの
 * コピー」の「閉じた後の焦点を表に残す」）。
 */

import { useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { Check, ChevronUp, TriangleAlert } from 'lucide-react'
import type { SelectionSource } from '../../stores/selectionStats'
import { useSelectionStatsStore } from '../../stores/selectionStats'
import { useEscapeKey } from '../../input/useEscapeKey'
import type { SelectionStats, StatKind } from '../results/selectionStats'
import {
  describeStat,
  formatStatValue,
  isPartialSelection,
  partialNote,
  selectedCellCount,
  STAT_KINDS,
  STAT_LABELS,
} from '../results/selectionStats'
import { PENDING, useSelectionStats } from './useSelectionStats'

/** 値が無いときに出す印。0 と見分けるため数字にはしない。 */
const NO_VALUE = '—'

/** 集計が終わっていないときの値の欄。 */
const PENDING_LABEL = '集計中…'

/** 選択の集計。2 セル以上を選んでいなければ何も出さない。 */
export function SelectionStatsView() {
  const source = useSelectionStatsStore((state) => state.source)
  // 選択が消えたら開いていたメニューも捨てる。中身を別の部品にしておけば、選択が
  // 消えた時点で状態ごと外れ、次に選んだときにメニューが開いたまま現れない。
  return source === null ? null : <StatsBody source={source} />
}

/**
 * 押し下げの既定の動き（焦点の移動）を止める。
 *
 * @param event 押し下げ
 */
function keepFocus(event: ReactMouseEvent) {
  event.preventDefault()
}

/**
 * 集計の値を表示の文字列にする。
 *
 * @param stats 集計。終わっていなければ `PENDING`
 * @param kind 出す種類
 */
function valueText(stats: SelectionStats | typeof PENDING, kind: StatKind): string {
  if (stats === PENDING) {
    return PENDING_LABEL
  }
  const value = stats[kind]
  return value === null ? NO_VALUE : formatStatValue(value)
}

/**
 * 値に添える説明（`title`）。
 *
 * @param stats 集計。終わっていなければ `PENDING`
 * @param kind 説明する種類
 * @param partial まだ読み込んでいない行へ選択が続いているか
 * @param loadedRows 読み込み済みの行数
 */
function noteFor(
  stats: SelectionStats | typeof PENDING,
  kind: StatKind,
  partial: boolean,
  loadedRows: number,
): string {
  if (stats !== PENDING) {
    return describeStat(stats, kind)
  }
  return partial ? partialNote(loadedRows, kind) : ''
}

/**
 * 件数と、選んだ種類の集計。
 *
 * @param source 集計の材料
 */
function StatsBody({ source }: { source: SelectionSource }) {
  const kind = useSelectionStatsStore((state) => state.kind)
  const choose = useSelectionStatsStore((state) => state.choose)
  const [open, setOpen] = useState(false)
  const stats = useSelectionStats(source)
  const count = selectedCellCount(source.rows, source.range)
  const partial = isPartialSelection(source.rows, source.range, source.exhausted)
  const loadedRows = source.rows.length
  const note = noteFor(stats, kind, partial, loadedRows)
  const value = valueText(stats, kind)

  return (
    <span data-testid="selection-stats" className="flex items-center gap-10px min-w-0">
      <span className="flex items-center gap-4px shrink-0">
        件数
        <span data-testid="selection-count" className="select-text text-fg">
          {count.toLocaleString('ja-JP')}
        </span>
      </span>
      <span className="relative flex items-center gap-4px min-w-0">
        <button
          type="button"
          onMouseDown={keepFocus}
          onClick={() => setOpen((current) => !current)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex items-center gap-3px px-4px py-1px rounded-5px text-11px text-fg3 bg-transparent border-none cursor-pointer font-inherit hover:bg-fill shrink-0"
        >
          {STAT_LABELS[kind]}
          <ChevronUp size={12} />
        </button>
        {partial ? (
          <span
            data-testid="selection-stats-partial"
            role="img"
            aria-label={partialNote(loadedRows, kind)}
            title={partialNote(loadedRows, kind)}
            className="flex items-center text-warn shrink-0"
          >
            <TriangleAlert size={12} />
          </span>
        ) : null}
        <span
          data-testid="selection-stat-value"
          title={note === '' ? value : `${value}\n${note}`}
          className="select-text text-fg truncate max-w-180px"
        >
          {value}
        </span>
        {open ? (
          <StatsMenu
            stats={stats}
            current={kind}
            onClose={() => setOpen(false)}
            onChoose={(next) => {
              setOpen(false)
              choose(next)
            }}
          />
        ) : null}
      </span>
    </span>
  )
}

/**
 * 集計の種類を選ぶメニュー。ステータスバーは最下段にあるため上へ開く。
 *
 * @param stats 集計（各項目に値を添える）。終わっていなければ `PENDING`
 * @param current 今出している種類
 * @param onClose 選ばずに閉じる
 * @param onChoose 種類を選んだ
 */
function StatsMenu({
  stats,
  current,
  onClose,
  onChoose,
}: {
  stats: SelectionStats | typeof PENDING
  current: StatKind
  onClose: () => void
  onChoose: (kind: StatKind) => void
}) {
  useEscapeKey(onClose)

  return (
    <div
      role="menu"
      className="absolute left-0 bottom-24px z-10 min-w-180px max-w-320px p-5px rounded-9px bg-panel border border-line shadow-[0_8px_24px_rgba(24,28,38,.16)] flex flex-col gap-1px"
    >
      {STAT_KINDS.map((kind) => (
        <button
          key={kind}
          type="button"
          role="menuitemradio"
          aria-checked={kind === current}
          onMouseDown={keepFocus}
          onClick={() => onChoose(kind)}
          title={stats === PENDING ? undefined : describeStat(stats, kind)}
          className="flex items-center gap-8px w-full px-8px py-6px rounded-7px bg-transparent border-none cursor-pointer font-inherit text-11.5px text-fg text-left hover:bg-fill"
        >
          <span className="flex items-center w-13px text-fg4 shrink-0">
            {kind === current ? <Check size={13} /> : null}
          </span>
          <span className="shrink-0">{STAT_LABELS[kind]}</span>
          <span className="flex-1" />
          <span className="text-fg3 truncate min-w-0">{valueText(stats, kind)}</span>
        </button>
      ))}
    </div>
  )
}
