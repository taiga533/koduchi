/**
 * キーの組み合わせ（ADR 0037）。
 *
 * 保存の書き方（`cmd+shift+p`）・画面の表記（`⇧⌘P`）・打鍵との照合を 1 か所に
 * 置く。ウィンドウの振り分けと CodeMirror の keymap と記録の欄が同じ規則で
 * キーを読まないと、記録した組み合わせが効かない、ということが起きる。
 */

/** キーの組み合わせ。修飾は押されていなければならないものだけを真にする。 */
export interface Chord {
  /** キーの名前。英数字と記号は小文字の 1 文字、それ以外は `enter` / `f5` / `left` など。 */
  key: string
  meta?: boolean
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
}

/** 照合に要る打鍵の中身。`KeyboardEvent` はこの形を満たす。 */
export interface KeyPress {
  key: string
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/** `event.key` のうち、名前へ読み替えるもの。 */
const NAMED_KEYS: Record<string, string> = {
  Enter: 'enter',
  Escape: 'escape',
  Tab: 'tab',
  Backspace: 'backspace',
  Delete: 'delete',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  ' ': 'space',
}

/** 名前だけの打鍵（修飾キーそのもの）。組み合わせにはならない。 */
const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift', 'CapsLock', 'Fn', 'OS'])

/** `event.code` の記号キー。`⌥` で化けた文字を物理のキーから読み戻すために使う。 */
const CODE_SYMBOLS: Record<string, string> = {
  Period: '.',
  Comma: ',',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Backslash: '\\',
}

/** 画面に出すときの名前。無いものは大文字にして出す。 */
const KEY_LABELS: Record<string, string> = {
  enter: '⏎',
  escape: 'esc',
  tab: '⇥',
  backspace: '⌫',
  delete: '⌦',
  left: '←',
  right: '→',
  up: '↑',
  down: '↓',
  home: '↖',
  end: '↘',
  pageup: '⇞',
  pagedown: '⇟',
  space: 'Space',
}

/** 修飾の保存の書き方。VSCode の `keybindings.json` と同じ語にする。 */
const MODIFIER_NAMES = ['ctrl', 'alt', 'shift', 'cmd'] as const

/** ファンクションキーの名前か。 */
function isFunctionKey(key: string): boolean {
  return /^f([1-9]|1[0-9]|20)$/.test(key)
}

/** 組み合わせのキーとして受け付ける名前か。 */
function isValidKeyName(key: string): boolean {
  return (
    Object.values(NAMED_KEYS).includes(key) ||
    isFunctionKey(key) ||
    (key.length === 1 && key !== '+' && key.trim() !== '' && key === key.toLowerCase())
  )
}

/**
 * `event.code` から、物理のキーに刻まれた文字を読む。読めなければ `null`。
 *
 * @param code `event.code`
 */
function keyFromCode(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) {
    return letter[1].toLowerCase()
  }
  const digit = /^Digit([0-9])$/.exec(code)
  if (digit) {
    return digit[1]
  }
  return CODE_SYMBOLS[code] ?? null
}

/**
 * 打鍵からキーの名前を読む。修飾キーそのものなら `null`。
 *
 * **`⌥` が押されていれば `event.code` から読む。**macOS では `⌥` を伴う打鍵が
 * 文字そのものを変える（`⇧⌥F` は `Ï`、ADR 0024）。それ以外は `event.key` を
 * 先に見る。Dvorak のように物理の位置と文字がずれる配列で、`⌘S` を `S` の文字の
 * 位置で効かせるためである（ADR 0037）。
 *
 * @param press 打鍵
 */
export function keyNameOf(press: KeyPress): string | null {
  if (MODIFIER_KEYS.has(press.key)) {
    return null
  }
  if (press.altKey) {
    const fromCode = keyFromCode(press.code)
    if (fromCode !== null) {
      return fromCode
    }
  }
  const named = NAMED_KEYS[press.key]
  if (named) {
    return named
  }
  if (/^F([1-9]|1[0-9]|20)$/.test(press.key)) {
    return press.key.toLowerCase()
  }
  if (press.key.length === 1) {
    return press.key.toLowerCase()
  }
  return keyFromCode(press.code)
}

/**
 * 打鍵を組み合わせにする。修飾キーだけの打鍵なら `null`。
 *
 * @param press 打鍵
 */
export function chordFromPress(press: KeyPress): Chord | null {
  const key = keyNameOf(press)
  if (key === null) {
    return null
  }
  return {
    key,
    meta: press.metaKey,
    ctrl: press.ctrlKey,
    alt: press.altKey,
    shift: press.shiftKey,
  }
}

/**
 * 2 つの組み合わせが同じか。修飾は**完全に一致**したときだけ同じとする。
 *
 * 書いていない修飾を許す緩い一致では、`⌘S` が `⌃⌘S` を奪い、衝突を
 * 「同じ組み合わせか」で決められなくなる（ADR 0037）。
 *
 * @param a 組み合わせ
 * @param b 組み合わせ
 */
export function sameChord(a: Chord, b: Chord): boolean {
  return (
    a.key === b.key &&
    Boolean(a.meta) === Boolean(b.meta) &&
    Boolean(a.ctrl) === Boolean(b.ctrl) &&
    Boolean(a.alt) === Boolean(b.alt) &&
    Boolean(a.shift) === Boolean(b.shift)
  )
}

/**
 * 打鍵が組み合わせに当たるか。
 *
 * @param press 打鍵
 * @param chord 組み合わせ
 */
export function matchesChord(press: KeyPress, chord: Chord): boolean {
  const pressed = chordFromPress(press)
  return pressed !== null && sameChord(pressed, chord)
}

/**
 * 保存の書き方（`cmd+shift+p`）から読む。読めなければ `null`。
 *
 * 手で書かれた `settings.toml` も読むため、修飾の順と大文字小文字は問わず、
 * VSCode の別名（`meta` / `option`）も受ける。
 *
 * @param text 保存の書き方
 */
export function parseChord(text: string): Chord | null {
  const parts = text.trim().toLowerCase().split('+')
  // `cmd++` のように `+` そのものをキーにした書き方は受けない。
  if (parts.some((part) => part === '')) {
    return null
  }
  const key = parts.pop()
  if (key === undefined || !isValidKeyName(key)) {
    return null
  }

  const chord: Chord = { key }
  for (const part of parts) {
    if (part === 'cmd' || part === 'meta') {
      chord.meta = true
    } else if (part === 'ctrl') {
      chord.ctrl = true
    } else if (part === 'alt' || part === 'option') {
      chord.alt = true
    } else if (part === 'shift') {
      chord.shift = true
    } else {
      return null
    }
  }
  return chord
}

/**
 * 保存の書き方にする。
 *
 * @param chord 組み合わせ
 */
export function serializeChord(chord: Chord): string {
  const flags = { ctrl: chord.ctrl, alt: chord.alt, shift: chord.shift, cmd: chord.meta }
  return [...MODIFIER_NAMES.filter((name) => flags[name]), chord.key].join('+')
}

/**
 * macOS の表記にする。修飾は `⌃⌥⇧⌘` の順に並べる。
 *
 * メニューバーと同じ並びにしておかないと、利用者が見慣れた表記と食い違う。
 *
 * @param chord 組み合わせ
 */
export function formatChord(chord: Chord): string {
  const key = KEY_LABELS[chord.key] ?? chord.key.toUpperCase()
  return [
    chord.ctrl ? '⌃' : '',
    chord.alt ? '⌥' : '',
    chord.shift ? '⇧' : '',
    chord.meta ? '⌘' : '',
    key,
  ].join('')
}

/**
 * 修飾を持つか、ファンクションキーか。
 *
 * どちらでもない組み合わせ（`a` や `⇧A`）を割り当てると、文字が打てなくなる。
 *
 * @param chord 組み合わせ
 */
export function hasModifierOrFunctionKey(chord: Chord): boolean {
  return Boolean(chord.meta || chord.ctrl || chord.alt) || isFunctionKey(chord.key)
}
