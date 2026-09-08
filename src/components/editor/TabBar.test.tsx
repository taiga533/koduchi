/**
 * エディタタブの帯のテスト（ADR 0005・0022）。
 *
 * SQL タブと定義タブが 1 本の並びに混ざったときの描き分けを見る。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useTabStore } from '../../stores/tab'
import type { EditorTab } from '../../stores/tab'
import { TabBar } from './TabBar'

const 出荷の定義タブ: EditorTab = {
  kind: 'definition',
  id: 'd1',
  name: 'SHIPMENTS',
  target: { owner: 'KODUCHI', name: 'SHIPMENTS', kind: 'table' },
}

/**
 * タブの並びを据える。
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
function SQLタブ(id: string, overrides: Partial<Extract<EditorTab, { kind: 'sql' }>> = {}) {
  return {
    kind: 'sql' as const,
    id,
    name: `${id}.sql`,
    filePath: null,
    content: '',
    dirty: false,
    ...overrides,
  }
}

beforeEach(() => {
  タブを据える([SQLタブ('t1')], 't1')
})

describe('TabBar', () => {
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

  it('定義タブには未保存の印を出さず、いつでも閉じられる', () => {
    // Arrange: 定義タブは編集できず、未保存になりようがない（ADR 0022）
    タブを据える([出荷の定義タブ], 'd1')

    // Act
    render(<TabBar onCloseTab={vi.fn()} />)

    // Assert
    expect(screen.queryByLabelText('未保存')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'SHIPMENTS を閉じる' })).toBeInTheDocument()
  })

  it('未保存の SQL タブには印が出る', () => {
    // Arrange
    タブを据える([SQLタブ('t1', { dirty: true })], 't1')

    // Act
    render(<TabBar onCloseTab={vi.fn()} />)

    // Assert
    expect(screen.getByLabelText('未保存')).toBeInTheDocument()
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
})
