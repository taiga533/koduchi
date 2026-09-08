/**
 * エディタタブを持つストア。
 *
 * タブは 2 種類ある（ADR 0022）。**並びは 1 本であり、両方が同じ列に混ざる。**
 *
 * - **SQL タブ**: `.sql` ファイルの開く / 保存に対応し、未保存のままでも保持
 *   される（ADR 0005）。未保存のバッファも含めて SQLite に保存し、再起動で
 *   タブ構成ごと復元する。
 * - **定義タブ**: オブジェクトの定義を見る（ADR 0022）。内容も保存先も持たず、
 *   「どのオブジェクトの定義か」だけを持つ。**セッションには保存しない。**
 *
 * 種類による振り分けは `tabKinds.ts` の純粋な関数に寄せてある。並び順・選択・
 * 閉じるは種類を問わず同じに扱えるため、ここでは分けていない。
 *
 * バインド変数へ前回与えた値もここが覚える（ADR の「バインド変数」節）。実行の
 * 状態ではなく編集中の文脈に属するためである。セッションには保存しないので、
 * 再起動すれば消える。
 */

import { create } from 'zustand'
import { autoBindKind } from '../sql/bindTypes'
import type { Bind, BindKind, DefinitionTarget, SessionState } from '../types/db'
import { fromSessionTabs, isSqlTab, openDefinitionTab, toSessionTabs } from './tabKinds'

/** タブ 1 枚に共通するもの。 */
interface TabBase {
  id: string
  /**
   * タブに表示する名前。
   *
   * SQL タブは `無題-1.sql` などのファイル名、定義タブはオブジェクト名である。
   */
  name: string
}

/** SQL を書くタブ 1 枚。 */
export interface SqlTab extends TabBase {
  kind: 'sql'
  /** 保存先のファイル。未保存のバッファでは `null`。 */
  filePath: string | null
  /** エディタの内容。 */
  content: string
  /** 保存後に変更されたか。タブの `●` 印に対応する。 */
  dirty: boolean
}

/**
 * オブジェクトの定義を見るタブ 1 枚（ADR 0022）。
 *
 * 中身は取らずに対象だけを持つ。列・制約・索引・DDL そのものは `definition`
 * ストアがタブごとに持つ。
 */
export interface DefinitionEditorTab extends TabBase {
  kind: 'definition'
  /** 見ているオブジェクト。 */
  target: DefinitionTarget
}

/** エディタタブ 1 枚。SQL タブと定義タブのどちらかである（ADR 0022）。 */
export type EditorTab = SqlTab | DefinitionEditorTab

/**
 * バインド変数 1 つへの入力。
 *
 * NULL のときも入力した文字は残す。チェックを外せば元の値に戻るほうが、
 * 値を尋ね直される場面では扱いやすい。型も同じ理由で覚える（ADR 0016）。
 */
export interface BindInput {
  /** 入力された値。 */
  text: string
  /** バインドする型（ADR 0016）。 */
  kind: BindKind
  /** NULL としてバインドするか。 */
  isNull: boolean
}

/** 何も入力されていない変数の既定値。 */
export const emptyBindInput: BindInput = { text: '', kind: 'varchar2', isNull: false }

interface TabState {
  tabs: EditorTab[]
  activeTabId: string | null
  /**
   * タブごとの、変数名をキーにしたバインド変数の入力。
   *
   * セッションには保存しない。値には個人情報が入りうるためである。
   */
  bindValues: Record<string, Record<string, BindInput>>

  /** 新しい空のタブを開き、それを選択する。 */
  openNewTab: () => void
  /**
   * オブジェクトの定義タブを開き、それを選択する（ADR 0022）。
   *
   * 同じ対象のタブが既にあれば 2 枚目を開かず、そのタブへ移る。選ばれたタブの
   * ID を返す。定義そのものを取りにいくのは `definition` ストアである。
   */
  openDefinitionTab: (target: DefinitionTarget) => string
  /** タブを閉じる。最後の 1 枚を閉じると新しい空のタブが開く。 */
  closeTab: (id: string) => void
  /** タブを選択する。 */
  selectTab: (id: string) => void
  /** タブの内容を書き換える。内容が変われば未保存になる。 */
  updateContent: (id: string, content: string) => void
  /** ファイルを開いて新しいタブにする（`⌘O`）。 */
  openFile: (filePath: string, content: string) => void
  /** 保存し終えたタブに保存先を記録し、未保存の印を消す（`⌘S`）。 */
  markSaved: (id: string, filePath: string) => void
  /**
   * 保存しておいたセッションからタブを組み直す（ADR 0005）。
   *
   * 見るのはタブとその選択だけである。サイドバーのセグメントとペインの寸法は
   * `ui` ストアが受け取る。
   */
  restore: (session: Pick<SessionState, 'tabs' | 'activeTabId'>) => void
  /** タブのバインド変数の入力を覚え直す。 */
  setBindValues: (tabId: string, values: Record<string, BindInput>) => void
}

/**
 * パスからファイル名だけを取り出す。
 *
 * タブに出す名前に使う。区切りは macOS のみを対象とするため `/` だけでよい。
 *
 * @param filePath ファイルのパス
 */
export function baseName(filePath: string): string {
  const parts = filePath.split('/')
  return parts[parts.length - 1] || filePath
}

/** 新規タブの名前に使う連番。 */
let untitledCounter = 0

/**
 * 空のタブを作る。
 *
 * 名前は `無題-1.sql` から始まる連番にする。
 */
function createTab(): SqlTab {
  untitledCounter += 1
  return {
    kind: 'sql',
    id: crypto.randomUUID(),
    name: `無題-${untitledCounter}.sql`,
    filePath: null,
    content: '',
    dirty: false,
  }
}

/** 連番を初期化する。テストからのみ使う。 */
export function resetUntitledCounter(): void {
  untitledCounter = 0
}

const initialTab = createTab()

export const useTabStore = create<TabState>((set, get) => ({
  tabs: [initialTab],
  activeTabId: initialTab.id,
  bindValues: {},

  openNewTab: () =>
    set((state) => {
      const tab = createTab()
      return { tabs: [...state.tabs, tab], activeTabId: tab.id }
    }),

  openDefinitionTab: (target) => {
    const opened = openDefinitionTab(get().tabs, target, crypto.randomUUID())
    set({ tabs: opened.tabs, activeTabId: opened.activeTabId })
    return opened.activeTabId
  },

  closeTab: (id) =>
    set((state) => {
      const index = state.tabs.findIndex((tab) => tab.id === id)
      if (index === -1) {
        return state
      }

      const remaining = state.tabs.filter((tab) => tab.id !== id)
      // 閉じたタブのバインド変数は残さない。
      const { [id]: _removed, ...bindValues } = state.bindValues

      if (remaining.length === 0) {
        const tab = createTab()
        return { tabs: [tab], activeTabId: tab.id, bindValues }
      }

      // 閉じたタブが選択中だったら、隣のタブへ移る。
      const activeTabId =
        state.activeTabId === id
          ? remaining[Math.min(index, remaining.length - 1)].id
          : state.activeTabId

      return { tabs: remaining, activeTabId, bindValues }
    }),

  selectTab: (id) =>
    set((state) => (state.tabs.some((tab) => tab.id === id) ? { activeTabId: id } : state)),

  updateContent: (id, content) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id && isSqlTab(tab)
          ? { ...tab, content, dirty: tab.content !== content || tab.dirty }
          : tab,
      ),
    })),

  openFile: (filePath, content) =>
    set((state) => {
      // 同じファイルを開いているタブがあれば、そちらへ移る。
      const existing = state.tabs.find((tab) => isSqlTab(tab) && tab.filePath === filePath)
      if (existing) {
        return { activeTabId: existing.id }
      }

      const tab: SqlTab = {
        kind: 'sql',
        id: crypto.randomUUID(),
        name: baseName(filePath),
        filePath,
        content,
        dirty: false,
      }
      return { tabs: [...state.tabs, tab], activeTabId: tab.id }
    }),

  markSaved: (id, filePath) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id && isSqlTab(tab)
          ? { ...tab, filePath, name: baseName(filePath), dirty: false }
          : tab,
      ),
    })),

  restore: (session) =>
    set((state) => {
      if (session.tabs.length === 0) {
        return state
      }

      // セッションに載るのは SQL タブだけである（ADR 0022）。
      const tabs: EditorTab[] = fromSessionTabs(session.tabs)

      // 復元した名前と連番がぶつからないよう、番号を進めておく。
      for (const tab of tabs) {
        const matched = /^無題-(\d+)\.sql$/.exec(tab.name)
        if (matched) {
          untitledCounter = Math.max(untitledCounter, Number(matched[1]))
        }
      }

      const activeTabId =
        session.activeTabId && tabs.some((tab) => tab.id === session.activeTabId)
          ? session.activeTabId
          : tabs[0].id

      // 復元したタブは ID が変わりうる。前のタブの入力は持ち越さない。
      return { tabs, activeTabId, bindValues: {} }
    }),

  setBindValues: (tabId, values) =>
    set((state) => ({ bindValues: { ...state.bindValues, [tabId]: values } })),
}))

/**
 * 選択中のタブを返す。
 *
 * @param state タブストアの状態
 */
export function selectActiveTab(state: TabState): EditorTab | null {
  return state.tabs.find((tab) => tab.id === state.activeTabId) ?? null
}

/**
 * 選択中のタブが SQL タブならそれを返す（ADR 0022）。
 *
 * 定義タブを選んでいるときは `null` を返す。実行・保存・CSV の書き出しといった
 * 「今のタブの SQL」を要る操作は、すべてここを通してから進める。
 *
 * @param state タブストアの状態
 */
export function selectActiveSqlTab(state: TabState): SqlTab | null {
  const tab = selectActiveTab(state)
  return tab !== null && isSqlTab(tab) ? tab : null
}

/** タブ以外にセッションへ書き出すもの。 */
export interface SessionLayout {
  /** サイドバーの選択セグメント。 */
  sidebarSegment: string
  /** サイドバーの幅（px）。 */
  sidebarWidth: number
  /** エディタの高さ（px）。 */
  editorHeight: number
}

/**
 * セッションに保存する形へ変換する（ADR 0005・0022）。
 *
 * 未保存のバッファも丸ごと含める。タブの `●` 印は「閉じても消えない」ことを
 * 前提にした設計である。**定義タブは書き出さない**（ADR 0022）。
 *
 * @param state タブストアの状態
 * @param layout サイドバーの選択セグメントとペインの寸法
 */
export function selectSession(
  state: Pick<TabState, 'tabs' | 'activeTabId'>,
  layout: SessionLayout,
): SessionState {
  const tabs = toSessionTabs(state.tabs)
  // 定義タブを選んだまま終えたときは、そのタブごと消える。選択も落とす。
  const activeTabId = tabs.some((tab) => tab.id === state.activeTabId) ? state.activeTabId : null

  return {
    tabs,
    activeTabId,
    sidebarSegment: layout.sidebarSegment,
    sidebarWidth: layout.sidebarWidth,
    editorHeight: layout.editorHeight,
  }
}

/** バインド変数の入力を持たないタブのための、空の表。参照を固定して再描画を避ける。 */
export const noBindValues: Record<string, BindInput> = {}

/**
 * タブのバインド変数の入力を返す。まだ入力していなければ空の表を返す。
 *
 * @param state タブストアの状態
 * @param tabId 対象のタブ
 */
export function selectBindValues(
  state: Pick<TabState, 'bindValues'>,
  tabId: string | null,
): Record<string, BindInput> {
  if (!tabId) {
    return noBindValues
  }
  return state.bindValues[tabId] ?? noBindValues
}

/**
 * 入力を Rust 側へ渡す形へ変換する（ADR の「バインド変数」節・ADR 0016）。
 *
 * 尋ねた名前の順に並べる。NULL のチェックが付いていれば値は `null` になり、
 * 入力していない変数は空文字列として渡る。型はそのまま添える。
 *
 * @param names 尋ねた変数の名前
 * @param values 名前をキーにした入力
 */
export function toBinds(names: string[], values: Record<string, BindInput>): Bind[] {
  return names.map((name) => {
    const input = values[name] ?? emptyBindInput
    return { name, kind: input.kind, value: input.isNull ? null : input.text }
  })
}

/**
 * 尋ねる変数の入力を、前回の値と推し量った型で埋める（ADR 0016）。
 *
 * 既に覚えている変数はそのまま残す。利用者が選んだ型を推し量りで上書きしない
 * ためである。初めて尋ねる変数には、比べている列から推し量った型を入れる。
 * 覚えていた他の変数の入力も落とさずに残す。
 *
 * @param names 尋ねる変数の名前
 * @param values 覚えている入力
 * @param kinds 大文字に揃えた変数名で引く、推し量った型
 */
export function fillBindDefaults(
  names: string[],
  values: Record<string, BindInput>,
  kinds: Record<string, BindKind>,
): Record<string, BindInput> {
  const filled: Record<string, BindInput> = { ...values }

  for (const name of names) {
    if (filled[name]) {
      continue
    }
    filled[name] = { ...emptyBindInput, kind: kinds[name.toUpperCase()] ?? 'varchar2' }
  }

  return filled
}

/**
 * 値を打ち直したときの入力を組み立てる（ADR 0016）。
 *
 * 利用者がまだ型を選び直していなければ、値の見た目に合わせて型も変える。
 * 選び直したあと（今の型が値から決まる型と違うとき）は型に触れない。
 *
 * @param input 打ち直す前の入力
 * @param text 新しい値
 */
export function applyBindText(input: BindInput, text: string): BindInput {
  const following = input.kind === autoBindKind(input.text)
  return { ...input, text, kind: following ? autoBindKind(text) : input.kind }
}
