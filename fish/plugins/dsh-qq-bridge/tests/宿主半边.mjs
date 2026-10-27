// 「通到 QQ」宿主半边冒烟测试 —— 假 ctx / 假 fetch 把「DSH → QQ」这半跑一遍。
// 验的是：
//   1) 提取正文：只收 text 块，reasoning / image 不要；空 → ''
//   2) assistant/message + turn/end(completed) → 真的向 NapCat 发一条 send_private_msg
//   3) interrupted 那轮不发；turn/end 不是 completed 不发
//   4) 试运行开着 → 不真发（fetch 不被打）；总开关关着 → 不真发
//   5) /state 路由能回出配置和 NapCat 探活结果
//   6) 连发：文字按空行/句尾拆条，表情包 [发表情:#N] 按写下顺序排进队列、可连发多张、可和话混排
// 跑法： node tests/宿主半边.mjs

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const 家 = mkdtempSync(join(tmpdir(), 'qq-bridge-'))
process.env.DSH_HOME = 家

// 先把配置写好（总开关开、真发、私聊 123），再放两张她已收藏的表情包
writeFileSync(
  join(家, 'qq-bridge-config.json'),
  JSON.stringify({
    总开关: true, 试运行: false, 目标会话: 'session-X', 私聊QQ: '123', 群号: '',
    转私聊: true, 转群: false, NapCat: 'http://127.0.0.1:3000',
  }, null, 2),
  'utf8',
)
writeFileSync(
  join(家, 'qq-stickers.json'),
  JSON.stringify({ version: 2, nextId: 6, items: [
    { id: 2, label: '小兔', emojiId: 'e2', md5: '', bytes: 0, addedAt: 0, source: 'test' },
    { id: 5, label: '鱼片', emojiId: 'e5', md5: '', bytes: 0, addedAt: 0, source: 'test' },
  ] }, null, 2),
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
let 私聊消息段 = null
const 引用消息表 = new Map()
globalThis.fetch = async (url, 选项) => {
  const 体 = JSON.parse((选项 && 选项.body) || '{}')
  const u = String(url)
  if (u.includes('get_login_info')) {
    const 登录 = { status: 'ok', retcode: 0, data: { user_id: 10001, nickname: '大肥鱼' } }
    return { text: async () => JSON.stringify(登录), json: async () => 登录 }
  }
  if (u.endsWith('/get_group_list')) {
    return {
      json: async () => ({
        status: 'ok', retcode: 0,
        data: [{ group_id: 2001, group_name: '摸鱼小分队', group_remark: '不摸鱼群' }],
      }),
    }
  }
  if (u.endsWith('/get_friend_list')) {
    return {
      json: async () => ({
        status: 'ok', retcode: 0,
        data: [{ user_id: 3004, nickname: '小鱿鱼', remark: '鱿鱼' }],
      }),
    }
  }
  if (u.includes('get_friend_msg_history')) {
    return {
      json: async () => ({
        status: 'ok', retcode: 0,
        data: {
          messages: [
            { user_id: 123, time: 私聊消息时间, message_id: 私聊消息id, message_type: 'private', message: 私聊消息段 || [{ type: 'text', data: { text: 私聊消息文本 } }] },
            ...私聊附加,
          ],
        },
      }),
    }
  }
  if (u.endsWith('/get_msg')) {
    const 条 = 引用消息表.get(String(体.message_id))
    if (!条) return { json: async () => ({ status: 'failed', retcode: 1200, data: null }) }
    return { json: async () => ({ status: 'ok', retcode: 0, data: 条 }) }
  }
  if (u.includes('get_forward_msg')) {
    if (体.id === 'res-ok') {
      return {
        json: async () => ({
          status: 'ok', retcode: 0,
          data: {
            messages: [
              { user_id: 321, sender: { nickname: '群友甲' }, message: [{ type: 'text', data: { text: '转发里的一条' } }] },
              { user_id: 321, sender: { nickname: '群友甲' }, message: [{ type: 'image', data: { url: 'https://multimedia.nt.qq.com.cn/f.jpg', file: 'f.jpg' } }] },
            ],
          },
        }),
      }
    }
    return { json: async () => ({ status: 'failed', retcode: 1200, data: null }) }
  }
  if (u.includes('multimedia.nt.qq.com.cn')) {
    // 每张图按地址给不同字节，收藏去重（md5）才分得清是不是同一张。
    const 尾巴 = createHash('md5').update(u).digest()
    const 字节 = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...尾巴.subarray(0, 12)])
    return {
      ok: true,
      url: u,
      headers: { get: (k) => (k === 'content-type' ? 'image/jpeg' : k === 'content-length' ? String(字节.length) : null) },
      async arrayBuffer() { return 字节.buffer },
    }
  }
  if (u.endsWith('/add_custom_face')) {
    发了.push({ url: u, 体 })
    const emojiId = 'qq-' + createHash('md5').update(String(体.file || '')).digest('hex').slice(0, 10)
    return { json: async () => ({ status: 'ok', retcode: 0, data: { emoji_id: emojiId } }) }
  }
  if (u.endsWith('/modify_custom_face')) {
    发了.push({ url: u, 体 })
    return { json: async () => ({ status: 'ok', retcode: 0, data: {} }) }
  }
  发了.push({ url: u, 体 })
  return { json: async () => ({ status: 'ok', retcode: 0, data: { message_id: 1 } }) }
}

// 假鱼脑：真鱼脑在 fish-mind 里，这里只验 QQ 这半「先脱敏、再发」和失败关闭。
const 鱼脑状态 = { 可用: true, 抛出: false, 领过: new Set() }
const 观察到的 = [] // 历史导入写进经历流的条目：验证「没打开开关就一条都不写」
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
报('inject = agents + sessions + sessionTitle + webServer + timer + workspaceRegistry + llm + agentDefaultModel', Array.isArray(模.inject) && 模.inject.join() === 'agents,sessions,sessionTitle,webServer,timer,workspaceRegistry,llm,agentDefaultModel')

const 块 = (type, text) => ({ type, text })
const 正文 = 模.提取正文({ content: [块('reasoning', '想一下'), 块('text', '第一条\n第二条'), 块('image', ''), 块('text', '第三条')] })
报('提取正文：只收 text，reasoning/image 都不要', 正文 === '第一条\n第二条\n第三条', JSON.stringify(正文))
报('提取正文：没有 text → 空串', 模.提取正文({ content: [块('reasoning', 'x')] }) === '')
报('提取思考：消息块里的 reasoning 拿得到', 模.提取思考({ content: [块('reasoning', '先想想他这句什么意思'), 块('text', '正文不要')] }) === '先想想他这句什么意思')
报('提取思考：没有 reasoning 块时退回 stream 里的 reasoning-chunks', 模.提取思考({ content: [块('text', '正文')] }, [
  { type: 'reasoning-chunks', index: 0, dt: [1], texts: ['前半段', '后半段'] },
]) === '前半段后半段')
报('提取思考：都没开思考档 → 空串（不算错）', 模.提取思考({ content: [块('text', '就一句')] }, []) === '')
报('按段拆：空行分段', JSON.stringify(模.按段拆('甲\n\n乙')) === '["甲","乙"]', JSON.stringify(模.按段拆('甲\n\n乙')))
报('按段拆：没有空行时单换行也拆', JSON.stringify(模.按段拆('甲\n乙')) === '["甲","乙"]', JSON.stringify(模.按段拆('甲\n乙')))
报('按段拆：单行不拆、空串为空', JSON.stringify(模.按段拆('就一句')) === '["就一句"]' && JSON.stringify(模.按段拆('')) === '[]')
报('按句拆：句尾断条', JSON.stringify(模.按句拆('甲。乙！丙？')) === '["甲。","乙！","丙？"]', JSON.stringify(模.按句拆('甲。乙！丙？')))
报('按句拆：单句不拆', JSON.stringify(模.按句拆('就一句。')) === '["就一句。"]', JSON.stringify(模.按句拆('就一句。')))
报('拆连发项：多句自动断成几条', JSON.stringify(模.拆连发项('鱼片没有，自己人不能切片。倒是那个小兔话，我听着还挺亲切。')) === '[{"文字":"鱼片没有，自己人不能切片。"},{"文字":"倒是那个小兔话，我听着还挺亲切。"}]', JSON.stringify(模.拆连发项('鱼片没有，自己人不能切片。倒是那个小兔话，我听着还挺亲切。')))
报('拆连发项：空行优先于拆句', JSON.stringify(模.拆连发项('甲。乙。\n\n丙。')) === '[{"文字":"甲。乙。"},{"文字":"丙。"}]', JSON.stringify(模.拆连发项('甲。乙。\n\n丙。')))
报('拆连发项：句拆超限并回上一条', JSON.stringify(模.拆连发项('甲。乙。丙。丁。')) === '[{"文字":"甲。"},{"文字":"乙。"},{"文字":"丙。丁。"}]', JSON.stringify(模.拆连发项('甲。乙。丙。丁。')))
报('拆连发项：段落超限并回上一条，不悄悄丢字', JSON.stringify(模.拆连发项('甲\n\n乙\n\n丙\n\n丁')) === '[{"文字":"甲"},{"文字":"乙"},{"文字":"丙\\n丁"}]', JSON.stringify(模.拆连发项('甲\n\n乙\n\n丙\n\n丁')))
报('拆连发项：限内原样', JSON.stringify(模.拆连发项('甲\n\n乙')) === '[{"文字":"甲"},{"文字":"乙"}]')
报('拆连发项：表情和话按写下顺序混排', JSON.stringify(模.拆连发项('[发表情:#3] 给你[发表情:#5] 都拿去')) === '[{"表情":3},{"文字":"给你"},{"表情":5},{"文字":"都拿去"}]', JSON.stringify(模.拆连发项('[发表情:#3] 给你[发表情:#5] 都拿去')))
报('拆连发项：连写多张表情一条不丢', JSON.stringify(模.拆连发项('[发表情:#1][发表情:#2][发表情:#3]')) === '[{"表情":1},{"表情":2},{"表情":3}]', JSON.stringify(模.拆连发项('[发表情:#1][发表情:#2][发表情:#3]')))
报('拆连发项：[存表情] 是收藏指令，不占发送位', JSON.stringify(模.拆连发项('[存表情:图2:小兔] 收好了[发表情:#4]')) === '[{"文字":"收好了"},{"表情":4}]', JSON.stringify(模.拆连发项('[存表情:图2:小兔] 收好了[发表情:#4]')))
报('拆连发项：被截断的半个 [发表情] 不发出去', JSON.stringify(模.拆连发项('来了[发表情:#')) === '[{"文字":"来了"}]', JSON.stringify(模.拆连发项('来了[发表情:#')))
报('拆连发项：纯表情也算一轮', JSON.stringify(模.拆连发项('[发表情:#7]')) === '[{"表情":7}]', JSON.stringify(模.拆连发项('[发表情:#7]')))
报('收句号：句尾收掉、句中变空格', 模.收句号('今天好累。我先睡啦。') === '今天好累 我先睡啦', JSON.stringify(模.收句号('今天好累。我先睡啦。')))
报('收句号：问号、感叹号、省略号不动', 模.收句号('真的吗？好耶！等我……') === '真的吗？好耶！等我……')
报('收句号：引号前的句号也收', 模.收句号('他说「好。」') === '他说「好」', JSON.stringify(模.收句号('他说「好。」')))
报('收句号：链接原样', 模.收句号('看这个 https://a.b/c。好') === '看这个 https://a.b/c 好', JSON.stringify(模.收句号('看这个 https://a.b/c。好')))
报('收句号：连着的句号当省略号留着', 模.收句号('等一下。。。') === '等一下。。。', JSON.stringify(模.收句号('等一下。。。')))

const 收过装配 = 模.只留聊天提示({
  sections: [
    { name: 'deployment:persona-prefix', text: '人格' },
    { name: 'qq-private-scene', text: '场景' },
    { name: 'system-prompt:identity', text: 'You are an AI agent' },
  ],
  contexts: [
    { name: 'fish-mind-self', text: '私设' },
    { name: 'cwd', text: 'D:/x' },
  ],
  tools: [{ name: 'bash' }],
  variables: { provider: 'fake' },
})
报('只留聊天提示：去掉编码助手段和运行环境', 收过装配.sections.length === 2 && 收过装配.contexts.length === 1, JSON.stringify({ 段: 收过装配.sections.map((s) => s.name), 上下文: 收过装配.contexts.map((c) => c.name) }))
报('只留聊天提示：工具和模型变量原样', 收过装配.tools.length === 1 && 收过装配.variables.provider === 'fake')
报('只留聊天提示：空装配不炸', 模.只留聊天提示(undefined) === undefined)

// ---------- 假 ctx ----------
const 监听 = []
const 路由 = new Map()
const 转进的 = []
const 轮询回调们 = []
let 轮询回调 = null
const 假agent = { followup: (m) => 转进的.push(m), session: { id: 'session-X' } }
const 登记的会话 = new Map([['session-X', 假agent]])
const 场景提示 = []
const 装配监听 = []
const 标题重命名 = []
const 建的工作区 = []
const 挂工作区记录 = []
const 工作区们 = []
const 造工作区 = (路径) => ({
  path: 路径,
  sessionIds: [],
  async attachSession(sid) {
    this.sessionIds.push(String(sid))
    挂工作区记录.push(String(sid))
  },
})
const ctx = {
  on: (名字, cb) => { if (名字 === 'session/event') 监听.push(cb); return () => {} },
  effect: (fn) => { const 摘 = fn(); return () => { try { 摘 && 摘() } catch {} } },
  webServer: { register: (o) => 路由.set(o.path, o.handler) },
  logger: { info: () => {} },
  agents: {
    get: (id) => 登记的会话.get(String(id)),
    list: () => [...登记的会话.values()],
    resume: async () => {
      const e = new Error('no such session')
      e.name = 'SessionPersistenceNotFoundError'
      throw e
    },
    create: async ({ sessionId, meta, setup }) => {
      const sid = String(sessionId)
      const agent = { followup: (m) => 转进的.push(m), session: { id: sid, header: { cwd: meta && meta.cwd } } }
      登记的会话.set(sid, agent)
      if (setup) {
        setup({
          on: (名字, cb, 选项) => {
            if (名字 === 'system-prompt/assemble') 装配监听.push({ cb, 选项 })
            return () => {}
          },
          systemPrompt: { section: (s) => 场景提示.push(s) },
          tools: { guard: () => {} },
        })
      }
      return { agent, dispose: () => { 登记的会话.delete(sid) } }
    },
  },
  sessions: { flush: async () => {} },
  agentDefaultModel: { currentSelection: () => ({ provider: 'fake', model: 'chat' }) },
  sessionTitle: { get: () => undefined, rename: (s, t) => 标题重命名.push([s.id, t]) },
  workspaceRegistry: {
    archivedSessionIds: [],
    list: () => 工作区们,
    resolveByPath: async (路径) => 工作区们.find((w) => w.path === 路径),
    create: async (路径) => {
      const w = 造工作区(路径)
      工作区们.push(w)
      建的工作区.push(路径)
      return w
    },
  },
  interval: (fn) => {
    轮询回调们.push(fn)
    // 主人消息轮询先注册，后面社交桥还会注册一个；这里只认第一个
    if (!轮询回调) 轮询回调 = fn
    return () => {}
  },
  get: (名字) => {
    if (名字 === 'fishMind' && 鱼脑状态.可用) return 假鱼脑
    if (名字 === 'attachments') return 假附件
    return undefined
  },
}

const 附件们 = []
const 附件字节 = new Map()
const 假附件 = {
  imageLimits: {
    maxImageBytes: 5_000_000,
    maxImagesPerMessage: 4,
    maxMessageImageBytes: 10_000_000,
  },
  async saveImages(inputs) {
    return inputs.map((输入) => {
      const ref = { attachmentId: 'att-' + 附件们.length, mediaType: 输入.mediaType, bytes: 输入.data.length, width: 1, height: 1, name: 输入.name }
      附件们.push(ref)
      附件字节.set(ref.attachmentId, 输入.data)
      return ref
    })
  },
  async readImage(ref) {
    const 数据 = 附件字节.get(ref && ref.attachmentId)
    if (!数据) throw new Error('附件不存在')
    return { data: 数据, mediaType: ref.mediaType }
  },
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

// ②c 连发：空行拆段，一段一条私聊；再验单换行也拆
const 之前c = 发了.length
监听[0](会话, 助手消息(81, 1, [块('text', '宝宝\n\n我看看图')], false))
监听[0](会话, 转完(81))
await new Promise((r) => setTimeout(r, 700))
const 连发 = 发了.slice(之前c)
报('连发：空行拆成两条私聊', 连发.length === 2 && 连发.every((x) => x.url.endsWith('/send_private_msg')), JSON.stringify(连发.map((x) => x.体.message[0].data.text)))
报('连发：两条各是一段', 连发.length === 2 && 连发[0].体.message[0].data.text === '宝宝' && 连发[1].体.message[0].data.text === '我看看图', JSON.stringify(连发.map((x) => x.体.message[0].data.text)))
const 之前d = 发了.length
监听[0](会话, 助手消息(82, 1, [块('text', '嗯嗯\n我看图')], false))
监听[0](会话, 转完(82))
await new Promise((r) => setTimeout(r, 700))
报('连发：没有空行时单换行也拆', 发了.slice(之前d).length === 2, JSON.stringify(发了.slice(之前d).map((x) => x.体.message[0].data.text)))
const 之前e = 发了.length
监听[0](会话, 助手消息(83, 1, [块('text', '鱼片没有，自己人不能切片。倒是那个小兔话，我听着还挺亲切。')], false))
监听[0](会话, 转完(83))
await new Promise((r) => setTimeout(r, 700))
报('连发：一整段多句按句尾断成两条，句号收掉', 发了.slice(之前e).length === 2 && 发了.slice(之前e)[0].体.message[0].data.text === '鱼片没有，自己人不能切片' && 发了.slice(之前e)[1].体.message[0].data.text === '倒是那个小兔话，我听着还挺亲切', JSON.stringify(发了.slice(之前e).map((x) => x.体.message[0].data.text)))

// ②d 连发表情：几张表情和话混着写，私聊里按写下顺序一张张、一句句发
const 之前f = 发了.length
监听[0](会话, 助手消息(84, 1, [块('text', '[发表情:#2] 给你[发表情:#5] 都拿去')], false))
监听[0](会话, 转完(84))
await new Promise((r) => setTimeout(r, 1800))
const 表情连发 = 发了.slice(之前f)
报('连发表情：私聊按写下顺序排（表情→话→表情→话）', 表情连发.length === 4
  && 表情连发[0].url.endsWith('/send_custom_face') && 表情连发[0].体.emoji_id === 'e2'
  && 表情连发[1].url.endsWith('/send_private_msg') && 表情连发[1].体.message[0].data.text === '给你'
  && 表情连发[2].url.endsWith('/send_custom_face') && 表情连发[2].体.emoji_id === 'e5'
  && 表情连发[3].url.endsWith('/send_private_msg') && 表情连发[3].体.message[0].data.text === '都拿去',
  JSON.stringify(表情连发.map((x) => (x.url.endsWith('/send_custom_face') ? `[表情 ${x.体.emoji_id}]` : x.体.message[0].data.text))))

// ②e 收藏里没有的编号跳过，不挡后面的话和表情
const 之前g = 发了.length
监听[0](会话, 助手消息(85, 1, [块('text', '[发表情:#99] 还有一张[发表情:#2]')], false))
监听[0](会话, 转完(85))
await new Promise((r) => setTimeout(r, 1300))
const 跳过 = 发了.slice(之前g)
报('连发表情：收藏里没有的编号跳过不挡后面的', 跳过.length === 2
  && 跳过[0].url.endsWith('/send_private_msg') && 跳过[0].体.message[0].data.text === '还有一张'
  && 跳过[1].url.endsWith('/send_custom_face') && 跳过[1].体.emoji_id === 'e2',
  JSON.stringify(跳过.map((x) => (x.url.endsWith('/send_custom_face') ? `[表情 ${x.体.emoji_id}]` : x.体.message[0].data.text))))

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
  社交: { 群: ['2001'], 好友: ['3004'] },
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
  if (选项.url !== undefined) 块s.url = 选项.url
  return 块s
}
await 路由.get('/dsh-qq-bridge/state')(造请求(undefined, { method: 'GET' }), fakeRes)
const 状态 = 存储[0]
报('/state 回出配置', 状态 && 状态.ok === true && 状态.配置 && 状态.配置.总开关 === false, JSON.stringify(状态 && 状态.配置))
报('/state 探到 NapCat 那个号', 状态 && 状态.NapCat状态 && 状态.NapCat状态.昵称 === '大肥鱼' && 状态.NapCat状态.用户 === 10001, JSON.stringify(状态 && 状态.NapCat状态))
const 房名 = Object.fromEntries(((状态 && 状态.社交 && 状态.社交.目标) || []).map((t) => [t.key, t.名]))
报('/state 把群号 / 好友号翻成名字（群名优先，好友备注优先）',
  房名['group:2001'] === '摸鱼小分队' && 房名['friend:3004'] === '鱿鱼', JSON.stringify(房名))

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
  报('/receive 消息形状：role=user + source.kind=qq + 正文对', m.role === 'user' && m.source && m.source.kind === 'qq' && m.content[0].text.startsWith('宝宝你在吗'), JSON.stringify(m))
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

// ⑫b 没填目标会话 → 自动开一间 QQ 私聊专用屋；没有工作区就建一个
writeFileSync(join(家, 'qq-bridge-config.json'), JSON.stringify({
  总开关: true, 试运行: false, 目标会话: '', 私聊QQ: '123', 群号: '', 转私聊: true, 转群: false, NapCat: 'http://127.0.0.1:3000',
}, null, 2), 'utf8')
const 自动房 = 'session-qq-private-123'
收到 = await 收({ text: '没填目标也要能找到你' })
报('/receive：没填目标 → 自动建 QQ 私聊房', 收到 && 收到.ok === true && 登记的会话.has(自动房), JSON.stringify(收到))
报('QQ 私聊房标题写成“QQ 私聊 123”', 标题重命名.some(([sid, t]) => sid === 自动房 && t === 'QQ 私聊 123'), JSON.stringify(标题重命名))
报('QQ 私聊场景提示挂上了', 场景提示.some((s) => String(s.text).includes('【场景·QQ 私聊】')))
const 私聊文字 = 场景提示.map((s) => String(s.text)).join('\n')
报('QQ 私聊场景提示不再讲标点和分条机制', !私聊文字.includes('句尾基本不加句号') && !私聊文字.includes('最多 3 条'), 私聊文字.slice(0, 200))
报('QQ 私聊场景提示要求别开课、别争输赢', 私聊文字.includes('别主动开课') && 私聊文字.includes('不争输赢'))
报('QQ 私聊场景提示要求接图的意思而不是念图', 私聊文字.includes('接的是这张图的意思') && 私聊文字.includes('别报发色') && 私聊文字.includes('明确问细节就照答'))
报('QQ 私聊也挂了提示过滤器', 装配监听.length > 0 && 装配监听.at(-1).选项 && 装配监听.at(-1).选项.prepend === true)
报('没有工作区 → 自动建一个并挂上', 建的工作区.length > 0 && 挂工作区记录.includes(自动房), JSON.stringify({ 建: 建的工作区, 挂: 挂工作区记录 }))
报('私聊消息进了自动房', 转进的.length > 0 && JSON.stringify(转进的.at(-1).content[0].text).includes('没填目标'))
const 之前自动 = 发了.length
监听[0]({ id: 自动房 }, 助手消息(14, 1, [块('text', '自动目标这轮也能发')], false))
监听[0]({ id: 自动房 }, 转完(14))
await new Promise((r) => setTimeout(r, 20))
报('DSH→QQ：自动房这轮也能发回 QQ', 发了.length === 之前自动 + 1 && JSON.stringify(发了.at(-1).体.message[0].data.text).includes('自动目标'), '发出条数=' + 发了.length)
存储.length = 0
await 路由.get('/dsh-qq-bridge/state')(造请求(undefined, { method: 'GET' }), fakeRes)
报('/state 回出自动私聊房和来源', 存储[0] && 存储[0].目标会话 === 自动房 && String(存储[0].目标来源).includes('QQ 私聊专用'), JSON.stringify(存储[0] && { 目标会话: 存储[0].目标会话, 目标来源: 存储[0].目标来源 }))

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
报('/receive：超长正文截断', 收到 && 收到.ok === true && 转进的.length === 之前长 + 1 && 长文.length <= 12200 && 长文.includes('省略'), '长度=' + 长文.length)

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

// ⑯b 合并转发：展开内容进 DSH；拉不到也保留外层文字
私聊消息时间 = Math.floor(Date.now() / 1000) + 1500
私聊附加 = [
  { user_id: 123, time: 私聊消息时间 + 1, message_id: 9401, message: [{ type: 'forward', data: { id: 'res-ok' } }] },
  { user_id: 123, time: 私聊消息时间 + 2, message_id: 9402, message: [{ type: 'text', data: { text: '这个也看看' } }, { type: 'forward', data: { id: 'res-missing' } }] },
]
const 之前转发 = 转进的.length
await 轮询回调()
await new Promise((r) => setTimeout(r, 20))
const 转发文 = 转进的.at(-1)?.content?.[0]?.text || ''
报('轮询：合并转发展开进 DSH', 转进的.length === 之前转发 + 1 && 转发文.includes('[转发消息 2 条]') && 转发文.includes('群友甲：转发里的一条'), JSON.stringify(转发文))
报('轮询：转发里的图也下载并附上', (转进的.at(-1)?.content || []).filter((x) => x.type === 'image').length === 1 && 转发文.includes('【图 1·群友甲】'), JSON.stringify(转进的.at(-1)?.content))
报('轮询：转发拉不到也保留外层文字和占位', 转发文.includes('这个也看看') && 转发文.includes('[转发消息，没展开出来]'), JSON.stringify(转发文))
私聊附加 = []

// ⑯c 引用：被引用的原文带进 DSH；主人桥里按发送人名字标，不写成“你”
私聊消息时间 = Math.floor(Date.now() / 1000) + 1700
引用消息表.set('9601', {
  user_id: 321, message_id: 9601, sender: { card: '群友甲', nickname: '群友甲' },
  message: [{ type: 'text', data: { text: '上次说的电影' } }],
})
引用消息表.set('9602', {
  user_id: 123, message_id: 9602, sender: { card: '主人', nickname: '主人' },
  message: [{ type: 'text', data: { text: '周五去吧' } }],
})
私聊附加 = [
  { user_id: 123, time: 私聊消息时间 + 1, message_id: 9603, message: [{ type: 'reply', data: { id: '9601' } }, { type: 'text', data: { text: '这部我也想看' } }] },
  { user_id: 123, time: 私聊消息时间 + 2, message_id: 9604, message: [{ type: 'reply', data: { id: '9602' } }, { type: 'text', data: { text: '那就订票' } }] },
]
const 之前引用 = 转进的.length
await 轮询回调()
await new Promise((r) => setTimeout(r, 20))
const 引用文 = 转进的.at(-1)?.content?.[0]?.text || ''
报('轮询：引用别人的消息带出原文', 转进的.length === 之前引用 + 1 && 引用文.includes('[引用群友甲：上次说的电影] 这部我也想看'), JSON.stringify(引用文))
报('轮询：引用主人的消息按名字标，不误写成鱼说的', 引用文.includes('[引用主人：周五去吧] 那就订票'), JSON.stringify(引用文))
私聊附加 = []

// ⑯d 主人私聊：摸清打字节奏后，入站消息带一段内部贴合提示（不发给 QQ）
const 之前风格转 = 转进的.length
for (let i = 0; i < 7; i++) {
  私聊消息文本 = ['好呀', '在呢', '我看看哦', '行啦', '晚安哦', '走呀', '好诶'][i]
  私聊消息id = 9501 + i
  私聊消息时间 = Math.floor(Date.now() / 1000) + 2000 + i
  await 轮询回调()
  await new Promise((r) => setTimeout(r, 5))
}
const 风格文 = 转进的.at(-1)?.content?.[0]?.text || ''
报('私聊：摸清主人的打字节奏后，入站消息带内部贴合提示',
  转进的.length === 之前风格转 + 7 && 风格文.includes('说话节奏') && 风格文.includes('内部提示') &&
    风格文.includes('别复述') && 风格文.includes('别让对方看出来'),
  JSON.stringify(风格文.slice(0, 240)))

// ⑯e 私聊：主人说“存下来” → 当场写进 QQ 收藏，提示里带收藏号
writeFileSync(join(家, 'qq-bridge-config.json'), JSON.stringify({
  总开关: true, 试运行: false, 目标会话: 'session-X', 私聊QQ: '123', 群号: '', 转私聊: true, 转群: false, NapCat: 'http://127.0.0.1:3000',
}, null, 2), 'utf8')
私聊附加 = []
私聊消息id = 9701
私聊消息时间 = Math.floor(Date.now() / 1000) + 3000
私聊消息段 = [
  { type: 'image', data: { url: 'https://multimedia.nt.qq.com.cn/green-sticker.gif', file: 'green-sticker.gif', summary: '[动画表情]', sub_type: 1 } },
  { type: 'text', data: { text: '这个绿毛的表情存下来，回头发给我' } },
]
const 之前存 = 转进的.length
await 轮询回调()
await new Promise((r) => setTimeout(r, 30))
const 存后1 = JSON.parse(readFileSync(join(家, 'qq-stickers.json'), 'utf8'))
const 绿 = 存后1.items.find((x) => x.source.includes('主人私聊'))
const 存文 = 转进的.at(-1)?.content?.[0]?.text || ''
报('私聊：主人说存下来 → 表情真写进 QQ 收藏', 转进的.length === 之前存 + 1 && !!绿 && 绿.label === '主人让存', JSON.stringify(存后1.items.map((x) => ({ id: x.id, label: x.label, source: x.source }))))
报('私聊：存下的表情在提示里标成“你收藏的 #N”，并给出按图发送的写法', !!绿 && 存文.includes(`你收藏的 #${绿.id}`) && 存文.includes('【收藏对应】') && 存文.includes('[发表情:图N]'), JSON.stringify(存文.slice(-400)))

// ⑯f 按收藏编号发回：发的就是刚存下的那张，不用她猜
const 之前发回 = 发了.length
监听[0](会话, 助手消息(160, 1, [块('text', `发你 [发表情:#${绿?.id}]`)], false))
监听[0](会话, 转完(160))
await new Promise((r) => setTimeout(r, 700))
const 发回 = 发了.slice(之前发回)
报('私聊：按收藏编号发回 → 发的是刚存下的那张', !!绿 && 发回.length === 2
  && 发回[0].url.endsWith('/send_private_msg') && 发回[0].体.message[0].data.text === '发你'
  && 发回[1].url.endsWith('/send_custom_face') && 发回[1].体.emoji_id === 绿.emojiId && 发回[1].体.user_id === 123,
  JSON.stringify(发回.map((x) => ({ url: x.url, 体: x.体 }))))

// ⑯g 没收藏过的新图：她写 [发表情:图1] → 先存进收藏再发，发的是这一张，不拿像的顶替
私聊附加 = []
私聊消息id = 9711
私聊消息时间 = Math.floor(Date.now() / 1000) + 3100
私聊消息段 = [
  { type: 'image', data: { url: 'https://multimedia.nt.qq.com.cn/blue-sticker.gif', file: 'blue-sticker.gif', summary: '[动画表情]', sub_type: 1 } },
  { type: 'text', data: { text: '这张也发我一下' } },
]
const 之前蓝 = 转进的.length
await 轮询回调()
await new Promise((r) => setTimeout(r, 30))
const 蓝文 = 转进的.at(-1)?.content?.[0]?.text || ''
报('私聊：没让她存的新表情不会先存', 转进的.length === 之前蓝 + 1 && JSON.parse(readFileSync(join(家, 'qq-stickers.json'), 'utf8')).items.length === 存后1.items.length, JSON.stringify(蓝文.slice(-200)))
报('私聊：新表情带上“按图号发回”的提示', 蓝文.includes('【存表情】') && 蓝文.includes('[发表情:图N]'), JSON.stringify(蓝文.slice(-300)))
const 之前图发 = 发了.length
监听[0](会话, 助手消息(161, 1, [块('text', '[发表情:图1] 给你')], false))
监听[0](会话, 转完(161))
await new Promise((r) => setTimeout(r, 900))
const 图发 = 发了.slice(之前图发)
const 图发消息 = 图发.filter((x) => x.url.endsWith('/send_custom_face') || x.url.endsWith('/send_private_msg'))
const 存后2 = JSON.parse(readFileSync(join(家, 'qq-stickers.json'), 'utf8'))
const 蓝 = 存后2.items.find((x) => !存后1.items.some((y) => y.id === x.id))
报('私聊：[发表情:图1] 没收藏过的先存再发，发的是这一张', 图发.some((x) => x.url.endsWith('/add_custom_face'))
  && 图发消息.length === 2
  && 图发消息[0].url.endsWith('/send_custom_face') && 图发消息[0].体.emoji_id === 蓝?.emojiId
  && 图发消息[1].url.endsWith('/send_private_msg') && 图发消息[1].体.message[0].data.text === '给你'
  && !!蓝 && 蓝.label === '表情' && 存后2.items.length === 存后1.items.length + 1,
  JSON.stringify({ 发: 图发.map((x) => x.url), 蓝 }))

// ⑯h 同一张表情再发一次（纯图，不带字）→ 按内容认出收藏号，不把两张说成一张
私聊附加 = []
私聊消息id = 9712
私聊消息时间 = Math.floor(Date.now() / 1000) + 3200
私聊消息段 = [
  { type: 'image', data: { url: 'https://multimedia.nt.qq.com.cn/blue-sticker.gif', file: 'blue-sticker.gif', summary: '[动画表情]', sub_type: 1 } },
]
const 之前重 = 转进的.length
await 轮询回调()
await new Promise((r) => setTimeout(r, 30))
const 重文 = 转进的.at(-1)?.content?.[0]?.text || ''
报('私聊：同一张表情再发一次 → 提示标出“你收藏的 #N”，纯图也能进回合',
  转进的.length === 之前重 + 1 && !!蓝 && 重文.includes(`你收藏的 #${蓝.id}`) && 重文.includes('【收藏对应】'),
  JSON.stringify(重文.slice(0, 320)))

// ⑯i 自动收藏只能起通用名；她真给了短名字就改名，并同步回 QQ 收藏备注
私聊附加 = []
私聊消息id = 9713
私聊消息时间 = Math.floor(Date.now() / 1000) + 3300
私聊消息段 = [
  { type: 'image', data: { url: 'https://multimedia.nt.qq.com.cn/orange-sticker.gif', file: 'orange-sticker.gif', summary: '[动画表情]', sub_type: 1 } },
  { type: 'text', data: { text: '这个也存一下' } },
]
await 轮询回调()
await new Promise((r) => setTimeout(r, 30))
const 存后3 = JSON.parse(readFileSync(join(家, 'qq-stickers.json'), 'utf8'))
const 橙 = 存后3.items.find((x) => !存后2.items.some((y) => y.id === x.id))
const 之前改 = 发了.length
监听[0](会话, 助手消息(162, 1, [块('text', '[存表情:图1:橘猫趴床] 记好了')], false))
监听[0](会话, 转完(162))
await new Promise((r) => setTimeout(r, 700))
const 存后4 = JSON.parse(readFileSync(join(家, 'qq-stickers.json'), 'utf8'))
const 橙改 = 存后4.items.find((x) => x.id === 橙?.id)
const 改发 = 发了.slice(之前改)
报('私聊：[存表情:图1:短名字] 把自动收藏的通用名换成她起的名字', !!橙 && 橙.label === '主人让存' && 橙改?.label === '橘猫趴床', JSON.stringify({ 橙, 橙改 }))
报('私聊：改名同步回 QQ 收藏备注', 改发.some((x) => x.url.endsWith('/modify_custom_face') && x.体.emoji_id === 橙?.emojiId && x.体.desc === '橘猫趴床'), JSON.stringify(改发.map((x) => x.url)))
报('私聊：[存表情] 不占发送位，话照发', 改发.some((x) => x.url.endsWith('/send_private_msg') && x.体.message[0].data.text === '记好了'))
私聊消息段 = null
私聊附加 = []

// ⑰ 历史导入：四个口都在，且没打开开关 / 没鱼脑 / 没令牌时一个字节都不取
假鱼脑.observe = (输入) => { 观察到的.push(输入); return { ok: true, id: 观察到的.length, hash: 'h' + 观察到的.length } }
const 导 = (路径, 方法 = 'POST') => {
  存储.length = 0
  return 路由.get(`/dsh-qq-bridge/${路径}`)(造请求(undefined, { method: 方法 }), fakeRes).then(() => 存储[0])
}
const 写导入配置 = (改动) => writeFileSync(join(家, 'qq-bridge-config.json'), JSON.stringify({
  总开关: true, 试运行: false, 目标会话: 'session-X', 私聊QQ: '123', 群号: '', 转私聊: true, 转群: false,
  NapCat: 'http://127.0.0.1:3000', 导入: 改动,
}, null, 2), 'utf8')

写导入配置({ 启用: false })
存储.length = 0
await 路由.get('/dsh-qq-bridge/state')(造请求(undefined, { method: 'GET' }), fakeRes)
报('/state 带出导入进度', 存储[0] && 存储[0].导入 && 存储[0].导入.启用 === false && 存储[0].导入.运行中 === false, JSON.stringify(存储[0] && 存储[0].导入))
报('/state 不把令牌写进页面（没填就是空）', 存储[0] && 存储[0].配置.导入.令牌 === '' && 存储[0].导入.有令牌 === false)

写导入配置({ 启用: false, 令牌: 'tk-secret' })
存储.length = 0
await 路由.get('/dsh-qq-bridge/state')(造请求(undefined, { method: 'GET' }), fakeRes)
报('/state：填过的令牌只回掩码', 存储[0].配置.导入.令牌 === '(已设置)' && 存储[0].导入.有令牌 === true, JSON.stringify(存储[0].配置.导入))

收到 = await 导('import-run')
报('/import-run：开关关着 → 拒绝', 收到 && 收到.ok === false && String(收到.说).includes('开关关着'), JSON.stringify(收到))
报('/import-run：开关关着 → 一条都不写进经历', 观察到的.length === 0)

写导入配置({ 启用: true, 令牌: 'tk-secret' })
鱼脑状态.可用 = false
收到 = await 导('import-run')
报('/import-run：鱼脑没挂上 → 拒绝（不写半截经历）', 收到 && 收到.ok === false && String(收到.说).includes('鱼脑'), JSON.stringify(收到))
鱼脑状态.可用 = true

写导入配置({ 启用: true, 令牌: '' })
delete process.env.TULPA_MCP_TOKEN
收到 = await 导('import-run')
报('/import-run：没令牌 → 拒绝', 收到 && 收到.ok === false && String(收到.说).includes('令牌'), JSON.stringify(收到))

收到 = await 导('import-stop')
报('/import-stop：能停（没在导也如实回）', 收到 && 收到.ok === true && String(收到.说).includes('停止'), JSON.stringify(收到))
收到 = await 导('import-reset')
报('/import-reset：清游标', 收到 && 收到.ok === true, JSON.stringify(收到))
收到 = await 导('import-state', 'GET')
报('/import-state：回出上限和白名单', 收到 && 收到.ok === true && 收到.每轮条数 === 200 && Array.isArray(收到.白名单), JSON.stringify(收到 && { 每轮条数: 收到.每轮条数, 白名单: 收到.白名单 }))

// /save 把掩码原样发回来 = 令牌不改；提交别的字段也不冲掉导入配置
写导入配置({ 启用: true, 令牌: 'tk-secret', 白名单: ['p1'], 每轮条数: 50 })
存储.length = 0
await 路由.get('/dsh-qq-bridge/save')(造请求({ 导入: { 令牌: '(已设置)', 每轮页数: 3 } }, { method: 'POST' }), fakeRes)
const 落盘 = JSON.parse(readFileSync(join(家, 'qq-bridge-config.json'), 'utf8'))
报('/save：掩码回显不改真令牌', 落盘.导入.令牌 === 'tk-secret', JSON.stringify(落盘.导入))
报('/save：嵌套导入不被浅合并冲掉（白名单、条数还在）', 落盘.导入.白名单[0] === 'p1' && 落盘.导入.每轮条数 === 50 && 落盘.导入.每轮页数 === 3, JSON.stringify(落盘.导入))
报('/save：导入配置不进经历流', 观察到的.length === 0)

// ⑨ 思想活动：她的思路流（判断链 + 模型思路 + 心情 + 鱼脑）记下来、能增量拉、落盘能回看
const 取思绪 = async (查询 = '') => {
  存储.length = 0
  await 路由.get('/dsh-qq-bridge/thoughts')(造请求(undefined, { method: 'GET', url: `/dsh-qq-bridge/thoughts${查询}` }), fakeRes)
  return 存储[0]
}
// 先验外源没装时如实说不可用（这个家目录里还没有心情/鱼脑）
const 空绪 = await 取思绪()
报('/thoughts：外源没装时如实说不可用', 空绪 && 空绪.ok === true && 空绪.心情.可用 === false && 空绪.预算.可用 === false, JSON.stringify(空绪 && { 心情: 空绪.心情, 预算: 空绪.预算 }))

// 主人桥那一轮：assistant/message 里带 reasoning → 记成「思考」
监听[0](会话, 助手消息(140, 1, [块('reasoning', '他刚提了鱼片，我先想想要不要接这一句'), 块('text', '鱼片没有，自己人不能切片。')], false))
监听[0](会话, 转完(140))
await new Promise((r) => setTimeout(r, 30))

const 全部绪 = await 取思绪()
报('/thoughts：回出思路流和序号', 全部绪 && 全部绪.ok === true && 全部绪.序号 > 0 && Array.isArray(全部绪.思绪), JSON.stringify(全部绪 && { 序号: 全部绪.序号, 条数: 全部绪.思绪.length }))
报('/thoughts：类别清单给全了', JSON.stringify(全部绪.类别) === '["判断","思考","心情","记忆","开口"]', JSON.stringify(全部绪.类别))
const 思考绪 = (全部绪.思绪 || []).filter((x) => x.类别 === '思考')
报('/thoughts：模型的思路原文被记下来了', 思考绪.length >= 1 && 思考绪.some((x) => String((x.详情 && x.详情.思路) || x.文本).includes('要不要接')), JSON.stringify(思考绪.map((x) => x.文本)))
报('/thoughts：一条思绪带得上时间、序号、谁', 全部绪.思绪.every((x) => typeof x.时间 === 'string' && x.时间.length > 0 && x.序号 > 0 && typeof x.谁 === 'string'), JSON.stringify(全部绪.思绪[0]))

const 增量绪 = await 取思绪(`?since=${全部绪.序号}`)
报('/thoughts：since 之后没新的就回空、不重发', 增量绪 && 增量绪.重发 === false && 增量绪.思绪.length === 0, JSON.stringify(增量绪 && { 重发: 增量绪.重发, 条数: 增量绪.思绪.length }))
const 超前绪 = await 取思绪(`?since=${全部绪.序号 + 50}`)
报('/thoughts：客户端序号超前（宿主重启过）→ 整段重发', 超前绪 && 超前绪.重发 === true && 超前绪.思绪.length === 全部绪.思绪.length, JSON.stringify(超前绪 && { 重发: 超前绪.重发, 条数: 超前绪.思绪.length }))
const 筛选绪 = await 取思绪('?类别=思考')
报('/thoughts：能按类别筛', 筛选绪 && 筛选绪.思绪.length > 0 && 筛选绪.思绪.every((x) => x.类别 === '思考'), JSON.stringify(筛选绪 && 筛选绪.思绪.length))
const 落行 = readFileSync(join(家, 'qq-thoughts.jsonl'), 'utf8').trim().split('\n')
报('/thoughts：落盘 jsonl 逐行能解析、带类别和正文', 落行.length > 0 && 落行.every((s) => {
  try {
    const 条 = JSON.parse(s)
    return typeof 条.文本 === 'string' && 全部绪.类别.includes(条.类别)
  } catch (error) {
    return false
  }
}), '行数=' + 落行.length)

// 心情：写一份 timeline（先定基线，再冒新条目）；鱼脑：先定基线，再追加一行
mkdirSync(join(家, 'feiyu-mood'), { recursive: true })
mkdirSync(join(家, 'fish-mind'), { recursive: true })
const 写心情 = (线, 分 = 72, 上次 = '') => writeFileSync(
  join(家, 'feiyu-mood', 'state.json'),
  JSON.stringify({ mood: 分, lastReason: 上次, updatedAt: 线[线.length - 1].at, timeline: 线 }),
  'utf8',
)
const 捞外源 = 轮询回调们.at(-1)
报('外源捞取挂在定时器上', typeof 捞外源 === 'function')
写心情([{ at: 1000, mood: 70, delta: 0, reason: '早先的一条（不该被倒出来）' }])
捞外源()
写心情([
  { at: 1000, mood: 70, delta: 0, reason: '早先的一条（不该被倒出来）' },
  { at: 2000, mood: 72, delta: 2, reason: '他提起鱼片，我心里痒痒的', dimsDelta: { happy: 1 } },
], 72, '他提起鱼片，我心里痒痒的')
捞外源()
writeFileSync(join(家, 'fish-mind', 'diag.log'), 'memory: 启动，episodes=38\n', 'utf8')
捞外源()
writeFileSync(join(家, 'fish-mind', 'diag.log'), 'memory: 启动，episodes=38\nmemory: 短期转长期（tick，看 40 条，新记住 1 条）\n', 'utf8')
const 本地今天 = (() => {
  const 今 = new Date()
  const 补 = (n) => String(n).padStart(2, '0')
  return `${今.getFullYear()}-${补(今.getMonth() + 1)}-${补(今.getDate())}`
})()
writeFileSync(join(家, 'fish-mind', 'budget.json'), JSON.stringify({ dailyGrantCny: 10, walletCny: 24.3, days: { [本地今天]: { spentCny: 7.01, calls: 400 } } }), 'utf8')
捞外源()

const 外源绪 = await 取思绪()
const 心情绪 = (外源绪.思绪 || []).filter((x) => x.类别 === '心情')
const 记忆绪 = (外源绪.思绪 || []).filter((x) => x.类别 === '记忆')
报('/thoughts：心情新条目变成「心情」思绪，带原句', 心情绪.length === 1 && 心情绪[0].文本.includes('鱼片') && 心情绪[0].详情.心情 === 72 && 心情绪[0].详情.变化 === 2, JSON.stringify(心情绪.map((x) => ({ 文本: x.文本, 详情: x.详情 }))))
报('/thoughts：心情历史不倒出来（只从基线往后捞）', 心情绪.length === 1 && !心情绪[0].文本.includes('早先'), JSON.stringify(心情绪.map((x) => x.文本)))
报('/thoughts：鱼脑新增的诊断行变成「记忆」思绪', 记忆绪.length === 1 && 记忆绪[0].文本.includes('短期转长期'), JSON.stringify(记忆绪.map((x) => x.文本)))
报('/thoughts：顶部摘要给出当前心情', 外源绪.心情 && 外源绪.心情.可用 === true && 外源绪.心情.心情 === 72 && 外源绪.心情.上次想法.includes('鱼片'), JSON.stringify(外源绪.心情))
报('/thoughts：顶部摘要给出今日花费和余额', 外源绪.预算 && 外源绪.预算.可用 === true && 外源绪.预算.今日花费 === 7.01 && 外源绪.预算.今日调用 === 400 && 外源绪.预算.余额 === 24.3, JSON.stringify(外源绪.预算))

rmSync(家, { recursive: true, force: true })
console.log(`\n${挂了 === 0 ? '全部通过 ✅' : `有 ${挂了} 条没过 ❌`}`)
process.exitCode = 挂了 === 0 ? 0 : 1