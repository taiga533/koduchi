/**
 * 接続断の見分けと報せのテスト（ADR 0026）。
 *
 * 見分けは純粋な関数であり、窓口の包みは実装の差し替えだけで端から端まで
 * 試せる。データベースは要らない。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isConnectionLost,
  noteConnectionLost,
  onConnectionLost,
  PROBE_LOST_MESSAGE,
  reportConnectionLost,
  watchConnection,
} from './lost'
import type { DbError } from '../types/db'

/**
 * Rust 側が返す形のエラーを作る。
 *
 * @param kind エラーの区分
 * @param message 文言
 */
function dbエラー(kind: DbError['kind'], message: string): DbError {
  return { kind, message }
}

/** 登録した見張りを外すための後片付け。 */
const 外す: (() => void)[] = []

afterEach(() => {
  while (外す.length > 0) {
    外す.pop()?.()
  }
})

/**
 * 見張りを登録し、後片付けに積む。
 *
 * @param listener 断のときに呼ぶ処理
 */
function 見張る(listener: (message: string) => void): void {
  外す.push(onConnectionLost(listener))
}

describe('isConnectionLost', () => {
  it('接続断の区分のエラーを見分ける', () => {
    // Arrange
    const error = dbエラー('connectionLost', 'ORA-02396: 最大アイドル時間を超過しました')

    // Act
    const 断か = isConnectionLost(error)

    // Assert
    expect(断か).toBe(true)
  })

  it('小槌が自分で閉じたエラーは接続断とは見なさない', () => {
    // Arrange: `closed` は「自分で閉じた接続を使おうとした」であり意味が違う
    const error = dbエラー('closed', '結果は破棄されました。再実行してください')

    // Act & Assert
    expect(isConnectionLost(error)).toBe(false)
  })

  it('接続に失敗したエラーは接続断とは見なさない', () => {
    // Arrange: 繋ぎ直しても直らないものを「繋ぎ直せる」と言わない
    const error = dbエラー('connect', 'ORA-01017: invalid username/password')

    // Act & Assert
    expect(isConnectionLost(error)).toBe(false)
  })

  it('DbError ではない例外は接続断とは見なさない', () => {
    // Arrange & Act & Assert
    expect(isConnectionLost(new Error('壊れた'))).toBe(false)
    expect(isConnectionLost(null)).toBe(false)
  })
})

describe('noteConnectionLost', () => {
  it('接続断であれば見張りへ原文が届く', () => {
    // Arrange
    const 届いた: string[] = []
    見張る((message) => 届いた.push(message))

    // Act
    const 報せた = noteConnectionLost(
      dbエラー('connectionLost', 'ORA-02396: 最大アイドル時間を超過しました'),
    )

    // Assert
    expect(報せた).toBe(true)
    expect(届いた).toEqual(['ORA-02396: 最大アイドル時間を超過しました'])
  })

  it('接続断でなければ見張りは呼ばれない', () => {
    // Arrange
    const listener = vi.fn()
    見張る(listener)

    // Act
    const 報せた = noteConnectionLost(dbエラー('execute', 'ORA-00904: invalid identifier'))

    // Assert
    expect(報せた).toBe(false)
    expect(listener).not.toHaveBeenCalled()
  })

  it('見張りを外すと呼ばれなくなる', () => {
    // Arrange
    const listener = vi.fn()
    const 外す一つ = onConnectionLost(listener)

    // Act
    外す一つ()
    noteConnectionLost(dbエラー('connectionLost', 'ORA-03113'))

    // Assert
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('watchConnection', () => {
  it('包んだ窓口が接続断で拒めば見張りへ届く', async () => {
    // Arrange: 断はどの往復でも起こりうるため、包みで 1 箇所にまとめてある
    const 届いた: string[] = []
    見張る((message) => 届いた.push(message))
    const 窓口 = watchConnection({
      schemaOverview: () =>
        Promise.reject(dbエラー('connectionLost', 'ORA-03113: 通信路が切れました')),
    })

    // Act
    await expect(窓口.schemaOverview()).rejects.toEqual(
      dbエラー('connectionLost', 'ORA-03113: 通信路が切れました'),
    )

    // Assert
    expect(届いた).toEqual(['ORA-03113: 通信路が切れました'])
  })

  it('包んでも例外は握り潰されず呼び出し元へ届く', async () => {
    // Arrange: 断は呼び出し元にとってもエラーである
    見張る(() => {})
    const 窓口 = watchConnection({
      execute: () => Promise.reject(dbエラー('connectionLost', 'ORA-02396')),
    })

    // Act & Assert
    await expect(窓口.execute()).rejects.toEqual(dbエラー('connectionLost', 'ORA-02396'))
  })

  it('成功した呼び出しの戻り値はそのまま返る', async () => {
    // Arrange
    const 窓口 = watchConnection({ commit: () => Promise.resolve(42) })

    // Act
    const 結果 = await 窓口.commit()

    // Assert
    expect(結果).toBe(42)
  })

  it('引数はそのまま元の実装へ渡る', async () => {
    // Arrange
    const 受けた: unknown[][] = []
    const 窓口 = watchConnection({
      execute: (...args: unknown[]) => {
        受けた.push(args)
        return Promise.resolve()
      },
    })

    // Act
    await 窓口.execute('c1', 't1', 'select 1 from dual')

    // Assert
    expect(受けた).toEqual([['c1', 't1', 'select 1 from dual']])
  })

  it('接続断でない失敗では見張りは呼ばれない', () => {
    // Arrange: 綴りの誤りで「接続が切れた」と言わない
    const listener = vi.fn()
    見張る(listener)
    const 窓口 = watchConnection({
      execute: () => Promise.reject(dbエラー('execute', 'ORA-00904')),
    })

    // Act & Assert
    return 窓口.execute().catch(() => {
      expect(listener).not.toHaveBeenCalled()
    })
  })
})

describe('reportConnectionLost', () => {
  it('例外を経由しない断も同じ見張りへ届く', () => {
    // Arrange: 往復を起こさない覗きには、拒まれた約束が無い（ADR 0030）
    const listener = vi.fn()
    見張る(listener)

    // Act
    reportConnectionLost(PROBE_LOST_MESSAGE)

    // Assert
    expect(listener).toHaveBeenCalledWith(PROBE_LOST_MESSAGE)
  })

  it('見張りが複数居ればすべてに届く', () => {
    // Arrange
    const 一人目 = vi.fn()
    const 二人目 = vi.fn()
    見張る(一人目)
    見張る(二人目)

    // Act
    reportConnectionLost(PROBE_LOST_MESSAGE)

    // Assert
    expect(一人目).toHaveBeenCalledTimes(1)
    expect(二人目).toHaveBeenCalledTimes(1)
  })

  it('報せの数え落としはここでは行わない', () => {
    // Arrange: 2 度目かどうかを決めるのは `connection` ストアの段階である
    // （ADR 0026）。ここは届いた事実をそのまま配る
    const listener = vi.fn()
    見張る(listener)

    // Act
    reportConnectionLost(PROBE_LOST_MESSAGE)
    reportConnectionLost(PROBE_LOST_MESSAGE)

    // Assert
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
