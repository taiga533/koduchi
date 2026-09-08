/**
 * 結果テーブルの検索（ADR 0027）。
 *
 * 描画から切り離した純粋な関数だけを置く。検索の状態は `ResultTable` の中に閉じる
 * ため（打鍵ごとにアプリ全体が描き直らないようにするため。ADR README の「結果
 * テーブル」節）、ここには状態を持たない。`selection.ts` と同じ切り方である。
 *
 * **探すのは画面に見えている文字列である。**当て先は `displayText(cell)` であって
 * `Cell.text` ではない。NULL のセルは画面に `NULL` と出ているので `null` と打てば
 * 拾える。目で見えているものと探した結果が食い違わないための唯一の規則であり、
 * 「表示の裏に別の値がある」という状態を作らない。
 *
 * **探せるのは取得済みの行だけである。**結果は 1,000 行ずつの分割取得であり
 * （ADR 0003）、下までスクロールしていなければ手元には一部しか無い。だから
 * `SearchOutcome` は当たりと一緒に**何行を走査したか**を持ち、`matchSummary` は
 * カーソルが尽きていないかぎりその行数を必ず文言に載せる。**「3 件」とだけ書いて
 * はならない。**
 */

import type { Cell } from '../../types/db'
import { CLOB_LIMIT_BYTES } from '../../types/db'
import { displayText } from './cellText'
import type { CellPosition, CellSelection } from './selection'

/** 検索の当て方。 */
export interface SearchOptions {
  /** 大文字と小文字を区別するか。既定は区別しない。 */
  caseSensitive: boolean
}

/**
 * 検索の結果。
 *
 * 当たりだけでなく「どこまで探したか」を併せて持つ。件数を単独で出すと、取得済み
 * の一部を数えたものが全体の件数に見えるためである（ADR 0027）。
 *
 * `needle` / `caseSensitive` / `scannedTail` を抱えているのは、続きの行が届いた
 * ときに前の結果へ**継ぎ足せるか**を `searchRows` が自分で判断するためである。
 * 呼び出し側はこの 3 つを読まなくてよい。
 */
export interface SearchOutcome {
  /** この結果を作ったときの検索語。 */
  needle: string
  /** この結果を作ったときの大小の扱い。 */
  caseSensitive: boolean
  /** 当たったセルの位置。行優先（上から下、左から右）に並ぶ。 */
  matches: CellPosition[]
  /** 走査した行数。取得済みの行数と等しい。 */
  scannedRows: number
  /**
   * 最後に走査した行そのもの。
   *
   * 続きを取り込むと `rows` は新しい配列になるが、既にあった行の**参照は据え置か
   * れる**。ここが一致していれば「同じ結果の続きが届いただけ」と判断でき、前半を
   * 走査し直さずに済む。実行し直したときは参照が変わるため、正しく総なめに戻る。
   */
  scannedTail: Cell[] | null
  /**
   * 走査した中に切り詰められた値があったか。
   *
   * `CLOB` は先頭 64KB までしか運ばれていない（`Cell.truncated`）。その先に検索語
   * があっても当たらないため、**黙って「無い」と言ってはならない**（ADR 0021 の
   * 「黙って切り詰めない」と同じ）。
   */
  sawTruncated: boolean
}

/** 何も探していない状態。 */
export const EMPTY_OUTCOME: SearchOutcome = {
  needle: '',
  caseSensitive: false,
  matches: [],
  scannedRows: 0,
  scannedTail: null,
  sawTruncated: false,
}

/**
 * その語で探せるかを判定する。
 *
 * **前後の空白は落とさない。**`CHAR(10)` の値は右が空白で詰められており、空白その
 * ものを探したい場面がある。定義ビューの絞り込み（`definitionSearch.ts`）が語を
 * `trim` するのは名前を相手にしているからで、任意の値を相手にするここでは同じに
 * できない。
 *
 * @param needle 入力された語
 */
export function isSearchable(needle: string): boolean {
  return needle !== ''
}

/**
 * セル 1 つが語を含むかを判定する。
 *
 * 当て先は**画面に出ている文字列**である。NULL のセルは `NULL` として当たる。
 *
 * @param cell 判定するセル
 * @param needle 探す語（`caseSensitive` が偽なら小文字へ畳んで渡すこと）
 * @param caseSensitive 大文字と小文字を区別するか
 */
export function cellMatches(cell: Cell, needle: string, caseSensitive: boolean): boolean {
  const text = displayText(cell)
  return caseSensitive ? text.includes(needle) : text.toLowerCase().includes(needle)
}

/**
 * 取得済みの行から当たりを拾う。前の結果があれば続きだけを走査する。
 *
 * 続きとして継ぎ足せるのは、**語と大小の扱いが同じ**で、かつ `previous` が今の
 * `rows` の**先頭部分をちょうど走査し終えている**ときだけである。それ以外（語を
 * 打ち替えた・実行し直して行が入れ替わった）は先頭から数え直す。
 *
 * 継ぎ足しに意味があるのは「残りを読み込んで探す」のためである。数十万行を
 * 1,000 行ずつ取り込むたびに全体を走査し直すと、届いたかたまりの数だけ同じ
 * 仕事を繰り返すことになる。
 *
 * @param previous 前回の結果。初回は `null`
 * @param rows 取得済みの行
 * @param needle 探す語
 * @param options 当て方
 */
export function searchRows(
  previous: SearchOutcome | null,
  rows: Cell[][],
  needle: string,
  options: SearchOptions,
): SearchOutcome {
  if (!isSearchable(needle)) {
    return EMPTY_OUTCOME
  }

  const base = 継ぎ足せる(previous, rows, needle, options) ? previous : null
  const 当て先 = options.caseSensitive ? needle : needle.toLowerCase()

  const matches = base ? [...base.matches] : []
  let sawTruncated = base?.sawTruncated ?? false

  for (let row = base?.scannedRows ?? 0; row < rows.length; row += 1) {
    const cells = rows[row]
    for (let column = 0; column < cells.length; column += 1) {
      const cell = cells[column]
      if (cell.truncated) {
        sawTruncated = true
      }
      if (cellMatches(cell, 当て先, options.caseSensitive)) {
        matches.push({ row, column })
      }
    }
  }

  return {
    needle,
    caseSensitive: options.caseSensitive,
    matches,
    scannedRows: rows.length,
    scannedTail: rows.length === 0 ? null : rows[rows.length - 1],
    sawTruncated,
  }
}

/**
 * 前の結果へ続きを継ぎ足してよいかを判定する。
 *
 * @param previous 前回の結果
 * @param rows 今の行
 * @param needle 探す語
 * @param options 当て方
 */
function 継ぎ足せる(
  previous: SearchOutcome | null,
  rows: Cell[][],
  needle: string,
  options: SearchOptions,
): previous is SearchOutcome {
  if (previous === null) {
    return false
  }
  if (previous.needle !== needle || previous.caseSensitive !== options.caseSensitive) {
    return false
  }
  if (rows.length < previous.scannedRows) {
    return false
  }
  if (previous.scannedRows === 0) {
    return true
  }
  return rows[previous.scannedRows - 1] === previous.scannedTail
}

/**
 * 当たりの並びの中でその位置が何番目かを返す。無ければ `-1`。
 *
 * 並びは行優先で整列しているため二分探索できる。当たりは数万件になりうるので、
 * 描画のたびに線形に走らせない。
 *
 * @param matches 当たりの並び
 * @param position 探す位置
 */
export function indexOfMatch(matches: CellPosition[], position: CellPosition): number {
  let low = 0
  let high = matches.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    const 差 = matches[mid].row - position.row || matches[mid].column - position.column
    if (差 === 0) {
      return mid
    }
    if (差 < 0) {
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return -1
}

/**
 * 次（または前）の当たりの番号を返す。端では巻き戻る。
 *
 * まだどこにも居ないとき（`current` が負）は、進むなら先頭、戻るなら末尾を返す。
 *
 * @param count 当たりの総数
 * @param current 今いる当たりの番号。居なければ負
 * @param forward 進むなら真、戻るなら偽
 */
export function nextMatchIndex(count: number, current: number, forward: boolean): number {
  if (count === 0) {
    return -1
  }
  if (current < 0) {
    return forward ? 0 : count - 1
  }
  return forward ? (current + 1) % count : (current - 1 + count) % count
}

/** 当たりの位置を照合するための鍵。 */
export function matchKey(row: number, column: number): string {
  return `${row}:${column}`
}

/**
 * 当たりの位置を引ける集合にする。
 *
 * 描かれるのは画面に見えている数十行だけなので、当たりの並びを毎回走査するのでは
 * なく引ける形にしておく。
 *
 * @param matches 当たりの並び
 */
export function matchKeySet(matches: CellPosition[]): Set<string> {
  return new Set(matches.map((match) => matchKey(match.row, match.column)))
}

/** 当たり 1 つだけを選んだ状態にする。矩形選択と同じ器に載せる。 */
export function selectionAt(position: CellPosition): CellSelection {
  return { anchor: position, focus: position }
}

/**
 * 件数の文言を組み立てる。
 *
 * **カーソルが尽きていないときは、探した行数を必ず添える。**「3 件」とだけ書くと、
 * 取得済みの一部を数えたものが全体の件数に読める。ADR README が並べ替えを退けた
 * のと同じ嘘であり、検索でそれを避けられるのは、件数のすぐ隣に探した範囲を並べ
 * られるからである（ADR 0027）。
 *
 * @param count 当たりの総数
 * @param current 今いる当たりの番号。居なければ負
 * @param scannedRows 走査した行数
 * @param exhausted カーソルが尽きているか
 */
export function matchSummary(
  count: number,
  current: number,
  scannedRows: number,
  exhausted: boolean,
): string {
  const 範囲 = exhausted ? '' : `（取得済みの ${scannedRows.toLocaleString('ja-JP')} 行のうち）`
  if (count === 0) {
    return `一致なし${範囲}`
  }
  if (current < 0) {
    return `${count.toLocaleString('ja-JP')} 件${範囲}`
  }
  return `${(current + 1).toLocaleString('ja-JP')} / ${count.toLocaleString('ja-JP')} 件${範囲}`
}

/**
 * 切り詰められた値を探したことの断り書き。無ければ `null`。
 *
 * `CLOB` の先 64KB より後ろは手元に無く、そこに語があっても当たらない。
 *
 * @param sawTruncated 走査した中に切り詰められた値があったか
 */
export function truncationNote(sawTruncated: boolean): string | null {
  if (!sawTruncated) {
    return null
  }
  return `一部の値は先頭 ${CLOB_LIMIT_BYTES / 1024} KB までしか探していません`
}
