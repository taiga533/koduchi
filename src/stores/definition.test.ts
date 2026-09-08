/**
 * テーブル定義ビューのストアのテスト（ADR 0019）。
 *
 * 取得・DDL の遅延取得・権限不足の区別・対象の切り替えを見る。
 * データベースからは `src/api/` 層の差し替えで切り離す（ADR 0010）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetDbApi, setDbApi } from '../api/db'
import { createFakeDbApi, type FakeCalls, type FakeDbApiOptions } from '../test/fakeDbApi'
import { useDefinitionStore } from './definition'
import type { DefinitionTarget } from '../types/db'

const 対象: DefinitionTarget = { owner: 'KODUCHI', name: 'SHIPMENTS', kind: 'table' }

let calls: FakeCalls

/**
 * 窓口を差し替える。
 *
 * @param options 応答の差し替え
 */
function 窓口を据える(options: FakeDbApiOptions = {}) {
  const fake = createFakeDbApi(options)
  calls = fake.calls
  setDbApi(fake.api)
}

beforeEach(() => {
  useDefinitionStore.getState().clear()
  窓口を据える()
})

afterEach(() => {
  useDefinitionStore.getState().clear()
  resetDbApi()
})

describe('useDefinitionStore', () => {
  it('開くと対象と定義を持つ', async () => {
    // Arrange & Act
    await useDefinitionStore.getState().open('c1', 対象)

    // Assert
    const state = useDefinitionStore.getState()
    expect(state.target).toEqual(対象)
    expect(state.status).toBe('ready')
    expect(state.definition?.name).toBe('SHIPMENTS')
    expect(calls.objectDefinition).toEqual([
      { id: 'c1', owner: 'KODUCHI', name: 'SHIPMENTS', kind: 'table' },
    ])
  })

  it('開いた時点では DDL を取りに行かない', async () => {
    // Arrange: GET_DDL は重く権限にも敏感である（ADR 0019）

    // Act
    await useDefinitionStore.getState().open('c1', 対象)

    // Assert
    expect(calls.objectDdl).toHaveLength(0)
    expect(useDefinitionStore.getState().ddlStatus).toBe('idle')
  })

  it('DDL のタブを開いたときに初めて取る', async () => {
    // Arrange
    await useDefinitionStore.getState().open('c1', 対象)

    // Act
    useDefinitionStore.getState().selectTab('c1', 'ddl')

    // Assert
    await vi.waitFor(() => expect(calls.objectDdl).toHaveLength(1))
  })

  it('タブを行き来しても DDL を取り直さない', async () => {
    // Arrange
    await useDefinitionStore.getState().open('c1', 対象)
    useDefinitionStore.getState().selectTab('c1', 'ddl')
    await vi.waitFor(() => expect(useDefinitionStore.getState().ddlStatus).toBe('ready'))

    // Act
    useDefinitionStore.getState().selectTab('c1', 'columns')
    useDefinitionStore.getState().selectTab('c1', 'ddl')

    // Assert
    expect(calls.objectDdl).toHaveLength(1)
  })

  it('定義の権限が無いことを区別して持つ', async () => {
    // Arrange: 「見えない」と「定義が空」は別物である（ADR 0017・0019）
    窓口を据える({ definitionError: { kind: 'permission', message: 'ORA-00942' } })

    // Act
    await useDefinitionStore.getState().open('c1', 対象)

    // Assert
    const state = useDefinitionStore.getState()
    expect(state.status).toBe('failed')
    expect(state.permissionDenied).toBe(true)
    expect(state.definition).toBeNull()
  })

  it('実行時の失敗は権限不足とは扱わない', async () => {
    // Arrange
    窓口を据える({ definitionError: { kind: 'execute', message: 'ORA-00904' } })

    // Act
    await useDefinitionStore.getState().open('c1', 対象)

    // Assert
    expect(useDefinitionStore.getState().permissionDenied).toBe(false)
    expect(useDefinitionStore.getState().error).toContain('ORA-00904')
  })

  it('DDL の権限が無くても定義そのものは残る', async () => {
    // Arrange: 定義ビュー全体が GET_DDL の権限不足で開けなくなってはいけない
    窓口を据える({ ddlError: { kind: 'permission', message: 'ORA-31603' } })
    await useDefinitionStore.getState().open('c1', 対象)

    // Act
    useDefinitionStore.getState().selectTab('c1', 'ddl')
    await vi.waitFor(() => expect(useDefinitionStore.getState().ddlStatus).toBe('failed'))

    // Assert
    const state = useDefinitionStore.getState()
    expect(state.ddlPermissionDenied).toBe(true)
    expect(state.status).toBe('ready')
    expect(state.definition).not.toBeNull()
  })

  it('別の対象を開くと絞り込みもタブも DDL も引き継がない', async () => {
    // Arrange
    await useDefinitionStore.getState().open('c1', 対象)
    useDefinitionStore.getState().setSearch('tracking')
    useDefinitionStore.getState().selectTab('c1', 'ddl')
    await vi.waitFor(() => expect(useDefinitionStore.getState().ddlStatus).toBe('ready'))

    // Act
    await useDefinitionStore
      .getState()
      .open('c1', { owner: 'KODUCHI', name: 'ORDERS', kind: 'table' })

    // Assert
    const state = useDefinitionStore.getState()
    expect(state.search).toBe('')
    expect(state.tab).toBe('columns')
    expect(state.ddl).toBeNull()
    expect(state.ddlStatus).toBe('idle')
  })

  it('閉じると対象を手放す', async () => {
    // Arrange
    await useDefinitionStore.getState().open('c1', 対象)

    // Act
    useDefinitionStore.getState().close()

    // Assert
    expect(useDefinitionStore.getState().target).toBeNull()
    expect(useDefinitionStore.getState().definition).toBeNull()
  })

  it('閉じた後に届いた取得結果は捨てる', async () => {
    // Arrange: 世代で見分ける。閉じたはずのパネルが開き直っては困る
    const 取得 = useDefinitionStore.getState().open('c1', 対象)

    // Act
    useDefinitionStore.getState().close()
    await 取得

    // Assert
    expect(useDefinitionStore.getState().target).toBeNull()
    expect(useDefinitionStore.getState().status).toBe('idle')
  })

  it('切断したときに捨てる', async () => {
    // Arrange
    await useDefinitionStore.getState().open('c1', 対象)

    // Act
    useDefinitionStore.getState().clear()

    // Assert
    expect(useDefinitionStore.getState().target).toBeNull()
    expect(useDefinitionStore.getState().search).toBe('')
  })
})
