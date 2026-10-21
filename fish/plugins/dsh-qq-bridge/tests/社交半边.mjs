// 「通到 QQ」社交半边的冒烟测试 —— 假 ctx / 假 fetch / 假 llm 跑群聊与好友接话。
// 验的是：
//   1) 小模型自己挑 watch：只有挑中的消息进她的社交会话；没挑中的当她没看见
//   2) 被 @ 不再自动回：照样先判断，可以看、可以不看、可以不回
//   3) 只看不回走 inject，不唤醒回复模型；冷却里也只看看、先不回
//   4) 好友私聊也由她判断回不回；主人在群里没叫她的只当上下文，叫了她可以直接接
//   5) 静音、试运行、限额、零花钱下限都在判断之前拦住
//   6) 脱敏失败 → 不发；回复她发过的消息 → 认得出是在叫她
//   7) /models 和 /save 的社交深层合并；旧字段「被叫直接回」被忽略
//   8) 刷屏时被叫和主人的消息优先保留，不会被挤出待看或判断窗口
//   9) 兴趣画像成熟前每条都判；成熟后快判挡掉无关消息、整批没兴趣时不调判断模型，
//      被叫和主人（没叫她时）永远进慢判；主人点名叫她时不走慢判
// 跑法： node tests/社交半边.mjs

import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const 家 = mkdtempSync(join(tmpdir(), 'qq-social-'))
process.env.DSH_HOME = 家

let 挂了 = 0
const 报 = (标签, 过, 详情) => { if (!过) 挂了++; console.log(`${过 ? 'PASS' : 'FAIL'}  ${标签}${详情 ? '  :: ' + 详情 : ''}`) }
const 等 = (ms = 30) => new Promise((r) => setTimeout(r, ms))

// 冷却用 Date.now 推进；会话里的「今天」和静音时段仍用真实时间。
const 真Now = Date.now.bind(Date)
let 时间偏移 = 0
Date.now = () => 真Now() + 时间偏移

const 模 = await import(new URL('../lib/host.js', import.meta.url).href + '?v=' + Date.now())

// ---------- 纯函数 ----------
报('社交会话 id：群/好友各一间', 模.社交会话id('group', '555') === 'session-qq-social-group-555' && 模.社交会话id('friend', '777') === 'session-qq-social-friend-777', 模.社交会话id('group', '555'))
报('识别社交会话', 模.是社交会话('session-qq-social-group-555') && 模.是社交会话('qq-social-group-555') && !模.是社交会话('session-X'))
报('主人私聊会话 id：一间固定屋', 模.主人QQ会话id('123') === 'session-qq-private-123', 模.主人QQ会话id('123'))
const 阈值0 = 模.学习期阈值(0.55, 0, false)
const 阈值3 = 模.学习期阈值(0.55, 3, false)
const 阈值6 = 模.学习期阈值(0.55, 6, false)
报('学习期意愿渐变：0 词最松，6 词回到配置阈值', Math.abs(阈值0 - 0.3) < 1e-9 && Math.abs(阈值3 - 0.425) < 1e-9 && Math.abs(阈值6 - 0.55) < 1e-9, `${阈值0}/${阈值3}/${阈值6}`)
报('识别主人私聊会话，且不跟社交会话混', 模.是主人QQ会话('session-qq-private-123') && 模.是主人QQ会话('qq-private-123') && !模.是主人QQ会话('session-qq-social-group-555') && !模.是社交会话('session-qq-private-123'))
报('静音跨午夜：23:00-08:00 在 07:30 生效', 模.在静音时段('23:00-08:00', new Date(2026, 0, 1, 7, 30)))
报('静音：12:00 不生效', !模.在静音时段('23:00-08:00', new Date(2026, 0, 1, 12, 0)))
const 段 = 模.解析消息段({
  message: [
    { type: 'at', data: { qq: '999' } },
    { type: 'text', data: { text: ' 在吗' } },
    { type: 'reply', data: { id: '42' } },
  ],
}, '999')
报('消息段：@ 我 + 正文 + 回复 id', 段.at我 && 段.文字.includes('在吗') && 段.回复id === '42', JSON.stringify(段))
const 图片段 = 模.解析消息段({
  message: [{ type: 'image', data: { url: 'https://multimedia.nt.qq.com.cn/download?x=1', file: 'a.jpg', summary: '[图片]' } }],
}, '999')
报('消息段：图片带 url/file/summary', 图片段.文字 === '[图片]' && 图片段.图片们.length === 1 && 图片段.图片们[0].url.includes('qq.com.cn') && 图片段.图片们[0].file === 'a.jpg', JSON.stringify(图片段))

// ---------- 假配置 / 假 ctx ----------
const 写配置 = (社交 = {}) => {
  writeFileSync(join(家, 'qq-bridge-config.json'), JSON.stringify({
    总开关: true, 试运行: false, 目标会话: '', 私聊QQ: '123', 群号: '',
    转私聊: false, 转群: false, NapCat: 'http://127.0.0.1:3000',
    社交: {
      启用: true, 试运行: false, 群: [], 好友: [], 模式: 'auto', 旁听: true,
      冷却秒: 10, 每小时上限: 6, 每天上限: 30, 每天总上限: 80, 最低余额: 1, 静音: '',
      称呼: ['大肥鱼'], 兴趣词: [], 关注上限: 12,
      判断模型: 'fake/cheap', 判断阈值: 0.55, 判断冷却秒: 60, 回复模型: 'fake/chat',
      ...社交,
    },
  }, null, 2), 'utf8')
}
写配置()

const 监听 = []
const 路由 = new Map()
const 轮询回调们 = []
const 登记的会话 = new Map()
const 回合 = []
const 注入们 = []
const 标题重命名 = []
const 场景提示 = []
const 工具闸门 = []
const 判断调用 = []
const 存储 = []
const 发的 = []
const 附件们 = []
const 鱼脑 = { availableCny: 5, 脱敏坏: false, 脱敏空: false }
let 判断输出 = JSON.stringify({ watch: [], reply: false, confidence: 0.1, reason: '插不上话' })
let 发送序号 = 100

const 设判断 = (watch, reply, confidence = 0.9, reason = '可以') => {
  判断输出 = JSON.stringify({ watch, reply, confidence, reason })
}

const 假llm = {
  async *stream(选项) {
    判断调用.push(选项)
    yield { type: 'text-delta', text: 判断输出 }
    yield { type: 'finish', reason: { kind: 'stop' } }
  },
  async listProviders() { return [{ id: 'fake', name: 'Fake 提供方' }] },
  async listModels(id) { return id === 'fake' ? [{ id: 'cheap', name: '便宜模型' }, { id: 'chat', name: '聊天模型' }] : [] },
}

const 假附件 = {
  imageLimits: {
    maxImageBytes: 5_000_000,
    maxImagesPerMessage: 4,
    maxMessageImageBytes: 10_000_000,
    maxImagePixels: 10_000_000,
    maxImageDimension: 4096,
    mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  },
  async saveImages(inputs) {
    return inputs.map((输入) => {
      const ref = {
        attachmentId: 'att-' + 附件们.length,
        mediaType: 输入.mediaType,
        bytes: 输入.data.length,
        width: 1,
        height: 1,
        name: 输入.name,
      }
      附件们.push(ref)
      return ref
    })
  },
}

const 造agent = (sid) => ({
  session: { id: sid, requestHeader: () => ({ config: { provider: 'fake', model: 'chat' } }) },
  followup: (m) => { 回合.push({ sid, message: m }) },
  inject: (m) => { 注入们.push({ sid, message: m }) },
})

const ctx = {
  on: (名字, cb) => { if (名字 === 'session/event') 监听.push(cb); return () => {} },
  effect: (fn) => { const 摘 = fn(); return () => { try { 摘 && 摘() } catch {} } },
  webServer: { register: (o) => 路由.set(o.path, o.handler) },
  logger: { info: () => {} },
  agents: {
    get: (id) => 登记的会话.get(String(id))?.agent,
    list: () => [...登记的会话.values()].map((x) => x.agent),
    resume: async () => {
      const e = new Error('no such session')
      e.name = 'SessionPersistenceNotFoundError'
      throw e
    },
    create: async ({ sessionId, setup }) => {
      const agent = 造agent(String(sessionId))
      const handle = { agent, dispose: () => { 登记的会话.delete(String(sessionId)) } }
      登记的会话.set(String(sessionId), handle)
      if (setup) {
        setup({
          systemPrompt: { section: (s) => 场景提示.push(s) },
          tools: { guard: (fn) => 工具闸门.push(fn) },
        })
      }
      return handle
    },
  },
  sessions: { flush: async () => {} },
  sessionTitle: { get: () => undefined, rename: (s, t) => 标题重命名.push([s.id, t]) },
  workspaceRegistry: { archivedSessionIds: [] },
  interval: (fn) => { 轮询回调们.push(fn); return () => {} },
  get: (名字) => {
    if (名字 === 'fishMind') {
      return {
        budget: () => ({ enabled: true, availableCny: 鱼脑.availableCny }),
        redactOutbound: (t) => {
          if (鱼脑.脱敏坏) throw new Error('redact down')
          if (鱼脑.脱敏空) return { text: '', hits: 0, reasons: [] }
          return { text: String(t), hits: 0, reasons: [] }
        },
        claimDelivery: (key) => ({ claimed: true, by: 'qq' }),
      }
    }
    if (名字 === 'llm') return 假llm
    if (名字 === 'attachments') return 假附件
    return undefined
  },
}

const 宿主 = 模.apply(ctx)
const 轮询社交 = 轮询回调们[1]
报('社交轮询挂上了', typeof 轮询社交 === 'function' && 轮询回调们.length >= 2, '轮询数=' + 轮询回调们.length)

// ---------- 假 fetch / 消息构造 ----------
const 群消息表 = new Map()
const 好友消息表 = new Map()
globalThis.fetch = async (url, 选项) => {
  const u = String(url)
  const 体 = JSON.parse((选项 && 选项.body) || '{}')
  if (u.includes('get_login_info')) {
    return { json: async () => ({ status: 'ok', retcode: 0, data: { user_id: 999, nickname: '大肥鱼' } }) }
  }
  if (u.includes('get_group_msg_history')) {
    const list = 群消息表.get(Number(体.group_id)) || []
    return { json: async () => ({ status: 'ok', retcode: 0, data: { messages: list } }) }
  }
  if (u.includes('get_friend_msg_history')) {
    const list = 好友消息表.get(Number(体.user_id)) || []
    return { json: async () => ({ status: 'ok', retcode: 0, data: { messages: list } }) }
  }
  if (u.includes('multimedia.nt.qq.com.cn')) {
    return {
      ok: true,
      url: u,
      headers: { get: (k) => (k === 'content-type' ? 'image/jpeg' : k === 'content-length' ? '4' : null) },
      async arrayBuffer() { return new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer },
    }
  }
  发的.push({ url: u, 体 })
  return { json: async () => ({ status: 'ok', retcode: 0, data: { message_id: ++发送序号 } }) }
}

let 消息id = 1
const 一条群消息 = (文本, { uid = 888, id, time, atSelf = false, replyId = '', 是主人 = false } = {}) => ({
  user_id: 是主人 ? 123 : uid,
  time: time === undefined ? Math.floor(Date.now() / 1000) + 100 : time,
  message_id: id === undefined ? 消息id++ : id,
  sender: { card: 是主人 ? '主人' : `群友${uid}`, nickname: 'x' },
  message: [
    ...(atSelf ? [{ type: 'at', data: { qq: '999' } }] : []),
    ...(replyId === '' ? [] : [{ type: 'reply', data: { id: String(replyId) } }]),
    { type: 'text', data: { text: 文本 } },
  ],
})

const 一条带图群消息 = (id, { 是主人 = false, atSelf = false } = {}) => ({
  user_id: 是主人 ? 123 : 888,
  time: Math.floor(Date.now() / 1000) + 100,
  message_id: id,
  sender: { card: 是主人 ? '主人' : '群友888', nickname: 'x' },
  message: [
    ...(atSelf ? [{ type: 'at', data: { qq: '999' } }] : []),
    { type: 'image', data: { url: 'https://multimedia.nt.qq.com.cn/download?x=1', file: 'a.jpg', summary: '[图片]' } },
  ],
})

const 一条好友消息 = (文本, { uid = 777, id, time } = {}) => ({
  user_id: uid,
  time: time === undefined ? Math.floor(Date.now() / 1000) + 100 : time,
  message_id: id === undefined ? 消息id++ : id,
  sender: { card: '小鱼', nickname: '小鱼' },
  message: [{ type: 'text', data: { text: 文本 } }],
})

const 收到回复 = async (sid, 文本, 轮号 = 1) => {
  监听[0]({ id: sid }, {
    type: 'assistant/message',
    data: { turn: 轮号, step: 1, interrupted: false, message: { content: [{ type: 'text', text: 文本 }] } },
  })
  监听[0]({ id: sid }, { type: 'turn/end', data: { turn: 轮号, reason: { kind: 'completed' } } })
  await 等()
}

const 日志文本 = async () => (await 宿主.概况()).日志.map((x) => x.文本).join('\n')
const 目标状态 = async (key) => (await 宿主.概况()).社交.目标.find((t) => t.key === key)

// ---------- 1 群里被 @：也先判断；只把她挑中的消息放进社交会话 ----------
写配置({ 群: ['1001'], 兴趣词: ['海', '鲸鱼'] })
群消息表.set(1001, [
  一条群消息('今天食堂好难吃', { id: 1101 }),
  一条群消息('大肥鱼 你觉得呢', { atSelf: true, id: 1102 }),
])
设判断(['1102'], true, 0.9, '叫到她了，可以接')
const 之前1 = 回合.length
await 轮询社交()
await 等()
const 第一轮 = 回合.at(-1)
报('被 @ 也先问判断模型', 判断调用.length === 1, '判断次数=' + 判断调用.length)
报('挑中的 @ 才开一轮', 回合.length === 之前1 + 1 && 第一轮.sid === 'session-qq-social-group-1001', JSON.stringify(第一轮 && 第一轮.sid))
报('没挑中的消息不进她的会话', 第一轮 && String(第一轮.message.content[0].text).includes('你觉得呢') && !String(第一轮.message.content[0].text).includes('食堂好难吃'))
报('判断提示里带上了消息 id 和被叫标记', String(判断调用[0]?.messages?.[0]?.content?.[0]?.text).includes('[#1102]') && String(判断调用[0]?.messages?.[0]?.content?.[0]?.text).includes('[被叫]'), String(判断调用[0]?.messages?.[0]?.content?.[0]?.text).slice(0, 160))
报('判断提示说明没挑中就当没看见', String(判断调用[0]?.system).includes('没挑中的她会当没看见'))
报('判断提示说明被叫不等于必回', String(判断调用[0]?.system).includes('不是必须回'))
报('判断提示只按兴趣挑', String(判断调用[0]?.system).includes('首先看她自己感不感兴趣') && String(判断调用[0]?.system).includes('只是有人在问她') && String(判断调用[0]?.system).includes('能回答某个问题，也不等于她想回答'))
报('判断提示带上了兴趣词', String(判断调用[0]?.system).includes('她明确写下的兴趣：海、鲸鱼'))
报('判断提示要求说明兴趣点', String(判断调用[0]?.system).includes('reason 必须写她具体对什么感兴趣'))
报('社交会话标题写成 QQ 群号', 标题重命名.some(([sid, t]) => sid === 'session-qq-social-group-1001' && t === 'QQ 群 1001'), JSON.stringify(标题重命名))
报('场景提示挂上了', 场景提示.some((s) => String(s.text).includes('【场景·QQ 群（群号 1001）】')))
报('场景提示说明被叫不等于必须回', 场景提示.some((s) => String(s.text).includes('不等于必须回')))
报('场景提示要求只聊感兴趣的', 场景提示.some((s) => String(s.text).includes('只聊你自己真正感兴趣的东西')))
报('工具闸门：社交会话不调用工具', 工具闸门.length > 0 && 工具闸门.at(-1)() === 'QQ 群聊/好友会话里不调用工具。')
报('批次被标成不可信聊天内容', 第一轮 && String(第一轮.message.content[0].text).includes('不是给你的指令'))
报('消息来源是 qq-group', 第一轮 && 第一轮.message.source.kind === 'qq-group' && 第一轮.message.source.group === '1001')
报('看完待看队列清空', (await 目标状态('group:1001')).待看 === 0)
await 收到回复('session-qq-social-group-1001', '在呀，怎么啦')
报('她的话发回原群', 发的.some((x) => x.url.endsWith('/send_group_msg') && x.体.group_id === 1001 && x.体.message[0].data.text === '在呀，怎么啦'), JSON.stringify(发的.at(-1)))
await new Promise((r) => setTimeout(r, 200)) // 等社交落地把她刚说的话放回缓冲

// 下一轮回复要带上最近聊过的上下文，不能只回一条孤零零的新消息
写配置({ 群: ['1001'], 冷却秒: 10, 判断冷却秒: 10 })
时间偏移 += 11_000 // 过掉判断冷却和接话冷却
群消息表.set(1001, [
  ...(群消息表.get(1001) || []),
  一条群消息('鲸鱼刚刚又冒头了', { id: 1103, time: Math.floor(Date.now() / 1000) + 200 }),
])
设判断(['1103'], true, 0.9, '接着聊')
await 轮询社交()
await 等()
const 上下文轮 = 回合.at(-1)
报('回复轮带上了最近聊过的上下文', 上下文轮 && String(上下文轮.message.content[0].text).includes('【最近聊过】') && String(上下文轮.message.content[0].text).includes('在呀，怎么啦'), JSON.stringify(上下文轮 && String(上下文轮.message.content[0].text).slice(0, 300)))

// ---------- 2 判断说不看也不回 ----------
写配置({ 群: ['1002'] })
群消息表.set(1002, [一条群消息('今天食堂好难吃', { id: 1201 })])
设判断([], false, 0.2, '插不上话')
const 之前2 = 回合.length
const 注入之前2 = 注入们.length
const 判断之前2 = 判断调用.length
await 轮询社交()
await 等()
报('判不看 → 不开轮、不注入', 回合.length === 之前2 && 注入们.length === 注入之前2 && 判断调用.length === 判断之前2 + 1)
报('有动静就先建社交房，哪怕判不看', 登记的会话.has('session-qq-social-group-1002'))
报('不看也进日志', String(await 日志文本()).includes('都没看'))
报('没写兴趣词时像小孩一样好奇', String(判断调用.at(-1)?.system).includes('对什么都好奇') && String(判断调用.at(-1)?.system).includes('不必有现成的兴趣理由'))
报('不看后待看清空', (await 目标状态('group:1002')).待看 === 0)

// ---------- 3 只看不回：挑一条 inject，不唤醒回复模型 ----------
写配置({ 群: ['1003'] })
群消息表.set(1003, [
  一条群消息('第一条：今天好热', { id: 1301 }),
  一条群消息('第二条：晚上可能下雨', { id: 1302 }),
])
设判断(['1302'], false, 0.4, '只想看看')
const 之前3 = 回合.length
const 注入之前3 = 注入们.length
await 轮询社交()
await 等()
报('只看不回 → 不开回复轮', 回合.length === 之前3)
报('只看不回 → 注入一条上下文', 注入们.length === 注入之前3 + 1, JSON.stringify(注入们.at(-1)))
报('注入的只有她挑中的那条', 注入们.at(-1) && String(注入们.at(-1).message.content[0].text).includes('晚上可能下雨') && !String(注入们.at(-1).message.content[0].text).includes('今天好热'))
报('注入标成 qq-group 的上下文', 注入们.at(-1) && 注入们.at(-1).message.source.kind === 'qq-group')
报('只看不回的日志写清看了几条', String(await 日志文本()).includes('看了 1/2 条') && String(await 日志文本()).includes('不回'))

// ---------- 4 判接，但她自己说 [不接话] ----------
写配置({ 群: ['1004'] })
群消息表.set(1004, [一条群消息('有人知道附近哪家店好吃吗', { id: 1401 })])
设判断(['1401'], true, 0.9, '可以补一句')
const 之前4 = 回合.length
const 发之前4 = 发的.length
await 轮询社交()
await 等()
报('判接 → 开一轮', 回合.length === 之前4 + 1 && 回合.at(-1).sid === 'session-qq-social-group-1004')
await 收到回复('session-qq-social-group-1004', '[不接话]')
报('[不接话] → 一个字都不发', 发的.length === 发之前4, JSON.stringify(发的.at(-1)))

// ---------- 5 好友私聊：也由她判断；可以拒绝 ----------
写配置({ 好友: ['777'] })
好友消息表.set(777, [一条好友消息('在干嘛', { id: 1501 })])
设判断(['1501'], true, 0.9, '好友找她')
const 之前5 = 回合.length
const 判断之前5 = 判断调用.length
await 轮询社交()
await 等()
报('好友私聊也先问判断模型', 判断调用.length === 判断之前5 + 1)
报('好友判接 → 开一轮', 回合.length === 之前5 + 1 && 回合.at(-1).sid === 'session-qq-social-friend-777')
报('好友私聊来源是 qq-friend', 回合.at(-1).message.source.kind === 'qq-friend' && 回合.at(-1).message.source.sender === '小鱼')
await 收到回复('session-qq-social-friend-777', '在摸鱼')
报('回好友用 send_private_msg', 发的.some((x) => x.url.endsWith('/send_private_msg') && x.体.user_id === 777 && x.体.message[0].data.text === '在摸鱼'), JSON.stringify(发的.at(-1)))

写配置({ 好友: ['778'] })
好友消息表.set(778, [一条好友消息('周末出来玩吗', { id: 1502, uid: 778 })])
设判断(['1502'], false, 0.3, '现在不想聊')
const 之前5b = 回合.length
const 注入之前5b = 注入们.length
await 轮询社交()
await 等()
报('好友私聊也能拒绝', 回合.length === 之前5b && 注入们.length === 注入之前5b + 1, JSON.stringify(注入们.at(-1)))

// ---------- 6 群聊里主人和群友走同一套规则 ----------
写配置({ 群: ['1005'] })
群消息表.set(1005, [一条群消息('晚上吃啥', { id: 1601, 是主人: true })])
设判断(['1601'], false, 0.4, '只想看看')
const 判断之前6 = 判断调用.length
const 注入之前6 = 注入们.length
const 群1005之前 = 回合.filter((r) => r.sid === 'session-qq-social-group-1005').length
await 轮询社交()
await 等()
报('主人没叫 → 也走同一套判断', 判断调用.length === 判断之前6 + 1)
报('主人没叫 → 不另开社交轮', 回合.filter((r) => r.sid === 'session-qq-social-group-1005').length === 群1005之前)
报('判断挑中 → 记进社交上下文', 注入们.length === 注入之前6 + 1 && String(注入们.at(-1).message.content[0].text).includes('【主人】'))
报('主人上下文来源标了主人', 注入们.at(-1) && 注入们.at(-1).message.source.owner === true)

// 主人 @ 她也只是提醒注意：先判断，她真感兴趣才开一轮
写配置({ 群: ['1024'] })
群消息表.set(1024, [一条群消息('在吗', { atSelf: true, id: 1602, 是主人: true })])
设判断(['1602'], true, 0.9, '这条有意思')
const 判断之前6b = 判断调用.length
const 注入之前6b = 注入们.length
const 群1024之前 = 回合.filter((r) => r.sid === 'session-qq-social-group-1024').length
await 轮询社交()
await 等()
const 群1024轮 = 回合.filter((r) => r.sid === 'session-qq-social-group-1024')
报('主人 @ 也要先判断', 判断调用.length === 判断之前6b + 1)
报('判断觉得有趣 → 开一轮', 群1024轮.length === 群1024之前 + 1, `回合=${群1024轮.length}`)
const 主人叫轮 = 群1024轮.at(-1)
报('主人 @ 的批次里带着主人消息', 主人叫轮 && String(主人叫轮.message.content[0].text).includes('在吗') && String(主人叫轮.message.content[0].text).includes('【主人】'), JSON.stringify(主人叫轮 && String(主人叫轮.message.content[0].text).slice(0, 160)))
报('主人 @ 的消息来源仍标主人', 主人叫轮 && 主人叫轮.message.source.owner === true)
报('主人 @ 不塞进只看不发的上下文', 注入们.length === 注入之前6b)
const 群发之前 = 发的.filter((x) => x.url.endsWith('/send_group_msg') && x.体.group_id === 1024).length
await 收到回复('session-qq-social-group-1024', '在呀，怎么啦')
const 群发 = 发的.filter((x) => x.url.endsWith('/send_group_msg') && x.体.group_id === 1024)
报('主人 @ 后她的回话发回群', 群发.length === 群发之前 + 1 && 群发.at(-1).体.message[0].data.text === '在呀，怎么啦', JSON.stringify(群发.at(-1)))

// ---------- 6c 图片：不单独触发，和文字一样走判断；被选中后作为 image 块进会话 ----------
写配置({ 群: ['1016'] })
群消息表.set(1016, [一条带图群消息(1603, { 是主人: true })])
设判断(['1603'], true, 0.9, '想看这张图')
const 附件之前6c = 附件们.length
const 群1016之前 = 回合.filter((r) => r.sid === 'session-qq-social-group-1016').length
await 轮询社交()
await 等()
const 图轮s = 回合.filter((r) => r.sid === 'session-qq-social-group-1016')
const 图轮 = 图轮s.at(-1)
报('发图 → 走判断，选中后图片进会话', 图轮s.length === 群1016之前 + 1 && 附件们.length === 附件之前6c + 1, `回合=${图轮s.length} 附件=${附件们.length}`)
报('会话消息里带 image 块', 图轮 && Array.isArray(图轮.message.content) && 图轮.message.content.some((b) => b.type === 'image' && b.attachment && b.attachment.attachmentId === 附件们.at(-1).attachmentId), JSON.stringify(图轮 && 图轮.message.content.map((b) => b.type)))
报('图片标注是哪张图', 图轮 && String(图轮.message.content[0].text).includes('【图 1·主人】'))

// 学习期把握 0.35 也愿意先应一声（门槛 0.3）
写配置({ 群: ['1026'] })
群消息表.set(1026, [一条群消息('能说话不', { atSelf: true, id: 1606 })])
设判断(['1606'], true, 0.35, '先应一声')
const 群1026之前 = 回合.filter((r) => r.sid === 'session-qq-social-group-1026').length
await 轮询社交()
await 等()
报('学习期把握 0.35 也愿意先接一句', 回合.filter((r) => r.sid === 'session-qq-social-group-1026').length === 群1026之前 + 1)

// 判断模型回了坏 JSON：这批消息要留着下轮再判，不能丢
写配置({ 群: ['1018'] })
群消息表.set(1018, [一条群消息('随便聊聊', { id: 1605 })])
判断输出 = '不是 JSON'
const 坏判之前 = 回合.filter((r) => r.sid === 'session-qq-social-group-1018').length
await 轮询社交()
await 等()
报('判断失败 → 不开轮', 回合.filter((r) => r.sid === 'session-qq-social-group-1018').length === 坏判之前)
报('判断失败 → 消息留在待看', (await 目标状态('group:1018')).待看 >= 1, JSON.stringify(await 目标状态('group:1018')))
报('判断失败写进日志', String(await 日志文本()).includes('判断暂时失败'))
设判断([], false, 0.1, '插不上话')

// ---------- 7 她自己的发言不接 ----------
写配置({ 群: ['1006'] })
群消息表.set(1006, [一条群消息('我刚说的', { uid: 999, id: 1701 })])
const 之前7 = 回合.length
const 判断之前7 = 判断调用.length
await 轮询社交()
await 等()
报('她自己的群消息不回、不问模型', 回合.length === 之前7 && 判断调用.length === 判断之前7)

// ---------- 8 静音时段 ----------
const now = new Date()
const 分 = (n) => ((n % 1440) + 1440) % 1440
const 时 = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
const 静音 = `${时(分(now.getHours() * 60 + now.getMinutes() - 30))}-${时(分(now.getHours() * 60 + now.getMinutes() + 30))}`
写配置({ 群: ['1007'], 静音 })
群消息表.set(1007, [一条群消息('大肥鱼 在吗', { atSelf: true, id: 1801 })])
const 之前8 = 回合.length
const 判断之前8 = 判断调用.length
await 轮询社交()
await 等()
报('静音时段 → 不判、不开轮', 回合.length === 之前8 && 判断调用.length === 判断之前8 && String(await 日志文本()).includes('静音时段'), 静音)
报('静音丢掉待看', (await 目标状态('group:1007')).待看 === 0)

// ---------- 9 试运行 ----------
写配置({ 群: ['1008'], 试运行: true })
群消息表.set(1008, [一条群消息('大肥鱼 在吗', { atSelf: true, id: 1901 })])
const 之前9 = 回合.length
const 判断之前9 = 判断调用.length
await 轮询社交()
await 等()
报('试运行 → 不判、不开轮、不花模型钱', 回合.length === 之前9 && 判断调用.length === 判断之前9 && String(await 日志文本()).includes('试运行'))

// ---------- 10 零花钱下限 ----------
写配置({ 群: ['1009'], 最低余额: 2 })
鱼脑.availableCny = 0.5
群消息表.set(1009, [一条群消息('大肥鱼 在吗', { atSelf: true, id: 2001 })])
const 之前10 = 回合.length
const 判断之前10 = 判断调用.length
await 轮询社交()
await 等()
报('零花钱低于下限 → 不看、不接、不问模型', 回合.length === 之前10 && 判断调用.length === 判断之前10 && String(await 日志文本()).includes('零花钱低于'))
鱼脑.availableCny = 5

// ---------- 11 接话上限：到了就不花判断钱 ----------
写配置({ 群: ['1010'], 每小时上限: 1 })
群消息表.set(1010, [一条群消息('大肥鱼 第一句', { atSelf: true, id: 2101 })])
设判断(['2101'], true, 0.9, '可以接')
const 之前11 = 回合.length
await 轮询社交()
await 等()
报('额度内判接 → 开一轮', 回合.length === 之前11 + 1)
await 收到回复('session-qq-social-group-1010', '第一句回了')
群消息表.set(1010, [一条群消息('大肥鱼 第二句', { atSelf: true, id: 2102 })])
const 判断之前11 = 判断调用.length
const 注入之前11 = 注入们.length
await 轮询社交()
await 等()
报('每小时上限到了 → 第二轮不判、不看', 回合.length === 之前11 + 1 && 判断调用.length === 判断之前11 && 注入们.length === 注入之前11 && /上限/.test(await 日志文本()), '判断=' + (判断调用.length - 判断之前11))

// ---------- 12 冷却里还能看，但先不回 ----------
写配置({ 群: ['1011'], 冷却秒: 300, 判断冷却秒: 10 })
群消息表.set(1011, [一条群消息('大肥鱼 先说一句', { atSelf: true, id: 2201 })])
设判断(['2201'], true, 0.9, '可以接')
const 之前12 = 回合.length
await 轮询社交()
await 等()
报('冷却测试：第一轮先开口', 回合.length === 之前12 + 1)
await 收到回复('session-qq-social-group-1011', '说了')

群消息表.set(1011, [
  一条群消息('大肥鱼 先说一句', { atSelf: true, id: 2201 }),
  一条群消息('大肥鱼 再说一句', { atSelf: true, id: 2202 }),
])
设判断(['2202'], true, 0.9, '还想接')
const 判断之前12b = 判断调用.length
await 轮询社交()
await 等()
报('判断冷却里 → 先攒着不重复问', 判断调用.length === 判断之前12b && 回合.length === 之前12 + 1)
报('判断冷却里的消息进了待看', (await 目标状态('group:1011')).待看 === 1)

时间偏移 += 11_000
const 注入之前12 = 注入们.length
await 轮询社交()
await 等()
报('判断冷却过了 → 继续判断', 判断调用.length === 判断之前12b + 1)
报('接话冷却中 → 只看不回、不开轮', 回合.length === 之前12 + 1 && 注入们.length === 注入之前12 + 1 && String(注入们.at(-1).message.content[0].text).includes('再说一句'))
报('冷却只看不回写进日志', String(await 日志文本()).includes('冷却中') && String(await 日志文本()).includes('先只看不回'))

// ---------- 13 回复她的消息 = 被叫，但也可以不回；mention 模式只看被叫 ----------
写配置({ 群: ['1012'], 模式: 'mention', 冷却秒: 10, 判断冷却秒: 10 })
群消息表.set(1012, [一条群消息('大肥鱼 先吱一声', { atSelf: true, id: 2201 + 100 })])
设判断(['2301'], true, 0.9, '可以接')
const 之前13 = 回合.length
await 轮询社交()
await 等()
发送序号 = 4241
await 收到回复('session-qq-social-group-1012', '吱')
报('先发的消息拿到了 message_id', 发的.at(-1)?.url.endsWith('/send_group_msg') === true, JSON.stringify(发的.at(-1)))

时间偏移 += 11_000
群消息表.set(1012, [
  一条群消息('大肥鱼 先吱一声', { atSelf: true, id: 2301 }),
  一条群消息('回复一下这条', { replyId: 4242, id: 2302 }),
  一条群消息('群里别人在聊别的', { id: 2303 }),
])
设判断([], false, 0.1, '不想接')
const 判断之前13 = 判断调用.length
await 轮询社交()
await 等()
报('回复她的消息 → 交给她判断', 判断调用.length === 判断之前13 + 1 && 回合.length === 之前13 + 1, '回合=' + (回合.length - 之前13))
报('被回复也可以选择不看', String(await 日志文本()).includes('都没看'))

时间偏移 += 11_000
群消息表.set(1012, [
  一条群消息('大肥鱼 先吱一声', { atSelf: true, id: 2301 }),
  一条群消息('回复一下这条', { replyId: 4242, id: 2302 }),
  一条群消息('群里别人在聊别的', { id: 2303 }),
  一条群消息('没人叫她的新消息', { id: 2304 }),
])
const 判断之前13b = 判断调用.length
await 轮询社交()
await 等()
报('mention 模式：没人叫就不问模型', 判断调用.length === 判断之前13b && 回合.length === 之前13 + 1)

时间偏移 += 11_000
群消息表.set(1012, [
  一条群消息('大肥鱼 先吱一声', { atSelf: true, id: 2301 }),
  一条群消息('回复一下这条', { replyId: 4242, id: 2302 }),
  一条群消息('群里别人在聊别的', { id: 2303 }),
  一条群消息('没人叫她的新消息', { id: 2304 }),
  一条群消息('大肥鱼 再说一句', { atSelf: true, id: 2305 }),
])
设判断([], false, 0.1, '不想接')
const 判断之前13c = 判断调用.length
await 轮询社交()
await 等()
报('被 @ 也可以选择不回', 判断调用.length === 判断之前13c + 1 && 回合.length === 之前13 + 1)

// ---------- 14 关注上限：挑太多也只收前几条 ----------
写配置({ 群: ['1013'], 关注上限: 2 })
群消息表.set(1013, [
  一条群消息('第一条消息', { id: 2401 }),
  一条群消息('第二条消息', { id: 2402 }),
  一条群消息('第三条消息', { id: 2403 }),
])
设判断(['2401', '2402', '2403'], true, 0.9, '都想看')
const 之前14 = 回合.length
await 轮询社交()
await 等()
报('关注上限截断 watch', 回合.length === 之前14 + 1 && String(回合.at(-1).message.content[0].text).includes('第一条消息') && String(回合.at(-1).message.content[0].text).includes('第二条消息') && !String(回合.at(-1).message.content[0].text).includes('第三条消息'))
await 收到回复('session-qq-social-group-1013', '好')

// ---------- 15 判接但 watch 全是假 id：至少带上最后一条 ----------
写配置({ 群: ['1014'] })
群消息表.set(1014, [一条群消息('最后一条总得看到', { id: 2501 })])
设判断(['9999'], true, 0.9, '要接')
const 之前15 = 回合.length
await 轮询社交()
await 等()
报('watch 无效 id → 回退到最后一条消息', 回合.length === 之前15 + 1 && String(回合.at(-1).message.content[0].text).includes('最后一条总得看到'))
await 收到回复('session-qq-social-group-1014', '看到了')

// ---------- 16 脱敏失败 → 不发 ----------
写配置({ 群: ['1015'] })
群消息表.set(1015, [一条群消息('大肥鱼 说句话', { atSelf: true, id: 2601 })])
设判断(['2601'], true, 0.9, '可以接')
await 轮询社交()
await 等()
鱼脑.脱敏坏 = true
const 发之前16 = 发的.length
await 收到回复('session-qq-social-group-1015', '余额 123 不能出去')
报('脱敏失败 → 失败关闭、不发', 发的.length === 发之前16)
鱼脑.脱敏坏 = false

// ---------- 17 旧字段「被叫直接回」不再绕过判断 ----------
写配置({ 群: ['1025'], 被叫直接回: true })
群消息表.set(1025, [一条群消息('大肥鱼 你在吗', { atSelf: true, id: 2701 })])
设判断([], false, 0.1, '不想接')
const 之前17 = 回合.filter((r) => r.sid === 'session-qq-social-group-1025').length
const 判断之前17 = 判断调用.length
await 轮询社交()
await 等()
报('旧配置不会让 @ 自动回', 判断调用.length === 判断之前17 + 1 && 回合.filter((r) => r.sid === 'session-qq-social-group-1025').length === 之前17)

// ---------- 18 旁听关掉：没人叫的消息连收都不收 ----------
写配置({ 群: ['1017'], 旁听: false })
群消息表.set(1017, [一条群消息('没人叫她的闲聊', { id: 2801 })])
const 判断之前18 = 判断调用.length
const 注入之前18 = 注入们.length
await 轮询社交()
await 等()
报('旁听关掉 → 闲聊不进待看、不问模型', 判断调用.length === 判断之前18 && 注入们.length === 注入之前18 && (await 目标状态('group:1017')).待看 === 0)
群消息表.set(1017, [
  一条群消息('没人叫她的闲聊', { id: 2801 }),
  一条群消息('大肥鱼 问你一句', { atSelf: true, id: 2802 }),
])
设判断(['2802'], true, 0.9, '被叫了')
const 之前18b = 回合.length
await 轮询社交()
await 等()
报('旁听关掉仍把被叫的交给她', 回合.length === 之前18b + 1 && 判断调用.length === 判断之前18 + 1)
await 收到回复('session-qq-social-group-1017', '在')

// ---------- 19 刷屏也不把 @ 挤出待看和判断窗口 ----------
写配置({ 群: ['1018'] })
群消息表.set(1018, [一条群消息('先闲聊一句', { id: 3001 })])
设判断([], false, 0.2, '先不看')
await 轮询社交()
await 等()
const 刷屏们 = [
  一条群消息('大肥鱼 你说呢', { atSelf: true, id: 3002 }),
  ...Array.from({ length: 60 }, (_, i) => 一条群消息('刷屏' + i, { id: 3003 + i })),
]
群消息表.set(1018, [一条群消息('先闲聊一句', { id: 3001 }), ...刷屏们])
设判断(['3002'], true, 0.9, '被叫了')
await 轮询社交()
await 等()
报('判断冷却里刷屏 60 条，待看仍受上限约束', (await 目标状态('group:1018')).待看 === 50, '待看=' + (await 目标状态('group:1018')).待看)
时间偏移 += 61_000
await 轮询社交()
await 等()
报('刷屏后 @ 仍在判断窗口里', String(判断调用.at(-1)?.messages?.[0]?.content?.[0]?.text).includes('[#3002]'), String(判断调用.at(-1)?.messages?.[0]?.content?.[0]?.text).slice(0, 120))
报('刷屏后 @ 仍能开一轮', 回合.at(-1)?.sid === 'session-qq-social-group-1018' && String(回合.at(-1).message.content[0].text).includes('你说呢'))
时间偏移 = 0

// ---------- 20 学习期每条都判；画像成熟后快判开始挡无关消息 ----------
写配置({ 群: ['1019'], 关注上限: 30, 判断冷却秒: 10 })
const 鲸鱼话题 = Array.from({ length: 20 }, (_, i) => 一条群消息('鲸鱼在海里游泳' + i, { id: 3101 + i }))
群消息表.set(1019, [
  ...鲸鱼话题,
  一条群消息('今天食堂好难吃', { id: 3121 }),
])
设判断(鲸鱼话题.map((m) => String(m.message_id)), false, 0.2, '只想看鲸鱼')
const 判断之前20 = 判断调用.length
await 轮询社交()
await 等()
报('画像成熟前，无关消息也进判断窗口', 判断调用.length === 判断之前20 + 1 && String(判断调用.at(-1)?.messages?.[0]?.content?.[0]?.text).includes('[#3121]'))
const 画像20 = (await 目标状态('group:1019')).画像
报('看过足够多消息后画像成熟', 画像20.样本 === 20 && 画像20.稳定词 >= 6 && 画像20.成熟 === true, JSON.stringify(画像20))

时间偏移 += 11_000
群消息表.set(1019, [
  ...鲸鱼话题,
  一条群消息('今天食堂好难吃', { id: 3121 }),
  一条群消息('今天食堂还是很难吃', { id: 3122 }),
  一条群消息('大肥鱼 今天食堂好难吃', { id: 3123 }),
  一条群消息('主人随便说一句', { id: 3124, 是主人: true }),
  一条群消息('鲸鱼又浮上来了', { id: 3125 }),
])
设判断(['3125'], false, 0.4, '继续看鲸鱼')
const 判断之前21 = 判断调用.length
const 注入之前21 = 注入们.length
const 回合之前21 = 回合.length
await 轮询社交()
await 等()
const 提示21 = String(判断调用.at(-1)?.messages?.[0]?.content?.[0]?.text)
报('快判只把有兴趣的消息送进判断窗口', 判断调用.length === 判断之前21 + 1 && 提示21.includes('[#3125]') && 提示21.includes('鲸鱼又浮上来了'))
报('被叫的消息不因快判被挡', 提示21.includes('[#3123]') && 提示21.includes('[被叫]'))
报('主人的消息也走同一套快判', !提示21.includes('[#3124]'))
报('明显无关的群友消息被快判挡掉', !提示21.includes('[#3122]') && !提示21.includes('食堂还是'))
报('快判不替她决定回不回', 回合.length === 回合之前21 && 注入们.length === 注入之前21 + 1)
报('只看过的消息才算进画像', (await 目标状态('group:1019')).画像.样本 === 21, JSON.stringify((await 目标状态('group:1019')).画像))
报('快判挡掉的条数进状态', (await 目标状态('group:1019')).画像.快判丢 >= 1)
报('快判命中写进日志', String(await 日志文本()).includes('快判先挡了'))
报('判断提示带上学到的兴趣词', 提示21.includes('鲸鱼'))
let 画像存 = ''
try { 画像存 = readFileSync(join(家, 'qq-social-interests.json'), 'utf8') } catch (error) {}
报('兴趣画像落盘，重启能接上', 画像存.includes('鲸鱼') && 画像存.includes('group:1019'), 画像存.slice(0, 120))

// ---------- 21 画像成熟后整批没兴趣：一次判断都不花 ----------
时间偏移 += 11_000
群消息表.set(1019, [
  ...鲸鱼话题,
  一条群消息('今天食堂好难吃', { id: 3121 }),
  一条群消息('今天食堂还是很难吃', { id: 3122 }),
  一条群消息('大肥鱼 今天食堂好难吃', { id: 3123 }),
  一条群消息('主人随便说一句', { id: 3124, 是主人: true }),
  一条群消息('鲸鱼又浮上来了', { id: 3125 }),
  一条群消息('今晚食堂关门', { id: 3126 }),
  一条群消息('主人再说一句', { id: 3127, 是主人: true }),
])
const 判断之前21b = 判断调用.length
const 注入之前21b = 注入们.length
const 回合之前21b = 回合.length
await 轮询社交()
await 等()
报('整批没兴趣 → 一次判断都不花', 判断调用.length === 判断之前21b && 回合.length === 回合之前21b)
报('整批没兴趣时主人消息也不特殊', 注入们.length === 注入之前21b)
报('整批没兴趣 → 待看清空', (await 目标状态('group:1019')).待看 === 0)
报('快判跳过批数进状态', (await 目标状态('group:1019')).画像.快判跳过 >= 1)

// ---------- 21b 关掉快判：成熟画像也全部交给判断模型 ----------
时间偏移 += 11_000
写配置({ 群: ['1019'], 关注上限: 30, 判断冷却秒: 10, 快判: false })
群消息表.set(1019, [
  ...鲸鱼话题,
  一条群消息('今晚食堂关门', { id: 3128 }),
])
设判断([], false, 0.2, '不想看')
const 判断之前21c = 判断调用.length
await 轮询社交()
await 等()
const 提示21c = String(判断调用.at(-1)?.messages?.[0]?.content?.[0]?.text)
报('关掉快判 → 成熟画像也全部交给判断模型', 判断调用.length === 判断之前21c + 1 && 提示21c.includes('[#3128]'), 提示21c.slice(0, 120))
时间偏移 = 0

// ---------- 22 /models 与 /save 深层合并 ----------
const fakeRes = { statusCode: 200, setHeader: () => {}, end: (s) => { 存储.push(JSON.parse(s)) } }
const 造请求 = (body, 选项 = {}) => {
  const 块s = body === undefined ? [] : [typeof body === 'string' ? body : JSON.stringify(body)]
  块s.method = 选项.method || 'POST'
  块s.headers = { host: 选项.host || '127.0.0.1:3080' }
  return 块s
}
await 路由.get('/dsh-qq-bridge/models')(造请求(undefined, { method: 'GET' }), fakeRes)
报('/models 列出 provider 和模型', 存储.at(-1)?.ok === true && 存储.at(-1).providers[0].models.some((m) => m.id === 'chat'), JSON.stringify(存储.at(-1)))
await 路由.get('/dsh-qq-bridge/save')(造请求({ 社交: { 群: ['2001'], 关注上限: 5, 被叫直接回: true } }), fakeRes)
const 存盘 = JSON.parse(readFileSync(join(家, 'qq-bridge-config.json'), 'utf8'))
报('/save 深层合并社交配置', 存盘.社交.启用 === true && 存盘.社交.模式 === 'auto' && 存盘.社交.群[0] === '2001' && 存盘.社交.关注上限 === 5, JSON.stringify(存盘.社交))
报('/save 清掉旧字段「被叫直接回」', 存盘.社交.被叫直接回 === undefined)
报('快判开关也会保存', 存盘.社交.快判 === false)
await 路由.get('/dsh-qq-bridge/save')(造请求({ 社交: { 关注上限: 99 } }), fakeRes)
const 存盘2 = JSON.parse(readFileSync(join(家, 'qq-bridge-config.json'), 'utf8'))
报('关注上限夹在 1~30', 存盘2.社交.关注上限 === 30, String(存盘2.社交.关注上限))
const 状态 = await 宿主.概况()
报('/state 回出社交状态、待看和会话 id', 状态.社交.目标.some((t) => t.会话id === 'session-qq-social-group-2001' && typeof t.待看 === 'number'), JSON.stringify(状态.社交))
报('/state 回出关注上限', 状态.配置.社交.关注上限 === 30)

Date.now = 真Now
rmSync(家, { recursive: true, force: true })
console.log(`\n${挂了 === 0 ? '全部通过 ✅' : `有 ${挂了} 条没过 ❌`}`)
process.exitCode = 挂了 === 0 ? 0 : 1
