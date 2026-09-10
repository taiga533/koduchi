/**
 * 第三者ソフトウェアの著作権表示（THIRD-PARTY-NOTICES.md）を組み立てる純粋な関数。
 *
 * MIT / Apache-2.0 / BSD / OFL はいずれも「著作権表示を複製に含めること」を求めており、
 * これはソースだけでなく**バイナリの配布にも掛かる**。dmg に同梱するための一覧を作る。
 * ファイルの読み取りとコマンドの実行は generate-third-party-notices.ts が受け持つ。
 */

/** package.json / Cargo.toml から読み取った 1 つのパッケージ。 */
export type PackageMeta = {
  /** パッケージ名。 */
  name: string
  /** 版。 */
  version: string
  /** SPDX のライセンス式。読み取れなかったときは null。 */
  license: string | null
  /** 依存しているパッケージの名前。npm の本番依存だけを辿るために使う。 */
  dependencies: string[]
}

/** 出力に載せる 1 件。 */
export type NoticeEntry = {
  /** 由来。見出しを分けるために使う。 */
  ecosystem: 'npm' | 'cargo' | 'asset'
  name: string
  version: string
  license: string | null
  /** ライセンス全文。パッケージに同梱されていなければ null。 */
  text: string | null
}

/**
 * 本番依存の閉包を求める。
 *
 * 開発用の依存（vitest や oxlint）は配布物に入らないため載せない。root から
 * `dependencies` だけを辿り、たどり着いたものを名前順で返す。見つからない名前は
 * 黙って飛ばす（省略可能な依存や、プラットフォームの違いで入っていないもの）。
 */
export function collectClosure(roots: string[], packages: Map<string, PackageMeta>): string[] {
  const found = new Set<string>()
  const queue = [...roots]

  while (queue.length > 0) {
    const name = queue.shift() as string
    if (found.has(name)) continue
    const meta = packages.get(name)
    if (meta === undefined) continue
    found.add(name)
    queue.push(...meta.dependencies)
  }

  // `slice()` で複製しているので元の配列は壊れない（`toSorted` は tsconfig の lib（ES2022）に無い）。
  // oxlint-disable-next-line unicorn/no-array-sort
  return [...found].slice().sort((a, b) => a.localeCompare(b))
}

/** 文書として読める拡張子。これ以外が付いていればソースコードとみなす。 */
const DOCUMENT_EXTENSION = /\.(md|txt|rst)$/i

/**
 * ライセンス全文が入っていそうなファイル名の見分け。
 *
 * 版番号の点だけを受け（`LICENSE-APACHE-2.0`）、それ以外の拡張子は受けない。
 * `license-info.js` のようなソースコードを全文として載せないためである。
 */
const LICENSE_FILE = /^(licen[cs]e|copying|notice|unlicense)([-_][A-Za-z0-9-]*(\.\d+)*)?$/i

/**
 * ファイル名がライセンス全文のものかを判定する。
 *
 * # 引数
 *
 * * `name` - パッケージのディレクトリにあるファイルの名前
 */
export function isLicenseFile(name: string): boolean {
  return LICENSE_FILE.test(name.replace(DOCUMENT_EXTENSION, ''))
}

/**
 * パッケージのディレクトリにあるファイル名から、ライセンス全文のものを名前順で選ぶ。
 *
 * `LICENSE-APACHE` と `LICENSE-MIT` のように二重ライセンスのクレートは複数を持つため、
 * **当たったものはすべて返す**（片方だけ載せると、選べるはずの条件が消える）。
 */
export function selectLicenseFiles(fileNames: string[]): string[] {
  // `slice()` で複製しているので元の配列は壊れない（`toSorted` は tsconfig の lib（ES2022）に無い）。
  // oxlint-disable-next-line unicorn/no-array-sort
  return (
    fileNames
      .filter((name) => isLicenseFile(name))
      .slice()
      // oxlint-disable-next-line unicorn/no-array-sort
      .sort((a, b) => a.localeCompare(b))
  )
}

/** 見出しに出す由来の名前。 */
const ECOSYSTEM_LABEL: Record<NoticeEntry['ecosystem'], string> = {
  asset: '同梱している資産',
  npm: 'npm パッケージ',
  cargo: 'Rust クレート',
}

/** 見出しの並び。 */
const ECOSYSTEM_ORDER: NoticeEntry['ecosystem'][] = ['asset', 'npm', 'cargo']

/**
 * 一覧を Markdown へ組み立てる。
 *
 * 由来ごとに見出しを分け、その中は名前順に並べる。ライセンス全文が拾えなかった
 * ものは SPDX の識別子だけを載せ、**拾えなかったことを明記する**（黙って落とすと
 * 義務を果たしたかどうかが読んで分からなくなる）。
 */
export function renderNotices(entries: NoticeEntry[], generatedFrom: string): string {
  const lines: string[] = [
    '# 第三者ソフトウェアの著作権表示',
    '',
    'このファイルは `bun run notices` が生成する。**手で編集しない。**',
    '',
    `小槌（koduchi）は以下のソフトウェアを同梱している。それぞれのライセンスは小槌自身の [\`LICENSE\`](LICENSE) とは別であり、小槌のライセンスはこれらの権利を制限しない。`,
    '',
    `生成元: ${generatedFrom}`,
    '',
  ]

  for (const ecosystem of ECOSYSTEM_ORDER) {
    const inGroup = entries
      .filter((entry) => entry.ecosystem === ecosystem)
      .slice()
      // oxlint-disable-next-line unicorn/no-array-sort
      .sort((a, b) => a.name.localeCompare(b.name))
    if (inGroup.length === 0) continue

    lines.push(`## ${ECOSYSTEM_LABEL[ecosystem]}（${inGroup.length} 件）`, '')

    for (const entry of inGroup) {
      lines.push(`### ${entry.name} ${entry.version}`, '')
      lines.push(`SPDX: ${entry.license ?? '（記載なし）'}`, '')
      if (entry.text === null) {
        lines.push(
          '> ライセンス全文はパッケージに同梱されていない。上の SPDX 識別子から原文を参照すること。',
          '',
        )
      } else {
        lines.push('```text', entry.text.trimEnd(), '```', '')
      }
    }
  }

  return lines.join('\n')
}
