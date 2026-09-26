import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { clearMocks, mockIPC, mockWindows } from '@tauri-apps/api/mocks'
import { emit } from '@tauri-apps/api/event'
import { OPEN_SETTINGS_EVENT, onOpenSettingsRequested } from './appMenu'

describe('onOpenSettingsRequested', () => {
  afterEach(() => {
    clearMocks()
  })

  it('メニューの「設定…」のイベントが届くと処理を呼ぶ', async () => {
    // Arrange
    mockWindows('main')
    mockIPC(() => {}, { shouldMockEvents: true })
    const handler = vi.fn()
    onOpenSettingsRequested(handler)

    // Act
    await waitFor(async () => {
      await emit(OPEN_SETTINGS_EVENT)
      expect(handler).toHaveBeenCalled()
    })

    // Assert
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('後片付けの後に届いたイベントでは処理を呼ばない', async () => {
    // Arrange
    mockWindows('main')
    mockIPC(() => {}, { shouldMockEvents: true })
    const handler = vi.fn()
    const stop = onOpenSettingsRequested(handler)
    stop()

    // Act
    await emit(OPEN_SETTINGS_EVENT)
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Assert
    expect(handler).not.toHaveBeenCalled()
  })

  it('Tauri の外では何もせずに後片付けを返す', () => {
    // Arrange
    const handler = vi.fn()

    // Act
    const stop = onOpenSettingsRequested(handler)

    // Assert
    expect(() => stop()).not.toThrow()
    expect(handler).not.toHaveBeenCalled()
  })
})
