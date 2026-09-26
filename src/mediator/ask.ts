/**
 * 仲介者が利用者へ尋ねる事柄（ADR 0035）。
 *
 * 画面の中に描く確認は、仲介者が「尋ね事」を出し、画面がそれを描き、押されたら
 * 答えで `Promise` を解く。裁定は答えを `await` して続きを書けるため、「尋ねる」と
 * 「答えを受けて続ける」が別の関数へ割れない。
 *
 * 仲介者は描き方を知らない。尋ね方（`Ask`）は画面から引数で受け取る。
 */

/** 尋ね事の中身。`kind` ごとに答えの型が決まる（`AskAnswers`）。 */
export type AskRequest =
  /** バインド変数の値を尋ねる（ADR の「バインド変数」節）。値はタブストアへ入る。 */
  | { kind: 'binds'; names: string[] }
  /** 実行中のため切断できないことを告げ、中止するかを尋ねる（ADR README「接続の切断と切り替え」）。 */
  | { kind: 'disconnectBlocked' }
  /** 保存済みクエリの名前を尋ねる（ADR 0018）。 */
  | { kind: 'saveQuery'; defaultName: string; sql: string }

/** 尋ね事の種類。 */
export type AskKind = AskRequest['kind']

/** 尋ね事ごとの答え。 */
export interface AskAnswers {
  /** 真なら「この値で実行」、偽なら取り消し。 */
  binds: boolean
  /** 中止を選んだか、閉じただけか。どちらでも切断はしない。 */
  disconnectBlocked: 'cancelExecution' | 'dismiss'
  /** 決まった名前。取り消されたら `null`。 */
  saveQuery: string | null
}

/**
 * 答えずに片付けたときに返す答え。
 *
 * 同じ種類の尋ね事を重ねて出したとき、前のものはこの答えで解いてから差し替える。
 * どれも「何もしない」側の答えである。
 */
export const DISMISSED: AskAnswers = {
  binds: false,
  disconnectBlocked: 'dismiss',
  saveQuery: null,
}

/** 尋ね方。画面が実装し、仲介者へ渡す。 */
export type Ask = <K extends AskKind>(
  request: Extract<AskRequest, { kind: K }>,
) => Promise<AskAnswers[K]>

/** 答えを待っている 1 つの尋ね事。 */
export interface PendingAsk<K extends AskKind> {
  request: Extract<AskRequest, { kind: K }>
  /** 答える。答えたら尋ね事は片付く。 */
  answer: (answer: AskAnswers[K]) => void
}

/**
 * 答えを待っている尋ね事の一覧。種類ごとに高々 1 つである。
 *
 * 種類ごとに分けるのは、以前 `App.tsx` が種類ごとに表示フラグを持っていた
 * 振る舞いを保つためである（違う種類の尋ね事は同時に出ていてよい）。
 */
export type PendingAsks = { [K in AskKind]?: PendingAsk<K> }

/**
 * 尋ね事の受け渡し口。仲介者が `ask` で出し、画面が `getSnapshot` で読んで描く。
 *
 * `subscribe` と `getSnapshot` は React の `useSyncExternalStore` に渡せる形にしてある。
 * ここ自体は React に依存しない。
 */
export interface AskChannel {
  ask: Ask
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => PendingAsks
}

/**
 * 尋ね事の受け渡し口を作る。
 *
 * 同じ種類の尋ね事を重ねて出したら、前のものは `DISMISSED` の答えで解いてから
 * 差し替える。答えの来ない `Promise` を残すと、その裁定はいつまでも止まったままになる。
 */
export function createAskChannel(): AskChannel {
  let pending: PendingAsks = {}
  const listeners = new Set<() => void>()

  /** 一覧を差し替えて知らせる。`useSyncExternalStore` は参照が変わったかで見る。 */
  const update = (next: PendingAsks): void => {
    pending = next
    for (const listener of listeners) {
      listener()
    }
  }

  const ask = (<K extends AskKind>(request: Extract<AskRequest, { kind: K }>) =>
    new Promise<AskAnswers[K]>((resolve) => {
      const kind = request.kind as K
      const previous = pending[kind] as PendingAsk<K> | undefined

      const entry: PendingAsk<K> = {
        request,
        answer: (answer) => {
          // 差し替えられた後に古い尋ね事へ答えても、新しいものは片付けない。
          if (pending[kind] === entry) {
            update({ ...pending, [kind]: undefined })
          }
          resolve(answer)
        },
      }
      update({ ...pending, [kind]: entry })
      previous?.answer(DISMISSED[kind])
    })) as Ask

  return {
    ask,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => pending,
  }
}
