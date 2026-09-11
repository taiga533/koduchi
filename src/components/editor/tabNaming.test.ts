/**
 * タブに出す名前の決め方のテスト（ADR 0032）。
 *
 * 見るのは「自動の名前と利用者の名前のどちらが出るか」「付け直しを取り消せるか」
 * 「隠れた名前が辿れるか」「定義タブが守られているか」の 4 つである。
 */

import { describe, expect, it } from 'vitest'
import type { DefinitionEditorTab, SqlTab } from '../../stores/tab'
import {
  canRenameTab,
  normalizeTabName,
  tabBaseName,
  tabDisplayName,
  tabFileName,
  tabTitle,
} from './tabNaming'

/**
 * SQL タブを 1 枚作る。
 *
 * @param overrides 上書きしたい項目
 */
function SQLタブ(overrides: Partial<SqlTab> = {}): SqlTab {
  return {
    kind: 'sql',
    id: 't1',
    name: '無題-1.sql',
    customName: null,
    filePath: null,
    content: '',
    dirty: false,
    ...overrides,
  }
}

/** 出荷表の定義タブ 1 枚（ADR 0022）。 */
const 定義タブ: DefinitionEditorTab = {
  kind: 'definition',
  id: 'd1',
  name: 'SHIPMENTS',
  target: { owner: 'KODUCHI', name: 'SHIPMENTS', kind: 'table' },
}

describe('normalizeTabName', () => {
  it('前後の空白を落とした名前を返す', () => {
    // Arrange
    const 入力 = '  売上集計  '

    // Act
    const 結果 = normalizeTabName(入力)

    // Assert
    expect(結果).toBe('売上集計')
  })

  it('空文字は自動の名前へ戻す指示になる', () => {
    // Arrange
    const 入力 = ''

    // Act
    const 結果 = normalizeTabName(入力)

    // Assert
    expect(結果).toBeNull()
  })

  it('空白だけの名前も自動の名前へ戻す指示になる', () => {
    // Arrange
    const 入力 = '   \t '

    // Act
    const 結果 = normalizeTabName(入力)

    // Assert
    expect(結果).toBeNull()
  })

  it('中の空白は残す', () => {
    // Arrange
    const 入力 = '売上 集計'

    // Act
    const 結果 = normalizeTabName(入力)

    // Assert
    expect(結果).toBe('売上 集計')
  })
})

describe('tabDisplayName', () => {
  it('付け直していないタブは自動の名前を出す', () => {
    // Arrange
    const tab = SQLタブ()

    // Act
    const 結果 = tabDisplayName(tab)

    // Assert
    expect(結果).toBe('無題-1.sql')
  })

  it('付け直したタブは利用者の名前を出す', () => {
    // Arrange
    const tab = SQLタブ({ customName: '売上集計' })

    // Act
    const 結果 = tabDisplayName(tab)

    // Assert
    expect(結果).toBe('売上集計')
  })

  it('ファイルを開いたタブでも利用者の名前が勝つ', () => {
    // Arrange
    const tab = SQLタブ({ name: 'users.sql', filePath: '/tmp/users.sql', customName: '利用者' })

    // Act
    const 結果 = tabDisplayName(tab)

    // Assert
    expect(結果).toBe('利用者')
  })

  it('定義タブはオブジェクト名を出す', () => {
    // Arrange
    const tab = 定義タブ

    // Act
    const 結果 = tabDisplayName(tab)

    // Assert
    expect(結果).toBe('SHIPMENTS')
  })
})

describe('tabTitle', () => {
  it('付け直していないタブは名前だけを出す', () => {
    // Arrange
    const tab = SQLタブ()

    // Act
    const 結果 = tabTitle(tab)

    // Assert
    expect(結果).toBe('無題-1.sql')
  })

  it('付け直したタブは隠れた自動の名前も添える', () => {
    // Arrange
    const tab = SQLタブ({ name: 'users.sql', customName: '利用者' })

    // Act
    const 結果 = tabTitle(tab)

    // Assert
    expect(結果).toBe('利用者（users.sql）')
  })

  it('自動の名前と同じ名前を付け直したときは重ねて出さない', () => {
    // Arrange
    const tab = SQLタブ({ customName: '無題-1.sql' })

    // Act
    const 結果 = tabTitle(tab)

    // Assert
    expect(結果).toBe('無題-1.sql')
  })
})

describe('canRenameTab', () => {
  it('SQL タブは名前を付け直せる', () => {
    // Arrange
    const tab = SQLタブ()

    // Act
    const 結果 = canRenameTab(tab)

    // Assert
    expect(結果).toBe(true)
  })

  it('定義タブは名前を付け直せない', () => {
    // Arrange
    const tab = 定義タブ

    // Act
    const 結果 = canRenameTab(tab)

    // Assert
    expect(結果).toBe(false)
  })
})

describe('tabBaseName', () => {
  it('自動の名前から拡張子を落とす', () => {
    // Arrange
    const tab = SQLタブ({ name: 'users.sql' })

    // Act
    const 結果 = tabBaseName(tab)

    // Assert
    expect(結果).toBe('users')
  })

  it('付け直した名前が元になる', () => {
    // Arrange
    const tab = SQLタブ({ name: '無題-3.sql', customName: '売上集計' })

    // Act
    const 結果 = tabBaseName(tab)

    // Assert
    expect(結果).toBe('売上集計')
  })

  it('付け直した名前の末尾の拡張子も落とす', () => {
    // Arrange
    const tab = SQLタブ({ customName: '売上集計.sql' })

    // Act
    const 結果 = tabBaseName(tab)

    // Assert
    expect(結果).toBe('売上集計')
  })
})

describe('tabFileName', () => {
  it('自動の名前はそのままファイル名になる', () => {
    // Arrange
    const tab = SQLタブ({ name: 'users.sql' })

    // Act
    const 結果 = tabFileName(tab)

    // Assert
    expect(結果).toBe('users.sql')
  })

  it('付け直した名前には拡張子を補う', () => {
    // Arrange
    const tab = SQLタブ({ customName: '売上集計' })

    // Act
    const 結果 = tabFileName(tab)

    // Assert
    expect(結果).toBe('売上集計.sql')
  })

  it('パスの区切りは落として保存先が変わらないようにする', () => {
    // Arrange
    const tab = SQLタブ({ customName: '売上/集計' })

    // Act
    const 結果 = tabFileName(tab)

    // Assert
    expect(結果).toBe('売上-集計.sql')
  })
})
