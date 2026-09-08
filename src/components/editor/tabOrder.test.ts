import { describe, expect, it } from 'vitest'
import { dropIndex, moveItem } from './tabOrder'
import type { TabRect } from './tabOrder'

/**
 * 幅 100px のタブを 4px の間隔で並べた横位置を作る。
 *
 * 中心は左端から 50px の位置にあり、`a` は 50、`b` は 154、`c` は 258 になる。
 *
 * @param ids 並び順に並べたタブの ID
 */
function 等幅に並べる(ids: string[]): TabRect[] {
  return ids.map((id, index) => ({ id, left: index * 104, width: 100 }))
}

describe('moveItem', () => {
  it('前の位置から後ろの位置へ動かすと間の要素が前へ詰まる', () => {
    // Arrange
    const items = ['a', 'b', 'c', 'd']

    // Act
    const moved = moveItem(items, 0, 2)

    // Assert
    expect(moved).toEqual(['b', 'c', 'a', 'd'])
  })

  it('後ろの位置から前の位置へ動かすと間の要素が後ろへずれる', () => {
    // Arrange
    const items = ['a', 'b', 'c', 'd']

    // Act
    const moved = moveItem(items, 3, 1)

    // Assert
    expect(moved).toEqual(['a', 'd', 'b', 'c'])
  })

  it('左端から右端へ動かすと元の左端が 1 つずつ前へ詰まる', () => {
    // Arrange
    const items = ['a', 'b', 'c']

    // Act
    const moved = moveItem(items, 0, 2)

    // Assert
    expect(moved).toEqual(['b', 'c', 'a'])
  })

  it('右端から左端へ動かすと元の右端が先頭に立つ', () => {
    // Arrange
    const items = ['a', 'b', 'c']

    // Act
    const moved = moveItem(items, 2, 0)

    // Assert
    expect(moved).toEqual(['c', 'a', 'b'])
  })

  it('同じ位置へ動かすと元の配列をそのまま返す', () => {
    // Arrange
    const items = ['a', 'b', 'c']

    // Act
    const moved = moveItem(items, 1, 1)

    // Assert
    expect(moved).toBe(items)
  })

  it('範囲の外を指しても並びは変わらない', () => {
    // Arrange
    const items = ['a', 'b', 'c']

    // Act
    const 動かす元が外 = moveItem(items, 3, 0)
    const 動かす先が外 = moveItem(items, 0, -1)

    // Assert
    expect(動かす元が外).toBe(items)
    expect(動かす先が外).toBe(items)
  })

  it('元の配列を書き換えない', () => {
    // Arrange
    const items = ['a', 'b', 'c']

    // Act
    moveItem(items, 0, 2)

    // Assert
    expect(items).toEqual(['a', 'b', 'c'])
  })

  it('1 枚しかなければ動かしようがない', () => {
    // Arrange
    const items = ['a']

    // Act
    const moved = moveItem(items, 0, 0)

    // Assert
    expect(moved).toEqual(['a'])
  })
})

describe('dropIndex', () => {
  it('掴んだタブの上にいる間は今の位置のままである', () => {
    // Arrange
    const rects = 等幅に並べる(['a', 'b', 'c'])

    // Act
    const index = dropIndex(rects, 'b', 154)

    // Assert
    expect(index).toBe(1)
  })

  it('隣のタブの中心を越えるまでは入れ替わらない', () => {
    // Arrange
    const rects = 等幅に並べる(['a', 'b', 'c'])

    // Act: `a` の中心は 50。51 はまだ越えていない
    const index = dropIndex(rects, 'b', 51)

    // Assert
    expect(index).toBe(1)
  })

  it('左隣のタブの中心を越えると 1 つ前へ落ちる', () => {
    // Arrange
    const rects = 等幅に並べる(['a', 'b', 'c'])

    // Act
    const index = dropIndex(rects, 'b', 49)

    // Assert
    expect(index).toBe(0)
  })

  it('右隣のタブの中心を越えると 1 つ後ろへ落ちる', () => {
    // Arrange
    const rects = 等幅に並べる(['a', 'b', 'c'])

    // Act: `c` の中心は 258
    const index = dropIndex(rects, 'b', 259)

    // Assert
    expect(index).toBe(2)
  })

  it('端まで一息に動かすと途中のタブを飛ばして端へ落ちる', () => {
    // Arrange
    const rects = 等幅に並べる(['a', 'b', 'c', 'd'])

    // Act
    const index = dropIndex(rects, 'a', 900)

    // Assert
    expect(index).toBe(3)
  })

  it('左端より外へ出しても先頭より前へは行かない', () => {
    // Arrange
    const rects = 等幅に並べる(['a', 'b', 'c'])

    // Act
    const index = dropIndex(rects, 'c', -500)

    // Assert
    expect(index).toBe(0)
  })

  it('右端より外へ出しても末尾より後ろへは行かない', () => {
    // Arrange
    const rects = 等幅に並べる(['a', 'b', 'c'])

    // Act
    const index = dropIndex(rects, 'a', 5000)

    // Assert
    expect(index).toBe(2)
  })

  it('幅の違うタブでも中心で判定する', () => {
    // Arrange: `a` は幅 40（中心 20）、`b` は幅 200（中心 144）
    const rects: TabRect[] = [
      { id: 'a', left: 0, width: 40 },
      { id: 'b', left: 44, width: 200 },
    ]

    // Act
    const 越える前 = dropIndex(rects, 'a', 143)
    const 越えた後 = dropIndex(rects, 'a', 145)

    // Assert
    expect(越える前).toBe(0)
    expect(越えた後).toBe(1)
  })

  it('一覧に無いタブを掴んでいると答えようがない', () => {
    // Arrange
    const rects = 等幅に並べる(['a', 'b'])

    // Act
    const index = dropIndex(rects, 'z', 100)

    // Assert
    expect(index).toBe(-1)
  })

  it('1 枚しかなければどこへ動かしても先頭のままである', () => {
    // Arrange
    const rects = 等幅に並べる(['a'])

    // Act
    const index = dropIndex(rects, 'a', 800)

    // Assert
    expect(index).toBe(0)
  })
})
