import { describe, expect, it } from 'vitest'
import { nextProgress } from './updater'

describe('nextProgress', () => {
  it('始まりの知らせで全体の大きさを控え受け取った数を 0 にする', () => {
    // Arrange
    const progress = { downloaded: 99, total: null }

    // Act
    const next = nextProgress(progress, { event: 'Started', data: { contentLength: 2048 } })

    // Assert
    expect(next).toEqual({ downloaded: 0, total: 2048 })
  })

  it('全体の大きさが告げられなければ分からないまま進める', () => {
    // Arrange
    const progress = { downloaded: 0, total: null }

    // Act
    const next = nextProgress(progress, { event: 'Started', data: {} })

    // Assert
    expect(next).toEqual({ downloaded: 0, total: null })
  })

  it('かたまりの知らせを受け取った数へ足し上げる', () => {
    // Arrange
    const progress = { downloaded: 100, total: 2048 }

    // Act
    const next = nextProgress(progress, { event: 'Progress', data: { chunkLength: 400 } })

    // Assert
    expect(next).toEqual({ downloaded: 500, total: 2048 })
  })

  it('終わりの知らせでは数を変えない', () => {
    // Arrange
    const progress = { downloaded: 2048, total: 2048 }

    // Act
    const next = nextProgress(progress, { event: 'Finished' })

    // Assert
    expect(next).toEqual(progress)
  })
})
