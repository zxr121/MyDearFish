// 「通到 QQ」宿主半边冒烟测试 —— 假 ctx / 假 fetch 把「DSH → QQ」这半跑一遍。
// 验的是：
//   1) 提取正文：只收 text 块，reasoning / image 不要；空 → ''
//   2) assistant/message + turn/end(completed) → 真的向 NapCat 发一条 send_private_msg
//   3) interrupted 那轮不发；turn/end 不是 completed 不发
//   4) 试运行开着 → 不真发（fetch 不被打）；总开关关着 → 不真发
//   5) /state 路由能回出配置和 NapCat 探活结果
// 跑法： node tests/宿主半边.mjs

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const 家 = mkdtempSync(join(tmpdir(), 'qq-bridge-'))
process.env.DSH_HOME = 家

// 先把配置写好（总开关开、真发、私聊 123）
writeFileSync(
  join(家, 'qq-bridge-config.json'),
  JSON.stringify({
    总开关: true, 试运行: false, 目标会话: 'session-X', 私聊QQ: '123', 群号: '',
    转私聊: true, 转群: false, NapCat: 'http://127.0.0.1:3000',
  }, null, 2),
  'utf8',
)

let 挂了 = 0
const 报 = (标签, 过, 详情) => { if (!过) 挂了++; console.log(`${过 ? 'PASS' : 'FAIL'}  ${标签}${详情 ? '  :: ' + 详情 : ''}`) }

// 假 fetch：记下每次 POST，回一个「发送成功」；拉历史时给一条她的新消息
const 发了 = []
let 私聊消息文本 = '宝宝'
let 私聊消息时间 = 9999999999
let 私聊消息id = 9000
let 私聊附加 = []
globalThis.fetch = async (url, 选项) => {
  const 体 = JSON.parse((选项 && 选项.body) || '{}')
  const u = String(url)
  if (u.includes('get_login_info')) {
    return { json: async () => ({ status: 'ok', retcode: 0, data: { user_id: 10001, nickname: '大肥鱼' } }) }
  }
  if (u.includes('get_friend_msg_history')) {
    return {
      json: async () => ({
        status: 'ok', retcode: 0,
        data: {
          messages: [
            { user_id: 123, time: 私聊消息时间, message_id: 私聊消息id, message_type: 'private', message: [{ type: 'text', data: { text: 私聊消息文本 } }] },
            ...私聊附加,
          ],
        },
      }),
    }
  }
  发了.push({ url: u, 体 })
  return { json: async () => ({ status: 'ok', retcode: 0, data: { message_id: 1 } }) }
}

// 假鱼脑：真鱼脑在 fish-mind 里，这里只验 QQ 这半「先脱敏、再发」和失败关闭。
const 鱼脑状态 = { 可用: true, 抛出: false, 领过: new Set() }
const 假鱼脑 = {
  redactOutbound(文字) {
    if (鱼脑状态.抛出) throw new Error('脱敏坏了')
    const 命中 = /余额|sk-/.test(文字)
    return {
      text: String(文字)
        .replace(/余额\s*\d+(?:\.\d+)?/g, '余额 [金额已隐去]')
        .replace(/sk-[A-Za-z0-9]+/g, '[密钥已隐去]'),
      hits: 命中 ? 1 : 0,
      reasons: 命中 ? ['test'] : [],
    }
  },
  claimDelivery(key) {
    if (鱼脑状态.领过.has(key)) return { claimed: false, by: 'voice' }
    鱼脑状态.领过.add(key)
    return { claimed: true, by: 'qq' }
  },
}

const 模 = await import(new URL('../lib/host.js', import.meta.url).href + '?v=' + Date.now())

// ---------- 纯函数 ----------
报('名字导出', 模.name === 'qq-bridge', 模.name)
报('inject = agents + sessions + sessionTitle + webServer + timer + workspaceRegistry + llm', Array.isArray(模.inject) && 模.inject.join() === 'agents,sessions,sessionTitle,webServer,timer,workspaceRegistry,llm')

const 块 = (type, text) => ({ type, text })
const 正文 = 模.提取正文({ content: [块('reasoning', '想一下'), 块('text', '第一条\n第二条'), 块('image', ''), 块('text', '第三条')] })
报('提取正文：只收 text，reasoning/image 都不要', 正文 === '第一条\n第二条\n第三条', JSON.stringify(正文))
报('提取正文：没有 text → 空串', 模.提取正文({ content: [块('reasoning', 'x')] }) === '')

// ---------- 假 ctx ----------
const 监听 = []
const 路由 = new Map()
const 转进的 = []
const 轮询回调们 = []
let 轮询回调 = null
const 假agent = { followup: (m) => 转进的.push(m), session: { id: 'session-X' } }
const ctx = {
  on: (名字, cb) => { if (名字 === 'session/event') 监听.push(cb); return () => {} },
  effect: (fn) => { const 摘 = fn(); return () => { try { 摘 && 摘() } catch {} } },
  webServer: { register: (o) => 路由.set(o.path, o.handler) },
  logger: { info: () => {} },
  agents: { get: (id) => (String(id) === 'session-X' ? 假agent : undefined), list: () => [假agent] },
  sessions: { flush: async () => {} },
  interval: (fn) => {
    轮询回调们.push(fn)
    // 主人消息轮询先注册，后面社交桥还会注册一个；这里只认第一个
    if (!轮询回调) 轮询回调 = fn
    return () => {}
  },
  get: (名字) => (名字 === 'fishMind' && 鱼脑状态.可用 ? 假鱼脑 : undefined),
}

模.apply(ctx)
报('session/event 监听挂上了', 监听.length >= 1)

const 会话 = { id: 'session-X' }
const 别的会话 = { id: 'session-Y' }
const 助手消息 = (turn, step, blocks, interrupted) => ({ type: 'assistant/message', data: { turn, step, interrupted, message: { role: 'assistant', content: blocks } } })
const 转完 = (turn, kind = 'completed') => ({ type: 'turn/end', data: { turn, reason: { kind } } })

// ① 正常一轮 → 发一条私聊
监听[0](会话, 助手消息(7, 1, [块('text', '宝宝，我想你了')], false))
监听[0](会话, 转完(7))
await new Promise((r) => setTimeout(r, 20))
报('一整轮结束 → 发出一条私聊', 发了.length === 1 && 发了[0].url.endsWith('/send_private_msg'), 发了.map((x) => x.url + ' :: ' + JSON.stringify(x.体.response || x.体)).join(' / '))

if (发了[0]) {
  const 体 = 发了[0].体
 报('私聊体：user_id=123 + 一条 text 段', 体.user_id === 123 && 体.message && 体.message[0].type === 'text' && 体.message[0].data.text === '宝宝，我想你了', JSON.stringify(体))
}

// ② 中间步骤：先 pm 再看表那种多步，只发**最后一步**（同 turn 后面那条）。
const 之前 = 发了.length
监听[0](会话, 助手消息(8, 1, [块('text', '第一步（别发这个）')], false))
监听[0](会话, 助手消息(8, 2, [块('text', '最后一句（发这个）')], false))
监听[0](会话, 转完(8))
await new Promise((r) => setTimeout(r, 20))
报('多步只发最后一步', 发了.length === 之前 + 1 && JSON.stringify(发了.at(-1).体.message[0].data.text).includes('最后一句'), JSON.stringify(发了.at(-1).体.message[0].data.text))

// ②b 出门前先过鱼脑：余额和密钥换成标签，fetch 里拿不到原值
监听[0](会话, 助手消息(80, 1, [块('text', '我的余额 123.45，密钥 sk-abcdefghijklmnop')], false))
监听[0](会话, 转完(80))
await new Promise((r) => setTimeout(r, 20))
const 脱敏后 = 发了.at(-1)?.体.message[0].data.text || ''
报('发 QQ 前先脱敏：余额和密钥留在本机', 脱敏后.includes('[金额已隐去]') && 脱敏后.includes('[密钥已隐去]') && !脱敏后.includes('123.45') && !脱敏后.includes('sk-'), JSON.stringify(脱敏后))

// ③ interrupted 那轮不发
const 之前3 = 发了.length
监听[0](会话, 助手消息(9, 1, [块('text', '被打断的话')], true))
监听[0](会话, 转完(9))
await new Promise((r) => setTimeout(r, 20))
报('interrupted 那轮不转发', 发了.length === 之前3)

// ④ turn/end 不是 completed → 不发
const 之前4 = 发了.length
监听[0](会话, 助手消息(10, 1, [块('text', '中断的话')], false))
监听[0](会话, 转完(10, 'interrupted'))
await new Promise((r) => setTimeout(r, 20))
报('reason 不是 completed 不转发', 发了.length === 之前4)

// ⑤ 别的会话不转
const 之前5 = 发了.length
监听[0](别的会话, 助手消息(11, 1, [块('text', '别的屋')], false))
监听[0](别的会话, 转完(11))
await new Promise((r) => setTimeout(r, 20))
报('不是目标会话不转发', 发了.length === 之前5)

// ⑥ 试运行开 → fetch 不被打
writeFileSync(join(家, 'qq-bridge-config.json'), JSON.stringify({
  总开关: true, 试运行: true, 目标会话: 'session-X', 私聊QQ: '123', 群号: '', 转私聊: true, 转群: false, NapCat: 'http://127.0.0.1:3000',
}, null, 2), 'utf8')
const 之前6 = 发了.length
监听[0](会话, 助手消息(12, 1, [块('text', 'try')], false))
监听[0](会话, 转完(12))
await new Promise((r) => setTimeout(r, 20))
报('试运行开 → 只记账不真发', 发了.length === 之前6)

// ⑦ 总开关关 → fetch 不被打
writeFileSync(join(家, 'qq-bridge-config.json'), JSON.stringify({
  总开关: false, 试运行: false, 目标会话: 'session-X', 私聊QQ: '123', 群号: '', 转私聊: true, 转群: false, NapCat: 'http://127.0.0.1:3000',
}, null, 2), 'utf8')
const 之前7 = 发了.length
监听[0](会话, 助手消息(13, 1, [块('text', 'off')], false))
监听[0](会话, 转完(13))
await new Promise((r) => setTimeout(r, 20))
报('总开关关 → 不转发', 发了.length === 之前7)

// ⑦b 鱼脑脱敏不可用 → 失败关闭，绝不按原文发
writeFileSync(join(家, 'qq-bridge-config.json'), JSON.stringify({
  总开关: true, 试运行: false, 目标会话: 'session-X', 私聊QQ: '123', 群号: '', 转私聊: true, 转群: false, NapCat: 'http://127.0.0.1:3000',
}, null, 2), 'utf8')
鱼脑状态.可用 = false
const 之前7b = 发了.length
监听[0](会话, 助手消息(130, 1, [块('text', '这条不该按原文发出去')], false))
监听[0](会话, 转完(130))
await new Promise((r) => setTimeout(r, 20))
报('脱敏服务不可用 → 不发（失败关闭）', 发了.length === 之前7b, '发出条数=' + 发了.length)

// ⑦c 脱敏自己抛错 → 同样失败关闭
鱼脑状态.可用 = true
鱼脑状态.抛出 = true
const 之前7c = 发了.length
监听[0](会话, 助手消息(131, 1, [块('text', '这条也不该发出去')], false))
监听[0](会话, 转完(131))
await new Promise((r) => setTimeout(r, 20))
报('脱敏抛错 → 不发（失败关闭）', 发了.length === 之前7c, '发出条数=' + 发了.length)
鱼脑状态.抛出 = false

// ⑧ /state 路由能回配置 + NapCat 探活
writeFileSync(join(家, 'qq-bridge-config.json'), JSON.stringify({
  总开关: false, 试运行: false, 目标会话: 'session-X', 私聊QQ: '123', 群号: '', 转私聊: true, 转群: false, NapCat: 'http://127.0.0.1:3000',
}, null, 2), 'utf8')
const 存储 = []
const fakeRes = { statusCode: 200, setHeader: () => {}, end: (s) => { 存储.push(JSON.parse(s)) } }
// 数组本身可被 for await 迭代；把 method/headers 挂上去，模拟 Node 的 IncomingMessage。
const 造请求 = (body, 选项 = {}) => {
  const 块s = body === undefined ? [] : [typeof body === 'string' ? body : JSON.stringify(body)]
  块s.method = 选项.method || 'POST'
  块s.headers = {
    host: 选项.host || '127.0.0.1:3080',
    ...(选项.origin === undefined ? {} : { origin: 选项.origin }),
    ...(选项.site === undefined ? {} : { 'sec-fetch-site': 选项.site }),
  }
  return 块s
}
await 路由.get('/dsh-qq-bridge/state')(造请求(undefined, { method: 'GET' }), fakeRes)
const 状态 = 存储[0]
报('/state 回出配置', 状态 && 状态.ok === true && 状态.配置 && 状态.配置.总开关 === false, JSON.stringify(状态 && 状态.配置))
报('/state 探到 NapCat 那个号', 状态 && 状态.NapCat状态 && 状态.NapCat状态.昵称 === '大肥鱼' && 状态.NapCat状态.用户 === 10001, JSON.stringify(状态 && 状态.NapCat状态))

// ⑧a 来源防线：跨站网页 / DNS rebinding 不能碰这些接口
存储.length = 0
await 路由.get('/dsh-qq-bridge/state')(造请求(undefined, { method: 'GET', origin: 'https://evil.example' }), fakeRes)
报('跨站 Origin → 拒绝', 存储[0] && 存储[0].ok === false && String(存储[0].说).includes('来源'), JSON.stringify(存储[0]))
存储.length = 0
await 路由.get('/dsh-qq-bridge/state')(造请求(undefined, { method: 'GET', host: 'evil.example:3080' }), fakeRes)
报('非回环 Host（DNS rebinding）→ 拒绝', 存储[0] && 存储[0].ok === false && String(存储[0].说).includes('来源'), JSON.stringify(存储[0]))
存储.length = 0
await 路由.get('/dsh-qq-bridge/state')(造请求(undefined, { method: 'GET', site: 'cross-site' }), fakeRes)
报('Sec-Fetch-Site: cross-site → 拒绝', 存储[0] && 存储[0].ok === false && String(存储[0].说).includes('来源'), JSON.stringify(存储[0]))
存储.length = 0
await 路由.get('/dsh-qq-bridge/save')(造请求({ 总开关: true }, { method: 'GET' }), fakeRes)
报('/save 只收 POST', 存储[0] && 存储[0].ok === false && String(存储[0].说).includes('POST'), JSON.stringify(存储[0]))

// ⑧b 手动测试句也走脱敏：服务不可用就不发
鱼脑状态.可用 = false
存储.length = 0
const 之前8b = 发了.length
await 路由.get('/dsh-qq-bridge/test-send')(造请求({}, { method: 'POST' }), fakeRes)
报('/test-send：脱敏不可用 → 拒绝、不真发', 存储[0] && 存储[0].ok === false && 发了.length === 之前8b, JSON.stringify(存储[0] && { ok: 存储[0].ok, 说: 存储[0].说 }))
鱼脑状态.可用 = true

// ⑨ QQ → DSH：/receive 把她说的话转进目标会话（followup）
const 收 = (body, 选项 = {}) => {
  存储.length = 0
  return new Promise((resolve) => {
    路由.get('/dsh-qq-bridge/receive')(造请求(body, { method: 'POST', ...选项 }), fakeRes).then(() => resolve(存储[0]))
  })
}
writeFileSync(join(家, 'qq-bridge-config.json'), JSON.stringify({
  总开关: true, 试运行: false, 目标会话: 'session-X', 私聊QQ: '123', 群号: '', 转私聊: true, 转群: false, NapCat: 'http://127.0.0.1:3000',
}, null, 2), 'utf8')

let 收到 = await 收({ text: '宝宝你在吗' })
报('/receive：把她的话 followup 进会话', 收到 && 收到.ok === true && 转进的.length === 1, JSON.stringify(收到))
if (转进的[0]) {
  const m = 转进的[0]
  报('/receive 消息形状：role=user + source.kind=qq + 正文对', m.role === 'user' && m.source && m.source.kind === 'qq' && m.content[0].text === '宝宝你在吗', JSON.stringify(m))
}
报('/receive 之后 DSH→QQ 那半也会把大肥鱼的回话发回 QQ（联动靠 session/event，不在这里再验）', true)

// ⑩ 总开关关 → receive 拒绝
writeFileSync(join(家, 'qq-bridge-config.json'), JSON.stringify({
  总开关: false, 试运行: false, 目标会话: 'session-X', 私聊QQ: '123', 群号: '', 转私聊: true, 转群: false, NapCat: 'http://127.0.0.1:3000',
}, null, 2), 'utf8')
const 之前收 = 转进的.length
收到 = await 收({ text: '还开着吗' })
报('/receive：总开关关 → 拒绝、不再 followup', 收到 && 收到.ok === false && 转进的.length === 之前收, JSON.stringify(收到))

// ⑪ 空 text → 拒绝
writeFileSync(join(家, 'qq-bridge-config.json'), JSON.stringify({
  总开关: true, 试运行: false, 目标会话: 'session-X', 私聊QQ: '123', 群号: '', 转私聊: true, 转群: false, NapCat: 'http://127.0.0.1:3000',
}, null, 2), 'utf8')
收到 = await 收({ text: '   ' })
报('/receive：空 text → 拒绝', 收到 && 收到.ok === false, JSON.stringify(收到))

// ⑫ 目标会话没活着 → 拒绝（session-Z 拿不到 agent）
writeFileSync(join(家, 'qq-bridge-config.json'), JSON.stringify({
  总开关: true, 试运行: false, 目标会话: 'session-Z', 私聊QQ: '123', 群号: '', 转私聊: true, 转群: false, NapCat: 'http://127.0.0.1:3000',
}, null, 2), 'utf8')
收到 = await 收({ text: '在吗' })
报('/receive：目标会话没活着 → 拒绝', 收到 && 收到.ok === false && String(收到.说).includes('没活着'), JSON.stringify(收到))

// ⑫b 没填目标会话 → 自动跟最近活着的会话，收发都还能走
writeFileSync(join(家, 'qq-bridge-config.json'), JSON.stringify({
  总开关: true, 试运行: false, 目标会话: '', 私聊QQ: '123', 群号: '', 转私聊: true, 转群: false, NapCat: 'http://127.0.0.1:3000',
}, null, 2), 'utf8')
收到 = await 收({ text: '没填目标也要能找到你' })
报('/receive：没填目标会话 → 自动挑活着的会话', 收到 && 收到.ok === true && JSON.stringify(转进的.at(-1).content[0].text).includes('没填目标'), JSON.stringify(收到))
const 之前自动 = 发了.length
监听[0](会话, 助手消息(14, 1, [块('text', '自动目标这轮也能发')], false))
监听[0](会话, 转完(14))
await new Promise((r) => setTimeout(r, 20))
报('DSH→QQ：没填目标会话 → 自动跟随最近会话', 发了.length === 之前自动 + 1 && JSON.stringify(发了.at(-1).体.message[0].data.text).includes('自动目标'), '发出条数=' + 发了.length)
存储.length = 0
await 路由.get('/dsh-qq-bridge/state')(造请求(undefined, { method: 'GET' }), fakeRes)
报('/state 回出自动解析的目标和来源', 存储[0] && 存储[0].目标会话 === 'session-X' && String(存储[0].目标来源).includes('自动'), JSON.stringify(存储[0] && { 目标会话: 存储[0].目标会话, 目标来源: 存储[0].目标来源 }))

// ⑬ 轮询收消息（QQ → DSH 这半的正式入口，不赖 BOT）
writeFileSync(join(家, 'qq-bridge-config.json'), JSON.stringify({
  总开关: true, 试运行: false, 目标会话: 'session-X', 私聊QQ: '123', 群号: '', 转私聊: true, 转群: false, NapCat: 'http://127.0.0.1:3000',
}, null, 2), 'utf8')
const 之前转 = 转进的.length
私聊消息文本 = '宝宝你在吗'
私聊消息id = 9001
私聊消息时间 = Math.floor(Date.now() / 1000) + 100
await 轮询回调()
await new Promise((r) => setTimeout(r, 20))
报('轮询收消息 → 她新发的私聊被 followup 进 DSH', 转进的.length === 之前转 + 1 && JSON.stringify(转进的.at(-1).content[0].text).includes('宝宝你在吗'), JSON.stringify(转进的.at(-1)))
// 再跑一次同一条：不该重复转
私聊消息文本 = '宝宝你在吗'
私聊消息id = 9001
私聊消息时间 = Math.floor(Date.now() / 1000) + 101
await 轮询回调()
await new Promise((r) => setTimeout(r, 20))
报('轮询：同一条消息不重复转', 转进的.length === 之前转 + 1, '转进条数=' + 转进的.length)

// ⑭ 轮询：总开关关 → 不转
writeFileSync(join(家, 'qq-bridge-config.json'), JSON.stringify({
  总开关: false, 试运行: false, 目标会话: 'session-X', 私聊QQ: '123', 群号: '', 转私聊: true, 转群: false, NapCat: 'http://127.0.0.1:3000',
}, null, 2), 'utf8')
私聊消息文本 = '还开着吗'
私聊消息id = 9002
私聊消息时间 = Math.floor(Date.now() / 1000) + 120
await 轮询回调()
await new Promise((r) => setTimeout(r, 20))
报('轮询：总开关关 → 不转', 转进的.length === 之前转 + 1, '转进条数=' + 转进的.length)

// ⑮ /receive 也挡跨站；超长正文截断，别把整段粘贴灌进上下文
writeFileSync(join(家, 'qq-bridge-config.json'), JSON.stringify({
  总开关: true, 试运行: false, 目标会话: 'session-X', 私聊QQ: '123', 群号: '', 转私聊: true, 转群: false, NapCat: 'http://127.0.0.1:3000',
}, null, 2), 'utf8')
const 之前跨 = 转进的.length
收到 = await 收({ text: '跨站注入' }, { origin: 'https://evil.example' })
报('/receive：跨站 Origin → 拒绝、不 followup', 收到 && 收到.ok === false && 转进的.length === 之前跨, JSON.stringify(收到))

const 之前长 = 转进的.length
收到 = await 收({ text: '长'.repeat(20000) })
const 长文 = 转进的.at(-1)?.content?.[0]?.text || ''
报('/receive：超长正文截断', 收到 && 收到.ok === true && 转进的.length === 之前长 + 1 && 长文.length <= 12050 && 长文.includes('省略'), '长度=' + 长文.length)

// ⑯ 同一次轮询的多条消息合成一轮（不按条数开回合）
私聊消息文本 = '这条已经转过了'
私聊消息时间 = Math.floor(Date.now() / 1000) + 900
私聊消息id = 9001
const 批时间 = Math.floor(Date.now() / 1000) + 1000
私聊附加 = [
  { user_id: 123, time: 批时间, message_id: 9301, message_type: 'private', message: [{ type: 'text', data: { text: '第一句' } }] },
  { user_id: 123, time: 批时间 + 1, message_id: 9302, message_type: 'private', message: [{ type: 'text', data: { text: '第二句' } }] },
]
const 之前批 = 转进的.length
await 轮询回调()
await new Promise((r) => setTimeout(r, 20))
const 批文 = 转进的.at(-1)?.content?.[0]?.text || ''
报('同一次轮询的多条消息合成一轮', 转进的.length === 之前批 + 1 && 批文.includes('第一句') && 批文.includes('第二句'), JSON.stringify(批文))
私聊附加 = []

rmSync(家, { recursive: true, force: true })
console.log(`\n${挂了 === 0 ? '全部通过 ✅' : `有 ${挂了} 条没过 ❌`}`)
process.exitCode = 挂了 === 0 ? 0 : 1