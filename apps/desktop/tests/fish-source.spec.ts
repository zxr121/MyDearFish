/** Packaged fish source seeding, upgrade merge, and profile synchronization. */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { expect, it } from 'vitest'
import {
  EDITABLE_FISH_FILES,
  FISH_PROFILE_STAMP,
  FISH_SOURCE_MANIFEST,
  ensureFishSource,
  syncFishPlugins,
} from '../src/fish-source.ts'

const FISH_BUNDLE = '@mydearfish/dsh-fish-bundle'

function write(root: string, file: string, content: string): void {
  const path = join(root, ...file.split('/'))
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function read(root: string, file: string): string {
  return readFileSync(join(root, ...file.split('/')), 'utf8')
}

function makePristine(root: string): string {
  const pristine = join(root, 'pristine')
  write(pristine, 'fish/bundle/package.json', `${JSON.stringify({ name: FISH_BUNDLE })}\n`)
  write(pristine, 'fish/bundle/cordis.patch.yml', '# persona v1\n')
  write(pristine, 'fish/plugins/dsh-fish-mind/package.json', `${JSON.stringify({ name: 'dsh-fish-mind', main: 'lib/index.js' })}\n`)
  write(pristine, 'fish/plugins/dsh-fish-mind/lib/index.js', 'export const index = 1\n')
  write(pristine, 'fish/plugins/dsh-fish-mind/lib/tendency.js', 'export const rule = 1\n')
  write(pristine, 'fish/plugins/dsh-fish-mind/lib/permissions.js', 'export const permissions = 1\n')
  write(pristine, 'fish/plugins/dsh-fish-mind/client.js', 'export const client = 1\n')
  write(pristine, 'fish/plugins/dsh-fish-mind/tests/plugin.test.mjs', '// test v1\n')
  write(pristine, 'fish/plugins/dsh-qq-bridge/package.json', `${JSON.stringify({ name: 'dsh-qq-bridge', main: 'lib/host.js' })}\n`)
  write(pristine, 'fish/plugins/dsh-qq-bridge/lib/host.js', 'export const host = 1\n')
  write(pristine, 'fish/plugins/dsh-qq-bridge/lib/snowluma.js', 'export const snow = 1\n')
  return pristine
}

function makeProfile(root: string, bundles = [FISH_BUNDLE]): string {
  const profile = join(root, 'data', 'profiles', 'desktop')
  write(profile, 'package.json', `${JSON.stringify({
    name: 'dsh-profile-desktop',
    private: true,
    custom: { keep: true },
    dependencies: { other: '1.0.0' },
    dsh: { profile: { bundles } },
  }, undefined, 2)}\n`)
  return profile
}

function makeHome(root: string): string {
  return join(root, 'data')
}

it('seeds the editable checkout and records every pristine hash', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-fish-source-'))
  try {
    const pristine = makePristine(root)
    const home = makeHome(root)
    const state = ensureFishSource({ pristine, home, version: '1.2.3', now: Date.UTC(2026, 10, 3) })
    expect(state.warnings).toEqual([])
    expect(read(state.sourceRoot, 'fish/plugins/dsh-fish-mind/lib/tendency.js')).toBe('export const rule = 1\n')
    expect(
      existsSync(join(state.sourceRoot, 'fish', 'plugins', 'dsh-fish-mind', 'tests', 'plugin.test.mjs')),
      'tests stay in the editable checkout',
    ).toBe(true)
    expect(existsSync(join(state.sourceRoot, 'FISH-SOURCE.md'))).toBe(true)
    const manifest = JSON.parse(read(state.sourceRoot, FISH_SOURCE_MANIFEST)) as {
      version: string
      pristine: Record<string, string>
      editable: string[]
    }
    expect(manifest.version).toBe('1.2.3')
    expect(Object.keys(manifest.pristine)).toContain('fish/plugins/dsh-fish-mind/lib/tendency.js')
    expect(manifest.editable).toEqual([...EDITABLE_FISH_FILES])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it('updates untouched files on upgrade and keeps edited files', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-fish-source-upgrade-'))
  try {
    const pristine = makePristine(root)
    const home = makeHome(root)
    const seeded = ensureFishSource({ pristine, home, version: '1.0.0' })
    write(seeded.sourceRoot, 'fish/plugins/dsh-fish-mind/lib/tendency.js', 'export const rule = 99\n')

    write(pristine, 'fish/plugins/dsh-fish-mind/lib/tendency.js', 'export const rule = 2\n')
    write(pristine, 'fish/plugins/dsh-fish-mind/tests/plugin.test.mjs', '// test v2\n')
    write(pristine, 'fish/plugins/dsh-fish-mind/lib/extra.js', 'export const extra = 2\n')
    write(pristine, 'fish/bundle/cordis.patch.yml', '# persona v2\n')
    rmSync(join(pristine, 'fish', 'plugins', 'dsh-qq-bridge', 'lib', 'snowluma.js'))

    const upgraded = ensureFishSource({ pristine, home, version: '2.0.0' })
    expect(read(upgraded.sourceRoot, 'fish/plugins/dsh-fish-mind/lib/tendency.js')).toBe('export const rule = 99\n')
    expect(read(upgraded.sourceRoot, 'fish/plugins/dsh-fish-mind/tests/plugin.test.mjs')).toBe('// test v2\n')
    expect(read(upgraded.sourceRoot, 'fish/plugins/dsh-fish-mind/lib/extra.js')).toBe('export const extra = 2\n')
    expect(read(upgraded.sourceRoot, 'fish/bundle/cordis.patch.yml')).toBe('# persona v2\n')
    expect(existsSync(join(upgraded.sourceRoot, 'fish', 'plugins', 'dsh-qq-bridge', 'lib', 'snowluma.js'))).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it('restores kernel files, keeps a backup, and recreates a missing manifest', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-fish-source-kernel-'))
  try {
    const pristine = makePristine(root)
    const home = makeHome(root)
    const seeded = ensureFishSource({ pristine, home, version: '1.0.0' })
    write(seeded.sourceRoot, 'fish/plugins/dsh-fish-mind/lib/permissions.js', 'export const permissions = 0\n')
    write(seeded.sourceRoot, 'fish/plugins/dsh-fish-mind/lib/tendency.js', 'export const rule = 99\n')
    rmSync(join(seeded.sourceRoot, FISH_SOURCE_MANIFEST))

    const repaired = ensureFishSource({ pristine, home, version: '1.0.0' })
    expect(read(repaired.sourceRoot, 'fish/plugins/dsh-fish-mind/lib/permissions.js')).toBe('export const permissions = 1\n')
    expect(read(repaired.sourceRoot, 'fish/plugins/dsh-fish-mind/lib/tendency.js')).toBe('export const rule = 99\n')
    const backups = readdirSync(join(repaired.sourceRoot, '.kernel-backup'))
    expect(backups.length).toBe(1)
    expect(read(repaired.sourceRoot, `.kernel-backup/${backups[0]}/fish/plugins/dsh-fish-mind/lib/permissions.js`))
      .toBe('export const permissions = 0\n')
    expect(existsSync(join(repaired.sourceRoot, FISH_SOURCE_MANIFEST))).toBe(true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it('skips symlinked files without writing through them', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-fish-source-link-'))
  try {
    const pristine = makePristine(root)
    const home = makeHome(root)
    const seeded = ensureFishSource({ pristine, home, version: '1.0.0' })
    const target = join(root, 'outside.js')
    writeFileSync(target, 'export const outside = 1\n')
    const link = join(seeded.checkout, 'plugins', 'dsh-fish-mind', 'lib', 'linked.js')
    try {
      symlinkSync(target, link, 'file')
    } catch (error) {
      // Windows without developer mode cannot create file symlinks; the branch is covered elsewhere.
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return
      throw error
    }
    write(pristine, 'fish/plugins/dsh-fish-mind/lib/linked.js', 'export const linked = 2\n')
    const again = ensureFishSource({ pristine, home, version: '2.0.0' })
    expect(again.warnings.some(warning => warning.includes('符号链接'))).toBe(true)
    expect(readFileSync(target, 'utf8')).toBe('export const outside = 1\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it('copies editable plugins into the profile and declares file dependencies', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-fish-sync-'))
  try {
    const pristine = makePristine(root)
    const home = makeHome(root)
    const seeded = ensureFishSource({ pristine, home, version: '1.0.0' })
    const profile = makeProfile(root)
    const result = syncFishPlugins({ home, profileDir: profile, sourceRoot: seeded.sourceRoot, nodeExecutable: process.execPath })
    expect(result.warnings).toEqual([])
    expect([...result.synced].sort()).toEqual(['dsh-fish-mind', 'dsh-qq-bridge'])
    expect(read(profile, 'node_modules/dsh-fish-mind/lib/tendency.js')).toBe('export const rule = 1\n')
    expect(existsSync(join(profile, 'node_modules', 'dsh-fish-mind', 'tests'))).toBe(false)
    const manifest = JSON.parse(read(profile, 'package.json')) as {
      custom: Record<string, unknown>
      dependencies: Record<string, string>
      dsh: { profile: { bundles: string[] } }
    }
    expect(manifest.custom).toEqual({ keep: true })
    expect(manifest.dependencies.other).toBe('1.0.0')
    expect(manifest.dependencies['dsh-fish-mind']).toBe('file:../../fish-src/fish/plugins/dsh-fish-mind')
    expect(manifest.dependencies['dsh-qq-bridge']).toBe('file:../../fish-src/fish/plugins/dsh-qq-bridge')
    expect(manifest.dsh.profile.bundles).toEqual([FISH_BUNDLE])
    expect(existsSync(join(profile, FISH_PROFILE_STAMP))).toBe(true)

    write(seeded.sourceRoot, 'fish/plugins/dsh-fish-mind/lib/tendency.js', 'export const rule = 3\n')
    const changed = syncFishPlugins({ home, profileDir: profile, sourceRoot: seeded.sourceRoot, nodeExecutable: process.execPath })
    expect(changed.warnings).toEqual([])
    expect(read(profile, 'node_modules/dsh-fish-mind/lib/tendency.js')).toBe('export const rule = 3\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it('keeps the previous profile copy when an edit has a syntax error', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-fish-sync-syntax-'))
  try {
    const pristine = makePristine(root)
    const home = makeHome(root)
    const seeded = ensureFishSource({ pristine, home, version: '1.0.0' })
    const profile = makeProfile(root)
    syncFishPlugins({ home, profileDir: profile, sourceRoot: seeded.sourceRoot, nodeExecutable: process.execPath })
    write(seeded.sourceRoot, 'fish/plugins/dsh-fish-mind/lib/tendency.js', 'export const = 1\n')
    const broken = syncFishPlugins({ home, profileDir: profile, sourceRoot: seeded.sourceRoot, nodeExecutable: process.execPath })
    expect(broken.warnings.some(warning => warning.includes('语法错误'))).toBe(true)
    expect(read(profile, 'node_modules/dsh-fish-mind/lib/tendency.js')).toBe('export const rule = 1\n')
    const warning = JSON.parse(read(seeded.sourceRoot, '.sync-warning.json')) as { warnings: string[] }
    expect(warning.warnings.some(item => item.includes('语法错误'))).toBe(true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it('falls back to the packaged plugins when the source disappears or the profile no longer wants fish', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-fish-sync-fallback-'))
  try {
    const pristine = makePristine(root)
    const home = makeHome(root)
    const seeded = ensureFishSource({ pristine, home, version: '1.0.0' })
    const profile = makeProfile(root)
    syncFishPlugins({ home, profileDir: profile, sourceRoot: seeded.sourceRoot, nodeExecutable: process.execPath })

    rmSync(join(seeded.sourceRoot, 'fish'), { recursive: true, force: true })
    const missing = syncFishPlugins({ home, profileDir: profile, sourceRoot: seeded.sourceRoot, nodeExecutable: process.execPath })
    expect(missing.warnings.some(warning => warning.includes('源码副本不存在'))).toBe(true)
    const manifest = JSON.parse(read(profile, 'package.json')) as { dependencies: Record<string, string> }
    expect(manifest.dependencies['dsh-fish-mind']).toBeUndefined()
    expect(manifest.dependencies['dsh-qq-bridge']).toBeUndefined()
    expect(existsSync(join(profile, 'node_modules', 'dsh-fish-mind', 'package.json'))).toBe(false)

    rmSync(seeded.sourceRoot, { recursive: true, force: true })
    ensureFishSource({ pristine, home, version: '1.0.0' })
    syncFishPlugins({ home, profileDir: profile, sourceRoot: seeded.sourceRoot, nodeExecutable: process.execPath })
    const stock = join(root, 'stock.json')
    writeFileSync(stock, `${JSON.stringify({
      name: 'dsh-profile-desktop',
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
    })}\n`)
    writeFileSync(join(profile, 'package.json'), readFileSync(stock))
    const recovered = syncFishPlugins({ home, profileDir: profile, sourceRoot: seeded.sourceRoot, nodeExecutable: process.execPath })
    expect(recovered.synced).toEqual([])
    const recoveredManifest = JSON.parse(read(profile, 'package.json')) as { dependencies: Record<string, string> }
    expect(recoveredManifest.dependencies?.['dsh-fish-mind']).toBeUndefined()
    expect(existsSync(join(profile, 'node_modules', 'dsh-fish-mind'))).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
