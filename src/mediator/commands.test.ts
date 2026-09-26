import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDbApi, setDbApi } from '../api/db'
import { createFakeDbApi } from '../test/fakeDbApi'
import { SQLタブを一枚にする, 接続済みにする, 未接続にする } from '../test/activeConnection'
import { useTabStore } from '../stores/tab'
import type { Ask } from './ask'
import type { Command, CommandScreen } from './commands'
import type { KeyPress } from '../keybindings/chord'
import { resolveKeybindings } from '../keybindings/bindings'
import { serializeChord } from '../keybindings/chord'
import { EDITOR_ACTIONS } from '../components/editor/editorKeys'
import {
  COMMANDS,
  commandById,
  dispatchCommandKey,
  findCommandForKey,
  runCommand,
} from './commands'

beforeEach(() => {
  接続済みにする()
  SQLタブを一枚にする()
})

afterEach(() => {
  resetDbApi()
})

/** 既定の割り当て。 */
const 既定 = resolveKeybindings(COMMANDS, {}).chords

/** 画面の口がどれだけ呼ばれたか。 */
interface 画面の記録 {
  パレット: number
  CSV: number
  整形: number
}

/** 呼ばれた回数を数えるだけの画面を作る。 */
function 画面を作る(): CommandScreen & { 記録: 画面の記録 } {
  const 記録: 画面の記録 = { パレット: 0, CSV: 0, 整形: 0 }
  return {
    記録,
    cursor: () => ({ offset: 0, selectedText: null }),
    ask: (async () => false) as unknown as Ask,
    formatEditor: () => {
      記録.整形 += 1
    },
    openPalette: () => {
      記録.パレット += 1
    },
    openCsvDialog: () => {
      記録.CSV += 1
    },
  }
}

/**
 * `⌘` を伴う打鍵を作る。
 *
 * @param key `event.key`
 * @param modifiers 足す修飾
 */
function 打鍵(
  key: string,
  modifiers: Partial<Omit<KeyPress, 'key'>> = {},
): KeyPress & { defaultPrevented: boolean; preventDefault: () => void; 止めた: boolean } {
  const press = {
    key,
    code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : '',
    metaKey: true,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    ...modifiers,
    defaultPrevented: false,
    止めた: false,
    preventDefault: () => {
      press.止めた = true
    },
  }
  return press
}

describe('findCommandForKey', () => {
  it.each([
    ['e', { ctrlKey: true }, 'explain'],
    ['E', { ctrlKey: true, shiftKey: true }, 'explain-actual'],
    ['c', { ctrlKey: true }, 'commit'],
    ['r', { ctrlKey: true }, 'rollback'],
    ['ß', { altKey: true, code: 'KeyS' }, 'csv'],
    ['s', { ctrlKey: true }, 'save-query'],
    ['s', {}, 'save-file'],
    ['S', { shiftKey: true }, 'save-file-as'],
    ['o', {}, 'open-file'],
    ['n', {}, 'new-tab'],
    ['N', { shiftKey: true }, 'new-window'],
    ['w', {}, 'close-tab'],
    ['F', { shiftKey: true }, 'source-search'],
    ['P', { shiftKey: true }, 'palette'],
  ] as const)('%s %o は %s に当たる', (key, modifiers, id) => {
    // Arrange
    const press = 打鍵(key, modifiers)

    // Act
    const command = findCommandForKey(press, 既定)

    // Assert
    expect(command?.id).toBe(id)
  })

  it.each([
    ['k', {}],
    ['t', {}],
    ['e', {}],
    ['c', { altKey: true }],
    ['r', { altKey: true }],
    ['s', { ctrlKey: true, altKey: true }],
    ['s', { shiftKey: true, altKey: true }],
    ['Enter', {}],
    ['.', {}],
  ] as const)('%s %o には何も当たらない', (key, modifiers) => {
    // Arrange: 修飾は完全に一致したときだけ当てる。エディタの行（`⌘⏎` など）は表が振り分けない
    const press = 打鍵(key, modifiers)

    // Act
    const command = findCommandForKey(press, 既定)

    // Assert
    expect(command).toBeNull()
  })

  it('割り当て直したキーで当たり、元のキーでは当たらない', () => {
    // Arrange
    const 割り当て = resolveKeybindings(COMMANDS, { palette: 'cmd+k' }).chords

    // Act
    const 新しいキー = findCommandForKey(打鍵('k'), 割り当て)
    const 元のキー = findCommandForKey(打鍵('P', { shiftKey: true }), 割り当て)

    // Assert
    expect(新しいキー?.id).toBe('palette')
    expect(元のキー).toBeNull()
  })

  it('⌘ を伴わないキーでも割り当てたなら当たる', () => {
    // Arrange
    const 割り当て = resolveKeybindings(COMMANDS, { explain: 'f10' }).chords
    const press = { ...打鍵('F10', { metaKey: false }), code: 'F10' }

    // Act
    const command = findCommandForKey(press, 割り当て)

    // Assert
    expect(command?.id).toBe('explain')
  })
})

describe('dispatchCommandKey', () => {
  it('当たったキーは既定の動作を止めて実行する', () => {
    // Arrange
    const screen = 画面を作る()
    const press = 打鍵('ß', { altKey: true, code: 'KeyS' })

    // Act
    dispatchCommandKey(press, screen, 既定)

    // Assert
    expect(press.止めた).toBe(true)
    expect(screen.記録.CSV).toBe(1)
  })

  it('既に処理された打鍵は二重に扱わない', () => {
    // Arrange: エディタが先に拾ったものである
    const screen = 画面を作る()
    const press = { ...打鍵('P', { shiftKey: true }), defaultPrevented: true }

    // Act
    dispatchCommandKey(press, screen, 既定)

    // Assert
    expect(screen.記録.パレット).toBe(0)
  })

  it('今使えないコマンドは実行しないが、既定の動作は止める', () => {
    // Arrange: パレットは繋がっていなければ開かない（ADR 0018）
    未接続にする()
    const screen = 画面を作る()
    const press = 打鍵('P', { shiftKey: true })

    // Act
    dispatchCommandKey(press, screen, 既定)

    // Assert
    expect(press.止めた).toBe(true)
    expect(screen.記録.パレット).toBe(0)
  })

  it('当たらないキーは既定の動作を止めない', () => {
    // Arrange
    const screen = 画面を作る()
    const press = 打鍵('c')

    // Act
    dispatchCommandKey(press, screen, 既定)

    // Assert
    expect(press.止めた).toBe(false)
  })

  it('⌘N で新しいタブを開く', () => {
    // Arrange
    const screen = 画面を作る()

    // Act
    dispatchCommandKey(打鍵('n'), screen, 既定)

    // Assert
    expect(useTabStore.getState().tabs).toHaveLength(2)
  })
})

describe('runCommand', () => {
  it('パレットと同じ判定を通して実行する', () => {
    // Arrange
    const screen = 画面を作る()

    // Act
    runCommand(commandById('palette'), screen)
    未接続にする()
    runCommand(commandById('palette'), screen)

    // Assert
    expect(screen.記録.パレット).toBe(1)
  })

  it('整形はエディタの口へ渡す', () => {
    // Arrange
    const screen = 画面を作る()

    // Act
    runCommand(commandById('format'), screen)

    // Assert
    expect(screen.記録.整形).toBe(1)
  })

  it('コミットは今の接続へ送る', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)

    // Act
    runCommand(commandById('commit'), 画面を作る())

    // Assert
    await expect.poll(() => calls.commit).toEqual(['c1'])
  })
})

describe('commandById', () => {
  it('表に無い識別子は例外にする', () => {
    // Arrange
    const 表: Command[] = []

    // Act
    const 引く = () => commandById('run', 表)

    // Assert
    expect(引く).toThrow('コマンドの表に run がありません')
  })
})

describe('COMMANDS', () => {
  it('識別子は重ならない', () => {
    // Arrange
    const ids = COMMANDS.map((command) => command.id)

    // Act
    const 重なりのない数 = new Set(ids).size

    // Assert
    expect(重なりのない数).toBe(ids.length)
  })

  it('既定のキーは重ならない', () => {
    // Arrange: 同じ組み合わせが 2 行にあると、下の行のキーが黙って効かなくなる
    const chords = COMMANDS.flatMap((command) =>
      command.defaultKey ? [serializeChord(command.defaultKey)] : [],
    )

    // Act
    const 重なりのない数 = new Set(chords).size

    // Assert
    expect(重なりのない数).toBe(chords.length)
  })
})

describe('既定のキー', () => {
  it('固定のキーとも他の行とも重ならず、すべて解決できる', () => {
    // Arrange & Act
    const { issues } = resolveKeybindings(COMMANDS, {})

    // Assert
    expect(issues).toEqual([])
  })
})

describe('エディタの行', () => {
  it('エディタが振り分ける操作と表の editor の行が一致する', () => {
    // Arrange: 片方にだけ足すと、パレットには出るのにキーが効かない行ができる
    const 表の行 = COMMANDS.filter((command) => command.scope === 'editor').map(
      (command) => command.id,
    )

    // Act
    const エディタ = [...EDITOR_ACTIONS]

    // Assert
    expect(new Set(エディタ)).toEqual(new Set(表の行))
  })
})
