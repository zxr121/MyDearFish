// 「朗读桥」宿主半边冒烟测试 —— 假 ctx / 假鱼脑把外发那半跑一遍。
// 验的是：
//   1) 鱼脑不可用、脱敏抛错、脱敏后为空 → 一律不排队（失败关闭）
//   2) 脱敏成功 → 队列里是脱敏后的文字，原文不外发
//   3) 自动朗读：一整轮说完的内容也先过脱敏
// 跑法： node tests/宿主半边.mjs

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const 家 = mkdtempSync(join(tmpdir(), 'tts-bridge-'))
process.env.DSH_HOME = 家

let 挂了 = 0
const 报 = (标签, 过, 详情) => { if (!过) 挂了++; console.log(`${过 ? 'PASS' : 'FAIL'}  ${标签}${详情 ? '  :: ' + 详情 : ''}`) }

// 假鱼脑：只验「先脱敏、再念」和失败关闭。
const 鱼脑状态 = { 可用: true, 抛出: false, 返回空: false, 领过: new Set() }
const 假鱼脑 = {
  redactOutbound(文字) {
    if (鱼脑状态.抛出) throw new Error('脱敏坏了')
    if (鱼脑状态.返回空) return { text: '', hits: 1, reasons: ['test'] }
    const 原文 = String(文字)
    const 命中 = /余额|sk-/.test(原文)
    return {
      text: 原文.replace(/余额\s*\d+(?:\.\d+)?/g, '余额 [金额已隐去]').replace(/sk-[A-Za-z0-9]+/g, '[密钥已隐去]'),
      hits: 命中 ? 1 : 0,
      reasons: 命中 ? ['test'] : [],
    }
  },
  claimDelivery(key) {
    if (鱼脑状态.领过.has(key)) return { claimed: false, by: 'qq' }
    鱼脑状态.领过.add(key)
    return { claimed: true, by: 'voice' }
  },
}

// ---------- 假 ctx ----------
const 路由 = new Map()
const 摘掉 = []
let 扫描 = null
const 会话状态 = { 事件: [], 序号: 0 }
const 会话 = {
  id: 'session-X',
  get seq() { return 会话状态.序号 },
  snapshotEvents: (起点) => 会话状态.事件.slice(起点),
}
const ctx = {
  effect: (fn) => { const 摘 = fn(); 摘掉.push(typeof 摘 === 'function' ? 摘 : () => {}) },
  interval: (fn) => { 扫描 = fn; return () => {} },
  on: () => () => {},
  emit: () => {},
  get: (名字) => (名字 === 'fishMind' && 鱼脑状态.可用 ? 假鱼脑 : undefined),
  webServer: {
    register: (o) => { 路由.set(o.path, o.handler) },
    tapIndex: () => () => {},
    getOrigin: () => 'http://127.0.0.1:0',
  },
  sessions: { list: () => [会话], get: (id) => (String(id) === 'session-X' ? 会话 : undefined) },
  sessionTitle: { get: () => ({ title: '测试会话' }) },
  workspaceRegistry: { archivedSessionIds: [] },
}

const 模 = await import(new URL('../lib/index.js', import.meta.url).href + '?v=' + Date.now())
模.apply(ctx)

const 请求 = (体) => {
  const 监听 = {}
  const req = { method: 'POST', on: (名, cb) => { 监听[名] = cb; return req }, destroy: () => {} }
  setImmediate(() => {
    if (监听.data) 监听.data(Buffer.from(JSON.stringify(体)))
    if (监听.end) 监听.end()
  })
  return req
}
const 响应 = () => ({
  码: 0,
  体: null,
  writeHead(码) { this.码 = 码 },
  end(文本) { this.体 = JSON.parse(文本) },
})
const 调 = async (路, 体) => {
  const 处理 = 路由.get('/dsh-tts-bridge' + 路)
  if (!处理) return { 缺: 路 }
  const res = 响应()
  await 处理(请求(体), res)
  return res.体
}

报('朗读接口挂上了', 路由.has('/dsh-tts-bridge/say') && 路由.has('/dsh-tts-bridge/next') && 路由.has('/dsh-tts-bridge/state'))

// 扩展必须摊在 asar 外面，浏览器才能「加载已解压的扩展程序」
const 扩展清单 = join(家, 'tts-bridge', 'extension', 'manifest.json')
报('扩展已铺到家目录', existsSync(扩展清单), 扩展清单)
if (existsSync(扩展清单)) {
  报('铺出来的扩展清单可读', JSON.parse(readFileSync(扩展清单, 'utf8')).name === '朗读桥')
}
let 状态 = await 调('/state', {})
报('/state 的 extDir 指向家目录', typeof 状态?.extDir === 'string' && 状态.extDir.startsWith(join(家, 'tts-bridge', 'extension')), JSON.stringify(状态?.extDir))

// ① 鱼脑不可用 → 不念
鱼脑状态.可用 = false
let 回 = await 调('/say', { text: '宝宝，今天余额 12.5' })
报('鱼脑不可用 → 拒绝、不排队', 回 && 回.ok === false, JSON.stringify(回))
回 = await 调('/state', {})
报('鱼脑不可用 → 队列仍为空', 回 && 回.waiting === 0, JSON.stringify(回 && 回.waiting))

// ② 脱敏抛错 → 不念
鱼脑状态.可用 = true
鱼脑状态.抛出 = true
回 = await 调('/say', { text: '宝宝，今天余额 12.5' })
报('脱敏抛错 → 拒绝、不排队', 回 && 回.ok === false, JSON.stringify(回))

// ③ 脱敏后为空 → 不念
鱼脑状态.抛出 = false
鱼脑状态.返回空 = true
回 = await 调('/say', { text: '整条都是私密内容' })
报('脱敏后为空 → 拒绝、不排队', 回 && 回.ok === false, JSON.stringify(回))

// ④ 脱敏成功 → 队列里只有脱敏后的文字
鱼脑状态.返回空 = false
回 = await 调('/say', { text: '宝宝，今天余额 12.5，密钥 sk-abc123' })
报('脱敏成功 → 排队并标记已脱敏', 回 && 回.ok === true && 回.redacted === true && 回.waiting === 1, JSON.stringify(回))
回 = await 调('/next', { client: 'test' })
报('取件拿到的不是原文', 回 && 回.item && !/12\.5|sk-abc123/.test(回.item.text) && /金额已隐去/.test(回.item.text), JSON.stringify(回 && 回.item))

// ⑤ 自动朗读：一整轮说完也先过脱敏
报('扫描回调挂上了', typeof 扫描 === 'function')
会话状态.序号 = 0
会话状态.事件 = []
扫描() // 第一次只登记基线
await 调('/stop', {})
await 调('/next', { client: 'test' }) // 吃掉 stop 标记
会话状态.事件.push(
  { type: 'assistant/message', data: { turn: 9, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '宝宝，余额 7.5' }] } } },
  { type: 'turn/end', data: { turn: 9, reason: { kind: 'completed' } } },
)
会话状态.序号 = 2
扫描()
回 = await 调('/next', { client: 'test' })
报('自动朗读也走脱敏后的文字', 回 && 回.item && !/7\.5/.test(回.item.text) && /金额已隐去/.test(回.item.text), JSON.stringify(回 && 回.item))

// 收摊：先等问路端口绑定结束，再关掉
await new Promise((r) => setTimeout(r, 150))
for (const 摘 of 摘掉.reverse()) { try { 摘() } catch {} }
rmSync(家, { recursive: true, force: true })
console.log(挂了 ? `\n失败 ${挂了} 项` : '\n全部通过 ✅')
process.exitCode = 挂了 ? 1 : 0
