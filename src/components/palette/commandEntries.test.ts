import { beforeEach, describe, expect, it } from 'vitest'
import { COMMANDS } from '../../mediator/commands'
import { 接続済みにする, 未接続にする } from '../../test/activeConnection'
import { formatChord, paletteCommands, shortcutLabel } from './commandEntries'

beforeEach(() => {
  接続済みにする()
})

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

describe('shortcutLabel', () => {
  it('キーの無いコマンドは空文字にする', () => {
    // Arrange
    const command = { id: 'x', label: 'x', key: null, inPalette: true, run: () => {} }

    // Act
    const label = shortcutLabel(command)

    // Assert
    expect(label).toBe('')
  })

  it('CodeMirror が持つキーは表に書いた表記をそのまま使う', () => {
    // Arrange
    const command = {
      id: 'x',
      label: 'x',
      key: { owner: 'editor' as const, label: '⌘⏎' },
      inPalette: true,
      run: () => {},
    }

    // Act
    const label = shortcutLabel(command)

    // Assert
    expect(label).toBe('⌘⏎')
  })
})

describe('paletteCommands', () => {
  it('表の順に、キーの表記を添えて並べる', () => {
    // Arrange
    const executed: string[] = []

    // Act
    const items = paletteCommands(COMMANDS, (command) => executed.push(command.id))

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
    const items = paletteCommands(COMMANDS, (command) => executed.push(command.id))

    // Act
    items.find((item) => item.id === 'commit')?.run()

    // Assert
    expect(executed).toEqual(['commit'])
  })

  it('今使えないコマンドは並べない', () => {
    // Arrange
    未接続にする()

    // Act
    const items = paletteCommands(COMMANDS, () => {})

    // Assert
    expect(items.map((item) => item.id)).not.toContain('reload-schemas')
  })
})
