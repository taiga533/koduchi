import { describe, expect, it } from 'vitest'

import {
  collectClosure,
  renderNotices,
  selectLicenseFiles,
  type NoticeEntry,
  type PackageMeta,
} from './thirdPartyNotices.ts'

/** テスト用のパッケージ表を作る。 */
function packagesOf(entries: Record<string, string[]>): Map<string, PackageMeta> {
  return new Map(
    Object.entries(entries).map(([name, dependencies]) => [
      name,
      { name, version: '1.0.0', license: 'MIT', dependencies },
    ]),
  )
}

describe('collectClosure', () => {
  it('推移的な依存まで辿って名前順で返す', () => {
    // Arrange
    const packages = packagesOf({ react: ['scheduler'], scheduler: [], vitest: [] })

    // Act
    const actual = collectClosure(['react'], packages)

    // Assert
    expect(actual).toEqual(['react', 'scheduler'])
  })

  it('本番依存に入っていないパッケージは載せない', () => {
    // Arrange
    const packages = packagesOf({ react: [], vitest: [] })

    // Act
    const actual = collectClosure(['react'], packages)

    // Assert
    expect(actual).not.toContain('vitest')
  })

  it('表に無い名前は飛ばす', () => {
    // Arrange
    const packages = packagesOf({ react: ['fsevents'] })

    // Act
    const actual = collectClosure(['react'], packages)

    // Assert
    expect(actual).toEqual(['react'])
  })

  it('依存が循環していても止まる', () => {
    // Arrange
    const packages = packagesOf({ a: ['b'], b: ['a'] })

    // Act
    const actual = collectClosure(['a'], packages)

    // Assert
    expect(actual).toEqual(['a', 'b'])
  })
})

describe('selectLicenseFiles', () => {
  it('ライセンス全文のファイルだけを拾う', () => {
    // Arrange
    const names = ['index.js', 'LICENSE', 'package.json', 'README.md']

    // Act
    const actual = selectLicenseFiles(names)

    // Assert
    expect(actual).toEqual(['LICENSE'])
  })

  it('綴りと拡張子の揺れを受ける', () => {
    // Arrange
    const names = ['LICENCE.md', 'COPYING', 'NOTICE.txt', 'UNLICENSE', 'licence-info.js']

    // Act
    const actual = selectLicenseFiles(names)

    // Assert
    expect(actual).toEqual(['COPYING', 'LICENCE.md', 'NOTICE.txt', 'UNLICENSE'])
  })

  it('二重ライセンスのクレートでは両方を返す', () => {
    // Arrange
    const names = ['LICENSE-APACHE', 'LICENSE-MIT', 'src']

    // Act
    const actual = selectLicenseFiles(names)

    // Assert
    expect(actual).toEqual(['LICENSE-APACHE', 'LICENSE-MIT'])
  })
})

/** 出力を確かめるための 1 件を作る。 */
function entry(over: Partial<NoticeEntry>): NoticeEntry {
  return {
    ecosystem: 'npm',
    name: 'react',
    version: '19.0.0',
    license: 'MIT',
    text: 'MIT License\n\nCopyright (c) Meta',
    ...over,
  }
}

describe('renderNotices', () => {
  it('由来ごとに見出しを分けて件数を添える', () => {
    // Arrange
    const entries = [entry({}), entry({ ecosystem: 'cargo', name: 'serde', version: '1.0.0' })]

    // Act
    const actual = renderNotices(entries, 'テスト')

    // Assert
    expect(actual).toContain('## npm パッケージ（1 件）')
    expect(actual).toContain('## Rust クレート（1 件）')
  })

  it('1 件も無い由来の見出しは出さない', () => {
    // Arrange
    const entries = [entry({})]

    // Act
    const actual = renderNotices(entries, 'テスト')

    // Assert
    expect(actual).not.toContain('Rust クレート')
  })

  it('ライセンス全文をそのまま載せる', () => {
    // Arrange
    const entries = [entry({ text: 'MIT License\n\nCopyright (c) Meta' })]

    // Act
    const actual = renderNotices(entries, 'テスト')

    // Assert
    expect(actual).toContain('Copyright (c) Meta')
  })

  it('全文が拾えなかったものは黙って落とさず、その旨を書く', () => {
    // Arrange
    const entries = [entry({ text: null })]

    // Act
    const actual = renderNotices(entries, 'テスト')

    // Assert
    expect(actual).toContain('ライセンス全文はパッケージに同梱されていない')
  })

  it('SPDX の記載が無いものはそう書く', () => {
    // Arrange
    const entries = [entry({ license: null })]

    // Act
    const actual = renderNotices(entries, 'テスト')

    // Assert
    expect(actual).toContain('SPDX: （記載なし）')
  })

  it('名前順に並べる', () => {
    // Arrange
    const entries = [entry({ name: 'zod' }), entry({ name: 'react' })]

    // Act
    const actual = renderNotices(entries, 'テスト')

    // Assert
    expect(actual.indexOf('### react')).toBeLessThan(actual.indexOf('### zod'))
  })
})
