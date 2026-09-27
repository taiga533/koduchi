import { describe, expect, it } from 'vitest'
import { formatProgress, progressRatio } from './progress'

const MB = 1024 * 1024

describe('progressRatio', () => {
  it('全体の大きさが分かれば割合を返す', () => {
    // Arrange
    const progress = { downloaded: 5 * MB, total: 20 * MB }

    // Act
    const ratio = progressRatio(progress)

    // Assert
    expect(ratio).toBe(0.25)
  })

  it('全体の大きさが分からなければ割合を出さない', () => {
    // Arrange
    const progress = { downloaded: 5 * MB, total: null }

    // Act
    const ratio = progressRatio(progress)

    // Assert
    expect(ratio).toBeNull()
  })

  it('全体が 0 と告げられても割合を出さない', () => {
    // Arrange
    const progress = { downloaded: 0, total: 0 }

    // Act
    const ratio = progressRatio(progress)

    // Assert
    expect(ratio).toBeNull()
  })

  it('告げられた全体を超えて受け取っても 1 で止める', () => {
    // Arrange
    const progress = { downloaded: 21 * MB, total: 20 * MB }

    // Act
    const ratio = progressRatio(progress)

    // Assert
    expect(ratio).toBe(1)
  })
})

describe('formatProgress', () => {
  it('全体の大きさが分かれば受け取った量と全体を MB で並べる', () => {
    // Arrange
    const progress = { downloaded: 3.2 * MB, total: 15.1 * MB }

    // Act
    const text = formatProgress(progress)

    // Assert
    expect(text).toBe('3.2 MB / 15.1 MB')
  })

  it('全体の大きさが分からなければ受け取った量だけを出す', () => {
    // Arrange
    const progress = { downloaded: 3.2 * MB, total: null }

    // Act
    const text = formatProgress(progress)

    // Assert
    expect(text).toBe('3.2 MB')
  })
})
