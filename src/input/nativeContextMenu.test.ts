import { afterEach, describe, expect, it } from 'vitest'
import { installNativeMenuGuard, shouldKeepNativeMenu } from './nativeContextMenu'

/** 選択の代わり。`rects` に入れた矩形の上に文字が選ばれている。 */
function 選択(rects: { left: number; right: number; top: number; bottom: number }[]) {
  return {
    isCollapsed: rects.length === 0,
    rangeCount: rects.length === 0 ? 0 : 1,
    getRangeAt: () => ({ getClientRects: () => rects }),
  }
}

/** 選択の無い状態。 */
const 選択なし = 選択([])

/** 10〜60 × 20〜34 に選んだ文字がある状態。 */
const 一語の選択 = 選択([{ left: 10, right: 60, top: 20, bottom: 34 }])

afterEach(() => {
  document.body.innerHTML = ''
})

describe('shouldKeepNativeMenu', () => {
  it('何も無い場所では既定のメニューを止める', () => {
    // Arrange
    const 空き = document.createElement('div')
    document.body.append(空き)

    // Act / Assert
    expect(shouldKeepNativeMenu(空き, { x: 5, y: 5 }, 選択なし)).toBe(false)
  })

  it('入力欄と textarea では残す', () => {
    // Arrange
    const 入力欄 = document.createElement('input')
    const 複数行 = document.createElement('textarea')
    document.body.append(入力欄, 複数行)

    // Act / Assert
    expect(shouldKeepNativeMenu(入力欄, { x: 5, y: 5 }, 選択なし)).toBe(true)
    expect(shouldKeepNativeMenu(複数行, { x: 5, y: 5 }, 選択なし)).toBe(true)
  })

  it('エディタの本文（contenteditable）の中では残す', () => {
    // Arrange
    const 本文 = document.createElement('div')
    本文.setAttribute('contenteditable', 'true')
    const 行 = document.createElement('div')
    本文.append(行)
    document.body.append(本文)

    // Act / Assert
    expect(shouldKeepNativeMenu(行, { x: 5, y: 5 }, 選択なし)).toBe(true)
  })

  it('選んだ文字の上では残す', () => {
    // Arrange
    const ログ = document.createElement('pre')
    document.body.append(ログ)

    // Act / Assert
    expect(shouldKeepNativeMenu(ログ, { x: 30, y: 25 }, 一語の選択)).toBe(true)
  })

  it('選択を残したまま同じ要素の選んでいない所を押したら止める', () => {
    // Arrange
    const ログ = document.createElement('pre')
    document.body.append(ログ)

    // Act / Assert
    expect(shouldKeepNativeMenu(ログ, { x: 200, y: 25 }, 一語の選択)).toBe(false)
  })
})

describe('installNativeMenuGuard', () => {
  it('何も無い場所の右クリックで既定の動作を止め、外すと止めなくなる', () => {
    // Arrange
    const 空き = document.createElement('div')
    document.body.append(空き)
    const 外す = installNativeMenuGuard(window)

    // Act
    const 張っている間 = 空き.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    )
    外す()
    const 外した後 = 空き.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    )

    // Assert: `dispatchEvent` は既定動作を止められたときに偽を返す
    expect(張っている間).toBe(false)
    expect(外した後).toBe(true)
  })

  it('入力欄の右クリックは止めない', () => {
    // Arrange
    const 入力欄 = document.createElement('input')
    document.body.append(入力欄)
    const 外す = installNativeMenuGuard(window)

    // Act
    const 既定動作 = 入力欄.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    )
    外す()

    // Assert
    expect(既定動作).toBe(true)
  })
})
