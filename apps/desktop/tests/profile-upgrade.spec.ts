/** Upgrade of a Desktop profile created by an earlier dsh installation. */

import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createPluginProfile } from '../src/project-manager.ts'

const FISH_BUNDLE = '@mydearfish/dsh-fish-bundle'
const STOCK_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

function readManifest(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<string, unknown>
}

it('appends the fish bundle to an existing stock profile without touching other fields', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-upgrade-'))
  try {
    const profileDir = join(home, 'profiles', 'desktop')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
      name: 'dsh-profile-desktop',
      private: true,
      custom: { keep: true },
      dsh: { profile: { bundles: STOCK_BUNDLES } },
    }, undefined, 2)}\n`)
    writeFileSync(join(profileDir, 'cordis.patch.yml'), '# 用户自己的层\n')

    createPluginProfile(profileDir)

    const upgraded = readManifest(profileDir)
    expect(upgraded.custom).toEqual({ keep: true })
    expect((upgraded.dsh as { profile: { bundles: string[] } }).profile.bundles).toEqual([
      ...STOCK_BUNDLES,
      FISH_BUNDLE,
    ])
    expect(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')).toBe('# 用户自己的层\n')
    expect(existsSync(join(profileDir, '.fish-bundle-migrated'))).toBe(true)

    createPluginProfile(profileDir)
    expect((readManifest(profileDir).dsh as { profile: { bundles: string[] } }).profile.bundles).toEqual([
      ...STOCK_BUNDLES,
      FISH_BUNDLE,
    ])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

it('leaves a profile sanitized for recovery alone on the next launch', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-recovery-'))
  try {
    const profileDir = join(home, 'profiles', 'desktop')
    mkdirSync(profileDir, { recursive: true })
    createPluginProfile(profileDir)

    // disableAllPlugins() rewrites the bundle list to the stock web profile.
    const reset = readManifest(profileDir)
    ;(reset.dsh as { profile: { bundles: string[] } }).profile.bundles = [...STOCK_BUNDLES]
    writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify(reset, undefined, 2)}\n`)

    createPluginProfile(profileDir)
    expect((readManifest(profileDir).dsh as { profile: { bundles: string[] } }).profile.bundles).toEqual(STOCK_BUNDLES)

    // Deleting the one-shot marker is the manual way back into the fish UI.
    rmSync(join(profileDir, '.fish-bundle-migrated'))
    createPluginProfile(profileDir)
    expect((readManifest(profileDir).dsh as { profile: { bundles: string[] } }).profile.bundles).toEqual([
      ...STOCK_BUNDLES,
      FISH_BUNDLE,
    ])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

it('repairs a desktop profile that has no bundle list', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-upgrade-empty-'))
  try {
    const profileDir = join(home, 'profiles', 'desktop')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({ name: 'dsh-profile-desktop' }, undefined, 2)}\n`)

    createPluginProfile(profileDir)

    expect((readManifest(profileDir).dsh as { profile: { bundles: string[] } }).profile.bundles).toEqual([
      ...STOCK_BUNDLES,
      FISH_BUNDLE,
    ])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
