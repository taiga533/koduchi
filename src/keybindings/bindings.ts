/**
 * キーの割り当ての解決（ADR 0037）。
 *
 * コマンドの表が持つ既定のキーと、利用者が `settings.toml` に書いた差分から、
 * 今どの操作にどのキーが付いているかを決める。表そのもの（仲介者の値）は
 * import せず、`id` と既定のキーだけを受け取る。ストア・設定画面・パレットの
 * どれからも同じ規則で引けるようにするためである。
 */

import type { Chord } from './chord'
import {
  formatChord,
  hasModifierOrFunctionKey,
  parseChord,
  sameChord,
  serializeChord,
} from './chord'

/**
 * 利用者が書いた差分。鍵はコマンドの `id`、値は保存の書き方（`cmd+shift+p`）。
 * **空文字は「キーを外した」。**既定と同じ行は持たない。
 */
export type KeybindingOverrides = Readonly<Record<string, string>>

/** 割り当てを決めるのに要る、コマンドの表の 1 行。 */
export interface BindableCommand {
  id: string
  label: string
  defaultKey: Chord | null
}

/** 割り当て直せないキー。 */
export interface FixedKey {
  chord: Chord
  /** 何に使われているか。設定画面と断りの文言に出す。 */
  label: string
}

/**
 * 割り当て直せないキーの一覧（ADR 0037）。
 *
 * 判定そのものは各部品の `keydown`（と CodeMirror・macOS・メニュー）が持つ。
 * ここは記録の欄が断るためと、設定画面で見せるための写しである。
 */
export const FIXED_KEYS: readonly FixedKey[] = [
  { chord: { key: 'f', meta: true }, label: '検索' },
  { chord: { key: 'g', meta: true }, label: '次の一致' },
  { chord: { key: 'g', meta: true, shift: true }, label: '前の一致' },
  { chord: { key: 'f', meta: true, alt: true }, label: '置換' },
  { chord: { key: '/', meta: true }, label: '行コメントの切り替え' },
  { chord: { key: '[', meta: true }, label: 'インデントを減らす' },
  { chord: { key: ']', meta: true }, label: 'インデントを増やす' },
  { chord: { key: 'z', meta: true }, label: '取り消し' },
  { chord: { key: 'z', meta: true, shift: true }, label: 'やり直し' },
  { chord: { key: 'x', meta: true }, label: '切り取り' },
  { chord: { key: 'c', meta: true }, label: 'コピー' },
  { chord: { key: 'v', meta: true }, label: '貼り付け' },
  { chord: { key: 'a', meta: true }, label: 'すべて選択' },
  { chord: { key: 'c', meta: true, shift: true }, label: '結果を見出し付きでコピー' },
  { chord: { key: 'd', meta: true }, label: '定義を開く（ツリー）' },
  { chord: { key: 'enter', alt: true }, label: '名前を挿入（ツリー）' },
  { chord: { key: 'f2' }, label: 'タブの名前の付け直し' },
  { chord: { key: 'left', alt: true }, label: 'タブを左へ' },
  { chord: { key: 'right', alt: true }, label: 'タブを右へ' },
  { chord: { key: ',', meta: true }, label: '設定を開く（メニュー）' },
  { chord: { key: 'q', meta: true }, label: '終了' },
  { chord: { key: 'h', meta: true }, label: '隠す' },
  { chord: { key: 'm', meta: true }, label: 'しまう' },
]

/** 割り当ての食い違い。設定画面に出す。 */
export type KeybindingIssue =
  /** 差分の値が読めない。その操作は既定のキーで動く。 */
  | { kind: 'unreadable'; id: string; text: string }
  /** 別の操作と重なり、負けた。その操作にはキーが無い。 */
  | { kind: 'shadowed'; id: string; chord: Chord; by: string }
  /** 割り当て直せないキーと重なった。その操作にはキーが無い。 */
  | { kind: 'fixed'; id: string; chord: Chord; by: string }

/** 解決した割り当て。 */
export interface ResolvedKeybindings {
  /** 操作の `id` から今のキー。キーが無い操作は入らない。 */
  chords: ReadonlyMap<string, Chord>
  issues: readonly KeybindingIssue[]
}

/** 候補の 1 つ。 */
interface Candidate {
  command: BindableCommand
  chord: Chord
  /** 利用者が付けたか。重なったときに勝つ。 */
  user: boolean
}

/**
 * 既定のキーと差分から、今の割り当てを決める。
 *
 * **どう読み損ねても既定のキーで動く。**読めない値はその操作だけ既定に戻し、
 * 知らない `id` は読み飛ばす。同じ組み合わせが 2 つの操作に付いたら、利用者が
 * 付けたほうが勝ち、同じ立場なら表の上の行が勝つ。手で書いた `settings.toml`
 * や、後の版で既定が変わったことで重なりうるためで、起動は止めない。
 *
 * @param commands コマンドの表
 * @param overrides 利用者が書いた差分
 */
export function resolveKeybindings(
  commands: readonly BindableCommand[],
  overrides: KeybindingOverrides,
): ResolvedKeybindings {
  const issues: KeybindingIssue[] = []
  const candidates: Candidate[] = []

  for (const command of commands) {
    const text = Object.hasOwn(overrides, command.id) ? overrides[command.id] : undefined
    if (text === undefined) {
      if (command.defaultKey) {
        candidates.push({ command, chord: command.defaultKey, user: false })
      }
      continue
    }
    if (text.trim() === '') {
      continue
    }
    const chord = parseChord(text)
    if (chord === null) {
      issues.push({ kind: 'unreadable', id: command.id, text })
      if (command.defaultKey) {
        candidates.push({ command, chord: command.defaultKey, user: false })
      }
      continue
    }
    candidates.push({ command, chord, user: true })
  }

  // 利用者が付けたものを先に見る。同じ立場の中では表の順のまま。
  const ordered = [
    ...candidates.filter((candidate) => candidate.user),
    ...candidates.filter((candidate) => !candidate.user),
  ]
  const chords = new Map<string, Chord>()
  const owners: { chord: Chord; id: string }[] = []

  for (const { command, chord } of ordered) {
    const fixed = FIXED_KEYS.find((item) => sameChord(item.chord, chord))
    if (fixed) {
      issues.push({ kind: 'fixed', id: command.id, chord, by: fixed.label })
      continue
    }
    const owner = owners.find((item) => sameChord(item.chord, chord))
    if (owner) {
      issues.push({ kind: 'shadowed', id: command.id, chord, by: owner.id })
      continue
    }
    owners.push({ chord, id: command.id })
    chords.set(command.id, chord)
  }

  return { chords, issues }
}

/** 記録した組み合わせを受けられるか。 */
export type RecordCheck = { ok: true } | { ok: false; reason: string }

/**
 * 記録の欄で打たれた組み合わせを、その操作に付けてよいか確かめる。
 *
 * **重なる相手から黙って外すことはしない**（ADR 0037）。気付かないうちに別の
 * 操作のキーが消えるためである。
 *
 * @param chord 打たれた組み合わせ
 * @param id 付けようとしている操作
 * @param commands コマンドの表
 * @param resolved 今の割り当て
 */
export function checkRecordedChord(
  chord: Chord,
  id: string,
  commands: readonly BindableCommand[],
  resolved: ResolvedKeybindings,
): RecordCheck {
  if (!hasModifierOrFunctionKey(chord)) {
    return { ok: false, reason: '⌘ ⌃ ⌥ のどれかを含めてください（F1〜F20 は単独でも使えます）' }
  }
  const fixed = FIXED_KEYS.find((item) => sameChord(item.chord, chord))
  if (fixed) {
    return {
      ok: false,
      reason: `${formatChord(chord)} は「${fixed.label}」で使われていて変えられません`,
    }
  }
  for (const [ownerId, owned] of resolved.chords) {
    if (ownerId !== id && sameChord(owned, chord)) {
      const owner = commands.find((command) => command.id === ownerId)
      return {
        ok: false,
        reason: `${formatChord(chord)} は「${owner?.label ?? ownerId}」に割り当て済みです`,
      }
    }
  }
  return { ok: true }
}

/**
 * 1 つの操作のキーを付け替えた差分を作る。`chord` が `null` ならキーを外す。
 *
 * **既定と同じになったら差分から消す。**差分に既定を書き写すと、後の版で既定を
 * 直してもその利用者には届かなくなる。
 *
 * @param overrides 今の差分
 * @param command 付け替える操作
 * @param chord 新しい組み合わせ
 */
export function withOverride(
  overrides: KeybindingOverrides,
  command: BindableCommand,
  chord: Chord | null,
): KeybindingOverrides {
  const next = { ...overrides }
  const sameAsDefault =
    chord === null
      ? command.defaultKey === null
      : command.defaultKey !== null && sameChord(chord, command.defaultKey)
  if (sameAsDefault) {
    delete next[command.id]
  } else {
    next[command.id] = chord === null ? '' : serializeChord(chord)
  }
  return next
}

/**
 * 1 つの操作を既定へ戻した差分を作る。
 *
 * @param overrides 今の差分
 * @param id 戻す操作
 */
export function withoutOverride(overrides: KeybindingOverrides, id: string): KeybindingOverrides {
  const next = { ...overrides }
  delete next[id]
  return next
}

/**
 * 操作の `id` から今のキーの表記を引く。キーが無ければ空文字。
 *
 * パレットと、後で足す右クリックのメニューが同じ表記を出すための口である。
 *
 * @param id 操作の `id`
 * @param resolved 今の割り当て
 */
export function shortcutLabelFor(id: string, resolved: ResolvedKeybindings): string {
  const chord = resolved.chords.get(id)
  return chord ? formatChord(chord) : ''
}
