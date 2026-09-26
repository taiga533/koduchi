import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { clearMocks, mockIPC, mockWindows } from '@tauri-apps/api/mocks'
import { emit } from '@tauri-apps/api/event'
import { OPEN_SETTINGS_EVENT, onOpenSettingsRequested } from './appMenu'

/**
 * Tauri の中で動いていることにする。
 *
 * `mockIPC` / `mockWindows` は `isTauri()` の印を立てない。印が無いと「Tauri の外」と
 * 見分けが付かず、中で聞くのに失敗した経路を試せない。
 */
function Tauriの中にする(): void {
  ;(globalThis as { isTauri?: boolean }).isTauri = true
  mockWindows('main')
}

/** 期限までに未処理の拒否が上がらなかったことを表す印。 */
const 拒否は上がらなかった = Symbol('拒否は上がらなかった')

/**
 * 未処理の拒否を 1 つ拾う。
 *
 * vitest は未処理の拒否を実行全体の失敗として数えるため、拾う間だけ vitest の
 * 受け手を外し、拾い終えたら戻す。
 */
async function 未処理の拒否を拾う(act: () => void): Promise<unknown> {
  const vitestの受け手 = process.listeners('unhandledRejection')
  process.removeAllListeners('unhandledRejection')
  try {
    const 拾った = new Promise<unknown>((resolve) => {
      process.once('unhandledRejection', (reason) => resolve(reason))
    })
    act()
    // 握り潰されたときにタイムアウトで落ちると理由が読めないため、期限で印を返す。
    const 期限 = new Promise<unknown>((resolve) =>
      setTimeout(() => resolve(拒否は上がらなかった), 500),
    )
    return await Promise.race([拾った, 期限])
  } finally {
    process.removeAllListeners('unhandledRejection')
    for (const 受け手 of vitestの受け手) {
      process.on('unhandledRejection', 受け手)
    }
  }
}

describe('onOpenSettingsRequested', () => {
  beforeEach(() => {
    delete (globalThis as { isTauri?: boolean }).isTauri
  })

  afterEach(() => {
    delete (globalThis as { isTauri?: boolean }).isTauri
    clearMocks()
  })

  it('メニューの「設定…」のイベントが届くと処理を呼ぶ', async () => {
    // Arrange
    Tauriの中にする()
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
    Tauriの中にする()
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

  it('Tauri の中で聞くのに失敗したら握らずに未処理の拒否として上げる', async () => {
    // Arrange
    Tauriの中にする()
    const 失敗 = new Error('listen に失敗した')
    mockIPC((cmd) => {
      if (cmd === 'plugin:event|listen') {
        throw 失敗
      }
    })

    // Act
    const 拾った = await 未処理の拒否を拾う(() => onOpenSettingsRequested(vi.fn()))

    // Assert
    expect(拾った).toBe(失敗)
  })

  it('Tauri の外では聞きにいかず、何もしない後片付けを返す', () => {
    // Arrange
    const 呼ばれたコマンド: string[] = []
    mockIPC((cmd) => {
      呼ばれたコマンド.push(cmd)
    })
    const handler = vi.fn()

    // Act
    const stop = onOpenSettingsRequested(handler)

    // Assert
    expect(呼ばれたコマンド).toEqual([])
    expect(() => stop()).not.toThrow()
    expect(handler).not.toHaveBeenCalled()
  })
})
