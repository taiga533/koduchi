/**
 * テーブル定義ビューのストア（ADR 0019・0022）。
 *
 * **タブごとに 1 つずつ持つ。**定義はエディタのタブ帯に並ぶタブとして開くため
 * （ADR 0022）、同時に何枚でも開きうる。鍵はタブの ID である。
 *
 * 中身は、開いている対象・列と制約と索引・DDL・絞り込み語・開いている内訳の
 * タブ。取得はプールの結果セットを保持していない接続で行われるため、利用者が
 * 見ている結果セット（ADR 0003）は壊れない。
 *
 * **DDL は DDL タブを開いたときに初めて取る。** `DBMS_METADATA.GET_DDL` は重く
 * 権限にも敏感であり、定義ビュー全体がそれで開けなくなってはいけない。取った
 * DDL はそのタブが開いている間だけ覚え、内訳のタブを行き来しても取り直さない。
 *
 * **一度読んだ定義は取り直さない。**タブを行き来するたびに問い合わせるのでは、
 * 開いた枚数だけ往復が増える。読み直したいときはタブを閉じて開き直す。
 */

import { create } from 'zustand'
import { getDbApi } from '../api/db'
import type { DefinitionTarget, ObjectDdl, ObjectDefinition } from '../types/db'
import { isDbError, toErrorMessage } from '../types/db'

/** 取得の状態。 */
export type DefinitionStatus = 'idle' | 'loading' | 'ready' | 'failed'

/** 定義ビューの内訳のタブ。 */
export type DefinitionTab = 'columns' | 'constraints' | 'indexes' | 'ddl'

/** 内訳のタブの並び。左から順に出す。 */
export const DEFINITION_TABS: DefinitionTab[] = ['columns', 'constraints', 'indexes', 'ddl']

/** 内訳のタブの表示名。 */
export const DEFINITION_TAB_LABELS: Record<DefinitionTab, string> = {
  columns: '列',
  constraints: '制約',
  indexes: '索引',
  ddl: 'DDL',
}

/** 定義タブ 1 枚ぶんの状態。 */
export interface DefinitionEntry {
  /** 見ている対象。 */
  target: DefinitionTarget
  definition: ObjectDefinition | null
  status: DefinitionStatus
  error: string | null
  /** 定義が読めなかった理由が権限不足か。 */
  permissionDenied: boolean

  ddl: ObjectDdl | null
  ddlStatus: DefinitionStatus
  ddlError: string | null
  /** DDL が読めなかった理由が権限不足か（ADR 0019）。 */
  ddlPermissionDenied: boolean

  /** 列・制約・索引に当てる絞り込み語。 */
  search: string
  tab: DefinitionTab
}

interface DefinitionState {
  /** タブの ID をキーにした、定義タブ 1 枚ぶんの状態。 */
  byTab: Record<string, DefinitionEntry>

  /** 定義タブの内容を読む。既に読んであれば何もしない。 */
  open: (connectionId: string, tabId: string, target: DefinitionTarget) => Promise<void>
  /** タブを閉じたときに、そのタブの定義を捨てる。 */
  drop: (tabId: string) => void
  setSearch: (tabId: string, search: string) => void
  /** 内訳のタブを切り替える。DDL タブは初回だけ取得しにいく。 */
  selectTab: (connectionId: string, tabId: string, tab: DefinitionTab) => void
  /** 切断したときに捨てる。 */
  clear: () => void
}

/**
 * タブごとの取得の世代。
 *
 * 同じタブで読み直したときに、古い取得の結果を捨てるために使う。捨てたタブの
 * 番号は残るが、鍵は使い回されない UUID であり増え続けはしない。
 */
const generations: Record<string, number> = {}

/**
 * そのタブの取得の世代を 1 つ進める。
 *
 * @param tabId 対象のタブ
 */
function 世代を進める(tabId: string): number {
  const next = (generations[tabId] ?? 0) + 1
  generations[tabId] = next
  return next
}

/**
 * 開いたばかりの状態を組み立てる。
 *
 * @param target 見る対象
 */
function 読み込み中の状態(target: DefinitionTarget): DefinitionEntry {
  return {
    target,
    definition: null,
    status: 'loading',
    error: null,
    permissionDenied: false,
    ddl: null,
    ddlStatus: 'idle',
    ddlError: null,
    ddlPermissionDenied: false,
    search: '',
    tab: 'columns',
  }
}

export const useDefinitionStore = create<DefinitionState>((set, get) => ({
  byTab: {},

  open: async (connectionId, tabId, target) => {
    // 同じタブを選び直すたびに問い合わせない（ADR 0022）。
    if (get().byTab[tabId]) {
      return
    }

    const current = 世代を進める(tabId)
    set((state) => ({ byTab: { ...state.byTab, [tabId]: 読み込み中の状態(target) } }))

    try {
      const definition = await getDbApi().objectDefinition(
        connectionId,
        target.owner,
        target.name,
        target.kind,
      )
      if (current !== generations[tabId]) {
        return
      }
      書き換える(set, tabId, (entry) => ({
        ...entry,
        definition,
        status: 'ready',
        error: null,
        permissionDenied: false,
      }))
    } catch (error) {
      if (current !== generations[tabId]) {
        return
      }
      書き換える(set, tabId, (entry) => ({
        ...entry,
        status: 'failed',
        definition: null,
        error: toErrorMessage(error),
        permissionDenied: isDbError(error) && error.kind === 'permission',
      }))
    }
  },

  drop: (tabId) =>
    set((state) => {
      if (!state.byTab[tabId]) {
        return state
      }
      世代を進める(tabId)
      const { [tabId]: _removed, ...byTab } = state.byTab
      return { byTab }
    }),

  setSearch: (tabId, search) => 書き換える(set, tabId, (entry) => ({ ...entry, search })),

  selectTab: (connectionId, tabId, tab) => {
    const entry = get().byTab[tabId]
    if (!entry) {
      return
    }
    書き換える(set, tabId, (each) => ({ ...each, tab }))

    // DDL は開いたときに初めて取る。取れているなら取り直さない。
    if (tab !== 'ddl' || entry.ddlStatus !== 'idle') {
      return
    }

    void DDLを読む(connectionId, tabId, entry.target, set, generations[tabId] ?? 0)
  },

  clear: () => {
    for (const tabId of Object.keys(generations)) {
      世代を進める(tabId)
    }
    set({ byTab: {} })
  },
}))

/** 状態を書き換える関数。ストアの `set` をそのまま渡す。 */
type SetState = (
  partial: (state: DefinitionState) => Partial<DefinitionState> | DefinitionState,
) => void

/**
 * 1 枚ぶんの状態を差し替える。
 *
 * **まだ無いタブへの書き込みは捨てる。**閉じたあとに届いた取得の結果で、消えた
 * タブが蘇らないようにするためである。
 *
 * @param set 状態を書き換える関数
 * @param tabId 対象のタブ
 * @param 更新 今の状態から新しい状態を作る関数
 */
function 書き換える(
  set: SetState,
  tabId: string,
  更新: (entry: DefinitionEntry) => DefinitionEntry,
): void {
  set((state) => {
    const entry = state.byTab[tabId]
    if (!entry) {
      return state
    }
    return { byTab: { ...state.byTab, [tabId]: 更新(entry) } }
  })
}

/**
 * DDL を取って状態へ流し込む。
 *
 * 権限不足は `ddlPermissionDenied` で区別する。「定義が空だった」と読ませない
 * ためである（ADR 0017 と同じ考え方）。
 *
 * @param connectionId 接続の識別子
 * @param tabId 対象のタブ
 * @param target 対象のオブジェクト
 * @param set 状態を書き換える関数
 * @param current この取得の世代
 */
async function DDLを読む(
  connectionId: string,
  tabId: string,
  target: DefinitionTarget,
  set: SetState,
  current: number,
): Promise<void> {
  書き換える(set, tabId, (entry) => ({
    ...entry,
    ddlStatus: 'loading',
    ddlError: null,
    ddlPermissionDenied: false,
  }))

  try {
    const ddl = await getDbApi().objectDdl(connectionId, target.owner, target.name, target.kind)
    if (current !== generations[tabId]) {
      return
    }
    書き換える(set, tabId, (entry) => ({
      ...entry,
      ddl,
      ddlStatus: 'ready',
      ddlError: null,
      ddlPermissionDenied: false,
    }))
  } catch (error) {
    if (current !== generations[tabId]) {
      return
    }
    書き換える(set, tabId, (entry) => ({
      ...entry,
      ddlStatus: 'failed',
      ddl: null,
      ddlError: toErrorMessage(error),
      ddlPermissionDenied: isDbError(error) && error.kind === 'permission',
    }))
  }
}

/**
 * 定義タブ 1 枚ぶんの状態を返す。まだ読んでいなければ `null`。
 *
 * @param state 定義ストアの状態
 * @param tabId 対象のタブ
 */
export function selectDefinition(
  state: Pick<DefinitionState, 'byTab'>,
  tabId: string | null,
): DefinitionEntry | null {
  return tabId === null ? null : (state.byTab[tabId] ?? null)
}
