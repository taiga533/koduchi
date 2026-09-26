import { afterEach, describe, expect, it } from 'vitest'
import { resetDbApi, setDbApi } from '../api/db'
import { createFakeDbApi } from '../test/fakeDbApi'
import { SQLタブを一枚にする } from '../test/activeConnection'
import { useTabStore } from '../stores/tab'
import { useUiStore } from '../stores/ui'
import { restoreSession } from './session'

afterEach(() => {
  resetDbApi()
})

describe('restoreSession', () => {
  it('タブ・サイドバーの面・ペインの寸法を戻す', async () => {
    // Arrange
    const { api } = createFakeDbApi({
      session: {
        tabs: [
          {
            id: 't1',
            name: '売上.sql',
            customName: null,
            filePath: null,
            content: 'select 1 from dual',
            dirty: true,
          },
        ],
        activeTabId: 't1',
        sidebarSegment: 'saved',
        sidebarWidth: 300,
        editorHeight: 200,
      },
    })
    setDbApi(api)

    // Act
    await restoreSession('main', 900)

    // Assert
    expect(useTabStore.getState().activeTabId).toBe('t1')
    expect(useUiStore.getState().sidebarSegment).toBe('saved')
    expect(useUiStore.getState().sidebarWidth).toBe(300)
    expect(useUiStore.getState().editorHeight).toBe(200)
  })

  it('知らない面の名前は無視する', async () => {
    // Arrange
    const { api } = createFakeDbApi({
      session: {
        tabs: [],
        activeTabId: null,
        sidebarSegment: 'unknown',
        sidebarWidth: null,
        editorHeight: null,
      },
    })
    setDbApi(api)
    useUiStore.setState({ sidebarSegment: 'history' })

    // Act
    await restoreSession('main', 900)

    // Assert
    expect(useUiStore.getState().sidebarSegment).toBe('history')
  })

  it('読めなかったら今のタブのまま何もしない', async () => {
    // Arrange: 初めて開くウィンドウで起動を止めない
    const { api } = createFakeDbApi()
    setDbApi({
      ...api,
      loadSession: async () => {
        throw new Error('no such table: session_state')
      },
    })
    SQLタブを一枚にする({ content: 'select 1 from dual' })

    // Act
    await restoreSession('main', 900)

    // Assert
    expect(useTabStore.getState().tabs.map((tab) => tab.id)).toEqual(['sql-1'])
  })
})
