/**
 * 未コミットのまま接続を手放させない確認のテスト（ADR 0012）。
 *
 * 2 段の確認から「コミット / 破棄 / やめる」の 3 択を組み立てられているか、
 * 「やめる」のときに 2 段目を尋ねずに済ませているかを見る。
 */

import { afterEach, describe, expect, it } from 'vitest'
import {
  askPendingChoice,
  CLOSE_WORDING,
  DISCONNECT_WORDING,
  resetPendingDialogs,
  setPendingDialogs,
} from './pendingChanges'

/**
 * 決まった答えを返す確認へ差し替える。尋ねられた回数と文言も記録する。
 *
 * @param 進む 1 段目の答え
 * @param コミットする 2 段目の答え
 */
function 確認を差し替える(進む: boolean, コミットする: boolean) {
  const 記録 = { proceed: 0, commit: 0, question: '', okLabel: '' }

  setPendingDialogs((wording) => {
    記録.question = wording.question
    記録.okLabel = wording.okLabel
    return {
      confirmProceed: async () => {
        記録.proceed += 1
        return 進む
      },
      confirmCommit: async () => {
        記録.commit += 1
        return コミットする
      },
    }
  })

  return 記録
}

afterEach(() => {
  resetPendingDialogs()
})

describe('askPendingChoice', () => {
  it('進んでコミットを選ぶとコミットになる', async () => {
    // Arrange
    確認を差し替える(true, true)

    // Act
    const choice = await askPendingChoice(CLOSE_WORDING)

    // Assert
    expect(choice).toBe('commit')
  })

  it('進んで破棄を選ぶと破棄になる', async () => {
    // Arrange
    確認を差し替える(true, false)

    // Act
    const choice = await askPendingChoice(CLOSE_WORDING)

    // Assert
    expect(choice).toBe('discard')
  })

  it('やめるを選ぶとやめるになる', async () => {
    // Arrange
    確認を差し替える(false, true)

    // Act
    const choice = await askPendingChoice(CLOSE_WORDING)

    // Assert
    expect(choice).toBe('cancel')
  })

  it('やめるを選んだときは変更の扱いを尋ねない', async () => {
    // Arrange
    const 記録 = 確認を差し替える(false, true)

    // Act
    await askPendingChoice(CLOSE_WORDING)

    // Assert
    expect(記録.proceed).toBe(1)
    expect(記録.commit).toBe(0)
  })

  it('閉じるときと切断のときで問いかけが変わる', async () => {
    // Arrange
    const 記録 = 確認を差し替える(false, false)

    // Act
    await askPendingChoice(CLOSE_WORDING)
    const 閉じるときの問い = 記録.question
    await askPendingChoice(DISCONNECT_WORDING)

    // Assert
    expect(閉じるときの問い).toContain('閉じますか')
    expect(記録.question).toContain('切断しますか')
    expect(記録.okLabel).toBe('切断')
  })
})
