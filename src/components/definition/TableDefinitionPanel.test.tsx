/**
 * テーブル定義ビューのテスト（ADR 0019・0022）。
 *
 * 列・制約・索引の描画、内訳の切替、列の絞り込み、DDL の遅延取得、権限不足の
 * 見せ方、そして 4 つの内訳のコピーを見る。データベースとクリップボードからは
 * `src/api/` 層の差し替えで切り離す（ADR 0010）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { resetClipboardApi, setClipboardApi } from '../../api/clipboard'
import { resetDbApi, setDbApi } from '../../api/db'
import { createFakeDbApi, type FakeCalls, type FakeDbApiOptions } from '../../test/fakeDbApi'
import { useDefinitionStore } from '../../stores/definition'
import type { ObjectDefinition } from '../../types/db'
import { TableDefinitionPanel } from './TableDefinitionPanel'

/** 描いている定義タブの ID。 */
const 定義タブ = 'tab-1'

/** 主キー・外部キー・検査制約・複合索引を持つ表の定義。 */
const 定義: ObjectDefinition = {
  owner: 'KODUCHI',
  name: 'SHIPMENTS',
  kind: 'table',
  columns: [
    {
      objectName: 'SHIPMENTS',
      name: 'SHIPMENT_ID',
      typeName: 'NUMBER(12)',
      nullable: false,
      kind: 'number',
    },
    {
      objectName: 'SHIPMENTS',
      name: 'ORDER_ID',
      typeName: 'NUMBER(12)',
      nullable: false,
      kind: 'number',
    },
    {
      objectName: 'SHIPMENTS',
      name: 'TRACKING_NO',
      typeName: 'VARCHAR2(64)',
      nullable: true,
      kind: 'text',
    },
  ],
  constraints: [
    {
      name: 'PK_SHIPMENTS',
      kind: 'primaryKey',
      columns: ['SHIPMENT_ID'],
      searchCondition: null,
      referencedOwner: null,
      referencedTable: null,
      referencedColumns: [],
      deleteRule: null,
      enabled: true,
    },
    {
      name: 'FK_SHIPMENTS_ORDER',
      kind: 'foreignKey',
      columns: ['ORDER_ID'],
      searchCondition: null,
      referencedOwner: 'KODUCHI',
      referencedTable: 'ORDERS',
      referencedColumns: ['ORDER_ID'],
      deleteRule: 'CASCADE',
      enabled: true,
    },
    {
      name: 'CK_SHIPMENTS_STATUS',
      kind: 'check',
      columns: ['STATUS'],
      searchCondition: "status in ('pending','shipped','delivered')",
      referencedOwner: null,
      referencedTable: null,
      referencedColumns: [],
      deleteRule: null,
      enabled: true,
    },
  ],
  indexes: [
    {
      name: 'IX_SHIPMENTS_ORDER_STATUS',
      owner: 'KODUCHI',
      unique: false,
      indexType: 'NORMAL',
      status: 'VALID',
      generated: false,
      columns: [
        { name: 'ORDER_ID', descending: false },
        { name: 'STATUS', descending: false },
      ],
    },
    {
      name: 'SYS_C0012345',
      owner: 'KODUCHI',
      unique: true,
      indexType: 'NORMAL',
      status: 'VALID',
      generated: true,
      columns: [{ name: 'SHIPMENT_ID', descending: false }],
    },
  ],
}

let calls: FakeCalls

/** クリップボードへ書かれた文字列。新しいものが末尾に来る。 */
let 書いた文字列: string[]

/**
 * 定義ビューを開いた状態で描く。
 *
 * @param options 窓口の応答の差し替え
 */
async function パネルを開く(options: FakeDbApiOptions = { definition: 定義 }) {
  const fake = createFakeDbApi(options)
  calls = fake.calls
  setDbApi(fake.api)

  render(<TableDefinitionPanel connectionId="c1" tabId={定義タブ} />)

  await useDefinitionStore
    .getState()
    .open('c1', 定義タブ, { owner: 'KODUCHI', name: 'SHIPMENTS', kind: 'table' })

  return userEvent.setup()
}

beforeEach(() => {
  useDefinitionStore.getState().clear()
  書いた文字列 = []
  setClipboardApi({
    writeText: (text) => {
      書いた文字列.push(text)
      return Promise.resolve()
    },
  })
})

afterEach(() => {
  useDefinitionStore.getState().clear()
  resetDbApi()
  resetClipboardApi()
})

describe('TableDefinitionPanel', () => {
  it('開いたオブジェクトの名前を見出しに出す', async () => {
    // Arrange & Act
    await パネルを開く()

    // Assert
    expect(await screen.findByText('KODUCHI.SHIPMENTS')).toBeInTheDocument()
  })

  it('最初に開くのは列のタブである', async () => {
    // Arrange & Act
    await パネルを開く()

    // Assert
    expect(await screen.findByText('TRACKING_NO')).toBeInTheDocument()
    expect(screen.getByText('VARCHAR2(64)')).toBeInTheDocument()
  })

  it('NULL を許さない列にはその印が付く', async () => {
    // Arrange & Act
    await パネルを開く()

    // Assert
    expect(await screen.findAllByText('NOT NULL')).toHaveLength(2)
  })

  it('列を名前で絞り込める', async () => {
    // Arrange: 列が数百ある表は珍しくない（ADR 0019）
    const user = await パネルを開く()
    await screen.findByText('TRACKING_NO')

    // Act
    await user.type(screen.getByLabelText('定義を絞り込む'), 'tracking')

    // Assert
    expect(screen.getByText('TRACKING_NO')).toBeInTheDocument()
    expect(screen.queryByText('ORDER_ID')).not.toBeInTheDocument()
  })

  it('当てはまる列が無ければその旨を出す', async () => {
    // Arrange
    const user = await パネルを開く()
    await screen.findByText('TRACKING_NO')

    // Act
    await user.type(screen.getByLabelText('定義を絞り込む'), 'zzz')

    // Assert
    expect(screen.getByText('当てはまる列がありません')).toBeInTheDocument()
  })

  it('制約のタブへ切り替えると外部キーの参照先まで出る', async () => {
    // Arrange
    const user = await パネルを開く()
    await screen.findByText('TRACKING_NO')

    // Act
    await user.click(screen.getByRole('tab', { name: /制約/ }))

    // Assert
    expect(screen.getByText('FK_SHIPMENTS_ORDER')).toBeInTheDocument()
    expect(screen.getByText('→ KODUCHI.ORDERS (ORDER_ID)')).toBeInTheDocument()
    expect(screen.getByText('ON DELETE CASCADE')).toBeInTheDocument()
  })

  it('検査制約は条件をそのまま出す', async () => {
    // Arrange
    const user = await パネルを開く()
    await screen.findByText('TRACKING_NO')

    // Act
    await user.click(screen.getByRole('tab', { name: /制約/ }))

    // Assert
    expect(screen.getByText("status in ('pending','shipped','delivered')")).toBeInTheDocument()
  })

  it('索引のタブでは列の並びと自動生成の印が出る', async () => {
    // Arrange: 主キーの索引が見えないと「この列で引けるのか」が分からない
    const user = await パネルを開く()
    await screen.findByText('TRACKING_NO')

    // Act
    await user.click(screen.getByRole('tab', { name: /索引/ }))

    // Assert
    expect(screen.getByText('ORDER_ID, STATUS')).toBeInTheDocument()
    expect(screen.getByText('SYS_C0012345')).toBeInTheDocument()
    expect(screen.getByText('自動生成')).toBeInTheDocument()
  })

  it('索引も列名で絞り込める', async () => {
    // Arrange
    const user = await パネルを開く()
    await screen.findByText('TRACKING_NO')
    await user.click(screen.getByRole('tab', { name: /索引/ }))

    // Act
    await user.type(screen.getByLabelText('定義を絞り込む'), 'status')

    // Assert
    expect(screen.getByText('IX_SHIPMENTS_ORDER_STATUS')).toBeInTheDocument()
    expect(screen.queryByText('SYS_C0012345')).not.toBeInTheDocument()
  })

  it('DDL は開くまで取りに行かない', async () => {
    // Arrange: GET_DDL は重く権限にも敏感である（ADR 0019）
    const user = await パネルを開く()
    await screen.findByText('TRACKING_NO')

    // Act & Assert
    expect(calls.objectDdl).toHaveLength(0)

    await user.click(screen.getByRole('tab', { name: 'DDL' }))

    await waitFor(() => expect(calls.objectDdl).toHaveLength(1))
    expect(calls.objectDdl[0]).toEqual({
      id: 'c1',
      owner: 'KODUCHI',
      name: 'SHIPMENTS',
      kind: 'table',
    })
  })

  it('DDL のタブに取得した定義を出す', async () => {
    // Arrange
    const user = await パネルを開く({
      definition: 定義,
      ddl: {
        owner: 'KODUCHI',
        name: 'SHIPMENTS',
        kind: 'table',
        parts: [{ label: '定義', sql: 'CREATE TABLE "KODUCHI"."SHIPMENTS" (…);' }],
      },
    })
    await screen.findByText('TRACKING_NO')

    // Act
    await user.click(screen.getByRole('tab', { name: 'DDL' }))

    // Assert
    expect(await screen.findByText(/CREATE TABLE/)).toBeInTheDocument()
  })

  it('パッケージの DDL は仕様と本体を見出し付きで並べる', async () => {
    // Arrange: GET_DDL('PACKAGE', …) は仕様しか返さない（ADR 0019）
    const user = await パネルを開く({
      definition: 定義,
      ddl: {
        owner: 'KODUCHI',
        name: 'ORDER_STATS',
        kind: 'package',
        parts: [
          { label: 'パッケージ仕様', sql: 'CREATE OR REPLACE PACKAGE …' },
          { label: 'パッケージ本体', sql: 'CREATE OR REPLACE PACKAGE BODY …' },
        ],
      },
    })
    await screen.findByText('TRACKING_NO')

    // Act
    await user.click(screen.getByRole('tab', { name: 'DDL' }))

    // Assert
    expect(await screen.findByText('パッケージ仕様')).toBeInTheDocument()
    expect(screen.getByText('パッケージ本体')).toBeInTheDocument()
  })

  it('DDL の権限が無くても列と制約は見られる', async () => {
    // Arrange: 定義ビュー全体が GET_DDL の権限不足で開けなくなってはいけない
    const user = await パネルを開く({
      definition: 定義,
      ddlError: { kind: 'permission', message: 'ORA-31603' },
    })
    await screen.findByText('TRACKING_NO')

    // Act
    await user.click(screen.getByRole('tab', { name: 'DDL' }))

    // Assert
    expect(await screen.findByText('この接続では DDL を取得できません')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /列/ }))
    expect(screen.getByText('TRACKING_NO')).toBeInTheDocument()
  })

  it('定義そのものの権限が無いときは空の表を出さない', async () => {
    // Arrange: 「見えない」と「定義が空」は別物である（ADR 0017・0019）
    await パネルを開く({ definitionError: { kind: 'permission', message: 'ORA-00942' } })

    // Assert
    expect(
      await screen.findByText('この接続ではこのオブジェクトの定義を見られません'),
    ).toBeInTheDocument()
    expect(screen.queryByText('列がありません')).not.toBeInTheDocument()
  })

  it('絞り込みはタブごとに別々である', async () => {
    // Arrange: 前の表の語で別の表を絞ったまま見せると、列が無いのか隠れて
    // いるのかが分からない（ADR 0022 ではタブごとに分けて解いた）
    const user = await パネルを開く()
    await screen.findByText('TRACKING_NO')
    await user.type(screen.getByLabelText('定義を絞り込む'), 'tracking')

    // Act
    await useDefinitionStore
      .getState()
      .open('c1', '別のタブ', { owner: 'KODUCHI', name: 'ORDERS', kind: 'table' })

    // Assert
    expect(useDefinitionStore.getState().byTab['別のタブ'].search).toBe('')
    expect(screen.getByLabelText('定義を絞り込む')).toHaveValue('tracking')
  })

  it('列のタブのコピーは見出し付きでタブ区切りの全列を渡す', async () => {
    // Arrange
    const user = await パネルを開く()
    await screen.findByText('TRACKING_NO')

    // Act
    await user.click(screen.getByRole('button', { name: '3 件の列をコピー' }))

    // Assert
    expect(書いた文字列).toHaveLength(1)
    expect(書いた文字列[0].split('\n')).toEqual([
      '#\t列\t型\tNULL',
      '1\tSHIPMENT_ID\tNUMBER(12)\tNOT NULL',
      '2\tORDER_ID\tNUMBER(12)\tNOT NULL',
      '3\tTRACKING_NO\tVARCHAR2(64)\t可',
    ])
  })

  it('コピーすると押したことが分かる一言を出す', async () => {
    // Arrange: コピーは何も起きないように見える操作である
    const user = await パネルを開く()
    await screen.findByText('TRACKING_NO')

    // Act
    await user.click(screen.getByRole('button', { name: '3 件の列をコピー' }))

    // Assert
    expect(screen.getByRole('status')).toHaveTextContent('3 件をコピーしました')
  })

  it('コピーの一言はしばらくすると自分で消える', async () => {
    // Arrange: 定義タブは開いたまま使う画面であり、古い報せが残り続けると
    // 今写したものと見分けが付かなくなる
    await パネルを開く()
    await screen.findByText('TRACKING_NO')
    vi.useFakeTimers()

    try {
      // Act
      fireEvent.click(screen.getByRole('button', { name: '3 件の列をコピー' }))
      expect(screen.getByRole('status')).toHaveTextContent('3 件をコピーしました')
      act(() => {
        vi.advanceTimersByTime(3000)
      })

      // Assert
      expect(screen.getByRole('status')).toHaveTextContent('')
    } finally {
      vi.useRealTimers()
    }
  })

  it('絞り込んでいるときは絞り込んだぶんだけを渡す', async () => {
    // Arrange: 見えていないものが混ざって貼られてはいけない
    const user = await パネルを開く()
    await screen.findByText('TRACKING_NO')

    // Act
    await user.type(screen.getByLabelText('定義を絞り込む'), 'tracking')
    await user.click(screen.getByRole('button', { name: '絞り込んだ 1 件の列をコピー' }))

    // Assert
    expect(書いた文字列[0]).toBe('#\t列\t型\tNULL\n3\tTRACKING_NO\tVARCHAR2(64)\t可')
  })

  it('絞り込み中のコピーは押す前と押した後の両方でそう伝える', async () => {
    // Arrange: 気づかないまま欠けたものを貼らせない
    const user = await パネルを開く()
    await screen.findByText('TRACKING_NO')

    // Act
    await user.type(screen.getByLabelText('定義を絞り込む'), 'tracking')

    // Assert
    const ボタン = screen.getByRole('button', { name: '絞り込んだ 1 件の列をコピー' })
    expect(ボタン).toHaveTextContent('絞り込んだぶんをコピー')

    await user.click(ボタン)
    expect(screen.getByRole('status')).toHaveTextContent('絞り込んだ 1 件をコピーしました')
  })

  it('当てはまる行が無いときはコピーを押せない', async () => {
    // Arrange: 見出しだけの文字列を貼らせない
    const user = await パネルを開く()
    await screen.findByText('TRACKING_NO')

    // Act
    await user.type(screen.getByLabelText('定義を絞り込む'), 'zzz')

    // Assert
    expect(screen.getByRole('button', { name: 'コピーできるものがありません' })).toBeDisabled()
  })

  it('索引のタブのコピーは索引の表を渡す', async () => {
    // Arrange
    const user = await パネルを開く()
    await screen.findByText('TRACKING_NO')

    // Act
    await user.click(screen.getByRole('tab', { name: /索引/ }))
    await user.click(screen.getByRole('button', { name: '2 件の索引をコピー' }))

    // Assert
    expect(書いた文字列[0].split('\n')[0]).toBe('名前\t列\t一意\t種類')
    expect(書いた文字列[0]).toContain('SYS_C0012345 (自動生成)')
  })

  it('DDL のコピーは見出しを足さずに本文だけを渡す', async () => {
    // Arrange: 貼り先は別の環境の SQL である
    const user = await パネルを開く({
      definition: 定義,
      ddl: {
        owner: 'KODUCHI',
        name: 'ORDER_STATS',
        kind: 'package',
        parts: [
          { label: 'パッケージ仕様', sql: 'CREATE OR REPLACE PACKAGE P AS END;' },
          { label: 'パッケージ本体', sql: 'CREATE OR REPLACE PACKAGE BODY P AS END;' },
        ],
      },
    })
    await screen.findByText('TRACKING_NO')

    // Act
    await user.click(screen.getByRole('tab', { name: 'DDL' }))
    await screen.findByText('パッケージ仕様')
    await user.click(screen.getByRole('button', { name: 'DDL をコピー' }))

    // Assert
    expect(書いた文字列[0]).toBe(
      'CREATE OR REPLACE PACKAGE P AS END;\n\nCREATE OR REPLACE PACKAGE BODY P AS END;',
    )
  })

  it('仕様と本体は断片ごとにも渡せる', async () => {
    // Arrange: 本体だけを別の環境へ流したいことがある
    const user = await パネルを開く({
      definition: 定義,
      ddl: {
        owner: 'KODUCHI',
        name: 'ORDER_STATS',
        kind: 'package',
        parts: [
          { label: 'パッケージ仕様', sql: 'CREATE OR REPLACE PACKAGE P AS END;' },
          { label: 'パッケージ本体', sql: 'CREATE OR REPLACE PACKAGE BODY P AS END;' },
        ],
      },
    })
    await screen.findByText('TRACKING_NO')

    // Act
    await user.click(screen.getByRole('tab', { name: 'DDL' }))
    await screen.findByText('パッケージ仕様')
    await user.click(screen.getByRole('button', { name: 'パッケージ本体をコピー' }))

    // Assert
    expect(書いた文字列[0]).toBe('CREATE OR REPLACE PACKAGE BODY P AS END;')
  })

  it('DDL を取れていないうちはコピーを押せない', async () => {
    // Arrange: GET_DDL の権限が無いだけで空文字列を渡さない（ADR 0019）
    const user = await パネルを開く({
      definition: 定義,
      ddlError: { kind: 'permission', message: 'ORA-31603' },
    })
    await screen.findByText('TRACKING_NO')

    // Act
    await user.click(screen.getByRole('tab', { name: 'DDL' }))
    await screen.findByText('この接続では DDL を取得できません')

    // Assert
    expect(screen.getByRole('button', { name: 'コピーできるものがありません' })).toBeDisabled()
  })

  it('タブを閉じると何も描かない', async () => {
    // Arrange
    await パネルを開く()
    await screen.findByText('KODUCHI.SHIPMENTS')

    // Act
    useDefinitionStore.getState().drop(定義タブ)

    // Assert
    await waitFor(() => expect(screen.queryByTestId('table-definition')).not.toBeInTheDocument())
  })
})
