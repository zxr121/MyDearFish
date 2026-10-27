// 「通到 QQ」戳一戳冒烟测试 —— 假 ctx + 本机 HTTP 收报口，验：
//   1) 只认“别人戳她”：自己戳别人、别人互戳、非戳事件都不算
//   2) 私聊戳 → 转进主人桥目标会话；连戳两下合成一条
//   3) 群戳（主群没接管时）→ 进社交待看；主人戳她时直接开一轮；只听不说的屋子只记不接
//   4) /state 带出收报地址、在听状态和收到的数量
// 跑法： node tests/戳一戳.mjs

import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const 家 = mkdtempSync(join(tmpdir(), 'qq-poke-'))
process.env.DSH_HOME = 家

let 挂了 = 0
const 报 = (标签, 过, 详情) => { if (!过) 挂了++; console.log(`${过 ? 'PASS' : 'FAIL'}  ${标签}${详情 ? '  :: ' + 详情 : ''}`) }
const 等 = (ms = 30) => new Promise((r) => setTimeout(r, ms))

const 找空端口 = () => new Promise((成, 败) => {
  const s = createServer()
  s.once('error', 败)
  s.listen(0, '127.0.0.1', () => {
    const 端口 = s.address().port
    s.close(() => 成(端口))
  })
})
const 端口 = await 找空端口()

writeFileSync(join(家, 'qq-bridge-config.json'), JSON.stringify({
  总开关: true, 试运行: false, 目标会话: 'session-X', 私聊QQ: '123', 群号: '',
  转私聊: true, 转群: false, NapCat: 'http://127.0.0.1:3000',
  戳一戳: { 启用: true, 端口 },
  社交: {
    启用: true, 试运行: false, 群: ['555'], 好友: [], 模式: 'auto', 旁听: true,
    冷却秒: 10, 冷却最短秒: 5, 冷却最长倍率: 1.5, 余额吃紧线: 5, 余额吃紧倍率: 1.5, 最低余额: 1, 静音: '',
    称呼: ['大肥鱼'], 兴趣词: [], 关注上限: 12, 聚拢秒: 15,
    判断模型: 'fake/cheap', 判断阈值: 0.55, 判断冷却秒: 60, 回复模型: 'fake/chat',
  },
}, null, 2), 'utf8')

const 模 = await import(new URL('../lib/host.js', import.meta.url).href + '?v=' + Date.now())

// ---------- 纯函数 ----------
const 私聊戳 = { post_type: 'notice', notice_type: 'notify', sub_type: 'poke', self_id: 10001, user_id: 123, sender_id: 123, target_id: 10001 }
const 私聊戳2 = 模.解析戳一戳(私聊戳, '10001')
报('私聊戳：认得出戳人者', 私聊戳2 && 私聊戳2.场景 === 'private' && 私聊戳2.戳人者 === '123' && 私聊戳2.群号 === '', JSON.stringify(私聊戳2))
const 换sender = 模.解析戳一戳({ ...私聊戳, user_id: 999, sender_id: 123 }, '10001')
报('私聊戳：user_id 是会话对方时以 sender_id 为准', 换sender && 换sender.戳人者 === '123', JSON.stringify(换sender))
const 群戳 = 模.解析戳一戳({ post_type: 'notice', notice_type: 'notify', sub_type: 'poke', self_id: 10001, group_id: 555, user_id: 777, target_id: 10001 }, '10001')
报('群戳：带群号', 群戳 && 群戳.场景 === 'group' && 群戳.群号 === '555' && 群戳.戳人者 === '777', JSON.stringify(群戳))
报('戳的不是她 → 不认', 模.解析戳一戳({ ...私聊戳, target_id: 999 }, '10001') === null)
报('她自己戳别人 → 不认', 模.解析戳一戳({ ...私聊戳, sender_id: 10001, target_id: 123 }, '10001') === null)
报('不是通知事件 → 不认', 模.解析戳一戳({ ...私聊戳, post_type: 'message' }, '10001') === null)
报('非戳通知 → 不认', 模.解析戳一戳({ ...私聊戳, notice_type: 'friend_recall', sub_type: undefined }, '10001') === null)
报('notice_type=poke 的变体也认', 模.解析戳一戳({ ...私聊戳, notice_type: 'poke', sub_type: undefined }, '10001')?.场景 === 'private')
报('说法：action + suffix', 模.戳一戳说法({ action: '戳了戳', suffix: '你的小脑袋' }) === '戳了戳你的小脑袋')
报('说法：缺字段回退', 模.戳一戳说法({}) === '戳了戳你')
报('说法：去掉控制字符', 模.戳一戳说法({ action: '拍了\u0007拍', suffix: '\u001b你' }) === '拍了拍你')

// ---------- 假 ctx ----------
const 转进 = []
const 注入们 = []
const 登记的会话 = new Map()
const 收摊们 = []
const 造agent = (sid) => ({
  id: sid,
  followup: (m) => 转进.push({ sid, m }),
  inject: (m) => 注入们.push({ sid, m }),
  session: { id: sid, header: { cwd: 'D:/fake' } },
})
登记的会话.set('session-X', 造agent('session-X'))
const ctx = {
  on: () => () => {},
  effect: (fn) => { const 摘 = fn(); 收摊们.push(摘); return () => { try { 摘 && 摘() } catch (error) {} } },
  webServer: { register: () => {} },
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
      const agent = 造agent(sid)
      登记的会话.set(sid, agent)
      if (setup) setup({ systemPrompt: { section: () => {} }, tools: { restrict: () => {}, guard: () => {} } })
      return { agent, dispose: () => { 登记的会话.delete(sid) } }
    },
  },
  sessions: { flush: async () => {} },
  agentDefaultModel: { currentSelection: () => ({ provider: 'fake', model: 'chat' }) },
  sessionTitle: { get: () => undefined, rename: () => {} },
  workspaceRegistry: {
    archivedSessionIds: [],
    list: () => [],
    resolveByPath: async () => undefined,
    create: async (路径) => ({ path: 路径, sessionIds: [], attachSession: async () => {} }),
  },
  interval: () => () => {},
  get: (名字) => (名字 === 'fishMind' ? { budget: () => ({ enabled: false }), observe: () => ({ ok: true }) } : undefined),
}

const 宿主 = 模.apply(ctx)
await 等(150)
const 状态0 = await 宿主.概况()
报('收报口已在本机监听', 状态0.戳一戳.在听 === true && 状态0.戳一戳.端口 === 端口, JSON.stringify(状态0.戳一戳))
报('/state 带出上报地址', 状态0.戳一戳.地址 === `http://127.0.0.1:${端口}/dsh-qq/event`, 状态0.戳一戳.地址)

const 推 = async (事件) => {
  const r = await fetch(`http://127.0.0.1:${端口}/dsh-qq/event`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(事件),
  })
  return { 码: r.status, 体: await r.json() }
}
const 文本 = (条) => (条.m.content || []).map((b) => b.text || '').join('\n')
const 主人的 = () => 转进.filter((x) => x.sid === 'session-X')
const 社群的 = () => 转进.filter((x) => x.sid === 'session-qq-social-group-555')

// ① 私聊戳 → 主人桥目标会话
let 回 = await 推(私聊戳)
报('收报口回 200', 回.码 === 200 && 回.体.ok === true, JSON.stringify(回))
await 等(1500)
报('私聊戳 → 转进目标会话', 主人的().length === 1 && 文本(主人的()[0]).includes('戳了戳你'), 文本(主人的()[0]).slice(0, 200))

// ② 连戳两下合成一条
const 前 = 主人的().length
await 推({ ...私聊戳, time: 100 })
await 推({ ...私聊戳, time: 101 })
await 等(1500)
报('连戳两下只开一轮，并标出次数', 主人的().length === 前 + 1 && 文本(主人的().at(-1)).includes('连着 2 下'), 文本(主人的().at(-1)).slice(0, 200))

// ③ 群戳（主群是空的）→ 进社交会话；主人戳她直接接
const 前群 = 社群的().length
await 推({ post_type: 'notice', notice_type: 'notify', sub_type: 'poke', self_id: 10001, group_id: 555, user_id: 123, target_id: 10001, action: '拍了拍', suffix: '你' })
await 等(1700)
报('群戳进社交会话，主人戳她不走兴趣判断', 社群的().length === 前群 + 1 && 文本(社群的().at(-1)).includes('拍了拍你'), 文本(社群的().at(-1)).slice(0, 300))
报('群戳带上“被叫”标记', 文本(社群的().at(-1)).includes('[说到你]'), 文本(社群的().at(-1)).slice(0, 300))
报('社交提示教她按戳回一句，不演门铃', 文本(社群的().at(-1)).includes('【戳一戳】') && 文本(社群的().at(-1)).includes('别改写成门铃'), 文本(社群的().at(-1)).slice(0, 300))

// ③b 只听不说：戳她也不开回合，只把这一下记进社交会话
const 原配置 = JSON.parse(readFileSync(join(家, 'qq-bridge-config.json'), 'utf8'))
writeFileSync(join(家, 'qq-bridge-config.json'), JSON.stringify({
  ...原配置,
  社交: { ...原配置.社交, 只听: ['group:555'] },
}, null, 2), 'utf8')
const 听前群 = 社群的().length
const 听注入前 = 注入们.length
await 推({ post_type: 'notice', notice_type: 'notify', sub_type: 'poke', self_id: 10001, group_id: 555, user_id: 123, target_id: 10001, action: '拍了拍', suffix: '你的小脑袋' })
await 等(1700)
报('只听不说：被戳也不开回合', 社群的().length === 听前群, `回合=${社群的().length - 听前群}`)
报('只听不说：被戳只记进她的社交会话', 注入们.filter((x) => x.sid === 'session-qq-social-group-555').length === 听注入前 + 1 && 文本(注入们.at(-1)).includes('你的小脑袋'), 文本(注入们.at(-1) || {}).slice(0, 200))

// ④ 别人互戳 / 非戳事件都不转
const 前主 = 主人的().length
const 前社 = 社群的().length
await 推({ ...私聊戳, target_id: 999 })
await 推({ post_type: 'notice', notice_type: 'friend_recall', self_id: 10001, user_id: 123 })
await 等(1500)
报('戳别人 / 非戳事件不转', 主人的().length === 前主 && 社群的().length === 前社)

const 状态1 = await 宿主.概况()
报('收到数量只计被戳到她的', 状态1.戳一戳.收到 === 5, String(状态1.戳一戳.收到))
报('最近一条戳有记录', String(状态1.戳一戳.最近).includes('123'), 状态1.戳一戳.最近)

for (const 收 of 收摊们) { try { 收 && 收() } catch (error) {} }
await 等(50)
rmSync(家, { recursive: true, force: true })
console.log(`\n${挂了 === 0 ? '全部通过 ✅' : `有 ${挂了} 条没过 ❌`}`)
process.exitCode = 挂了 === 0 ? 0 : 1
