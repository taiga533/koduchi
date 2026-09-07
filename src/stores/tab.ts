/**
 * エディタタブを持つストア。
 *
 * タブは `.sql` ファイルの開く / 保存に対応し、未保存のままでも保持される
 * （ADR 0005）。未保存のバッファも含めて SQLite に保存し、再起動でタブ構成ごと
 * 復元する。
 *
 * バインド変数へ前回与えた値もここが覚える（ADR の「バインド変数」節）。実行の
 * 状態ではなく編集中の文脈に属するためである。セッションには保存しないので、
 * 再起動すれば消える。
 */

import { create } from 'zustand'
import type { Bind, SessionState } from '../types/db'

/** エディタタブ 1 枚。 */
export interface EditorTab {
  id: string
  /** タブに表示する名前。新規タブは `無題-1.sql`。 */
  name: string
  /** 保存先のファイル。未保存のバッファでは `null`。 */
  filePath: string | null
  /** エディタの内容。 */
  content: string
  /** 保存後に変更されたか。タブの `●` 印に対応する。 */
  dirty: boolean
}

/**
 * バインド変数 1 つへの入力。
 *
 * NULL のときも入力した文字は残す。チェックを外せば元の値に戻るほうが、
 * 値を尋ね直される場面では扱いやすい。
 */
export interface BindInput {
  /** 入力された値。 */
  text: string
  /** NULL としてバインドするか。 */
  isNull: boolean
}

/** 何も入力されていない変数の既定値。 */
export const emptyBindInput: BindInput = { text: '', isNull: false }

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
  /** 保存しておいたセッションからタブを組み直す（ADR 0005）。 */
  restore: (session: SessionState) => void
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
function createTab(): EditorTab {
  untitledCounter += 1
  return {
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

export const useTabStore = create<TabState>((set) => ({
  tabs: [initialTab],
  activeTabId: initialTab.id,
  bindValues: {},

  openNewTab: () =>
    set((state) => {
      const tab = createTab()
      return { tabs: [...state.tabs, tab], activeTabId: tab.id }
    }),

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
        tab.id === id ? { ...tab, content, dirty: tab.content !== content || tab.dirty } : tab,
      ),
    })),

  openFile: (filePath, content) =>
    set((state) => {
      // 同じファイルを開いているタブがあれば、そちらへ移る。
      const existing = state.tabs.find((tab) => tab.filePath === filePath)
      if (existing) {
        return { activeTabId: existing.id }
      }

      const tab: EditorTab = {
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
        tab.id === id ? { ...tab, filePath, name: baseName(filePath), dirty: false } : tab,
      ),
    })),

  restore: (session) =>
    set((state) => {
      if (session.tabs.length === 0) {
        return state
      }

      const tabs: EditorTab[] = session.tabs.map((tab) => ({
        id: tab.id,
        name: tab.name,
        filePath: tab.filePath,
        content: tab.content,
        dirty: tab.dirty,
      }))

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
 * セッションに保存する形へ変換する（ADR 0005）。
 *
 * 未保存のバッファも丸ごと含める。タブの `●` 印は「閉じても消えない」ことを
 * 前提にした設計である。
 *
 * @param state タブストアの状態
 * @param sidebarSegment サイドバーの選択セグメント
 */
export function selectSession(
  state: Pick<TabState, 'tabs' | 'activeTabId'>,
  sidebarSegment: string,
): SessionState {
  return {
    tabs: state.tabs.map((tab) => ({
      id: tab.id,
      name: tab.name,
      filePath: tab.filePath,
      content: tab.content,
      dirty: tab.dirty,
    })),
    activeTabId: state.activeTabId,
    sidebarSegment,
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
 * 入力を Rust 側へ渡す形へ変換する（ADR の「バインド変数」節）。
 *
 * 尋ねた名前の順に並べる。NULL のチェックが付いていれば値は `null` になり、
 * 入力していない変数は空文字列として渡る。
 *
 * @param names 尋ねた変数の名前
 * @param values 名前をキーにした入力
 */
export function toBinds(names: string[], values: Record<string, BindInput>): Bind[] {
  return names.map((name) => {
    const input = values[name] ?? emptyBindInput
    return [name, input.isNull ? null : input.text]
  })
}
