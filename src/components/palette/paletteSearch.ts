/**
 * コマンドパレットの絞り込みと並べ替え（ADR 0018）。
 *
 * 表示にも React にも依存しない純粋な関数だけを置く。パレットの見え方は打鍵の
 * たびに変わるため、当たり判定と順序をここへ切り出しておかないと確かめようが
 * ない（`src/components/results/selection.ts` と同じ考え方）。
 *
 * 当て方は**大文字小文字を区別しない部分一致**である。あいまい一致
 * （綴りを飛ばして拾う）は採らない。理由は ADR 0018 に書いてある。
 */

/** パレットに並ぶものの種別。 */
export type PaletteKind = 'command' | 'schema' | 'saved' | 'history'

/**
 * パレットに並ぶ 1 件。
 *
 * 絞り込みが見るのは `label` だけである。`detail` は目で確かめるための補足で
 * あって、当たり判定には使わない（接続名や所要時間で候補が釣れると邪魔になる）。
 */
export interface PaletteEntry {
  /** 種別をまたいで一意な鍵。 */
  id: string
  kind: PaletteKind
  /** 突き合わせと表示に使う主の文字列。 */
  label: string
  /** 右や下に添える補足。突き合わせには使わない。 */
  detail: string
}

/** 突き合わせの結果。並べ替えに使う。 */
export interface PaletteMatch {
  /** 当たりの強さ。前方一致 3 / 語頭一致 2 / それ以外の部分一致 1。 */
  score: number
  /** 当たった位置。小さいほど前にある。 */
  index: number
}

/** 見出しごとにまとめた絞り込みの結果。 */
export interface PaletteGroup<T extends PaletteEntry> {
  kind: PaletteKind
  /** 見出しに出す文言。 */
  label: string
  entries: T[]
}

/**
 * 種別の並びと見出し。
 *
 * 並びは固定である。打鍵のたびに見出しの位置が入れ替わると目が迷うためである。
 */
export const PALETTE_GROUPS: { kind: PaletteKind; label: string }[] = [
  { kind: 'command', label: 'コマンド' },
  { kind: 'schema', label: 'スキーマ' },
  { kind: 'saved', label: '保存済みクエリ' },
  { kind: 'history', label: '履歴' },
]

/**
 * 種別ごとに並べる件数の上限。
 *
 * スキーマのオブジェクトは数千件になりうる。全部並べても読めないため、上位だけを
 * 出して残りは絞り込みで手繰らせる。コマンドは総数が知れているので全部出す。
 */
export const PALETTE_GROUP_LIMITS: Record<PaletteKind, number> = {
  command: 20,
  schema: 8,
  saved: 8,
  history: 8,
}

/**
 * 語の切れ目とみなす文字か。
 *
 * `SCOTT.ORDER_ITEMS` の `ITEMS` のように、区切りの直後に来た当たりは
 * 途中に埋もれた当たりより強く扱う。
 *
 * @param character 判定する 1 文字
 */
function isBoundary(character: string): boolean {
  return /[^0-9a-z぀-ヿ一-鿿]/.test(character)
}

/**
 * 1 件を絞り込み語に突き合わせる。
 *
 * 語が空なら全件が同じ強さで当たる。当たらなければ `null` を返す。
 *
 * @param label 突き合わせる文字列
 * @param query 絞り込み語
 */
export function matchPaletteLabel(label: string, query: string): PaletteMatch | null {
  const needle = query.trim().toLowerCase()
  if (needle === '') {
    return { score: 0, index: 0 }
  }

  const haystack = label.toLowerCase()
  const index = haystack.indexOf(needle)
  if (index < 0) {
    return null
  }

  if (index === 0) {
    return { score: 3, index }
  }
  return { score: isBoundary(haystack[index - 1]) ? 2 : 1, index }
}

/**
 * 絞り込み語に当てはまるものを種別ごとにまとめる。
 *
 * 種別の並びは `PALETTE_GROUPS` の固定順、種別の中は「当たりの強い順 → 当たりの
 * 早い順 → 短い順」である。同点のものは渡された順のまま残る。当たりの無い種別は
 * 返さない。
 *
 * 呼び出し側で `useMemo` に包むこと。毎回新しい配列を作る。
 *
 * @param entries 候補すべて
 * @param query 絞り込み語
 */
export function filterPaletteEntries<T extends PaletteEntry>(
  entries: T[],
  query: string,
): PaletteGroup<T>[] {
  const 当たり = new Map<string, PaletteMatch>()
  const 種別ごと = new Map<PaletteKind, T[]>()

  for (const entry of entries) {
    const match = matchPaletteLabel(entry.label, query)
    if (match === null) {
      continue
    }
    当たり.set(entry.id, match)
    const 束 = 種別ごと.get(entry.kind)
    if (束) {
      束.push(entry)
    } else {
      種別ごと.set(entry.kind, [entry])
    }
  }

  const groups: PaletteGroup<T>[] = []

  for (const { kind, label } of PALETTE_GROUPS) {
    const 束 = 種別ごと.get(kind)
    if (!束 || 束.length === 0) {
      continue
    }

    // `sort` は安定であるため、同点は渡された順のまま残る。`slice()` で複製して
    // いるので元の配列は壊れない（`toSorted` は tsconfig の lib（ES2022）に無い）。
    // oxlint-disable-next-line unicorn/no-array-sort
    const sorted = 束.slice().sort((left, right) => {
      const a = 当たり.get(left.id) as PaletteMatch
      const b = 当たり.get(right.id) as PaletteMatch
      if (a.score !== b.score) {
        return b.score - a.score
      }
      if (a.index !== b.index) {
        return a.index - b.index
      }
      return left.label.length - right.label.length
    })

    groups.push({ kind, label, entries: sorted.slice(0, PALETTE_GROUP_LIMITS[kind]) })
  }

  return groups
}

/**
 * 見出しごとの束を、上から下への 1 本の並びに直す。
 *
 * 上下キーはこの並びの上を動く。見出しは飛ばす。
 *
 * @param groups 絞り込みの結果
 */
export function flattenPaletteGroups<T extends PaletteEntry>(groups: PaletteGroup<T>[]): T[] {
  return groups.flatMap((group) => group.entries)
}

/**
 * 上下キーで選択を動かした先を返す。
 *
 * 端では逆側へ回り込む。候補が無いときは 0 を返す。
 *
 * @param count 候補の数
 * @param current 今の位置
 * @param delta 動かす向き（下が +1、上が -1）
 */
export function movePaletteSelection(count: number, current: number, delta: number): number {
  if (count <= 0) {
    return 0
  }
  return (((current + delta) % count) + count) % count
}

/**
 * SQL を 1 行の見出しに詰める。
 *
 * 履歴と保存済みクエリの本文をパレットへ載せるために使う。改行を落として
 * 空白を 1 つに畳み、長すぎるものは切る。
 *
 * @param sql SQL の全文
 */
export function summarizeSql(sql: string): string {
  return sql.trim().replace(/\s+/g, ' ').slice(0, 120)
}
