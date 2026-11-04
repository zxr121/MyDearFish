/** Packaged fish source copy: seeding, upgrade merge, kernel restore, and profile synchronization. */

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Directory under the Harness home holding the editable fish checkout. */
export const FISH_SOURCE_DIR = 'fish-src'
/** Manifest recording the shipped version and every pristine file hash. */
export const FISH_SOURCE_MANIFEST = '.fish-source.json'
/** Why the last profile synchronization kept the previous copies. */
export const FISH_SYNC_WARNING = '.sync-warning.json'
/** Per-profile record of the source hashes that produced the loaded copies. */
export const FISH_PROFILE_STAMP = '.fish-profile-sync.json'
/** Packages copied into the Desktop profile from the editable checkout. */
export const SYNCED_FISH_PLUGINS = ['dsh-fish-mind', 'dsh-qq-bridge'] as const
/** Checkout-relative files the owner may change and keep across restarts. */
export const EDITABLE_FISH_FILES: readonly string[] = [
  'fish/plugins/dsh-fish-mind/lib/tendency.js',
  'fish/plugins/dsh-fish-mind/lib/humor.js',
  'fish/plugins/dsh-fish-mind/lib/memes.js',
  'fish/plugins/dsh-fish-mind/lib/settings-catalog.js',
  'fish/plugins/dsh-fish-mind/lib/config-files.js',
  'fish/plugins/dsh-qq-bridge/lib/host.js',
  'fish/plugins/dsh-qq-bridge/lib/sticker-commands.js',
]

const SOURCE_FORMAT = 'mydearfish.fish-source'
const PROFILE_FORMAT = 'mydearfish.fish-profile-sync'
const FISH_BUNDLE = '@mydearfish/dsh-fish-bundle'
const SOURCE_README = 'FISH-SOURCE.md'
const KERNEL_BACKUP = '.kernel-backup'
const SKIPPED_NAMES = new Set(['node_modules', '.git', '.github'])
const RUNTIME_SKIPPED_NAMES = new Set([...SKIPPED_NAMES, 'tests'])
const ESM_EXTENSIONS = ['.js', '.mjs']

interface SourceManifest {
  readonly format?: string
  readonly version?: string
  readonly updatedAt?: number
  readonly pristine?: Record<string, string>
  readonly editable?: readonly string[]
}

interface ProfileStamp {
  readonly format?: string
  readonly sourceRoot?: string
  readonly packages: Record<string, { readonly hash?: string; readonly files?: Record<string, string> }>
}

interface WalkedFile {
  readonly path: string
  readonly relative: string
  readonly hash: string
}

/** Inputs for {@link ensureFishSource}. */
export interface FishSourceOptions {
  /** Packaged pristine resource directory; holds a `fish/` checkout. */
  readonly pristine: string
  /** Harness home that owns the editable copy. */
  readonly home: string
  /** Installed application version, recorded in the manifest and README. */
  readonly version: string
  /** Timestamp used for the backup directory name; defaults to the current time. */
  readonly now?: number
}

/** Result of {@link ensureFishSource}. */
export interface FishSourceState {
  /** `<home>/fish-src`, the creation-mode workspace. */
  readonly sourceRoot: string
  /** `<home>/fish-src/fish`, the checkout root. */
  readonly checkout: string
  /** Non-fatal problems that left the working copy untouched. */
  readonly warnings: readonly string[]
}

/** Inputs for {@link syncFishPlugins}. */
export interface FishSyncOptions {
  /** Harness home that owns the editable copy. */
  readonly home: string
  /** Desktop profile directory receiving the package copies. */
  readonly profileDir: string
  /** Editable source root; defaults to `<home>/fish-src`. */
  readonly sourceRoot?: string
  /** Node-compatible executable used for syntax checks; omitted disables them. */
  readonly nodeExecutable?: string
}

/** Result of {@link syncFishPlugins}. */
export interface FishSyncResult {
  /** Packages whose profile copy now matches the editable checkout. */
  readonly synced: readonly string[]
  /** Non-fatal problems; the previous profile copy stays active. */
  readonly warnings: readonly string[]
}

/** Resolve the editable source root under a Harness home. */
export function fishSourceRoot(home: string): string {
  return join(home, FISH_SOURCE_DIR)
}

/**
 * Seed or upgrade `<home>/fish-src` from the packaged pristine checkout.
 * Editable files keep owner changes; every other runtime file is restored from the
 * shipped copy so the safety kernel stays fixed. All failures are non-fatal.
 * @param options - pristine resource, Harness home, version, and timestamp.
 * @returns the working checkout and any warnings.
 */
export function ensureFishSource(options: FishSourceOptions): FishSourceState {
  const sourceRoot = fishSourceRoot(options.home)
  const checkout = join(sourceRoot, 'fish')
  const pristineCheckout = join(options.pristine, 'fish')
  const warnings: string[] = []
  if (!isFishCheckout(pristineCheckout)) {
    warnings.push('安装包没有带可编辑源码（resources/fish-src），创造模式只能继续给说明。')
    return { sourceRoot, checkout, warnings }
  }
  try {
    mkdirSync(sourceRoot, { recursive: true })
  } catch (error) {
    warnings.push(`建不了源码目录 ${sourceRoot}：${errorMessage(error)}`)
    return { sourceRoot, checkout, warnings }
  }
  const pristine = walkFiles(pristineCheckout, warnings, false)
    .map(file => ({ ...file, relative: `fish/${file.relative}` }))
  const previous = readSourceManifest(sourceRoot)?.pristine ?? {}
  const now = options.now ?? Date.now()
  const stamp = backupStamp(now)
  mergePristine(sourceRoot, pristine, previous, stamp, warnings)
  removeRemoved(sourceRoot, previous, pristine, stamp, warnings)
  try {
    writeSourceManifest(sourceRoot, options.version, now, pristine)
    writeSourceReadme(sourceRoot, options.version)
  } catch (error) {
    warnings.push(`写不了源码副本说明：${errorMessage(error)}`)
  }
  return { sourceRoot, checkout, warnings }
}

/**
 * Copy the editable plugins into the Desktop profile and declare them as profile dependencies.
 * A failed validation keeps the previous profile copy and records the reason in
 * `.sync-warning.json`; a missing checkout removes the dependencies this function added.
 * @param options - Harness home, profile directory, optional source root, and syntax-check executable.
 * @returns the synced package names and any warnings.
 */
export function syncFishPlugins(options: FishSyncOptions): FishSyncResult {
  const sourceRoot = options.sourceRoot ?? fishSourceRoot(options.home)
  const checkout = join(sourceRoot, 'fish')
  const warnings: string[] = []
  const synced: string[] = []
  const stampPath = join(options.profileDir, FISH_PROFILE_STAMP)
  const stamp = readProfileStamp(stampPath)
  if (!profileWantsFish(options.profileDir)) {
    // Recovery sanitizes bundles back to stock; do not resurrect plugins the profile no longer references.
    try {
      removeManagedProfilePackages(options.profileDir, stamp)
    } catch (error) {
      warnings.push(`清理恢复后的 profile 副本失败：${errorMessage(error)}`)
    }
    return { synced, warnings }
  }
  if (!isFishCheckout(checkout)) {
    try {
      removeManagedProfilePackages(options.profileDir, stamp)
    } catch (error) {
      warnings.push(`清理旧的 profile 副本失败：${errorMessage(error)}`)
    }
    const warning = '安装包源码副本不存在，继续使用安装包自带插件。'
    writeSyncWarning(sourceRoot, [warning, ...warnings])
    return { synced, warnings: [warning, ...warnings] }
  }
  for (const name of SYNCED_FISH_PLUGINS) {
    const sourceDir = join(checkout, 'plugins', name)
    const problem = validatePlugin(sourceDir, name)
    if (problem !== undefined) {
      warnings.push(problem)
      continue
    }
    const files = walkFiles(sourceDir, warnings, true)
    const hash = packageHash(files)
    const previous = stamp?.packages[name]
    const destination = join(options.profileDir, 'node_modules', name)
    if (previous?.hash === hash && existsSync(join(destination, 'package.json'))) {
      synced.push(name)
      continue
    }
    const syntax = options.nodeExecutable === undefined || previous === undefined
      ? undefined
      : checkSyntax(options.nodeExecutable, files, previous.files)
    if (syntax !== undefined) {
      warnings.push(`${name} 的改动没有同步：${syntax}`)
      continue
    }
    try {
      copyPackage(files, options.profileDir, name)
      synced.push(name)
    } catch (error) {
      warnings.push(`${name} 复制失败：${errorMessage(error)}`)
    }
  }
  if (synced.length > 0) {
    try {
      updateProfileDependencies(options.profileDir, synced, sourceRoot)
    } catch (error) {
      warnings.push(`profile 依赖没有写进去：${errorMessage(error)}`)
    }
  }
  try {
    writeProfileStamp(stampPath, sourceRoot, synced)
  } catch (error) {
    warnings.push(`同步记录没有写进去：${errorMessage(error)}`)
  }
  writeSyncWarning(sourceRoot, warnings)
  return { synced, warnings }
}

function isFishCheckout(root: string): boolean {
  return existsSync(join(root, 'bundle', 'package.json'))
    && existsSync(join(root, 'plugins', 'dsh-fish-mind', 'lib', 'index.js'))
}

function profileWantsFish(profileDir: string): boolean {
  try {
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as {
      dsh?: { profile?: { bundles?: unknown } }
    }
    const bundles = manifest.dsh?.profile?.bundles
    if (!Array.isArray(bundles)) return true
    return bundles.includes(FISH_BUNDLE)
  } catch {
    return true
  }
}

function walkFiles(root: string, warnings: string[], runtime: boolean): WalkedFile[] {
  const files: WalkedFile[] = []
  const skipped = runtime ? RUNTIME_SKIPPED_NAMES : SKIPPED_NAMES
  walk(root, root, files, warnings, skipped)
  return files
}

function walk(
  root: string,
  directory: string,
  files: WalkedFile[],
  warnings: string[],
  skipped: ReadonlySet<string>,
): void {
  let entries
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch (error) {
    warnings.push(`读不了 ${directory}：${errorMessage(error)}`)
    return
  }
  for (const entry of entries) {
    if (skipped.has(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) {
      warnings.push(`跳过符号链接 ${relative(root, path)}`)
      continue
    }
    if (entry.isDirectory()) {
      walk(root, path, files, warnings, skipped)
      continue
    }
    if (!entry.isFile()) continue
    const rel = toPosix(relative(root, path))
    if (rel.endsWith('.log')) continue
    try {
      files.push({ path, relative: rel, hash: hashFile(path) })
    } catch (error) {
      warnings.push(`读不了 ${path}：${errorMessage(error)}`)
    }
  }
}

function mergePristine(
  root: string,
  pristine: WalkedFile[],
  previous: Record<string, string>,
  stamp: string,
  warnings: string[],
): void {
  for (const file of pristine) {
    const destination = join(root, ...file.relative.split('/'))
    const guarded = isGuardedRuntimeFile(file.relative)
    const editable = isEditableFile(file.relative)
    if (!existsSync(destination)) {
      copyInto(file.path, destination, warnings)
      continue
    }
    if (!isWritableTarget(destination, warnings)) continue
    let current: string
    try {
      current = hashFile(destination)
    } catch (error) {
      warnings.push(`读不了 ${destination}：${errorMessage(error)}`)
      continue
    }
    if (current === file.hash) continue
    if (guarded && !editable) {
      if (previous[file.relative] !== current) backupKernel(root, file.relative, destination, stamp, warnings)
      copyInto(file.path, destination, warnings)
      continue
    }
    if (previous[file.relative] !== undefined && previous[file.relative] === current) {
      copyInto(file.path, destination, warnings)
    }
  }
}

function removeRemoved(
  root: string,
  previous: Record<string, string>,
  pristine: WalkedFile[],
  stamp: string,
  warnings: string[],
): void {
  const present = new Set(pristine.map(file => file.relative))
  for (const [rel, hash] of Object.entries(previous)) {
    if (present.has(rel) || !safeRelative(rel)) continue
    const destination = join(root, ...rel.split('/'))
    if (!existsSync(destination)) continue
    if (!isWritableTarget(destination, warnings)) continue
    let current: string
    try {
      current = hashFile(destination)
    } catch (error) {
      warnings.push(`读不了 ${destination}：${errorMessage(error)}`)
      continue
    }
    const guarded = isGuardedRuntimeFile(rel)
    if (guarded || current === hash) {
      if (guarded && current !== hash) backupKernel(root, rel, destination, stamp, warnings)
      rmSync(destination, { force: true })
    }
  }
}

function copyInto(source: string, destination: string, warnings: string[]): void {
  try {
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(source, destination)
  } catch (error) {
    warnings.push(`写不了 ${destination}：${errorMessage(error)}`)
  }
}

function isWritableTarget(path: string, warnings: string[]): boolean {
  try {
    if (lstatSync(path).isSymbolicLink()) {
      warnings.push(`跳过符号链接 ${path}`)
      return false
    }
    return true
  } catch {
    return false
  }
}

function backupKernel(root: string, rel: string, source: string, stamp: string, warnings: string[]): void {
  const destination = join(root, KERNEL_BACKUP, stamp, ...rel.split('/'))
  copyInto(source, destination, warnings)
}

function isEditableFile(rel: string): boolean {
  return EDITABLE_FISH_FILES.includes(rel)
}

function isGuardedRuntimeFile(rel: string): boolean {
  for (const name of SYNCED_FISH_PLUGINS) {
    const prefix = `fish/plugins/${name}/`
    if (!rel.startsWith(prefix)) continue
    const rest = rel.slice(prefix.length)
    if (rest === 'package.json' || rest === 'client.js' || rest === 'cordis.patch.yml') return true
    if (rest.startsWith('lib/')) return true
  }
  return false
}

function readSourceManifest(sourceRoot: string): SourceManifest | undefined {
  const raw = readJsonObject(join(sourceRoot, FISH_SOURCE_MANIFEST))
  if (raw === undefined || raw.format !== SOURCE_FORMAT) return undefined
  const pristine = raw.pristine
  if (pristine === null || typeof pristine !== 'object' || Array.isArray(pristine)) return undefined
  return { format: SOURCE_FORMAT, pristine: pristine as Record<string, string> }
}

function readJsonObject(path: string): Record<string, unknown> | undefined {
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

function writeSourceManifest(sourceRoot: string, version: string, now: number, pristine: WalkedFile[]): void {
  const hashes: Record<string, string> = {}
  for (const file of [...pristine].sort((left, right) => left.relative.localeCompare(right.relative))) {
    hashes[file.relative] = file.hash
  }
  writeJson(join(sourceRoot, FISH_SOURCE_MANIFEST), {
    format: SOURCE_FORMAT,
    version,
    updatedAt: now,
    pristine: hashes,
    editable: [...EDITABLE_FISH_FILES],
  })
}

function writeSourceReadme(sourceRoot: string, version: string): void {
  const editable = EDITABLE_FISH_FILES.map(file => `- \`${file}\``).join('\n')
  const body = [
    '# 大肥鱼源码副本（安装版）',
    '',
    `这是安装包 ${version} 随带的源码副本。创造模式就在这个目录里工作；完全退出并重新打开 DSH 后，启动过程会把改动同步进桌面 profile。`,
    '',
    '## 可以改的文件',
    '',
    editable,
    '',
    '只有这些文件会保留并在重启后生效。其余运行时文件（尤其是 `lib/permissions.js`、`lib/index.js`、`lib/privacy.js`、`lib/budget.js`、`package.json` 和 `client.js`）每次启动都会从安装包原版恢复，改过的副本会留在 `.kernel-backup/` 里。',
    '',
    '- `fish/bundle` 和另外四个插件只作参考，不参与同步；出厂人设请在设置页「性格人设」里覆盖。',
    '- 可以读 `../fish-mind` 和 DSH 目录里的调试资料，也可以运行 `$DSH_HOME/dsh-runtimes` 里的自带 Node/Python 跑测试；不要写 `../fish-mind`（工具会拒绝），DSH 目录里的其它文件改了也会在启动时被恢复。',
    '- 改完不需要跑 pnpm 或 sync-runtime；完全退出再打开即可。',
    '- 恢复出厂源码：删掉整个 `fish-src` 目录，再打开 DSH，会从安装包重新生成。',
    '',
  ].join('\n')
  writeText(join(sourceRoot, SOURCE_README), body)
}

function readProfileStamp(path: string): ProfileStamp | undefined {
  const raw = readJsonObject(path)
  if (raw === undefined || raw.format !== PROFILE_FORMAT) return undefined
  const packages = raw.packages
  if (packages === null || typeof packages !== 'object' || Array.isArray(packages)) return undefined
  return { format: PROFILE_FORMAT, packages: packages as ProfileStamp['packages'] }
}

function writeProfileStamp(path: string, sourceRoot: string, synced: readonly string[]): void {
  const previous = readProfileStamp(path)
  const packages: Record<string, { hash?: string; files?: Record<string, string> }> = {}
  for (const name of SYNCED_FISH_PLUGINS) {
    const entry = previous?.packages[name]
    if (entry !== undefined) packages[name] = entry
  }
  const checkout = join(sourceRoot, 'fish')
  for (const name of synced) {
    const files = walkFiles(join(checkout, 'plugins', name), [], true)
    const hashes: Record<string, string> = {}
    for (const file of files) hashes[file.relative] = file.hash
    packages[name] = { hash: packageHash(files), files: hashes }
  }
  writeJson(path, { format: PROFILE_FORMAT, sourceRoot, packages })
}

function validatePlugin(directory: string, name: string): string | undefined {
  const manifestPath = join(directory, 'package.json')
  let manifest: { name?: unknown; main?: unknown }
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown; main?: unknown }
  } catch (error) {
    return `${name} 读不了 package.json：${errorMessage(error)}`
  }
  if (manifest.name !== name) return `${name} 的 package.json 名字是 ${String(manifest.name)}`
  if (typeof manifest.main === 'string') {
    const entry = resolve(directory, manifest.main)
    if (!isInside(directory, entry) || !existsSync(entry)) return `${name} 的入口 ${manifest.main} 不存在`
  }
  return undefined
}

function packageHash(files: readonly WalkedFile[]): string {
  const hash = createHash('sha256')
  for (const file of [...files].sort((left, right) => left.relative.localeCompare(right.relative))) {
    hash.update(file.relative)
    hash.update('\0')
    hash.update(file.hash)
    hash.update('\n')
  }
  return hash.digest('hex')
}

function checkSyntax(
  nodeExecutable: string,
  files: readonly WalkedFile[],
  previous: Record<string, string> | undefined,
): string | undefined {
  for (const file of files) {
    if (!ESM_EXTENSIONS.some(extension => file.relative.endsWith(extension))) continue
    if (previous !== undefined && previous[file.relative] === file.hash) continue
    let source: Buffer
    try {
      source = readFileSync(file.path)
    } catch (error) {
      return `读不了 ${file.relative}：${errorMessage(error)}`
    }
    const result = spawnSync(nodeExecutable, ['--input-type=module', '--check'], {
      input: source,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8',
      windowsHide: true,
    })
    if (result.error !== undefined) return `语法检查跑不起来：${result.error.message}`
    if (result.status !== 0) {
      const detail = result.stderr.trim().split('\n').slice(0, 4).join(' ')
      return `${file.relative} 有语法错误：${detail}`
    }
  }
  return undefined
}

function copyPackage(files: readonly WalkedFile[], profileDir: string, name: string): void {
  const stagingRoot = join(profileDir, '.fish-staging')
  const staging = join(stagingRoot, name)
  const destination = join(profileDir, 'node_modules', name)
  const previous = join(stagingRoot, `${name}.previous`)
  rmSync(staging, { recursive: true, force: true })
  rmSync(previous, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  let published = false
  try {
    for (const file of files) {
      const target = join(staging, ...file.relative.split('/'))
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(file.path, target)
    }
    mkdirSync(dirname(destination), { recursive: true })
    if (existsSync(destination)) renameSync(destination, previous)
    try {
      renameSync(staging, destination)
    } catch (error) {
      if (existsSync(previous)) renameSync(previous, destination)
      throw error
    }
    published = true
  } finally {
    // A failed swap keeps the previous copy under .fish-staging for manual recovery.
    if (published || !existsSync(previous)) rmSync(stagingRoot, { recursive: true, force: true })
  }
}

function updateProfileDependencies(profileDir: string, names: readonly string[], sourceRoot: string): void {
  const manifestPath = join(profileDir, 'package.json')
  let manifest: { dependencies?: Record<string, string> }
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { dependencies?: Record<string, string> }
  } catch {
    return
  }
  const dependencies = manifest.dependencies !== undefined
    && typeof manifest.dependencies === 'object'
    && !Array.isArray(manifest.dependencies)
    ? { ...manifest.dependencies }
    : {}
  let changed = false
  for (const name of names) {
    const spec = `file:${toPosix(relative(profileDir, join(sourceRoot, 'fish', 'plugins', name)))}`
    if (dependencies[name] !== spec) {
      dependencies[name] = spec
      changed = true
    }
  }
  if (!changed) return
  manifest.dependencies = dependencies
  writeJson(manifestPath, manifest)
}

function removeManagedProfilePackages(profileDir: string, stamp: ProfileStamp | undefined): void {
  const owned = new Set<string>(stamp === undefined ? [] : Object.keys(stamp.packages))
  if (owned.size === 0) return
  const manifestPath = join(profileDir, 'package.json')
  let manifest: { dependencies?: Record<string, string> }
  let changed = false
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { dependencies?: Record<string, string> }
  } catch {
    manifest = {}
  }
  for (const name of owned) {
    const spec = manifest.dependencies?.[name]
    if (typeof spec === 'string' && spec.startsWith('file:../../fish-src/')) {
      delete manifest.dependencies?.[name]
      changed = true
    }
    rmSync(join(profileDir, 'node_modules', name), { recursive: true, force: true })
  }
  if (changed && manifest.dependencies !== undefined) writeJson(manifestPath, manifest)
}

function writeSyncWarning(sourceRoot: string, warnings: readonly string[]): void {
  const path = join(sourceRoot, FISH_SYNC_WARNING)
  if (warnings.length === 0) {
    if (existsSync(path)) {
      try { unlinkSync(path) } catch {}
    }
    return
  }
  try {
    writeJson(path, { at: Date.now(), warnings: [...warnings] })
  } catch {
    // The settings page simply shows no warning when the record cannot be written.
  }
}

function writeJson(path: string, value: unknown): void {
  writeText(path, `${JSON.stringify(value, undefined, 2)}\n`)
}

function writeText(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, value)
  renameSync(temporary, path)
}

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function safeRelative(rel: string): boolean {
  if (rel === '' || isAbsolute(rel)) return false
  return rel.split(/[\\/]/u).every(part => part !== '' && part !== '.' && part !== '..')
}

function toPosix(path: string): string {
  return path.split(sep).join('/')
}

function isInside(root: string, path: string): boolean {
  const target = resolve(path)
  const base = resolve(root)
  return target === base || target.startsWith(`${base}${sep}`)
}

function backupStamp(now: number): string {
  return new Date(now).toISOString().replace(/[:.]/gu, '-')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
