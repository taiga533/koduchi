import { describe, expect, it } from 'vitest'
import type { BindableCommand } from './bindings'
import {
  checkRecordedChord,
  resolveKeybindings,
  shortcutLabelFor,
  withOverride,
  withoutOverride,
} from './bindings'

/** 試しに使う表。 */
const 表: BindableCommand[] = [
  { id: 'commit', label: 'コミット', defaultKey: { key: 'c', ctrl: true, meta: true } },
  { id: 'palette', label: 'パレット', defaultKey: { key: 'p', shift: true, meta: true } },
  { id: 'sessions', label: 'セッション', defaultKey: null },
]

describe('resolveKeybindings', () => {
  it('差分が無ければ既定のキーになる', () => {
    // Arrange & Act
    const resolved = resolveKeybindings(表, {})

    // Assert
    expect(resolved.chords.get('commit')).toEqual({ key: 'c', ctrl: true, meta: true })
    expect(resolved.chords.has('sessions')).toBe(false)
    expect(resolved.issues).toEqual([])
  })

  it('差分があればそのキー、空文字なら外す', () => {
    // Arrange & Act
    const resolved = resolveKeybindings(表, { palette: 'cmd+k', commit: '', sessions: 'f9' })

    // Assert
    expect(resolved.chords.get('palette')).toEqual({ key: 'k', meta: true })
    expect(resolved.chords.has('commit')).toBe(false)
    expect(resolved.chords.get('sessions')).toEqual({ key: 'f9' })
  })

  it('読めない差分はその操作だけ既定に戻し、報せる', () => {
    // Arrange & Act
    const resolved = resolveKeybindings(表, { palette: 'cmd+shift+' })

    // Assert
    expect(resolved.chords.get('palette')).toEqual({ key: 'p', shift: true, meta: true })
    expect(resolved.issues).toEqual([{ kind: 'unreadable', id: 'palette', text: 'cmd+shift+' }])
  })

  it('知らない操作の差分は読み飛ばす', () => {
    // Arrange & Act
    const resolved = resolveKeybindings(表, { 'future-command': 'cmd+j' })

    // Assert
    expect([...resolved.chords.keys()]).toEqual(['commit', 'palette'])
    expect(resolved.issues).toEqual([])
  })

  it('重なったら利用者が付けたほうが勝ち、既定の側はキーを失う', () => {
    // Arrange: パレットの既定 ⇧⌘P をセッションへ付けた
    const overrides = { sessions: 'shift+cmd+p' }

    // Act
    const resolved = resolveKeybindings(表, overrides)

    // Assert
    expect(resolved.chords.get('sessions')).toEqual({ key: 'p', shift: true, meta: true })
    expect(resolved.chords.has('palette')).toBe(false)
    expect(resolved.issues).toEqual([
      {
        kind: 'shadowed',
        id: 'palette',
        chord: { key: 'p', shift: true, meta: true },
        by: 'sessions',
      },
    ])
  })

  it('同じ立場で重なったら表の上の行が勝つ', () => {
    // Arrange
    const overrides = { palette: 'cmd+j', sessions: 'cmd+j' }

    // Act
    const resolved = resolveKeybindings(表, overrides)

    // Assert
    expect(resolved.chords.get('palette')).toEqual({ key: 'j', meta: true })
    expect(resolved.chords.has('sessions')).toBe(false)
  })

  it('固定のキーと重なった差分は効かせず、報せる', () => {
    // Arrange: 手で書いた settings.toml
    const overrides = { sessions: 'cmd+c' }

    // Act
    const resolved = resolveKeybindings(表, overrides)

    // Assert
    expect(resolved.chords.has('sessions')).toBe(false)
    expect(resolved.issues[0]).toMatchObject({ kind: 'fixed', id: 'sessions', by: 'コピー' })
  })
})

describe('checkRecordedChord', () => {
  const resolved = resolveKeybindings(表, {})

  it('空いている組み合わせは受ける', () => {
    // Arrange & Act
    const check = checkRecordedChord({ key: 'j', meta: true }, 'sessions', 表, resolved)

    // Assert
    expect(check).toEqual({ ok: true })
  })

  it('自分が今持っている組み合わせは受ける', () => {
    // Arrange & Act
    const check = checkRecordedChord({ key: 'c', ctrl: true, meta: true }, 'commit', 表, resolved)

    // Assert
    expect(check).toEqual({ ok: true })
  })

  it('他の操作が持っている組み合わせは相手の名前を添えて断る', () => {
    // Arrange & Act
    const check = checkRecordedChord(
      { key: 'p', shift: true, meta: true },
      'sessions',
      表,
      resolved,
    )

    // Assert
    expect(check).toEqual({ ok: false, reason: '⇧⌘P は「パレット」に割り当て済みです' })
  })

  it('固定のキーは断る', () => {
    // Arrange & Act
    const check = checkRecordedChord({ key: 'f', meta: true }, 'sessions', 表, resolved)

    // Assert
    expect(check).toEqual({ ok: false, reason: '⌘F は「検索」で使われていて変えられません' })
  })

  it('修飾の無い打鍵は断り、ファンクションキーは受ける', () => {
    // Arrange & Act
    const 文字 = checkRecordedChord({ key: 'a', shift: true }, 'sessions', 表, resolved)
    const 機能キー = checkRecordedChord({ key: 'f9' }, 'sessions', 表, resolved)

    // Assert
    expect(文字.ok).toBe(false)
    expect(機能キー.ok).toBe(true)
  })
})

describe('withOverride', () => {
  it('既定と違う組み合わせは差分に書く', () => {
    // Arrange & Act
    const next = withOverride({}, 表[1], { key: 'k', meta: true })

    // Assert
    expect(next).toEqual({ palette: 'cmd+k' })
  })

  it('既定と同じ組み合わせに戻したら差分から消す', () => {
    // Arrange & Act
    const next = withOverride({ palette: 'cmd+k' }, 表[1], { key: 'p', shift: true, meta: true })

    // Assert
    expect(next).toEqual({})
  })

  it('外すと空文字を書き、既定の無い操作を外しても差分は増えない', () => {
    // Arrange & Act
    const 外した = withOverride({}, 表[0], null)
    const 元から無い = withOverride({ sessions: 'f9' }, 表[2], null)

    // Assert
    expect(外した).toEqual({ commit: '' })
    expect(元から無い).toEqual({})
  })

  it('他の操作と知らない操作の差分は残す', () => {
    // Arrange & Act
    const next = withOverride({ commit: '', future: 'cmd+j' }, 表[1], { key: 'k', meta: true })

    // Assert
    expect(next).toEqual({ commit: '', future: 'cmd+j', palette: 'cmd+k' })
  })
})

describe('withoutOverride', () => {
  it('その操作の差分だけを消す', () => {
    // Arrange & Act
    const next = withoutOverride({ commit: '', palette: 'cmd+k' }, 'commit')

    // Assert
    expect(next).toEqual({ palette: 'cmd+k' })
  })
})

describe('shortcutLabelFor', () => {
  it('今のキーの表記を引き、キーが無ければ空文字にする', () => {
    // Arrange
    const resolved = resolveKeybindings(表, { palette: 'cmd+k' })

    // Act
    const labels = ['palette', 'sessions', 'unknown'].map((id) => shortcutLabelFor(id, resolved))

    // Assert
    expect(labels).toEqual(['⌘K', '', ''])
  })
})
