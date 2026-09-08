/**
 * テーブル定義ビューのストア（ADR 0019）。
 *
 * 開いている対象・列と制約と索引・DDL・絞り込み語・開いているタブを持つ。
 * 取得はプールの結果セットを保持していない接続で行われるため、利用者が見ている
 * 結果セット（ADR 0003）は壊れない。
 *
 * **DDL は DDL タブを開いたときに初めて取る。** `DBMS_METADATA.GET_DDL` は重く
 * 権限にも敏感であり、定義ビュー全体がそれで開けなくなってはいけない。取った
 * DDL は同じ対象を開いている間だけ覚え、タブを行き来しても取り直さない。
 *
 * 開閉の状態を `ui` ストアではなくここに置いたのは、対象（スキーマ名・
 * オブジェクト名・種別）という中身を伴うためである。設定画面やセッション
 * パネル（ADR 0017）は真偽値 1 つで足りるため `ui` に置いてある。
 */

import { create } from 'zustand'
import { getDbApi } from '../api/db'
import type { DefinitionTarget, ObjectDdl, ObjectDefinition } from '../types/db'
import { isDbError, toErrorMessage } from '../types/db'

/** 取得の状態。 */
export type DefinitionStatus = 'idle' | 'loading' | 'ready' | 'failed'

/** 定義ビューのタブ。 */
export type DefinitionTab = 'columns' | 'constraints' | 'indexes' | 'ddl'

/** タブの並び。左から順に出す。 */
export const DEFINITION_TABS: DefinitionTab[] = ['columns', 'constraints', 'indexes', 'ddl']

/** タブの表示名。 */
export const DEFINITION_TAB_LABELS: Record<DefinitionTab, string> = {
  columns: '列',
  constraints: '制約',
  indexes: '索引',
  ddl: 'DDL',
}

interface DefinitionState {
  /** 開いている対象。閉じていれば `null`。 */
  target: DefinitionTarget | null
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

  /** 定義ビューを開いて内容を読む。 */
  open: (connectionId: string, target: DefinitionTarget) => Promise<void>
  /** 定義ビューを閉じて中身を捨てる。 */
  close: () => void
  setSearch: (search: string) => void
  /** タブを切り替える。DDL タブは初回だけ取得しにいく。 */
  selectTab: (connectionId: string, tab: DefinitionTab) => void
  /** 切断したときに捨てる。 */
  clear: () => void
}

/**
 * 取得の世代。
 *
 * 別のオブジェクトを続けて開いたとき、古い取得の結果を捨てるために使う。
 */
let generation = 0

/** 何も開いていない状態。 */
const 空の状態 = {
  target: null,
  definition: null,
  status: 'idle' as DefinitionStatus,
  error: null,
  permissionDenied: false,
  ddl: null,
  ddlStatus: 'idle' as DefinitionStatus,
  ddlError: null,
  ddlPermissionDenied: false,
  search: '',
  tab: 'columns' as DefinitionTab,
}

export const useDefinitionStore = create<DefinitionState>((set, get) => ({
  ...空の状態,

  open: async (connectionId, target) => {
    generation += 1
    const current = generation

    // 対象が変われば絞り込みもタブも DDL も引き継がない。前の表の語で
    // 別の表を絞ったまま見せると、列が無いのか隠れているのかが分からない。
    set({ ...空の状態, target, status: 'loading' })

    try {
      const definition = await getDbApi().objectDefinition(
        connectionId,
        target.owner,
        target.name,
        target.kind,
      )
      if (current !== generation) {
        return
      }
      set({ definition, status: 'ready', error: null, permissionDenied: false })
    } catch (error) {
      if (current !== generation) {
        return
      }
      set({
        status: 'failed',
        definition: null,
        error: toErrorMessage(error),
        permissionDenied: isDbError(error) && error.kind === 'permission',
      })
    }
  },

  close: () => {
    generation += 1
    set({ ...空の状態 })
  },

  setSearch: (search) => set({ search }),

  selectTab: (connectionId, tab) => {
    set({ tab })

    const { target, ddlStatus } = get()
    // DDL は開いたときに初めて取る。取れているなら取り直さない。
    if (tab !== 'ddl' || target === null || ddlStatus !== 'idle') {
      return
    }

    void 定義を読む(connectionId, target, set, generation)
  },

  clear: () => {
    generation += 1
    set({ ...空の状態 })
  },
}))

/**
 * DDL を取って状態へ流し込む。
 *
 * 権限不足は `ddlPermissionDenied` で区別する。「定義が空だった」と読ませない
 * ためである（ADR 0017 と同じ考え方）。
 *
 * @param connectionId 接続の識別子
 * @param target 対象のオブジェクト
 * @param set 状態を書き換える関数
 * @param current この取得の世代
 */
async function 定義を読む(
  connectionId: string,
  target: DefinitionTarget,
  set: (partial: Partial<DefinitionState>) => void,
  current: number,
): Promise<void> {
  set({ ddlStatus: 'loading', ddlError: null, ddlPermissionDenied: false })

  try {
    const ddl = await getDbApi().objectDdl(connectionId, target.owner, target.name, target.kind)
    if (current !== generation) {
      return
    }
    set({ ddl, ddlStatus: 'ready', ddlError: null, ddlPermissionDenied: false })
  } catch (error) {
    if (current !== generation) {
      return
    }
    set({
      ddlStatus: 'failed',
      ddl: null,
      ddlError: toErrorMessage(error),
      ddlPermissionDenied: isDbError(error) && error.kind === 'permission',
    })
  }
}
