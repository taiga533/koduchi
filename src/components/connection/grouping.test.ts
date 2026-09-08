/**
 * 接続をグループへ束ねる決まりごとのテスト（ADR 0015）。
 *
 * 並びの決まりは描画から切り離してあるため、ここでは純粋な関数だけを見る。
 */

import { describe, expect, it } from 'vitest'
import type { SavedConnection } from '../../types/db'
import { collectGroupNames, groupConnections, normalizeGroup } from './grouping'

/**
 * 試験用の接続を 1 件作る。
 *
 * @param id 一意 ID
 * @param group グループ名。未指定なら `null`
 */
function 接続(id: string, group: string | null): SavedConnection {
  return {
    id,
    name: id,
    username: 'koduchi',
    readOnly: false,
    autoCommit: false,
    color: 'none',
    group,
    schemaFilter: { excludeSystem: true, hideEmpty: true },
    completion: { identifierCase: 'preserve' },
    target: { method: 'ezConnect', host: 'localhost', port: 1521, serviceName: 'FREEPDB1' },
  }
}

describe('normalizeGroup', () => {
  it('前後の空白を落とす', () => {
    // Arrange
    const 入力 = '  本番  '

    // Act
    const 結果 = normalizeGroup(入力)

    // Assert
    expect(結果).toBe('本番')
  })

  it('空白だけの名前は未指定として扱う', () => {
    // Arrange
    const 入力 = '   '

    // Act
    const 結果 = normalizeGroup(入力)

    // Assert
    expect(結果).toBeNull()
  })

  it('未指定はそのまま未指定になる', () => {
    // Arrange & Act
    const 結果 = normalizeGroup(null)

    // Assert
    expect(結果).toBeNull()
  })
})

describe('groupConnections', () => {
  it('グループ未指定の接続は見出しの無い組として先頭に来る', () => {
    // Arrange
    const 一覧 = [接続('a', '本番'), 接続('b', null)]

    // Act
    const 組 = groupConnections(一覧)

    // Assert
    expect(組[0].name).toBeNull()
    expect(組[0].connections.map((c) => c.id)).toEqual(['b'])
  })

  it('グループは最初に現れた順に並ぶ', () => {
    // Arrange: 名前で並べ替えるなら「開発」が先に来る並びにしてある
    const 一覧 = [接続('a', '本番'), 接続('b', '開発'), 接続('c', '本番')]

    // Act
    const 組 = groupConnections(一覧)

    // Assert
    expect(組.map((group) => group.name)).toEqual(['本番', '開発'])
  })

  it('同じグループの接続は渡された順のままひとつに束ねられる', () => {
    // Arrange
    const 一覧 = [接続('a', '本番'), 接続('b', '開発'), 接続('c', '本番')]

    // Act
    const 組 = groupConnections(一覧)

    // Assert
    expect(組[0].connections.map((c) => c.id)).toEqual(['a', 'c'])
  })

  it('前後の空白しか違わないグループ名はひとつに束ねられる', () => {
    // Arrange
    const 一覧 = [接続('a', '本番'), 接続('b', ' 本番 ')]

    // Act
    const 組 = groupConnections(一覧)

    // Assert
    expect(組).toHaveLength(1)
    expect(組[0].name).toBe('本番')
  })

  it('グループを使っていなければ組はひとつだけになる', () => {
    // Arrange
    const 一覧 = [接続('a', null), 接続('b', null)]

    // Act
    const 組 = groupConnections(一覧)

    // Assert
    expect(組).toEqual([{ name: null, connections: 一覧 }])
  })

  it('接続が無ければ組も無い', () => {
    // Arrange & Act
    const 組 = groupConnections([])

    // Assert
    expect(組).toEqual([])
  })
})

describe('collectGroupNames', () => {
  it('使われているグループ名を現れた順に重複なく返す', () => {
    // Arrange
    const 一覧 = [接続('a', '本番'), 接続('b', null), 接続('c', '開発'), 接続('d', '本番')]

    // Act
    const 名前 = collectGroupNames(一覧)

    // Assert
    expect(名前).toEqual(['本番', '開発'])
  })
})
