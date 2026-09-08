import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  confirmCloseTab,
  needsCloseConfirmation,
  resetCloseTabDialog,
  setCloseTabDialog,
} from './closing'

afterEach(() => {
  resetCloseTabDialog()
})

describe('needsCloseConfirmation', () => {
  it('未保存で本文があるタブは確認が要る', () => {
    // Arrange
    const tab = { dirty: true, content: 'select 1 from dual' }

    // Act
    const 要る = needsCloseConfirmation(tab)

    // Assert
    expect(要る).toBe(true)
  })

  it('未保存でも本文が空なら確認は要らない', () => {
    // Arrange
    const tab = { dirty: true, content: '' }

    // Act
    const 要る = needsCloseConfirmation(tab)

    // Assert
    expect(要る).toBe(false)
  })

  it('未保存でも本文が空白と改行だけなら確認は要らない', () => {
    // Arrange
    const tab = { dirty: true, content: '  \n\t ' }

    // Act
    const 要る = needsCloseConfirmation(tab)

    // Assert
    expect(要る).toBe(false)
  })

  it('保存済みのタブは本文があっても確認は要らない', () => {
    // Arrange
    const tab = { dirty: false, content: 'select 1 from dual' }

    // Act
    const 要る = needsCloseConfirmation(tab)

    // Assert
    expect(要る).toBe(false)
  })

  it('`dirty` も `content` も持たないタブは確認が要らない', () => {
    // Arrange: テーブル定義ビューのタブのように内容を持たないもの
    const tab = {}

    // Act
    const 要る = needsCloseConfirmation(tab)

    // Assert
    expect(要る).toBe(false)
  })
})

describe('confirmCloseTab', () => {
  it('確認の要らないタブでは尋ねずに閉じてよいと答える', async () => {
    // Arrange
    const 尋ねる = vi.fn(async () => false)
    setCloseTabDialog(尋ねる)

    // Act
    const 閉じてよい = await confirmCloseTab({ dirty: false, content: 'x' }, '無題-1.sql')

    // Assert
    expect(閉じてよい).toBe(true)
    expect(尋ねる).not.toHaveBeenCalled()
  })

  it('未保存のタブではタブの名前を添えて尋ねる', async () => {
    // Arrange
    const 尋ねる = vi.fn(async () => true)
    setCloseTabDialog(尋ねる)

    // Act
    const 閉じてよい = await confirmCloseTab({ dirty: true, content: 'select 1' }, '無題-1.sql')

    // Assert
    expect(閉じてよい).toBe(true)
    expect(尋ねる).toHaveBeenCalledWith('無題-1.sql')
  })

  it('取り消されたら閉じてはいけないと答える', async () => {
    // Arrange
    setCloseTabDialog(async () => false)

    // Act
    const 閉じてよい = await confirmCloseTab({ dirty: true, content: 'select 1' }, '無題-1.sql')

    // Assert
    expect(閉じてよい).toBe(false)
  })
})
