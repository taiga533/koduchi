/**
 * オブジェクトのソース検索のパネルのテスト（ADR 0021）。
 *
 * 入力から検索への流れ・当たりの描画・空の結果・打ち切りの断り・権限不足の
 * 見せ方・前後の行を見る。データベースからは `src/api/` 層の差し替えで
 * 切り離す（ADR 0010）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { resetDbApi, setDbApi } from '../../api/db'
import { createFakeDbApi, type FakeCalls, type FakeDbApiOptions } from '../../test/fakeDbApi'
import { useSchemaStore } from '../../stores/schema'
import { useSourceSearchStore } from '../../stores/sourceSearch'
import type { SourceSearchResult } from '../../types/db'
import { SourceSearchPanel } from './SourceSearchPanel'

/** パッケージ本体とトリガーが当たった結果。 */
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

/**
 * パネルを描く。
 *
 * @param options 窓口の応答の差し替え
 */
function パネルを描く(options: FakeDbApiOptions = {}) {
  const fake = createFakeDbApi({ sourceMatches: 当たり, ...options })
  calls = fake.calls
  setDbApi(fake.api)

  const onClose = vi.fn()
  render(<SourceSearchPanel connectionId="c1" onClose={onClose} />)
  return { onClose }
}

/**
 * 検索欄へ語を打って検索する。
 *
 * @param needle 打つ検索語
 */
async function 検索する(needle: string) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('ソースに含まれる文字列'), needle)
  await user.click(screen.getByRole('button', { name: '検索' }))
  return user
}

beforeEach(() => {
  useSourceSearchStore.getState().clear()
  useSchemaStore.setState({ schemas: [] })
})

afterEach(() => {
  resetDbApi()
})

describe('SourceSearchPanel', () => {
  it('開いただけでは問い合わせに行かない', () => {
    // Arrange & Act
    パネルを描く()

    // Assert: パレット（ADR 0018）と違い、打鍵のたびには投げない
    expect(calls.searchSource).toHaveLength(0)
    expect(screen.getByText(/ビューの本文は対象外です/)).toBeInTheDocument()
  })

  it('検索するとオブジェクトごとに当たった行が並ぶ', async () => {
    // Arrange
    パネルを描く()

    // Act
    await 検索する('user_traits')

    // Assert
    expect(await screen.findByText('KODUCHI.ORDER_AUDIT')).toBeInTheDocument()
    expect(screen.getByText('KODUCHI.TRG_USER_TRAITS_TOUCH')).toBeInTheDocument()
    expect(screen.getByLabelText('ORDER_AUDIT の 4 行目')).toHaveTextContent(
      'UPDATE koduchi.user_traits',
    )
    expect(calls.searchSource[0].request.needle).toBe('user_traits')
  })

  it('パッケージ本体には本体と分かる印が付く', async () => {
    // Arrange: 本体はツリーに出ないため（ADR 0014）、印が無いと仕様と見分けられない
    パネルを描く()

    // Act
    await 検索する('user_traits')

    // Assert: 絞り込みのチェックと紛れないよう、当たりの見出しの中を見る
    const 見出し = (await screen.findByText('KODUCHI.ORDER_AUDIT')).closest('p')
    expect(見出し).toHaveTextContent('パッケージ本体')
  })

  it('二文字に満たない語では検索を押せない', async () => {
    // Arrange
    パネルを描く()
    const user = userEvent.setup()

    // Act
    await user.type(screen.getByLabelText('ソースに含まれる文字列'), 'a')

    // Assert
    expect(screen.getByRole('button', { name: '検索' })).toBeDisabled()
    expect(calls.searchSource).toHaveLength(0)
  })

  it('当てはまるものが無ければその旨を出す', async () => {
    // Arrange
    パネルを描く({ sourceMatches: { objects: [], matchedLines: 0, truncated: false } })

    // Act
    await 検索する('orders')

    // Assert
    expect(await screen.findByText('当てはまるソースがありません')).toBeInTheDocument()
  })

  it('上限に達したときは絞り込みを促す', async () => {
    // Arrange: 黙って切り詰めない。出ていないものを「無い」と読ませない
    パネルを描く({ sourceMatches: { ...当たり, truncated: true } })

    // Act
    await 検索する('orders')

    // Assert
    expect(await screen.findByText(/上限に達しました/)).toBeInTheDocument()
  })

  it('権限が無いときは空の結果ではなくその旨を出す', async () => {
    // Arrange: 「見えない」と「無い」は別物である（ADR 0017 の区分）
    パネルを描く({
      sourceError: {
        kind: 'permission',
        message: 'ソースを検索できません。この接続には参照権限がありません',
      },
    })

    // Act
    await 検索する('orders')

    // Assert
    expect(await screen.findByText('この接続では ALL_SOURCE を参照できません')).toBeInTheDocument()
    expect(screen.queryByText('当てはまるソースがありません')).not.toBeInTheDocument()
  })

  it('当たった行を押すと前後の行が出る', async () => {
    // Arrange
    パネルを描く({
      sourceLines: [
        { line: 3, text: '  BEGIN' },
        { line: 4, text: '    UPDATE koduchi.user_traits' },
        { line: 5, text: '       SET segment = p_segment' },
      ],
    })
    const user = await 検索する('user_traits')
    await screen.findByText('KODUCHI.ORDER_AUDIT')

    // Act
    await user.click(screen.getByLabelText('ORDER_AUDIT の 4 行目'))

    // Assert
    const 前後 = await screen.findByRole('region', { name: '前後の行' })
    expect(前後).toHaveTextContent('BEGIN')
    expect(前後).toHaveTextContent('SET segment = p_segment')
    expect(calls.sourceContext[0].line).toBe(4)
  })

  it('落とした種別は求めに載らない', async () => {
    // Arrange: 落とした種別は問い合わせにも行かない（ADR 0021）
    パネルを描く()
    const user = userEvent.setup()

    // Act
    await user.click(screen.getByLabelText('トリガー'))
    await user.type(screen.getByLabelText('ソースに含まれる文字列'), 'orders')
    await user.click(screen.getByRole('button', { name: '検索' }))

    // Assert
    expect(calls.searchSource[0].request.kinds.trigger).toBe(false)
    expect(calls.searchSource[0].request.kinds.packageBody).toBe(true)
  })

  it('スキーマを選ぶとその所有者だけを探す', async () => {
    // Arrange
    useSchemaStore.setState({
      schemas: [{ name: 'KODUCHI', objectCount: 12, objects: [] }],
    })
    パネルを描く()
    const user = userEvent.setup()

    // Act
    await user.selectOptions(screen.getByLabelText('探す先のスキーマ'), 'KODUCHI')
    await user.type(screen.getByLabelText('ソースに含まれる文字列'), 'orders')
    await user.click(screen.getByRole('button', { name: '検索' }))

    // Assert
    expect(calls.searchSource[0].request.owner).toBe('KODUCHI')
  })

  it('esc で閉じる', async () => {
    // Arrange
    const { onClose } = パネルを描く()
    const user = userEvent.setup()

    // Act
    await user.keyboard('{Escape}')

    // Assert
    expect(onClose).toHaveBeenCalled()
  })

  it('前後を見ている最中の esc は選択だけを解く', async () => {
    // Arrange: 1 件を覗いたつもりで検索の結果ごと失わせない
    const { onClose } = パネルを描く({ sourceLines: [{ line: 4, text: '  BEGIN' }] })
    const user = await 検索する('user_traits')
    await screen.findByText('KODUCHI.ORDER_AUDIT')
    await user.click(screen.getByLabelText('ORDER_AUDIT の 4 行目'))
    await screen.findByRole('region', { name: '前後の行' })

    // Act
    await user.keyboard('{Escape}')

    // Assert
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: '前後の行' })).not.toBeInTheDocument()
  })
})
