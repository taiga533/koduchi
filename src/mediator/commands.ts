/**
 * コマンドの表（ADR 0035）。
 *
 * ウィンドウ全体で効くキーとコマンドパレットの一覧は、どちらもこの表から作る。
 * 1 行が 1 つの操作であり、識別子・名前・キー・実行する裁定・今使えるかの判定を
 * 持つ。入口がキーとパレットの 2 つあっても裁定が 1 つであることを、注意力では
 * なく構造で保つためである。
 *
 * 表が持つのは**既定の**キーである。利用者が割り当て直したキー（ADR 0037）は
 * `src/keybindings/` が既定と差分から解決し、振り分けとパレットはその結果を
 * 受け取る。
 *
 * **表がウィンドウで振り分けるのは `window` の行だけである。**`editor` の行
 * （`⌘⏎` など）は CodeMirror の keymap が同じ解決の結果から作る。
 * `ResultTable`・`SchemaTree`・`TabBar` の中でしか効かないキーは表に載せず、
 * 割り当て直せない（ADR 0037 の「固定のキー」）。
 *
 * パレットの一覧への組み立て（表記の作り方を含む）は画面の側
 * （`components/palette/commandEntries.ts`）が持つ。部品が仲介者の値を
 * import しないためである。
 */

import type { Chord, KeyPress } from '../keybindings/chord'
import { matchesChord } from '../keybindings/chord'
import { useConnectionStore } from '../stores/connection'
import { useTabStore } from '../stores/tab'
import { useUiStore } from '../stores/ui'
import type { Ask } from './ask'
import { openNewConnectionWindow } from './connection'
import type { EditorCursor, RunScreen } from './execution'
import { cancelExecution, runPlan, runScript, runSelection, runStatement } from './execution'
import { openSqlFile, saveActiveTab, saveActiveTabAs } from './files'
import { saveQueryFromEditor } from './savedQuery'
import { reloadSchemas } from './schema'
import { closeActiveTab } from './tabs'
import { commitTransaction, rollbackTransaction } from './transaction'

/**
 * キーをどこで振り分けるか。
 *
 * - `window`: ウィンドウ全体の `keydown` でこの表が振り分ける。
 * - `editor`: CodeMirror の keymap が振り分ける（置き場所の決定は ADR README
 *   「キーバインド」）。エディタの中でしか意味を持たないためである。
 */
export type CommandScope = 'window' | 'editor'

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
  /** キーをどこで振り分けるか。 */
  scope: CommandScope
  /** 既定のキー（ADR 0037）。割り当てていなければ `null`。 */
  defaultKey: Chord | null
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
 * 既定のキーは VSCode の mac 版に寄せてある（ADR 0037）。VSCode に同じ操作が
 * あればそのキー、VSCode では別の操作に使われているキーで SQL を流すか取り消せ
 * ない操作は `⌃⌘` へ置く。同じ組み合わせが重なったときは表の上の行が勝つ。
 */
export const COMMANDS: readonly Command[] = [
  {
    id: 'run',
    label: '実行（カーソル位置の文）',
    scope: 'editor',
    defaultKey: { key: 'enter', meta: true },
    inPalette: true,
    run: (screen) => runStatement(runScreenOf(screen)),
  },
  {
    id: 'run-selection',
    label: '選択範囲のみ実行',
    scope: 'editor',
    defaultKey: { key: 'enter', meta: true, shift: true },
    inPalette: true,
    run: (screen) => runSelection(runScreenOf(screen)),
  },
  {
    id: 'run-script',
    label: 'すべて実行',
    scope: 'editor',
    defaultKey: { key: 'enter', meta: true, alt: true },
    inPalette: true,
    run: (screen) => runScript(runScreenOf(screen)),
  },
  {
    id: 'explain',
    label: '実行計画を生成',
    scope: 'window',
    defaultKey: { key: 'e', ctrl: true, meta: true },
    inPalette: true,
    run: (screen) => void runPlan(false, runScreenOf(screen)),
  },
  {
    id: 'explain-actual',
    label: '実測付きで実行計画を生成',
    scope: 'window',
    defaultKey: { key: 'e', ctrl: true, shift: true, meta: true },
    inPalette: true,
    run: (screen) => void runPlan(true, runScreenOf(screen)),
  },
  {
    id: 'cancel',
    label: '実行を中止',
    scope: 'editor',
    defaultKey: { key: '.', meta: true },
    inPalette: true,
    run: () => cancelExecution(),
  },
  {
    id: 'format',
    label: 'SQL を整形',
    scope: 'editor',
    defaultKey: { key: 'f', alt: true, shift: true },
    inPalette: true,
    run: (screen) => screen.formatEditor(),
  },
  {
    id: 'csv',
    label: '結果を CSV で保存',
    scope: 'window',
    defaultKey: { key: 's', alt: true, meta: true },
    inPalette: true,
    run: (screen) => screen.openCsvDialog(),
  },
  {
    id: 'commit',
    label: 'コミット',
    scope: 'window',
    defaultKey: { key: 'c', ctrl: true, meta: true },
    inPalette: true,
    run: () => commitTransaction(),
  },
  {
    id: 'rollback',
    label: 'ロールバック',
    scope: 'window',
    defaultKey: { key: 'r', ctrl: true, meta: true },
    inPalette: true,
    run: () => rollbackTransaction(),
  },
  {
    // `⇧⌘S` は VSCode の「名前を付けて保存」に譲った。VSCode に対応する操作が
    // 無いため、DB 固有の操作を集める `⌃⌘` へ置く（ADR 0037）。
    id: 'save-query',
    label: 'クエリを保存済みへ追加',
    scope: 'window',
    defaultKey: { key: 's', ctrl: true, meta: true },
    inPalette: true,
    run: (screen) => void saveQueryFromEditor(screen.cursor(), screen.ask),
  },
  {
    id: 'save-file',
    label: 'ファイルに保存',
    scope: 'window',
    defaultKey: { key: 's', meta: true },
    inPalette: true,
    run: () => void saveActiveTab(),
  },
  {
    // VSCode の「名前を付けて保存」と同じキーに置く（ADR 0037）。
    id: 'save-file-as',
    label: '名前を付けて保存',
    scope: 'window',
    defaultKey: { key: 's', shift: true, meta: true },
    inPalette: true,
    run: () => void saveActiveTabAs(),
  },
  {
    id: 'open-file',
    label: 'ファイルを開く',
    scope: 'window',
    defaultKey: { key: 'o', meta: true },
    inPalette: true,
    run: () => void openSqlFile(),
  },
  {
    id: 'new-tab',
    label: '新しいタブ',
    scope: 'window',
    defaultKey: { key: 'n', meta: true },
    inPalette: true,
    run: () => useTabStore.getState().openNewTab(),
  },
  {
    id: 'new-window',
    label: '別の接続を新しいウィンドウで開く',
    scope: 'window',
    defaultKey: { key: 'n', shift: true, meta: true },
    inPalette: true,
    run: () => openNewConnectionWindow(),
  },
  {
    id: 'source-search',
    label: 'オブジェクトのソースを検索',
    scope: 'window',
    defaultKey: { key: 'f', shift: true, meta: true },
    inPalette: true,
    run: () => useUiStore.getState().openSourceSearch(),
  },
  {
    id: 'sessions',
    label: 'セッションとロックを開く',
    scope: 'window',
    defaultKey: null,
    inPalette: true,
    run: () => useUiStore.getState().openSessions(),
  },
  {
    // サイドバーの再読み込みボタンと同じ動き。DDL を流した直後に、
    // サイドバーへ手を伸ばさずに取り直すための入口である。`⌘R` はウェブビューの
    // 再読み込みと重なるためキーは割り当てない。
    id: 'reload-schemas',
    label: 'スキーマを再読み込み',
    scope: 'window',
    defaultKey: null,
    inPalette: true,
    run: () => reloadSchemas(),
    available: isConnected,
  },
  {
    id: 'settings',
    label: '設定を開く',
    scope: 'window',
    defaultKey: null,
    inPalette: true,
    run: () => useUiStore.getState().openSettings(),
  },
  {
    // タブを閉じる経路は `closeTabAndRelease` 1 つである（ADR 0023）。
    id: 'close-tab',
    label: 'タブを閉じる',
    scope: 'window',
    defaultKey: { key: 'w', meta: true },
    inPalette: false,
    run: () => closeActiveTab(),
  },
  {
    // `⌘K` は VSCode の 2 打鍵の前置キーであるため空けておく（ADR 0037）。
    id: 'palette',
    label: 'コマンドパレットを開く',
    scope: 'window',
    defaultKey: { key: 'p', shift: true, meta: true },
    inPalette: false,
    run: (screen) => screen.openPalette(),
    available: isConnected,
  },
]

/**
 * 打鍵に当たるコマンドを探す。
 *
 * 当てるのは `window` の行だけで、キーは既定ではなく**解決した割り当て**
 * （`chords`）から引く。修飾は完全に一致したときだけ当てる（ADR 0037）。
 * 解決の時点で組み合わせの重なりは取り除いてあるため、当たりは高々 1 つである。
 *
 * @param press 打鍵
 * @param chords 操作の `id` から今のキー
 * @param commands 探す表
 *
 * @returns 当たったコマンド。無ければ `null`
 */
export function findCommandForKey(
  press: KeyPress,
  chords: ReadonlyMap<string, Chord>,
  commands: readonly Command[] = COMMANDS,
): Command | null {
  for (const command of commands) {
    if (command.scope !== 'window') {
      continue
    }
    const chord = chords.get(command.id)
    if (chord && matchesChord(press, chord)) {
      return command
    }
  }
  return null
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
 * @param chords 操作の `id` から今のキー
 * @param commands 振り分ける表
 */
export function dispatchCommandKey(
  event: KeyPress & { defaultPrevented: boolean; preventDefault: () => void },
  screen: CommandScreen,
  chords: ReadonlyMap<string, Chord>,
  commands: readonly Command[] = COMMANDS,
): void {
  if (event.defaultPrevented) {
    return
  }
  const command = findCommandForKey(event, chords, commands)
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
