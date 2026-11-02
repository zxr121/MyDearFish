// 宿主半边冒烟测试 —— 用假的 ctx / 假的 agent / 虚拟时钟把 lib/host.js 跑一遍。
//
// ⚠ 它**不装插件、不碰 DSH、不碰你的会话**：DSH_HOME 指到系统临时目录，
//   agent 是假的，followup 只是把消息收进数组里；时间用假的 Date 控制。
//
// 验的是：
//   1) 新配置默认值、归一化、保存、旧键丢弃；
//   2) 四种曲线形状、算概率、检查时刻、安静结束、算曲线；
//   3) ctx.timeout 排程：正常、到点、逾期重试、安静顺延；
//   4) 真概率：p=0 必没中、p=1 必中、中途概率与记账一致；
//   5) 确认链路：只有 assistant 正文 + turn/end completed 才重置计时并写状态文件；
//   6) 房间/QQ/developer/标题/坏配置等旧行为不丢。
//
// 跑法： node tests/宿主半边.mjs

import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const 家 = mkdtempSync(join(tmpdir(), 'hw-'))
process.env.DSH_HOME = 家

// ---- 虚拟时钟：2026-10-19（周一）14:00，峰时 ----
const 真Date = globalThis.Date
let 虚拟现在 = new 真Date(2026, 9, 19, 14, 0, 0).getTime()
class 假Date extends 真Date {
  constructor(...args) {
    if (args.length === 0) super(虚拟现在)
    else super(...args)
  }
  static now() {
    return 虚拟现在
  }
}
globalThis.Date = 假Date

// ---- 投影缓存标题 fixture（两种文件名都验）----
const ID_长 = 'session-0f1e2d3c-4b5a-6978-8c9d-0a1b2c3d4e5f'
const ID_裸 = 'abc12345-6789-4abc-9def-0123456789ab'
const 投影目录 = join(家, 'storages', 'session_projcache', 'sessions')
mkdirSync(投影目录, { recursive: true })
const 铺投影 = (文件名, rows) => writeFileSync(join(投影目录, 文件名 + '.json'), JSON.stringify({ version: 7, record: { rows } }), 'utf8')
铺投影(ID_长, { title: { ver: 1, seq: 9, val: '示例会话' } })
铺投影('session-' + ID_裸, { title: { ver: 1, seq: 3, val: '裸 id 那个会话' } })

const 插件 = await import(new URL('../lib/host.js', import.meta.url).href)

let 挂 = 0
const 报 = (标签, 过, 详情) => {
  if (!过) 挂++
  console.log(`${过 ? 'PASS' : 'FAIL'}  ${标签}${详情 ? '  :: ' + 详情 : ''}`)
}
const 等 = (毫秒 = 20) => new Promise((r) => setTimeout(r, 毫秒))
const 造res = () => ({ 体: null, writeHead() {}, end(s) { this.体 = JSON.parse(s) } })

function 造环境({ 初始上次 = 虚拟现在, 配置 = {} } = {}) {
  writeFileSync(join(家, 'speak-up-state.json'), JSON.stringify({ 版本: 1, 上次主动开口: 初始上次 }), 'utf8')
  writeFileSync(join(家, 'speak-up-config.json'), typeof 配置 === 'string' ? 配置 : JSON.stringify(配置), 'utf8')

  const 路由 = new Map()
  const 事件 = new Map()
  const 日志 = []
  const 停表们 = []
  const cleanups = []

  const 造agent = (id) => ({
    id,
    status: 'idle',
    session: { id },
    收到的: [],
    followup(m) {
      this.收到的.push(m)
    },
  })
  const 甲 = 造agent('sess-abc')
  const 乙 = 造agent(ID_长)
  const 假会话表 = new Map([
    ['sess-abc', { id: 'sess-abc' }],
    [ID_长, { id: ID_长 }],
    [ID_裸, { id: ID_裸 }],
  ])
  const 标题表 = new Map([['sess-abc', '甲会话']])

  const 假qq房们 = []
  const 假qq社交 = {
    房间们: () => 假qq房们.map((x) => ({ ...x })),
    能不能说: (id) => {
      const 房 = 假qq房们.find((x) => x.会话id === id)
      return 房 && 房.能开口 === false ? (房.不能因 || '现在不能主动开口') : ''
    },
    开房: async (id) => {
      const 房 = 假qq房们.find((x) => x.会话id === id)
      if (!房) return null
      房.agent = 造agent(id)
      return 房.agent
    },
  }
  const 额外agent们 = []
  const 全部agent = () => [甲, 乙, ...额外agent们, ...假qq房们.map((x) => x.agent).filter(Boolean)]

  const 假鱼脑 = {
    开: false,
    用掉的由头: [],
    urge: () => ({
      enabled: true,
      at: 虚拟现在,
      strength: 0.9,
      cue: { id: 41, text: '今天想跟主人说说阳台那盆花开了' },
      affect: { phrase: '心里有点软' },
      urges: [],
    }),
    confidePrompt(inner) {
      return `【没人说话，你自己待着。心里正惦记着：${inner.cue ? inner.cue.text : ''}。你很想把这件事讲给主人听。不要把这条提示说出来。】`
    },
    spoke(cueId) {
      this.用掉的由头.push(cueId)
    },
  }

  const 假ctx = {
    agents: { get: (id) => 全部agent().find((a) => String(a.id) === String(id)), list: () => 全部agent() },
    sessions: {
      flush: async () => true,
      list: () => [...假会话表.values()],
      get: (id) => 假会话表.get(String(id)),
    },
    sessionTitle: { get: (会话) => (标题表.has(String(会话 && 会话.id)) ? { title: 标题表.get(String(会话.id)) } : undefined) },
    workspaceRegistry: { archivedSessionIds: [] },
    webServer: { register: (r) => { 路由.set(r.path, r.handler); return () => 路由.delete(r.path) } },
    timeout: (cb, ms) => {
      const 表 = { cb, ms, 活: true }
      停表们.push(表)
      return () => {
        表.活 = false
      }
    },
    logger: { info: (s) => 日志.push(s), warn: (s) => 日志.push(s) },
    effect: (fn) => {
      const c = fn()
      if (typeof c === 'function') cleanups.push(c)
    },
    on: (n, cb) => {
      if (!事件.has(n)) 事件.set(n, [])
      事件.get(n).push(cb)
      return () => {
        const 列 = 事件.get(n) || []
        const i = 列.indexOf(cb)
        if (i >= 0) 列.splice(i, 1)
      }
    },
    get: (n) => {
      if (n === 'sessions') return 假ctx.sessions
      if (n === 'sessionTitle') return 假ctx.sessionTitle
      if (n === 'sessionController') {
        return { inspect: async () => ({ events: [] }), create: async () => ({ sessionId: 'sess-新建的' }) }
      }
      if (n === 'qqSocial') return 假qq社交
      if (n === 'fishMind') return 假鱼脑.开 ? 假鱼脑 : undefined
      if (n === 'workspaceRegistry') return 假ctx.workspaceRegistry
      return undefined
    },
  }

  return { 假ctx, 路由, 事件, 日志, 停表们, cleanups, 甲, 乙, 假qq房们, 假鱼脑, 全部agent }
}

const 调 = async (环境, 路径, body) => {
  const res = 造res()
  const 处理 = 环境.路由.get(路径)
  if (!处理) throw new Error(`没有路由 ${路径}`)
  await 处理({ [Symbol.asyncIterator]: async function* () { yield Buffer.from(JSON.stringify(body || {})) } }, res)
  return res.体
}
const 活表 = (环境) => 环境.停表们.filter((x) => x.活)
const 最新表 = (环境) => 活表(环境)[活表(环境).length - 1]
const 跑表 = async (环境) => {
  const 表 = 最新表(环境)
  if (!表) return false
  表.活 = false
  虚拟现在 += 表.ms
  表.cb()
  // 定时回调是 void 滴答()，等它把日志/followup 写完
  await 等(300)
  return true
}
/** 不拨钟，直接把当前表跑一下（用来验安静时段分支）。 */
const 跑表现场 = async (环境) => {
  const 表 = 最新表(环境)
  if (!表) return false
  表.活 = false
  表.cb()
  await 等(300)
  return true
}
const 发事件 = (环境, sid, event) => {
  for (const cb of 环境.事件.get('session/event') || []) cb({ id: sid }, event)
}
const 开始回合 = (环境, sid, turn) => 发事件(环境, sid, { type: 'turn/start', data: { turn } })
const 主动消息 = (环境, sid) =>
  发事件(环境, sid, { type: 'user/message', time: 虚拟现在, data: { source: { kind: 'speak-up' } } })
const 她说了 = (环境, sid, turn, text) =>
  发事件(环境, sid, { type: 'assistant/message', data: { turn, message: { content: [{ type: 'text', text }] } } })
const 结束回合 = (环境, sid, turn, kind = 'completed') =>
  发事件(环境, sid, { type: 'turn/end', data: { turn, reason: { kind } } })
const 读状态文件 = () => JSON.parse(readFileSync(join(家, 'speak-up-state.json'), 'utf8'))
const 写配置文件 = (o) => writeFileSync(join(家, 'speak-up-config.json'), typeof o === 'string' ? o : JSON.stringify(o), 'utf8')

// ============================================================
// 环境 1：默认状态 / 纯函数 / 排程 / 确认
// ============================================================
{
  const 环境 = 造环境()
  插件.apply(环境.假ctx)
  await 等(10)

  报('注册了 5 条路由', 环境.路由.size === 5, [...环境.路由.keys()].join(' '))
  报('第一条检查挂在 30 分钟后', 最新表(环境) && 最新表(环境).ms === 30 * 60000, JSON.stringify(最新表(环境) && { ms: 最新表(环境).ms }))

  const st = await 调(环境, '/dsh-speak-up/state')
  报('默认值：检查 30 / 最长 180 / 慢热 k4 / 峰0.5 谷1 / 安静1~8 / 试运行关 / 总开关开',
    st.配置.间隔分钟 === 30 && st.配置.最长间隔分钟 === 180 && st.配置.曲线类型 === '慢热' &&
    st.配置.曲线强度 === 4 && st.配置.峰时倍率 === 0.5 && st.配置.谷时倍率 === 1 &&
    st.配置.安静起 === 1 && st.配置.安静止 === 8 && st.配置.试运行 === false && st.配置.总开关 === true)
  报('旧的命中线/加成/因子/冷却键已经不在配置里',
    ['峰时命中线', '谷时命中线', '没中加成', '加成上限', '倾述加成', '近阈值分钟', '远阈值分钟', '搭话冷却分钟']
      .every((k) => st.配置[k] === undefined))
  报('状态里有概率状态/曲线/状态文件',
    st.概率状态 && st.曲线 && st.状态文件 && Array.isArray(st.曲线.谷) && Array.isArray(st.曲线.峰),
    JSON.stringify({ 状态: st.概率状态 && st.概率状态.状态, 谷长: st.曲线 && st.曲线.谷.length }))
  报('默认上次主动开口就是虚拟现在（状态文件会被读）', st.概率状态.上次主动开口 === 虚拟现在, JSON.stringify(st.概率状态.上次主动开口))
  报('默认曲线图上 T 处有竖直段（峰时最后两点同一个 x，y 从 50 跳到 100）',
    st.曲线.峰.at(-1)[0] === 180 && st.曲线.峰.at(-1)[1] === 100 &&
    st.曲线.峰.at(-2)[0] === 180 && st.曲线.峰.at(-2)[1] === 50,
    JSON.stringify(st.曲线.峰.slice(-2)))
  报('检查点覆盖 30..180', JSON.stringify(st.曲线.检查点们) === JSON.stringify([30, 60, 90, 120, 150, 180]), JSON.stringify(st.曲线.检查点们))

  // ---- 纯函数 ----
  const 形状们 = ['直线', '慢热', '快起', 'S形']
  let 形状过 = true
  for (const 型 of 形状们) {
    const 点 = [0, 0.25, 0.5, 0.75, 1].map((u) => 插件.形状值(型, 4, u))
    形状过 = 形状过 && 点[0] === 0 && Math.abs(点[4] - 1) < 1e-12 && 点.every((x, i) => i === 0 || x > 点[i - 1])
  }
  报('四种形状都 f(0)=0、f(1)=1、严格上升', 形状过)
  报('慢热默认 k=4 中点约 0.119（前低后陡）', Math.abs(插件.形状值('慢热', 4, 0.5) - 0.1192) < 0.001, String(插件.形状值('慢热', 4, 0.5)))
  报('快起 k=4 中点约 0.683（前快后缓）', Math.abs(插件.形状值('快起', 4, 0.5) - 0.6826) < 0.001, String(插件.形状值('快起', 4, 0.5)))

  const 峰时 = new Date(2026, 9, 19, 10, 0, 0)
  const 谷时 = new Date(2026, 9, 19, 12, 30, 0)
  const 基准 = { 最长间隔分钟: 180, 曲线类型: '直线', 曲线强度: 4, 峰时倍率: 0.5, 谷时倍率: 1, 间隔分钟: 30 }
  报('直线 90 分钟谷时概率 50%', Math.abs(插件.算概率(基准, 90 * 60000, 谷时).概率 - 0.5) < 1e-12)
  报('直线 90 分钟峰时概率 25%（峰时倍率 0.5）', Math.abs(插件.算概率(基准, 90 * 60000, 峰时).概率 - 0.25) < 1e-12)
  报('到点（180 分钟）峰时也强制 100%', 插件.算概率(基准, 180 * 60000, 峰时).概率 === 1 && 插件.算概率(基准, 180 * 60000, 峰时).保底 === true)
  报('超时 1 分钟仍是 100%', 插件.算概率(基准, 181 * 60000, 谷时).概率 === 1)
  报('检查时刻：T=100、Δ=30 → 30/60/90/100', JSON.stringify(插件.检查时刻分钟(30, 100)) === JSON.stringify([30, 60, 90, 100]))
  报('检查时刻：T=10、Δ=30 → 只补 T', JSON.stringify(插件.检查时刻分钟(30, 10)) === JSON.stringify([10]))
  const 安静1 = 插件.安静结束时刻(new Date(2026, 9, 19, 23, 30), 23, 7)
  const 安静2 = 插件.安静结束时刻(new Date(2026, 9, 19, 2, 0), 23, 7)
  报('安静 23~7：23:30 → 次日 07:00', 安静1 && 安静1.getDate() === 20 && 安静1.getHours() === 7, 安静1 && 安静1.toString())
  报('安静 23~7：02:00 → 今天 07:00', 安静2 && 安静2.getDate() === 19 && 安静2.getHours() === 7, 安静2 && 安静2.toString())
  报('安静起===止 → 不启用（null）', 插件.安静结束时刻(new Date(2026, 9, 19, 2, 0), 8, 8) === null)
  const 曲线 = 插件.算曲线({ ...基准, 曲线类型: '慢热' }, 谷时, 90 * 60000, 12)
  报('算曲线：当前点 90 分钟，谷/峰按倍率算', 曲线.当前 && 曲线.当前.分钟 === 90 && Math.abs(曲线.当前.谷 - 11.92) < 0.05 && Math.abs(曲线.当前.峰 - 5.96) < 0.05, JSON.stringify(曲线.当前))
  报('算曲线：检查点/保底字段齐全', Array.isArray(曲线.检查点们) && 曲线.保底.分钟 === 180 && 曲线.保底.百分比 === 100)

  // ---- 保存 / 夹范围 / 重排 ----
  const r = await 调(环境, '/dsh-speak-up/save', { 全选: false, 目标会话: ['sess-abc'], 间隔分钟: '7', 最长间隔分钟: '9999', 曲线类型: '不存在', 曲线强度: '0.01', 峰时倍率: '2', 谷时倍率: '-1', 保底文案: '' })
  报('字符串数字被洗成数字、超范围被夹住',
    r.配置.间隔分钟 === 7 && r.配置.最长间隔分钟 === 1440 && r.配置.曲线强度 === 0.1 &&
    r.配置.峰时倍率 === 1 && r.配置.谷时倍率 === 0)
  报('非法曲线类型回慢热', r.配置.曲线类型 === '慢热')
  报('空保底文案回落到触发文案', r.配置.保底文案 === r.配置.触发文案)
  报('保存后按新间隔重排（7 分钟）', 最新表(环境) && 最新表(环境).ms === 7 * 60000, JSON.stringify(最新表(环境) && 最新表(环境).ms))

  // 恢复正常配置，只留 sess-abc
  await 调(环境, '/dsh-speak-up/save', {
    全选: false, 目标会话: ['sess-abc'], 间隔分钟: 30, 最长间隔分钟: 180,
    曲线类型: '直线', 曲线强度: 4, 峰时倍率: 1, 谷时倍率: 1,
    安静起: 1, 安静止: 8, 试运行: false, 总开关: true, 角色: 'user',
  })
  报('正常排程：刚开口过 → 下一次 30 分钟', 最新表(环境).ms === 30 * 60000)

  虚拟现在 += 170 * 60000
  await 调(环境, '/dsh-speak-up/save', { 间隔分钟: 30 })
  报('距上次 170 分钟 → 下一次检查 10 分钟后（到点）', 最新表(环境).ms === 10 * 60000, JSON.stringify(最新表(环境).ms))

  虚拟现在 += 30 * 60000
  await 调(环境, '/dsh-speak-up/save', { 间隔分钟: 30 })
  报('已逾期 → 保存后 1 秒内尝试保底', 最新表(环境).ms === 1000, JSON.stringify(最新表(环境).ms))

  // 真概率：到点 p=1，Math.random 接近 1 也必中；发起后等确认
  const 真随机 = Math.random
  Math.random = () => 0.9999
  报('跑保底检查（p=1）', await 跑表(环境))
  const 保底日志 = 环境.日志.at(-1)
  报('到点日志写着保底到点/100%', /保底到点/.test(保底日志) && /本次概率 100\.0%/.test(保底日志), 保底日志)
  报('真的发起了 followup，且消息来源是 speak-up',
    环境.甲.收到的.length === 1 && 环境.甲.收到的[0].source.kind === 'speak-up' && 环境.甲.收到的[0].role === 'user',
    JSON.stringify(环境.甲.收到的[0] && 环境.甲.收到的[0].source))
  报('发起后进入待确认，只留下确认超时', 活表(环境).length === 1 && 活表(环境)[0].ms === 10 * 60 * 1000, JSON.stringify(活表(环境).map((x) => x.ms)))
  const 旧时间 = 读状态文件().上次主动开口
  开始回合(环境, 'sess-abc', 1)
  主动消息(环境, 'sess-abc')
  她说了(环境, 'sess-abc', 1, '我在呢，刚刚去看了看阳台。')
  结束回合(环境, 'sess-abc', 1, 'completed')
  await 等(20)
  报('确认成功后状态文件写进新的上次主动开口', 读状态文件().上次主动开口 === 虚拟现在, JSON.stringify({ 旧: 旧时间, 新: 读状态文件().上次主动开口, 现在: 虚拟现在 }))
  报('确认成功日志明确写了“已确认”与计时清零', /已确认她真的开口了/.test(环境.日志.at(-1)) && /计时清零/.test(环境.日志.at(-1)), 环境.日志.at(-1))
  报('确认成功后重新排 30 分钟', 最新表(环境) && 最新表(环境).ms === 30 * 60000, JSON.stringify(最新表(环境) && 最新表(环境).ms))

  // 失败：到点发起，但没有正文 → 不重置、只记录
  虚拟现在 += 200 * 60000
  await 调(环境, '/dsh-speak-up/save', { 间隔分钟: 30 })
  await 跑表(环境)
  报('第二次保底也真的发起', 环境.甲.收到的.length === 2, String(环境.甲.收到的.length))
  const 失败前 = 读状态文件().上次主动开口
  开始回合(环境, 'sess-abc', 2)
  主动消息(环境, 'sess-abc')
  结束回合(环境, 'sess-abc', 2, 'completed')
  await 等(20)
  报('没有正文 → 计时不重置', 读状态文件().上次主动开口 === 失败前, JSON.stringify({ 前: 失败前, 后: 读状态文件().上次主动开口 }))
  报('没有正文 → 日志只记录、不直发', /发起后没有成文/.test(环境.日志.at(-1)) && /只记录，不直发/.test(环境.日志.at(-1)), 环境.日志.at(-1))
  报('失败后按检查间隔重试（逾期不热循环）', 最新表(环境) && 最新表(环境).ms === 30 * 60000, JSON.stringify(最新表(环境) && 最新表(环境).ms))

  // developer 拒发：到点也不写坏会话
  虚拟现在 += 200 * 60000
  await 调(环境, '/dsh-speak-up/save', { 角色: 'developer' })
  await 跑表(环境)
  报('角色 developer → 主动拒发', /主动不发/.test(环境.日志.at(-1)) && 环境.甲.收到的.length === 2, 环境.日志.at(-1))
  await 调(环境, '/dsh-speak-up/save', { 角色: 'user' })

  Math.random = 真随机
}

// ============================================================
// 环境 1b：中途概率是真的（直线 30 分钟 → 16.7%，掷 0.99 必没中）
// ============================================================
{
  const 环境 = 造环境({ 初始上次: 虚拟现在 })
  插件.apply(环境.假ctx)
  await 等(10)
  await 调(环境, '/dsh-speak-up/save', {
    全选: false, 目标会话: ['sess-abc'], 间隔分钟: 30, 最长间隔分钟: 180,
    曲线类型: '直线', 峰时倍率: 1, 谷时倍率: 1, 安静起: 1, 安静止: 8, 试运行: false, 总开关: true,
  })
  const 真随机 = Math.random
  Math.random = () => 0.99
  await 跑表(环境)
  const 日志 = 环境.日志.at(-1)
  报('中途概率是真的：30 分钟直线 → 16.7%，掷 0.99 没中', /没掷中/.test(日志) && /本次概率 16\.7%/.test(日志), 日志)
  报('中途没中不发起 followup', 环境.甲.收到的.length === 0)
  Math.random = 真随机
}

// ============================================================
// 环境 2：安静时段顺延 + 重启读状态 + 旧配置键丢弃
// ============================================================
{
  const 环境 = 造环境({ 初始上次: 虚拟现在 - 170 * 60000 })
  插件.apply(环境.假ctx)
  await 等(10)
  报('重启：从状态文件读上次主动开口（170 分钟）→ 10 分钟后检查', 最新表(环境).ms === 10 * 60000, JSON.stringify(最新表(环境) && 最新表(环境).ms))

  虚拟现在 = new 真Date(2026, 9, 20, 2, 0, 0).getTime()
  await 调(环境, '/dsh-speak-up/save', { 安静起: 1, 安静止: 8, 间隔分钟: 30 })
  const st = await 调(环境, '/dsh-speak-up/state')
  报('安静中：状态是「安静」，安静到是 08:00', st.概率状态.状态 === '安静' && /08:00:00/.test(st.概率状态.安静到), JSON.stringify(st.概率状态))
  报('安静顺延：下一次检查是 6 小时（02:00→08:00）', 最新表(环境).ms === 6 * 3600000, JSON.stringify(最新表(环境) && 最新表(环境).ms))
  const 安静前收到 = 环境.甲.收到的.length
  报('安静中跑检查只记录、不掷', await 跑表现场(环境))
  报('安静日志写明顺延、不发起 followup',
    /安静时段/.test(环境.日志.at(-1)) && /不掷/.test(环境.日志.at(-1)) && 环境.甲.收到的.length === 安静前收到,
    环境.日志.at(-1))
  报('安静中重新排到 08:00', 最新表(环境).ms === 6 * 3600000, JSON.stringify(最新表(环境) && 最新表(环境).ms))

  虚拟现在 = new 真Date(2026, 9, 20, 8, 0, 0).getTime()
  await 调(环境, '/dsh-speak-up/save', { 安静起: 1, 安静止: 8 })
  await 跑表(环境)
  报('安静结束且逾期 → 按保底发起', /保底到点/.test(环境.日志.at(-1)), 环境.日志.at(-1))

  写配置文件({ 峰时命中线: 20, 谷时命中线: 60, 没中加成: 10, 加成上限: 40, 搭话冷却分钟: 20, 近阈值分钟: 20, 远阈值分钟: 360, 触发文案: '旧文案' })
  const 旧 = await 调(环境, '/dsh-speak-up/state')
  报('旧配置键被丢弃、新键回默认',
    旧.配置.峰时命中线 === undefined && 旧.配置.峰时倍率 === 0.5 && 旧.配置.谷时倍率 === 1 &&
    旧.配置.最长间隔分钟 === 180 && 旧.配置.触发文案 === '旧文案')
}

// ============================================================
// 环境 3：QQ 房间提示 + 标题两条来源
// ============================================================
{
  const 环境 = 造环境({ 初始上次: 虚拟现在 })
  环境.假qq房们.push({
    类型: 'group',
    号: '123456',
    会话id: 'session-qq-social-group-123456',
    叫: '群 123456',
    名: '测试群',
    能开口: true,
    不能因: '',
  })
  插件.apply(环境.假ctx)
  await 等(10)
  const st = await 调(环境, '/dsh-speak-up/state')
  报('清单列出本机会话和 QQ 群', st.活着的会话.some((x) => x.id === 'sess-abc') && st.活着的会话.some((x) => x.qq === '群'), JSON.stringify(st.活着的会话.map((x) => x.qq || x.id)))
  报('标题第一条路来自 sessionTitle', st.活着的会话.find((x) => x.id === 'sess-abc').标题 === '甲会话')
  报('标题第二条路来自投影缓存', st.活着的会话.find((x) => x.id === ID_长).标题 === '示例会话')

  await 调(环境, '/dsh-speak-up/save', { 全选: false, 目标会话: ['session-qq-social-group-123456'], 间隔分钟: 30, 最长间隔分钟: 180, 试运行: false, 总开关: true })
  虚拟现在 += 200 * 60000
  await 调(环境, '/dsh-speak-up/save', { 间隔分钟: 30 })
  await 跑表(环境)
  const qqAgent = 环境.假qq房们[0].agent
  const qq消息 = qqAgent && qqAgent.收到的[0]
  const qq文本 = qq消息 && qq消息.content.map((x) => x.text).join('')
  报('QQ 房间按需开房并 followup', !!qq消息, JSON.stringify(qq消息))
  报('QQ 房间用房间提示：点明不是主人、不端主人由头', /测试群/.test(qq文本) && /不是你的主人/.test(qq文本) && !/讲给主人听/.test(qq文本), qq文本)
}

// ============================================================
// 环境 4：坏配置文件兜底
// ============================================================
{
  const 环境 = 造环境({ 初始上次: 虚拟现在, 配置: '{ 坏掉的 json' })
  插件.apply(环境.假ctx)
  await 等(10)
  const st = await 调(环境, '/dsh-speak-up/state')
  报('配置文件坏掉 → 回默认值，不抛错', st.ok === true && st.配置.间隔分钟 === 30 && st.配置.最长间隔分钟 === 180)
}

console.log(`\n${挂 === 0 ? '全部通过 ✅' : `有 ${挂} 条没过 ❌`}`)
process.exitCode = 挂 === 0 ? 0 : 1
