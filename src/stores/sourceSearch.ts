/**
 * オブジェクトのソース検索のストア（ADR 0021）。
 *
 * 検索条件と結果、それに選んだ当たり行の前後を持つ。**打鍵のたびには投げない。**
 * `⌘K` のパレット（ADR 0018）が取得済みのものを打鍵ごとに絞る速い道具である
 * のに対し、ソース検索は `ALL_SOURCE` へ投げて待つ道具である。押したときだけ
 * 走らせる。
 *
 * 権限が無くて読めなかったことは `permissionDenied` で区別する。空の結果を
 * 出して「見つからなかった」と読ませてはならない。
 */

import { create } from 'zustand'
import { getDbApi } from '../api/db'
import type {
  SourceKind,
  SourceKindFilter,
  SourceLine,
  SourceObjectMatches,
  SourceSearchRequest,
  SourceSearchResult,
} from '../types/db'
import {
  defaultSourceKindFilter,
  isDbError,
  SOURCE_SEARCH_MIN_LENGTH,
  toErrorMessage,
} from '../types/db'

/** 取得の状態。 */
export type SourceSearchStatus = 'idle' | 'loading' | 'ready' | 'failed'

/** 1 度の検索で持ち帰る当たり行数の上限。Rust 側の既定値と同じ。 */
export const SOURCE_SEARCH_LIMIT = 500

/** 選んだ当たり行。前後を読む相手でもある。 */
export interface SelectedMatch {
  owner: string
  name: string
  kind: SourceKind
  line: number
}

interface SourceSearchState {
  /** 探す文字列。 */
  needle: string
  /** 探す先のスキーマ。`null` は「すべてのスキーマ」。 */
  owner: string | null
  kinds: SourceKindFilter
  caseSensitive: boolean

  result: SourceSearchResult | null
  status: SourceSearchStatus
  error: string | null
  /**
   * 読めなかった理由が権限不足か（ADR 0017 の区分を使う）。
   *
   * 真のときは「この接続では参照できない」と出す。空の結果は出さない。
   */
  permissionDenied: boolean

  /** 前後を読んでいる当たり行。選んでいなければ `null`。 */
  selected: SelectedMatch | null
  context: SourceLine[]
  contextStatus: SourceSearchStatus
  contextError: string | null

  setNeedle: (needle: string) => void
  setOwner: (owner: string | null) => void
  /** 種別の可否を 1 つ切り替える。 */
  toggleKind: (kind: SourceKind) => void
  setCaseSensitive: (caseSensitive: boolean) => void
  /** 今の条件で検索する。 */
  search: (connectionId: string) => Promise<void>
  /** 当たり行を選び、その前後を読む。 */
  select: (connectionId: string, object: SourceObjectMatches, line: number) => Promise<void>
  /** 選択を解く。 */
  clearSelection: () => void
  /** 切断したときに捨てる。 */
  clear: () => void
}

/**
 * 検索の世代。
 *
 * 前の検索が返る前に次を押したとき、古い結果で上書きさせないために使う。
 */
let generation = 0

/** 前後を読む世代。検索と同じ理由で持つ。 */
let contextGeneration = 0

export const useSourceSearchStore = create<SourceSearchState>((set, get) => ({
  needle: '',
  owner: null,
  kinds: defaultSourceKindFilter,
  caseSensitive: false,

  result: null,
  status: 'idle',
  error: null,
  permissionDenied: false,

  selected: null,
  context: [],
  contextStatus: 'idle',
  contextError: null,

  setNeedle: (needle) => set({ needle }),
  setOwner: (owner) => set({ owner }),

  toggleKind: (kind) => set((state) => ({ kinds: { ...state.kinds, [kind]: !state.kinds[kind] } })),

  setCaseSensitive: (caseSensitive) => set({ caseSensitive }),

  search: async (connectionId) => {
    const state = get()

    // 短すぎる語は投げない。Rust 側も弾くが、待たせてから断るより、
    // 押した時点でその場に理由を出すほうが分かりやすい。
    if (!canSearch(state.needle)) {
      set({
        status: 'failed',
        result: null,
        error: `検索語は ${SOURCE_SEARCH_MIN_LENGTH} 文字以上で指定してください`,
        permissionDenied: false,
        selected: null,
        context: [],
      })
      return
    }

    generation += 1
    const current = generation

    set({
      status: 'loading',
      error: null,
      permissionDenied: false,
      selected: null,
      context: [],
      contextStatus: 'idle',
      contextError: null,
    })

    const request: SourceSearchRequest = {
      needle: state.needle.trim(),
      owner: state.owner,
      kinds: state.kinds,
      caseSensitive: state.caseSensitive,
      limit: SOURCE_SEARCH_LIMIT,
    }

    try {
      const result = await getDbApi().searchSource(connectionId, request)
      if (current !== generation) {
        return
      }
      set({ result, status: 'ready', error: null, permissionDenied: false })
    } catch (error) {
      if (current !== generation) {
        return
      }
      set({
        status: 'failed',
        result: null,
        error: toErrorMessage(error),
        permissionDenied: isDbError(error) && error.kind === 'permission',
      })
    }
  },

  select: async (connectionId, object, line) => {
    contextGeneration += 1
    const current = contextGeneration

    set({
      selected: { owner: object.owner, name: object.name, kind: object.kind, line },
      context: [],
      contextStatus: 'loading',
      contextError: null,
    })

    try {
      const context = await getDbApi().sourceContext(
        connectionId,
        { owner: object.owner, name: object.name, kind: object.kind },
        line,
      )
      if (current !== contextGeneration) {
        return
      }
      set({ context, contextStatus: 'ready' })
    } catch (error) {
      if (current !== contextGeneration) {
        return
      }
      set({ context: [], contextStatus: 'failed', contextError: toErrorMessage(error) })
    }
  },

  clearSelection: () => {
    contextGeneration += 1
    set({ selected: null, context: [], contextStatus: 'idle', contextError: null })
  },

  clear: () => {
    generation += 1
    contextGeneration += 1
    set({
      needle: '',
      owner: null,
      kinds: defaultSourceKindFilter,
      caseSensitive: false,
      result: null,
      status: 'idle',
      error: null,
      permissionDenied: false,
      selected: null,
      context: [],
      contextStatus: 'idle',
      contextError: null,
    })
  },
}))

/**
 * 検索語として成り立っているか。
 *
 * Rust 側の `SourceSearchRequest::validated_needle` と同じ判定である。
 * 押せるかどうかの見た目にも使う。
 *
 * @param needle 打たれた検索語
 */
export function canSearch(needle: string): boolean {
  return needle.trim().length >= SOURCE_SEARCH_MIN_LENGTH
}

/**
 * 当たったオブジェクトの数と行数を要約する。
 *
 * 打ち切りが起きたときは、それが上限であることを添える。**黙って切り詰めない。**
 * 出ていないものを「無い」と読ませないためである。
 *
 * @param result 検索の結果。未取得なら `null`
 */
export function summarizeSourceResult(result: SourceSearchResult | null): string {
  if (!result) {
    return ''
  }

  const 要約 = `${result.objects.length.toLocaleString('ja-JP')} 件のオブジェクト · ${result.matchedLines.toLocaleString('ja-JP')} 行`

  return result.truncated ? `${要約}（上限に達しました。語を絞り込んでください）` : 要約
}
