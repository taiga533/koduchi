/**
 * `⌘⏎` で流れる文の範囲の表示（ADR 0047）。
 *
 * 縦線が示す文と実際に流れる文（`runTargetOf`）が食い違わないこと、書きかけの
 * 壊れた SQL の上でも例外を出さないこと、光らせた行が時間で消えることを見張る。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorSelection, EditorState, Text } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { runTargetOf } from '../../sql/runTarget'
import {
  DEFERRED_SPLIT_DELAY_MS,
  FLASH_DURATION_MS,
  SYNC_SPLIT_LIMIT,
  currentStatement,
  flashRunTarget,
  linePlace,
  lineSpan,
  statementRange,
  targetRanges,
} from './statementRange'

/** 開いたエディタ。後片付けのために控える。 */
let opened: EditorView[] = []

/**
 * 範囲の表示を載せたエディタを開く。
 *
 * @param doc 本文
 * @param selection 選択（省けば先頭）
 */
function エディタ(doc: string, selection?: EditorSelection): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const view = new EditorView({
    state: EditorState.create({ doc, selection, extensions: [lineNumbers(), statementRange] }),
    parent,
  })
  opened.push(view)
  return view
}

afterEach(() => {
  for (const view of opened) {
    view.dom.parentElement?.remove()
    view.destroy()
  }
  opened = []
  vi.useRealTimers()
})

/** 縦線の付いた溝の要素の class の並び。 */
function 縦線(view: EditorView): string[] {
  return Array.from(view.dom.querySelectorAll('.cm-runRangeGutter .cm-runRange')).map((element) =>
    element.className.replace(/.*cm-runRange-/, ''),
  )
}

const 三つの文 = 'select 1\nfrom dual;\n\nbegin\n  null;\nend;\nselect 3 from dual'

describe('currentStatement', () => {
  it('どの位置でも実行側の runTargetOf と同じ文を選ぶ', () => {
    // Arrange
    const 位置 = Array.from({ length: 三つの文.length + 1 }, (_, index) => index)

    // Act
    const 縦線の文 = 位置.map((offset) =>
      currentStatement(
        EditorState.create({
          doc: 三つの文,
          selection: { anchor: offset },
          extensions: statementRange,
        }),
      ),
    )

    // Assert
    const 流れる文 = 位置.map(
      (offset) =>
        runTargetOf('statement', 三つの文, { offset, selectedText: null }).statements[0] ?? null,
    )
    expect(縦線の文).toEqual(流れる文)
  })

  it('選択があるときは head の位置の文を選ぶ（仲介者へ渡る offset と同じ）', () => {
    // Arrange
    const state = EditorState.create({
      doc: 三つの文,
      selection: { anchor: 0, head: 三つの文.length },
      extensions: statementRange,
    })

    // Act
    const statement = currentStatement(state)

    // Assert
    expect(statement?.text).toBe('select 3 from dual')
  })

  it('本文を書き換えると切り出し直す', () => {
    // Arrange
    const state = EditorState.create({ doc: 'select 1 from dual', extensions: statementRange })

    // Act
    const next = state.update({
      changes: { from: 0, insert: 'select 0 from dual;\n' },
      selection: { anchor: 0 },
    }).state

    // Assert
    expect(currentStatement(next)?.text).toBe('select 0 from dual')
  })

  it('文が無い本文では null を返す', () => {
    // Arrange
    const state = EditorState.create({ doc: '  -- メモだけ\n', extensions: statementRange })

    // Act
    const statement = currentStatement(state)

    // Assert
    expect(statement).toBeNull()
  })

  it('1 文字ずつ打ち進めた書きかけの SQL のどこでも例外を出さない', () => {
    // Arrange
    const 打つ文 =
      "create or replace procedure p is begin if x then q'[a;b]' ; end if; end;\n/* c ; */ select 'x;y' from dual; --"
    let state = EditorState.create({ doc: '', extensions: statementRange })

    // Act
    const 打つ = () => {
      for (const character of 打つ文) {
        state = state.update({
          changes: { from: state.doc.length, insert: character },
          selection: { anchor: state.doc.length + 1 },
        }).state
        currentStatement(state)
      }
    }

    // Assert
    expect(打つ).not.toThrow()
    expect(state.doc.toString()).toBe(打つ文)
  })
})

describe('linePlace', () => {
  it.each([
    [1, { first: 2, last: 4 }, null],
    [2, { first: 2, last: 4 }, 'first'],
    [3, { first: 2, last: 4 }, 'middle'],
    [4, { first: 2, last: 4 }, 'last'],
    [5, { first: 2, last: 4 }, null],
    [3, { first: 3, last: 3 }, 'only'],
  ] as const)('%i 行目は %o の中で %s に当たる', (line, span, place) => {
    // Arrange & Act
    const result = linePlace(line, span)

    // Assert
    expect(result).toBe(place)
  })
})

describe('lineSpan', () => {
  it('範囲の両端が入る行の番号を返す', () => {
    // Arrange
    const doc = Text.of(['a', 'bb', 'ccc'])

    // Act
    const span = lineSpan(doc, { from: 2, to: 6 })

    // Assert
    expect(span).toEqual({ first: 2, last: 3 })
  })
})

describe('targetRanges', () => {
  it('選択から切り出した文は選択の先頭を足して本文の位置へ直す', () => {
    // Arrange
    const target = runTargetOf('selection', '', {
      offset: 0,
      selectedText: ' select 1 from dual;',
    })

    // Act
    const ranges = targetRanges(target, 10, 100)

    // Assert
    expect(ranges).toEqual([{ from: 11, to: 29 }])
  })

  it('本文から切り出した文はそのままの位置を使う', () => {
    // Arrange
    const target = runTargetOf('script', 'select 1; select 2', { offset: 0, selectedText: null })

    // Act
    const ranges = targetRanges(target, 5, 100)

    // Assert
    expect(ranges).toEqual([
      { from: 0, to: 8 },
      { from: 10, to: 18 },
    ])
  })

  it('文書からはみ出す位置は文書の長さで切り詰める', () => {
    // Arrange
    const target = runTargetOf('script', 'select 1; select 2', { offset: 0, selectedText: null })

    // Act
    const ranges = targetRanges(target, 0, 12)

    // Assert
    expect(ranges).toEqual([
      { from: 0, to: 8 },
      { from: 10, to: 12 },
    ])
  })
})

describe('縦線', () => {
  it('カーソル位置の文が占める行にだけ引き、端を見分ける', () => {
    // Arrange
    const view = エディタ(三つの文, EditorSelection.single(三つの文.indexOf('null')))

    // Act
    const lines = 縦線(view)

    // Assert
    expect(lines).toEqual(['first', 'middle', 'last'])
  })

  it('カーソルを動かすと引き直す', () => {
    // Arrange
    const view = エディタ(三つの文)

    // Act
    view.dispatch({ selection: { anchor: 三つの文.length } })

    // Assert
    expect(縦線(view)).toEqual(['only'])
  })

  it('文が無い本文には引かない', () => {
    // Arrange & Act
    const view = エディタ('\n-- メモ\n')

    // Assert
    expect(縦線(view)).toEqual([])
  })
})

describe('flashRunTarget', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('流した文の行を光らせ、時間が来たら消す', () => {
    // Arrange
    const view = エディタ(三つの文)
    const target = runTargetOf('statement', 三つの文, {
      offset: 三つの文.indexOf('null'),
      selectedText: null,
    })

    // Act
    flashRunTarget(view, target)
    const 光った行 = view.dom.querySelectorAll('.cm-runFlash').length
    vi.advanceTimersByTime(FLASH_DURATION_MS)

    // Assert
    expect(光った行).toBe(3)
    expect(view.dom.querySelectorAll('.cm-runFlash')).toHaveLength(0)
  })

  it('スクリプト実行ではすべての文の行を光らせる', () => {
    // Arrange
    const view = エディタ(三つの文)
    const target = runTargetOf('script', 三つの文, { offset: 0, selectedText: null })

    // Act
    flashRunTarget(view, target)

    // Assert（空行の 3 行目は文に含まれない）
    expect(view.dom.querySelectorAll('.cm-runFlash')).toHaveLength(6)
  })

  it('選択範囲から切り出した文は選択の位置の行を光らせる', () => {
    // Arrange
    const from = 三つの文.indexOf('select 3')
    const view = エディタ(三つの文, EditorSelection.single(from, 三つの文.length))
    const target = runTargetOf('selection', 三つの文, {
      offset: 三つの文.length,
      selectedText: 三つの文.slice(from),
    })

    // Act
    flashRunTarget(view, target)

    // Assert
    const 光った行 = Array.from(view.dom.querySelectorAll('.cm-runFlash'))
    expect(光った行.map((line) => line.textContent)).toEqual(['select 3 from dual'])
  })

  it('続けて流すと別の class で付け直し、アニメーションを頭から走らせる', () => {
    // Arrange
    const view = エディタ('select 1 from dual')
    const target = runTargetOf('statement', 'select 1 from dual', { offset: 0, selectedText: null })

    // Act
    flashRunTarget(view, target)
    const 一回目 = view.dom.querySelector('.cm-runFlash')?.classList.contains('cm-runFlash-a')
    vi.advanceTimersByTime(FLASH_DURATION_MS / 2)
    flashRunTarget(view, target)
    const 二回目 = view.dom.querySelector('.cm-runFlash')?.classList.contains('cm-runFlash-b')
    vi.advanceTimersByTime(FLASH_DURATION_MS / 2)
    const 途中 = view.dom.querySelectorAll('.cm-runFlash').length

    // Assert（2 回目の光は 1 回目の時計で消されない）
    expect(一回目).toBe(true)
    expect(二回目).toBe(true)
    expect(途中).toBe(1)
  })

  it('対象が無ければ何も光らせない', () => {
    // Arrange
    const view = エディタ('select 1 from dual')

    // Act
    flashRunTarget(view, { origin: 'document', statements: [] })

    // Assert
    expect(view.dom.querySelectorAll('.cm-runFlash')).toHaveLength(0)
  })

  it('光っている間にエディタを閉じても時計が後から dispatch しない', () => {
    // Arrange
    const view = エディタ('select 1 from dual')
    flashRunTarget(
      view,
      runTargetOf('statement', 'select 1 from dual', { offset: 0, selectedText: null }),
    )
    const dispatch = vi.spyOn(view, 'dispatch')

    // Act
    view.destroy()
    vi.advanceTimersByTime(FLASH_DURATION_MS)

    // Assert
    expect(dispatch).not.toHaveBeenCalled()
  })
})

describe('長い本文', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  /** 打鍵のたびには切り出さない長さの本文。 */
  const 長い本文 = 'select 1 from dual;\n'.repeat(Math.ceil(SYNC_SPLIT_LIMIT / 20) + 1)

  it('打鍵の間は縦線を消し、打鍵が止んでから引き直す', () => {
    // Arrange
    const view = エディタ(長い本文)
    const 打つ前 = 縦線(view)

    // Act
    view.dispatch({ changes: { from: 0, insert: 'x' } })
    const 打鍵の直後 = 縦線(view)
    vi.advanceTimersByTime(DEFERRED_SPLIT_DELAY_MS)
    const 止んだ後 = 縦線(view)

    // Assert
    expect(打つ前).toEqual(['only'])
    expect(打鍵の直後).toEqual([])
    expect(止んだ後).toEqual(['only'])
  })

  it('打鍵が止んだ後に選ぶ文は実行側と同じである', () => {
    // Arrange
    const view = エディタ(長い本文)

    // Act
    view.dispatch({ changes: { from: 0, insert: "select 'a;b' from dual;\n" } })
    vi.advanceTimersByTime(DEFERRED_SPLIT_DELAY_MS)

    // Assert
    const doc = view.state.doc.toString()
    expect(currentStatement(view.state)).toEqual(
      runTargetOf('statement', doc, { offset: view.state.selection.main.head, selectedText: null })
        .statements[0],
    )
  })

  it('打鍵が止む前にエディタを閉じても時計が後から dispatch しない', () => {
    // Arrange
    const view = エディタ(長い本文)
    view.dispatch({ changes: { from: 0, insert: 'x' } })
    const dispatch = vi.spyOn(view, 'dispatch')

    // Act
    view.destroy()
    vi.advanceTimersByTime(DEFERRED_SPLIT_DELAY_MS)

    // Assert
    expect(dispatch).not.toHaveBeenCalled()
  })
})

describe('1 行に複数の文', () => {
  it('同じ行に載った文を続けて光らせても行は 1 度だけ塗る', () => {
    // Arrange
    const doc = 'select 1 from dual; select 2 from dual;\nselect 3 from dual'
    const view = エディタ(doc)
    const target = runTargetOf('script', doc, { offset: 0, selectedText: null })

    // Act
    flashRunTarget(view, target)

    // Assert
    expect(view.dom.querySelectorAll('.cm-runFlash')).toHaveLength(2)
  })
})
