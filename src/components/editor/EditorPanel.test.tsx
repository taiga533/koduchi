import { describe, expect, it, beforeEach } from 'vitest'
import { act, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorPanel } from './EditorPanel'
import { useSchemaStore } from '../../stores/schema'
import { resetUntitledCounter, selectActiveSqlTab, useTabStore } from '../../stores/tab'

/** 既定の props でエディタ一式を描く。 */
function 描く() {
  return render(
    <EditorPanel
      onCursorChange={() => {}}
      onRunStatement={() => {}}
      onRunSelection={() => {}}
      onRunScript={() => {}}
      onCancel={() => {}}
    />,
  )
}

/** 編集領域の要素を取り出す。 */
function 編集領域(): HTMLElement {
  const content = document.querySelector('.cm-content')
  if (!(content instanceof HTMLElement)) {
    throw new Error('編集領域が見つからない')
  }
  return content
}

beforeEach(() => {
  resetUntitledCounter()
  useSchemaStore.getState().clear()
  useTabStore.getState().restore({
    tabs: [{ id: 'tab-1', name: '無題-1.sql', filePath: null, content: 'select 1', dirty: false }],
    activeTabId: 'tab-1',
  })
})

describe('EditorPanel', () => {
  it('選択中のタブの内容が表示される', () => {
    // Arrange
    描く()

    // Act
    const 表示 = 編集領域().textContent

    // Assert
    expect(表示).toContain('select 1')
  })

  it('入力した内容が選択中のタブへ書き戻される', async () => {
    // Arrange
    act(() =>
      useTabStore.getState().restore({
        tabs: [{ id: 'tab-2', name: '無題-2.sql', filePath: null, content: '', dirty: false }],
        activeTabId: 'tab-2',
      }),
    )
    描く()

    // Act
    await userEvent.click(編集領域())
    await userEvent.keyboard('select 1')

    // Assert
    expect(selectActiveSqlTab(useTabStore.getState())?.content).toBe('select 1')
  })

  it('タブを切り替えると切り替え先の内容が表示される', () => {
    // Arrange
    描く()

    // Act
    act(() => useTabStore.getState().openFile('/tmp/other.sql', 'select 2 from dual'))

    // Assert
    expect(編集領域().textContent).toContain('select 2 from dual')
  })
})
