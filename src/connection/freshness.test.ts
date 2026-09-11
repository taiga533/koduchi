/**
 * 往復の古さの言い方のテスト（ADR 0030）。
 *
 * 表示の文言そのものではなく、**境目でどちらを言うか**を数え上げて確かめる。
 * 「言わない」と決めた場合に何かを言ってしまうのが、この機能のいちばんの
 * 失敗だからである。
 */

import { describe, expect, it } from 'vitest'
import { describeStaleness, formatElapsed, FRESH_WINDOW_MS } from './freshness'

/** 1 分のミリ秒。 */
const 分 = 60 * 1000

/** 1 時間のミリ秒。 */
const 時間 = 60 * 分

/** 1 日のミリ秒。 */
const 日 = 24 * 時間

describe('formatElapsed', () => {
  it('1 分に満たない経過は分を出さない', () => {
    // Arrange & Act
    const 表現 = formatElapsed(59 * 1000)

    // Assert
    expect(表現).toBe('1 分未満前')
  })

  it('1 時間に満たない経過は分で言う', () => {
    // Arrange & Act & Assert
    expect(formatElapsed(分)).toBe('1 分前')
    expect(formatElapsed(12 * 分)).toBe('12 分前')
    expect(formatElapsed(59 * 分)).toBe('59 分前')
  })

  it('1 日に満たない経過は時間で言う', () => {
    // Arrange & Act & Assert
    expect(formatElapsed(時間)).toBe('1 時間前')
    expect(formatElapsed(23 * 時間)).toBe('23 時間前')
  })

  it('1 日を超えた経過は日で言う', () => {
    // Arrange & Act & Assert
    expect(formatElapsed(日)).toBe('1 日前')
    expect(formatElapsed(3 * 日 + 5 * 時間)).toBe('3 日前')
  })

  it('端数は切り捨てる', () => {
    // Arrange: 繰り上げると、まだ経っていない時間を経ったことにしてしまう

    // Act & Assert
    expect(formatElapsed(12 * 分 + 59 * 1000)).toBe('12 分前')
    expect(formatElapsed(時間 - 1)).toBe('59 分前')
  })

  it('負の経過は 0 として扱う', () => {
    // Arrange: 時計が巻き戻っていても落とさない

    // Act & Assert
    expect(formatElapsed(-5 * 分)).toBe('1 分未満前')
  })
})

describe('describeStaleness', () => {
  it('猶予の内に収まっていれば何も言わない', () => {
    // Arrange
    const 今 = 1_000_000_000_000

    // Act
    const 一言 = describeStaleness(今 - (FRESH_WINDOW_MS - 1), 今)

    // Assert
    expect(一言).toBeNull()
  })

  it('猶予をちょうど過ぎたら言い始める', () => {
    // Arrange
    const 今 = 1_000_000_000_000

    // Act
    const 一言 = describeStaleness(今 - FRESH_WINDOW_MS, 今)

    // Assert
    expect(一言).not.toBeNull()
    expect(一言?.label).toBe('最終応答 5 分前')
  })

  it('経過が長くなれば文言もそれに従う', () => {
    // Arrange
    const 今 = 1_000_000_000_000

    // Act
    const 十二分 = describeStaleness(今 - 12 * 分, 今)
    const 二時間 = describeStaleness(今 - 2 * 時間, 今)

    // Assert
    expect(十二分?.label).toBe('最終応答 12 分前')
    expect(二時間?.label).toBe('最終応答 2 時間前')
  })

  it('説明には往復したときにしか確かめないことを書く', () => {
    // Arrange: 緑が出ていないことの理由を、押す前に読めるようにする
    const 今 = 1_000_000_000_000

    // Act
    const 一言 = describeStaleness(今 - 30 * 分, 今)

    // Assert
    expect(一言?.title).toContain('30 分前')
    expect(一言?.title).toContain('問い合わせたときにしか')
  })

  it('最後の往復が未来の時刻でも何も言わない', () => {
    // Arrange: 時計が巻き戻っただけで「応答がありません」と言わない
    const 今 = 1_000_000_000_000

    // Act
    const 一言 = describeStaleness(今 + 時間, 今)

    // Assert
    expect(一言).toBeNull()
  })
})
