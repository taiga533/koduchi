import { describe, expect, it } from 'vitest'
import { dispatchEscape, escapeHandlerCount, pushEscapeHandler } from './escapeStack'

/** 呼ばれたことを記録しない受け手。数だけを見るテストで使う。 */
function 何もしない(): void {}

describe('escapeStack', () => {
  it('受け手が居なければ何も走らせずに偽を返す', () => {
    // Arrange & Act
    const 走った = dispatchEscape()

    // Assert
    expect(走った).toBe(false)
  })

  it('積んだ受け手を走らせて真を返す', () => {
    // Arrange
    const 呼ばれた: string[] = []
    const 外す = pushEscapeHandler(() => 呼ばれた.push('だけ'))

    // Act
    const 走った = dispatchEscape()

    // Assert
    expect(走った).toBe(true)
    expect(呼ばれた).toEqual(['だけ'])
    外す()
  })

  it('重なっているときはいちばん後に積んだものだけが走る', () => {
    // Arrange
    const 呼ばれた: string[] = []
    const 外す下 = pushEscapeHandler(() => 呼ばれた.push('下'))
    const 外す上 = pushEscapeHandler(() => 呼ばれた.push('上'))

    // Act
    dispatchEscape()

    // Assert
    expect(呼ばれた).toEqual(['上'])
    外す上()
    外す下()
  })

  it('手前を外すと 1 つ前の受け手へ戻る', () => {
    // Arrange
    const 呼ばれた: string[] = []
    const 外す下 = pushEscapeHandler(() => 呼ばれた.push('下'))
    const 外す上 = pushEscapeHandler(() => 呼ばれた.push('上'))

    // Act
    外す上()
    dispatchEscape()

    // Assert
    expect(呼ばれた).toEqual(['下'])
    外す下()
  })

  it('真ん中を外しても残りの順序が崩れない', () => {
    // Arrange
    const 呼ばれた: string[] = []
    const 外す下 = pushEscapeHandler(() => 呼ばれた.push('下'))
    const 外す中 = pushEscapeHandler(() => 呼ばれた.push('中'))
    const 外す上 = pushEscapeHandler(() => 呼ばれた.push('上'))

    // Act
    外す中()
    dispatchEscape()

    // Assert
    expect(呼ばれた).toEqual(['上'])
    外す上()
    dispatchEscape()
    expect(呼ばれた).toEqual(['上', '下'])
    外す下()
  })

  it('外す関数を二度呼んでも隣の受け手を巻き添えにしない', () => {
    // Arrange
    const 呼ばれた: string[] = []
    const 外す下 = pushEscapeHandler(() => 呼ばれた.push('下'))
    const 外す上 = pushEscapeHandler(() => 呼ばれた.push('上'))

    // Act
    外す上()
    外す上()
    dispatchEscape()

    // Assert
    expect(呼ばれた).toEqual(['下'])
    expect(escapeHandlerCount()).toBe(1)
    外す下()
  })

  it('同じ関数を二度積んだときは 1 度外すと 1 つだけ減る', () => {
    // Arrange
    const 外す1 = pushEscapeHandler(何もしない)
    const 外す2 = pushEscapeHandler(何もしない)

    // Act
    外す1()

    // Assert
    expect(escapeHandlerCount()).toBe(1)
    外す2()
    expect(escapeHandlerCount()).toBe(0)
  })

  it('外し終えれば数は 0 に戻る', () => {
    // Arrange
    const 外す = pushEscapeHandler(何もしない)

    // Act
    外す()

    // Assert
    expect(escapeHandlerCount()).toBe(0)
  })
})
