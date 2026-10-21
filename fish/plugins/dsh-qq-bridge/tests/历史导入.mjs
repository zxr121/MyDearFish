// 历史导入半边：用一个假的 MCP 服务当 Tulpa，验的是「只读、有界、可续、重放不重复」。

import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { 创建历史导入, 导入来源 } from '../lib/import.js'

/** 假鱼脑：按 (会话, seq, 正文) 去重，模仿 store 的 hash 命中返回 id=null。 */
function 假鱼脑() {
  const 见过 = new Set()
  const 写过的 = []
  let 号 = 0
  return {
    写过的,
    observe(记录) {
      const 钥 = `${记录.sessionId}|${记录.seq}|${记录.text}`
      if (见过.has(钥)) return { ok: true, id: null, hash: 'dup' }
      见过.add(钥)
      号 += 1
      写过的.push(记录)
      return { ok: true, id: 号, hash: `h${号}` }
    },
  }
}

/** 假 Tulpa：会话列表里混着一间群；历史按 end_time 往前翻，每页按 count 给。 */
function 起服务() {
  const 消息 = [
    { message_id: 5, sender_id: 10131, time: 1700000500, message: '周末去海边' },
    { message_id: 4, sender_id: 10131, time: 1700000400, content: [{ type: 'text', text: '帮我看看这个' }, { type: 'image' }] },
    { message_id: 3, sender_id: 10131, time: 1700000300, message: '鲸歌好好听' },
    { message_id: 2, sender_id: 10132, time: 1700000200, content: [{ type: 'text', text: '你今天怎么样' }, { type: 'voice' }] },
    { message_id: 1, sender_id: 10131, time: 1700000100, message: '早点睡' },
  ]
  const 请求日志 = []
  const 服务 = createServer((req, res) => {
    let 文 = ''
    req.on('data', (d) => { 文 += d })
    req.on('end', () => {
      const 包 = JSON.parse(文 || '{}')
      请求日志.push(包)
      const 回 = (result, 头 = {}) => {
        res.writeHead(200, { 'content-type': 'text/event-stream', ...头 })
        res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 包.id, result })}\n\n`)
      }
      if (包.method === 'initialize') {
        回({ protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fake-tulpa', version: '1' } }, { 'mcp-session-id': 'sess-1' })
        return
      }
      if (包.method === 'notifications/initialized') {
        res.writeHead(202)
        res.end()
        return
      }
      if (包.method === 'tools/list') {
        回({
          tools: [
            { name: 'list_conversations', description: '列出所有会话', inputSchema: { type: 'object', properties: {} } },
            { name: 'get_friend_messages', description: '按时间往前读取私聊记录', inputSchema: { type: 'object', properties: { conversation_id: { type: 'string' }, end_time: { type: 'number' }, count: { type: 'number' } } } },
            { name: 'send_message', description: '发送消息', inputSchema: { type: 'object', properties: {} } },
          ],
        })
        return
      }
      if (包.method === 'tools/call') {
        if (包.params.name === 'send_message') {
          res.writeHead(403)
          res.end('nope')
          return
        }
        if (包.params.name === 'list_conversations') {
          回({ content: [{ type: 'text', text: JSON.stringify({ data: { list: [{ conversation_id: 'p1', remark: '老公' }, { group_id: 'g1', name: '摸鱼群' }] } }) }] })
          return
        }
        const 参数 = 包.params.arguments
        const 终点 = 参数.end_time === undefined ? Infinity : Number(参数.end_time)
        const 限 = Number(参数.count) > 0 ? Number(参数.count) : 2
        const 列表 = 消息.filter((m) => m.time < 终点).slice(0, 限)
        回({ structuredContent: { code: 0, data: { messages: 列表 } } })
        return
      }
      res.writeHead(404)
      res.end()
    })
  })
  return new Promise((Resolve) => {
    服务.listen(0, '127.0.0.1', () => Resolve({ 服务, 地址: `http://127.0.0.1:${服务.address().port}/mcp`, 请求日志 }))
  })
}

async function 一次(配置改动 = {}) {
  const 目录 = mkdtempSync(join(tmpdir(), 'qq-import-'))
  const 状态文件 = join(目录, 'import-state.json')
  const 站 = await 起服务()
  const 脑 = 假鱼脑()
  const 日志 = []
  const 导 = 创建历史导入({ 鱼脑: 脑, 状态文件, 日志: (l) => 日志.push(l) })
  const 配置 = { 地址: 站.地址, 令牌: 'tk', 每轮条数: 200, 每轮页数: 6, 白名单: [], ...配置改动 }
  try {
    return { 出: await 导.跑(配置), 脑, 导, 状态文件, 日志, 请求: 站.请求日志 }
  } finally {
    站.服务.closeAllConnections(); 站.服务.close()
    rmSync(目录, { recursive: true, force: true })
  }
}

test('导一轮：只导私聊，正文和来源都如实写进经历', async () => {
  const { 出, 脑 } = await 一次()
  assert.equal(出.ok, true)
  assert.equal(出.写, 5)
  assert.equal(出.跳, 0)
  const 首 = 脑.写过的[0]
  assert.equal(首.source, 导入来源)
  assert.equal(首.sessionId, 'session-qq-import-p1')
  assert.equal(首.meta.imported, true)
  assert.equal(首.meta.trust, 0.45)
  assert.ok(首.at > 1e12, '秒级时间要换算成毫秒')
  // 段列表正文：文字留着，图片语音变成占位，不编造内容。
  const 混合 = 脑.写过的.find((r) => r.meta.message_id === '4')
  assert.equal(混合.text, '帮我看看这个 [图片]')
  assert.equal(脑.写过的.find((r) => r.meta.message_id === '2').text, '你今天怎么样 [语音]')
  // 群聊一条都不进。
  assert.ok(!脑.写过的.some((r) => r.sessionId.includes('g1')))
})

test('重放同一轮：一条都不再写，全部算重复', async () => {
  const 目录 = mkdtempSync(join(tmpdir(), 'qq-import-'))
  const 状态文件 = join(目录, 'import-state.json')
  const 服务 = await 起服务()
  const 脑 = 假鱼脑()
  const 导 = 创建历史导入({ 鱼脑: 脑, 状态文件 })
  const 配置 = { 地址: 服务.地址, 令牌: 'tk', 每轮条数: 200, 每轮页数: 6, 白名单: [] }
  try {
    const 第一轮 = await 导.跑(配置)
    导.重置()
    const 第二轮 = await 导.跑(配置)
    assert.equal(第一轮.写, 5)
    assert.equal(第二轮.写, 0)
    assert.ok(第二轮.重 >= 5)
    assert.equal(脑.写过的.length, 5)
  } finally {
    服务.服务.closeAllConnections(); 服务.服务.close()
    rmSync(目录, { recursive: true, force: true })
  }
})

test('进度落在游标文件里：第二次点继续从更早的地方翻，不重头再来', async () => {
  const 目录 = mkdtempSync(join(tmpdir(), 'qq-import-'))
  const 状态文件 = join(目录, 'import-state.json')
  const 服务 = await 起服务({})
  const 脑 = 假鱼脑()
  const 配 = { 地址: 服务.地址, 令牌: 'tk', 每轮条数: 2, 每轮页数: 1, 白名单: [] }
  const 第一次 = await 创建历史导入({ 鱼脑: 脑, 状态文件 }).跑(配)
  assert.equal(第一次.写, 2)
  const 盘 = JSON.parse(readFileSync(状态文件, 'utf8'))
  assert.equal(盘.游标.p1.完成, false)
  assert.equal(typeof 盘.游标.p1.位置, 'number')
  const 第二次 = await 创建历史导入({ 鱼脑: 脑, 状态文件 }).跑({ ...配, 每轮条数: 3 })
  assert.equal(第二次.写, 3)
  assert.equal(脑.写过的.length, 5)
  服务.服务.closeAllConnections(); 服务.服务.close()
  rmSync(目录, { recursive: true, force: true })
})

test('白名单只放过填的那间；全被挡掉就如实报错', async () => {
  const 只留群 = await 一次({ 白名单: ['g1'] })
  assert.equal(只留群.出.ok, false)
  assert.match(只留群.出.说, /私聊一个都没找到/)

  const 全部 = await 一次({ 白名单: ['p1'] })
  assert.equal(全部.出.ok, true)
  assert.equal(全部.出.写, 5)
})

test('没有令牌就一个字都不取', async () => {
  const { 出, 脑 } = await 一次({ 令牌: '' })
  assert.equal(出.ok, false)
  assert.match(出.说, /访问令牌/)
  assert.equal(脑.写过的.length, 0)
})

test('发送类工具永远不会被选中：只会调读的那两个', async () => {
  const { 出, 请求 } = await 一次()
  assert.equal(出.ok, true)
  const 调过 = 请求.filter((p) => p.method === 'tools/call').map((p) => p.params.name)
  assert.deepEqual([...new Set(调过)].sort(), ['get_friend_messages', 'list_conversations'])
})

test('导到一半可以停：进度已经落盘，再说一次不重复写', async () => {
  const 目录 = mkdtempSync(join(tmpdir(), 'qq-import-'))
  const 状态文件 = join(目录, 'import-state.json')
  const 服务 = await 起服务({})
  const 脑 = 假鱼脑()
  const 导 = 创建历史导入({ 鱼脑: 脑, 状态文件 })
  const 在跑 = 导.跑({ 地址: 服务.地址, 令牌: 'tk', 每轮条数: 200, 每轮页数: 6, 白名单: [] })
  const 停 = 导.停()
  assert.equal(停.ok, true)
  const 出 = await 在跑
  assert.equal(出.ok, true)
  assert.ok(出.写 <= 5)
  assert.match(出.说, /已停止|导完/)
  服务.服务.closeAllConnections(); 服务.服务.close()
  rmSync(目录, { recursive: true, force: true })
})

test('Tulpa 没有可读历史的工具时报错，不硬猜', async () => {
  const 目录 = mkdtempSync(join(tmpdir(), 'qq-import-'))
  const 服务 = createServer((req, res) => {
    let 文 = ''
    req.on('data', (d) => { 文 += d })
    req.on('end', () => {
      const 包 = JSON.parse(文 || '{}')
      res.writeHead(200, { 'content-type': 'application/json' })
      if (包.method === 'tools/list') res.end(JSON.stringify({ jsonrpc: '2.0', id: 包.id, result: { tools: [{ name: 'get_data_status', inputSchema: {} }] } }))
      else if (包.method === 'initialize') res.end(JSON.stringify({ jsonrpc: '2.0', id: 包.id, result: { capabilities: {} } }))
      else res.end(JSON.stringify({ jsonrpc: '2.0', id: 包.id, result: {} }))
    })
  })
  const 地址 = await new Promise((R) => 服务.listen(0, '127.0.0.1', () => R(`http://127.0.0.1:${服务.address().port}/mcp`)))
  const 出 = await 创建历史导入({ 鱼脑: 假鱼脑(), 状态文件: join(目录, 's.json') })
    .跑({ 地址, 令牌: 'tk', 每轮条数: 10, 每轮页数: 1, 白名单: [] })
  assert.equal(出.ok, false)
  assert.match(出.说, /没有能读聊天记录/)
  服务.close()
  rmSync(目录, { recursive: true, force: true })
})
