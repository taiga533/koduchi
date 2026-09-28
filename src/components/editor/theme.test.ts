/**
 * エディタのテーマの決め方を見張る（ADR 0031、issue #37）。
 *
 * ここで見張るのは配色ではなく**寸法の置き場所**である。`tooltips({ parent:
 * document.body })` が本体直下に作る入れ物にはエディタと同じテーマの class が
 * 付くため、`&`（テーマの class そのもの）へ寸法を書くと、空の入れ物にも同じ
 * 寸法が付いてしまう。実際にこれでビューポート 1 枚ぶんの白い帯が本体の下に
 * 生まれていた。
 */

import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { editorThemeSpec, koduchiEditorTheme } from './theme'
import { FLASH_DURATION_MS } from './statementRange'

/** 箱の大きさを決める property。`&` にはどれも書いてはならない。 */
const 寸法のproperty = [
  'height',
  'minHeight',
  'maxHeight',
  'width',
  'minWidth',
  'maxWidth',
  'padding',
  'margin',
  'border',
  'display',
  'position',
]

describe('editorThemeSpec', () => {
  it.each(寸法のproperty)('`&` に %s を書かない（入れ物にも当たるため）', (property) => {
    // Arrange
    const 自分自身 = editorThemeSpec['&'] as Record<string, unknown>

    // Act
    const 書いてある = property in 自分自身

    // Assert
    expect(書いてある).toBe(false)
  })

  it('高さは `&.cm-editor` が持つ', () => {
    // Arrange & Act
    const 編集領域 = editorThemeSpec['&.cm-editor'] as Record<string, unknown>

    // Assert
    expect(編集領域.height).toBe('100%')
  })

  it.each(['fontSize', 'color', 'backgroundColor'])('`&` は %s を持つ', (property) => {
    // Arrange
    const 自分自身 = editorThemeSpec['&'] as Record<string, unknown>

    // Act
    const 書いてある = property in 自分自身

    // Assert
    expect(書いてある).toBe(true)
  })

  it('`&` が持つのはその 3 つだけである', () => {
    // Arrange
    const 自分自身 = editorThemeSpec['&'] as Record<string, unknown>

    // Act
    const 数 = Object.keys(自分自身).length

    // Assert
    expect(数).toBe(3)
  })

  it('高さを持つ選択子は `&.cm-editor` だけである', () => {
    // Arrange
    const 高さを持つ = Object.entries(editorThemeSpec)
      .filter(([, decls]) => 'height' in (decls as Record<string, unknown>))
      .map(([selector]) => selector)

    // Act & Assert
    expect(高さを持つ).toEqual(['&.cm-editor'])
  })
})

describe('選択の描き方（issue #54）', () => {
  it('テーマ一式を載せたエディタは選択を層として描く', () => {
    // Arrange
    const parent = document.createElement('div')
    document.body.appendChild(parent)

    // Act
    const view = new EditorView({
      state: EditorState.create({
        doc: 'select 1\nfrom dual',
        selection: { anchor: 0, head: 18 },
        extensions: [koduchiEditorTheme],
      }),
      parent,
    })

    // Assert
    expect(view.dom.querySelector('.cm-selectionLayer')).not.toBeNull()
    view.destroy()
    parent.remove()
  })

  it('横の余白は `.cm-content` ではなく行が持つ（選択が文字の左へはみ出さないため）', () => {
    // Arrange
    const 本文 = editorThemeSpec['.cm-content'] as Record<string, unknown>
    const 行 = editorThemeSpec['.cm-line'] as Record<string, unknown>

    // Act
    const [, 本文の横] = String(本文.padding).split(' ')

    // Assert
    expect(本文の横).toBe('0')
    expect(行.padding).toBe('0 16px 0 20px')
  })

  it('焦点のある選択の色は基底テーマと同じ強さの選択子で決める', () => {
    // Arrange
    const 焦点のある選択 =
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground'

    // Act
    const 当たる規則 = Object.entries(editorThemeSpec).find(([selector]) =>
      selector.split(',').some((part) => part.trim() === 焦点のある選択),
    )

    // Assert
    expect(当たる規則?.[1]).toMatchObject({ backgroundColor: 'var(--fill2)' })
  })
})

/**
 * 選択子の宣言を引く。
 *
 * @param selector 選択子
 */
function 宣言(selector: string): Record<string, unknown> {
  return (editorThemeSpec as Record<string, Record<string, unknown>>)[selector]
}

describe('流れる文の範囲の見た目（ADR 0047）', () => {
  it('縦線の溝の幅ぶんだけ行番号の右の余白を詰め、本文の位置を変えない', () => {
    // Arrange
    const 行番号 = 宣言('.cm-lineNumbers .cm-gutterElement')
    const 溝 = 宣言('.cm-runRangeGutter')

    // Act
    const 右の余白 = Number.parseInt(String(行番号.padding).split(' ')[1], 10)
    const 溝の幅 = Number.parseInt(String(溝.width), 10)

    // Assert（元の右の余白は 12px）
    expect(右の余白 + 溝の幅).toBe(12)
  })

  it.each(['a', 'b'])('光 %s のアニメーションは光らせておく時間と同じ長さで走る', (suffix) => {
    // Arrange
    const 光 = 宣言(`.cm-runFlash-${suffix}`)

    // Act
    const animation = String(光.animation)

    // Assert
    expect(animation).toContain(`koduchi-run-flash-${suffix} ${FLASH_DURATION_MS}ms`)
    expect(宣言(`@keyframes koduchi-run-flash-${suffix}`)).toBeDefined()
  })

  it('動きを減らす設定では消えていく動きを止め、地だけを敷く', () => {
    // Arrange
    const 動きを減らす = 宣言('@media (prefers-reduced-motion: reduce)') as Record<
      string,
      Record<string, unknown>
    >

    // Act
    const 光 = 動きを減らす['.cm-runFlash']

    // Assert
    expect(光.animation).toBe('none')
    expect(String(光.backgroundColor)).toContain('var(--ac)')
  })

  it('色は値を書かずにトークンを参照する', () => {
    // Arrange
    const 縦線 = 宣言('.cm-runRange::before')
    const 光の始まり = (
      宣言('@keyframes koduchi-run-flash-a') as Record<string, Record<string, unknown>>
    ).from

    // Act & Assert
    expect(縦線.backgroundColor).toBe('var(--ac)')
    expect(String(光の始まり.backgroundColor)).toMatch(
      /^color-mix\(in srgb, var\(--ac\) \d+%, transparent\)$/,
    )
  })
})
