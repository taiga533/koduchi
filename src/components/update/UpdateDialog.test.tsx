import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { resetUpdaterApi, setUpdaterApi } from '../../api/updater'
import type { UpdateStatus } from '../../stores/update'
import { useUpdateStore } from '../../stores/update'
import type { FakeUpdaterApi } from '../../test/fakeUpdaterApi'
import { availableUpdate, createFakeUpdaterApi } from '../../test/fakeUpdaterApi'
import { UpdateDialog } from './UpdateDialog'

let fake: FakeUpdaterApi

/** 段階を置いてダイアログを開いた状態にする。 */
function 開く(
  status: UpdateStatus,
  extra: Partial<ReturnType<typeof useUpdateStore.getState>> = {},
) {
  useUpdateStore.setState({
    status,
    dialogOpen: true,
    update: availableUpdate(fake, '0.3.0'),
    progress: null,
    error: null,
    ...extra,
  })
}

beforeEach(() => {
  fake = createFakeUpdaterApi()
  setUpdaterApi(fake.api)
})

afterEach(() => {
  resetUpdaterApi()
  useUpdateStore.setState({ status: 'idle', dialogOpen: false, update: null, error: null })
})

describe('UpdateDialog', () => {
  it('ストアが閉じていれば何も描かない', () => {
    // Arrange
    開く('available', { dialogOpen: false })

    // Act
    render(<UpdateDialog />)

    // Assert
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('新しい版があれば新旧の版と未コミットの変更を尋ねることを告げる', () => {
    // Arrange
    開く('available')

    // Act
    render(<UpdateDialog />)

    // Assert
    const dialog = screen.getByRole('dialog', { name: '新しい版があります' })
    expect(dialog).toHaveTextContent('小槌 0.3.0 を使えます（今は 0.2.0）')
    expect(dialog).toHaveTextContent('未コミットの変更があれば、閉じる前に尋ねます')
  })

  it('ダウンロードして再起動を押すと新しい版を取りにいく', async () => {
    // Arrange
    開く('available')
    render(<UpdateDialog />)

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'ダウンロードして再起動' }))

    // Assert
    expect(fake.calls).toEqual(['downloadAndInstall'])
    expect(screen.getByRole('dialog', { name: 'ダウンロードしています' })).toBeInTheDocument()
  })

  it('リリースノートを押すとその版のノートを開く', async () => {
    // Arrange
    開く('available')
    render(<UpdateDialog />)

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'リリースノート' }))

    // Assert
    expect(fake.calls).toEqual(['openReleaseNotes:0.3.0'])
  })

  it('あとでを押すと閉じる', async () => {
    // Arrange
    開く('available')
    render(<UpdateDialog />)

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'あとで' }))

    // Assert
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('esc で閉じる', async () => {
    // Arrange
    開く('upToDate')
    render(<UpdateDialog />)

    // Act
    await userEvent.keyboard('{Escape}')

    // Assert
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('ダウンロード中は esc でも閉じず進み具合を出す', async () => {
    // Arrange
    開く('downloading', { progress: { downloaded: 1024 * 1024, total: 4 * 1024 * 1024 } })
    render(<UpdateDialog />)

    // Act
    await userEvent.keyboard('{Escape}')

    // Assert
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25')
    expect(screen.getByRole('dialog')).toHaveTextContent('1.0 MB / 4.0 MB')
  })

  it('入れ替え済みで再起動を押すと起ち上げ直しを頼む', async () => {
    // Arrange
    開く('installed')
    render(<UpdateDialog />)

    // Act
    await userEvent.click(screen.getByRole('button', { name: '再起動' }))

    // Assert
    expect(fake.calls).toEqual(['restart'])
  })

  it('失敗したらメッセージをそのまま出す', () => {
    // Arrange
    開く('failed', { error: 'signature verification failed' })

    // Act
    render(<UpdateDialog />)

    // Assert
    expect(screen.getByRole('dialog', { name: 'アップデートに失敗しました' })).toHaveTextContent(
      'signature verification failed',
    )
  })
})
