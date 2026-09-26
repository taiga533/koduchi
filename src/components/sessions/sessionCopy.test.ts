import { describe, expect, it } from 'vitest'
import { sessionRow } from '../../test/fakeDbApi'
import { blockedByLabel, buildSessionRowCopyText, sessionIdentity } from './sessionCopy'

describe('sessionIdentity', () => {
  it('SID と SERIAL# をカンマで繋ぐ', () => {
    // Arrange
    const session = sessionRow({ sid: 30, serial: 4711 })

    // Act / Assert
    expect(sessionIdentity(session)).toBe('30,4711')
  })
})

describe('blockedByLabel', () => {
  it('待っていなければ null', () => {
    // Arrange / Act / Assert
    expect(blockedByLabel(sessionRow({ sid: 20 }), 1)).toBeNull()
  })

  it('同じインスタンスの相手は SID だけを出す', () => {
    // Arrange
    const session = sessionRow({ sid: 30, blockingSession: 20, blockingInstance: 1 })

    // Act / Assert
    expect(blockedByLabel(session, 1)).toBe('SID 20')
  })

  it('別インスタンスの相手はインスタンス番号を添える', () => {
    // Arrange
    const session = sessionRow({ sid: 30, blockingSession: 20, blockingInstance: 2 })

    // Act / Assert
    expect(blockedByLabel(session, 1)).toBe('SID 20（インスタンス 2）')
  })
})

describe('buildSessionRowCopyText', () => {
  it('画面の欄の並びで見出しを付けずにタブ区切りにし、空の欄は —', () => {
    // Arrange
    const session = sessionRow({
      sid: 30,
      username: 'WEB',
      status: 'ACTIVE',
      event: 'enq: TX - row lock contention',
      secondsInWait: 42,
      program: null,
      blockingSession: 20,
      blockingInstance: 1,
    })

    // Act
    const text = buildSessionRowCopyText(session, 1)

    // Assert
    expect(text).toBe('30,300\tWEB\tACTIVE\tenq: TX - row lock contention\t42 秒\t—\tSID 20')
  })
})
