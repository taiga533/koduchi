/**
 * コマンドの表（ADR 0035）。
 *
 * ウィンドウ全体で効くキーとコマンドパレットの一覧は、どちらもこの表から作る。
 * 1 行が 1 つの操作であり、識別子・名前・キー・実行する裁定・今使えるかの判定を
 * 持つ。入口がキーとパレットの 2 つあっても裁定が 1 つであることを、注意力では
 * なく構造で保つためである。
 *
 * **表が振り分けるキーは、以前 `App.tsx` の `keydown` に置いていたものだけである。**
 * CodeMirror の keymap・`ResultTable`・`SchemaTree`・`TabBar` の中でしか効かない
 * キーは今の置き場所のまま動かさない（ADR README「キーバインド」）。そのうち
 * パレットに並ぶもの（`⌘⏎` など）は、表記だけを `editor` の行として持つ。
 *
 * パレットの一覧への組み立て（表記の作り方を含む）は画面の側
 * （`components/palette/commandEntries.ts`）が持つ。部品が仲介者の値を
 * import しないためである。
 */

import { useConnectionStore } from '../stores/connection'
import { useTabStore } from '../stores/tab'
import { useUiStore } from '../stores/ui'
import type { Ask } from './ask'
import { openNewConnectionWindow } from './connection'
import type { EditorCursor, RunScreen } from './execution'
import { cancelExecution, runPlan, runScript, runSelection, runStatement } from './execution'
import { openSqlFile, saveActiveTab } from './files'
import { saveQueryFromEditor } from './savedQuery'
import { reloadSchemas } from './schema'
import { closeActiveTab } from './tabs'
import { commitTransaction, rollbackTransaction } from './transaction'

/**
 * `⌘` を伴う打鍵の組み合わせ。`⌘` は常に要るため書かない。
 *
 * ここに書いた修飾は「押されていなければならない」ものであり、書いていない修飾が
 * 押されていても当たる。`⌃⌘S` が `⌘S` として保存に当たるのは以前からの振る舞いである。
 */
export interface Chord {
  /** `event.key` を小文字にしたもの。 */
  key: string
  shift?: boolean
  alt?: boolean
  ctrl?: boolean
}

/** コマンドのキー。 */
export type CommandKey =
  /** ウィンドウ全体の `keydown` でこの表が振り分ける。 */
  | { owner: 'window'; chord: Chord }
  /**
   * CodeMirror の keymap が持つ。表はパレットに出す表記だけを持ち、振り分けない
   * （置き場所の決定は ADR README「キーバインド」）。
   */
  | { owner: 'editor'; label: string }

/** コマンドの実行に要る、画面にしか無いもの。 */
export interface CommandScreen {
  /** 押された時点のエディタのカーソル。 */
  cursor: () => EditorCursor
  /** 利用者への尋ね方。 */
  ask: Ask
  /** エディタの SQL を整形する（ADR 0024）。エディタが描かれていなければ何もしない。 */
  formatEditor: () => void
  /** コマンドパレットを開く（ADR 0018）。 */
  openPalette: () => void
  /** CSV の保存ダイアログを開く。 */
  openCsvDialog: () => void
}

/** 表の 1 行。 */
export interface Command {
  /** 識別子。パレットの項目の鍵にもなる。 */
  id: string
  /** パレットに出す名前。 */
  label: string
  /** キー。割り当てていなければ `null`。 */
  key: CommandKey | null
  /**
   * パレットに並べるか。パレットを開くことそのものと、タブを閉じること
   * （`✕` がタブの上にある）は並べない。
   */
  inPalette: boolean
  /** 実行する裁定。 */
  run: (screen: CommandScreen) => void
  /**
   * 今使えるか。省けば常に使える。使えないときはキーを受けても何もせず、
   * パレットにも並べない。
   */
  available?: () => boolean
}

/** 繋がっているか。パレットは現ウィンドウの接続の中を探すため、繋がっていなければ開かない。 */
function isConnected(): boolean {
  return useConnectionStore.getState().connection !== null
}

/**
 * 実行の裁定へ渡す画面を、押された時点のカーソルで作る。
 *
 * @param screen コマンドの画面
 */
function runScreenOf(screen: CommandScreen): RunScreen {
  return { cursor: screen.cursor(), ask: screen.ask }
}

/**
 * コマンドの表。**並びはパレットに出す順でもある。**
 *
 * 修飾の重なる `⌥⌘S` と `⇧⌘S` を同時に押したときは、上にある行が勝つ（以前の
 * `keydown` が `⌥` の枝を先に見ていたためである）。
 */
export const COMMANDS: readonly Command[] = [
  {
    id: 'run',
    label: '実行（カーソル位置の文）',
    key: { owner: 'editor', label: '⌘⏎' },
    inPalette: true,
    run: (screen) => runStatement(runScreenOf(screen)),
  },
  {
    id: 'run-selection',
    label: '選択範囲のみ実行',
    key: { owner: 'editor', label: '⇧⌘⏎' },
    inPalette: true,
    run: (screen) => runSelection(runScreenOf(screen)),
  },
  {
    id: 'run-script',
    label: 'すべて実行',
    key: { owner: 'editor', label: '⌥⌘⏎' },
    inPalette: true,
    run: (screen) => runScript(runScreenOf(screen)),
  },
  {
    id: 'explain',
    label: '実行計画を生成',
    key: { owner: 'window', chord: { key: 'e' } },
    inPalette: true,
    run: (screen) => void runPlan(false, runScreenOf(screen)),
  },
  {
    id: 'explain-actual',
    label: '実測付きで実行計画を生成',
    key: { owner: 'window', chord: { key: 'e', shift: true } },
    inPalette: true,
    run: (screen) => void runPlan(true, runScreenOf(screen)),
  },
  {
    id: 'cancel',
    label: '実行を中止',
    key: { owner: 'editor', label: '⌘.' },
    inPalette: true,
    run: () => cancelExecution(),
  },
  {
    id: 'format',
    label: 'SQL を整形',
    key: { owner: 'editor', label: '⇧⌥F' },
    inPalette: true,
    run: (screen) => screen.formatEditor(),
  },
  {
    id: 'csv',
    label: '結果を CSV で保存',
    key: { owner: 'window', chord: { key: 's', alt: true } },
    inPalette: true,
    run: (screen) => screen.openCsvDialog(),
  },
  {
    id: 'commit',
    label: 'コミット',
    key: { owner: 'window', chord: { key: 'c', alt: true } },
    inPalette: true,
    run: () => commitTransaction(),
  },
  {
    id: 'rollback',
    label: 'ロールバック',
    key: { owner: 'window', chord: { key: 'r', alt: true } },
    inPalette: true,
    run: () => rollbackTransaction(),
  },
  {
    id: 'save-query',
    label: 'クエリを保存済みへ追加',
    key: { owner: 'window', chord: { key: 's', shift: true } },
    inPalette: true,
    run: (screen) => void saveQueryFromEditor(screen.cursor(), screen.ask),
  },
  {
    id: 'save-file',
    label: 'ファイルに保存',
    key: { owner: 'window', chord: { key: 's' } },
    inPalette: true,
    run: () => void saveActiveTab(),
  },
  {
    id: 'open-file',
    label: 'ファイルを開く',
    key: { owner: 'window', chord: { key: 'o' } },
    inPalette: true,
    run: () => void openSqlFile(),
  },
  {
    id: 'new-tab',
    label: '新しいタブ',
    key: { owner: 'window', chord: { key: 't' } },
    inPalette: true,
    run: () => useTabStore.getState().openNewTab(),
  },
  {
    id: 'new-window',
    label: '別の接続を新しいウィンドウで開く',
    key: { owner: 'window', chord: { key: 'n', ctrl: true } },
    inPalette: true,
    run: () => openNewConnectionWindow(),
  },
  {
    id: 'source-search',
    label: 'オブジェクトのソースを検索',
    key: { owner: 'window', chord: { key: 'f', shift: true } },
    inPalette: true,
    run: () => useUiStore.getState().openSourceSearch(),
  },
  {
    id: 'sessions',
    label: 'セッションとロックを開く',
    key: null,
    inPalette: true,
    run: () => useUiStore.getState().openSessions(),
  },
  {
    // サイドバーの再読み込みボタンと同じ動き。DDL を流した直後に、
    // サイドバーへ手を伸ばさずに取り直すための入口である。`⌘R` はウェブビューの
    // 再読み込みと重なるためキーは割り当てない。
    id: 'reload-schemas',
    label: 'スキーマを再読み込み',
    key: null,
    inPalette: true,
    run: () => reloadSchemas(),
    available: isConnected,
  },
  {
    id: 'settings',
    label: '設定を開く',
    key: null,
    inPalette: true,
    run: () => useUiStore.getState().openSettings(),
  },
  {
    // タブを閉じる経路は `closeTabAndRelease` 1 つである（ADR 0023）。
    id: 'close-tab',
    label: 'タブを閉じる',
    key: { owner: 'window', chord: { key: 'w' } },
    inPalette: false,
    run: () => closeActiveTab(),
  },
  {
    id: 'palette',
    label: 'コマンドパレットを開く',
    key: { owner: 'window', chord: { key: 'k' } },
    inPalette: false,
    run: (screen) => screen.openPalette(),
    available: isConnected,
  },
]

/** 振り分けに要る打鍵の中身。`KeyboardEvent` はこの形を満たす。 */
export interface KeyPress {
  key: string
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
}

/**
 * 組み合わせが求める修飾の数。多いほど絞りが強い。
 *
 * @param chord 組み合わせ
 */
function specificity(chord: Chord): number {
  return Number(chord.shift === true) + Number(chord.alt === true) + Number(chord.ctrl === true)
}

/**
 * 打鍵に当たるコマンドを探す。
 *
 * 修飾の重なる組み合わせ（`⌘S` / `⇧⌘S` / `⌥⌘S`）は、**求める修飾の多い、絞りの
 * 強い行から先に見る**（ADR README「キーバインド」）。同じ強さなら表の上にある行が
 * 勝つ。`⌘` を伴わない打鍵には何も当てない。
 *
 * @param press 打鍵
 * @param commands 探す表
 *
 * @returns 当たったコマンド。無ければ `null`
 */
export function findCommandForKey(
  press: KeyPress,
  commands: readonly Command[] = COMMANDS,
): Command | null {
  if (!press.metaKey) {
    return null
  }
  const key = press.key.toLowerCase()

  let best: { command: Command; specificity: number } | null = null
  for (const command of commands) {
    if (command.key?.owner !== 'window') {
      continue
    }
    const { chord } = command.key
    const matches =
      chord.key === key &&
      (!chord.shift || press.shiftKey) &&
      (!chord.alt || press.altKey) &&
      (!chord.ctrl || press.ctrlKey)
    if (matches && (best === null || specificity(chord) > best.specificity)) {
      best = { command, specificity: specificity(chord) }
    }
  }
  return best?.command ?? null
}

/**
 * コマンドを実行する。今使えなければ何もしない。
 *
 * @param command 実行するコマンド
 * @param screen 画面にしか無いもの
 */
export function runCommand(command: Command, screen: CommandScreen): void {
  if (command.available?.() ?? true) {
    command.run(screen)
  }
}

/**
 * ウィンドウ全体の `keydown` を表から振り分ける。
 *
 * **エディタなどが既に処理した打鍵（`event.defaultPrevented`）は二重に扱わない。**
 * 当たったキーは、今使えなくても既定の動作を止める。ウェブビューの既定の動作
 * （`⌘W` でウィンドウを閉じる、など）へ落とさないためである。
 *
 * @param event 打鍵
 * @param screen 画面にしか無いもの
 * @param commands 振り分ける表
 */
export function dispatchCommandKey(
  event: KeyPress & { defaultPrevented: boolean; preventDefault: () => void },
  screen: CommandScreen,
  commands: readonly Command[] = COMMANDS,
): void {
  if (event.defaultPrevented) {
    return
  }
  const command = findCommandForKey(event, commands)
  if (command === null) {
    return
  }
  event.preventDefault()
  runCommand(command, screen)
}

/**
 * 識別子でコマンドを引く。部品のボタン（タイトルバーのパレットなど）から、
 * キーと同じ裁定と判定を通すために使う。
 *
 * @param id 識別子
 * @param commands 引く表
 */
export function commandById(id: string, commands: readonly Command[] = COMMANDS): Command {
  const command = commands.find((item) => item.id === id)
  if (!command) {
    throw new Error(`コマンドの表に ${id} がありません`)
  }
  return command
}
