import { describe, expect, it } from 'vitest'
import { createAskChannel } from './ask'

describe('createAskChannel', () => {
  it('尋ね事を出すと一覧に載り、答えると片付いて答えが届く', async () => {
    // Arrange
    const channel = createAskChannel()
    const 答え = channel.ask({
      kind: 'saveQuery',
      defaultName: '売上',
      sql: 'select 1 from dual',
      existingName: null,
    })

    // Act
    channel.getSnapshot().saveQuery?.answer('売上集計')

    // Assert
    await expect(答え).resolves.toBe('売上集計')
    expect(channel.getSnapshot().saveQuery).toBeUndefined()
  })

  it('尋ね事の出し入れを購読者へ知らせる', () => {
    // Arrange
    const channel = createAskChannel()
    let 知らせ = 0
    channel.subscribe(() => {
      知らせ += 1
    })

    // Act
    void channel.ask({ kind: 'disconnectBlocked' })
    channel.getSnapshot().disconnectBlocked?.answer('dismiss')

    // Assert
    expect(知らせ).toBe(2)
  })

  it('購読をやめたら知らせない', () => {
    // Arrange
    const channel = createAskChannel()
    let 知らせ = 0
    const やめる = channel.subscribe(() => {
      知らせ += 1
    })
    やめる()

    // Act
    void channel.ask({ kind: 'disconnectBlocked' })

    // Assert
    expect(知らせ).toBe(0)
  })

  it('違う種類の尋ね事は同時に出ていられる', () => {
    // Arrange
    const channel = createAskChannel()

    // Act
    void channel.ask({ kind: 'binds', names: ['id'] })
    void channel.ask({ kind: 'disconnectBlocked' })

    // Assert
    expect(channel.getSnapshot().binds?.request.names).toEqual(['id'])
    expect(channel.getSnapshot().disconnectBlocked).toBeDefined()
  })

  it('同じ種類を重ねて出すと、前のものは取り消しの答えで解いて差し替える', async () => {
    // Arrange: 答えの来ない Promise を残すと、その裁定は止まったままになる
    const channel = createAskChannel()
    const 前 = channel.ask({ kind: 'binds', names: ['a'] })

    // Act
    void channel.ask({ kind: 'binds', names: ['b'] })

    // Assert
    await expect(前).resolves.toBe(false)
    expect(channel.getSnapshot().binds?.request.names).toEqual(['b'])
  })

  it('差し替えられた古い尋ね事へ答えても新しいものは残る', () => {
    // Arrange
    const channel = createAskChannel()
    void channel.ask({ kind: 'binds', names: ['a'] })
    const 古い = channel.getSnapshot().binds
    void channel.ask({ kind: 'binds', names: ['b'] })

    // Act
    古い?.answer(true)

    // Assert
    expect(channel.getSnapshot().binds?.request.names).toEqual(['b'])
  })
})
