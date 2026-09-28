import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { resetClipboardApi, setClipboardApi } from '../../api/clipboard'
import { resetDbApi, setDbApi } from '../../api/db'
import { createFakeDbApi, type FakeCalls } from '../../test/fakeDbApi'
import type { HistoryEntry } from '../../types/db'
import { useHistoryStore } from '../../stores/history'
import { HistoryList } from './HistoryList'
import { HOVER_CLOSE_DELAY_MS, HOVER_OPEN_DELAY_MS } from './previewPlacement'

const 履歴一覧: HistoryEntry[] = [
  {
    id: 1,
    sql: 'select * from users\nwhere id = 1',
    connectionName: '開発',
    startedAt: 1_700_000_000_000,
    elapsedMs: 84,
    rowCount: 142,
    succeeded: true,
    errorMessage: null,
  },
  {
    id: 2,
    sql: 'select * from nowhere',
    connectionName: '開発',
    startedAt: 1_700_000_001_000,
    elapsedMs: 3,
    rowCount: null,
    succeeded: false,
    errorMessage: 'ORA-00942',
  },
]

let calls: FakeCalls

/** 保存済みクエリへの追加を扱わないテストで渡す。 */
const 保存しない = async () => null

beforeEach(() => {
  const fake = createFakeDbApi({ history: 履歴一覧 })
  calls = fake.calls
  setDbApi(fake.api)
  useHistoryStore.setState({
    entries: 履歴一覧,
    scope: 'connection',
    outcome: 'all',
    search: '',
    error: null,
  })
})

afterEach(() => {
  vi.useRealTimers()
  resetDbApi()
  resetClipboardApi()
})

describe('HistoryList', () => {
  it('sql の 1 行目と行数と所要時間が並ぶ', () => {
    // Arrange
    render(<HistoryList onSaveQuery={保存しない} onUse={() => {}} onOpenInNewTab={() => {}} />)

    // Act
    const 一件目 = screen.getByText('select * from users')

    // Assert
    expect(一件目).toBeInTheDocument()
    expect(screen.getByText('142 行 · 84 ms')).toBeInTheDocument()
  })

  it('失敗した実行には失敗と出る', () => {
    // Arrange
    render(<HistoryList onSaveQuery={保存しない} onUse={() => {}} onOpenInNewTab={() => {}} />)

    // Act
    const 失敗 = screen.getByText('失敗', { selector: 'span' })

    // Assert
    expect(失敗).toBeInTheDocument()
  })

  it('履歴を押すと sql を渡す', async () => {
    // Arrange
    const 渡された: string[] = []
    render(
      <HistoryList
        onSaveQuery={保存しない}
        onUse={(sql) => 渡された.push(sql)}
        onOpenInNewTab={() => {}}
      />,
    )

    // Act
    await userEvent.click(screen.getByText('select * from users'))

    // Assert
    expect(渡された).toEqual(['select * from users\nwhere id = 1'])
  })

  it('一件ごとに削除できる', async () => {
    // Arrange
    render(<HistoryList onSaveQuery={保存しない} onUse={() => {}} onOpenInNewTab={() => {}} />)

    // Act
    await userEvent.click(screen.getAllByRole('button', { name: 'この履歴を削除' })[0])

    // Assert
    expect(calls.deleteHistory).toEqual([1])
  })

  it('スコープを全接続へ切り替えられる', async () => {
    // Arrange
    render(<HistoryList onSaveQuery={保存しない} onUse={() => {}} onOpenInNewTab={() => {}} />)

    // Act
    await userEvent.click(screen.getByRole('button', { name: '全接続' }))

    // Assert
    expect(useHistoryStore.getState().scope).toBe('all')
  })

  it('履歴が無ければ空状態を出す', () => {
    // Arrange
    useHistoryStore.setState({ entries: [], loading: false })

    // Act
    render(<HistoryList onSaveQuery={保存しない} onUse={() => {}} onOpenInNewTab={() => {}} />)

    // Assert
    expect(screen.getByText('実行した SQL がここに残ります')).toBeInTheDocument()
  })
})

describe('履歴の右クリックメニュー', () => {
  it('新しいタブで開くと全文の SQL を渡す', () => {
    // Arrange
    const 渡された: string[] = []
    render(
      <HistoryList
        onSaveQuery={保存しない}
        onUse={() => {}}
        onOpenInNewTab={(sql) => 渡された.push(sql)}
      />,
    )
    fireEvent.contextMenu(screen.getByText('select * from users'))

    // Act
    fireEvent.click(screen.getByRole('menuitem', { name: '新しいタブで開く' }))

    // Assert
    expect(渡された).toEqual(['select * from users\nwhere id = 1'])
    expect(screen.queryByTestId('sql-entry-context-menu')).not.toBeInTheDocument()
  })

  it('SQL をコピーすると 1 行目ではなく全文を写す', () => {
    // Arrange
    const 書いた: string[] = []
    setClipboardApi({ writeText: async (text) => void 書いた.push(text) })
    render(<HistoryList onSaveQuery={保存しない} onUse={() => {}} onOpenInNewTab={() => {}} />)
    fireEvent.contextMenu(screen.getByText('select * from users'))

    // Act
    fireEvent.click(screen.getByRole('menuitem', { name: 'SQL をコピー' }))

    // Assert
    expect(書いた).toEqual(['select * from users\nwhere id = 1'])
  })

  it('エディタへ入れると削除は行の操作と同じ要求を届ける', () => {
    // Arrange
    const 入れた: string[] = []
    render(
      <HistoryList
        onSaveQuery={保存しない}
        onUse={(sql) => 入れた.push(sql)}
        onOpenInNewTab={() => {}}
      />,
    )

    // Act
    fireEvent.contextMenu(screen.getByText('select * from nowhere'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'エディタへ入れる' }))
    fireEvent.contextMenu(screen.getByText('select * from nowhere'))
    fireEvent.click(screen.getByRole('menuitem', { name: '削除' }))

    // Assert
    expect(入れた).toEqual(['select * from nowhere'])
    expect(calls.deleteHistory).toEqual([2])
  })

  it('履歴には名前が無いので名前の変更を出さない', () => {
    // Arrange
    render(<HistoryList onSaveQuery={保存しない} onUse={() => {}} onOpenInNewTab={() => {}} />)

    // Act
    fireEvent.contextMenu(screen.getByText('select * from users'))

    // Assert
    expect(screen.queryByRole('menuitem', { name: '名前を変更' })).not.toBeInTheDocument()
  })

  it('保存済みクエリへ追加すると押した行の履歴を渡し、積めたら一言を出す', async () => {
    // Arrange
    const 渡された: HistoryEntry[] = []
    render(
      <HistoryList
        onUse={() => {}}
        onOpenInNewTab={() => {}}
        onSaveQuery={async (entry) => {
          渡された.push(entry)
          return '利用者'
        }}
      />,
    )
    fireEvent.contextMenu(screen.getByText('select * from users'))

    // Act
    fireEvent.click(screen.getByRole('menuitem', { name: '保存済みクエリへ追加' }))

    // Assert
    expect(渡された.map((entry) => entry.id)).toEqual([1])
    expect(await screen.findByRole('status')).toHaveTextContent(
      '「利用者」を保存済みクエリへ追加しました',
    )
  })

  it('取り消されたら一言を出さない', async () => {
    // Arrange
    let 解く: ((name: string | null) => void) | undefined
    render(
      <HistoryList
        onUse={() => {}}
        onOpenInNewTab={() => {}}
        onSaveQuery={() => new Promise((resolve) => (解く = resolve))}
      />,
    )
    fireEvent.contextMenu(screen.getByText('select * from users'))
    fireEvent.click(screen.getByRole('menuitem', { name: '保存済みクエリへ追加' }))

    // Act
    await act(async () => 解く?.(null))

    // Assert
    expect(screen.getByRole('status')).toHaveTextContent('')
  })
})

/** 一覧を描く。プレビューのテストでは行の操作を使わない。 */
function 一覧を描く() {
  render(<HistoryList onSaveQuery={保存しない} onUse={() => {}} onOpenInNewTab={() => {}} />)
}

/** 行の本体（押すとエディタへ入るボタン）。 */
function 行の本体(text: string): HTMLElement {
  const element = screen.getByText(text, { selector: 'button > span' }).closest('button')
  if (element === null) {
    throw new Error(`行が見つかりません: ${text}`)
  }
  return element
}

describe('HistoryList の成否の絞り込み', () => {
  it('失敗を押すと失敗した履歴だけを問い合わせ直す', async () => {
    // Arrange
    一覧を描く()

    // Act
    await userEvent.click(screen.getByRole('button', { name: '失敗' }))

    // Assert
    expect(useHistoryStore.getState().outcome).toBe('failed')
    expect(calls.listHistory.at(-1)?.succeeded).toBe(false)
    expect(screen.getByRole('button', { name: '失敗' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('絞り込んだ結果が空なら絞り込みの一言を出す', () => {
    // Arrange
    useHistoryStore.setState({ entries: [], outcome: 'succeeded', loading: false })

    // Act
    一覧を描く()

    // Assert
    expect(screen.getByText('成功した実行はありません')).toBeInTheDocument()
  })
})

describe('HistoryList の全文プレビュー', () => {
  it('何もフォーカスしていなければ全文は出ない', () => {
    // Arrange
    一覧を描く()

    // Act
    const プレビュー = screen.queryByRole('tooltip')

    // Assert
    expect(プレビュー).toBeNull()
  })

  it('行に焦点が当たるとその行の全文を出す', () => {
    // Arrange
    一覧を描く()

    // Act
    act(() => 行の本体('select * from users').focus())

    // Assert
    const プレビュー = screen.getByRole('tooltip')
    expect(プレビュー.querySelector('pre')?.textContent).toBe('select * from users\nwhere id = 1')
    expect(行の本体('select * from users')).toHaveAttribute('aria-describedby', プレビュー.id)
  })

  it('失敗した履歴はエラーメッセージも出す', () => {
    // Arrange
    一覧を描く()

    // Act
    act(() => 行の本体('select * from nowhere').focus())

    // Assert
    expect(screen.getByRole('tooltip')).toHaveTextContent('ORA-00942')
  })

  it('焦点が抜けると全文を閉じる', () => {
    // Arrange
    一覧を描く()
    act(() => 行の本体('select * from users').focus())

    // Act
    act(() => 行の本体('select * from users').blur())

    // Assert
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('下矢印で次の行へ焦点が移り全文も切り替わる', () => {
    // Arrange
    一覧を描く()
    act(() => 行の本体('select * from users').focus())

    // Act
    fireEvent.keyDown(行の本体('select * from users'), { key: 'ArrowDown' })

    // Assert
    expect(行の本体('select * from nowhere')).toHaveFocus()
    expect(screen.getByRole('tooltip').querySelector('pre')?.textContent).toBe(
      'select * from nowhere',
    )
  })

  it('変換中の下矢印では焦点を動かさない', () => {
    // Arrange
    一覧を描く()
    act(() => 行の本体('select * from users').focus())

    // Act
    fireEvent.keyDown(行の本体('select * from users'), { key: 'ArrowDown', isComposing: true })

    // Assert
    expect(行の本体('select * from users')).toHaveFocus()
  })

  it('esc で全文を閉じる', () => {
    // Arrange
    一覧を描く()
    act(() => 行の本体('select * from users').focus())

    // Act
    fireEvent.keyDown(window, { key: 'Escape' })

    // Assert
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('右クリックのメニューを開くと全文を閉じる', () => {
    // Arrange
    一覧を描く()
    act(() => 行の本体('select * from users').focus())

    // Act
    fireEvent.contextMenu(screen.getByText('select * from users'))

    // Assert
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('ホバーは少し待ってから全文を出し、離れると閉じる', () => {
    // Arrange
    vi.useFakeTimers()
    一覧を描く()
    const 行 = screen.getByText('select * from users').closest('li') as HTMLElement

    // Act
    fireEvent.pointerEnter(行)
    const 待つ前 = screen.queryByRole('tooltip')
    act(() => vi.advanceTimersByTime(HOVER_OPEN_DELAY_MS))
    const 待った後 = screen.queryByRole('tooltip')
    fireEvent.pointerLeave(行)
    act(() => vi.advanceTimersByTime(HOVER_CLOSE_DELAY_MS))

    // Assert
    expect(待つ前).toBeNull()
    expect(待った後).not.toBeNull()
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('ホバーで開いた全文の上へ移れば閉じない', () => {
    // Arrange
    vi.useFakeTimers()
    一覧を描く()
    const 行 = screen.getByText('select * from users').closest('li') as HTMLElement
    fireEvent.pointerEnter(行)
    act(() => vi.advanceTimersByTime(HOVER_OPEN_DELAY_MS))

    // Act
    fireEvent.pointerLeave(行)
    fireEvent.pointerEnter(screen.getByRole('tooltip'))
    act(() => vi.advanceTimersByTime(HOVER_CLOSE_DELAY_MS * 2))

    // Assert
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
  })

  it('焦点で開いた全文はポインタが離れても閉じない', () => {
    // Arrange
    vi.useFakeTimers()
    一覧を描く()
    act(() => 行の本体('select * from users').focus())
    const 行 = screen.getByText('select * from users').closest('li') as HTMLElement

    // Act
    fireEvent.pointerEnter(行)
    fireEvent.pointerLeave(行)
    act(() => vi.advanceTimersByTime(HOVER_CLOSE_DELAY_MS * 2))

    // Assert
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
  })

  it('ホバーで開いた全文は一覧のスクロールで閉じるが、全文の中のスクロールでは閉じない', () => {
    // Arrange
    vi.useFakeTimers()
    一覧を描く()
    fireEvent.pointerEnter(screen.getByText('select * from users').closest('li') as HTMLElement)
    act(() => vi.advanceTimersByTime(HOVER_OPEN_DELAY_MS))

    // Act
    fireEvent.scroll(screen.getByRole('tooltip').querySelector('pre') as HTMLElement)
    const 中のスクロールの後 = screen.queryByRole('tooltip')
    fireEvent.scroll(screen.getByRole('list'))

    // Assert
    expect(中のスクロールの後).not.toBeNull()
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})

/**
 * 行の位置を決め打ちにする。jsdom は配置をしないため、行は一覧の中の並び順 × 40px の
 * 高さに、送った量だけ上へずれて並んでいることにする。
 */
function 行の配置を決める(): { 送る: (px: number) => void } {
  let 送り = 0
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.tagName !== 'LI' || this.parentElement === null) {
      return new DOMRect(0, 0, 0, 0)
    }
    const index = Array.from(this.parentElement.children).indexOf(this)
    return new DOMRect(0, 100 + index * 40 - 送り, 260, 40)
  })
  return {
    送る: (px) => {
      送り = px
    },
  }
}

/** プレビューの上端（px）。 */
function プレビューの上端(): string {
  return screen.getByRole('tooltip').style.top
}

describe('HistoryList の全文プレビューの位置', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('スクロールを伴う下矢印でも全文は開いたまま、送った後の行の横に出る', () => {
    // Arrange
    const 配置 = 行の配置を決める()
    const 送った: unknown[] = []
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (
      this: Element,
      options?: boolean | ScrollIntoViewOptions,
    ) {
      送った.push(options)
      配置.送る(30)
      fireEvent.scroll(screen.getByRole('list'))
    })
    一覧を描く()
    act(() => 行の本体('select * from users').focus())

    // Act
    fireEvent.keyDown(行の本体('select * from users'), { key: 'ArrowDown' })

    // Assert
    expect(送った).toEqual([{ block: 'nearest' }])
    expect(screen.getByRole('tooltip').querySelector('pre')?.textContent).toBe(
      'select * from nowhere',
    )
    expect(プレビューの上端()).toBe(`${100 + 40 - 30}px`)
  })

  it('端の行の下矢印は器をスクロールさせない', () => {
    // Arrange
    一覧を描く()
    act(() => 行の本体('select * from nowhere').focus())

    // Act
    const 既定の動きが残った = fireEvent.keyDown(行の本体('select * from nowhere'), {
      key: 'ArrowDown',
    })

    // Assert
    expect(既定の動きが残った).toBe(false)
    expect(行の本体('select * from nowhere')).toHaveFocus()
  })

  it('一覧の先頭に行が入ると全文は同じ履歴の行の横へ測り直す', () => {
    // Arrange
    行の配置を決める()
    一覧を描く()
    act(() => 行の本体('select * from users').focus())
    const 前の上端 = プレビューの上端()
    const 新しい履歴: HistoryEntry = { ...履歴一覧[0], id: 3, sql: 'select 3 from dual' }

    // Act
    act(() => useHistoryStore.setState({ entries: [新しい履歴, ...履歴一覧] }))

    // Assert
    expect(前の上端).toBe('100px')
    expect(プレビューの上端()).toBe('140px')
    expect(screen.getByRole('tooltip').querySelector('pre')?.textContent).toBe(
      'select * from users\nwhere id = 1',
    )
  })

  it('全文を出している行が一覧から消えると閉じ、戻っても勝手に開かない', () => {
    // Arrange
    一覧を描く()
    act(() => 行の本体('select * from users').focus())

    // Act
    act(() => useHistoryStore.setState({ entries: [履歴一覧[1]] }))
    const 消えた後 = screen.queryByRole('tooltip')
    act(() => useHistoryStore.setState({ entries: 履歴一覧 }))

    // Assert
    expect(消えた後).toBeNull()
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
