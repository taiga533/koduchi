/**
 * 未コミットのまま閉じさせない確認のテスト（ADR 0012）。
 *
 * 2 段の確認から「コミット / 破棄 / やめる」の 3 択を組み立てられているか、
 * 「やめる」のときに 2 段目を尋ねずに済ませているかを見る。
 */

import { describe, expect, it } from 'vitest'
import { askPendingChoice } from './pendingChanges'

/**
 * 決まった答えを返す確認を作る。尋ねられた回数も数える。
 *
 * @param 閉じる 1 段目の答え
 * @param コミットする 2 段目の答え
 */
function 確認を作る(閉じる: boolean, コミットする: boolean) {
  const 回数 = { close: 0, commit: 0 }
  return {
    回数,
    dialogs: {
      confirmClose: async () => {
        回数.close += 1
        return 閉じる
      },
      confirmCommit: async () => {
        回数.commit += 1
        return コミットする
      },
    },
  }
}

describe('askPendingChoice', () => {
  it('閉じてコミットを選ぶとコミットになる', async () => {
    // Arrange
    const { dialogs } = 確認を作る(true, true)

    // Act
    const choice = await askPendingChoice(dialogs)

    // Assert
    expect(choice).toBe('commit')
  })

  it('閉じて破棄を選ぶと破棄になる', async () => {
    // Arrange
    const { dialogs } = 確認を作る(true, false)

    // Act
    const choice = await askPendingChoice(dialogs)

    // Assert
    expect(choice).toBe('discard')
  })

  it('やめるを選ぶとやめるになる', async () => {
    // Arrange
    const { dialogs } = 確認を作る(false, true)

    // Act
    const choice = await askPendingChoice(dialogs)

    // Assert
    expect(choice).toBe('cancel')
  })

  it('やめるを選んだときは変更の扱いを尋ねない', async () => {
    // Arrange
    const { dialogs, 回数 } = 確認を作る(false, true)

    // Act
    await askPendingChoice(dialogs)

    // Assert
    expect(回数.close).toBe(1)
    expect(回数.commit).toBe(0)
  })
})
