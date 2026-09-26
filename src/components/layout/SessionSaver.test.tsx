import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { resetDbApi, setDbApi } from '../../api/db'
import { createFakeDbApi } from '../../test/fakeDbApi'
import { useTabStore } from '../../stores/tab'
import { useUiStore } from '../../stores/ui'
import { SESSION_SAVE_DELAY, SessionSaver } from './SessionSaver'

/** SQL タブ 1 枚だけの並び。 */
function タブを一枚にする(): void {
  useTabStore.setState({
    tabs: [
      {
        kind: 'sql',
        id: 'sql-1',
        name: '無題-1.sql',
        customName: null,
        filePath: null,
        content: '',
        dirty: false,
      },
    ],
    activeTabId: 'sql-1',
    bindValues: {},
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  タブを一枚にする()
})

afterEach(() => {
  vi.useRealTimers()
  resetDbApi()
})

describe('SessionSaver', () => {
  it('続けて打った内容は待ちが明けてから 1 度だけ書き出す', () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    render(<SessionSaver />)

    // Act: 待ちが明ける前に打ち続ける
    act(() => useTabStore.getState().updateContent('sql-1', 's'))
    act(() => vi.advanceTimersByTime(SESSION_SAVE_DELAY - 1))
    act(() => useTabStore.getState().updateContent('sql-1', 'se'))
    act(() => vi.advanceTimersByTime(SESSION_SAVE_DELAY))

    // Assert
    expect(calls.saveSession).toHaveLength(1)
    expect(calls.saveSession[0].state.tabs[0].content).toBe('se')
  })

  it('ペインの寸法も書き出す', () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    render(<SessionSaver />)

    // Act
    act(() => useUiStore.getState().setSidebarWidth(300))
    act(() => vi.advanceTimersByTime(SESSION_SAVE_DELAY))

    // Assert
    expect(calls.saveSession.at(-1)?.state.sidebarWidth).toBe(300)
  })
})
