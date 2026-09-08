/**
 * 接続をグループへ束ねる（ADR 0015）。
 *
 * 接続を選ぶ画面の並びを決める純粋な関数だけを置く。描画から切り離してあるのは、
 * 並びの決まりごと（未指定は先頭・見出しなし、グループはファイルの並び順）を
 * 描画を経由せずに試せるようにするためである。
 */

import type { SavedConnection } from '../../types/db'

/** 見出し 1 つと、その下に並ぶ接続。 */
export interface ConnectionGroup {
  /** グループ名。グループ未指定の接続を束ねた組では `null`。 */
  name: string | null
  connections: SavedConnection[]
}

/**
 * グループ名を整える。
 *
 * 前後の空白を落とし、空になったものは未指定として扱う。`"本番"` と `"本番 "`
 * が別のグループに割れるのを防ぐためである。
 *
 * @param group 保存されているグループ名
 *
 * @returns 整えたグループ名。未指定なら `null`
 */
export function normalizeGroup(group: string | null | undefined): string | null {
  const trimmed = group?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

/**
 * 接続をグループごとに束ねる。
 *
 * 並びは次のとおり。
 *
 * - グループ未指定の接続を先頭に、見出しの無い 1 組として置く。グループを
 *   使っていない利用者の画面が今までと変わらないようにするためである。
 * - グループは**渡された並びで最初に現れた順**に置く。名前で並べ替えると、
 *   日本語の名前で並びが読み手の予想と合わなくなる。
 * - 同じグループの中の並びは渡された順のままにする。
 *
 * 入れ子は作らない。接続が持つグループ名は 1 つだけであるため、この関数の
 * 返す構造も常に 1 段である。
 *
 * @param connections 保存されている接続の一覧
 *
 * @returns 見出しごとに束ねた組。中身の無い組は返さない
 */
export function groupConnections(connections: SavedConnection[]): ConnectionGroup[] {
  const ungrouped: SavedConnection[] = []
  const grouped = new Map<string, SavedConnection[]>()

  for (const connection of connections) {
    const name = normalizeGroup(connection.group)
    if (name === null) {
      ungrouped.push(connection)
      continue
    }
    const bucket = grouped.get(name)
    if (bucket) {
      bucket.push(connection)
    } else {
      grouped.set(name, [connection])
    }
  }

  const groups: ConnectionGroup[] = []
  if (ungrouped.length > 0) {
    groups.push({ name: null, connections: ungrouped })
  }
  for (const [name, members] of grouped) {
    groups.push({ name, connections: members })
  }
  return groups
}

/**
 * 既に使われているグループ名を、現れた順に重複なく集める。
 *
 * 接続を作る画面の入力候補に使う。同じ意味のグループが綴り違いで割れるのを
 * 防ぐためである。
 *
 * @param connections 保存されている接続の一覧
 *
 * @returns グループ名の一覧
 */
export function collectGroupNames(connections: SavedConnection[]): string[] {
  const names: string[] = []
  for (const connection of connections) {
    const name = normalizeGroup(connection.group)
    if (name !== null && !names.includes(name)) {
      names.push(name)
    }
  }
  return names
}
