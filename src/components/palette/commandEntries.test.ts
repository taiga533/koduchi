import { beforeEach, describe, expect, it } from 'vitest'
import { COMMANDS } from '../../mediator/commands'
import { resolveKeybindings } from '../../keybindings/bindings'
import { 接続済みにする, 未接続にする } from '../../test/activeConnection'
import { paletteCommands } from './commandEntries'

beforeEach(() => {
  接続済みにする()
})

describe('paletteCommands', () => {
  it('表の順に、既定のキーの表記を添えて並べる', () => {
    // Arrange
    const keybindings = resolveKeybindings(COMMANDS, {})

    // Act
    const items = paletteCommands(COMMANDS, keybindings, () => {})

    // Assert: 既定は VSCode の mac 版に寄せた割り当て（ADR 0037）
    expect(items.map((item) => [item.id, item.label, item.shortcut])).toEqual([
      ['run', '実行（カーソル位置の文）', '⌘⏎'],
      ['run-selection', '選択範囲のみ実行', '⇧⌘⏎'],
      ['run-script', 'すべて実行', '⌥⌘⏎'],
      ['explain', '実行計画を生成', '⌃⌘E'],
      ['explain-actual', '実測付きで実行計画を生成', '⌃⇧⌘E'],
      ['cancel', '実行を中止', '⌘.'],
      ['format', 'SQL を整形', '⌥⇧F'],
      ['csv', '結果を CSV で保存', '⌥⌘S'],
      ['commit', 'コミット', '⌃⌘C'],
      ['rollback', 'ロールバック', '⌃⌘R'],
      ['save-query', 'クエリを保存済みへ追加', '⌃⌘S'],
      ['save-file', 'ファイルに保存', '⌘S'],
      ['save-file-as', '名前を付けて保存', '⇧⌘S'],
      ['open-file', 'ファイルを開く', '⌘O'],
      ['new-tab', '新しいタブ', '⌘N'],
      ['new-window', '別の接続を新しいウィンドウで開く', '⇧⌘N'],
      ['source-search', 'オブジェクトのソースを検索', '⇧⌘F'],
      ['sessions', 'セッションとロックを開く', ''],
      ['reload-schemas', 'スキーマを再読み込み', ''],
      ['settings', '設定を開く', ''],
      ['check-update', 'アップデートを確認', ''],
    ])
  })

  it('割り当て直したキーと外したキーをそのとおりに出す', () => {
    // Arrange
    const keybindings = resolveKeybindings(COMMANDS, { commit: 'ctrl+alt+cmd+c', 'new-tab': '' })

    // Act
    const items = paletteCommands(COMMANDS, keybindings, () => {})

    // Assert
    const shortcutOf = (id: string) => items.find((item) => item.id === id)?.shortcut
    expect(shortcutOf('commit')).toBe('⌃⌥⌘C')
    expect(shortcutOf('new-tab')).toBe('')
  })

  it('選ばれた項目は渡した口で実行する', () => {
    // Arrange
    const executed: string[] = []
    const items = paletteCommands(COMMANDS, resolveKeybindings(COMMANDS, {}), (command) =>
      executed.push(command.id),
    )

    // Act
    items.find((item) => item.id === 'commit')?.run()

    // Assert
    expect(executed).toEqual(['commit'])
  })

  it('今使えないコマンドは並べない', () => {
    // Arrange
    未接続にする()

    // Act
    const items = paletteCommands(COMMANDS, resolveKeybindings(COMMANDS, {}), () => {})

    // Assert
    expect(items.map((item) => item.id)).not.toContain('reload-schemas')
  })
})
