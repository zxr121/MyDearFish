import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readQqRoster } from '../lib/qq-roster.js'

function homeWith(config) {
  const home = mkdtempSync(join(tmpdir(), 'fish-mind-roster-'))
  writeFileSync(join(home, 'qq-bridge-config.json'), JSON.stringify(config) + '\n', 'utf8')
  return home
}

function mockFetch(handler) {
  const original = globalThis.fetch
  globalThis.fetch = async (url) => {
    const body = handler(String(url))
    if (body === undefined) throw new Error('connect ECONNREFUSED')
    return { json: async () => body }
  }
  return () => {
    globalThis.fetch = original
  }
}

function oneBot(data) {
  return { status: 'ok', retcode: 0, data }
}

test('读鱼 QQ 的群和好友，并把设置里已有的名单一起带回来', async () => {
  const home = homeWith({
    NapCat: 'http://127.0.0.1:9999',
    社交: { 群: ['123456'], 好友: ['654321'], 关掉: ['group:777777'], 只听: [], 少掺和: ['888888'] },
  })
  const calls = []
  const restore = mockFetch((url) => {
    calls.push(url)
    if (url === 'http://127.0.0.1:9999/get_login_info') return oneBot({ user_id: 10001, nickname: '大肥鱼' })
    if (url === 'http://127.0.0.1:9999/get_group_list') {
      return oneBot([
        { group_id: 123456, group_name: '主人的群', member_count: 12 },
        { group_id: 888888, group_name: '热闹的群', member_count: 300 },
        { group_id: 'bad', group_name: '坏数据' },
      ])
    }
    if (url === 'http://127.0.0.1:9999/get_friend_list') {
      return oneBot([
        { user_id: 654321, nickname: '小明', remark: '最好的朋友' },
        { user_id: 111111, nickname: '路人' },
      ])
    }
    return undefined
  })
  try {
    const roster = await readQqRoster({ dshHome: home })
    assert.equal(roster.ok, true)
    assert.deepEqual(roster.qq, { id: '10001', name: '大肥鱼' })
    assert.deepEqual(roster.groups, [
      { id: '123456', name: '主人的群', members: 12 },
      { id: '888888', name: '热闹的群', members: 300 },
    ])
    assert.deepEqual(roster.friends, [
      { id: '654321', name: '最好的朋友' },
      { id: '111111', name: '路人' },
    ])
    assert.equal(roster.truncated, false)
    assert.deepEqual(roster.configured, {
      enabled: true,
      groups: ['123456'],
      friends: ['654321'],
      off: ['group:777777'],
      only: [],
      mix: ['888888'],
    })
    assert.ok(calls.includes('http://127.0.0.1:9999/get_login_info'))
  } finally {
    restore()
  }
})

test('配置的地址没响应时依次试 3002 和 3000', async () => {
  const home = homeWith({ NapCat: 'http://127.0.0.1:9999' })
  const calls = []
  const restore = mockFetch((url) => {
    calls.push(url)
    if (url.startsWith('http://127.0.0.1:3002/')) return undefined
    if (url === 'http://127.0.0.1:3000/get_login_info') return oneBot({ user_id: 10001, nickname: '大肥鱼' })
    if (url === 'http://127.0.0.1:3000/get_group_list') return oneBot([])
    if (url === 'http://127.0.0.1:3000/get_friend_list') return oneBot([])
    return undefined
  })
  try {
    const roster = await readQqRoster({ dshHome: home })
    assert.equal(roster.ok, true)
    assert.ok(calls.some((url) => url.startsWith('http://127.0.0.1:3002/')))
    assert.ok(calls.some((url) => url.startsWith('http://127.0.0.1:3000/')))
  } finally {
    restore()
  }
})

test('OneBot 在线但鱼 QQ 没登录时说清楚原因', async () => {
  const home = homeWith({ NapCat: 'http://127.0.0.1:9999' })
  const restore = mockFetch((url) => {
    if (url.endsWith('/get_login_info')) return { status: 'failed', retcode: 100, data: null }
    return undefined
  })
  try {
    const roster = await readQqRoster({ dshHome: home })
    assert.equal(roster.ok, false)
    assert.match(roster.error, /还没登录/)
    assert.equal(roster.configured.enabled, true)
  } finally {
    restore()
  }
})

test('本机没有 OneBot 时提示先启动 SnowLuma', async () => {
  const home = homeWith({})
  const restore = mockFetch(() => undefined)
  try {
    const roster = await readQqRoster({ dshHome: home })
    assert.equal(roster.ok, false)
    assert.match(roster.error, /没有回应/)
  } finally {
    restore()
  }
})

test('设置文件坏了就停下，不改也不猜名单', async () => {
  const home = mkdtempSync(join(tmpdir(), 'fish-mind-roster-'))
  writeFileSync(join(home, 'qq-bridge-config.json'), '{oops', 'utf8')
  const roster = await readQqRoster({ dshHome: home })
  assert.equal(roster.ok, false)
  assert.match(roster.error, /设置文件读不出来/)
})

test('结果里不带配置中的密码和令牌', async () => {
  const home = homeWith({
    NapCat: 'http://127.0.0.1:9999',
    Token: 'super-secret-token',
    Password: 'super-secret-password',
  })
  const restore = mockFetch((url) => {
    if (url.endsWith('/get_login_info')) return oneBot({ user_id: 10001, nickname: '大肥鱼' })
    if (url.endsWith('/get_group_list') || url.endsWith('/get_friend_list')) return oneBot([])
    return undefined
  })
  try {
    const roster = await readQqRoster({ dshHome: home })
    const text = JSON.stringify(roster)
    assert.equal(text.includes('super-secret'), false)
  } finally {
    restore()
  }
})
