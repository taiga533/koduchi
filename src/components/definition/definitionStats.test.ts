/**
 * 表の統計とセグメントの大きさの文言のテスト（ADR 0044）。
 *
 * 「統計時点の行数を今の行数と読ませない」「無いものと権限の無いものを 0 と
 * 取り違えさせない」の 2 つを見る。
 */

import { describe, expect, it } from 'vitest'
import type { ObjectStats } from '../../types/db'
import { buildStatsItems, describeSegmentSize, formatBytes } from './definitionStats'

/**
 * 統計を採った普通の表を作る。
 *
 * @param overrides 差し替える項目
 */
function 統計(overrides: Partial<ObjectStats> = {}): ObjectStats {
  return {
    numRows: 1234,
    lastAnalyzed: '2026-09-01 22:00',
    daysSinceAnalyzed: 27,
    stale: false,
    partitioned: false,
    indexOrganized: false,
    temporary: false,
    size: {
      status: 'measured',
      tableBytes: 8 * 1024 * 1024,
      indexBytes: 65536,
      lobBytes: 0,
      segmentCount: 2,
    },
    ...overrides,
  }
}

/**
 * 見出しの項目を名前で引く。無ければ落とす。
 *
 * @param stats 表の統計
 * @param label 項目の名前
 */
function 項目(stats: ObjectStats, label: string) {
  const item = buildStatsItems(stats).find((each) => each.label === label)
  if (item === undefined) {
    throw new Error(`${label} の項目が無い`)
  }
  return item
}

describe('formatBytes', () => {
  it('1 KB 未満はバイトで出す', () => {
    // Arrange & Act & Assert
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1000)).toBe('1,000 B')
  })

  it('10 未満は小数 1 桁まで出す', () => {
    // Arrange & Act & Assert
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1.25 * 1024 * 1024)).toBe('1.3 MB')
  })

  it('10 以上は整数へ丸める', () => {
    // Arrange & Act & Assert
    expect(formatBytes(64 * 1024)).toBe('64 KB')
    expect(formatBytes(16 * 1024 * 1024)).toBe('16 MB')
    expect(formatBytes(1500 * 1024 * 1024 * 1024)).toBe('1.5 TB')
  })
})

describe('buildStatsItems', () => {
  it('行数は統計時点の概数だと分かる形で出す', () => {
    // Arrange & Act
    const item = 項目(統計(), '行数（統計時点）')

    // Assert
    expect(item.value).toBe('約 1,234 行')
    expect(item.note).toContain('今の行数ではありません')
  })

  it('統計が無い表の行数は 0 ではなく不明と出す', () => {
    // Arrange & Act
    const item = 項目(
      統計({ numRows: null, lastAnalyzed: null, daysSinceAnalyzed: null }),
      '行数（統計時点）',
    )

    // Assert
    expect(item.value).toBe('不明')
    expect(item.value).not.toContain('0')
    expect(item.tone).toBe('muted')
  })

  it('統計を採った日時と経った日数を並べる', () => {
    // Arrange & Act
    const item = 項目(統計(), '統計')

    // Assert
    expect(item.value).toBe('2026-09-01 22:00（27 日前）')
    expect(item.tone).toBe('normal')
  })

  it('今日採った統計は今日と出す', () => {
    // Arrange & Act
    const item = 項目(統計({ daysSinceAnalyzed: 0 }), '統計')

    // Assert
    expect(item.value).toBe('2026-09-01 22:00（今日）')
  })

  it('データベースが古いと見なした統計には印を付ける', () => {
    // Arrange & Act
    const item = 項目(統計({ stale: true }), '統計')

    // Assert
    expect(item.value).toContain('古い')
    expect(item.tone).toBe('warn')
  })

  it('日数が経っていてもデータベースが古いと言わなければ印を付けない', () => {
    // Arrange: 更新の少ない表は 1 年前の統計でも正しい
    const item = 項目(統計({ daysSinceAnalyzed: 400, stale: false }), '統計')

    // Act & Assert
    expect(item.value).not.toContain('古い')
    expect(item.tone).toBe('normal')
  })

  it('統計を採っていない表は未取得と出す', () => {
    // Arrange & Act
    const item = 項目(統計({ lastAnalyzed: null, daysSinceAnalyzed: null, stale: null }), '統計')

    // Assert
    expect(item.value).toBe('未取得')
  })

  it('並びは行数・統計・サイズの順である', () => {
    // Arrange & Act
    const labels = buildStatsItems(統計()).map((item) => item.label)

    // Assert
    expect(labels).toEqual(['行数（統計時点）', '統計', 'サイズ'])
  })

  it('パーティション表と索引構成表は作りの項目で言う', () => {
    // Arrange & Act
    const item = 項目(統計({ partitioned: true, indexOrganized: true }), '作り')

    // Assert
    expect(item.value).toBe('パーティション表 · 索引構成表')
    expect(item.note).toContain('主キーの索引')
  })
})

describe('describeSegmentSize', () => {
  it('表・索引・LOB に分けて出し、0 の索引と LOB は省く', () => {
    // Arrange & Act
    const 全部 = describeSegmentSize({
      status: 'measured',
      tableBytes: 65536,
      indexBytes: 65536,
      lobBytes: 3 * 1024 * 1024,
      segmentCount: 4,
    })
    const 表だけ = describeSegmentSize({
      status: 'measured',
      tableBytes: 65536,
      indexBytes: 0,
      lobBytes: 0,
      segmentCount: 1,
    })

    // Assert
    expect(全部.value).toBe('表 64 KB · 索引 64 KB · LOB 3.0 MB')
    expect(表だけ.value).toBe('表 64 KB')
  })

  it('権限が無いときは 0 ではなく測れないと出す', () => {
    // Arrange & Act
    const size = describeSegmentSize({ status: 'permissionDenied' })

    // Assert
    expect(size.value).toBe('権限が無く測れません')
    expect(size.value).not.toMatch(/\d/)
    expect(size.note).toContain('DBA_SEGMENTS')
  })

  it('セグメントがまだ無い表は未割り当てと出す', () => {
    // Arrange & Act
    const size = describeSegmentSize({
      status: 'measured',
      tableBytes: 0,
      indexBytes: 0,
      lobBytes: 0,
      segmentCount: 0,
    })

    // Assert
    expect(size.value).toBe('未割り当て')
  })

  it('一時表は持たないと出す', () => {
    // Arrange & Act
    const size = describeSegmentSize({ status: 'notStored' })

    // Assert
    expect(size.value).toBe('一時表のため持ちません')
  })
})
