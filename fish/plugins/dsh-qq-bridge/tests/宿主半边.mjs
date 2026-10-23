// 「通到 QQ」宿主半边冒烟测试 —— 假 ctx / 假 fetch 把「DSH → QQ」这半跑一遍。
// 验的是：
//   1) 提取正文：只收 text 块，reasoning / image 不要；空 → ''
//   2) assistant/message + turn/end(completed) → 真的向 NapCat 发一条 send_private_msg
//   3) interrupted 那轮不发；turn/end 不是 completed 不发
//   4) 试运行开着 → 不真发（fetch 不被打）；总开关关着 → 不真发
//   5) /state 路由能回出配置和 NapCat 探活结果
//   6) 连发：文字按空行/句尾拆条，表情包 [发表情:#N] 按写下顺序排进队列、可连发多张、可和话混排
// 跑法： node tests/宿主半边.mjs

import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
    return {
      ok: true,
      url: u,
      headers: { get: (k) => (k === 'content-type' ? 'image/jpeg' : k === 'content-length' ? '4' : null) },
      async arrayBuffer() { return new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer },
    }
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

// ---------- 假 ctx ----------
const 监听 = []
const 路由 = new Map()
const 转进的 = []
const 轮询回调们 = []
let 轮询回调 = null
const 假agent = { followup: (m) => 转进的.push(m), session: { id: 'session-X' } }
const 登记的会话 = new Map([['session-X', 假agent]])
const 场景提示 = []
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
      return ref
    })
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
报('QQ 私聊场景提示要求少打句号、语气可爱', 场景提示.some((s) => String(s.text).includes('句尾基本不加句号') && String(s.text).includes('可爱')))
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

// ⑯c 主人私聊：摸清打字节奏后，入站消息带一段内部贴合提示（不发给 QQ）
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

rmSync(家, { recursive: true, force: true })
console.log(`\n${挂了 === 0 ? '全部通过 ✅' : `有 ${挂了} 条没过 ❌`}`)
process.exitCode = 挂了 === 0 ? 0 : 1