import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
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

async function call(routes, path, { method = 'GET', body, headers } = {}) {
  const route = routes.find((item) => item.path === path)
  assert.ok(route, `没有注册 ${path}`)
  const res = response()
  await route.handler(request(method, path, body, headers), res)
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
  assert.equal(routes.length, 6)

  const blocked = await call(routes, '/dsh-fish-mind/overview', {
    headers: { 'sec-fetch-site': 'cross-site' },
  })
  assert.equal(blocked.res.status, 403)

  const initial = await call(routes, '/dsh-fish-mind/overview')
  assert.equal(initial.res.status, 200)
  assert.equal(initial.json.ok, true)
  assert.equal(initial.json.identity.name, '大肥鱼')
  assert.equal(initial.json.archive.pending, false)

  const saved = await call(routes, '/dsh-fish-mind/birth', {
    method: 'POST',
    body: {
      name: '小鲸',
      species: '虎鲸娘',
      appearance: '黑白配色，短发。',
      ownerAddress: '船长',
      origin: '从一片海图里醒来。',
      style: '句子短一点。',
    },
  })
  assert.equal(saved.res.status, 200)
  assert.equal(saved.json.identity.name, '小鲸')

  const afterSave = await call(routes, '/dsh-fish-mind/overview')
  assert.equal(afterSave.json.identity.name, '小鲸')
  const identityFile = JSON.parse(readFileSync(join(process.env.DSH_HOME, 'fish-mind', 'identity.json'), 'utf8'))
  assert.equal(identityFile.name, '小鲸')

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
