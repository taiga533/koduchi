/**
 * 定義タブの見出しに出す、表の統計とセグメントの大きさの文言（ADR 0044）。
 *
 * 画面から切り離した純粋な関数に寄せてあるのは、文言そのものがこの機能の
 * 要だからである。`NUM_ROWS` は統計を採った時点の値であって今の行数ではなく、
 * 「統計が無い」「権限が無くて測れない」は「0」と取り違えてはならない。
 * どの状態でどの文字が出るかを、描画抜きで全部試せるようにしておく。
 */

import type { ObjectStats, SegmentSize } from '../../types/db'

/** 見出しに並べる項目 1 つ。 */
export interface StatsItem {
  /** 項目の名前（`行数（統計時点）` など）。 */
  label: string
  /** 値の文字。 */
  value: string
  /**
   * 値の色の調子。`warn` は統計が古いとき、`muted` は値が無いとき。
   * 色そのものは画面が決める（ADR 0008）。
   */
  tone: 'normal' | 'warn' | 'muted'
  /** 補足。`title` に出す。 */
  note: string | null
}

/** 1 KiB。セグメントは 1024 の倍数で割り当てられるため、2 進の単位で数える。 */
const KIB = 1024

/** 大きさの単位。`B` から順に 1024 倍ずつ上がる。 */
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

/**
 * バイト数を読める大きさへ整える。
 *
 * 10 未満は小数 1 桁まで出す（`1.3 MB`）。それ以上は整数へ丸める。セグメントの
 * 割り当ては 64 KB や 8 MB の刻みであり、有効数字 2〜3 桁で「全件 SELECT して
 * よい大きさか」には十分答えられる。
 *
 * @param bytes バイト数
 */
export function formatBytes(bytes: number): string {
  let value = bytes
  let unit = 0
  while (value >= KIB && unit < UNITS.length - 1) {
    value /= KIB
    unit += 1
  }

  if (unit === 0) {
    return `${bytes.toLocaleString('ja-JP')} B`
  }

  const 数 = value < 10 ? value.toFixed(1) : Math.round(value).toLocaleString('ja-JP')
  return `${数} ${UNITS[unit]}`
}

/**
 * 行数の項目を作る。
 *
 * **見出しに「統計時点」と書き、値に「約」を添える。**`NUM_ROWS` は統計を
 * 採ったときの値であり、その後に入った行も消えた行も数えていない。標本から
 * 推し量った値であることも多い。今の行数だと読ませれば、「全件 SELECT して
 * よいか」の判断を誤らせる。
 *
 * 統計が無いときは「不明」であり、0 ではない。
 *
 * @param stats 表の統計
 */
function 行数の項目(stats: ObjectStats): StatsItem {
  const note = 'NUM_ROWS は統計を採った時点の行数です。今の行数ではありません'

  if (stats.numRows === null) {
    return {
      label: '行数（統計時点）',
      value: '不明',
      tone: 'muted',
      note: '統計を採っていないため、行数は分かりません（0 行という意味ではありません）',
    }
  }

  return {
    label: '行数（統計時点）',
    value: `約 ${stats.numRows.toLocaleString('ja-JP')} 行`,
    tone: 'normal',
    note,
  }
}

/**
 * 経った日数を言葉にする。
 *
 * @param days 統計を採ってから経った日数
 */
function 経過(days: number): string {
  return days <= 0 ? '今日' : `${days.toLocaleString('ja-JP')} 日前`
}

/**
 * 統計を採った日時の項目を作る。
 *
 * **古いかどうかはデータベースの判定（`STALE_STATS`）だけで決める。**日数の
 * しきい値を小槌が持つと、更新の少ない表が 1 年前の統計で正しく動いているのに
 * 「古い」と言うことになる。データベースは変更の割合（既定 10%）で判定しており、
 * 実行計画が狂うかどうかに近いのはそちらである。
 *
 * @param stats 表の統計
 */
function 統計の項目(stats: ObjectStats): StatsItem {
  if (stats.lastAnalyzed === null) {
    return {
      label: '統計',
      value: '未取得',
      tone: 'muted',
      note: '統計を 1 度も採っていません。実行計画は推定に頼ります',
    }
  }

  const いつ =
    stats.daysSinceAnalyzed === null
      ? stats.lastAnalyzed
      : `${stats.lastAnalyzed}（${経過(stats.daysSinceAnalyzed)}）`

  if (stats.stale === true) {
    return {
      label: '統計',
      value: `${いつ} · 古い`,
      tone: 'warn',
      note: '採った後に多くの行が変わっており、データベースが統計を古いと見なしています（STALE_STATS）',
    }
  }

  return { label: '統計', value: いつ, tone: 'normal', note: null }
}

/**
 * セグメントの大きさを言葉にする。
 *
 * 索引と LOB は 0 なら省く。表は 0 でも出す（「表 0 B」は「統計が無い」とは
 * 違う事実である）。
 *
 * @param size セグメントの大きさ
 */
export function describeSegmentSize(size: SegmentSize): Pick<StatsItem, 'value' | 'tone' | 'note'> {
  switch (size.status) {
    case 'permissionDenied':
      return {
        value: '権限が無く測れません',
        tone: 'muted',
        note: '他のスキーマの表の大きさは DBA_SEGMENTS でしか測れず、SELECT_CATALOG_ROLE などが要ります',
      }
    case 'notStored':
      return {
        value: '一時表のため持ちません',
        tone: 'muted',
        note: '一時表の行はセッションごとの一時セグメントに入り、永続のセグメントを持ちません',
      }
    case 'measured': {
      if (size.segmentCount === 0) {
        return {
          value: '未割り当て',
          tone: 'muted',
          note: 'まだ行が入ったことがなく、セグメントが作られていません',
        }
      }
      const 内訳 = [`表 ${formatBytes(size.tableBytes)}`]
      if (size.indexBytes > 0) {
        内訳.push(`索引 ${formatBytes(size.indexBytes)}`)
      }
      if (size.lobBytes > 0) {
        内訳.push(`LOB ${formatBytes(size.lobBytes)}`)
      }
      return {
        value: 内訳.join(' · '),
        tone: 'normal',
        note: '割り当て済みのセグメントの大きさです。行を消しても縮みません',
      }
    }
  }
}

/**
 * 見出しに並べる項目を作る（ADR 0044）。
 *
 * 並びは行数 → 統計 → サイズ → 表の作り（パーティション・索引構成）で固定する。
 * 「全件 SELECT してよいか」に答える行数を先頭に置き、その値がいつのものかを
 * すぐ隣で言う。
 *
 * @param stats 表の統計
 */
export function buildStatsItems(stats: ObjectStats): StatsItem[] {
  const items = [行数の項目(stats), 統計の項目(stats)]

  items.push({ label: 'サイズ', ...describeSegmentSize(stats.size) })

  const 作り: string[] = []
  if (stats.partitioned) {
    作り.push('パーティション表')
  }
  if (stats.indexOrganized) {
    作り.push('索引構成表')
  }
  if (作り.length > 0) {
    items.push({
      label: '作り',
      value: 作り.join(' · '),
      tone: 'normal',
      note: stats.indexOrganized
        ? '索引構成表の行は主キーの索引にあり、表のサイズに含めています'
        : null,
    })
  }

  return items
}
