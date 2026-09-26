import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDbApi, setDbApi } from '../api/db'
import { createFakeDbApi } from '../test/fakeDbApi'
import { SQLタブを一枚にする, 接続済みにする, 未接続にする } from '../test/activeConnection'
import { useTabStore } from '../stores/tab'
import type { Ask } from './ask'
import type { Command, CommandScreen, KeyPress } from './commands'
import {
  COMMANDS,
  commandById,
  dispatchCommandKey,
  findCommandForKey,
  formatChord,
  paletteCommands,
  runCommand,
} from './commands'

beforeEach(() => {
  接続済みにする()
  SQLタブを一枚にする()
})

afterEach(() => {
  resetDbApi()
})

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

describe('formatChord', () => {
  it('修飾を ⌃⌥⇧⌘ の順に並べ、キーを大文字にする', () => {
    // Arrange
    const chord = { key: 'n', ctrl: true, alt: true, shift: true }

    // Act
    const label = formatChord(chord)

    // Assert
    expect(label).toBe('⌃⌥⇧⌘N')
  })
})

describe('findCommandForKey', () => {
  it.each([
    ['e', {}, 'explain'],
    ['E', { shiftKey: true }, 'explain-actual'],
    ['e', { altKey: true }, 'explain'],
    ['c', { altKey: true }, 'commit'],
    ['r', { altKey: true }, 'rollback'],
    ['s', { altKey: true }, 'csv'],
    ['S', { shiftKey: true }, 'save-query'],
    ['s', {}, 'save-file'],
    ['s', { ctrlKey: true }, 'save-file'],
    ['S', { shiftKey: true, altKey: true }, 'csv'],
    ['o', {}, 'open-file'],
    ['t', {}, 'new-tab'],
    ['w', {}, 'close-tab'],
    ['n', { ctrlKey: true }, 'new-window'],
    ['F', { shiftKey: true }, 'source-search'],
    ['k', {}, 'palette'],
  ] as const)('%s %o は %s に当たる', (key, modifiers, id) => {
    // Arrange
    const press = 打鍵(key, modifiers)

    // Act
    const command = findCommandForKey(press)

    // Assert
    expect(command?.id).toBe(id)
  })

  it.each([
    ['c', {}],
    ['r', {}],
    ['n', {}],
    ['f', {}],
    ['enter', {}],
  ] as const)('%s %o には何も当たらない', (key, modifiers) => {
    // Arrange: 表が振り分けないキーは、CodeMirror などの置き場所のまま残す
    const press = 打鍵(key, modifiers)

    // Act
    const command = findCommandForKey(press)

    // Assert
    expect(command).toBeNull()
  })

  it('⌘ を伴わない打鍵には何も当てない', () => {
    // Arrange
    const press = 打鍵('s', { metaKey: false })

    // Act
    const command = findCommandForKey(press)

    // Assert
    expect(command).toBeNull()
  })
})

describe('dispatchCommandKey', () => {
  it('当たったキーは既定の動作を止めて実行する', () => {
    // Arrange
    const screen = 画面を作る()
    const press = 打鍵('s', { altKey: true })

    // Act
    dispatchCommandKey(press, screen)

    // Assert
    expect(press.止めた).toBe(true)
    expect(screen.記録.CSV).toBe(1)
  })

  it('既に処理された打鍵は二重に扱わない', () => {
    // Arrange: エディタが先に拾ったものである
    const screen = 画面を作る()
    const press = { ...打鍵('k'), defaultPrevented: true }

    // Act
    dispatchCommandKey(press, screen)

    // Assert
    expect(screen.記録.パレット).toBe(0)
  })

  it('今使えないコマンドは実行しないが、既定の動作は止める', () => {
    // Arrange: パレットは繋がっていなければ開かない（ADR 0018）
    未接続にする()
    const screen = 画面を作る()
    const press = 打鍵('k')

    // Act
    dispatchCommandKey(press, screen)

    // Assert
    expect(press.止めた).toBe(true)
    expect(screen.記録.パレット).toBe(0)
  })

  it('当たらないキーは既定の動作を止めない', () => {
    // Arrange
    const screen = 画面を作る()
    const press = 打鍵('c')

    // Act
    dispatchCommandKey(press, screen)

    // Assert
    expect(press.止めた).toBe(false)
  })

  it('⌘T で新しいタブを開く', () => {
    // Arrange
    const screen = 画面を作る()

    // Act
    dispatchCommandKey(打鍵('t'), screen)

    // Assert
    expect(useTabStore.getState().tabs).toHaveLength(2)
  })
})

describe('paletteCommands', () => {
  it('表の順に、キーの表記を添えて並べる', () => {
    // Arrange
    const executed: string[] = []

    // Act
    const items = paletteCommands((command) => executed.push(command.id))

    // Assert: 表を作る前にパレットへ並べていた一覧と同じである
    expect(items.map((item) => [item.id, item.label, item.shortcut])).toEqual([
      ['run', '実行（カーソル位置の文）', '⌘⏎'],
      ['run-selection', '選択範囲のみ実行', '⇧⌘⏎'],
      ['run-script', 'すべて実行', '⌥⌘⏎'],
      ['explain', '実行計画を生成', '⌘E'],
      ['explain-actual', '実測付きで実行計画を生成', '⇧⌘E'],
      ['cancel', '実行を中止', '⌘.'],
      ['format', 'SQL を整形', '⇧⌥F'],
      ['csv', '結果を CSV で保存', '⌥⌘S'],
      ['commit', 'コミット', '⌥⌘C'],
      ['rollback', 'ロールバック', '⌥⌘R'],
      ['save-query', 'クエリを保存済みへ追加', '⇧⌘S'],
      ['save-file', 'ファイルに保存', '⌘S'],
      ['open-file', 'ファイルを開く', '⌘O'],
      ['new-tab', '新しいタブ', '⌘T'],
      ['new-window', '別の接続を新しいウィンドウで開く', '⌃⌘N'],
      ['source-search', 'オブジェクトのソースを検索', '⇧⌘F'],
      ['sessions', 'セッションとロックを開く', ''],
      ['reload-schemas', 'スキーマを再読み込み', ''],
      ['settings', '設定を開く', ''],
    ])
  })

  it('選ばれた項目は渡した口で実行する', () => {
    // Arrange
    const executed: string[] = []
    const items = paletteCommands((command) => executed.push(command.id))

    // Act
    items.find((item) => item.id === 'commit')?.run()

    // Assert
    expect(executed).toEqual(['commit'])
  })

  it('今使えないコマンドは並べない', () => {
    // Arrange
    未接続にする()

    // Act
    const items = paletteCommands(() => {})

    // Assert
    expect(items.map((item) => item.id)).not.toContain('reload-schemas')
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

  it('ウィンドウで振り分けるキーは重ならない', () => {
    // Arrange: 同じ組み合わせが 2 行にあると、どちらが勝つかが表の並びに隠れる
    const chords = COMMANDS.flatMap((command) =>
      command.key?.owner === 'window' ? [formatChord(command.key.chord)] : [],
    )

    // Act
    const 重なりのない数 = new Set(chords).size

    // Assert
    expect(重なりのない数).toBe(chords.length)
  })
})
