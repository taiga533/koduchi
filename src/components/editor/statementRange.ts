/**
 * `⌘⏎` で流れる文の範囲をエディタに示す（ADR 0047、issue #73）。
 *
 * 2 つを持つ。
 *
 * - **縦線**: 行番号の横の細い溝に、カーソル位置の文が占める行だけ縦線を引く。
 *   常に出す。
 * - **光らせる**: 実行した瞬間に、流した文の行を一瞬だけ塗って消す。
 *
 * どちらも「どの文か」を自分で決めない。縦線は実行と同じ `pickStatementAt` で
 * 選び、光らせる範囲は仲介者が実際に流すと決めた文（`RunTarget`）をそのまま
 * 受け取る。
 */

import type { EditorState, Extension, Text, Transaction } from '@codemirror/state'
import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state'
import type { DecorationSet, PluginValue, ViewUpdate } from '@codemirror/view'
import { Decoration, EditorView, GutterMarker, ViewPlugin, gutter } from '@codemirror/view'
import type { RunTarget } from '../../sql/runTarget'
import type { SqlStatement } from '../../sql/statements'
import { pickStatementAt, splitStatements } from '../../sql/statements'

/** 光らせておく時間（ミリ秒）。テーマのアニメーションの長さと揃える。 */
export const FLASH_DURATION_MS = 600

/**
 * 打鍵のたびに切り出し直してよい本文の長さ（文字数）。
 *
 * 切り出しは 1 文字あたりおよそ 150ns かかる（36 万文字で約 50ms を実測）。
 * この長さなら 1 回が 1 フレーム（16ms）の半分ほどに収まる。
 */
export const SYNC_SPLIT_LIMIT = 50_000

/** これより長い本文で、打鍵が止んでから切り出し直すまでの待ち（ミリ秒）。 */
export const DEFERRED_SPLIT_DELAY_MS = 200

/** 文書の中の範囲。 */
export interface OffsetRange {
  from: number
  to: number
}

/** 縦線の行が文の中のどこに当たるか。端を丸めるために分ける。 */
type LinePlace = 'only' | 'first' | 'middle' | 'last'

/**
 * 文が占める行の番号（1 始まり、両端を含む）。
 *
 * @param doc 文書
 * @param range 文の範囲
 */
export function lineSpan(doc: Text, range: OffsetRange): { first: number; last: number } {
  return { first: doc.lineAt(range.from).number, last: doc.lineAt(range.to).number }
}

/**
 * `RunTarget` の文を文書の中の範囲へ直す。
 *
 * 選択範囲から切り出した文は選択の先頭から数えた位置を持つ（`runTargetOf`）。
 * 選択を知っているのはエディタだけなので、ここで本文の位置へ足し戻す。
 * 文書からはみ出す範囲（押した後に本文が縮んだなど）は切り詰める。
 *
 * @param target 流した文
 * @param selectionFrom 今の選択の先頭
 * @param length 文書の長さ
 */
export function targetRanges(
  target: RunTarget,
  selectionFrom: number,
  length: number,
): OffsetRange[] {
  const base = target.origin === 'selection' ? selectionFrom : 0
  return target.statements
    .map((statement) => ({
      from: Math.min(length, base + statement.start),
      to: Math.min(length, base + statement.end),
    }))
    .filter((range) => range.from <= range.to)
}

/** 打鍵が止んだ後に切り出した結果を届ける。 */
const setStatements = StateEffect.define<SqlStatement[]>()

/**
 * 本文を切り出した結果。本文が変わった後でまだ切り出していなければ `null`。
 *
 * 本文が変わったときだけ切り出し直す。カーソルが動いただけのとき（矢印キーの
 * 打鍵）に全文を走査し直さないためである。
 *
 * 長い本文では打鍵のたびには切り出さず、`null` にして縦線を消しておく。
 * 古い結果の位置をずらして使い回す手は取らない。`'` を 1 つ打っただけで後ろの
 * 文の切れ目が全部変わりうるため、ずらした結果は実行される文と食い違う。
 * 範囲を示せない間は、嘘の範囲を示すより何も示さないほうがよい。
 */
const statementsField = StateField.define<SqlStatement[] | null>({
  create: (state) => splitStatements(state.doc.toString()),
  update: (statements, transaction) => {
    if (transaction.docChanged) {
      return transaction.state.doc.length <= SYNC_SPLIT_LIMIT
        ? splitStatements(transaction.state.doc.toString())
        : null
    }
    const delivered = transaction.effects.find((effect) => effect.is(setStatements))
    return delivered ? delivered.value : statements
  },
})

/**
 * 長い本文を、打鍵が止んでから切り出し直す。
 *
 * 時計はエディタと寿命を共にさせる。打鍵が続く間は時計を掛け直し、止んだ時点の
 * 本文を切り出す。
 */
const deferredSplit = ViewPlugin.fromClass(
  class implements PluginValue {
    private timer: ReturnType<typeof setTimeout> | null = null

    constructor(private readonly view: EditorView) {}

    update(update: ViewUpdate) {
      if (!update.docChanged || update.state.field(statementsField) !== null) {
        return
      }
      this.clear()
      this.timer = setTimeout(() => {
        this.timer = null
        this.view.dispatch({
          effects: setStatements.of(splitStatements(this.view.state.doc.toString())),
        })
      }, DEFERRED_SPLIT_DELAY_MS)
    }

    destroy() {
      this.clear()
    }

    private clear() {
      if (this.timer !== null) {
        clearTimeout(this.timer)
        this.timer = null
      }
    }
  },
)

/**
 * `⌘⏎` で流れる文。実行側（`runTargetOf` の `statement`）と同じ選び方をする。
 *
 * カーソルとして仲介者へ渡る `offset` は選択の `head` なので、ここも `head` を見る。
 * 長い本文をまだ切り出し直していない間は `null`（`statementsField`）。
 *
 * @param state エディタの状態
 */
export function currentStatement(state: EditorState): SqlStatement | null {
  const statements = state.field(statementsField)
  return statements === null ? null : pickStatementAt(statements, state.selection.main.head)
}

/** 状態ごとの縦線の行。見える行の数だけ `lineMarker` が呼ばれるため、1 度だけ求める。 */
const spans = new WeakMap<EditorState, { first: number; last: number } | null>()

/**
 * 縦線を引く行。引かないなら `null`。
 *
 * @param state エディタの状態
 */
function currentSpan(state: EditorState): { first: number; last: number } | null {
  if (!spans.has(state)) {
    const statement = currentStatement(state)
    spans.set(
      state,
      statement ? lineSpan(state.doc, { from: statement.start, to: statement.end }) : null,
    )
  }
  return spans.get(state) ?? null
}

/** 縦線の 1 行ぶん。端かどうかだけを持つ。 */
class RangeMarker extends GutterMarker {
  readonly elementClass: string

  constructor(readonly place: LinePlace) {
    super()
    this.elementClass = `cm-runRange cm-runRange-${place}`
  }

  eq(other: GutterMarker): boolean {
    return other instanceof RangeMarker && other.place === this.place
  }
}

const MARKERS: Record<LinePlace, RangeMarker> = {
  only: new RangeMarker('only'),
  first: new RangeMarker('first'),
  middle: new RangeMarker('middle'),
  last: new RangeMarker('last'),
}

/**
 * 行が文のどこに当たるか。文の外なら `null`。
 *
 * @param line 行番号
 * @param span 文が占める行
 */
export function linePlace(line: number, span: { first: number; last: number }): LinePlace | null {
  if (line < span.first || line > span.last) {
    return null
  }
  if (span.first === span.last) {
    return 'only'
  }
  if (line === span.first) {
    return 'first'
  }
  return line === span.last ? 'last' : 'middle'
}

/**
 * 縦線の溝。
 *
 * 行ごとの印を `lineMarker` で見える行の分だけ作る。印の集合を状態として
 * 持つと、長い PL/SQL の中でカーソルを動かすたびに数千行ぶんを組み直す。
 */
const rangeGutter = gutter({
  class: 'cm-runRangeGutter',
  lineMarker: (view, line) => {
    const span = currentSpan(view.state)
    const place = span === null ? null : linePlace(view.state.doc.lineAt(line.from).number, span)
    return place === null ? null : MARKERS[place]
  },
  lineMarkerChange: (update) =>
    update.docChanged ||
    update.selectionSet ||
    update.startState.field(statementsField) !== update.state.field(statementsField),
})

/** 光らせる行を差し替える。`null` で消す。 */
const setFlash = StateEffect.define<OffsetRange[] | null>()

/**
 * 光らせる行の飾り。2 つを交互に使う。
 *
 * 同じ文を続けて流したとき、同じ class を付け直してもブラウザは
 * アニメーションを頭から走らせない（名前が変わらないため）。交互の class に
 * 別の名前のアニメーションを当て、押すたびに必ず頭から光らせる。
 */
const FLASH_LINES = [
  Decoration.line({ class: 'cm-runFlash cm-runFlash-a' }),
  Decoration.line({ class: 'cm-runFlash cm-runFlash-b' }),
] as const

/** 光らせている行と、次に使う飾りの番。 */
interface FlashState {
  decorations: DecorationSet
  parity: 0 | 1
}

/**
 * 範囲が占める行の飾りを作る。
 *
 * 行を単位にするのは、縦線と同じ粒度で見せるためと、文字だけを塗ると行の
 * 高さ 1.7 の余りが行と行の間のすき間として残るためである（issue #54 と同じ）。
 *
 * @param doc 文書
 * @param ranges 光らせる範囲
 * @param flashLine 付ける飾り
 */
function flashDecorations(doc: Text, ranges: OffsetRange[], flashLine: Decoration): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  // 範囲は切り出した順（位置の昇順）に並ぶ。1 行に 2 つの文が載っていても
  // 同じ行へ 2 度付けないよう、付け終えた行の次から数える。
  let lastLine = 0
  for (const range of ranges) {
    const { first, last } = lineSpan(doc, range)
    for (let line = Math.max(first, lastLine + 1); line <= last; line += 1) {
      const from = doc.line(line).from
      builder.add(from, from, flashLine)
    }
    lastLine = Math.max(lastLine, last)
  }
  return builder.finish()
}

const flashField = StateField.define<FlashState>({
  create: () => ({ decorations: Decoration.none, parity: 0 }),
  update: (flash, transaction: Transaction) => {
    let next: FlashState = { ...flash, decorations: flash.decorations.map(transaction.changes) }
    for (const effect of transaction.effects) {
      if (!effect.is(setFlash)) {
        continue
      }
      next =
        effect.value === null
          ? { ...next, decorations: Decoration.none }
          : {
              decorations: flashDecorations(
                transaction.state.doc,
                effect.value,
                FLASH_LINES[next.parity],
              ),
              parity: next.parity === 0 ? 1 : 0,
            }
    }
    return next
  },
  provide: (field) => EditorView.decorations.from(field, (flash) => flash.decorations),
})

/**
 * 光らせた行を時間が来たら消す。
 *
 * 時計はエディタと寿命を共にさせる（タブを閉じてエディタが消えた後に
 * `dispatch` しない）。続けて押したときは前の時計を捨て、新しい光を最後まで
 * 見せる。
 */
const flashTimer = ViewPlugin.fromClass(
  class implements PluginValue {
    private timer: ReturnType<typeof setTimeout> | null = null

    constructor(private readonly view: EditorView) {}

    update(update: ViewUpdate) {
      const flashed = update.transactions.some((transaction) =>
        transaction.effects.some((effect) => effect.is(setFlash) && effect.value !== null),
      )
      if (!flashed) {
        return
      }
      this.clear()
      this.timer = setTimeout(() => {
        this.timer = null
        this.view.dispatch({ effects: setFlash.of(null) })
      }, FLASH_DURATION_MS)
    }

    destroy() {
      this.clear()
    }

    private clear() {
      if (this.timer !== null) {
        clearTimeout(this.timer)
        this.timer = null
      }
    }
  },
)

/**
 * 流した文を一瞬光らせる。
 *
 * @param view エディタ
 * @param target 仲介者が流すと決めた文
 */
export function flashRunTarget(view: EditorView, target: RunTarget): void {
  const ranges = targetRanges(target, view.state.selection.main.from, view.state.doc.length)
  if (ranges.length === 0) {
    return
  }
  view.dispatch({ effects: setFlash.of(ranges) })
}

/** 範囲の表示一式。`SqlEditor` の拡張へ行番号の直後に置く。 */
export const statementRange: Extension = [
  statementsField,
  deferredSplit,
  rangeGutter,
  flashField,
  flashTimer,
]
