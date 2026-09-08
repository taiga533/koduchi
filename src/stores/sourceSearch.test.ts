/**
 * オブジェクトのソース検索のストアのテスト（ADR 0021）。
 *
 * データベースからは `src/api/` 層の差し替えで切り離す（ADR 0010）。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDbApi, setDbApi } from '../api/db'
import { createFakeDbApi, type FakeCalls } from '../test/fakeDbApi'
import type { SourceSearchResult } from '../types/db'
import {
  canSearch,
  summarizeSourceResult,
  SOURCE_SEARCH_LIMIT,
  useSourceSearchStore,
} from './sourceSearch'

/** パッケージ本体が 2 行、トリガーが 1 行当たった結果。 */
const 当たり: SourceSearchResult = {
  objects: [
    {
      owner: 'KODUCHI',
      name: 'ORDER_AUDIT',
      kind: 'packageBody',
      lines: [
        { line: 4, text: '    UPDATE koduchi.user_traits' },
        { line: 12, text: '    FROM koduchi.user_traits' },
      ],
    },
    {
      owner: 'KODUCHI',
      name: 'TRG_USER_TRAITS_TOUCH',
      kind: 'trigger',
      lines: [{ line: 1, text: 'BEFORE UPDATE ON koduchi.user_traits' }],
    },
  ],
  matchedLines: 3,
  truncated: false,
}

let calls: FakeCalls

beforeEach(() => {
  const fake = createFakeDbApi({
    sourceMatches: 当たり,
    sourceLines: [
      { line: 3, text: '  BEGIN' },
      { line: 4, text: '    UPDATE koduchi.user_traits' },
      { line: 5, text: '       SET segment = p_segment' },
    ],
  })
  calls = fake.calls
  setDbApi(fake.api)
  useSourceSearchStore.getState().clear()
})

afterEach(() => {
  resetDbApi()
})

describe('useSourceSearchStore', () => {
  it('検索すると当たったオブジェクトが入る', async () => {
    // Arrange
    useSourceSearchStore.getState().setNeedle('user_traits')

    // Act
    await useSourceSearchStore.getState().search('c1')

    // Assert
    const state = useSourceSearchStore.getState()
    expect(state.status).toBe('ready')
    expect(state.result?.objects).toHaveLength(2)
    expect(calls.searchSource).toHaveLength(1)
  })

  it('検索の求めには打った語と条件がそのまま載る', async () => {
    // Arrange
    const store = useSourceSearchStore.getState()
    store.setNeedle('  user_traits  ')
    store.setOwner('KODUCHI')
    store.setCaseSensitive(true)
    store.toggleKind('trigger')

    // Act
    await useSourceSearchStore.getState().search('c1')

    // Assert: 前後の空白は落として渡す
    expect(calls.searchSource[0].request).toEqual({
      needle: 'user_traits',
      owner: 'KODUCHI',
      kinds: expect.objectContaining({ trigger: false, packageBody: true }),
      caseSensitive: true,
      limit: SOURCE_SEARCH_LIMIT,
    })
  })

  it('短すぎる検索語では問い合わせに行かない', async () => {
    // Arrange: 上限まで拾って終わるだけの語で待たせない（ADR 0021）
    useSourceSearchStore.getState().setNeedle('a')

    // Act
    await useSourceSearchStore.getState().search('c1')

    // Assert
    const state = useSourceSearchStore.getState()
    expect(state.status).toBe('failed')
    expect(state.error).toContain('2 文字以上')
    expect(calls.searchSource).toHaveLength(0)
  })

  it('権限で読めなかったことは空の結果と区別する', async () => {
    // Arrange: 「見えない」と「無い」は別物である（ADR 0017 の区分）
    const fake = createFakeDbApi({
      sourceError: { kind: 'permission', message: 'ALL_SOURCE を参照できません' },
    })
    setDbApi(fake.api)
    useSourceSearchStore.getState().setNeedle('orders')

    // Act
    await useSourceSearchStore.getState().search('c1')

    // Assert
    const state = useSourceSearchStore.getState()
    expect(state.permissionDenied).toBe(true)
    expect(state.result).toBeNull()
  })

  it('当たり行を選ぶとその前後を読む', async () => {
    // Arrange
    useSourceSearchStore.getState().setNeedle('user_traits')
    await useSourceSearchStore.getState().search('c1')
    const object = useSourceSearchStore.getState().result!.objects[0]

    // Act
    await useSourceSearchStore.getState().select('c1', object, 4)

    // Assert
    const state = useSourceSearchStore.getState()
    expect(state.selected).toEqual({
      owner: 'KODUCHI',
      name: 'ORDER_AUDIT',
      kind: 'packageBody',
      line: 4,
    })
    expect(state.context).toHaveLength(3)
    expect(calls.sourceContext[0]).toEqual({
      id: 'c1',
      target: { owner: 'KODUCHI', name: 'ORDER_AUDIT', kind: 'packageBody' },
      line: 4,
    })
  })

  it('検索し直すと前の選択は解ける', async () => {
    // Arrange
    useSourceSearchStore.getState().setNeedle('user_traits')
    await useSourceSearchStore.getState().search('c1')
    const object = useSourceSearchStore.getState().result!.objects[0]
    await useSourceSearchStore.getState().select('c1', object, 4)

    // Act
    await useSourceSearchStore.getState().search('c1')

    // Assert: 前の結果に属する選択を残すと、別の当たりの前後を見ているように読める
    expect(useSourceSearchStore.getState().selected).toBeNull()
  })

  it('切断で捨てると条件も結果も初期値へ戻る', async () => {
    // Arrange
    useSourceSearchStore.getState().setNeedle('user_traits')
    await useSourceSearchStore.getState().search('c1')

    // Act
    useSourceSearchStore.getState().clear()

    // Assert
    const state = useSourceSearchStore.getState()
    expect(state.needle).toBe('')
    expect(state.result).toBeNull()
    expect(state.status).toBe('idle')
  })
})

describe('canSearch', () => {
  it('二文字以上なら探せる', () => {
    // Arrange & Act & Assert
    expect(canSearch('or')).toBe(true)
    expect(canSearch('  orders  ')).toBe(true)
  })

  it('空白だけや一文字では探せない', () => {
    // Arrange & Act & Assert
    expect(canSearch('a')).toBe(false)
    expect(canSearch('   ')).toBe(false)
    expect(canSearch('')).toBe(false)
  })
})

describe('summarizeSourceResult', () => {
  it('件数と行数を並べる', () => {
    // Arrange & Act
    const summary = summarizeSourceResult(当たり)

    // Assert
    expect(summary).toBe('2 件のオブジェクト · 3 行')
  })

  it('打ち切ったときはその旨を添える', () => {
    // Arrange: 黙って切り詰めない（ADR 0021）
    const result: SourceSearchResult = { ...当たり, truncated: true }

    // Act
    const summary = summarizeSourceResult(result)

    // Assert
    expect(summary).toContain('上限に達しました')
  })

  it('未取得なら何も出さない', () => {
    // Arrange & Act & Assert
    expect(summarizeSourceResult(null)).toBe('')
  })
})
