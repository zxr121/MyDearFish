/** Copy the in-repo fish bundle and its six plugins into the prepared Desktop runtime. */

import { cpSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..', '..', '..')
const FISH_ROOT = join(REPOSITORY_ROOT, 'fish')
const BUNDLE_SOURCE = join(FISH_ROOT, 'bundle')
const BUNDLE_NAME = '@mydearfish/dsh-fish-bundle'
const PLUGIN_NAMES = [
  'dsh-fish-mind',
  'dsh-feiyu-mood',
  'dsh-speak-up',
  'dsh-tts-bridge',
  'dsh-qq-bridge',
  'dsh-bili-subagent',
] as const

/** Runtime files that must survive the copy; a plugin that cannot mount fails the build, not the first launch. */
function assertPackage(directory: string, expectedName: string, main?: string): void {
  const manifestPath = join(directory, 'package.json')
  if (!existsSync(manifestPath)) throw new Error(`fish runtime: ${directory} has no package.json`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: string; main?: string }
  if (manifest.name !== expectedName) {
    throw new Error(`fish runtime: ${directory} declares ${String(manifest.name)}, expected ${expectedName}`)
  }
  const entry = main ?? manifest.main
  if (entry !== undefined && !existsSync(join(directory, entry))) {
    throw new Error(`fish runtime: ${expectedName} is missing its entry ${entry}`)
  }
}

function install(source: string, destination: string, expectedName: string, main?: string): void {
  assertPackage(source, expectedName, main)
  rmSync(destination, { recursive: true, force: true })
  cpSync(source, destination, {
    recursive: true,
    filter: (path) => {
      const name = path.split(/[\\/]/u).at(-1)
      return name !== '.git' && name !== 'node_modules' && name !== 'tests' && name !== '.github'
    },
  })
}

/**
 * Install the fish bundle and every plugin package into a materialized runtime.
 * @param modules - absolute `node_modules` directory of the prepared runtime.
 */
export function installFishRuntime(modules: string): void {
  install(BUNDLE_SOURCE, join(modules, ...BUNDLE_NAME.split('/')), BUNDLE_NAME)
  const versions: Record<string, string> = {}
  for (const name of PLUGIN_NAMES) {
    const destination = join(modules, name)
    install(join(FISH_ROOT, 'plugins', name), destination, name)
    versions[name] = (JSON.parse(readFileSync(join(destination, 'package.json'), 'utf8')) as { version: string }).version
  }
  versions[BUNDLE_NAME] = (JSON.parse(readFileSync(join(modules, ...BUNDLE_NAME.split('/'), 'package.json'), 'utf8')) as { version: string }).version
  // Loader entries resolve from the profile; the installation-scope table routes a
  // bare name back to this tree only when it is declared here.
  const dshManifestPath = join(modules, '@deepseek-ai', 'dsh', 'package.json')
  if (!existsSync(dshManifestPath)) throw new Error(`fish runtime: ${dshManifestPath} is missing`)
  const dshManifest = JSON.parse(readFileSync(dshManifestPath, 'utf8')) as { dependencies?: Record<string, string> }
  dshManifest.dependencies = { ...dshManifest.dependencies, ...versions }
  writeFileSync(dshManifestPath, `${JSON.stringify(dshManifest, undefined, 2)}\n`)
}
