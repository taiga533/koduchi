import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ResultPane } from './ResultPane'
import { emptyExecution, useExecutionStore, type LogEntry } from '../../stores/execution'
import { useUiStore } from '../../stores/ui'
import { resetClipboardApi, setClipboardApi } from '../../api/clipboard'
import { createFakeClipboard, type FakeClipboard } from '../../test/fakeClipboardApi'

const エラー = 'ORA-00933: SQL コマンドが正しく終了されていません'

/** 失敗した実行 1 件の記録。 */
const 失敗の記録: LogEntry = {
  id: 'log-1',
  startedAt: new Date(2026, 8, 27, 10, 0, 0),
  kind: 'statement',
  sql: 'select * from dual where',
  elapsedMs: 3,
  rowCount: null,
  error: エラー,
  notices: [],
  statement: null,
}

/** 結果ペインを描く。接続名と中止は失敗の表示に関わらない。 */
function 描く(onOpenSqlInNewTab: (sql: string) => void = () => {}) {
  render(
    <ResultPane
      tabId="tab-1"
      runningLabel=""
      onCancel={() => {}}
      onRequestMore={() => {}}
      onOpenSqlInNewTab={onOpenSqlInNewTab}
    />,
  )
}

describe('ResultPane のエラーのコピー', () => {
  let クリップボード: FakeClipboard
  let 元の実行: ReturnType<typeof useExecutionStore.getState>
  let 元の画面: ReturnType<typeof useUiStore.getState>

  beforeEach(() => {
    元の実行 = useExecutionStore.getState()
    元の画面 = useUiStore.getState()
    クリップボード = createFakeClipboard()
    setClipboardApi(クリップボード)
    useExecutionStore.setState({
      byTab: { 'tab-1': { ...emptyExecution, status: 'failed', error: エラー } },
      log: [失敗の記録],
    })
  })

  afterEach(() => {
    resetClipboardApi()
    useExecutionStore.setState(元の実行, true)
    useUiStore.setState(元の画面, true)
  })

  it('失敗した結果タブにエラーのコピーボタンが出て文言がそのまま載る', async () => {
    // Arrange
    useUiStore.setState({ resultTab: 'result' })
    描く()

    // Act
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'エラーをコピー' }))
    })

    // Assert
    expect(クリップボード.written).toEqual([エラー])
  })

  it('メッセージタブの失敗した記録にもエラーのコピーボタンが出る', async () => {
    // Arrange
    useUiStore.setState({ resultTab: 'messages' })
    描く()

    // Act
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'エラーをコピー' }))
    })

    // Assert
    expect(クリップボード.written).toEqual([エラー])
  })

  it('成功した記録にはエラーのコピーボタンを出さない', () => {
    // Arrange
    useExecutionStore.setState({
      byTab: { 'tab-1': { ...emptyExecution, status: 'succeeded' } },
      log: [{ ...失敗の記録, error: null, notices: ['PL/SQL が完了しました'] }],
    })
    useUiStore.setState({ resultTab: 'messages' })

    // Act
    描く()

    // Assert
    expect(screen.queryByRole('button', { name: 'エラーをコピー' })).not.toBeInTheDocument()
  })

  it('実行計画の失敗にもエラーのコピーボタンが出る', async () => {
    // Arrange
    useExecutionStore.setState({
      planByTab: { 'tab-1': { status: 'failed', mode: 'estimate', text: '', error: エラー } },
    })
    useUiStore.setState({ resultTab: 'plan' })
    描く()

    // Act
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'エラーをコピー' }))
    })

    // Assert
    expect(クリップボード.written).toEqual([エラー])
  })
})

describe('メッセージタブのログの右クリック（ADR 0038）', () => {
  let クリップボード: FakeClipboard
  let 元の実行: ReturnType<typeof useExecutionStore.getState>
  let 元の画面: ReturnType<typeof useUiStore.getState>

  /** コミットの報せ。SQL ではなく、エラーも無い。 */
  const コミットの報せ: LogEntry = {
    ...失敗の記録,
    id: 'log-2',
    kind: 'notice',
    sql: 'コミット',
    error: null,
    notices: ['コミットしました'],
  }

  /** 整形の失敗の報せ。SQL ではないがエラーはある。 */
  const 整形の報せ: LogEntry = {
    ...失敗の記録,
    id: 'log-3',
    kind: 'notice',
    sql: 'SQL の整形',
    error: '整形を取りやめました',
  }

  beforeEach(() => {
    元の実行 = useExecutionStore.getState()
    元の画面 = useUiStore.getState()
    クリップボード = createFakeClipboard()
    setClipboardApi(クリップボード)
    useUiStore.setState({ resultTab: 'messages' })
    useExecutionStore.setState({
      byTab: { 'tab-1': { ...emptyExecution, status: 'failed', error: エラー } },
      log: [失敗の記録, コミットの報せ, 整形の報せ],
    })
  })

  afterEach(() => {
    resetClipboardApi()
    window.getSelection()?.removeAllRanges()
    useExecutionStore.setState(元の実行, true)
    useUiStore.setState(元の画面, true)
  })

  it('実行した SQL のログでは SQL のコピーと新しいタブとエラーのコピーが並ぶ', () => {
    // Arrange
    const 開いた: string[] = []
    描く((sql) => 開いた.push(sql))
    const 記録 = screen.getByTestId('message-log-log-1')
    const 開く = () => fireEvent.contextMenu(記録)

    // Act
    開く()
    fireEvent.click(screen.getByRole('menuitem', { name: 'SQL をコピー' }))
    開く()
    fireEvent.click(screen.getByRole('menuitem', { name: '新しいタブで開く' }))
    開く()
    fireEvent.click(screen.getByRole('menuitem', { name: 'エラーをコピー' }))

    // Assert
    expect(クリップボード.written).toEqual(['select * from dual where', エラー])
    expect(開いた).toEqual(['select * from dual where'])
  })

  it('報せのログでは SQL として扱う項目を出さない', () => {
    // Arrange
    描く()

    // Act
    fireEvent.contextMenu(screen.getByTestId('message-log-log-3'))

    // Assert
    expect(screen.queryByRole('menuitem', { name: 'SQL をコピー' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'エラーをコピー' })).toBeInTheDocument()
  })

  it('写すものが無い報せではメニューを出さない', () => {
    // Arrange
    描く()

    // Act
    fireEvent.contextMenu(screen.getByTestId('message-log-log-2'))

    // Assert
    expect(screen.queryByTestId('message-log-context-menu')).not.toBeInTheDocument()
  })

  it('選んだ文字の上ではウェブビューのメニューに任せる', () => {
    // Arrange: jsdom は描かないため、選択の矩形だけを補う
    描く()
    const 本文 = screen.getByText('select * from dual where')
    const 範囲 = document.createRange()
    範囲.selectNodeContents(本文)
    範囲.getClientRects = () =>
      [{ left: 0, right: 100, top: 0, bottom: 20 }] as unknown as DOMRectList
    window.getSelection()?.addRange(範囲)

    // Act
    const 既定動作 = fireEvent.contextMenu(本文, { clientX: 50, clientY: 10 })

    // Assert
    expect(既定動作).toBe(true)
    expect(screen.queryByTestId('message-log-context-menu')).not.toBeInTheDocument()
  })
})
