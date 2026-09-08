import { createRef } from 'react'
import { describe, expect, it } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SchemaNode, TableColumn } from '../../types/db'
import { buildCatalog, EMPTY_CATALOG } from './catalog'
import { SqlEditor, type EditorPosition, type SqlEditorHandle } from './SqlEditor'

/** 既定の props でエディタを描き、通知された内容を集めて返す。 */
function 描く(overrides: Partial<React.ComponentProps<typeof SqlEditor>> = {}) {
  const 通知: { content: string[]; position: EditorPosition[] } = { content: [], position: [] }
  const props: React.ComponentProps<typeof SqlEditor> = {
    value: '',
    catalog: EMPTY_CATALOG,
    identifierCase: 'preserve',
    onChange: (content) => 通知.content.push(content),
    onCursorChange: (position) => 通知.position.push(position),
    onRunStatement: () => {},
    onRunSelection: () => {},
    onRunScript: () => {},
    onCancel: () => {},
    onFormatFailed: () => {},
    ...overrides,
  }
  const { rerender } = render(<SqlEditor {...props} />)
  return {
    通知,
    /** 外から内容を差し替える。 */
    差し替える: (value: string) => rerender(<SqlEditor {...props} value={value} />),
  }
}

/** 検索パネルの要素を取り出す。開いていなければ `null`。 */
function 検索パネル(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.cm-panel.cm-search')
}

/** 検索パネルの中の入力欄を名前で取り出す。 */
function 検索欄(name: 'search' | 'replace'): HTMLInputElement {
  const 欄 = 検索パネル()?.querySelector(`input[name="${name}"]`)
  if (!(欄 instanceof HTMLInputElement)) {
    throw new Error(`検索パネルの ${name} 欄が見つからない`)
  }
  return 欄
}

/** 補完に使うカタログ。KODUCHI スキーマに ORDERS が 1 つある。 */
const カタログ = buildCatalog(
  [
    {
      name: 'KODUCHI',
      objectCount: 1,
      objects: [{ name: 'ORDERS', kind: 'table' }],
    } satisfies SchemaNode,
  ],
  {
    KODUCHI: [
      {
        objectName: 'ORDERS',
        name: 'ORDER_ID',
        typeName: 'NUMBER(12)',
        nullable: false,
        kind: 'number',
      } satisfies TableColumn,
    ],
  },
  'KODUCHI',
)

/** 補完の候補一覧を取り出す。開いていなければ `null`。 */
function 補完一覧(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.cm-tooltip-autocomplete')
}

/** 編集領域の要素を取り出す。 */
function 編集領域(): HTMLElement {
  const content = document.querySelector('.cm-content')
  if (!(content instanceof HTMLElement)) {
    throw new Error('編集領域が見つからない')
  }
  return content
}

describe('SqlEditor', () => {
  it('初期値が表示される', () => {
    // Arrange
    描く({ value: 'select 1 from dual' })

    // Act
    const 表示 = 編集領域().textContent

    // Assert
    expect(表示).toContain('select 1 from dual')
  })

  it('綴り検査と自動修正を切ってある', () => {
    // Arrange
    描く()

    // Act
    const 領域 = 編集領域()

    // Assert
    expect(領域).toHaveAttribute('spellcheck', 'false')
    expect(領域).toHaveAttribute('autocorrect', 'off')
    expect(領域).toHaveAttribute('autocapitalize', 'off')
  })

  it('入力すると内容が通知される', async () => {
    // Arrange
    const { 通知 } = 描く()

    // Act
    await userEvent.click(編集領域())
    await userEvent.keyboard('select')

    // Assert
    expect(通知.content.at(-1)).toBe('select')
  })

  it('入力するとカーソル位置が通知される', async () => {
    // Arrange
    const { 通知 } = 描く()

    // Act
    await userEvent.click(編集領域())
    await userEvent.keyboard('abc')

    // Assert
    expect(通知.position.at(-1)).toMatchObject({ line: 1, column: 4, offset: 3 })
  })

  it('⌥⌘⏎ でスクリプト実行が呼ばれる', async () => {
    // Arrange
    const 呼ばれた: string[] = []
    描く({ value: 'select 1;', onRunScript: () => 呼ばれた.push('script') })

    // Act
    await userEvent.click(編集領域())
    await userEvent.keyboard('{Alt>}{Meta>}{Enter}{/Meta}{/Alt}')

    // Assert
    expect(呼ばれた).toEqual(['script'])
  })

  it('カタログの表名が補完の候補に出る', async () => {
    // Arrange: 補完ソースが方言の言語データに繋がっていることを確かめる
    描く({ catalog: カタログ })
    await userEvent.click(編集領域())

    // Act
    await userEvent.keyboard('select * from ord')

    // Assert
    await waitFor(() => expect(補完一覧()?.textContent).toContain('ORDERS'))
  })

  it('小文字を選ぶと候補も小文字で出る', async () => {
    // Arrange
    描く({ catalog: カタログ, identifierCase: 'lower' })
    await userEvent.click(編集領域())

    // Act
    await userEvent.keyboard('select * from ord')

    // Assert
    await waitFor(() => expect(補完一覧()?.textContent).toContain('orders'))
  })

  it('外から内容を差し替えると反映される', () => {
    // Arrange
    const { 差し替える } = 描く({ value: '' })

    // Act
    差し替える('select * from users')

    // Assert
    expect(編集領域().textContent).toContain('select * from users')
  })

  it('⌘F で検索パネルが開く', async () => {
    // Arrange
    描く({ value: 'select id from users' })

    // Act
    await userEvent.click(編集領域())
    await userEvent.keyboard('{Meta>}f{/Meta}')

    // Assert
    expect(検索パネル()).not.toBeNull()
    expect(検索欄('search')).toBeInTheDocument()
  })

  it('検索パネルの文言が日本語になっている', async () => {
    // Arrange
    描く({ value: 'select id from users' })

    // Act
    await userEvent.click(編集領域())
    await userEvent.keyboard('{Meta>}f{/Meta}')

    // Assert
    expect(検索欄('search')).toHaveAttribute('placeholder', '検索')
    expect(検索欄('replace')).toHaveAttribute('placeholder', '置換後の文字列')
    expect(検索パネル()?.textContent).toContain('次へ')
    expect(検索パネル()?.textContent).toContain('すべて置換')
  })

  it('検索語を入れると該当箇所が強調される', async () => {
    // Arrange
    描く({ value: 'select users.id from users' })
    await userEvent.click(編集領域())
    await userEvent.keyboard('{Meta>}f{/Meta}')

    // Act
    await userEvent.type(検索欄('search'), 'users')

    // Assert
    expect(document.querySelectorAll('.cm-searchMatch').length).toBeGreaterThan(0)
  })

  it('⌥⌘F で置換欄に入力の焦点が移る', async () => {
    // Arrange
    描く({ value: 'select id from users' })

    // Act
    await userEvent.click(編集領域())
    await userEvent.keyboard('{Meta>}{Alt>}f{/Alt}{/Meta}')

    // Assert
    expect(document.activeElement).toBe(検索欄('replace'))
  })

  it('検索欄の変換中は検索語を確定しない', async () => {
    // Arrange
    描く({ value: 'select id from users' })
    await userEvent.click(編集領域())
    await userEvent.keyboard('{Meta>}f{/Meta}')
    const 欄 = 検索欄('search')

    // Act
    欄.value = 'い'
    欄.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, isComposing: true }))

    // Assert
    expect(document.querySelectorAll('.cm-searchMatch')).toHaveLength(0)
  })

  it('検索パネルの閉じるボタンは文字ではなくアイコンで描かれる', async () => {
    // Arrange
    描く({ value: 'select id from users' })

    // Act
    await userEvent.click(編集領域())
    await userEvent.keyboard('{Meta>}f{/Meta}')

    // Assert
    const 閉じる = 検索パネル()?.querySelector('button[name="close"]')
    expect(閉じる?.querySelector('svg')).not.toBeNull()
    expect(閉じる?.textContent).toBe('')
  })

  it('自分が伝えた内容が返ってきても打ち直さない', async () => {
    // Arrange
    const { 通知, 差し替える } = 描く()
    await userEvent.click(編集領域())
    await userEvent.keyboard('select')
    const 通知の数 = 通知.content.length

    // Act
    差し替える('select')

    // Assert
    expect(通知.content).toHaveLength(通知の数)
    expect(編集領域().textContent).toContain('select')
  })
})

/** 挿入の口を持たせてエディタを描く。 */
function 口付きで描く(overrides: Partial<React.ComponentProps<typeof SqlEditor>> = {}) {
  const ref = createRef<SqlEditorHandle>()
  render(
    <SqlEditor
      ref={ref}
      value=""
      catalog={EMPTY_CATALOG}
      identifierCase="preserve"
      onChange={() => {}}
      onCursorChange={() => {}}
      onRunStatement={() => {}}
      onRunSelection={() => {}}
      onRunScript={() => {}}
      onCancel={() => {}}
      onFormatFailed={() => {}}
      {...overrides}
    />,
  )
  return ref
}

describe('insertAtCursor', () => {
  it('空の文書では前に空白を入れずに挿入する', () => {
    // Arrange
    const ref = 口付きで描く()

    // Act
    ref.current?.insertAtCursor('koduchi.users')

    // Assert
    expect(編集領域().textContent).toBe('koduchi.users')
  })

  it('語の直後へ挿入すると空白で区切られる', async () => {
    // Arrange
    const ref = 口付きで描く()
    await userEvent.click(編集領域())
    await userEvent.keyboard('select * from')

    // Act
    ref.current?.insertAtCursor('koduchi.users')

    // Assert
    expect(編集領域().textContent).toBe('select * from koduchi.users')
  })

  it('空白の直後へ挿入しても空白は増えない', async () => {
    // Arrange
    const ref = 口付きで描く()
    await userEvent.click(編集領域())
    await userEvent.keyboard('select * from ')

    // Act
    ref.current?.insertAtCursor('koduchi.users')

    // Assert
    expect(編集領域().textContent).toBe('select * from koduchi.users')
  })

  it('挿入するとカーソルが挿入した文字列の後ろへ移る', async () => {
    // Arrange
    const ref = 口付きで描く()
    await userEvent.click(編集領域())
    await userEvent.keyboard('select ')

    // Act
    ref.current?.insertAtCursor('user_id')
    await userEvent.keyboard(', email')

    // Assert
    expect(編集領域().textContent).toBe('select user_id, email')
  })
})

/** 編集領域に描かれている行の数。CodeMirror は 1 行を 1 要素で描く。 */
function 行数(): number {
  return document.querySelectorAll('.cm-content .cm-line').length
}

describe('整形（⇧⌥F、ADR 0024）', () => {
  /**
   * `⇧⌥F` を打つ。
   *
   * macOS では `⌥` を伴う打鍵で `key` が `Ï` に変わる。実機と同じ形を作り、
   * `code` で拾えていることを確かめる。
   */
  function 整形の打鍵(): boolean {
    return 編集領域().dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Ï',
        code: 'KeyF',
        altKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
  }

  it('⇧⌥F で本文が整形される', () => {
    // Arrange
    口付きで描く({ value: 'select a,b from t' })

    // Act
    整形の打鍵()

    // Assert
    expect(行数()).toBeGreaterThan(1)
  })

  it('⇧⌥F の打鍵は既定の動作を止め、文字を打ち込ませない', () => {
    // Arrange
    口付きで描く({ value: 'select a from t' })

    // Act
    const 既定のまま進んだか = 整形の打鍵()

    // Assert
    expect(既定のまま進んだか).toBe(false)
  })

  it('整形できない本文では、本文に触れず理由を伝える', () => {
    // Arrange
    const 理由: string[] = []
    const 元の本文 = "select q'[一行目\n二行目]' from dual"
    口付きで描く({ value: 元の本文, onFormatFailed: (message) => 理由.push(message) })

    // Act
    整形の打鍵()

    // Assert
    expect(編集領域().textContent).toBe(元の本文.replace('\n', ''))
    expect(理由).toHaveLength(1)
  })

  it('口からも同じ整形が行える（コマンドパレット用）', () => {
    // Arrange
    const ref = 口付きで描く({ value: 'select a,b from t' })

    // Act
    ref.current?.formatDocument()

    // Assert
    expect(行数()).toBeGreaterThan(1)
  })
})
