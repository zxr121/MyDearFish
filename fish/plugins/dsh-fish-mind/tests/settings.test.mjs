import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { parseFishArchive } from '../lib/archive.js'
import { apply } from '../lib/index.js'

function fakeContext() {
  const handlers = new Map()
  const disposers = []
  const services = new Map()
  const ctx = {
    on(event, handler) {
      const list = handlers.get(event) || []
      list.push(handler)
      handlers.set(event, list)
      return () => {
        const index = list.indexOf(handler)
        if (index >= 0) list.splice(index, 1)
      }
    },
    effect(handler) {
      const dispose = handler()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
    provide(name, value) {
      services.set(name, value)
      const dispose = () => services.delete(name)
      disposers.push(dispose)
      return dispose
    },
    set(name, value) {
      services.set(name, value)
    },
    get(name) {
      return services.get(name)
    },
    inject(deps, callback) {
      if (!Array.isArray(deps) || !deps.every((dep) => services.has(dep))) return () => {}
      const webCtx = Object.create(ctx)
      for (const dep of deps) webCtx[dep] = services.get(dep)
      return callback(webCtx)
    },
    dispose() {
      for (const dispose of disposers.reverse()) {
        try {
          dispose()
        } catch {}
      }
    },
    logger: { info() {}, warn() {}, error() {} },
  }
  return ctx
}

function fakeServer(routes) {
  return {
    host: '127.0.0.1',
    protocol: 'http:',
    register(route) {
      routes.push(route)
      return () => {
        const index = routes.indexOf(route)
        if (index >= 0) routes.splice(index, 1)
      }
    },
  }
}

function request(method, url, body, headers = {}) {
  const chunks = body === undefined ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))]
  const req = Readable.from(chunks)
  req.method = method
  req.url = url
  req.headers = { host: '127.0.0.1:3000', ...headers }
  return req
}

function response() {
  return {
    status: 0,
    headers: {},
    body: undefined,
    headersSent: false,
    writeHead(status, headers) {
      this.status = status
      this.headers = headers || {}
      this.headersSent = true
    },
    end(body) {
      this.body = body
    },
  }
}

async function call(routes, path, { method = 'GET', body, headers, url } = {}) {
  const route = routes.find((item) => item.path === path)
  assert.ok(route, `没有注册 ${path}`)
  const res = response()
  await route.handler(request(method, url || path, body, headers), res)
  const json = (() => {
    try {
      return JSON.parse(res.body.toString('utf8'))
    } catch {
      return null
    }
  })()
  return { res, json }
}

test('设置页接口：本机来源、出生设定、零花钱、总览、导出和导入', async () => {
  process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'fish-settings-'))
  const ctx = fakeContext()
  const routes = []
  ctx.set('agents', { list: () => [] })
  ctx.set('webServer', fakeServer(routes))
  apply(ctx)
  assert.equal(routes.length, 16)

  const blocked = await call(routes, '/dsh-fish-mind/overview', {
    headers: { 'sec-fetch-site': 'cross-site' },
  })
  assert.equal(blocked.res.status, 403)

  const personaUnavailable = await call(routes, '/dsh-fish-mind/persona')
  assert.equal(personaUnavailable.res.status, 501)
  const personaSaveUnavailable = await call(routes, '/dsh-fish-mind/persona', {
    method: 'POST',
    body: { persona: '你是小鲸。' },
  })
  assert.equal(personaSaveUnavailable.res.status, 501)

  const initial = await call(routes, '/dsh-fish-mind/overview')
  assert.equal(initial.res.status, 200)
  assert.equal(initial.json.ok, true)
  assert.equal(initial.json.identity.name, '大肥鱼')
  assert.equal(initial.json.archive.pending, false)
  assert.equal(initial.json.phrases.privateDodge, '这个我不方便细说')
  assert.equal(initial.json.phraseDefaults.budgetBlock, '今天我这边有点转不动了，先歇一会儿，明天再找你。')
  assert.equal(initial.json.phraseLimit, 200)
  assert.equal(initial.json.backup.enabled, true)
  assert.equal(initial.json.backup.intervalHours, 24)
  assert.equal(initial.json.backup.count, 0)
  assert.equal(initial.json.backup.dirName, 'fish-backups')
  assert.equal(JSON.stringify(initial.json).includes(process.env.DSH_HOME), false, '总览不带本机路径')

  const saved = await call(routes, '/dsh-fish-mind/birth', {
    method: 'POST',
    body: {
      name: '小鲸',
      species: '虎鲸娘',
      appearance: '黑白配色，短发。',
      ownerAddress: '船长',
      origin: '从一片海图里醒来。',
      style: '句子短一点。',
      relations: [{ name: '时光', relation: '妈妈' }],
    },
  })
  assert.equal(saved.res.status, 200)
  assert.equal(saved.json.identity.name, '小鲸')
  assert.deepEqual(saved.json.identity.relations, [{ name: '时光', relation: '妈妈' }])

  const afterSave = await call(routes, '/dsh-fish-mind/overview')
  assert.equal(afterSave.json.identity.name, '小鲸')
  assert.deepEqual(afterSave.json.identity.relations, [{ name: '时光', relation: '妈妈' }])
  assert.ok(afterSave.json.selfPrompt.includes('时光：妈妈'))
  const identityFile = JSON.parse(readFileSync(join(process.env.DSH_HOME, 'fish-mind', 'identity.json'), 'utf8'))
  assert.equal(identityFile.name, '小鲸')
  assert.deepEqual(identityFile.relations, [{ name: '时光', relation: '妈妈' }])

  const grant = await call(routes, '/dsh-fish-mind/budget', {
    method: 'POST',
    body: { dailyGrantCny: 25 },
  })
  assert.equal(grant.res.status, 200)
  assert.equal(grant.json.dailyGrantCny, 25)
  assert.equal(grant.json.status.walletCny, 25)
  const afterGrant = await call(routes, '/dsh-fish-mind/overview')
  assert.equal(afterGrant.json.wallet.dailyGrantCny, 25)
  assert.equal(afterGrant.json.wallet.availableCny, 25)

  const badGrant = await call(routes, '/dsh-fish-mind/budget', {
    method: 'POST',
    body: { dailyGrantCny: -1 },
  })
  assert.equal(badGrant.res.status, 400)
  assert.match(badGrant.json.error, /0 到 10000/)

  const grantedByGet = await call(routes, '/dsh-fish-mind/budget', { method: 'GET' })
  assert.equal(grantedByGet.res.status, 405)

  const phrases = await call(routes, '/dsh-fish-mind/phrases', {
    method: 'POST',
    body: { privateDodge: '这个我私下讲', budgetBlock: '今天先到这儿，改天再聊。' },
  })
  assert.equal(phrases.res.status, 200)
  assert.equal(phrases.json.phrases.privateDodge, '这个我私下讲')
  assert.equal(phrases.json.defaults.privateDodge, '这个我不方便细说')
  const afterPhrases = await call(routes, '/dsh-fish-mind/overview')
  assert.equal(afterPhrases.json.phrases.budgetBlock, '今天先到这儿，改天再聊。')
  const savedConfig = JSON.parse(readFileSync(join(process.env.DSH_HOME, 'fish-mind', 'config.json'), 'utf8'))
  assert.equal(savedConfig.phrases.privateDodge, '这个我私下讲')
  assert.equal(savedConfig.phrases.budgetBlock, '今天先到这儿，改天再聊。')
  assert.equal(savedConfig.mode, 'live', '只改 phrases，其它配置原样保留')

  const blankPhrase = await call(routes, '/dsh-fish-mind/phrases', {
    method: 'POST',
    body: { privateDodge: '  ', budgetBlock: 'x' },
  })
  assert.equal(blankPhrase.res.status, 400)
  assert.match(blankPhrase.json.error, /不能为空/)
  const longPhrase = await call(routes, '/dsh-fish-mind/phrases', {
    method: 'POST',
    body: { privateDodge: '长'.repeat(201), budgetBlock: 'x' },
  })
  assert.equal(longPhrase.res.status, 400)
  assert.match(longPhrase.json.error, /最多 200 字/)
  assert.equal((await call(routes, '/dsh-fish-mind/phrases', { method: 'GET' })).res.status, 405)

  const badBackupEnabled = await call(routes, '/dsh-fish-mind/backup/config', {
    method: 'POST',
    body: { enabled: 'yes', intervalHours: 24 },
  })
  assert.equal(badBackupEnabled.res.status, 400)
  assert.match(badBackupEnabled.json.error, /enabled/)
  const badBackupInterval = await call(routes, '/dsh-fish-mind/backup/config', {
    method: 'POST',
    body: { enabled: true, intervalHours: 0 },
  })
  assert.equal(badBackupInterval.res.status, 400)
  assert.match(badBackupInterval.json.error, /1 到 720/)
  const fractionalBackupInterval = await call(routes, '/dsh-fish-mind/backup/config', {
    method: 'POST',
    body: { enabled: true, intervalHours: 1.5 },
  })
  assert.equal(fractionalBackupInterval.res.status, 400)
  assert.equal((await call(routes, '/dsh-fish-mind/backup/config', { method: 'GET' })).res.status, 405)

  const backupSaved = await call(routes, '/dsh-fish-mind/backup/config', {
    method: 'POST',
    body: { enabled: true, intervalHours: 6 },
  })
  assert.equal(backupSaved.res.status, 200)
  assert.equal(backupSaved.json.backup.enabled, true)
  assert.equal(backupSaved.json.backup.intervalHours, 6)
  assert.equal(backupSaved.json.backup.count, 1)
  assert.equal(backupSaved.json.run.ok, true)
  assert.match(backupSaved.json.run.fileName, /^mydearfish-\d{4}-\d{2}-\d{2}-\d{6}(?:-\d+)?\.zip$/)
  assert.ok(existsSync(join(process.env.DSH_HOME, 'fish-backups', backupSaved.json.run.fileName)))
  assert.equal(JSON.stringify(backupSaved.json).includes(process.env.DSH_HOME), false, '接口不回绝对路径')

  const manualBackup = await call(routes, '/dsh-fish-mind/backup/now', { method: 'POST' })
  assert.equal(manualBackup.res.status, 200)
  assert.equal(manualBackup.json.run.ok, true)
  assert.equal(manualBackup.json.backup.count, 2)
  assert.equal((await call(routes, '/dsh-fish-mind/backup/now', { method: 'GET' })).res.status, 405)

  const afterBackup = await call(routes, '/dsh-fish-mind/overview')
  assert.equal(afterBackup.json.backup.count, 2)
  assert.equal(afterBackup.json.backup.files.length, 2)
  assert.equal(afterBackup.json.backup.lastRun.ok, true)
  assert.equal(JSON.stringify(afterBackup.json).includes(process.env.DSH_HOME), false)

  const backupDisabled = await call(routes, '/dsh-fish-mind/backup/config', {
    method: 'POST',
    body: { enabled: false, intervalHours: 6 },
  })
  assert.equal(backupDisabled.res.status, 200)
  assert.equal(backupDisabled.json.backup.enabled, false)
  assert.equal(backupDisabled.json.run, null)
  assert.equal((await call(routes, '/dsh-fish-mind/backup/now', { method: 'POST' })).res.status, 200, '关掉自动备份也能手动备一份')
  const savedBackupConfig = JSON.parse(readFileSync(join(process.env.DSH_HOME, 'fish-mind', 'config.json'), 'utf8'))
  assert.deepEqual(savedBackupConfig.backup, { enabled: false, intervalHours: 6 })

  const rejected = await call(routes, '/dsh-fish-mind/birth', {
    method: 'POST',
    body: { name: '', species: '虎鲸娘', appearance: 'x', ownerAddress: '船长' },
  })
  assert.equal(rejected.res.status, 400)
  assert.match(rejected.json.error, /名字不能为空/)
  assert.equal(
    JSON.parse(readFileSync(join(process.env.DSH_HOME, 'fish-mind', 'identity.json'), 'utf8')).name,
    '小鲸',
  )

  const exported = await call(routes, '/dsh-fish-mind/export')
  assert.equal(exported.res.status, 200)
  assert.equal(exported.res.headers['content-type'], 'application/octet-stream')
  assert.match(exported.res.headers['content-disposition'], /filename="mydearfish-\d{4}-\d{2}-\d{2}\.zip"/)
  const bundle = parseFishArchive(exported.res.body)
  assert.equal(bundle.identity.name, '小鲸')
  assert.deepEqual(bundle.identity.relations, [{ name: '时光', relation: '妈妈' }])
  assert.equal(bundle.experience.length, 0)

  const imported = await call(routes, '/dsh-fish-mind/import', {
    method: 'POST',
    body: exported.res.body,
    headers: { 'content-type': 'application/zip' },
  })
  assert.equal(imported.res.status, 200)
  assert.equal(imported.json.ok, true)
  assert.equal(imported.json.pending, true)
  assert.equal(imported.json.restartRequired, true)
  assert.equal(imported.json.counts.experiences, 0)

  const pending = await call(routes, '/dsh-fish-mind/overview')
  assert.equal(pending.json.archive.pending, true)

  const again = await call(routes, '/dsh-fish-mind/import', {
    method: 'POST',
    body: exported.res.body,
    headers: { 'content-type': 'application/zip' },
  })
  assert.equal(again.res.status, 409)
  assert.match(again.json.error, /等重启/)

  const wrongMethod = await call(routes, '/dsh-fish-mind/import', { method: 'GET' })
  assert.equal(wrongMethod.res.status, 405)

  ctx.dispose()
})

test('梗百科接口：搜索、增删改、恢复和开关', async () => {
  process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'fish-settings-'))
  const ctx = fakeContext()
  const routes = []
  ctx.set('agents', { list: () => [] })
  ctx.set('webServer', fakeServer(routes))
  apply(ctx)
  assert.equal(routes.length, 16)

  const search = await call(routes, '/dsh-fish-mind/memes', {
    url: '/dsh-fish-mind/memes?query=%E5%86%85%E5%8D%B7&page=1&pageSize=5',
  })
  assert.equal(search.res.status, 200)
  assert.equal(search.json.ok, true)
  assert.ok(search.json.total >= 1)
  assert.ok(search.json.items.some((item) => item.title === '内卷'))

  const blocked = await call(routes, '/dsh-fish-mind/memes/save', {
    method: 'POST',
    body: { title: '跨站写入', usage: '不该成功。' },
    headers: { 'sec-fetch-site': 'cross-site' },
  })
  assert.equal(blocked.res.status, 403)

  const created = await call(routes, '/dsh-fish-mind/memes/save', {
    method: 'POST',
    body: { title: '测试自建梗', tags: '测试、接口', usage: '接口测试用。' },
  })
  assert.equal(created.res.status, 200)
  assert.equal(created.json.item.custom, true)
  assert.equal(created.json.stats.custom, 1)

  const custom = await call(routes, '/dsh-fish-mind/memes', {
    url: '/dsh-fish-mind/memes?filter=custom&query=%E6%B5%8B%E8%AF%95',
  })
  assert.equal(custom.json.total, 1)

  const edited = await call(routes, '/dsh-fish-mind/memes/save', {
    method: 'POST',
    body: {
      id: created.json.item.id,
      title: '测试自建梗',
      tags: ['测试'],
      usage: '改过的正文。',
    },
  })
  assert.equal(edited.res.status, 200)
  assert.equal(edited.json.item.usage, '改过的正文。')

  const missingId = await call(routes, '/dsh-fish-mind/memes/delete', {
    method: 'POST',
    body: {},
  })
  assert.equal(missingId.res.status, 400)

  const removed = await call(routes, '/dsh-fish-mind/memes/delete', {
    method: 'POST',
    body: { id: created.json.item.id },
  })
  assert.equal(removed.res.status, 200)
  assert.equal(removed.json.stats.custom, 0)

  const builtin = (await call(routes, '/dsh-fish-mind/memes', {
    url: '/dsh-fish-mind/memes?query=%E5%86%85%E5%8D%B7&pageSize=10',
  })).json.items.find((item) => item.title === '内卷')
  assert.ok(builtin)
  const builtinId = builtin.id
  await call(routes, '/dsh-fish-mind/memes/save', {
    method: 'POST',
    body: {
      id: builtinId,
      title: builtin.title,
      tags: builtin.tags,
      usage: '临时修改。',
      origin: builtin.origin,
    },
  })
  const deletedBuiltin = await call(routes, '/dsh-fish-mind/memes/delete', {
    method: 'POST',
    body: { id: builtinId },
  })
  assert.equal(deletedBuiltin.json.stats.deleted, 1)
  const restored = await call(routes, '/dsh-fish-mind/memes/restore', {
    method: 'POST',
    body: { id: builtinId, original: true },
  })
  assert.equal(restored.res.status, 200)
  assert.equal(restored.json.item.edited, false)
  assert.equal(restored.json.stats.deleted, 0)

  const config = await call(routes, '/dsh-fish-mind/memes/config', {
    method: 'POST',
    body: { enabled: false, tool: false },
  })
  assert.equal(config.res.status, 200)
  assert.equal(config.json.config.enabled, false)
  assert.equal(config.json.config.tool, false)

  const wrongMethod = await call(routes, '/dsh-fish-mind/memes', { method: 'POST', body: {} })
  assert.equal(wrongMethod.res.status, 405)

  ctx.dispose()
})
