import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createDesktopCos } from '../scripts/desktop-cos.ts'
import {
  FISH_MIRROR_MANUAL_KEY, FISH_MIRROR_METADATA_KEY, FISH_MIRROR_PREFIX, fishMirrorPrunableKeys,
  planFishMirrorUpload, publishFishMirror, resolveFishMirrorConfig,
} from '../scripts/publish-fish-mirror.ts'
import { answer, cosError, startCosLoopback, type CosLoopbackRequest } from './cos-loopback.ts'

interface Fixture {
  readonly directory: string
  readonly name: string
  readonly bytes: Buffer
  readonly sha512: string
  readonly metadata: string
}

async function createArtifacts(version = '1.0.2', bytes = Buffer.from('installer fixture')): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), 'fish-mirror-'))
  const name = `deepseek-harness-${version}-win-x64-unsigned.exe`
  const sha512 = createHash('sha512').update(bytes).digest('base64')
  const metadata = [
    `version: ${version}`,
    'files:',
    `  - url: ${name}`,
    `    sha512: ${sha512}`,
    `    size: ${bytes.length}`,
    `  - url: ${name}.blockmap`,
    '    sha512: fixture',
    '    size: 16',
    `path: ${name}`,
    `sha512: ${sha512}`,
    'releaseDate: 2026-10-28T00:00:00.000Z',
    '',
  ].join('\n')
  await writeFile(join(directory, name), bytes)
  await writeFile(join(directory, `${name}.blockmap`), Buffer.from('blockmap fixture'))
  await writeFile(join(directory, 'nightly.yml'), metadata)
  return { directory, name, bytes, sha512, metadata }
}

function objectKey(request: CosLoopbackRequest): string {
  const path = new URL(request.path, 'http://127.0.0.1').pathname.slice(1)
  return decodeURIComponent(path)
}

it('reads the bucket and both writer credentials from the deployment environment', () => {
  expect(resolveFishMirrorConfig({
    FISH_MIRROR_COS_BUCKET: ' fish-1250000000 ',
    FISH_MIRROR_COS_SECRET_ID: ' fixture-id ',
    FISH_MIRROR_COS_SECRET_KEY: ' fixture-key ',
  })).toEqual({ bucket: 'fish-1250000000', secretId: 'fixture-id', secretKey: 'fixture-key' })
  expect(() => resolveFishMirrorConfig({ FISH_MIRROR_COS_SECRET_ID: 'id', FISH_MIRROR_COS_SECRET_KEY: 'key' }))
    .toThrow(/FISH_MIRROR_COS_BUCKET/u)
  expect(() => resolveFishMirrorConfig({ FISH_MIRROR_COS_BUCKET: 'fish/bucket-1250000000' }))
    .toThrow(/bucket name/u)
  expect(() => resolveFishMirrorConfig({ FISH_MIRROR_COS_BUCKET: 'fish-1250000000', FISH_MIRROR_COS_SECRET_ID: 'id' }))
    .toThrow(/FISH_MIRROR_COS_SECRET_KEY/u)
})

it('plans versioned keys and proves the channel metadata matches the local installer', async () => {
  const fixture = await createArtifacts()
  try {
    const plan = await planFishMirrorUpload('1.0.2', fixture.directory)
    expect(plan.installer).toMatchObject({ key: `${FISH_MIRROR_PREFIX}${fixture.name}`, size: fixture.bytes.length, sha512: fixture.sha512 })
    expect(plan.blockmap.key).toBe(`${FISH_MIRROR_PREFIX}${fixture.name}.blockmap`)
    expect(plan.metadata).toMatchObject({ key: FISH_MIRROR_METADATA_KEY, contents: fixture.metadata })
  } finally { await rm(fixture.directory, { recursive: true, force: true }) }
})

it('rejects a build whose channel metadata does not describe the local installer', async () => {
  const fixture = await createArtifacts()
  try {
    await writeFile(join(fixture.directory, 'nightly.yml'), fixture.metadata.replace('version: 1.0.2', 'version: 1.0.3'))
    await expect(planFishMirrorUpload('1.0.2', fixture.directory)).rejects.toThrow(/declares 1\.0\.3/u)
    await writeFile(join(fixture.directory, 'nightly.yml'), fixture.metadata.replace(fixture.sha512, 'c29tZXRoaW5nLWVsc2U='))
    await expect(planFishMirrorUpload('1.0.2', fixture.directory)).rejects.toThrow(/sha512 differs/u)
    await expect(planFishMirrorUpload('1.0.2', join(fixture.directory, 'absent'))).rejects.toThrow(/missing installer/u)
    await expect(planFishMirrorUpload('not-a-version', fixture.directory)).rejects.toThrow(/invalid build version/u)
  } finally { await rm(fixture.directory, { recursive: true, force: true }) }
})

it('keeps the newest two generations and the version being published', () => {
  const key = (version: string, blockmap = false) =>
    `${FISH_MIRROR_PREFIX}deepseek-harness-${version}-win-x64-unsigned.exe${blockmap ? '.blockmap' : ''}`
  const keys = [
    key('1.8.0'), key('1.8.0', true),
    key('1.9.0'), key('1.9.0', true),
    key('2.0.0'), key('2.0.0', true),
    FISH_MIRROR_METADATA_KEY, FISH_MIRROR_MANUAL_KEY,
    `${FISH_MIRROR_PREFIX}notes.txt`,
  ]
  expect(fishMirrorPrunableKeys(keys, '2.0.0')).toEqual([key('1.8.0'), key('1.8.0', true)])
  expect(fishMirrorPrunableKeys(keys, '1.8.0')).toEqual([])
  expect(fishMirrorPrunableKeys(keys, '2.0.0')).not.toContain(`${FISH_MIRROR_PREFIX}notes.txt`)
})

it('writes metadata last, serves the manual alias, and removes a superseded generation', async () => {
  const fixture = await createArtifacts('1.0.2')
  const objects = new Map<string, Buffer>()
  for (const version of ['1.0.0', '1.0.1']) {
    objects.set(`${FISH_MIRROR_PREFIX}deepseek-harness-${version}-win-x64-unsigned.exe`, Buffer.from(version))
    objects.set(`${FISH_MIRROR_PREFIX}deepseek-harness-${version}-win-x64-unsigned.exe.blockmap`, Buffer.from(version))
  }
  const server = await startCosLoopback((request, response) => {
    const key = objectKey(request)
    if (request.method === 'PUT' && request.headers['x-cos-copy-source'] !== undefined) {
      const header = String(request.headers['x-cos-copy-source'])
      const source = decodeURIComponent(header.split('/').slice(1).join('/'))
      const bytes = objects.get(source)
      if (bytes === undefined) { answer(response, 404, cosError('NoSuchKey')); return }
      objects.set(key, bytes)
      answer(response, 200, '<CopyObjectResult><ETag>"fixture"</ETag><CRC64>fixture</CRC64><LastModified>2026-10-28T00:00:00.000Z</LastModified></CopyObjectResult>')
      return
    }
    if (request.method === 'PUT') { objects.set(key, request.body); answer(response); return }
    if (request.method === 'HEAD') {
      const bytes = objects.get(key)
      if (bytes === undefined) answer(response, 404, cosError('NoSuchKey'))
      else answer(response, 200, '', { 'content-length': String(bytes.length), etag: '"fixture"' })
      return
    }
    if (request.method === 'GET') {
      const contents = [...objects.keys()].filter(name => name.startsWith(FISH_MIRROR_PREFIX)).sort()
        .map(name => `<Contents><Key>${name}</Key><LastModified>2026-10-28T00:00:00.000Z</LastModified><ETag>"fixture"</ETag><Size>1</Size><StorageClass>STANDARD</StorageClass></Contents>`)
        .join('')
      answer(response, 200, `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>fish-1250000000</Name><Prefix>${FISH_MIRROR_PREFIX}</Prefix><Marker></Marker><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`)
      return
    }
    if (request.method === 'POST') {
      const removed = [...request.body.toString('utf8').matchAll(/<Key>(.*?)<\/Key>/gu)].map(match => match[1]!)
      for (const name of removed) objects.delete(name)
      answer(response, 200, `<DeleteResult>${removed.map(name => `<Deleted><Key>${name}</Key></Deleted>`).join('')}</DeleteResult>`)
      return
    }
    answer(response, 400, cosError('InvalidRequest'))
  })
  try {
    const plan = await planFishMirrorUpload('1.0.2', fixture.directory)
    const publication = await publishFishMirror(plan, {
      bucket: 'fish-1250000000', secretId: 'fixture-id', secretKey: 'fixture-secret',
    }, (credentials) => {
      const cos = createDesktopCos(credentials)
      server.redirect(cos)
      return cos
    })
    const installerKey = `${FISH_MIRROR_PREFIX}${fixture.name}`
    const writes = server.requests.filter(request => request.method === 'PUT')
    expect(writes.map(objectKey)).toEqual([
      installerKey, `${installerKey}.blockmap`, FISH_MIRROR_MANUAL_KEY, FISH_MIRROR_METADATA_KEY,
    ])
    expect(writes.at(0)!.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    expect(writes.at(0)!.headers['content-type']).toBe('application/octet-stream')
    expect(writes.at(2)!.headers['x-cos-copy-source']).toContain(`fish-1250000000.cos.ap-beijing.myqcloud.com/${installerKey}`)
    expect(writes.at(3)!.headers['cache-control']).toBe('no-cache')
    expect(writes.at(3)!.headers['content-type']).toBe('text/yaml')
    expect(objects.get(installerKey)).toEqual(fixture.bytes)
    expect(objects.get(FISH_MIRROR_MANUAL_KEY)).toEqual(fixture.bytes)
    expect(objects.get(FISH_MIRROR_METADATA_KEY)?.toString('utf8')).toBe(fixture.metadata)
    expect(objects.has(`${FISH_MIRROR_PREFIX}deepseek-harness-1.0.0-win-x64-unsigned.exe`)).toBe(false)
    expect(objects.has(`${FISH_MIRROR_PREFIX}deepseek-harness-1.0.1-win-x64-unsigned.exe`)).toBe(true)
    expect(publication.removed).toEqual([
      `${FISH_MIRROR_PREFIX}deepseek-harness-1.0.0-win-x64-unsigned.exe`,
      `${FISH_MIRROR_PREFIX}deepseek-harness-1.0.0-win-x64-unsigned.exe.blockmap`,
    ])
    const positions = server.requests.map(request => `${request.method} ${objectKey(request)}`)
    expect(positions.indexOf(`PUT ${FISH_MIRROR_METADATA_KEY}`)).toBeLessThan(positions.findIndex(entry => entry.startsWith('HEAD ')))
  } finally {
    await server.close()
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

it('never publishes metadata when a file it names failed to upload', async () => {
  const fixture = await createArtifacts()
  const server = await startCosLoopback((request, response) => {
    if (request.method === 'PUT' && objectKey(request).endsWith('.blockmap')) answer(response, 500, cosError('InternalError', 'blockmap upload failed'))
    else answer(response)
  })
  try {
    const plan = await planFishMirrorUpload('1.0.2', fixture.directory)
    const pending = publishFishMirror(plan, { bucket: 'fish-1250000000', secretId: 'fixture-id', secretKey: 'fixture-secret' },
      (credentials) => {
        const cos = createDesktopCos(credentials)
        server.redirect(cos)
        return cos
      })
    await expect(pending).rejects.toThrow(/blockmap upload failed/u)
    expect(server.requests.map(objectKey)).not.toContain(FISH_MIRROR_METADATA_KEY)
  } finally {
    await server.close()
    await rm(fixture.directory, { recursive: true, force: true })
  }
})
