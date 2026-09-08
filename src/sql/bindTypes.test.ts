import { describe, expect, it } from 'vitest'
import type { TableColumn } from '../types/db'
import {
  autoBindKind,
  bindKindOfColumnType,
  inferBindKinds,
  inferBindKindFromText,
} from './bindTypes'
import { collectBindOccurrences } from './statements'

/** 列 1 つぶんの情報を組み立てる。 */
function 列(objectName: string, name: string, typeName: string): TableColumn {
  return { objectName, name, typeName, nullable: true, kind: 'text' }
}

describe('bindKindOfColumnType', () => {
  it('数値の列は NUMBER になる', () => {
    // Arrange
    const 型名 = ['NUMBER(12,2)', 'BINARY_DOUBLE', 'FLOAT(126)']

    // Act
    const 種類 = 型名.map(bindKindOfColumnType)

    // Assert
    expect(種類).toEqual(['number', 'number', 'number'])
  })

  it('日付の列は DATE になる', () => {
    // Arrange
    const 型名 = 'DATE'

    // Act
    const 種類 = bindKindOfColumnType(型名)

    // Assert
    expect(種類).toBe('date')
  })

  it('時間帯付きのタイムスタンプも TIMESTAMP になる', () => {
    // Arrange
    const 型名 = 'TIMESTAMP(6) WITH TIME ZONE'

    // Act
    const 種類 = bindKindOfColumnType(型名)

    // Assert
    expect(種類).toBe('timestamp')
  })

  it('それ以外の列は文字列になる', () => {
    // Arrange
    const 型名 = ['VARCHAR2(255)', 'CLOB', 'RAW(64)']

    // Act
    const 種類 = 型名.map(bindKindOfColumnType)

    // Assert
    expect(種類).toEqual(['varchar2', 'varchar2', 'varchar2'])
  })
})

describe('inferBindKindFromText', () => {
  it('数字だけの値は数値と見なす', () => {
    // Arrange
    const 値 = ['42', '-3.14', '1.5e3']

    // Act
    const 種類 = 値.map(inferBindKindFromText)

    // Assert
    expect(種類).toEqual(['number', 'number', 'number'])
  })

  it('年月日だけの値は日付と見なす', () => {
    // Arrange
    const 値 = ['2024-01-02', '2024/1/2']

    // Act
    const 種類 = 値.map(inferBindKindFromText)

    // Assert
    expect(種類).toEqual(['date', 'date'])
  })

  it('時刻まで書かれた値はタイムスタンプと見なす', () => {
    // Arrange
    const 値 = ['2024-01-02 03:04', '2024-01-02T03:04:05.678']

    // Act
    const 種類 = 値.map(inferBindKindFromText)

    // Assert
    expect(種類).toEqual(['timestamp', 'timestamp'])
  })

  it('読み取れない値では推し量らない', () => {
    // Arrange
    const 値 = ['', 'ABC-123', '2024-13-45x']

    // Act
    const 種類 = 値.map(inferBindKindFromText)

    // Assert
    expect(種類).toEqual([null, null, null])
  })

  it('自動で決まる型は読み取れなければ文字列になる', () => {
    // Arrange
    const 値 = 'ABC'

    // Act
    const 種類 = autoBindKind(値)

    // Assert
    expect(種類).toBe('varchar2')
  })
})

describe('inferBindKinds', () => {
  const columns = {
    KODUCHI: [
      列('USERS', 'USER_ID', 'NUMBER(12)'),
      列('USERS', 'SIGNED_UP_AT', 'TIMESTAMP(6)'),
      列('USERS', 'EMAIL', 'VARCHAR2(255)'),
      列('ORDERS', 'CLOSED_ON', 'DATE'),
    ],
  }

  it('比べている列の型を既定にする', () => {
    // Arrange
    const occurrences = collectBindOccurrences('select * from users where user_id = :id')

    // Act
    const kinds = inferBindKinds(occurrences, columns)

    // Assert
    expect(kinds).toEqual({ ID: 'number' })
  })

  it('表の別名で修飾されていても列の型を引ける', () => {
    // Arrange
    const occurrences = collectBindOccurrences('select * from users u where u.signed_up_at > :from')

    // Act
    const kinds = inferBindKinds(occurrences, columns)

    // Assert
    expect(kinds).toEqual({ FROM: 'timestamp' })
  })

  it('BETWEEN の両側とも同じ列の型になる', () => {
    // Arrange
    const occurrences = collectBindOccurrences(
      'select * from orders where closed_on between :from and :to',
    )

    // Act
    const kinds = inferBindKinds(occurrences, columns)

    // Assert
    expect(kinds).toEqual({ FROM: 'date', TO: 'date' })
  })

  it('知らない列と比べている変数は推し量らない', () => {
    // Arrange
    const occurrences = collectBindOccurrences('select * from t where 知らない列 = :x')

    // Act
    const kinds = inferBindKinds(occurrences, columns)

    // Assert
    expect(kinds).toEqual({})
  })

  it('同じ名前の列の型が表ごとに食い違えば推し量らない', () => {
    // Arrange: 取り違えて誤った型を既定にするより、推し量らないほうがよい
    const 食い違う = {
      KODUCHI: [列('USERS', 'CODE', 'NUMBER(6)'), 列('ITEMS', 'CODE', 'VARCHAR2(8)')],
    }
    const occurrences = collectBindOccurrences('select * from users where code = :code')

    // Act
    const kinds = inferBindKinds(occurrences, 食い違う)

    // Assert
    expect(kinds).toEqual({})
  })

  it('同じ変数が別の型の列と比べられていれば推し量らない', () => {
    // Arrange
    const occurrences = collectBindOccurrences(
      'select * from users where user_id = :x or email = :x',
    )

    // Act
    const kinds = inferBindKinds(occurrences, columns)

    // Assert
    expect(kinds).toEqual({})
  })

  it('同じ列の表を渡したときは型表を組み直さない', () => {
    // Arrange: 列は数万件になりうるため、参照が同じであれば作り直さない
    let 読んだ回数 = 0
    const 覚える列 = {} as Record<string, TableColumn[]>
    Object.defineProperty(覚える列, 'KODUCHI', {
      enumerable: true,
      get: () => {
        読んだ回数 += 1
        return [列('USERS', 'USER_ID', 'NUMBER(12)')]
      },
    })
    const occurrences = collectBindOccurrences('select * from users where user_id = :id')

    // Act
    const 一度目 = inferBindKinds(occurrences, 覚える列)
    const 二度目 = inferBindKinds(occurrences, 覚える列)

    // Assert
    expect(読んだ回数).toBe(1)
    expect(二度目).toEqual(一度目)
  })

  it('列がまだ読み込まれていなければ推し量らない', () => {
    // Arrange
    const occurrences = collectBindOccurrences('select * from users where user_id = :id')

    // Act
    const kinds = inferBindKinds(occurrences, {})

    // Assert
    expect(kinds).toEqual({})
  })
})
