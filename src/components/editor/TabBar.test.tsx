/**
 * エディタタブの帯のテスト（ADR 0005・0022・0023）。
 *
 * 未保存の印と閉じるボタンが同時に出ること（ADR 0023 が直したバグ）、ドラッグと
 * `⌥←` / `⌥→` による並べ替え、そして SQL タブと定義タブが 1 本の並びに混ざった
 * ときの描き分け（ADR 0022）を見る。
 *
 * 枚数が増えたときにあふれない器であることも見る。jsdom はレイアウトを行わない
 * ため「はみ出す」ことそのものは確かめられないが、**あふれを収める仕掛けが
 * 繋がっていること**は確かめられる。見張るのは 3 つで、いずれもクラス名では
 * なく振る舞いと組み立てである。
 *
 * - `＋` ボタンがスクロールする器の**外**に居ること（流されない）
 * - 省いた名前を `title` で読めること
 * - 選んだタブが帯の外に居れば送られ、**掴んでいる間は送られない**こと
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TabBar } from './TabBar'
import type { EditorTab, SqlTab } from '../../stores/tab'
import { resetUntitledCounter, useTabStore } from '../../stores/tab'

/** 出荷表の定義タブ 1 枚（ADR 0022）。 */
const 出荷の定義タブ: EditorTab = {
  kind: 'definition',
  id: 'd1',
  name: 'SHIPMENTS',
  target: { owner: 'KODUCHI', name: 'SHIPMENTS', kind: 'table' },
}

beforeEach(() => {
  resetUntitledCounter()
  useTabStore.setState({ tabs: [], activeTabId: null, bindValues: {} })
  useTabStore.getState().openNewTab()
})

/**
 * 並びの n 枚目を SQL タブとして取り出す。
 *
 * 並びには定義タブも混ざりうるため（ADR 0022）、未保存の印を見るテストでは
 * ここを通す。
 *
 * @param index 並びの位置
 */
function sqlTabAt(index: number): SqlTab {
  const tab = useTabStore.getState().tabs[index]
  if (tab.kind !== 'sql') {
    throw new Error(`${index} 枚目は SQL タブではない`)
  }
  return tab
}

/**
 * タブの並びを据える。定義タブを混ぜたいテストで使う。
 *
 * @param tabs 並べるタブ
 * @param activeTabId 選択するタブ
 */
function タブを据える(tabs: EditorTab[], activeTabId: string): void {
  useTabStore.setState({ tabs, activeTabId, bindValues: {} })
}

/**
 * SQL タブを 1 枚作る。
 *
 * @param id タブの識別子
 * @param overrides 上書きしたい項目
 */
function SQLタブ(id: string, overrides: Partial<SqlTab> = {}): SqlTab {
  return {
    kind: 'sql',
    id,
    name: `${id}.sql`,
    filePath: null,
    content: '',
    dirty: false,
    ...overrides,
  }
}

/**
 * タブに横位置を持たせる。
 *
 * jsdom はレイアウトを行わず `getBoundingClientRect` が常に 0 を返すため、
 * 並べ替えの判定に必要な横位置だけを与える。幅 100px のタブを 4px の間隔で
 * 並べた形にする（中心は 50 / 154 / 258 …）。
 */
function 横位置を与える(): void {
  const 要素 = Array.from(document.querySelectorAll<HTMLElement>('[data-tab-id]'))
  要素.forEach((element, index) => {
    const left = index * 104
    element.getBoundingClientRect = () =>
      ({
        left,
        right: left + 100,
        width: 100,
        top: 0,
        bottom: 34,
        height: 34,
        x: left,
        y: 0,
      }) as DOMRect
  })
}

/** タブの器（ポインタ操作を受ける要素）を名前から引く。 */
function タブの器(name: string): HTMLElement {
  const button = screen.getByRole('button', { name })
  const container = button.closest('[data-tab-id]')
  if (!container) {
    throw new Error(`タブ ${name} が見つからない`)
  }
  return container as HTMLElement
}

/** 今の並びのタブ名を返す。 */
function 並び(): string[] {
  return useTabStore.getState().tabs.map((tab) => tab.name)
}

/** タブを掴んで指定の横位置まで動かし、離す。 */
function ドラッグする(器: HTMLElement, from: number, to: number): void {
  fireEvent.pointerDown(器, { pointerId: 1, button: 0, clientX: from })
  横位置を与える()
  fireEvent.pointerMove(器, { pointerId: 1, clientX: to })
  fireEvent.pointerUp(器, { pointerId: 1, clientX: to })
}

/**
 * 矩形を 1 つ作る。jsdom の `getBoundingClientRect` を差し替えるために使う。
 *
 * @param left 左端
 * @param width 幅
 */
function 矩形(left: number, width: number): DOMRect {
  return {
    left,
    right: left + width,
    width,
    top: 0,
    bottom: 34,
    height: 34,
    x: left,
    y: 0,
  } as DOMRect
}

/** タブの並びを収める、横へスクロールする器を返す。 */
function タブ帯(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-tab-scroller]')
  if (!element) {
    throw new Error('タブ帯が見つからない')
  }
  return element
}

/**
 * 今の並び順のとおりにタブの横位置を割り当てる。
 *
 * 幅 100px のタブを 4px の間隔で並べ、帯を `送り量` だけ送った状態にあたる
 * 横位置（`clientX` と同じ座標系）を与える。
 *
 * @param 送り量 帯の送り量（px）
 */
function 並びの横位置を与える(送り量: number): void {
  for (const [index, tab] of useTabStore.getState().tabs.entries()) {
    const element = document.querySelector<HTMLElement>(`[data-tab-id="${tab.id}"]`)
    if (element) {
      const rect = 矩形(index * 104 - 送り量, 100)
      element.getBoundingClientRect = () => rect
    }
  }
}

/**
 * 帯とタブに寸法を与える。
 *
 * jsdom はレイアウトを行わないため、横スクロールの判定に要る寸法だけを与える。
 * 帯の左端は 0 に置く。
 *
 * @param 幅 帯の見えている幅（px）
 * @param 送り量 帯の送り量（px）
 */
function 帯の寸法を与える(幅: number, 送り量: number): HTMLElement {
  const 帯 = タブ帯()
  const rect = 矩形(0, 幅)
  帯.getBoundingClientRect = () => rect
  帯.scrollLeft = 送り量
  並びの横位置を与える(送り量)
  return 帯
}

/** タブを 3 枚にし、名前を打ち直して見分けられるようにする。 */
function 三枚開く(): void {
  useTabStore.getState().openNewTab()
  useTabStore.getState().openNewTab()
}

describe('TabBar', () => {
  it('未保存のタブにも閉じるボタンが出る', () => {
    // Arrange: 起動直後のタブに何か打つと未保存になる
    const tab = useTabStore.getState().tabs[0]
    useTabStore.getState().updateContent(tab.id, 'select 1 from dual')
    expect(sqlTabAt(0).dirty).toBe(true)

    // Act
    render(<TabBar onCloseTab={vi.fn()} />)

    // Assert
    expect(screen.getByRole('button', { name: '無題-1.sql を閉じる' })).toBeInTheDocument()
  })

  it('未保存のタブの閉じるボタンを押すと閉じる要求が届く', () => {
    // Arrange
    const tab = useTabStore.getState().tabs[0]
    useTabStore.getState().updateContent(tab.id, 'select 1 from dual')
    const onCloseTab = vi.fn()
    render(<TabBar onCloseTab={onCloseTab} />)

    // Act
    fireEvent.click(screen.getByRole('button', { name: '無題-1.sql を閉じる' }))

    // Assert
    expect(onCloseTab).toHaveBeenCalledWith(tab.id)
  })

  it('未保存のタブには印と閉じるボタンが両方出る', () => {
    // Arrange
    const tab = useTabStore.getState().tabs[0]
    useTabStore.getState().updateContent(tab.id, 'select 1 from dual')

    // Act
    render(<TabBar onCloseTab={vi.fn()} />)

    // Assert
    expect(screen.getByRole('img', { name: '未保存' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '無題-1.sql を閉じる' })).toBeInTheDocument()
  })

  it('保存済みのタブには印が出ず閉じるボタンだけが出る', () => {
    // Arrange
    // beforeEach で開いた 1 枚は未保存ではない

    // Act
    render(<TabBar onCloseTab={vi.fn()} />)

    // Assert
    expect(screen.queryByRole('img', { name: '未保存' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '無題-1.sql を閉じる' })).toBeInTheDocument()
  })

  it('`dirty` を持たないタブにも閉じるボタンが出る', () => {
    // Arrange: ADR 0023 が見越していた「`dirty` を持たないタブ」は、
    // ADR 0022 の定義タブとして実際に並びへ入った
    タブを据える([出荷の定義タブ], 'd1')

    // Act
    render(<TabBar onCloseTab={vi.fn()} />)

    // Assert
    expect(screen.getByRole('button', { name: 'SHIPMENTS を閉じる' })).toBeInTheDocument()
  })

  it('タブの名前を押すとそのタブが選ばれる', () => {
    // Arrange
    三枚開く()
    render(<TabBar onCloseTab={vi.fn()} />)
    const 一枚目 = useTabStore.getState().tabs[0]

    // Act
    fireEvent.click(screen.getByRole('button', { name: '無題-1.sql' }))

    // Assert
    expect(useTabStore.getState().activeTabId).toBe(一枚目.id)
  })

  it('掴んだタブは押し下げた時点で選ばれる', () => {
    // Arrange
    三枚開く()
    render(<TabBar onCloseTab={vi.fn()} />)
    const 一枚目 = useTabStore.getState().tabs[0]

    // Act
    fireEvent.pointerDown(タブの器('無題-1.sql'), { pointerId: 1, button: 0, clientX: 50 })

    // Assert
    expect(useTabStore.getState().activeTabId).toBe(一枚目.id)
  })

  it('タブを右へドラッグすると並びが入れ替わる', () => {
    // Arrange
    三枚開く()
    render(<TabBar onCloseTab={vi.fn()} />)

    // Act: 1 枚目を 2 枚目の中心（154）より右へ動かす
    ドラッグする(タブの器('無題-1.sql'), 50, 160)

    // Assert
    expect(並び()).toEqual(['無題-2.sql', '無題-1.sql', '無題-3.sql'])
  })

  it('タブを左端へドラッグすると先頭へ来る', () => {
    // Arrange
    三枚開く()
    render(<TabBar onCloseTab={vi.fn()} />)

    // Act
    ドラッグする(タブの器('無題-3.sql'), 258, -100)

    // Assert
    expect(並び()).toEqual(['無題-3.sql', '無題-1.sql', '無題-2.sql'])
  })

  it('しきい値より小さい動きでは並べ替えない', () => {
    // Arrange
    三枚開く()
    render(<TabBar onCloseTab={vi.fn()} />)

    // Act
    ドラッグする(タブの器('無題-1.sql'), 50, 52)

    // Assert
    expect(並び()).toEqual(['無題-1.sql', '無題-2.sql', '無題-3.sql'])
  })

  it('離した後の動きは並びを変えない', () => {
    // Arrange
    三枚開く()
    render(<TabBar onCloseTab={vi.fn()} />)
    const 器 = タブの器('無題-1.sql')
    ドラッグする(器, 50, 160)

    // Act
    fireEvent.pointerMove(器, { pointerId: 1, clientX: 400 })

    // Assert
    expect(並び()).toEqual(['無題-2.sql', '無題-1.sql', '無題-3.sql'])
  })

  it('閉じるボタンの上から始めた動きでは並べ替えない', () => {
    // Arrange
    三枚開く()
    render(<TabBar onCloseTab={vi.fn()} />)
    const 器 = タブの器('無題-1.sql')
    const 閉じる = screen.getByRole('button', { name: '無題-1.sql を閉じる' })

    // Act: 閉じるボタンの上で押し下げると、器へは伝わるが掴みは始まらない
    fireEvent.pointerDown(閉じる, { pointerId: 1, button: 0, clientX: 50 })
    横位置を与える()
    fireEvent.pointerMove(器, { pointerId: 1, clientX: 400 })

    // Assert
    expect(並び()).toEqual(['無題-1.sql', '無題-2.sql', '無題-3.sql'])
  })

  it('左ボタン以外ではドラッグを始めない', () => {
    // Arrange
    三枚開く()
    render(<TabBar onCloseTab={vi.fn()} />)
    const 器 = タブの器('無題-1.sql')

    // Act
    fireEvent.pointerDown(器, { pointerId: 2, button: 2, clientX: 50 })
    横位置を与える()
    fireEvent.pointerMove(器, { pointerId: 2, clientX: 400 })

    // Assert
    expect(並び()).toEqual(['無題-1.sql', '無題-2.sql', '無題-3.sql'])
  })

  it('ドラッグ中は本文の選択が止まり、離すと戻る', () => {
    // Arrange
    三枚開く()
    render(<TabBar onCloseTab={vi.fn()} />)
    const 器 = タブの器('無題-1.sql')

    // Act
    fireEvent.pointerDown(器, { pointerId: 1, button: 0, clientX: 50 })
    横位置を与える()
    fireEvent.pointerMove(器, { pointerId: 1, clientX: 160 })
    const ドラッグ中 = document.body.style.userSelect
    fireEvent.pointerUp(器, { pointerId: 1, clientX: 160 })

    // Assert
    expect(ドラッグ中).toBe('none')
    expect(document.body.style.userSelect).toBe('')
  })

  it('⌥→ でタブが 1 つ後ろへ動く', () => {
    // Arrange
    三枚開く()
    render(<TabBar onCloseTab={vi.fn()} />)

    // Act
    fireEvent.keyDown(タブの器('無題-1.sql'), { key: 'ArrowRight', altKey: true })

    // Assert
    expect(並び()).toEqual(['無題-2.sql', '無題-1.sql', '無題-3.sql'])
  })

  it('⌥← でタブが 1 つ前へ動く', () => {
    // Arrange
    三枚開く()
    render(<TabBar onCloseTab={vi.fn()} />)

    // Act
    fireEvent.keyDown(タブの器('無題-3.sql'), { key: 'ArrowLeft', altKey: true })

    // Assert
    expect(並び()).toEqual(['無題-1.sql', '無題-3.sql', '無題-2.sql'])
  })

  it('端のタブは ⌥ の矢印でも外へ出ない', () => {
    // Arrange
    三枚開く()
    render(<TabBar onCloseTab={vi.fn()} />)

    // Act
    fireEvent.keyDown(タブの器('無題-1.sql'), { key: 'ArrowLeft', altKey: true })

    // Assert
    expect(並び()).toEqual(['無題-1.sql', '無題-2.sql', '無題-3.sql'])
  })

  it('⌥ を伴わない矢印キーでは並べ替えない', () => {
    // Arrange
    三枚開く()
    render(<TabBar onCloseTab={vi.fn()} />)

    // Act
    fireEvent.keyDown(タブの器('無題-1.sql'), { key: 'ArrowRight' })

    // Assert
    expect(並び()).toEqual(['無題-1.sql', '無題-2.sql', '無題-3.sql'])
  })

  it('新しいタブのボタンでタブが増える', () => {
    // Arrange
    render(<TabBar onCloseTab={vi.fn()} />)

    // Act
    fireEvent.click(screen.getByRole('button', { name: '新しいタブ' }))

    // Assert
    expect(並び()).toEqual(['無題-1.sql', '無題-2.sql'])
  })
})

/**
 * 定義タブの描き分けと、並べ替えの対象になること（ADR 0022・0023）。
 */
describe('TabBar の定義タブ', () => {
  it('SQL タブと定義タブが 1 本の並びに混ざる', () => {
    // Arrange
    タブを据える([SQLタブ('t1'), 出荷の定義タブ, SQLタブ('t2')], 't1')

    // Act
    render(<TabBar onCloseTab={vi.fn()} />)

    // Assert
    expect(screen.getByRole('button', { name: 't1.sql' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'SHIPMENTS の定義' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 't2.sql' })).toBeInTheDocument()
  })

  it('定義タブには未保存の印を出さず、閉じるボタンだけを出す', () => {
    // Arrange: 定義タブは編集できず、未保存になりようがない（ADR 0022）
    タブを据える([出荷の定義タブ], 'd1')

    // Act
    render(<TabBar onCloseTab={vi.fn()} />)

    // Assert
    expect(screen.queryByRole('img', { name: '未保存' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'SHIPMENTS を閉じる' })).toBeInTheDocument()
  })

  it('未保存の SQL タブの印は定義タブと同じ側に出ても食い合わない', () => {
    // Arrange: `●` 印も定義タブのアイコンも名前の左に出る（ADR 0022・0023）
    タブを据える([SQLタブ('t1', { dirty: true }), 出荷の定義タブ], 't1')

    // Act
    render(<TabBar onCloseTab={vi.fn()} />)

    // Assert
    expect(screen.getByRole('img', { name: '未保存' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 't1.sql を閉じる' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'SHIPMENTS の定義' })).toBeInTheDocument()
  })

  it('定義タブを押すとそのタブが選ばれる', async () => {
    // Arrange
    タブを据える([SQLタブ('t1'), 出荷の定義タブ], 't1')
    render(<TabBar onCloseTab={vi.fn()} />)

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'SHIPMENTS の定義' }))

    // Assert
    expect(useTabStore.getState().activeTabId).toBe('d1')
  })

  it('定義タブの閉じるボタンは呼び出し側へ委ねる', async () => {
    // Arrange: 結果セットの後始末が要るため、ストアを直接触らない（ADR 0003）
    const 閉じる = vi.fn()
    タブを据える([出荷の定義タブ], 'd1')
    render(<TabBar onCloseTab={閉じる} />)

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'SHIPMENTS を閉じる' }))

    // Assert
    expect(閉じる).toHaveBeenCalledWith('d1')
  })

  it('定義タブも掴んで並べ替えられる', () => {
    // Arrange: 並びは 1 本であり、並べ替えは種類を問わない（ADR 0022・0023）
    タブを据える([SQLタブ('t1'), 出荷の定義タブ, SQLタブ('t2')], 't1')
    render(<TabBar onCloseTab={vi.fn()} />)

    // Act: 定義タブ（中心 154）を 3 枚目の中心（258）より右へ動かす
    ドラッグする(タブの器('SHIPMENTS の定義'), 154, 300)

    // Assert
    expect(並び()).toEqual(['t1.sql', 't2.sql', 'SHIPMENTS'])
  })

  it('⌥← で定義タブが 1 つ前へ動く', () => {
    // Arrange
    タブを据える([SQLタブ('t1'), 出荷の定義タブ], 't1')
    render(<TabBar onCloseTab={vi.fn()} />)

    // Act
    fireEvent.keyDown(タブの器('SHIPMENTS の定義'), { key: 'ArrowLeft', altKey: true })

    // Assert
    expect(並び()).toEqual(['SHIPMENTS', 't1.sql'])
  })
})

/**
 * 枚数が増えても帯が壊れないこと。
 *
 * `＋` ボタンの居場所と、省いた名前の確かめ方を見る。
 */
describe('TabBar のあふれの収め方', () => {
  it('新しいタブのボタンはスクロールする器の外に居る', () => {
    // Arrange: 器の中に居ると、タブが増えたときに一緒に流れて押せなくなる
    三枚開く()
    render(<TabBar onCloseTab={vi.fn()} />)

    // Act
    const 追加 = screen.getByRole('button', { name: '新しいタブ' })

    // Assert
    expect(タブ帯()).toBeInTheDocument()
    expect(追加.closest('[data-tab-scroller]')).toBeNull()
  })

  it('タブはすべてスクロールする器の中に居る', () => {
    // Arrange
    三枚開く()
    render(<TabBar onCloseTab={vi.fn()} />)

    // Act
    const タブ = Array.from(document.querySelectorAll<HTMLElement>('[data-tab-id]'))

    // Assert
    expect(タブ).toHaveLength(3)
    expect(タブ.every((element) => element.closest('[data-tab-scroller]') !== null)).toBe(true)
  })

  it('省かれても読めるよう、タブは名前をそのまま `title` に持つ', () => {
    // Arrange: 長い名前は `…` で省かれる。全体を確かめる道が要る
    タブを据える([SQLタブ('とても長い名前の付いた集計クエリ')], 'とても長い名前の付いた集計クエリ')
    render(<TabBar onCloseTab={vi.fn()} />)

    // Act
    const 器 = タブの器('とても長い名前の付いた集計クエリ.sql')

    // Assert
    expect(器).toHaveAttribute('title', 'とても長い名前の付いた集計クエリ.sql')
  })

  it('定義タブも名前をそのまま `title` に持つ', () => {
    // Arrange
    タブを据える([出荷の定義タブ], 'd1')
    render(<TabBar onCloseTab={vi.fn()} />)

    // Act
    const 器 = タブの器('SHIPMENTS の定義')

    // Assert
    expect(器).toHaveAttribute('title', 'SHIPMENTS')
  })
})

/**
 * 帯の外に居るタブへの追従と、掴んでいる間の抑止。
 *
 * `⌘K` のパレットや `⌘T` で選択が飛ぶと、そのタブが帯の外に居ることが起こる。
 */
describe('TabBar の選択の追従', () => {
  it('右に隠れているタブを選ぶと帯がそこまで送られる', () => {
    // Arrange: 帯は 150px。3 枚目は 208〜308 に居て見えていない
    三枚開く()
    render(<TabBar onCloseTab={vi.fn()} />)
    const [一枚目, , 三枚目] = useTabStore.getState().tabs
    act(() => {
      useTabStore.getState().selectTab(一枚目.id)
    })
    const 帯 = 帯の寸法を与える(150, 0)

    // Act
    act(() => {
      useTabStore.getState().selectTab(三枚目.id)
    })

    // Assert
    expect(帯.scrollLeft).toBe(158)
  })

  it('左に隠れているタブを選ぶと帯が戻される', () => {
    // Arrange: 帯を 158 まで送った状態から 1 枚目を選ぶ
    三枚開く()
    render(<TabBar onCloseTab={vi.fn()} />)
    const [一枚目] = useTabStore.getState().tabs
    const 帯 = 帯の寸法を与える(150, 158)

    // Act
    act(() => {
      useTabStore.getState().selectTab(一枚目.id)
    })

    // Assert
    expect(帯.scrollLeft).toBe(0)
  })

  it('既に見えているタブを選び直しても帯は動かない', () => {
    // Arrange: 帯が 400px あれば 3 枚とも見えている
    三枚開く()
    render(<TabBar onCloseTab={vi.fn()} />)
    const [一枚目, , 三枚目] = useTabStore.getState().tabs
    act(() => {
      useTabStore.getState().selectTab(一枚目.id)
    })
    const 帯 = 帯の寸法を与える(400, 0)

    // Act
    act(() => {
      useTabStore.getState().selectTab(三枚目.id)
    })

    // Assert
    expect(帯.scrollLeft).toBe(0)
  })

  it('掴んでいる間は選択の追従で帯が動かず、離すと動かしたタブが見える位置へ来る', () => {
    // Arrange: 帯は 150px、送り量 0。1 枚目を掴んで末尾へ動かす
    三枚開く()
    render(<TabBar onCloseTab={vi.fn()} />)
    const 器 = タブの器('無題-1.sql')
    const 帯 = 帯の寸法を与える(150, 0)

    // Act
    fireEvent.pointerDown(器, { pointerId: 1, button: 0, clientX: 50 })
    fireEvent.pointerMove(器, { pointerId: 1, clientX: 300 })
    const 掴んでいる間 = 帯.scrollLeft
    // 並びが変わったぶん、位置を割り当て直す（jsdom は測り直してくれない）
    並びの横位置を与える(0)
    fireEvent.pointerUp(器, { pointerId: 1, clientX: 300 })

    // Assert
    expect(並び()).toEqual(['無題-2.sql', '無題-3.sql', '無題-1.sql'])
    expect(掴んでいる間).toBe(0)
    expect(帯.scrollLeft).toBe(158)
  })
})

/**
 * 掴んだまま端まで持っていったときに帯が送られること。
 *
 * jsdom はフレームを時間で回さないため、予約されたフレームを手で進める。
 */
describe('TabBar の端でのスクロール', () => {
  /** 予約されたフレームの表。番号で取り消せるようにしておく。 */
  let フレーム: Map<number, FrameRequestCallback>
  let 次の番号: number

  beforeEach(() => {
    フレーム = new Map()
    次の番号 = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      次の番号 += 1
      フレーム.set(次の番号, callback)
      return 次の番号
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((handle) => {
      フレーム.delete(handle)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** 予約されているフレームを 1 巡ぶん進める。 */
  function フレームを進める(): void {
    const 予約 = [...フレーム.values()]
    フレーム.clear()
    for (const callback of 予約) {
      act(() => {
        callback(0)
      })
    }
  }

  it('掴んだタブを帯の右端まで持っていくと帯が送られる', () => {
    // Arrange: 帯は 0〜150。右端の内側 24px は 126 から
    三枚開く()
    render(<TabBar onCloseTab={vi.fn()} />)
    const 器 = タブの器('無題-1.sql')
    const 帯 = 帯の寸法を与える(150, 0)

    // Act
    fireEvent.pointerDown(器, { pointerId: 1, button: 0, clientX: 50 })
    fireEvent.pointerMove(器, { pointerId: 1, clientX: 145 })
    フレームを進める()

    // Assert
    expect(帯.scrollLeft).toBe(11)
  })

  it('掴んだタブを帯の左端まで持っていくと帯が戻される', () => {
    // Arrange: 帯を 100 まで送った状態から左端へ持っていく
    三枚開く()
    render(<TabBar onCloseTab={vi.fn()} />)
    const 器 = タブの器('無題-3.sql')
    const 帯 = 帯の寸法を与える(150, 100)

    // Act
    fireEvent.pointerDown(器, { pointerId: 1, button: 0, clientX: 130 })
    fireEvent.pointerMove(器, { pointerId: 1, clientX: 5 })
    フレームを進める()

    // Assert
    expect(帯.scrollLeft).toBeLessThan(100)
  })

  it('端から離れた位置では帯を送らない', () => {
    // Arrange
    三枚開く()
    render(<TabBar onCloseTab={vi.fn()} />)
    const 器 = タブの器('無題-1.sql')
    const 帯 = 帯の寸法を与える(150, 0)

    // Act: 帯の真ん中あたりまでしか動かさない
    fireEvent.pointerDown(器, { pointerId: 1, button: 0, clientX: 50 })
    fireEvent.pointerMove(器, { pointerId: 1, clientX: 75 })
    フレームを進める()

    // Assert
    expect(帯.scrollLeft).toBe(0)
  })

  it('端に居ても指を離せば帯は送られなくなる', () => {
    // Arrange
    三枚開く()
    render(<TabBar onCloseTab={vi.fn()} />)
    const 器 = タブの器('無題-1.sql')
    const 帯 = 帯の寸法を与える(150, 0)
    fireEvent.pointerDown(器, { pointerId: 1, button: 0, clientX: 50 })
    fireEvent.pointerMove(器, { pointerId: 1, clientX: 145 })

    // Act
    fireEvent.pointerUp(器, { pointerId: 1, clientX: 145 })
    const 離した時点 = 帯.scrollLeft
    フレームを進める()

    // Assert
    expect(帯.scrollLeft).toBe(離した時点)
  })

  it('しきい値を越えていない押し下げでは帯を送らない', () => {
    // Arrange: 掴んだと見なす前に端へ居ても、ただの押し下げである
    三枚開く()
    render(<TabBar onCloseTab={vi.fn()} />)
    const 器 = タブの器('無題-1.sql')
    const 帯 = 帯の寸法を与える(150, 0)

    // Act
    fireEvent.pointerDown(器, { pointerId: 1, button: 0, clientX: 145 })
    fireEvent.pointerMove(器, { pointerId: 1, clientX: 146 })
    フレームを進める()

    // Assert
    expect(帯.scrollLeft).toBe(0)
  })
})
