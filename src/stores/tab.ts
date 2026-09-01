/**
 * エディタタブを持つストア。
 *
 * タブは `.sql` ファイルの開く / 保存に対応し、未保存のままでも保持される
 * （ADR 0005）。未保存のバッファも含めて SQLite に保存し、再起動でタブ構成ごと
 * 復元する。
 */

import { create } from 'zustand'
import type { SessionState } from '../types/db'

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

interface TabState {
  tabs: EditorTab[]
  activeTabId: string | null

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

      if (remaining.length === 0) {
        const tab = createTab()
        return { tabs: [tab], activeTabId: tab.id }
      }

      // 閉じたタブが選択中だったら、隣のタブへ移る。
      const activeTabId =
        state.activeTabId === id
          ? remaining[Math.min(index, remaining.length - 1)].id
          : state.activeTabId

      return { tabs: remaining, activeTabId }
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

      return { tabs, activeTabId }
    }),
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
