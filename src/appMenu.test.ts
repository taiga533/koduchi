import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { clearMocks, mockIPC, mockWindows } from '@tauri-apps/api/mocks'
import { emit } from '@tauri-apps/api/event'
import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { MENU_COMMAND_EVENT, onMenuCommand } from './appMenu'
import { COMMANDS } from './mediator/commands'

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

describe('onMenuCommand', () => {
  beforeEach(() => {
    delete (globalThis as { isTauri?: boolean }).isTauri
  })

  afterEach(() => {
    delete (globalThis as { isTauri?: boolean }).isTauri
    clearMocks()
  })

  it('メニューのイベントが届くとコマンドの識別子を渡して処理を呼ぶ', async () => {
    // Arrange
    Tauriの中にする()
    mockIPC(() => {}, { shouldMockEvents: true })
    const handler = vi.fn()
    onMenuCommand(handler)

    // Act
    await waitFor(async () => {
      await emit(MENU_COMMAND_EVENT, 'format')
      expect(handler).toHaveBeenCalled()
    })

    // Assert
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith('format')
  })

  it('後片付けの後に届いたイベントでは処理を呼ばない', async () => {
    // Arrange
    Tauriの中にする()
    mockIPC(() => {}, { shouldMockEvents: true })
    const handler = vi.fn()
    const stop = onMenuCommand(handler)
    stop()

    // Act
    await emit(MENU_COMMAND_EVENT, 'format')
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
    const 拾った = await 未処理の拒否を拾う(() => onMenuCommand(vi.fn()))

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
    const stop = onMenuCommand(handler)

    // Assert
    expect(呼ばれたコマンド).toEqual([])
    expect(() => stop()).not.toThrow()
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('メニューの項目とコマンドの表', () => {
  it('Rust 側のメニューが送る識別子はどれもコマンドの表に在る', () => {
    // Arrange
    // 識別子は言語をまたいで綴りを揃えるしかなく、食い違うと押したときに初めて
    // 例外になる。Rust 側の定義を読んで突き合わせる。
    const source = readFileSync(resolvePath(__dirname, '../src-tauri/src/menu.rs'), 'utf8')
    const ids = [...source.matchAll(/command_id: "([^"]+)"/g)].map((match) => match[1])

    // Act
    const missing = ids.filter((id) => !COMMANDS.some((command) => command.id === id))

    // Assert
    expect(ids).toEqual(['settings', 'open-file', 'format'])
    expect(missing).toEqual([])
  })
})
