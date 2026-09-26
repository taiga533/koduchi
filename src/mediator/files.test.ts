import { afterEach, describe, expect, it } from 'vitest'
import { resetDbApi, setDbApi } from '../api/db'
import { resetDialogApi, setDialogApi } from '../api/dialog'
import { createFakeDbApi } from '../test/fakeDbApi'
import { createFakeDialogApi } from '../test/fakeDialogApi'
import { SQLタブを一枚にする } from '../test/activeConnection'
import { selectActiveSqlTab, useTabStore } from '../stores/tab'
import { openSqlFile, saveActiveTab } from './files'

afterEach(() => {
  resetDbApi()
  resetDialogApi()
})

describe('saveActiveTab', () => {
  it('保存先が決まっていれば尋ねずに書き、保存済みにする', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    const dialog = createFakeDialogApi()
    setDialogApi(dialog.api)
    SQLタブを一枚にする({ filePath: '/tmp/a.sql', content: 'select 1 from dual', dirty: true })

    // Act
    await saveActiveTab()

    // Assert
    expect(dialog.calls.save).toEqual([])
    expect(calls.writeTextFile).toEqual([{ path: '/tmp/a.sql', content: 'select 1 from dual' }])
    expect(selectActiveSqlTab(useTabStore.getState())?.dirty).toBe(false)
  })

  it('保存先が無ければタブの名前を既定にして選ばせる', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    const dialog = createFakeDialogApi({ savePath: '/tmp/users.sql' })
    setDialogApi(dialog.api)
    SQLタブを一枚にする({ content: 'select 1 from dual', dirty: true })

    // Act
    await saveActiveTab()

    // Assert
    expect(dialog.calls.save[0].defaultPath).toBe('無題-1.sql')
    expect(calls.writeTextFile).toEqual([{ path: '/tmp/users.sql', content: 'select 1 from dual' }])
    expect(selectActiveSqlTab(useTabStore.getState())?.filePath).toBe('/tmp/users.sql')
  })

  it('保存先を選ばずに閉じたら書かない', async () => {
    // Arrange
    const { api, calls } = createFakeDbApi()
    setDbApi(api)
    setDialogApi(createFakeDialogApi({ savePath: null }).api)
    SQLタブを一枚にする({ content: 'select 1 from dual', dirty: true })

    // Act
    await saveActiveTab()

    // Assert
    expect(calls.writeTextFile).toEqual([])
    expect(selectActiveSqlTab(useTabStore.getState())?.dirty).toBe(true)
  })
})

describe('openSqlFile', () => {
  it('選んだファイルを新しいタブで開く', async () => {
    // Arrange
    const { api } = createFakeDbApi()
    setDbApi({ ...api, readTextFile: async () => 'select 1 from dual' })
    setDialogApi(createFakeDialogApi({ openPath: '/tmp/users.sql' }).api)
    SQLタブを一枚にする()

    // Act
    await openSqlFile()

    // Assert
    const tab = selectActiveSqlTab(useTabStore.getState())
    expect(tab?.filePath).toBe('/tmp/users.sql')
    expect(tab?.content).toBe('select 1 from dual')
  })

  it('選ばずに閉じたら何も開かない', async () => {
    // Arrange
    setDbApi(createFakeDbApi().api)
    setDialogApi(createFakeDialogApi({ openPath: null }).api)
    SQLタブを一枚にする()

    // Act
    await openSqlFile()

    // Assert
    expect(useTabStore.getState().tabs).toHaveLength(1)
  })
})
