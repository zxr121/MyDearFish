/** Publish one verified unsigned Windows build to the owner's Tencent COS update mirror. */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Readable } from 'node:stream'
import type COS from 'cos-nodejs-sdk-v5'
import { load as parseYaml } from 'js-yaml'
import { rcompare, valid } from 'semver'
import { createDesktopCos, DESKTOP_COS_REGION, type DesktopCosCredentials } from './desktop-cos.ts'
import { cosOperation } from './cos-operation.ts'

/** Environment variable that names the mirror bucket. */
export const FISH_MIRROR_BUCKET_ENV = 'FISH_MIRROR_COS_BUCKET'

/** Environment variable that supplies the mirror writer's SecretId. */
export const FISH_MIRROR_SECRET_ID_ENV = 'FISH_MIRROR_COS_SECRET_ID'

/** Environment variable that supplies the mirror writer's SecretKey. */
export const FISH_MIRROR_SECRET_KEY_ENV = 'FISH_MIRROR_COS_SECRET_KEY'

/** Object prefix shared by every mirrored Windows build. */
export const FISH_MIRROR_PREFIX = 'fish/win-x64/'

/** Stable object name behind the manual-download link. */
export const FISH_MIRROR_MANUAL_KEY = `${FISH_MIRROR_PREFIX}get/latest.exe`

/** Metadata object readers consult; published only after every file it names exists. */
export const FISH_MIRROR_METADATA_KEY = `${FISH_MIRROR_PREFIX}nightly.yml`

/** Generation count kept for differential downloads of the preceding release. */
export const FISH_MIRROR_RETAINED_VERSIONS = 2

const TRANSFER_TIMEOUT_MS = 900_000
const QUERY_TIMEOUT_MS = 120_000

/** Mirror writer credentials; values are never printed. */
export interface FishMirrorConfig {
  readonly bucket: string
  readonly secretId: string
  readonly secretKey: string
}

/** One local artifact and the immutable object it publishes. */
export interface FishMirrorFile {
  readonly path: string
  readonly key: string
  readonly size: number
  readonly sha512: string
  readonly md5: string
}

/** Everything one publication writes, in upload order. */
export interface FishMirrorPlan {
  readonly version: string
  readonly installer: FishMirrorFile
  readonly blockmap: FishMirrorFile
  readonly metadata: { readonly key: string; readonly contents: string; readonly md5: string }
}

/** Object keys written and superseded by one publication. */
export interface FishMirrorPublication {
  readonly uploaded: readonly string[]
  readonly removed: readonly string[]
}

function requiredValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim()
  if (value === undefined || value === '') throw new Error(`fish mirror: ${name} must be set to a non-empty value`)
  return value
}

/**
 * Read the mirror destination from deployment settings.
 * @param env Environment carrying the bucket and writer credentials.
 * @returns Validated bucket and credentials.
 * @throws When a setting is missing or the bucket is not a COS bucket name.
 */
export function resolveFishMirrorConfig(env: NodeJS.ProcessEnv): FishMirrorConfig {
  const bucket = requiredValue(env, FISH_MIRROR_BUCKET_ENV)
  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/u.test(bucket)) {
    throw new Error(`fish mirror: ${FISH_MIRROR_BUCKET_ENV} is not a COS bucket name such as name-1250000000`)
  }
  return { bucket, secretId: requiredValue(env, FISH_MIRROR_SECRET_ID_ENV), secretKey: requiredValue(env, FISH_MIRROR_SECRET_KEY_ENV) }
}

/** Installer filename produced by the unsigned Windows target. */
function installerName(version: string): string {
  return `deepseek-harness-${version}-win-x64-unsigned.exe`
}

async function fileDigests(path: string): Promise<{ size: number; sha512: string; md5: string }> {
  const sha512 = createHash('sha512')
  const md5 = createHash('md5')
  let size = 0
  for await (const chunk of createReadStream(path)) {
    const bytes = chunk as Buffer
    size += bytes.length
    sha512.update(bytes)
    md5.update(bytes)
  }
  return { size, sha512: sha512.digest('base64'), md5: md5.digest('base64') }
}

interface ChannelMetadata {
  readonly version?: unknown
  readonly path?: unknown
  readonly files?: readonly { readonly url?: unknown; readonly size?: unknown; readonly sha512?: unknown }[]
}

/**
 * Read the channel metadata and prove it names exactly the local installer bytes.
 * @param text Raw `nightly.yml` contents.
 * @param version Build version.
 * @param installer Local installer file name and digest.
 * @returns Nothing; mismatches reject the publication before any upload.
 */
function verifyChannelMetadata(text: string, version: string, installer: { name: string; size: number; sha512: string }): void {
  const metadata = parseYaml(text) as ChannelMetadata | null
  if (metadata === null || typeof metadata !== 'object') throw new Error('fish mirror: channel metadata is not an object')
  if (metadata.version !== version) throw new Error(`fish mirror: channel metadata declares ${String(metadata.version)} instead of ${version}`)
  const entry = metadata.files?.find(file => file.url === installer.name)
  if (entry === undefined) throw new Error(`fish mirror: channel metadata does not name ${installer.name}`)
  if (entry.size !== installer.size) throw new Error('fish mirror: channel metadata size differs from the local installer')
  if (entry.sha512 !== installer.sha512) throw new Error('fish mirror: channel metadata sha512 differs from the local installer')
  if (metadata.path !== undefined && metadata.path !== installer.name) throw new Error('fish mirror: channel metadata path differs from the installer file')
}

/**
 * Describe one complete mirror publication without contacting COS.
 * @param version Build version stamped into the artifacts.
 * @param artifactsDirectory electron-builder artifact directory.
 * @returns Local files, digests, and object keys.
 * @throws When the version is invalid, a file is missing, or the metadata disagrees with the installer.
 */
export async function planFishMirrorUpload(version: string, artifactsDirectory: string): Promise<FishMirrorPlan> {
  if (valid(version) === null) throw new Error(`fish mirror: invalid build version ${JSON.stringify(version)}`)
  const name = installerName(version)
  const installerPath = join(artifactsDirectory, name)
  const blockmapPath = join(artifactsDirectory, `${name}.blockmap`)
  const metadataPath = join(artifactsDirectory, 'nightly.yml')
  for (const [label, path] of [['installer', installerPath], ['blockmap', blockmapPath], ['channel metadata', metadataPath]] as const) {
    const info = await stat(path).catch(() => undefined)
    if (info === undefined || !info.isFile()) throw new Error(`fish mirror: missing ${label} at ${path}`)
  }
  const digests = await fileDigests(installerPath)
  if (digests.size === 0) throw new Error('fish mirror: installer is empty')
  const contents = await readFile(metadataPath, 'utf8')
  verifyChannelMetadata(contents, version, { name, size: digests.size, sha512: digests.sha512 })
  const blockmap = await fileDigests(blockmapPath)
  return {
    version,
    installer: { path: installerPath, key: `${FISH_MIRROR_PREFIX}${name}`, size: digests.size, sha512: digests.sha512, md5: digests.md5 },
    blockmap: { path: blockmapPath, key: `${FISH_MIRROR_PREFIX}${name}.blockmap`, size: blockmap.size, sha512: blockmap.sha512, md5: blockmap.md5 },
    metadata: { key: FISH_MIRROR_METADATA_KEY, contents, md5: createHash('md5').update(contents).digest('base64') },
  }
}

function cacheControl(key: string): string {
  return key === FISH_MIRROR_METADATA_KEY || key === FISH_MIRROR_MANUAL_KEY
    ? 'no-cache'
    : 'public, max-age=31536000, immutable'
}

async function putObject(cos: COS, bucket: string, key: string, body: Readable | Buffer,
  size: number, md5: string): Promise<void> {
  await cosOperation(cos, TRANSFER_TIMEOUT_MS, () => cos.putObject({
    Bucket: bucket,
    Region: DESKTOP_COS_REGION,
    Key: key,
    Body: body,
    ContentLength: size,
    ContentType: key.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream',
    CacheControl: cacheControl(key),
    Headers: { 'Content-MD5': md5 },
  }))
}

async function putFile(cos: COS, bucket: string, file: FishMirrorFile): Promise<void> {
  const body = createReadStream(file.path)
  try {
    await putObject(cos, bucket, file.key, body, file.size, file.md5)
  } finally { body.destroy() }
}

async function copyManualInstaller(cos: COS, bucket: string, installer: FishMirrorFile): Promise<void> {
  const source = `${bucket}.cos.${DESKTOP_COS_REGION}.myqcloud.com/${installer.key.split('/').map(encodeURIComponent).join('/')}`
  await cosOperation(cos, TRANSFER_TIMEOUT_MS, () => cos.putObjectCopy({
    Bucket: bucket,
    Region: DESKTOP_COS_REGION,
    Key: FISH_MIRROR_MANUAL_KEY,
    CopySource: source,
    MetadataDirective: 'Replaced',
    ContentType: 'application/octet-stream',
    CacheControl: cacheControl(FISH_MIRROR_MANUAL_KEY),
  }))
}

async function remoteSize(cos: COS, bucket: string, key: string): Promise<number> {
  const result = await cosOperation(cos, QUERY_TIMEOUT_MS, () => cos.headObject({ Bucket: bucket, Region: DESKTOP_COS_REGION, Key: key }))
  const raw: unknown = result.headers?.['content-length']
  const size = typeof raw === 'string' ? Number(raw) : raw
  if (typeof size !== 'number' || !Number.isSafeInteger(size)) throw new Error(`fish mirror: ${key} has no readable size after upload`)
  return size
}

async function listMirrorKeys(cos: COS, bucket: string): Promise<string[]> {
  const keys: string[] = []
  let marker: string | undefined
  for (;;) {
    const page = await cosOperation(cos, QUERY_TIMEOUT_MS, () => cos.getBucket({
      Bucket: bucket, Region: DESKTOP_COS_REGION, Prefix: FISH_MIRROR_PREFIX, MaxKeys: 1000,
      ...(marker === undefined ? {} : { Marker: marker }),
    }))
    for (const object of page.Contents) keys.push(object.Key)
    if (page.IsTruncated !== 'true') return keys
    if (page.NextMarker === undefined || page.NextMarker === '') throw new Error('fish mirror: truncated listing has no continuation marker')
    marker = page.NextMarker
  }
}

function mirroredVersion(key: string): string | undefined {
  if (!key.startsWith(FISH_MIRROR_PREFIX)) return undefined
  const match = /^deepseek-harness-(.+)-win-x64-unsigned\.exe(?:\.blockmap)?$/u.exec(key.slice(FISH_MIRROR_PREFIX.length))
  if (match === null) return undefined
  return valid(match[1]) === null ? undefined : match[1]
}

/**
 * Select superseded generations, keeping the newest and the version being published.
 * @param keys Every object under the mirror prefix.
 * @param currentVersion Version just published, retained even when it sorts below newer tags.
 * @returns Keys to remove; unrecognized objects are never selected.
 */
export function fishMirrorPrunableKeys(keys: readonly string[], currentVersion: string): string[] {
  const versions = new Set<string>()
  for (const key of keys) {
    const version = mirroredVersion(key)
    if (version !== undefined) versions.add(version)
  }
  const retained = new Set([...versions].sort(rcompare).slice(0, FISH_MIRROR_RETAINED_VERSIONS))
  retained.add(currentVersion)
  return keys.filter((key) => {
    const version = mirroredVersion(key)
    return version !== undefined && !retained.has(version)
  })
}

async function removeKeys(cos: COS, bucket: string, keys: readonly string[]): Promise<void> {
  for (let start = 0; start < keys.length; start += 1000) {
    const batch = keys.slice(start, start + 1000)
    const result = await cosOperation(cos, QUERY_TIMEOUT_MS, () => cos.deleteMultipleObject({
      Bucket: bucket, Region: DESKTOP_COS_REGION, Objects: batch.map(key => ({ Key: key })),
    }))
    const failures = result.Error ?? []
    if (failures.length > 0) {
      throw new Error(`fish mirror: could not remove ${failures.length} superseded object(s): ${failures.map(failure => failure.Key).join(', ')}`)
    }
  }
}

/**
 * Upload one plan: versioned files, the manual alias, then metadata, and finally prune old generations.
 *
 * Metadata is written only after every object it names exists, so a reader never follows a feed to a
 * missing installer. Download paths never retry a write.
 * @param plan Local files and destination keys.
 * @param config Mirror bucket and credentials.
 * @param createClient Client factory; tests redirect the production client to a loopback server.
 * @returns Keys uploaded and removed.
 */
export async function publishFishMirror(
  plan: FishMirrorPlan, config: FishMirrorConfig,
  createClient: (credentials: DesktopCosCredentials) => COS = createDesktopCos,
): Promise<FishMirrorPublication> {
  const cos = createClient({ secretId: config.secretId, secretKey: config.secretKey })
  await putFile(cos, config.bucket, plan.installer)
  await putFile(cos, config.bucket, plan.blockmap)
  await copyManualInstaller(cos, config.bucket, plan.installer)
  const metadata = Buffer.from(plan.metadata.contents)
  await putObject(cos, config.bucket, plan.metadata.key, metadata, metadata.length, plan.metadata.md5)
  for (const [key, expected] of [[plan.installer.key, plan.installer.size], [plan.blockmap.key, plan.blockmap.size],
    [FISH_MIRROR_MANUAL_KEY, plan.installer.size], [plan.metadata.key, metadata.length]] as const) {
    const actual = await remoteSize(cos, config.bucket, key)
    if (actual !== expected) throw new Error(`fish mirror: ${key} is ${actual} bytes instead of ${expected} after upload`)
  }
  const uploaded = [plan.installer.key, plan.blockmap.key, FISH_MIRROR_MANUAL_KEY, plan.metadata.key]
  let removed: string[] = []
  try {
    const keys = await listMirrorKeys(cos, config.bucket)
    removed = fishMirrorPrunableKeys(keys, plan.version)
    if (removed.length > 0) await removeKeys(cos, config.bucket, removed)
  } catch (error) {
    // The feed itself is already correct; retaining extra generations only costs storage.
    process.stderr.write(`fish mirror: published ${plan.metadata.key} but could not prune superseded objects: ${error instanceof Error ? error.message : String(error)}\n`)
  }
  return { uploaded, removed }
}

function argument(argv: readonly string[], name: string): string {
  const index = argv.indexOf(name)
  if (index === -1 || argv[index + 1] === undefined) throw new Error(`fish mirror: missing ${name}`)
  return argv[index + 1]!
}

/**
 * Publish the artifacts named on the command line.
 * @param argv Command arguments after the script name.
 * @param env Deployment settings.
 * @returns Publication summary.
 */
export async function main(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<FishMirrorPublication> {
  const plan = await planFishMirrorUpload(argument(argv, '--version'), resolve(argument(argv, '--artifacts')))
  const publication = await publishFishMirror(plan, resolveFishMirrorConfig(env))
  process.stdout.write(`fish mirror: published ${plan.version} to ${FISH_MIRROR_PREFIX}\n`)
  for (const key of publication.uploaded) process.stdout.write(`  wrote ${key}\n`)
  for (const key of publication.removed) process.stdout.write(`  removed ${key}\n`)
  return publication
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  try {
    await main(process.argv.slice(2), process.env)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
