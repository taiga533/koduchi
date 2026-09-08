/**
 * テーブル定義ビューのストアのテスト（ADR 0019・0022）。
 *
 * 取得・DDL の遅延取得・権限不足の区別・タブごとの持ち分けを見る。
 * データベースからは `src/api/` 層の差し替えで切り離す（ADR 0010）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetDbApi, setDbApi } from '../api/db'
import { createFakeDbApi, type FakeCalls, type FakeDbApiOptions } from '../test/fakeDbApi'
import { selectDefinition, useDefinitionStore, type DefinitionEntry } from './definition'
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

/**
 * タブ 1 枚ぶんの状態を取り出す。無ければ落とす。
 *
 * @param tabId 対象のタブ
 */
function タブの状態(tabId: string): DefinitionEntry {
  const entry = selectDefinition(useDefinitionStore.getState(), tabId)
  if (entry === null) {
    throw new Error(`${tabId} の定義が無い`)
  }
  return entry
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
  it('開くとそのタブが対象と定義を持つ', async () => {
    // Arrange & Act
    await useDefinitionStore.getState().open('c1', 'tab-1', 対象)

    // Assert
    const entry = タブの状態('tab-1')
    expect(entry.target).toEqual(対象)
    expect(entry.status).toBe('ready')
    expect(entry.definition?.name).toBe('SHIPMENTS')
    expect(calls.objectDefinition).toEqual([
      { id: 'c1', owner: 'KODUCHI', name: 'SHIPMENTS', kind: 'table' },
    ])
  })

  it('開いた時点では DDL を取りに行かない', async () => {
    // Arrange: GET_DDL は重く権限にも敏感である（ADR 0019）

    // Act
    await useDefinitionStore.getState().open('c1', 'tab-1', 対象)

    // Assert
    expect(calls.objectDdl).toHaveLength(0)
    expect(タブの状態('tab-1').ddlStatus).toBe('idle')
  })

  it('DDL の内訳を開いたときに初めて取る', async () => {
    // Arrange
    await useDefinitionStore.getState().open('c1', 'tab-1', 対象)

    // Act
    useDefinitionStore.getState().selectTab('c1', 'tab-1', 'ddl')

    // Assert
    await vi.waitFor(() => expect(calls.objectDdl).toHaveLength(1))
  })

  it('内訳を行き来しても DDL を取り直さない', async () => {
    // Arrange
    await useDefinitionStore.getState().open('c1', 'tab-1', 対象)
    useDefinitionStore.getState().selectTab('c1', 'tab-1', 'ddl')
    await vi.waitFor(() => expect(タブの状態('tab-1').ddlStatus).toBe('ready'))

    // Act
    useDefinitionStore.getState().selectTab('c1', 'tab-1', 'columns')
    useDefinitionStore.getState().selectTab('c1', 'tab-1', 'ddl')

    // Assert
    expect(calls.objectDdl).toHaveLength(1)
  })

  it('同じタブを開き直しても取得は 1 度きりである', async () => {
    // Arrange: タブを選び直すたびに問い合わせては、枚数だけ往復が増える（ADR 0022）
    await useDefinitionStore.getState().open('c1', 'tab-1', 対象)

    // Act
    await useDefinitionStore.getState().open('c1', 'tab-1', 対象)

    // Assert
    expect(calls.objectDefinition).toHaveLength(1)
  })

  it('別のタブで開いた定義は互いに混ざらない', async () => {
    // Arrange
    await useDefinitionStore.getState().open('c1', 'tab-1', 対象)

    // Act
    await useDefinitionStore
      .getState()
      .open('c1', 'tab-2', { owner: 'KODUCHI', name: 'ORDERS', kind: 'table' })
    useDefinitionStore.getState().setSearch('tab-2', 'tracking')

    // Assert
    expect(タブの状態('tab-1').target.name).toBe('SHIPMENTS')
    expect(タブの状態('tab-1').search).toBe('')
    expect(タブの状態('tab-2').target.name).toBe('ORDERS')
    expect(タブの状態('tab-2').search).toBe('tracking')
  })

  it('定義の権限が無いことを区別して持つ', async () => {
    // Arrange: 「見えない」と「定義が空」は別物である（ADR 0017・0019）
    窓口を据える({ definitionError: { kind: 'permission', message: 'ORA-00942' } })

    // Act
    await useDefinitionStore.getState().open('c1', 'tab-1', 対象)

    // Assert
    const entry = タブの状態('tab-1')
    expect(entry.status).toBe('failed')
    expect(entry.permissionDenied).toBe(true)
    expect(entry.definition).toBeNull()
  })

  it('実行時の失敗は権限不足とは扱わない', async () => {
    // Arrange
    窓口を据える({ definitionError: { kind: 'execute', message: 'ORA-00904' } })

    // Act
    await useDefinitionStore.getState().open('c1', 'tab-1', 対象)

    // Assert
    expect(タブの状態('tab-1').permissionDenied).toBe(false)
    expect(タブの状態('tab-1').error).toContain('ORA-00904')
  })

  it('DDL の権限が無くても定義そのものは残る', async () => {
    // Arrange: 定義ビュー全体が GET_DDL の権限不足で開けなくなってはいけない
    窓口を据える({ ddlError: { kind: 'permission', message: 'ORA-31603' } })
    await useDefinitionStore.getState().open('c1', 'tab-1', 対象)

    // Act
    useDefinitionStore.getState().selectTab('c1', 'tab-1', 'ddl')
    await vi.waitFor(() => expect(タブの状態('tab-1').ddlStatus).toBe('failed'))

    // Assert
    const entry = タブの状態('tab-1')
    expect(entry.ddlPermissionDenied).toBe(true)
    expect(entry.status).toBe('ready')
    expect(entry.definition).not.toBeNull()
  })

  it('タブを閉じるとそのタブの定義を手放す', async () => {
    // Arrange
    await useDefinitionStore.getState().open('c1', 'tab-1', 対象)
    await useDefinitionStore.getState().open('c1', 'tab-2', 対象)

    // Act
    useDefinitionStore.getState().drop('tab-1')

    // Assert
    expect(selectDefinition(useDefinitionStore.getState(), 'tab-1')).toBeNull()
    expect(selectDefinition(useDefinitionStore.getState(), 'tab-2')).not.toBeNull()
  })

  it('閉じた後に届いた取得結果は捨てる', async () => {
    // Arrange: 世代で見分ける。閉じたはずのタブが蘇っては困る
    const 取得 = useDefinitionStore.getState().open('c1', 'tab-1', 対象)

    // Act
    useDefinitionStore.getState().drop('tab-1')
    await 取得

    // Assert
    expect(selectDefinition(useDefinitionStore.getState(), 'tab-1')).toBeNull()
  })

  it('切断したときにすべて捨てる', async () => {
    // Arrange
    await useDefinitionStore.getState().open('c1', 'tab-1', 対象)
    await useDefinitionStore.getState().open('c1', 'tab-2', 対象)

    // Act
    useDefinitionStore.getState().clear()

    // Assert
    expect(useDefinitionStore.getState().byTab).toEqual({})
  })
})

describe('selectDefinition', () => {
  it('タブが選ばれていなければ null を返す', () => {
    // Arrange & Act
    const entry = selectDefinition(useDefinitionStore.getState(), null)

    // Assert
    expect(entry).toBeNull()
  })
})
