import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetUpdaterApi, setUpdaterApi } from '../api/updater'
import type { FakeUpdaterApi } from '../test/fakeUpdaterApi'
import { availableUpdate, createFakeUpdaterApi } from '../test/fakeUpdaterApi'
import type { UpdateStatus } from './update'
import { useUpdateStore } from './update'

let fake: FakeUpdaterApi

/** 段階を直に置く。遷移の出発点を作るためだけに使う。 */
function 段階を置く(status: UpdateStatus, dialogOpen = true): void {
  useUpdateStore.setState({
    status,
    dialogOpen,
    update: status === 'available' ? availableUpdate(fake) : null,
  })
}

/** 待ちの続きを走らせる。 */
async function 待ちを進める(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  fake = createFakeUpdaterApi()
  setUpdaterApi(fake.api)
  useUpdateStore.setState({
    status: 'idle',
    dialogOpen: false,
    update: null,
    progress: null,
    error: null,
  })
})

afterEach(() => {
  resetUpdaterApi()
})

describe('確認', () => {
  it('起動時の確認はダイアログを出さずに問い合わせる', () => {
    // Arrange
    // 何もしていない段階から始める。

    // Act
    void useUpdateStore.getState().check('launch')

    // Assert
    expect(useUpdateStore.getState()).toMatchObject({ status: 'checking', dialogOpen: false })
    expect(fake.calls).toEqual(['check'])
  })

  it('手で確かめるとダイアログを出して問い合わせる', () => {
    // Arrange
    // 何もしていない段階から始める。

    // Act
    void useUpdateStore.getState().check('manual')

    // Assert
    expect(useUpdateStore.getState()).toMatchObject({ status: 'checking', dialogOpen: true })
  })

  it.each<UpdateStatus>(['upToDate', 'failed'])('%s からも手で確かめ直せる', (status) => {
    // Arrange
    段階を置く(status, false)

    // Act
    void useUpdateStore.getState().check('manual')

    // Assert
    expect(useUpdateStore.getState().status).toBe('checking')
    expect(fake.calls).toEqual(['check'])
  })

  it('新しい版が無ければ最新になる', async () => {
    // Arrange
    const checking = useUpdateStore.getState().check('manual')

    // Act
    fake.checks[0].resolve(null)
    await checking

    // Assert
    expect(useUpdateStore.getState()).toMatchObject({ status: 'upToDate', dialogOpen: true })
  })

  it('起動時の確認で最新だったときは黙っている', async () => {
    // Arrange
    const checking = useUpdateStore.getState().check('launch')

    // Act
    fake.checks[0].resolve(null)
    await checking

    // Assert
    expect(useUpdateStore.getState()).toMatchObject({ status: 'upToDate', dialogOpen: false })
  })

  it('起動時の確認で新しい版を見つけたらダイアログを出す', async () => {
    // Arrange
    const checking = useUpdateStore.getState().check('launch')
    const update = availableUpdate(fake, '0.3.0')

    // Act
    fake.checks[0].resolve(update)
    await checking

    // Assert
    expect(useUpdateStore.getState()).toMatchObject({
      status: 'available',
      dialogOpen: true,
      update,
    })
  })

  it('問い合わせに失敗したら失敗の段階へ移りメッセージを持つ', async () => {
    // Arrange
    const checking = useUpdateStore.getState().check('manual')

    // Act
    fake.checks[0].reject(new Error('ネットワークに繋がりません'))
    await checking

    // Assert
    expect(useUpdateStore.getState()).toMatchObject({
      status: 'failed',
      error: 'ネットワークに繋がりません',
      dialogOpen: true,
    })
  })

  it('起動時の確認に失敗したときは黙っている', async () => {
    // Arrange
    const checking = useUpdateStore.getState().check('launch')

    // Act
    fake.checks[0].reject(new Error('ネットワークに繋がりません'))
    await checking

    // Assert
    expect(useUpdateStore.getState()).toMatchObject({ status: 'failed', dialogOpen: false })
  })

  it('手で確かめている間に閉じたら見つけてもダイアログを出し直さない', async () => {
    // Arrange
    const checking = useUpdateStore.getState().check('manual')
    useUpdateStore.getState().dismiss()

    // Act
    fake.checks[0].resolve(availableUpdate(fake))
    await checking

    // Assert
    expect(useUpdateStore.getState()).toMatchObject({ status: 'available', dialogOpen: false })
  })

  it('問い合わせている間に手で確かめても 2 本目を走らせずダイアログを出す', () => {
    // Arrange
    void useUpdateStore.getState().check('launch')

    // Act
    void useUpdateStore.getState().check('manual')

    // Assert
    expect(fake.calls).toEqual(['check'])
    expect(useUpdateStore.getState()).toMatchObject({ status: 'checking', dialogOpen: true })
  })

  it.each<UpdateStatus>(['available', 'installed'])(
    '%s で手で確かめても問い合わせずにダイアログを出し直す',
    (status) => {
      // Arrange
      段階を置く(status, false)

      // Act
      void useUpdateStore.getState().check('manual')

      // Assert
      expect(fake.calls).toEqual([])
      expect(useUpdateStore.getState()).toMatchObject({ status, dialogOpen: true })
    },
  )

  it.each<UpdateStatus>(['upToDate', 'failed', 'downloading', 'restarting'])(
    '%s では起動時の確認を走らせない',
    (status) => {
      // Arrange
      段階を置く(status, false)

      // Act
      void useUpdateStore.getState().check('launch')

      // Assert
      expect(fake.calls).toEqual([])
      expect(useUpdateStore.getState()).toMatchObject({ status, dialogOpen: false })
    },
  )
})

describe('取得と入れ替え', () => {
  it('新しい版を取りにいき進み具合を持つ', () => {
    // Arrange
    段階を置く('available')

    // Act
    void useUpdateStore.getState().install()
    fake.downloads[0].report({ downloaded: 512, total: 1024 })

    // Assert
    expect(useUpdateStore.getState()).toMatchObject({
      status: 'downloading',
      progress: { downloaded: 512, total: 1024 },
    })
  })

  it('入れ替え終えたらそのまま再起動へ進む', async () => {
    // Arrange
    段階を置く('available')
    const installing = useUpdateStore.getState().install()

    // Act
    fake.downloads[0].deferred.resolve()
    await installing

    // Assert
    expect(useUpdateStore.getState().status).toBe('restarting')
    expect(fake.calls).toEqual(['downloadAndInstall', 'restart'])
  })

  it('取得に失敗したら失敗の段階へ移り再起動しない', async () => {
    // Arrange
    段階を置く('available')
    const installing = useUpdateStore.getState().install()

    // Act
    fake.downloads[0].deferred.reject(new Error('署名が合いません'))
    await installing

    // Assert
    expect(useUpdateStore.getState()).toMatchObject({ status: 'failed', error: '署名が合いません' })
    expect(fake.calls).not.toContain('restart')
  })

  it.each<UpdateStatus>(['idle', 'checking', 'upToDate', 'downloading', 'restarting', 'failed'])(
    '%s では取りにいかない',
    async (status) => {
      // Arrange
      段階を置く(status)

      // Act
      await useUpdateStore.getState().install()

      // Assert
      expect(useUpdateStore.getState().status).toBe(status)
      expect(fake.calls).toEqual([])
    },
  )
})

describe('再起動', () => {
  it('入れ替え済みなら起ち上げ直しを頼む', async () => {
    // Arrange
    段階を置く('installed')

    // Act
    await useUpdateStore.getState().restart()

    // Assert
    expect(useUpdateStore.getState().status).toBe('restarting')
    expect(fake.calls).toEqual(['restart'])
  })

  it('起ち上げ直しを頼めなかったら失敗の段階へ移る', async () => {
    // Arrange
    段階を置く('installed')
    fake.failRestartWith(new Error('コマンドがありません'))

    // Act
    await useUpdateStore.getState().restart()

    // Assert
    expect(useUpdateStore.getState()).toMatchObject({
      status: 'failed',
      error: 'コマンドがありません',
    })
  })

  it.each<UpdateStatus>(['idle', 'available', 'downloading', 'restarting'])(
    '%s では起ち上げ直しを頼まない',
    async (status) => {
      // Arrange
      段階を置く(status)

      // Act
      await useUpdateStore.getState().restart()

      // Assert
      expect(useUpdateStore.getState().status).toBe(status)
      expect(fake.calls).toEqual([])
    },
  )

  it('関所で断られたら入れ替え済みへ戻りダイアログを出す', () => {
    // Arrange
    段階を置く('restarting', false)

    // Act
    useUpdateStore.getState().restartDeclined()

    // Assert
    expect(useUpdateStore.getState()).toMatchObject({ status: 'installed', dialogOpen: true })
  })

  it('再起動していないウィンドウで断られても段階は動かない', () => {
    // Arrange
    段階を置く('idle', false)

    // Act
    useUpdateStore.getState().restartDeclined()

    // Assert
    expect(useUpdateStore.getState()).toMatchObject({ status: 'idle', dialogOpen: false })
  })
})

describe('閉じる', () => {
  it.each<UpdateStatus>(['checking', 'upToDate', 'available', 'installed', 'failed'])(
    '%s では閉じられる',
    (status) => {
      // Arrange
      段階を置く(status)

      // Act
      useUpdateStore.getState().dismiss()

      // Assert
      expect(useUpdateStore.getState()).toMatchObject({ status, dialogOpen: false })
    },
  )

  it.each<UpdateStatus>(['downloading', 'restarting'])('%s では閉じない', (status) => {
    // Arrange
    段階を置く(status)

    // Act
    useUpdateStore.getState().dismiss()

    // Assert
    expect(useUpdateStore.getState().dialogOpen).toBe(true)
  })

  it('閉じた後も見つけた版は残り、手で確かめると問い合わせずに出し直す', async () => {
    // Arrange
    段階を置く('available')
    useUpdateStore.getState().dismiss()

    // Act
    await useUpdateStore.getState().check('manual')
    await 待ちを進める()

    // Assert
    expect(fake.calls).toEqual([])
    expect(useUpdateStore.getState()).toMatchObject({ status: 'available', dialogOpen: true })
  })
})
