/**
 * THIRD-PARTY-NOTICES.md を生成する。
 *
 *     bun run notices
 *
 * npm は package.json の `dependencies` から本番依存の閉包を辿り、Rust は
 * `cargo tree -e normal` が示す実際にリンクされるクレートを拾う。書体のように
 * 依存関係の外で同梱している資産は ASSETS に手で並べる。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  collectClosure,
  renderNotices,
  selectLicenseFiles,
  type NoticeEntry,
  type PackageMeta,
} from './thirdPartyNotices.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 依存関係の外で配布物に同梱しているもの。 */
const ASSETS: { name: string; version: string; license: string; path: string }[] = [
  {
    name: 'PlemolJP',
    version: '3.1.0',
    license: 'OFL-1.1',
    path: 'src/assets/fonts/LICENSE.txt',
  },
]

/**
 * ディレクトリからライセンス全文を読む。見つからなければ null を返す。
 */
function readLicenseText(directory: string): string | null {
  if (!existsSync(directory)) return null
  const names = selectLicenseFiles(
    readdirSync(directory).filter((name) => statSync(join(directory, name)).isFile()),
  )
  if (names.length === 0) return null
  return names
    .map((name) => `--- ${name} ---\n\n${readFileSync(join(directory, name), 'utf8')}`)
    .join('\n\n')
    .trimEnd()
}

/** SPDX のライセンス式を文字列にする。npm は配列で書かれている古い書式もある。 */
function licenseExpression(raw: unknown): string | null {
  if (typeof raw === 'string') return raw
  if (raw !== null && typeof raw === 'object' && 'type' in raw) {
    return String((raw as { type: unknown }).type)
  }
  if (Array.isArray(raw)) {
    return (
      raw
        .map((entry) => licenseExpression(entry))
        .filter(Boolean)
        .join(' OR ') || null
    )
  }
  return null
}

/** node_modules を走査して、名前からパッケージを引ける表を作る。 */
function readNpmPackages(): Map<string, PackageMeta & { directory: string }> {
  const packages = new Map<string, PackageMeta & { directory: string }>()
  const modules = join(ROOT, 'node_modules')

  const directories: string[] = []
  for (const name of readdirSync(modules)) {
    if (name.startsWith('.')) continue
    const path = join(modules, name)
    if (!statSync(path).isDirectory()) continue
    if (name.startsWith('@')) {
      for (const scoped of readdirSync(path)) directories.push(join(path, scoped))
    } else {
      directories.push(path)
    }
  }

  for (const directory of directories) {
    const manifest = join(directory, 'package.json')
    if (!existsSync(manifest)) continue
    const json = JSON.parse(readFileSync(manifest, 'utf8'))
    if (typeof json.name !== 'string') continue
    packages.set(json.name, {
      name: json.name,
      version: String(json.version ?? '0.0.0'),
      license: licenseExpression(json.license ?? json.licenses),
      dependencies: Object.keys(json.dependencies ?? {}),
      directory,
    })
  }

  return packages
}

/** 配布物に入る npm パッケージを集める。 */
function npmEntries(): NoticeEntry[] {
  const rootManifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const packages = readNpmPackages()
  const names = collectClosure(Object.keys(rootManifest.dependencies ?? {}), packages)

  return names.map((name) => {
    const meta = packages.get(name) as PackageMeta & { directory: string }
    return {
      ecosystem: 'npm' as const,
      name: meta.name,
      version: meta.version,
      license: meta.license,
      text: readLicenseText(meta.directory),
    }
  })
}

/** 配布物に入る Rust クレートを集める。 */
function cargoEntries(): NoticeEntry[] {
  const tauri = join(ROOT, 'src-tauri')

  // 実際にリンクされるものだけを見る（dev-dependencies と build-dependencies を外す）。
  const tree = execFileSync(
    'cargo',
    ['tree', '-e', 'normal', '--prefix', 'none', '--format', '{p}'],
    {
      cwd: tauri,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  )

  const linked = new Set<string>()
  for (const line of tree.split('\n')) {
    const matched = /^([A-Za-z0-9_.-]+) v([^\s]+)/.exec(line.trim())
    if (matched === null) continue
    linked.add(`${matched[1]} ${matched[2]}`)
  }

  const metadata = JSON.parse(
    execFileSync('cargo', ['metadata', '--format-version', '1'], {
      cwd: tauri,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    }),
  )

  const entries: NoticeEntry[] = []
  for (const pkg of metadata.packages) {
    const key = `${pkg.name} ${pkg.version}`
    if (!linked.has(key)) continue
    if (pkg.name === 'koduchi') continue
    entries.push({
      ecosystem: 'cargo',
      name: pkg.name,
      version: pkg.version,
      license: pkg.license ?? null,
      text: readLicenseText(dirname(pkg.manifest_path)),
    })
  }

  return entries
}

/** 依存関係の外で同梱している資産を集める。 */
function assetEntries(): NoticeEntry[] {
  return ASSETS.map((asset) => ({
    ecosystem: 'asset' as const,
    name: asset.name,
    version: asset.version,
    license: asset.license,
    text: readFileSync(join(ROOT, asset.path), 'utf8').trimEnd(),
  }))
}

const entries = [...assetEntries(), ...npmEntries(), ...cargoEntries()]
const output = renderNotices(entries, 'package.json の dependencies と cargo tree -e normal')
writeFileSync(join(ROOT, 'THIRD-PARTY-NOTICES.md'), `${output}\n`, 'utf8')

process.stdout.write(`THIRD-PARTY-NOTICES.md を書き出した（${entries.length} 件）\n`)
