import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { resetClipboardApi, setClipboardApi } from '../../api/clipboard'
import type { IdentifierCase, SchemaNode, TableColumn } from '../../types/db'
import { useConnectionStore } from '../../stores/connection'
import { useSchemaStore } from '../../stores/schema'
import { canOpenSelect, flattenSchemas, rowIdentifierPath, SchemaTree } from './SchemaTree'

/**
 * jsdom は要素の寸法を持たない。仮想スクロールは `offsetHeight` で表示領域を
 * 測るため、そのままだと領域が 0 と見なされて行が 1 つも描かれない。
 *
 * 補うのは寸法だけで、アプリの振る舞いは差し替えていない。
 */
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    value: 600,
  })
})

const スキーマ一覧: SchemaNode[] = [
  {
    name: 'KODUCHI',
    objectCount: 2,
    objects: [
      { name: 'USERS', kind: 'table' },
      { name: 'ORDER_TOTAL', kind: 'function' },
    ],
  },
]

/** 種別を増やしたスキーマ（ADR 0014）。束ね方の確認に使う。 */
const 種別の多いスキーマ: SchemaNode[] = [
  {
    name: 'KODUCHI',
    objectCount: 6,
    objects: [
      { name: 'DAILY_GMV', kind: 'synonym' },
      { name: 'IX_EVENTS_USER', kind: 'index' },
      { name: 'ORDER_SUMMARY', kind: 'type' },
      { name: 'REPORTS', kind: 'databaseLink' },
      { name: 'TRG_TOUCH', kind: 'trigger' },
      { name: 'USERS', kind: 'table' },
    ],
  },
]

const 列一覧: Record<string, TableColumn[]> = {
  KODUCHI: [
    {
      objectName: 'USERS',
      name: 'USER_ID',
      typeName: 'NUMBER(12)',
      nullable: false,
      kind: 'number',
    },
    {
      objectName: 'USERS',
      name: 'EMAIL',
      typeName: 'VARCHAR2(255)',
      nullable: false,
      kind: 'text',
    },
  ],
}

/** ツリーが受け取る操作の口。既定は何もしない関数である。 */
const 何もしない = () => {}

/**
 * ツリーを描く。挿入と `SELECT` の口は呼び出し側で差し替えられる。
 *
 * @param actions 差し替える口
 */
function renderTree(
  actions: { onInsert?: (text: string) => void; onOpenSelect?: (sql: string) => void } = {},
) {
  return render(
    <SchemaTree
      onInsert={actions.onInsert ?? 何もしない}
      onOpenSelect={actions.onOpenSelect ?? 何もしない}
    />,
  )
}

/**
 * 挿入する綴りを決める接続を仕立てる（ADR 0013）。
 *
 * @param identifierCase 挿入したい綴り
 */
function 接続を置く(identifierCase: IdentifierCase): void {
  useConnectionStore.setState({
    connection: {
      id: 'c1',
      savedId: null,
      name: '開発',
      params: {
        username: 'KODUCHI',
        password: '',
        target: { method: 'ezConnect', host: 'localhost', port: 1521, serviceName: 'XEPDB1' },
        readOnly: false,
        autoCommit: false,
      },
      completion: { identifierCase },
      color: 'none',
      group: null,
    },
  })
}

beforeEach(() => {
  useConnectionStore.setState({ connection: null })
  useSchemaStore.getState().clear()
  useSchemaStore.setState({
    schemas: スキーマ一覧,
    columns: 列一覧,
    status: 'ready',
    columnStatus: 'ready',
  })
})

describe('SchemaTree', () => {
  it('スキーマ名とオブジェクト数が並ぶ', () => {
    // Arrange
    renderTree()

    // Act
    const row = screen.getByRole('button', { name: /KODUCHI/ })

    // Assert
    expect(row).toHaveTextContent('KODUCHI')
    expect(row).toHaveTextContent('2')
  })

  it('スキーマを展開すると種別の束が並ぶ', async () => {
    // Arrange
    renderTree()

    // Act
    await userEvent.click(screen.getByRole('button', { name: /KODUCHI/ }))

    // Assert
    expect(screen.getByRole('button', { name: /テーブル/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ファンクション/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /USERS/ })).not.toBeInTheDocument()
  })

  it('種別の束を展開するとその種別のオブジェクトだけが並ぶ', async () => {
    // Arrange
    renderTree()
    await userEvent.click(screen.getByRole('button', { name: /KODUCHI/ }))

    // Act
    await userEvent.click(screen.getByRole('button', { name: /テーブル/ }))

    // Assert
    expect(screen.getByRole('button', { name: /USERS/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ORDER_TOTAL/ })).not.toBeInTheDocument()
  })

  it('追加した種別もそれぞれの束として並ぶ', async () => {
    // Arrange
    useSchemaStore.setState({ schemas: 種別の多いスキーマ, columns: {} })
    renderTree()

    // Act
    await userEvent.click(screen.getByRole('button', { name: /KODUCHI/ }))

    // Assert
    expect(screen.getByRole('button', { name: /索引/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /トリガー/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /シノニム/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /型/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /DB link/ })).toBeInTheDocument()
  })

  it('テーブルを展開すると列名と型が並ぶ', async () => {
    // Arrange
    renderTree()
    await userEvent.click(screen.getByRole('button', { name: /KODUCHI/ }))
    await userEvent.click(screen.getByRole('button', { name: /テーブル/ }))

    // Act
    await userEvent.click(screen.getByRole('button', { name: /USERS/ }))

    // Assert
    expect(screen.getByText('USER_ID')).toBeInTheDocument()
    expect(screen.getByText('VARCHAR2(255)')).toBeInTheDocument()
  })

  it('関数は展開できない', async () => {
    // Arrange
    renderTree()
    await userEvent.click(screen.getByRole('button', { name: /KODUCHI/ }))
    await userEvent.click(screen.getByRole('button', { name: /ファンクション/ }))

    // Act
    const 関数 = screen.getByRole('button', { name: /ORDER_TOTAL/ })

    // Assert
    expect(関数).not.toHaveAttribute('aria-expanded')
  })

  it('絞り込み中は束を開かなくても当たったオブジェクトが見える', async () => {
    // Arrange
    useSchemaStore.setState({ search: 'order' })
    renderTree()

    // Act
    await userEvent.click(screen.getByRole('button', { name: /KODUCHI/ }))

    // Assert
    expect(screen.getByRole('button', { name: /ORDER_TOTAL/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /USERS/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /テーブル/ })).not.toBeInTheDocument()
  })

  it('取得に失敗するとその旨を出す', () => {
    // Arrange
    useSchemaStore.setState({ status: 'failed', error: 'ORA-00942', schemas: [] })

    // Act
    renderTree()

    // Assert
    expect(screen.getByText('ORA-00942')).toBeInTheDocument()
  })
})

describe('flattenSchemas', () => {
  it('畳んだスキーマは自身の 1 行だけになる', () => {
    // Arrange
    const expanded = {}

    // Act
    const rows = flattenSchemas(スキーマ一覧, 列一覧, expanded)

    // Assert
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'schema', name: 'KODUCHI', open: false })
  })

  it('展開したスキーマの下には種別の束だけが並ぶ', () => {
    // Arrange
    const expanded = { KODUCHI: true }

    // Act
    const rows = flattenSchemas(スキーマ一覧, 列一覧, expanded)

    // Assert
    expect(rows.map((row) => row.kind)).toEqual(['schema', 'kindGroup', 'kindGroup'])
    expect(rows[1]).toMatchObject({ objectKind: 'table', count: 1 })
    expect(rows[2]).toMatchObject({ objectKind: 'function', count: 1 })
  })

  it('種別の束は決まった順に並ぶ', () => {
    // Arrange
    const expanded = { KODUCHI: true }

    // Act
    const rows = flattenSchemas(種別の多いスキーマ, {}, expanded)

    // Assert
    expect(rows.filter((row) => row.kind === 'kindGroup').map((row) => row.objectKind)).toEqual([
      'table',
      'index',
      'trigger',
      'synonym',
      'type',
      'databaseLink',
    ])
  })

  it('展開した束の下にその種別のオブジェクトが並ぶ', () => {
    // Arrange
    const expanded = { KODUCHI: true, 'KODUCHI.#table': true }

    // Act
    const rows = flattenSchemas(スキーマ一覧, 列一覧, expanded)

    // Assert
    expect(rows.map((row) => row.kind)).toEqual(['schema', 'kindGroup', 'object', 'kindGroup'])
    expect(rows[2]).toMatchObject({ name: 'USERS', expandable: true })
  })

  it('展開したテーブルの下に自分の列だけが並ぶ', () => {
    // Arrange
    const expanded = { KODUCHI: true, 'KODUCHI.#table': true, 'KODUCHI.USERS': true }

    // Act
    const rows = flattenSchemas(スキーマ一覧, 列一覧, expanded)

    // Assert
    expect(rows.filter((row) => row.kind === 'column').map((row) => row.name)).toEqual([
      'USER_ID',
      'EMAIL',
    ])
  })

  it('列が未取得のテーブルには読み込み中の行が入る', () => {
    // Arrange
    const expanded = { KODUCHI: true, 'KODUCHI.#table': true, 'KODUCHI.USERS': true }

    // Act
    const rows = flattenSchemas(スキーマ一覧, {}, expanded)

    // Assert
    expect(rows.map((row) => row.kind)).toEqual([
      'schema',
      'kindGroup',
      'object',
      'columnsLoading',
      'kindGroup',
    ])
  })

  it('展開できない種類は開いた印を付けても展開されない', () => {
    // Arrange
    const expanded = {
      KODUCHI: true,
      'KODUCHI.#function': true,
      'KODUCHI.ORDER_TOTAL': true,
    }

    // Act
    const rows = flattenSchemas(スキーマ一覧, 列一覧, expanded)

    // Assert
    expect(rows.map((row) => row.kind)).toEqual(['schema', 'kindGroup', 'kindGroup', 'object'])
  })

  it('束を既定で開くと展開の印が無くてもオブジェクトが並ぶ', () => {
    // Arrange: 絞り込み中の挙動である
    const expanded = { KODUCHI: true }

    // Act
    const rows = flattenSchemas(スキーマ一覧, 列一覧, expanded, true)

    // Assert
    expect(rows.filter((row) => row.kind === 'object').map((row) => row.name)).toEqual([
      'USERS',
      'ORDER_TOTAL',
    ])
  })

  it('束を既定で開いても閉じた印があればその束は閉じたままになる', () => {
    // Arrange
    const expanded = { KODUCHI: true, 'KODUCHI.#table': false }

    // Act
    const rows = flattenSchemas(スキーマ一覧, 列一覧, expanded, true)

    // Assert
    expect(rows.filter((row) => row.kind === 'object').map((row) => row.name)).toEqual([
      'ORDER_TOTAL',
    ])
  })
})

describe('テーブル定義ビュー', () => {
  it('テーブルには定義の入口があるが操作できない', async () => {
    // Arrange
    renderTree()
    await userEvent.click(screen.getByRole('button', { name: /KODUCHI/ }))
    await userEvent.click(screen.getByRole('button', { name: /テーブル/ }))

    // Act
    const 入口 = screen.getByTitle('テーブル定義ビューは未実装です')

    // Assert
    expect(入口).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('rowIdentifierPath', () => {
  it('スキーマ行はスキーマ名だけを指す', () => {
    // Arrange
    const rows = flattenSchemas(スキーマ一覧, 列一覧, {})

    // Act
    const path = rowIdentifierPath(rows[0])

    // Assert
    expect(path).toEqual(['KODUCHI'])
  })

  it('オブジェクト行はスキーマで修飾する', () => {
    // Arrange
    const rows = flattenSchemas(スキーマ一覧, 列一覧, { KODUCHI: true, 'KODUCHI.#table': true })

    // Act
    const path = rowIdentifierPath(rows[2])

    // Assert
    expect(path).toEqual(['KODUCHI', 'USERS'])
  })

  it('列行は修飾せず列名だけを指す', () => {
    // Arrange
    const rows = flattenSchemas(スキーマ一覧, 列一覧, {
      KODUCHI: true,
      'KODUCHI.#table': true,
      'KODUCHI.USERS': true,
    })

    // Act
    const path = rowIdentifierPath(rows[3])

    // Assert
    expect(path).toEqual(['USER_ID'])
  })

  it('種別の束は名前を持たない', () => {
    // Arrange
    const rows = flattenSchemas(スキーマ一覧, 列一覧, { KODUCHI: true })

    // Act
    const path = rowIdentifierPath(rows[1])

    // Assert
    expect(path).toBeNull()
  })

  it('列の読み込み中の行も名前を持たない', () => {
    // Arrange
    const rows = flattenSchemas(
      スキーマ一覧,
      {},
      {
        KODUCHI: true,
        'KODUCHI.#table': true,
        'KODUCHI.USERS': true,
      },
    )

    // Act
    const path = rowIdentifierPath(rows[3])

    // Assert
    expect(path).toBeNull()
  })
})

describe('canOpenSelect', () => {
  it('テーブルは SELECT を開ける', () => {
    // Arrange
    const rows = flattenSchemas(スキーマ一覧, 列一覧, { KODUCHI: true, 'KODUCHI.#table': true })

    // Act
    const 開ける = canOpenSelect(rows[2])

    // Assert
    expect(開ける).toBe(true)
  })

  it('関数は SELECT を開けない', () => {
    // Arrange
    const rows = flattenSchemas(スキーマ一覧, 列一覧, { KODUCHI: true, 'KODUCHI.#function': true })

    // Act
    const 開ける = canOpenSelect(rows[3])

    // Assert
    expect(開ける).toBe(false)
  })
})

describe('ツリーからの挿入', () => {
  it('テーブルをダブルクリックするとスキーマ修飾した名前が挿入される', async () => {
    // Arrange
    接続を置く('lower')
    const 挿入 = vi.fn()
    renderTree({ onInsert: 挿入 })
    await userEvent.click(screen.getByRole('button', { name: /KODUCHI/ }))
    await userEvent.click(screen.getByRole('button', { name: /テーブル/ }))

    // Act
    await userEvent.dblClick(screen.getByRole('button', { name: /USERS/ }))

    // Assert
    expect(挿入).toHaveBeenCalledWith('koduchi.users')
  })

  it('綴りの設定が大文字なら大文字で挿入される', async () => {
    // Arrange
    接続を置く('upper')
    const 挿入 = vi.fn()
    renderTree({ onInsert: 挿入 })
    await userEvent.click(screen.getByRole('button', { name: /KODUCHI/ }))
    await userEvent.click(screen.getByRole('button', { name: /テーブル/ }))

    // Act
    await userEvent.dblClick(screen.getByRole('button', { name: /USERS/ }))

    // Assert
    expect(挿入).toHaveBeenCalledWith('KODUCHI.USERS')
  })

  it('列をダブルクリックすると列名だけが挿入される', async () => {
    // Arrange
    接続を置く('lower')
    const 挿入 = vi.fn()
    renderTree({ onInsert: 挿入 })
    await userEvent.click(screen.getByRole('button', { name: /KODUCHI/ }))
    await userEvent.click(screen.getByRole('button', { name: /テーブル/ }))
    await userEvent.click(screen.getByRole('button', { name: /USERS/ }))

    // Act
    await userEvent.dblClick(screen.getByText('USER_ID'))

    // Assert
    expect(挿入).toHaveBeenCalledWith('user_id')
  })

  it('列を持たない種別もダブルクリックで名前が挿入される', async () => {
    // Arrange
    接続を置く('lower')
    useSchemaStore.setState({ schemas: 種別の多いスキーマ, columns: {} })
    const 挿入 = vi.fn()
    renderTree({ onInsert: 挿入 })
    await userEvent.click(screen.getByRole('button', { name: /KODUCHI/ }))
    await userEvent.click(screen.getByRole('button', { name: /索引/ }))

    // Act
    await userEvent.dblClick(screen.getByRole('button', { name: /IX_EVENTS_USER/ }))

    // Assert
    expect(挿入).toHaveBeenCalledWith('koduchi.ix_events_user')
  })

  it('種別の束をダブルクリックしても何も挿入されない', async () => {
    // Arrange
    接続を置く('lower')
    const 挿入 = vi.fn()
    renderTree({ onInsert: 挿入 })
    await userEvent.click(screen.getByRole('button', { name: /KODUCHI/ }))

    // Act
    await userEvent.dblClick(screen.getByRole('button', { name: /テーブル/ }))

    // Assert
    expect(挿入).not.toHaveBeenCalled()
  })

  it('ダブルクリックは開閉を 2 度切り替えるため開き具合は変わらない', async () => {
    // Arrange
    接続を置く('lower')
    renderTree()
    const スキーマ行 = screen.getByRole('button', { name: /KODUCHI/ })

    // Act
    await userEvent.dblClick(スキーマ行)

    // Assert
    expect(screen.getByRole('button', { name: /KODUCHI/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })
})

describe('ツリーの右クリックメニュー', () => {
  const クリップボード = { writeText: vi.fn(async () => {}) }

  beforeEach(() => {
    クリップボード.writeText.mockClear()
    setClipboardApi(クリップボード)
  })

  afterEach(() => {
    resetClipboardApi()
  })

  it('テーブルを右クリックすると 3 項目のメニューが出る', async () => {
    // Arrange
    接続を置く('lower')
    renderTree()
    await userEvent.click(screen.getByRole('button', { name: /KODUCHI/ }))
    await userEvent.click(screen.getByRole('button', { name: /テーブル/ }))

    // Act
    fireEvent.contextMenu(screen.getByRole('button', { name: /USERS/ }))

    // Assert
    expect(screen.getByRole('menuitem', { name: '名前をコピー' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'エディタへ挿入' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'SELECT を開く' })).toBeInTheDocument()
  })

  it('名前をコピーすると挿入と同じ綴りがクリップボードへ入る', async () => {
    // Arrange
    接続を置く('lower')
    renderTree()
    await userEvent.click(screen.getByRole('button', { name: /KODUCHI/ }))
    await userEvent.click(screen.getByRole('button', { name: /テーブル/ }))
    fireEvent.contextMenu(screen.getByRole('button', { name: /USERS/ }))

    // Act
    await userEvent.click(screen.getByRole('menuitem', { name: '名前をコピー' }))

    // Assert
    expect(クリップボード.writeText).toHaveBeenCalledWith('koduchi.users')
  })

  it('SELECT を開くと問い合わせが渡り、実行はされない', async () => {
    // Arrange
    接続を置く('lower')
    const 開く = vi.fn()
    renderTree({ onOpenSelect: 開く })
    await userEvent.click(screen.getByRole('button', { name: /KODUCHI/ }))
    await userEvent.click(screen.getByRole('button', { name: /テーブル/ }))
    fireEvent.contextMenu(screen.getByRole('button', { name: /USERS/ }))

    // Act
    await userEvent.click(screen.getByRole('menuitem', { name: 'SELECT を開く' }))

    // Assert
    expect(開く).toHaveBeenCalledWith('select * from koduchi.users')
  })

  it('列を持たない種別には SELECT を開く項目が出ない', async () => {
    // Arrange
    接続を置く('lower')
    useSchemaStore.setState({ schemas: 種別の多いスキーマ, columns: {} })
    renderTree()
    await userEvent.click(screen.getByRole('button', { name: /KODUCHI/ }))
    await userEvent.click(screen.getByRole('button', { name: /索引/ }))

    // Act
    fireEvent.contextMenu(screen.getByRole('button', { name: /IX_EVENTS_USER/ }))

    // Assert
    expect(screen.queryByRole('menuitem', { name: 'SELECT を開く' })).not.toBeInTheDocument()
  })

  it('種別の束を右クリックしてもメニューは出ない', async () => {
    // Arrange
    接続を置く('lower')
    renderTree()
    await userEvent.click(screen.getByRole('button', { name: /KODUCHI/ }))

    // Act
    fireEvent.contextMenu(screen.getByRole('button', { name: /テーブル/ }))

    // Assert
    expect(screen.queryByTestId('schema-tree-context-menu')).not.toBeInTheDocument()
  })

  it('メニューの外を押すと閉じる', async () => {
    // Arrange
    接続を置く('lower')
    renderTree()
    fireEvent.contextMenu(screen.getByRole('button', { name: /KODUCHI/ }))

    // Act
    fireEvent.mouseDown(screen.getByTestId('schema-tree-context-menu-backdrop'))

    // Assert
    expect(screen.queryByTestId('schema-tree-context-menu')).not.toBeInTheDocument()
  })
})

describe('ツリーのキーボード操作', () => {
  const クリップボード = { writeText: vi.fn(async () => {}) }

  beforeEach(() => {
    クリップボード.writeText.mockClear()
    setClipboardApi(クリップボード)
  })

  afterEach(() => {
    resetClipboardApi()
  })

  it('焦点を持てる行は 1 つだけである', () => {
    // Arrange
    接続を置く('lower')
    renderTree()

    // Act
    const 行 = screen.getAllByRole('button')

    // Assert
    expect(行.filter((row) => row.getAttribute('tabindex') === '0')).toHaveLength(1)
  })

  it('→ で閉じている行が開く', () => {
    // Arrange
    接続を置く('lower')
    renderTree()

    // Act
    fireEvent.keyDown(screen.getByTestId('schema-tree'), { key: 'ArrowRight' })

    // Assert
    expect(screen.getByRole('button', { name: /KODUCHI/ })).toHaveAttribute('aria-expanded', 'true')
  })

  it('← で開いている行が閉じる', () => {
    // Arrange
    接続を置く('lower')
    renderTree()
    fireEvent.keyDown(screen.getByTestId('schema-tree'), { key: 'ArrowRight' })

    // Act
    fireEvent.keyDown(screen.getByTestId('schema-tree'), { key: 'ArrowLeft' })

    // Assert
    expect(screen.getByRole('button', { name: /KODUCHI/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('↓ で焦点が次の行へ移る', () => {
    // Arrange
    接続を置く('lower')
    renderTree()
    fireEvent.keyDown(screen.getByTestId('schema-tree'), { key: 'ArrowRight' })

    // Act
    fireEvent.keyDown(screen.getByTestId('schema-tree'), { key: 'ArrowDown' })

    // Assert
    expect(screen.getByRole('button', { name: /テーブル/ })).toHaveAttribute('tabindex', '0')
  })

  it('⌥⏎ で焦点のある行の名前が挿入される', () => {
    // Arrange
    接続を置く('lower')
    const 挿入 = vi.fn()
    renderTree({ onInsert: 挿入 })

    // Act
    fireEvent.keyDown(screen.getByTestId('schema-tree'), { key: 'Enter', altKey: true })

    // Assert
    expect(挿入).toHaveBeenCalledWith('koduchi')
  })

  it('⌘C で焦点のある行の名前がコピーされる', () => {
    // Arrange
    接続を置く('lower')
    renderTree()

    // Act
    fireEvent.keyDown(screen.getByTestId('schema-tree'), { key: 'c', metaKey: true })

    // Assert
    expect(クリップボード.writeText).toHaveBeenCalledWith('koduchi')
  })
})
