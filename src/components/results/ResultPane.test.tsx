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
  sql: 'select * from dual where',
  elapsedMs: 3,
  rowCount: null,
  error: エラー,
  notices: [],
  statement: null,
}

/** 結果ペインを描く。接続名と中止は失敗の表示に関わらない。 */
function 描く() {
  render(<ResultPane tabId="tab-1" runningLabel="" onCancel={() => {}} onRequestMore={() => {}} />)
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
