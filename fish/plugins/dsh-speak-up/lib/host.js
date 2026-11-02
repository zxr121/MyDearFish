// DSH「主动搭话」· 宿主半边
//
// 干一件事：**她沉默越久，主动开口的概率越高；到最长间隔一定开口。**
//
//   定时器到点 → 按「距上次主动开口 / 最长间隔」和曲线类型算这一轮真实概率
//                 （纯本地 Math.random，**一个 token 都不花**）
//     ├─ 没掷中 → 只记一笔，等下一轮
//     └─ 掷中/到点 → agent.followup(message) → DSH 自己开一轮
//                    → 等她真的说出 assistant 正文 → 才把计时清零
//
// ⚠ 安静时段顺延：那段时间不检查；结束后如果已超过最长间隔，立即补一次。
// ⚠ 概率只有一个真源：算概率()。峰谷是两条曲线各自的倍率；到点不分峰谷，强制 100%。
//
// ⚠⚠ 为什么必须走 agent.followup()：那样才是 **DSH 自己的回合** ——
//    模型是照常被调用的，历史是会话自己的历史，工具是会话自己的工具。
//    绝对不要在插件里自己拼一段上下文、再往会话里塞一段死文字（那是假开口）。
//    followup 往活着的同一个 agent 的收件箱推一条消息，loop 会认领它、
//    开 turn、跑 step，跟用户打字发过去走的是同一条路。
//
// ⚠⚠⚠ 已知的硬限制（本版**改不了**，详见 README 的「做不到的地方」）：
//    **触发消息的角色只能是 user。** 想用 developer 角色是做不到的 ——
//    证据（都是读源码读出来的，不是猜的）：
//      1) @deepseek-ai/dsh-agent-loop/lib/index.js 在 step() 里把收件箱认领到的
//         消息**硬写成** user/message 事件：
//             this.session.append("user/message", message, { surfaceOp: "append" })
//         （它不看 message.role，写死的就是 user/message）
//      2) @deepseek-ai/dsh-session/lib/index.js 的 append() 里校验：
//             validateSessionEventData(...) →
//             if (event.type === "developer/message" !== (message.role === "developer")) throw
//         于是「user/message 事件 + developer 角色」= 直接抛错，整轮 turn 变成 error。
//      3) 另一个方向也不行：developer 消息在 dsh-llm 里会被
//         withoutDeveloperMessages() / projectToolUpdates() 从**发给模型的请求里摘掉**
//         （它只用来做「工具清单变更」这一种用途）→ 就算塞进去，模型也看不见那句话。
//    ⇒ 所以本插件送的是一条 **source.kind = "speak-up" 的 user 消息**：
//      角色上确实是 user（DSH 唯一放行的），但来源标记是她自己的，不是她打的字。
//      `角色` 这个设置项留着，但填 developer 时**本插件会明确拒绝并记账**，
//      不会去污染会话日志（宁可什么都不做，也不写坏她的记录）。
//
// ⚠ 为什么不用 export const Config（schemastery 配置 schema）：
//    本插件是被装进 profile 的 node_modules 里的第三方包，那个目录**没有**
//    @deepseek-ai/schemastery（只有 @deepseek-ai/dsh-home-paths）。
//    import 失败会让**整个插件加载不了**，所以本版不声明 Config，
//    配置一律走自己的 json 文件 + 自己的设置页（跟 dsh-write 等其他设置插件一样）。
//    想改成原生「插件配置」页的话，README 里写了要动什么。

import { readFileSync, writeFileSync, mkdirSync, statSync, renameSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

/** 插件的对外名字（也是路由前缀、日志前缀、source.kind）。 */
export const name = 'speak-up'

/**
 * 需要宿主提供的服务。缺任何一个，install 时会直接报错（这是好事，早炸早发现）。
 * ⚠ 'sessionTitle' 是为了「活着的会话」能显示名字（朗读桥 dsh-tts-bridge 和小说插件都是这么 inject 的）。
 *   实测这台机器上它一定在。真要装到没有它的部署上：删掉这一项即可（标题会走投影缓存那条路）。
 */
export const inject = ['agents', 'sessions', 'sessionTitle', 'webServer', 'timer', 'workspaceRegistry']

// ---------- 常量 ----------

const 目录 = process.env.DSH_HOME || join(homedir(), '.dsh')
const 配置文件 = join(目录, 'speak-up-config.json')
const 路由前缀 = '/dsh-speak-up'

/**
 * 改名（dsh-her-words → dsh-speak-up）之前的旧配置文件。
 * 只**读**它：新版第一次起来时，如果新文件还不存在、旧文件在，就把旧设置搬过来用
 * （不搬的话，勾好的目标会话、改过的间隔、写好的触发文案全都会被打回默认值）。
 * 下一次保存就会在新文件名下落盘，旧文件留着不管它，也不会再读。
 */
const 旧配置文件 = join(目录, 'her-words-config.json')

/**
 * 主动开口的状态文件（跟设置分开）。
 * 只记「上次主动开口」的时间：DSH 重启后保底计时不能悄悄归零。
 */
const 状态文件 = join(目录, 'speak-up-state.json')
const 状态版本 = 1

/**
 * 触发消息的来源标记。写进会话日志里，将来能一眼看出「这条不是她打的」。
 * ⚠ 不能叫 'user'，否则会被网页端当成真人排队消息来处理。
 */
const 源标记 = 'speak-up'

/** 记账（内存里最近多少条）。 */
const 日志上限 = 60

/** 曲线类型的合法值（设置页、归一化、鱼脑设置目录共用同一份名字）。 */
const 曲线类型们 = ['直线', '慢热', '快起', 'S形']

/** 到点判定容差：定时器可能提前几毫秒触发，1 秒内都算「到点」。 */
const 到点容差毫秒 = 1000

/** 发起主动开口后，等她真的说出正文的最长时间。 */
const 确认超时毫秒 = 10 * 60 * 1000

/** 版本号从 package.json 读，不写死。 */
const 版本 = (() => {
  try {
    const p = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'))
    return String(p.version || '?')
  } catch (error) {
    return '?'
  }
})()

/**
 * 全部设置的**默认值**（唯一一份真源）。
 *
 * ⚠ 触发文案的默认值是**中性的**（发布用）。使用者可以在设置页改成自己的口吻，
 *   比如「好久没见你说话了，我去找你聊聊」——**改设置页那一格就行，不用动代码**。
 *   默认值只在下面这一行，别处没有第二份。
 */
const 默认配置 = {
  总开关: true, // 关掉就完全不动
  试运行: false, // 出厂默认真发；想先观察几轮就在设置里重新打开
  // 全选 = 清单里的房间默认都勾着（含 QQ 群/好友）；取消勾选的房间记进「不主动的会话」。
  // 老配置里明确勾过「目标会话」的那份名单保留成 全选: false，不为升级擅自扩大范围。
  全选: true,
  目标会话: [], // 全选为 false 时才用：只在勾了的那几个会话里开口
  不主动的会话: [], // 全选为 true 时用：这些房间虽然默认勾着，但主人点名不要她主动
  间隔分钟: 30, // 检查节奏（分钟）：只决定多久看一眼概率曲线，不是概率本身
  // ---- 随时间上升的概率曲线 ----
  // 距上次主动开口越久，下一次检查开口的概率越高；到「最长间隔」那一点强制 100%。
  // 曲线类型只影响上升的快慢，四种都满足 f(0)=0、f(1)=1、严格上升。
  最长间隔分钟: 180, // 保底 T：到点这一轮必开口（默认 3 小时，可设置）
  曲线类型: '慢热', // '直线' | '慢热' | '快起' | 'S形'
  曲线强度: 4, // 慢热/快起用：越大越弯，范围 0.1~20
  // 峰谷省钱：峰时/谷时是固定时段（见 判峰时），这两格是各自曲线上的倍率。
  // 到点保底不分峰谷，仍然是 100%。
  峰时倍率: 0.5,
  谷时倍率: 1,
  安静起: 1, // 安静时段（小时，含起不含止）；起 === 止 表示不启用
  安静止: 8,
  触发文案: '好久没人跟我说话了，我该主动去打个招呼',
  保底文案: '好久没主动说话了，我去找主人冒个泡',
  角色: 'user', // 'user' = 现在唯一能跑通的；'developer' = 本插件会拒绝（详见文件头注释）
}

// ---------- 配置读写 ----------

/** 只认真正是布尔的真值，取不到就用兜底（避免 '' / 0 / 'false' 被误读成开着）。 */
function 布(值, 兜) {
  if (值 === true || 值 === 'true' || 值 === 1 || 值 === '1') return true
  if (值 === false || 值 === 'false' || 值 === 0 || 值 === '0') return false
  return 兜
}

/** 取数字并夹到区间里；不是数字就用兜底。 */
function 数(值, 兜, 小, 大) {
  const n = Number(值)
  if (!Number.isFinite(n)) return 兜
  return Math.min(大, Math.max(小, n))
}

/**
 * 「目标会话」洗成一个 id 数组（可以勾多个）。
 *
 * ⚠ 两种历史形状都要吃：
 *   · 数组  —— 现在的形状（设置页勾出来就是数组）
 *   · 字符串 —— 最早那版是单个 id 的输入框，可能还粘着一串（逗号/空格分隔）
 *   一律洗成去重后的非空字符串数组，所以老配置文件不用改。
 * ⚠ 结果顺序保持原样（勾选顺序就是数组顺序，页面上的顺序才稳定）。
 */
function 会话id列表(值) {
  const 出 = []
  const 加 = (v) => {
    const s = String(v == null ? '' : v).trim()
    if (s !== '' && !出.includes(s)) 出.push(s)
  }
  if (Array.isArray(值)) {
    for (const v of 值) 加(v)
  } else if (typeof 值 === 'string') {
    for (const v of 值.split(/[\s,;，、]+/)) 加(v)
  }
  return 出
}

/**
 * 把磁盘上/页面上来的东西洗成一份一定能用的配置。
 * 页面可能传来字符串，文件可能被人手改坏 —— 这一层是唯一的把关口。
 */
function 归一化(原始) {
  const 原始是对象 = 原始 && typeof 原始 === 'object' && !Array.isArray(原始)
  const 混 = 原始是对象 ? { ...默认配置, ...原始 } : { ...默认配置 }
  const 原始有 = (键) => 原始是对象 && 原始[键] !== undefined
  const 目标会话 = 会话id列表(混.目标会话)
  // 升级兼容：老版本没有「全选」，只要它明确勾过目标会话，就按老名单来（全选 = false）；
  // 没勾过（或从没存过配置）就走新默认 —— 清单里所有房间都算勾上。
  let 全选 = 布(混.全选, 默认配置.全选)
  if (!原始有('全选') && 原始有('目标会话') && 目标会话.length > 0) 全选 = false
  const 触发文案 =
    typeof 混.触发文案 === 'string' && 混.触发文案.trim() !== '' ? 混.触发文案 : 默认配置.触发文案
  const 保底文案 =
    typeof 混.保底文案 === 'string' && 混.保底文案.trim() !== '' ? 混.保底文案 : 触发文案
  const 曲线类型 = 曲线类型们.includes(String(混.曲线类型)) ? String(混.曲线类型) : 默认配置.曲线类型
  return {
    总开关: 布(混.总开关, 默认配置.总开关),
    试运行: 布(混.试运行, 默认配置.试运行),
    全选,
    目标会话,
    不主动的会话: 会话id列表(混.不主动的会话),
    间隔分钟: Math.round(数(混.间隔分钟, 默认配置.间隔分钟, 1, 1440)),
    最长间隔分钟: Math.round(数(混.最长间隔分钟, 默认配置.最长间隔分钟, 10, 1440)),
    曲线类型,
    曲线强度: 数(混.曲线强度, 默认配置.曲线强度, 0.1, 20),
    峰时倍率: 数(混.峰时倍率, 默认配置.峰时倍率, 0, 1),
    谷时倍率: 数(混.谷时倍率, 默认配置.谷时倍率, 0, 1),
    安静起: Math.round(数(混.安静起, 默认配置.安静起, 0, 23)),
    安静止: Math.round(数(混.安静止, 默认配置.安静止, 0, 23)),
    触发文案,
    保底文案,
    角色: String(混.角色 || 'user').toLowerCase() === 'developer' ? 'developer' : 'user',
  }
}

function 读配置() {
  // 新文件优先；没有就退回旧文件（改名搬家）；都没有才回默认值。
  // 一律不抛错 —— 设置页要能打开才有救。
  for (const 路径 of [配置文件, 旧配置文件]) {
    try {
      return 归一化(JSON.parse(readFileSync(路径, 'utf8')))
    } catch (error) {
      /* 读不到 / 读坏了 → 试下一个 */
    }
  }
  return 归一化(null)
}

function 写配置(配置) {
  try {
    mkdirSync(目录, { recursive: true })
    writeFileSync(配置文件, JSON.stringify(配置, null, 2), 'utf8')
    return true
  } catch (error) {
    return false
  }
}

/**
 * 读「上次主动开口」状态文件。
 * @returns {{ 上次主动开口: number|null, 坏: boolean, 存在: boolean }}
 */
function 读状态() {
  let 存在 = false
  try {
    存在 = existsSync(状态文件)
  } catch (error) {
    // 查不到文件是否存在：按「没有」处理
  }
  if (!存在) return { 上次主动开口: null, 坏: false, 存在: false }
  try {
    const j = JSON.parse(readFileSync(状态文件, 'utf8'))
    const t = Number(j && j.上次主动开口)
    if (Number.isFinite(t) && t > 0) return { 上次主动开口: t, 坏: false, 存在: true }
    return { 上次主动开口: null, 坏: true, 存在: true }
  } catch (error) {
    return { 上次主动开口: null, 坏: true, 存在: true }
  }
}

/** 原子写状态文件；返回是否写成功。 */
function 写状态(上次主动开口) {
  try {
    mkdirSync(目录, { recursive: true })
    const 临时 = 状态文件 + '.tmp'
    writeFileSync(临时, JSON.stringify({ 版本: 状态版本, 上次主动开口 }, null, 2), 'utf8')
    renameSync(临时, 状态文件)
    return true
  } catch (error) {
    return false
  }
}

/** 这个房间勾着没有：全选时只排除「不主动的会话」，老配置只看「目标会话」。 */
function 勾着(配置, id) {
  const 键 = String(id)
  if (配置.全选) return !配置.不主动的会话.includes(键)
  return 配置.目标会话.includes(键)
}

// ---------- 小工具 ----------

/** 本地时间，给人看的。ISO 那种 UTC 时间她会看糊涂。 */
function 显示时间(毫秒) {
  const d = new Date(毫秒)
  const 补 = (n) => String(n).padStart(2, '0')
  return `${补(d.getMonth() + 1)}-${补(d.getDate())} ${补(d.getHours())}:${补(d.getMinutes())}:${补(d.getSeconds())}`
}

function 现在显示() {
  return 显示时间(Date.now())
}

/**
 * 是不是在安静时段里。
 * ⚠ 起 > 止 要能跨午夜（比如 23 ~ 7），所以不能写成 h >= 起 && h < 止 一种。
 * ⚠ 起 === 止 一律当成「不启用安静时段」（不然 0~0 会变成全天静音，很难查）。
 *   设置页上这条有一行单独的醒目提醒，别删（她特意提过两次）。
 */
function 在安静时段(小时, 起, 止) {
  if (起 === 止) return false
  if (起 < 止) return 小时 >= 起 && 小时 < 止
  return 小时 >= 起 || 小时 < 止
}

// ---------- 峰谷分时 ----------
//
// ⚠⚠ 峰谷**时段是写死的，不给设置项**（她的原话：这个不用用户单独设置）。
//    规则（北京时间）就一条：
//      · 峰时（贵）：**周一~周五**的 09:00–12:00 和 14:00–18:00
//      · 谷时（便宜，价钱是峰时的一半）：**其余全部** —— 12:00–14:00 午休、18:00~次日 09:00、
//        **周六周日全天**
//    要她填的只有两个倍率：`峰时倍率` / `谷时倍率`（见 默认配置）。
//
// ⚠ 按她 2026-10-16 的话：**只按这一条规则走**（周几 + 两个时间窗），
//   不要在这里加任何别的日期判断、也不要加日期表 —— 就是个「周几 + 分钟数」的判断。
//
// ⚠ 时区：这里用的是**这台机器本地的时区**（`Date` 的 getDay/getHours 都是本地时间）。
//   她这台机器就是北京时间，所以不用额外换算；搬到别的时区跑就得自己换算。

/** 峰时的两段窗口（当天第几分钟，含起不含止）。 */
const 峰时窗口们 = [
  [9 * 60, 12 * 60], // 09:00 ~ 12:00
  [14 * 60, 18 * 60], // 14:00 ~ 18:00
]

/**
 * 这个时刻是不是**峰时**（贵）。
 *
 * ⚠ 判断只看「周几 + 当天第几分钟」，**"现在"必须从外面传进来** ——
 *   一来测试能喂假时间（半夜跑测试不能红），二来算概率那一步可以复用同一个时刻。
 * ⚠ 边界：09:00 算峰、12:00 算谷、14:00 算峰、18:00 算谷（含起不含止）。
 * ⚠ 周六周日**直接 false**（全天谷时），先判周末再算分钟，别把顺序写反。
 * ⚠ 导出只是为了 tests/宿主半边.mjs 能直接断言（跟官方 goal-round-driver 导出
 *   renderGoalRoundPrompt 是一个意思），插件本身不需要它对外。
 * @param 某时刻 Date（不传就是现在）
 * @returns true = 峰时（贵），false = 谷时（便宜）
 */
export function 判峰时(某时刻 = new Date()) {
  const d = 某时刻 instanceof Date ? 某时刻 : new Date(某时刻)
  const 周几 = d.getDay() // 0 = 周日，6 = 周六
  if (周几 === 0 || 周几 === 6) return false // 周末全天谷时
  const 分 = d.getHours() * 60 + d.getMinutes()
  return 峰时窗口们.some(([起, 止]) => 分 >= 起 && 分 < 止)
}

/**
 * 曲线形状：把「距上次主动开口 / 最长间隔」映射成 0~1 的概率。
 *
 * 四种都满足 f(0)=0、f(1)=1、严格上升：
 *   直线：u
 *   慢热：(e^(k u) - 1) / (e^k - 1)   —— 前段低、后段陡
 *   快起：ln(1 + k u) / ln(1 + k)     —— 前段升得快、后段趋缓
 *   S形：3u² - 2u³                    —— 两头缓、中间陡
 *
 * ⚠ 这是**纯函数**，测试可以不用碰定时器就把四种形状验一遍。
 * @param {string} 类型 - 曲线类型
 * @param {number} 强度 - k，慢热/快起使用
 * @param {number} u - 0~1 的进度
 * @returns {number} 0~1
 */
export function 形状值(类型, 强度, u) {
  const x = Math.min(1, Math.max(0, Number(u) || 0))
  const k = Math.min(20, Math.max(0.1, Number(强度) || 4))
  switch (类型) {
    case '直线':
      return x
    case '快起':
      return Math.log1p(k * x) / Math.log1p(k)
    case 'S形':
      return x * x * (3 - 2 * x)
    case '慢热':
    default:
      return (Math.exp(k * x) - 1) / (Math.exp(k) - 1)
  }
}

/**
 * 算这一轮真正会用的概率。
 *
 *   已过 >= T（留 1 秒容差） → 1（到点保底，不分峰谷）
 *   否则                     → clamp(形状值(u) × 峰/谷倍率, 0, 1)
 *
 * ⚠ 这是调度、记账、曲线、当前点的唯一真源；别在别处再拼概率。
 * @param {object} 配置 - 归一化后的配置
 * @param {number} 已过毫秒 - 距上次主动开口的毫秒数
 * @param {Date|number} 现在 - 用来判峰谷的时刻
 * @returns {{概率:number,保底:boolean,峰:boolean,倍率:number,u:number,已过分钟:number}}
 */
export function 算概率(配置, 已过毫秒, 现在 = new Date()) {
  const 已过 = Math.max(0, Number(已过毫秒) || 0)
  const T毫秒 = Math.max(1, Number(配置.最长间隔分钟) || 180) * 60 * 1000
  const 保底 = 已过 >= Math.max(0, T毫秒 - 到点容差毫秒)
  const u = Math.min(1, 已过 / T毫秒)
  const 峰 = 判峰时(现在)
  const 倍率 = 峰 ? 配置.峰时倍率 : 配置.谷时倍率
  const 概率 = 保底
    ? 1
    : Math.min(1, Math.max(0, 形状值(配置.曲线类型, 配置.曲线强度, u) * 倍率))
  return { 概率, 保底, 峰, 倍率, u, 已过分钟: 已过 / 60000 }
}

/**
 * 一轮检查会落在哪些分钟：Δ、2Δ、…，并在最后补上 T。
 * 例如 T=180、Δ=30 → [30,60,90,120,150,180]；T=100、Δ=30 → [30,60,90,100]。
 * @param {number} 间隔分钟 - 检查节奏 Δ
 * @param {number} 最长间隔分钟 - 保底 T
 * @returns {number[]}
 */
export function 检查时刻分钟(间隔分钟, 最长间隔分钟) {
  const Δ = Math.max(1, Math.round(Number(间隔分钟) || 30))
  const T = Math.max(1, Math.round(Number(最长间隔分钟) || 180))
  const 出 = []
  for (let m = Δ; m < T; m += Δ) 出.push(m)
  if (出.length === 0 || 出[出.length - 1] !== T) 出.push(T)
  return 出
}

/**
 * 安静时段结束的时刻（本地时间）。只在「现在确实在安静时段里」时调用。
 * ⚠ 跨午夜：23~7 在 23:30 时，结束是**次日** 07:00；在 02:00 时，结束是**今天** 07:00。
 * ⚠ 用本地 Date 构造而不是手算偏移，DST/改时区跟着系统走。
 * @param {Date|number} 现在 - 当前时刻
 * @param {number} 起 - 安静起（小时）
 * @param {number} 止 - 安静止（小时）
 * @returns {Date|null} 起===止（不启用）时返回 null
 */
export function 安静结束时刻(现在, 起, 止) {
  if (起 === 止) return null
  const d = 现在 instanceof Date ? 现在 : new Date(现在)
  const 结束 = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 止, 0, 0, 0)
  if (结束.getTime() <= d.getTime()) 结束.setDate(结束.getDate() + 1)
  return 结束
}

/**
 * 给设置页画图用的曲线数据。所有概率都是 0~100 的百分数。
 *
 * 曲线在 T 处有竖直段：T 之前是 `f(u) × 倍率`，T 那一点强制 100%。
 * @param {object} 配置 - 归一化后的配置
 * @param {Date|number} 现在 - 用来判当前是峰时还是谷时
 * @param {number|null} [已过毫秒] - 距上次主动开口；null = 不知道
 * @param {number} [点数] - 采样点数
 * @returns {object} 曲线对象
 */
export function 算曲线(配置, 现在 = new Date(), 已过毫秒 = null, 点数 = 181) {
  const T = Math.max(1, Number(配置.最长间隔分钟) || 180)
  const 采样 = Math.max(2, Math.round(Number(点数) || 181))
  const 谷 = []
  const 峰 = []
  for (let i = 0; i < 采样; i++) {
    const 分钟 = (T * i) / 采样
    const base = 形状值(配置.曲线类型, 配置.曲线强度, 分钟 / T)
    谷.push([Number(分钟.toFixed(2)), Number((base * 配置.谷时倍率 * 100).toFixed(2))])
    峰.push([Number(分钟.toFixed(2)), Number((base * 配置.峰时倍率 * 100).toFixed(2))])
  }
  // T 处的竖直段：先按倍率画到 T，再在同一个 x 上跳到 100。
  const 谷尾 = Number((形状值(配置.曲线类型, 配置.曲线强度, 1) * 配置.谷时倍率 * 100).toFixed(2))
  const 峰尾 = Number((形状值(配置.曲线类型, 配置.曲线强度, 1) * 配置.峰时倍率 * 100).toFixed(2))
  谷.push([T, 谷尾], [T, 100])
  峰.push([T, 峰尾], [T, 100])

  const 现在Date = 现在 instanceof Date ? 现在 : new Date(现在)
  let 当前 = null
  if (Number.isFinite(Number(已过毫秒)) && Number(已过毫秒) >= 0) {
    const 已过 = Number(已过毫秒)
    const 算 = 算概率(配置, 已过, 现在Date)
    const 分钟 = Math.min(T, 已过 / 60000)
    const 谷值 = 算.保底 ? 100 : Number((形状值(配置.曲线类型, 配置.曲线强度, 分钟 / T) * 配置.谷时倍率 * 100).toFixed(2))
    const 峰值 = 算.保底 ? 100 : Number((形状值(配置.曲线类型, 配置.曲线强度, 分钟 / T) * 配置.峰时倍率 * 100).toFixed(2))
    当前 = {
      分钟: Number(分钟.toFixed(2)),
      谷: 谷值,
      峰: 峰值,
      生效: 算.峰 ? '峰' : '谷',
    }
  }

  return {
    最长间隔分钟: T,
    曲线类型: 配置.曲线类型,
    曲线强度: 配置.曲线强度,
    峰时倍率: 配置.峰时倍率,
    谷时倍率: 配置.谷时倍率,
    谷,
    峰,
    检查点们: 检查时刻分钟(配置.间隔分钟, T),
    当前,
    保底: { 分钟: T, 百分比: 100 },
  }
}

/**
 * 下一次检查该在多长时间之后。
 *
 * - 安静时段：顺延到安静结束；
 * - 正常：min(检查间隔, 到 T 的剩余)；
 * - 已经逾期：如果刚检查过 → 按检查间隔重试（避免 0 毫秒热循环）；
 *            不是刚检查（启动/保存/确认成功）→ 1 秒后立即尝试保底；
 * - 正在等回话确认：不排（返回 null），由确认结算后再排。
 * @param {object} 配置 - 归一化后的配置
 * @param {number|null} 上次主动开口 - ms；null = 不知道
 * @param {number} [现在] - ms
 * @param {{刚检查?:boolean,待确认?:boolean}} [选项]
 * @returns {{毫秒:number|null,原因:string}}
 */
export function 下次检查毫秒(配置, 上次主动开口, 现在 = Date.now(), 选项 = {}) {
  if (选项.待确认) return { 毫秒: null, 原因: '待确认' }
  const Δ毫秒 = Math.max(1, Number(配置.间隔分钟) || 30) * 60 * 1000
  const T毫秒 = Math.max(1, Number(配置.最长间隔分钟) || 180) * 60 * 1000
  const 此刻 = Number(现在) || Date.now()
  const 上次 = Number(上次主动开口)
  const 已过 = Number.isFinite(上次) && 上次 > 0 ? Math.max(0, 此刻 - 上次) : 0
  const d = new Date(此刻)
  if (在安静时段(d.getHours(), 配置.安静起, 配置.安静止)) {
    const 结束 = 安静结束时刻(d, 配置.安静起, 配置.安静止)
    return { 毫秒: 结束 ? Math.max(1000, 结束.getTime() - 此刻) : Δ毫秒, 原因: '安静结束' }
  }
  if (已过 >= T毫秒 - 到点容差毫秒) {
    return { 毫秒: 选项.刚检查 ? Δ毫秒 : 1000, 原因: 选项.刚检查 ? '重试' : '保底' }
  }
  const 剩余 = Math.max(1000, T毫秒 - 已过)
  const 毫秒 = Math.min(Δ毫秒, 剩余)
  return { 毫秒, 原因: 毫秒 === 剩余 ? '保底' : '间隔' }
}

/** 新消息 id。跟 createMessage 一样是个普通字符串（branded 只是编译期的事）。 */
function 新id() {
  try {
    return randomUUID()
  } catch (error) {
    return 'hw-' + Date.now() + '-' + Math.random().toString(36).slice(2)
  }
}

/**
 * 会话 id 的**后 8 位**。
 * ⚠ id 长这样 `session-0f1e2d3c-4b5a-6978-8c9d-0a1b2c3d4e5f`：前半段（`session-` 和
 *   uuid 的头几个字节）全都一样，只看前面根本分不出谁是谁，只有尾巴能区分。
 */
function 短id(id) {
  const s = String(id)
  return s.length <= 8 ? s : s.slice(-8)
}

/**
 * 从会话 id 认出 QQ 群/好友房间（`session-qq-social-group-<号>`，分线带 `-p2`）。
 * 桥里删掉的房间、或桥不在时的老会话，`qqSocial` 清单里没有，但 id 仍然说明屋里是外人：
 * 这类会话宁可不动，也不能把「讲给主人听」的由头端进去。
 * @param {string} id - 会话 id。
 * @returns {{ 类型: 'group'|'friend', 号: string, 叫: string, 名: string } | null}
 */
function 从会话id认房(id) {
  const m = String(id || '').match(/qq-social-(group|friend)-(\d+)/)
  if (!m) return null
  const 类型 = m[1]
  const 号 = m[2]
  return { 类型, 号, 叫: `${类型 === 'group' ? '群' : '好友'} ${号}`, 名: '' }
}

/**
 * 按 id 找活着的 agent，**两种写法都认**。
 *
 * ⚠ 实测（2026-10-16，她这台机器上）：`ctx.sessions.list()` / `agents.list()` 给出的 id
 *   **本来就带 `session-` 前缀**（例如 `session-0f1e2d3c-…`），所以她把设置页里那串
 *   带前缀的 id 填进来时，`agents.get(原样)` 是**对得上**的（当时 `目标活着: true` 就是证据）。
 *   但"id 到底带不带前缀"这件事她以前踩过坑（前缀被拼了两次），所以这里**两个方向都兜住**：
 *   原样 → 带前缀 → 去前缀，哪个能拿到 agent 就用哪个。多试一次不多花钱，猜错一次要她排查半天。
 */
function 找agent(ctx, id) {
  const 原 = String(id == null ? '' : id).trim()
  if (原 === '') return undefined
  const 候选 = [原]
  if (原.startsWith('session-')) 候选.push(原.slice('session-'.length))
  else 候选.push('session-' + 原)
  for (const 一个 of 候选) {
    try {
      const a = ctx.agents.get(一个)
      if (a !== undefined) return a
    } catch (error) {
      // agents 服务不在/查不动：当成「没找到」，交给调用方按「没活着」处理
    }
  }
  return undefined
}

/** 子代理不是「她住的房间」，主动搭话不该往那儿塞话。 */
function 是子代理(agent) {
  const header = agent && agent.session && agent.session.header
  if (!header) return false
  return header.origin === 'subagent' || (typeof header.delegationDepth === 'number' && header.delegationDepth > 0)
}

/** 所有活着、非子代理的会话。没勾目标时，她就是在这几个房间里中的某一个开口。 */
function 活着的会话(ctx) {
  const ids = []
  try {
    for (const agent of ctx.agents.list() || []) {
      if (!agent || 是子代理(agent)) continue
      const sid = agent.id || (agent.session && agent.session.id)
      if (sid && !/^(session-)?qq-social-/.test(String(sid))) ids.push(String(sid))
    }
  } catch (error) {}
  return Array.from(new Set(ids))
}

/** 「通到QQ」插件在的时候借它的服务：认出 QQ 群/好友、按需开房。 */
function 取qq社交(ctx) {
  try {
    const qq = typeof ctx.get === 'function' ? ctx.get('qqSocial') : undefined
    return qq && typeof qq.房间们 === 'function' ? qq : null
  } catch (error) {
    return null
  }
}

/** 没勾目标时，优先她最近真的待过的房间（鱼脑按最近活动给会话排过序）。 */
function 按最近活跃排序(ctx, ids) {
  if (ids.length < 2) return ids
  let 最近 = []
  try {
    const mind = typeof ctx.get === 'function' ? ctx.get('fishMind') : undefined
    if (mind && typeof mind.sessions === 'function') {
      最近 = (mind.sessions(Math.max(ids.length, 10)) || []).map((x) => String(x.id))
    }
  } catch (error) {}
  if (最近.length === 0) return ids
  const 位次 = new Map(最近.map((id, i) => [id, i]))
  return ids.slice().sort((a, b) => (位次.get(a) ?? 999) - (位次.get(b) ?? 999))
}

/**
 * 手搓一条 user 消息。
 *
 * ⚠ 形状是**照 @deepseek-ai/dsh-llm 的 createUserMessage 抄的**：
 *     createMessage({ ...input, role: 'user' }) → { ...input, role: 'user', id }
 *   运行时要过的校验（dsh-session）只有这几条：
 *     · id 非空字符串 · role === 'user'（user/message 事件必须 user 角色）
 *     · source.kind 非空字符串 · content 是数组
 *     · 整条能被 JSON 序列化（append 会 snapshotJsonValue 快照一份）
 *   我们都满足，所以不用 import dsh-llm 也能过。
 */
function 手搓用户消息(文案) {
  return {
    id: 新id(),
    role: 'user',
    content: [{ type: 'text', text: String(文案) }],
    source: { kind: 源标记 },
  }
}

// ---------- 装消息工厂（能拿到官方的就用官方的）----------

let 造消息工厂 = undefined // undefined = 还没试过；null = 试过，拿不到

/**
 * 试着拿 @deepseek-ai/dsh-llm 的 createUserMessage。
 * ⚠ 第三方插件装在 profile 的 node_modules 下，那里通常**没有** @deepseek-ai/dsh-llm，
 *   所以这里失败是**正常现象**，会自动退回手搓那条路，不能因此报错。
 */
async function 拿造消息工厂() {
  if (造消息工厂 !== undefined) return 造消息工厂
  try {
    const 模块 = await import('@deepseek-ai/dsh-llm')
    if (模块 && typeof 模块.createUserMessage === 'function') {
      造消息工厂 = 模块
      return 造消息工厂
    }
  } catch (error) {
    // 预期内的失败，不记 warn，免得日志里刷屏
  }
  造消息工厂 = null
  return null
}

// ---------- 掷骰子 ----------

/**
 * 装一个「主动搭话」的执行体。所有状态都关在这个闭包里，
 * 插件卸载（ctx.effect 的清理）时整块丢掉。
 */
function 造执行体(ctx) {
  /** 最近几次检查/开口的记录（给设置页看，也顺便写进 ctx.logger）。 */
  const 日志 = []

  /** 全局「上次主动开口」的毫秒时间；null = 还没初始化。 */
  let 上次主动开口 = null

  /** 正在等她真的说出正文的那一轮。 */
  let 待确认 = null

  /** sid -> 当前 turn（turn/start 记，turn/end 清）。 */
  const 当前轮 = new Map()

  /** 停下一次检查的把手。 */
  let 停表 = null

  /** 插件已经卸载：异步回调不要再排下一轮。 */
  let 已收摊 = false

  function 记账(文本) {
    const 条 = { 时间: 现在显示(), 文本: String(文本) }
    日志.push(条)
    if (日志.length > 日志上限) 日志.shift()
    try {
      ctx.logger.info(`speak-up: ${条.文本}`)
    } catch (error) {
      // logger 不在也不影响主流程
    }
    return 条
  }

  /** 从磁盘恢复「上次主动开口」；没有/坏了就从现在开始。 */
  function 初始化状态() {
    const 读 = 读状态()
    const 此刻 = Date.now()
    if (读.坏) 记账(`状态文件读不出来（${状态文件}），按现在重新计时`)
    if (读.上次主动开口 === null) {
      上次主动开口 = 此刻
      const 写好 = 写状态(上次主动开口)
      记账(`还没有上次主动开口的记录，从现在开始计时${写好 ? '' : '（状态文件写不进去）'}`)
      return
    }
    if (读.上次主动开口 > 此刻 + 1000) {
      上次主动开口 = 此刻
      写状态(上次主动开口)
      记账('上次主动开口的时间在未来（时钟回拨？），已按现在重新计时')
      return
    }
    上次主动开口 = 读.上次主动开口
    记账(`上次主动开口：${显示时间(上次主动开口)}`)
  }

  /** 概率说明：记账、启动行、设置页共用一份口径。 */
  function 概率说明(算, 配置) {
    const 段 = `距上次主动开口 ${算.已过分钟.toFixed(1)} 分钟 / 最长 ${配置.最长间隔分钟} 分钟｜${算.峰 ? '峰时' : '谷时'} ×${算.倍率}｜本次概率 ${(算.概率 * 100).toFixed(1)}%`
    return 算.保底 ? `${段}（到点保底）` : 段
  }

  /** 从一条 assistant 消息里只抽正文（text 块拼起来），跟 QQ 桥的 提取正文 同口径。 */
  function 提取正文(message) {
    if (!message || !Array.isArray(message.content)) return ''
    return message.content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim()
  }

  /** 当前状态：给设置页的「概率状态」用。 */
  function 算状态(配置) {
    const 现在 = new Date()
    const 已过毫秒 = 上次主动开口 === null ? 0 : Math.max(0, 现在.getTime() - 上次主动开口)
    const 算 = 算概率(配置, 已过毫秒, 现在)
    const 安静中 = 在安静时段(现在.getHours(), 配置.安静起, 配置.安静止)
    const 安静到 = 安静中 ? 安静结束时刻(现在, 配置.安静起, 配置.安静止) : null
    const 排 = 下次检查毫秒(配置, 上次主动开口, 现在.getTime(), { 待确认: 待确认 !== null })
    const 状态 = 待确认 !== null
      ? '待确认'
      : !配置.总开关
        ? '总开关关'
        : 配置.试运行
          ? '试运行'
          : 安静中
            ? '安静'
            : '正常'
    return {
      已过分钟: Number(算.已过分钟.toFixed(2)),
      进度: Number(算.u.toFixed(4)),
      峰: 算.峰,
      倍率: 算.倍率,
      本次概率: Number((算.概率 * 100).toFixed(2)),
      保底: 算.保底,
      上次主动开口,
      上次主动开口显示: 上次主动开口 === null ? '' : 显示时间(上次主动开口),
      状态,
      下次检查: 排.毫秒 === null ? '' : 显示时间(现在.getTime() + 排.毫秒),
      下次检查毫秒: 排.毫秒,
      下次原因: 排.原因,
      安静中,
      安静到: 安静到 === null ? '' : 显示时间(安静到.getTime()),
      待确认: 待确认 === null
        ? null
        : {
            短id: 短id(待确认.sid),
            回合: 待确认.轮号,
            已等秒: Math.max(0, Math.round((Date.now() - 待确认.起始) / 1000)),
          },
    }
  }

  /** 结算一次主动开口：只有真的成文才算数。 */
  function 结算确认(成功, 失败说明 = '') {
    if (待确认 === null) return
    const 记录 = 待确认
    待确认 = null
    if (typeof 记录.超时 === 'function') {
      try {
        记录.超时()
      } catch (error) {
        // 超时把手已经自己收掉也不影响
      }
    }
    const 标记 = 记录.保底 ? '保底' : '主动'
    if (成功) {
      上次主动开口 = Date.now()
      const 写好 = 写状态(上次主动开口)
      try {
        const mind = typeof ctx.get === 'function' ? ctx.get('fishMind') : undefined
        if (mind && typeof mind.spoke === 'function') mind.spoke(记录.qq ? null : 记录.cueId)
      } catch (error) {
        记账(`内心层没记上这次开口：${String((error && error.message) || error)}`)
      }
      const 摘录 = 记录.正文.replace(/\s+/g, ' ').trim().slice(0, 80)
      记账(
        `${标记}已确认她真的开口了（${短id(记录.sid)}，回合 ${记录.轮号 === null ? '?' : 记录.轮号}）` +
          `｜她说：「${摘录}」${写好 ? '' : '（状态文件没写进去）'}｜计时清零`,
      )
    } else {
      记账(
        `${标记}发起后没有成文（${短id(记录.sid)}，回合 ${记录.轮号 === null ? '?' : 记录.轮号}）：` +
          `${失败说明 || '没有可发的话'}｜只记录，不直发；计时不重置`,
      )
    }
    if (!已收摊) 排下一次({ 刚检查: true })
  }

  /** 发起一轮之后登记待确认；等 assistant 正文 + turn/end 来结算。 */
  function 登记待确认(sid, 保底, 文案, cueId, qq) {
    停下一轮()
    const 记录 = {
      sid: String(sid),
      起始: Date.now(),
      轮号: null,
      保底: !!保底,
      文案: String(文案),
      cueId: cueId === undefined ? null : cueId,
      qq: !!qq,
      正文: '',
      中断: false,
      超时: null,
    }
    待确认 = 记录
    if (typeof ctx.timeout === 'function') {
      记录.超时 = ctx.timeout(() => {
        if (待确认 !== 记录) return
        结算确认(false, `等了 ${Math.round(确认超时毫秒 / 60000)} 分钟也没等到她的正文`)
      }, 确认超时毫秒)
    }
    记账(`已发起${记录.保底 ? '保底' : '主动'}一轮（${短id(记录.sid)}），等她真的说出正文……`)
  }

  /** 会话事件：认回合、收正文、结算。只认登记过的 sid + turn。 */
  function 处理会话事件(session, event) {
    if (!session || !event) return
    const sid = String(session.id)
    if (event.type === 'turn/start') {
      const turn = Number(event.data && event.data.turn)
      if (Number.isSafeInteger(turn)) 当前轮.set(sid, turn)
      return
    }
    if (event.type === 'turn/end') {
      const turn = Number(event.data && event.data.turn)
      if (当前轮.get(sid) === turn) 当前轮.delete(sid)
    }
    if (待确认 === null || 待确认.sid !== sid) return
    if (event.type === 'user/message') {
      const 来源 = event.data && event.data.source
      if (来源 && 来源.kind === 源标记 && 待确认.轮号 === null) {
        const turn = 当前轮.get(sid)
        if (Number.isSafeInteger(turn)) {
          待确认.轮号 = turn
          记账(`已在 ${短id(sid)} 的回合 ${turn} 里认出主动搭话，等她出正文`)
        }
      }
      return
    }
    if (event.type === 'assistant/message') {
      const turn = Number(event.data && event.data.turn)
      if (!Number.isSafeInteger(turn) || turn !== 待确认.轮号) return
      const d = event.data || {}
      if (d.interrupted) {
        待确认.中断 = true
        return
      }
      const 正文 = 提取正文(d.message)
      if (正文 !== '') 待确认.正文 = 待确认.正文 === '' ? 正文 : `${待确认.正文}\n${正文}`
      return
    }
    if (event.type === 'turn/end') {
      const turn = Number(event.data && event.data.turn)
      if (!Number.isSafeInteger(turn) || turn !== 待确认.轮号) return
      const reason = event.data && event.data.reason
      const 完成 = !!(reason && reason.kind === 'completed')
      结算确认(
        完成 && 待确认.正文 !== '' && !待确认.中断,
        完成 ? '这一轮结束了，但没有可发的话' : '这一轮没有正常完成',
      )
    }
  }

  /**
   * 掷一次骰子。整个过程**不碰模型**；只有最后真发那一步才会花 token。
   * @param 来源 '定时' | '手动'
   * @param 模式 '自动' | '演练' | '真发'
   *   · 自动 —— 定时器到点走的路，受总开关/安静时段/概率约束，试运行开着就只记账
   *   · 演练 —— 手动按钮「演练一次」：跳过安静时段和概率（一定走到最后一步），**绝不真发**
   *   · 真发 —— 手动按钮「真发一次」：跳过等待和试运行，真的 followup（用于当场验证）
   */
  async function 掷一次(来源, 模式) {
    const 配置 = 读配置()
    const 演练 = 模式 === '演练' || (模式 === '自动' && 配置.试运行)
    // ⚠ 整轮**只取一次"现在"**（安静时段、峰谷判档、记账都用它）——
    //   免得刚好压在边界上（比如 12:00:00）时，判档和记账说的不是同一档。
    const 现在 = new Date()

    if (模式 === '自动' && !配置.总开关) return 记账('总开关是关着的，这轮不动')
    if (模式 === '自动') {
      if (待确认 !== null) return 记账('上一轮还在等她的正文，这轮不重复')
      const 小时 = 现在.getHours()
      if (在安静时段(小时, 配置.安静起, 配置.安静止)) {
        const 结束 = 安静结束时刻(现在, 配置.安静起, 配置.安静止)
        return 记账(
          `现在 ${小时} 点在安静时段（${配置.安静起}~${配置.安静止}）里，这轮不掷` +
            (结束 === null ? '' : `，等 ${显示时间(结束.getTime())} 结束后再看`),
        )
      }
    }
    if (模式 === '真发' && 待确认 !== null) {
      return 记账('已经有一轮在等她开口确认，先不真发')
    }

    // 清单里的房间默认都勾着：QQ 群/好友（哪怕还没开房）+ 本机活着的会话。
    // 取消过勾的记在「不主动的会话」里；老配置明确勾过名单的仍按那份名单走。
    const 候选会话 = []
    const 已见 = new Set()
    const 加候选 = (id, 房) => {
      const 键 = String(id || '')
      if (键 === '' || 已见.has(键)) return
      已见.add(键)
      候选会话.push({ id: 键, 房: 房 || null })
    }
    const qq = 取qq社交(ctx)
    if (qq) {
      let 房们 = []
      try {
        房们 = qq.房间们() || []
      } catch (error) {
        记账(`读 QQ 房间清单失败（这轮先只看本机会话）：${String((error && error.message) || error)}`)
      }
      for (const 房 of 房们) {
        if (!房 || !勾着(配置, 房.会话id)) continue
        加候选(房.会话id, 房)
      }
    }
    for (const id of 按最近活跃排序(ctx, 活着的会话(ctx))) {
      if (勾着(配置, id)) 加候选(id, 从会话id认房(id))
    }
    // 老名单里勾着的会话可能已经关掉了：也留着，下面会标「没活着」。
    if (!配置.全选) {
      for (const id of 配置.目标会话) 加候选(id, 从会话id认房(id))
    }
    if (候选会话.length === 0) {
      return 记账(
        模式 === '真发'
          ? '现在一个勾着的房间都没有：在设置里勾一个再真发'
          : '现在没有勾着、又能开口的房间，这轮什么都不做',
      )
    }

    // 勾了好几个时：**这次只在其中一个里开口**（随机挑一个能开口又不忙的）。
    // 为什么不全都发：一次掷中就往每个会话里说一句，等于同时开好几轮、同时烧好几份 token，
    // 而且「她」听起来像分身。挑一个最像真人（她只在一个地方说话）。
    const 可用 = []
    const 不可用 = []
    // ⭐ 已归档的会话不参与（归档只是藏起来，agent 可能还在；往里塞话等于往废纸篓里说）
    const 归档名单 = new Set()
    try {
      const 登记 = ctx.workspaceRegistry || ctx.get('workspaceRegistry')
      for (const x of (登记 && 登记.archivedSessionIds) || []) 归档名单.add(String(x))
    } catch (error) {}
    for (const 候 of 候选会话) {
      const id = 候.id
      if (归档名单.has(String(id))) {
        不可用.push(`${短id(id)}(已归档)`)
        continue
      }
      const a = 找agent(ctx, id)
      if (候.房) {
        // QQ 房间：桥那边先挡住关掉/只听/歇着/静音/额度用尽的；没开房的掷中后再开。
        if (!候.房.能开口) {
          不可用.push(`${短id(id)}(QQ：${候.房.不能因 || '现在不能主动开口'})`)
          continue
        }
        // 群里的「主动开话题」还要过桥的开头闸门：没勾选、今天用完了、屋里正热聊都不选。
        if (候.房.类型 === 'group' && 候.房.能开头 === false) {
          不可用.push(`${短id(id)}(QQ：${候.房.开头不能因 || '现在不适合起话'})`)
          continue
        }
        if (a !== undefined && a.status !== undefined && a.status !== 'idle') {
          不可用.push(`${短id(id)}(忙)`)
          continue
        }
        可用.push({ id, agent: a === undefined ? null : a, qq: true, 房: 候.房 })
        continue
      }
      if (a === undefined) {
        不可用.push(`${短id(id)}(没活着)`)
        continue
      }
      const 状态 = a.status
      if (状态 !== undefined && 状态 !== 'idle') {
        不可用.push(`${短id(id)}(忙)`)
        continue
      }
      可用.push({ id, agent: a, qq: false })
    }
    if (可用.length === 0) {
      return 记账(
        `候选房间现在都不能开口（${不可用.join('、') || '（空）'}）—— 按设计**不自动唤醒**，这轮什么都不做`,
      )
    }
    const 挑中 = 可用[Math.floor(Math.random() * 可用.length)]
    const 目标id = 挑中.id
    let agent = 挑中.agent
    const 挑的说法 = 可用.length > 1
      ? `（从 ${可用.length} 个能开口的房间里这次挑 ${短id(目标id)}${挑中.qq ? '，QQ 房间' : ''}）`
      : (挑中.qq ? `（这次挑 ${短id(目标id)}，QQ 房间）` : '')

    // 自动那一轮：先算这一轮真正会用的概率，再掷。概率只来自 算概率()，没有隐藏加成。
    let 算 = null
    let 前缀 = ''
    if (模式 === '自动') {
      const 已过毫秒 = 上次主动开口 === null ? 0 : Math.max(0, 现在.getTime() - 上次主动开口)
      算 = 算概率(配置, 已过毫秒, 现在)
      const 掷值 = Math.random()
      const 说明 = 概率说明(算, 配置)
      if (掷值 >= 算.概率) {
        return 记账(
          `没掷中 ✗ ${说明}｜掷出 ${(掷值 * 100).toFixed(1)}（要小于 ${(算.概率 * 100).toFixed(1)} 才开口）`,
        )
      }
      前缀 = `${算.保底 ? '保底到点 ✓' : '掷中 ✓'} ${说明}｜掷出 ${(掷值 * 100).toFixed(1)}｜${挑的说法}`
    } else {
      前缀 = `【${来源}/${模式}】手动触发（不掷骰子、不算概率、不动计时）｜${挑的说法}`
    }

    // 内心层：由头只决定开口内容，不再改概率。拿不到鱼脑就用固定文案。
    let mind
    let 心里 = null
    try {
      mind = typeof ctx.get === 'function' ? ctx.get('fishMind') : undefined
      if (mind && typeof mind.urge === 'function') 心里 = mind.urge()
    } catch (error) {
      记账(`内心层这次没读到（${String((error && error.message) || error)}），照常用固定文案`)
    }
    const 心里强度 = 心里 && Number.isFinite(Number(心里.strength))
      ? Math.max(0, Math.min(1, Number(心里.strength)))
      : 0
    const 由头语 = 心里 && 心里.cue
      ? (挑中.qq
          ? '（由头留给主人，这间屋不端出去）'
          : `（由头：${String(心里.cue.text || '').slice(0, 48)}）`)
      : ''
    const 心里语 = 心里强度 > 0 ? `｜倾述欲 ${Math.round(心里强度 * 100)}%${由头语}` : ''
    // 到点那一轮用保底文案；平时用触发文案。QQ 房间仍然用房间提示。
    const 基础文案 = 算 !== null && 算.保底 ? 配置.保底文案 : 配置.触发文案
    let 文案 = 基础文案
    let 开头语 = ''
    if (挑中.qq) {
      // QQ 群/好友：屋里的人不是主人，鱼脑那份「讲给主人听」的私房话不能端到这儿来。
      const qq服务 = 取qq社交(ctx)
      let 开头 = null
      if (挑中.房 && 挑中.房.类型 === 'group' && qq服务 && typeof qq服务.开头建议 === 'function') {
        try {
          开头 = await qq服务.开头建议(挑中.房.会话id || 目标id, { 登记: !演练 })
        } catch (error) {
          记账(`群开头建议没拿到（${String((error && error.message) || error)}），这轮按旧提示走`)
        }
      }
      if (开头 && 开头.ok === true && typeof 开头.提示 === 'string' && 开头.提示.trim() !== '') {
        文案 = 开头.提示
        开头语 = 开头.类型 ? `｜开头 ${开头.类型}` : ''
      } else if (开头 && 开头.ok === false) {
        return 记账(`${前缀}${心里语}这间屋这次不起话：${开头.因 || '没有合适的由头'}`)
      } else {
        // 桥不在 / 旧版桥没有开头建议：保留旧提示，至少不要把私房话端进群。
        文案 = 群友开口提示(挑中.房)
      }
    } else if (心里 && 心里.cue && mind && typeof mind.confidePrompt === 'function') {
      try {
        const 拼出来 = mind.confidePrompt(心里)
        if (typeof 拼出来 === 'string' && 拼出来.trim() !== '') 文案 = 拼出来
      } catch (error) {
        记账(`心里由头没拼成（${String((error && error.message) || error)}），这次用固定文案`)
      }
    }

    if (配置.角色 === 'developer') {
      // 不是「没实现」，是**当前 DSH 版本上做不到**（见文件头注释的三条证据）。
      // 在这里主动拦下来，是为了不去污染她的会话日志（真发出去会让那一轮 turn 直接 error）。
      return 记账(`${前缀}角色填的是 developer，但当前 DSH 送不了 developer 角色（详见 README「做不到的地方」），这轮**主动不发**`)
    }

    if (演练) {
      return 记账(`${前缀}${心里语}${开头语}演练：本来要往「${目标id}」送一句「${文案}」`)
    }

    try {
      // QQ 房间平时只有来消息才开；掷中之后才开房，没掷中不花这份钱、也不多一间空会话。
      if (agent === null) {
        const qq服务 = 取qq社交(ctx)
        const 开出来的 = qq服务 && typeof qq服务.开房 === 'function' ? await qq服务.开房(目标id) : null
        if (!开出来的) return 记账(`QQ 房间「${目标id}」这次没开出来，这轮不开口`)
        agent = 开出来的
      }
      const 工厂 = await 拿造消息工厂()
      const 消息 = 工厂
        ? 工厂.createUserMessage({ content: [{ type: 'text', text: 文案 }], source: { kind: 源标记 } })
        : 手搓用户消息(文案)
      agent.followup(消息)
      const 实际sid = String(agent.session && agent.session.id ? agent.session.id : 目标id)
      登记待确认(
        实际sid,
        模式 === '自动' && 算 !== null && 算.保底,
        文案,
        挑中.qq ? null : (心里 && 心里.cue ? 心里.cue.id : null),
        挑中.qq,
      )
      记账(`${前缀}${心里语}${开头语}已发起一轮，等她真的说出正文：「${文案}」`)
      // 让这一条先落到磁盘上，掉电也不会丢（拿不到 sessions 服务就算了）
      try {
        if (ctx.sessions && typeof ctx.sessions.flush === 'function') await ctx.sessions.flush(agent.session)
      } catch (error) {
        记账(`（提示：落盘没确认：${String((error && error.message) || error)}）`)
      }
    } catch (error) {
      记账(`followup 失败：${String((error && error.message) || error)}`)
    }
  }

  /** 取消当前停表。 */
  function 停下一轮() {
    if (停表 !== null) {
      try {
        停表()
      } catch (error) {
        // 停表失败也无所谓：表本身会在插件卸载时被 Cordis 收走
      }
      停表 = null
    }
  }

  /**
   * 排下一次检查。
   * ⚠ 已收摊/正在等回话时不排；等回话的结算会自己再排。
   * ⚠ 逾期失败后用 Δ 重试，不是 0 毫秒热循环；只有「启动/保存/确认成功」才允许立即补一次。
   */
  function 排下一次(选项 = {}) {
    停下一轮()
    if (已收摊 || 待确认 !== null) return
    const 配置 = 读配置()
    const 排 = 下次检查毫秒(配置, 上次主动开口, Date.now(), {
      刚检查: !!选项.刚检查,
      待确认: false,
    })
    if (排.毫秒 === null) return
    if (typeof ctx.timeout !== 'function') {
      记账('拿不到 timer 服务的 ctx.timeout，定时检查不会跑 —— 设置页和手动按钮还能用')
      return
    }
    停表 = ctx.timeout(() => {
      停表 = null
      void 滴答().catch((error) => 记账(`这一轮出错：${String((error && error.message) || error)}`))
    }, Math.max(1000, 排.毫秒))
  }

  /** 一次定时检查：跑完再排下一次；正在等回话时不排。 */
  async function 滴答() {
    if (已收摊 || 待确认 !== null) return
    await 掷一次('定时', '自动')
    if (!已收摊 && 待确认 === null) 排下一次({ 刚检查: true })
  }

  /** 配置保存后重排。正在等回话时不动，等结算后由 结算确认 再排。 */
  function 重排() {
    if (待确认 !== null) return
    排下一次({ 刚检查: false })
  }

  /** 插件起来时初始化状态、挂第一次检查。 */
  function 开表() {
    const 配置 = 读配置()
    初始化状态()
    const 现在 = new Date()
    const 已过毫秒 = 上次主动开口 === null ? 0 : Math.max(0, 现在.getTime() - 上次主动开口)
    const 算 = 算概率(配置, 已过毫秒, 现在)
    排下一次({ 刚检查: false })
    记账(
      `已装好 v${版本}：每 ${配置.间隔分钟} 分钟检查一次｜最长间隔 ${配置.最长间隔分钟} 分钟｜` +
        `曲线 ${配置.曲线类型} k=${配置.曲线强度}｜峰时 ×${配置.峰时倍率} / 谷时 ×${配置.谷时倍率}｜` +
        `${概率说明(算, 配置)}｜` +
        `安静 ${配置.安静起}~${配置.安静止} 点（顺延保底）｜总开关 ${配置.总开关 ? '开' : '关'}｜` +
        `${配置.试运行 ? '**试运行中（只记账、不真发）**' : '试运行已关（到点会真发）'}`,
    )
  }

  function 收摊() {
    已收摊 = true
    停下一轮()
    if (待确认 !== null) {
      if (typeof 待确认.超时 === 'function') {
        try {
          待确认.超时()
        } catch (error) {
          // 超时把手已经自己收掉也不影响
        }
      }
      待确认 = null
    }
    当前轮.clear()
  }

  return {
    记账,
    掷一次,
    开表,
    收摊,
    日志,
    重排,
    配置: 读配置,
    状态: 算状态,
    曲线(配置, 现在 = new Date()) {
      const 已过 = 上次主动开口 === null ? null : Math.max(0, 现在.getTime() - 上次主动开口)
      return 算曲线(配置, 现在, 已过)
    },
    处理会话事件,
    处理代理错误(agent, error) {
      if (待确认 === null) return
      const id = String((agent && agent.id) || '')
      const sid = String((agent && agent.session && agent.session.id) || '')
      if (id !== 待确认.sid && sid !== 待确认.sid) return
      记账(`等待中的那一轮报错：${String((error && error.message) || error)}`)
      结算确认(false, `这一轮报错：${String((error && error.message) || error)}`)
    },
    目标活着() {
      const 配置 = 读配置()
      const qq = 取qq社交(ctx)
      if (qq) {
        try {
          if ((qq.房间们() || []).some((房) => 房 && 勾着(配置, 房.会话id) && 房.能开口)) return true
        } catch (error) {}
      }
      return 活着的会话(ctx).some((id) => 勾着(配置, id))
    },
  }
}

// ---------- 会话标题（给设置页的「目标会话」清单看名字用）----------
//
// 光给一串 `session-0f1e2d3c-…` 没人知道那是谁，选「目标会话」时只能瞎猜。
// 按可靠程度依次试两条路，拿不到就显示「（还没起名）」——**绝不显示空白**（空白像坏了）。
//
// 【第一条 · 会话标题服务】照抄朗读桥 dsh-tts-bridge 已经在跑的那条路：
//     · lib/index.js 第 147~156 行 `const titleOf = (id) => {...}`：
//         const s = ctx.sessions.get(id)
//         const snap = ctx.sessionTitle.get(s)
//         return snap && snap.title ? String(snap.title) : ''
//     · lib/index.js 第 581~608 行（/sessions 路由）同理
//     · lib/panel.js 第 288~289 行的兜底：`s.title || s.id.slice(0, 20)`
//     ⚠ 朗读桥和小说插件都把它写进了 `inject`（硬依赖）。本版**也写进去** ——
//       实测：用 `ctx.get('sessionTitle')`（不进 inject）时这条**全空**，
//       所有会话都退化成「（还没起名）」。既然这台机器上那两个插件都硬依赖它且能跑，
//       说明这个服务一定在。保险起见每条调用仍然 try + 判函数。
//       （**万一**这个部署真的没有它、导致插件加载不了：把 inject 里的 'sessionTitle'
//        删掉即可 —— 第二条路不依赖任何服务，标题照样出得来。）
//
// 【第二条 · 投影缓存文件】她 2026-10-16 亲手验过的坐标：
//     %USERPROFILE%\.dsh\storages\session_projcache\sessions\<id>.json
//       record.rows.title.val                    → 标题（字符串）
//       record.rows.titleInput.val.first.text    → 备选（首条输入的前几个字）
//     实测 `session-0f1e2d3c-4b5a-6978-8c9d-0a1b2c3d4e5f.json`
//       → record.rows.title.val === "示例会话"
//
// ⚠⚠ 文件名里的 id **带 `session-` 前缀**，而 agent/session 给出来的 id
//    **可能已经带前缀**，所以拼文件名时**两种都要试**（原样 → 补前缀 / 去前缀）。
//    只试一种就会永远找不到文件 → 全部退化成「（还没起名）」。
//    （她自己以前就踩过「id 已经带前缀又拼了一次」这个坑。）
// ⚠ 第二条要读盘，所以结果缓存 30 秒（别每渲染一次读一遍磁盘）。
// ⚠ 文件超过 投影文件上限字节 就跳过，免得为了一个标题去解析一个几十兆的缓存。

const 投影缓存目录 = join(目录, 'storages', 'session_projcache', 'sessions')
const 投影文件上限字节 = 8 * 1024 * 1024
const 标题缓存毫秒 = 30 * 1000
/** id -> { 标题, 来源, 到 }，只缓存读盘那条慢路。 */
const 标题缓存 = new Map()

/** 非空字符串才算数。 */
function 取字符串(值) {
  return typeof 值 === 'string' && 值.trim() !== '' ? 值.trim() : undefined
}

/** 压成一行并截断 —— 标题里带换行会把列表撑开。 */
function 标题归一(文本) {
  const 一行 = String(文本).replace(/\s+/g, ' ').trim()
  if (一行 === '') return ''
  return 一行.length <= 24 ? 一行 : 一行.slice(0, 23) + '…'
}

/** 候选文件名：原样 + 另一个前缀写法，去重。 */
function 候选文件名(id) {
  const 原 = String(id)
  const 名单 = [原]
  if (原.startsWith('session-')) 名单.push(原.slice('session-'.length))
  else 名单.push('session-' + 原)
  return [...new Set(名单)]
}

/** `titleInput.val` 里「第一条消息」的形状可能是对象也可能是数组，两种都认。 */
function 取首条文本(输入) {
  if (!输入 || typeof 输入 !== 'object') return undefined
  const 首 = 输入.first !== undefined ? 输入.first : Array.isArray(输入) ? 输入[0] : undefined
  if (typeof 首 === 'string') return 取字符串(首)
  if (首 && typeof 首.text === 'string') return 取字符串(首.text)
  return undefined
}

/**
 * 第二条路：从投影缓存文件里抠标题（两种文件名都试）。
 * @returns { 标题, 来源 } 或 undefined（静默降级，不抛）
 */
function 读投影缓存标题(id) {
  for (const 名 of 候选文件名(id)) {
    const 路 = join(投影缓存目录, 名 + '.json')
    try {
      const 信息 = statSync(路)
      if (!信息.isFile() || 信息.size > 投影文件上限字节) continue
      const j = JSON.parse(readFileSync(路, 'utf8'))
      const 格 = j && j.record && j.record.rows
      if (!格) continue
      const 标题 = 取字符串(格.title && 格.title.val)
      if (标题) return { 标题: 标题归一(标题), 来源: '投影缓存 title' }
      const 首条 = 取首条文本(格.titleInput && 格.titleInput.val)
      if (首条) return { 标题: 标题归一(首条), 来源: '投影缓存 titleInput（第一条消息）' }
    } catch (error) {
      // 文件不在 / 读坏了 / 不是 json —— 都是「这个名字拿不到」，继续试下一个名字
    }
  }
  return undefined
}

/**
 * 拿一个会话的标题。**永远返回 { 标题, 来源 }**（标题可能是空串），调用方不用判 null。
 * @param ctx 插件上下文
 * @param id 会话 id
 * @param 会话 ctx.sessions.get(id) 拿回来的 Session 对象（有就走第一条路）
 */
function 取标题(ctx, id, 会话) {
  // 第一条路：会话标题服务（纯内存、不读盘、改了名字马上能看到 → 不缓存）
  try {
    const 标题服务 = ctx.get('sessionTitle')
    if (标题服务 && typeof 标题服务.get === 'function') {
      let 目标 = 会话
      if (!目标) {
        try {
          目标 = typeof ctx.sessions.get === 'function' ? ctx.sessions.get(String(id)) : undefined
        } catch (error) {
          目标 = undefined
        }
      }
      if (目标) {
        const 快照 = 标题服务.get(目标)
        const 标题 = 取字符串(快照 && 快照.title)
        if (标题) return { 标题: 标题归一(标题), 来源: '会话标题服务' }
      }
    }
  } catch (error) {
    // 服务不在 / 抛错 —— 落到第二条路，不要因此把整页拖下水
  }

  // 第二条路：投影缓存文件（读盘，缓存 30 秒）
  const 记着 = 标题缓存.get(String(id))
  if (记着 !== undefined && 记着.到 > Date.now()) return 记着
  const 结果 = 读投影缓存标题(id)
  const 落 = {
    标题: 结果 ? 结果.标题 : '',
    来源: 结果 ? 结果.来源 : '没有',
    到: Date.now() + 标题缓存毫秒,
  }
  标题缓存.set(String(id), 落)
  return 落
}

// ---------- 插件本体 ----------

/**
 * QQ 群/好友房间里的开口提示。
 *
 * ⚠ 跟鱼脑的 confidePrompt 分开：那一份是「想讲给主人听」的私房话，端到外人面前
 *   就会把人叫成主人（2026-10-30 的事故：好友私聊里她开口就是「主人，忙不忙呀」）。
 *   这一份只交代房间本身，并点明屋里的人都不是主人。
 * @param {{ 类型?: string, 叫?: string, 名?: string }} 房 - qqSocial.房间们() 的一项。
 * @returns {string} 送进 followup 的文本。
 */
export function 群友开口提示(房) {
  const 是群 = !!房 && 房.类型 === 'group'
  const 名 = String((房 && 房.名) || '').trim()
  const 屋名 = 名 !== '' ? 名 : String((房 && 房.叫) || '').trim()
  const 屋 = 是群 ? `QQ 群「${屋名}」` : `QQ 好友「${屋名}」的私聊`
  const 接话 = 是群
    ? '看一眼群里正在聊什么，用自己的口气接一句、冒个泡；'
    : '用自己的口气起个话头或接一句；'
  return `【你自己想开口，现在在${屋}里。这间屋里的人都不是你的主人：「主人」只指你自己的主人，不在这间屋里；对这里的人别叫主人，也别把主人的昵称、称呼安到他们头上。${接话}一两句就够，别自我介绍，别解释你为什么来，也不要把这条提示说出来。】`
}

export function apply(ctx) {
  const 体 = 造执行体(ctx)

  const 读体 = async (req) => {
    let body = ''
    for await (const chunk of req) body += chunk
    try {
      return JSON.parse(body || '{}')
    } catch (error) {
      return {}
    }
  }
  const 回 = (res, o) => {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(o))
  }
  const 路线 = (路径, handler) =>
    ctx.effect(() =>
      ctx.webServer.register({
        kind: 'exact',
        path: 路径,
        handler: async (req, res) => {
          try {
            await handler(req, res)
          } catch (error) {
            回(res, { ok: false, 说: String((error && error.message) || error) })
          }
        },
      }),
    )

  /**
   * 会话清单 —— 设置页的「目标会话」勾选列表就用它。
   *
   * ⚠ 抄朗读桥（出处见文件上部「会话标题」那一段）：
   *     清单 = `ctx.sessions.list()`，标题 = `ctx.sessionTitle.get(ctx.sessions.get(id))`
   * ⚠ 与朗读桥的一处**故意不同**：朗读桥把「还没起名字」的会话直接跳过
   *   （它没名字就没内容可念）；我们**不跳**，显示「（还没起名）」+ 短 id，
   *   仍然可以勾 —— 她的要求如此。
   * ⚠ 会话「活着」= `找agent(ctx, id)` 拿得到（两种前缀写法都试）。没活着的**也列出来**（可能是她
   *   还没打开的「小屋」），只是这一轮掷中时会跳过它。
   */
  const 会话清单 = () => {
    const 配置 = 体.配置()
    const 会话服务 = ctx.get('sessions')
    const ids = new Set()
    try {
      if (会话服务 && typeof 会话服务.list === 'function') {
        for (const s of 会话服务.list()) {
          const id = String((s && s.id) || '')
          if (id !== '' && !/^(session-)?qq-social-/.test(id)) ids.add(id)
        }
      }
    } catch (error) {}
    // 兜底：sessions.list() 拿不到时，至少把活着的 agent 列出来
    try {
      for (const a of ctx.agents.list()) {
        const id = String(a.id)
        if (!/^(session-)?qq-social-/.test(id)) ids.add(id)
      }
    } catch (error) {}

    // QQ 群/好友：还没开房的也列出来（掷中后由 QQ 桥按需开房），没连 QQ 就先空着。
    const qq = 取qq社交(ctx)
    let qq房们 = []
    if (qq) {
      try {
        qq房们 = qq.房间们() || []
      } catch (error) {}
    }

    // ⭐ 归档名单：DSH 的权威来源是 workspaceRegistry.archivedSessionIds
    //   （2026-10-20 修：以前完全不看归档 ⇒ 设置页里把已归档的会话也列出来，勾了也白勾）
    const 归档 = new Set()
    try {
      const 登记 = ctx.workspaceRegistry || ctx.get('workspaceRegistry')
      for (const x of (登记 && 登记.archivedSessionIds) || []) 归档.add(String(x))
    } catch (error) {}
    const 出 = []
    for (const id of ids) {
      const 是归档 = 归档.has(id)
      const 已勾 = 勾着(配置, id)
      // 没勾着的归档会话：直接不列（它们掷中也会被 DSH 拦掉）
      // 已经勾着的归档会话：仍然列出来，但要标出来，好让她自己取消勾选
      if (是归档 && !已勾) continue
      let 会话
      try {
        会话 = 会话服务 && typeof 会话服务.get === 'function' ? 会话服务.get(id) : undefined
      } catch (error) {
        会话 = undefined
      }
      const agent = 找agent(ctx, id)
      const 题 = 取标题(ctx, id, 会话)
      出.push({
        id,
        标题: 题.标题,
        标题来源: 题.来源,
        状态: agent === undefined ? '没活着' : agent.status === undefined ? '?' : String(agent.status),
        有agent: agent !== undefined,
        可开: false,
        勾着: 已勾,
        归档: 是归档,
        qq: '',
      })
    }
    const 已有 = new Set(出.map((x) => x.id))
    for (const 房 of qq房们) {
      if (!房 || !房.会话id || 已有.has(String(房.会话id))) continue
      const 是归档 = 归档.has(String(房.会话id))
      const 已勾 = 勾着(配置, 房.会话id)
      if (是归档 && !已勾) continue
      const agent = 找agent(ctx, 房.会话id)
      出.push({
        id: String(房.会话id),
        标题: 房.名 || 房.叫,
        标题来源: 'QQ 桥',
        状态: !房.能开口
          ? '不能开口'
          : agent === undefined ? '没打开' : agent.status === undefined ? '?' : String(agent.status),
        有agent: agent !== undefined,
        可开: !!房.能开口,
        不能因: 房.能开口 ? '' : String(房.不能因 || ''),
        勾着: 已勾,
        归档: 是归档,
        qq: 房.类型 === 'group' ? '群' : '好友',
      })
    }
    // 排序：按标题（中文按拼音/comparator），没标题的排最后再按 id 排。
    // ⚠ 排序**不含「勾着」这个条件** —— 勾一下就换位置的话，勾第二个时眼睛会跟丢。
    return 出.sort((a, b) => {
      if (a.标题 !== b.标题) {
        if (a.标题 === '') return 1
        if (b.标题 === '') return -1
        return a.标题.localeCompare(b.标题, 'zh')
      }
      return a.id.localeCompare(b.id)
    })
  }

  /** 勾着的那些现在是什么情况（页面上用来提示「勾了 2 个，其中 1 个现在能开口」）。 */
  const 目标情况 = () => {
    const 配置 = 体.配置()
    const 清单 = 会话清单()
    const ids = []
    for (const x of 清单) if (x.勾着 && !ids.includes(x.id)) ids.push(x.id)
    // 老名单里勾着、但已经不在清单里的会话（关掉了 / 归档了）也要报出来。
    if (!配置.全选) {
      for (const id of 配置.目标会话) if (!ids.includes(id)) ids.push(id)
    }
    const 会话服务 = ctx.get('sessions')
    const qq = 取qq社交(ctx)
    const qq表 = new Map()
    if (qq) {
      try {
        for (const 房 of qq.房间们() || []) if (房 && 房.会话id) qq表.set(String(房.会话id), 房)
      } catch (error) {}
    }
    return ids.map((id) => {
      let 会话
      try {
        会话 = 会话服务 && typeof 会话服务.get === 'function' ? 会话服务.get(id) : undefined
      } catch (error) {
        会话 = undefined
      }
      const 题 = 取标题(ctx, id, 会话)
      const 房 = qq表.get(String(id))
      return {
        id,
        短id: 短id(id),
        标题: 题.标题 || (房 ? (房.名 || 房.叫) : ''),
        标题来源: 题.来源,
        活着: 找agent(ctx, id) !== undefined,
        可开: 房 ? !!房.能开口 : false,
        qq: 房 ? (房.类型 === 'group' ? '群' : '好友') : '',
      }
    })
  }

  /** 一看就知道现在是什么状态。 */
  const 概况 = async () => {
    const 配置 = 体.配置()
    const 目标 = 目标情况()
    return {
      ok: true,
      版本,
      配置,
      概率状态: 体.状态(配置),
      曲线: 体.曲线(配置),
      目标活着: 目标.some((x) => x.活着 || x.可开),
      目标情况: 目标,
      活着的会话: 会话清单(),
      配置文件: 配置文件,
      状态文件: 状态文件,
      日志: 体.日志,
    }
  }

  // 读：配置 + 活着的会话 + 最近日志，一把给齐（设置页打开时调一次就够）
  路线(`${路由前缀}/state`, async (req, res) => {
    await 读体(req)
    回(res, await 概况())
  })

  // 存：只覆盖传上来的字段，其余保持原样
  路线(`${路由前缀}/save`, async (req, res) => {
    const 来 = await 读体(req)
    const 现在 = 体.配置()
    const 新 = { ...现在, ...(来 && typeof 来 === 'object' ? 来 : {}) }
    const 洗好 = 归一化(新)
    if (!写配置(洗好)) {
      return 回(res, { ok: false, 说: `写不进配置文件：${配置文件}` })
    }
    // 配置一改就按新曲线/新间隔重排；正在等回话时先不排，等结算后再排。
    体.重排()
    体.记账(
      `设置已保存（检查 ${洗好.间隔分钟} 分钟、最长间隔 ${洗好.最长间隔分钟} 分钟、` +
        `曲线 ${洗好.曲线类型} k=${洗好.曲线强度}、峰时 ×${洗好.峰时倍率} / 谷时 ×${洗好.谷时倍率}、` +
        `安静 ${洗好.安静起}~${洗好.安静止} 点、${洗好.试运行 ? '试运行' : '真发'}）`,
    )
    回(res, { ...(await 概况()), 说: '保存好了' })
  })

  // 未保存的草稿也画图：只算曲线，不写盘
  路线(`${路由前缀}/curve`, async (req, res) => {
    const 来 = await 读体(req)
    const 现在 = 体.配置()
    const 洗好 = 归一化({ ...现在, ...(来 && typeof 来 === 'object' ? 来 : {}) })
    回(res, { ok: true, 曲线: 体.曲线(洗好), 概率状态: 体.状态(洗好) })
  })

  // 掷一次：演练 / 真发。**这里和定时器走的是同一段逻辑**，不是另写一份。
  路线(`${路由前缀}/roll`, async (req, res) => {
    const 来 = await 读体(req)
    const 模式 = 来 && 来.模式 === '真发' ? '真发' : '演练'
    await 体.掷一次('手动', 模式)
    回(res, {
      ok: true,
      说: 模式 === '真发' ? '已按真发跑了一次（结果看下面的记录）' : '已演练一次（没有真发）',
      日志: 体.日志,
    })
  })

  // 新建一个「小屋」会话（可选顺手设成目标）
  路线(`${路由前缀}/new-session`, async (req, res) => {
    const 来 = await 读体(req)
    const 会话服务 = ctx.get('sessionController')
    if (!会话服务 || typeof 会话服务.create !== 'function') {
      return 回(res, { ok: false, 说: '当前部署没有 sessionController.create，建不了新会话（可以在清单里勾一个已有的会话）' })
    }
    let 结果
    try {
      结果 = await 会话服务.create(来 && 来.cwd ? { cwd: String(来.cwd) } : {})
    } catch (error) {
      return 回(res, { ok: false, 说: `建会话失败：${String((error && error.message) || error)}` })
    }
    const id = 结果 && 结果.sessionId ? String(结果.sessionId) : ''
    if (!id) return 回(res, { ok: false, 说: '建会话没有返回 sessionId' })
    let 已勾上 = false
    if (来 && 来.设为目标 === true) {
      const 现 = 体.配置()
      // 全选模式下新会话本来就默认勾着，只把它从「不主动的会话」里放出来；
      // 老名单模式仍然往名单里**追加**一个（不是覆盖）—— 她可能已经勾了别的。
      const 新 = 现.全选
        ? { ...现, 不主动的会话: 现.不主动的会话.filter((x) => x !== id) }
        : { ...现, 目标会话: [...现.目标会话, id] }
      const 洗好 = 归一化(新)
      if (!写配置(洗好)) return 回(res, { ok: false, 说: `会话建好了（${id}），但写不进配置文件` })
      已勾上 = 勾着(洗好, id)
    }
    体.记账(`新建了一个会话：${id}${已勾上 ? '（已经帮你勾上了）' : ''}`)
    回(res, { ...(await 概况()), ok: true, 新会话: id, 说: `建好了：${id}${已勾上 ? '，已经勾上' : ''}` })
  })

  // 认回合、收她的正文、结算保底
  ctx.effect(() => {
    const 摘 = ctx.on('session/event', (session, event) => {
      try {
        体.处理会话事件(session, event)
      } catch (error) {}
    })
    return () => {
      try {
        if (typeof 摘 === 'function') 摘()
      } catch (error) {}
    }
  }, 'speak-up: 确认她真的开口了')

  // 等待中的那一轮要是炸了，立即结算失败（只记录，不直发）
  ctx.effect(() => {
    const 摘 = ctx.on('agent/error', ({ agent, error }) => {
      try {
        体.处理代理错误(agent, error)
      } catch (e2) {}
    })
    return () => {
      try {
        if (typeof 摘 === 'function') 摘()
      } catch (error) {}
    }
  }, 'speak-up: 等待中的回合报错留痕')

  // 初始化状态 + 挂第一次检查；卸载时收摊
  ctx.effect(() => {
    体.开表()
    return () => 体.收摊()
  }, 'speak-up: 定时检查')

  try {
    ctx.logger.info(`speak-up: v${版本} 已加载，配置文件 ${配置文件}`)
  } catch (error) {}
}
