// DSH「主动搭话」· 宿主半边
//
// 干一件事：**没人在跟她说话的时候，她自己也有可能先开口。**
//
//   定时器到点 → 本地掷一次骰子（纯 Math.random，**一个 token 都不花**）
//     ├─ 没掷中 → 什么都不做，只在日志里记一笔
//     └─ 掷中   → 往「目标会话」里送一条消息 → agent.followup(message)
//                 → DSH 自己开一轮（人格、历史、工具、记忆全都自带）
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
//    配置一律走自己的 json 文件 + 自己的设置页（跟 dsh-write / dsh-fish-memory 一样）。
//    想改成原生「插件配置」页的话，README 里写了要动什么。

import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
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
 * 触发消息的来源标记。写进会话日志里，将来能一眼看出「这条不是她打的」。
 * ⚠ 不能叫 'user'，否则会被网页端当成真人排队消息来处理。
 */
const 源标记 = 'speak-up'

/** 记账（内存里最近多少条）。 */
const 日志上限 = 60

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
  试运行: true, // **默认开着**：掷中了也只记账、不真发（先看几轮再关掉它）
  目标会话: [], // 勾了哪些会话（**数组**，可以勾多个）；掷中一次只在其中一个里开口
  间隔分钟: 30, // 多久掷一次骰子
  // ---- 峰谷分时：贵的时候少开口，便宜的时候多开口 ----
  // ⚠⚠ 峰谷**时段是固定的，不给她填**（周一到周五 9:00~12:00、14:00~18:00 是峰时，
  //    其余全是谷时）。她要填的只有下面这两个数。
  // ⚠ 这两个数**不是"概率"**（她纠正过：叫概率就不对了）—— 它们是**基础命中线**：
  //    每轮掷一个 0~100 的数，**掷到命中线以下才开口**，掷在上面就不开。
  //    最终命中线 = 这一格 × 时机因子 + 攒下来的没中加成（最后夹 0~100）。
  //    判断在 判峰时() 里写死，见那个函数的注释。
  峰时命中线: 20, // 峰时（贵）→ 命中线低一点、少开口
  谷时命中线: 60, // 谷时（便宜）→ 命中线高一点、多开口
  // ⚠ 老配置里那个单独的「概率」**不再读了**（被上面两格替换）。她的旧值会被丢掉，这是预期的。
  // ⚠ 更早一版这两格叫「峰时概率 / 谷时概率」，归一化里还认旧键名（改名兼容）。
  // ---- 没掷中就攒加成，掷中就归零（她原话：「上次没投中，下一次就要加概率；下次如果投中了，
  //      概率又回到一开始」）----
  //   最终命中线 = min(100, 档位命中线 × 时机因子 + min(加成上限, 连没中 × 没中加成))
  //   ⚠ 是**先乘因子、再加攒下来的加成**，最后夹 0~100%（顺序别写反）
  //   ⚠ 没中加成 = 0 就等于关掉这个功能（一分不加）
  没中加成: 10, // 每没掷中一次，下一次命中线加这么多（百分点）
  加成上限: 40, // 加成最多加到这么多（百分点）
  安静起: 1, // 安静时段（小时，含起不含止）；起 === 止 表示不启用
  安静止: 8,
  近阈值分钟: 20, // 距她上次说话 < 这么多分钟 → 命中线乘「近因子」
  近因子: 0.15,
  远阈值分钟: 360, // 距她上次说话 > 这么多分钟 → 命中线乘「远因子」
  远因子: 1.5,
  // ⚠ 这一格是**她自己开口之后的冷却**（跟上面那两个时机因子阈值是两回事：
  //   那是"她多久没说话"，这是"我们自己多久前开过口"）。
  //   以前这里偷偷借用了「近阈值分钟」，设置页里看不到这一格 —— 现在单独拎出来了。
  搭话冷却分钟: 20, // 0 = 不冷却
  触发文案: '好久没人跟我说话了，我该主动去打个招呼',
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
 * 取一个"改过名"的数字配置：**原始文件里有新键就用新键，否则退回旧键**，都没有才用兜底。
 * ⚠ 必须看**原始对象**（不能看合并过默认值的那个）—— 否则新键永远"存在"（默认值把它填上了），
 *   旧键就永远读不到（这个坑我在测试里真的踩了一次）。
 * ⚠ 这两格最早叫「峰时概率 / 谷时概率」，她纠正说那不是概率、是命中线，所以键名跟着改了。
 *   老配置文件里如果还是旧键名，这里读得出来（不丢设置）。
 */
function 数改过名(原始, 新键, 旧键, 兜, 小, 大) {
  const 有 = (键) => 原始 && typeof 原始 === 'object' && 原始[键] !== undefined
  const 值 = 有(新键) ? 原始[新键] : 有(旧键) ? 原始[旧键] : 兜
  return 数(值, 兜, 小, 大)
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
  return {
    总开关: 布(混.总开关, 默认配置.总开关),
    试运行: 布(混.试运行, 默认配置.试运行),
    目标会话: 会话id列表(混.目标会话),
    间隔分钟: Math.round(数(混.间隔分钟, 默认配置.间隔分钟, 1, 1440)),
    峰时命中线: 数改过名(原始, '峰时命中线', '峰时概率', 默认配置.峰时命中线, 0, 100),
    谷时命中线: 数改过名(原始, '谷时命中线', '谷时概率', 默认配置.谷时命中线, 0, 100),
    没中加成: 数(混.没中加成, 默认配置.没中加成, 0, 100),
    加成上限: 数(混.加成上限, 默认配置.加成上限, 0, 100),
    安静起: Math.round(数(混.安静起, 默认配置.安静起, 0, 23)),
    安静止: Math.round(数(混.安静止, 默认配置.安静止, 0, 23)),
    近阈值分钟: 数(混.近阈值分钟, 默认配置.近阈值分钟, 0, 100000),
    近因子: 数(混.近因子, 默认配置.近因子, 0, 100),
    远阈值分钟: 数(混.远阈值分钟, 默认配置.远阈值分钟, 0, 100000),
    远因子: 数(混.远因子, 默认配置.远因子, 0, 100),
    // ⚠ 这一格改过名：`数改过名` 第 3 个参数是**老键名**（老配置文件里那个键还要读得出来）
    搭话冷却分钟: Math.round(数改过名(原始, '搭话冷却分钟', '自己开口冷却分钟', 默认配置.搭话冷却分钟, 0, 1440)),
    触发文案:
      typeof 混.触发文案 === 'string' && 混.触发文案.trim() !== '' ? 混.触发文案 : 默认配置.触发文案,
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

// ---------- 小工具 ----------

/** 本地时间，给人看的。ISO 那种 UTC 时间她会看糊涂。 */
function 现在显示() {
  const d = new Date()
  const 补 = (n) => String(n).padStart(2, '0')
  return `${补(d.getMonth() + 1)}-${补(d.getDate())} ${补(d.getHours())}:${补(d.getMinutes())}:${补(d.getSeconds())}`
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
//    要她填的只有两个数：`峰时命中线` / `谷时命中线`（见 默认配置）。
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
 *   一来测试能喂假时间（半夜跑测试不能红），二来算命中线那一步可以复用同一个时刻。
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
 * 按时刻挑基础命中线，并给一个能直接写进记账的短称呼。
 *
 * ⚠ 这是**纯函数**（除配置对象外不读别的东西、不看真实时间），所以测试能喂假时间验边界。
 * @param 配置 归一化后的配置
 * @param 某时刻 Date
 * @returns { 峰, 基础命中线, 短语 }（短语例如 `峰时命中线 20%`）
 */
export function 算基础命中线(配置, 某时刻 = new Date()) {
  const 峰 = 判峰时(某时刻)
  if (峰) {
    return { 峰: true, 基础命中线: 配置.峰时命中线, 短语: `峰时命中线 ${配置.峰时命中线}%` }
  }
  return { 峰: false, 基础命中线: 配置.谷时命中线, 短语: `谷时命中线 ${配置.谷时命中线}%` }
}

/**
 * 算这一次的**命中线**：`档位命中线 × 时机因子 + min(加成上限, 连没中 × 没中加成)`，夹 0~100。
 *
 * ⚠ 顺序是**先乘因子、再加攒下来的加成**（她特意要求的口径，别写反）。
 * ⚠ 加成是"攒"出来的：每没掷中一次 +「没中加成」，加到「加成上限」就停；
 *   掷中（含试运行掷中）会把「连没中」清零，也就是"回到一开始"。
 * ⚠ 这是**纯函数**（连没中从外面喂），所以测试能把 0/1/2/3… 各种情况都验一遍，
 *   不用去跟随机数较劲；导出只是为了 tests/宿主半边.mjs 能直接断言。
 * @param 基础命中线 峰时或谷时那一格（%）
 * @param 因子 时机因子
 * @param 连没中 连着几次没掷中
 * @param 没中加成 每没中一次加多少
 * @param 加成上限 最多加到多少
 * @returns { 加成, 线 }
 */
export function 算命中线(基础命中线, 因子, 连没中, 没中加成, 加成上限) {
  const 加成 = Math.min(加成上限, 连没中 * 没中加成)
  const 线 = Math.min(100, Math.max(0, 基础命中线 * 因子 + 加成))
  return { 加成, 线 }
}

/**
 * 「命中线」那句话（记账和启动行共用一份实现）。
 *
 * ⚠ 口径是她定的：**先说最终答案（命中线是多少），再说怎么来的** ——
 *   她之前把「峰时命中线 20%」误读成"在骰子点数上再加 20%"，所以这里必须写成
 *   `40.0 = 峰时命中线 20% × 时机因子 1（距上次说话 74.6 分钟） + 没中加成 20.0`
 *   这种一看就知道"这个数怎么算出来的"的等式。
 * @param 线 命中线（已经夹好的最终数）
 * @param 短语 `峰时命中线 20%` / `谷时命中线 60%`
 * @param 因子 时机因子
 * @param 距离 人能看懂的距离说明，例如 `距上次说话 74.6 分钟`
 * @param 加成 这次算进去的没中加成（0 就不写这一项）
 */
function 命中线等式(线, 短语, 因子, 距离, 加成) {
  const 加成段 = 加成 > 0 ? ` + 没中加成 ${加成.toFixed(1)}` : ''
  return `${线.toFixed(1)} = ${短语} × 时机因子 ${因子}（${距离}）${加成段}`
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
  /** 最近几次掷骰的记录（给设置页看，也顺便写进 ctx.logger）。 */
  const 日志 = []

  /** sid -> 她上次说话的时间（ms）。只看 user/message 且来源不是我们自己。 */
  const 她上次说话 = new Map()
  /** 已经翻过历史日志的 sid（翻一次就够了，别每轮都翻）。 */
  const 翻过历史 = new Set()
  /** 我们自己上次开口的时间（ms），用来做冷却，避免自己跟自己聊起来。 */
  let 自己上次开口 = 0

  /**
   * 连着几次没掷中（攒加成的计数器）。
   * ⚠ 只放在内存里：DSH 一重启就回到 0（设置页上写了这一点）。
   * ⚠ 只有**自动**那一轮会动它：没中 +1、中了（含试运行掷中）归零。
   *   手动按钮（演练/真发）不掷骰子，**不许碰它**。
   */
  let 连没中 = 0

  /** 当前表上的间隔（分钟）；配置改了要在下一次滴答后换表。 */
  let 表上的间隔 = null
  /** 停表的把手。 */
  let 停表 = null

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

  /**
   * 距她上次说话多少分钟。拿不到就是 undefined（那时因子按 1 算）。
   * 先看实时记下来的，没有再去翻这个会话已落盘的历史。
   */
  async function 距上次说话分钟(sid) {
    const 记着的 = 她上次说话.get(sid)
    if (记着的 !== undefined) return (Date.now() - 记着的) / 60000
    if (翻过历史.has(sid)) return undefined
    翻过历史.add(sid)
    try {
      const 会话服务 = ctx.get('sessionController')
      if (!会话服务 || typeof 会话服务.inspect !== 'function') return undefined
      const 报告 = await 会话服务.inspect(sid)
      const 事件们 = 报告 && Array.isArray(报告.events) ? 报告.events : []
      for (let i = 事件们.length - 1; i >= 0; i--) {
        const e = 事件们[i]
        if (!e || e.type !== 'user/message') continue
        const 来源 = e.data && e.data.source
        if (来源 && 来源.kind === 源标记) continue
        她上次说话.set(sid, e.time)
        return (Date.now() - e.time) / 60000
      }
    } catch (error) {
      try {
        ctx.logger.warn(`speak-up: 读会话历史失败（时机因子按 1 算）：${String((error && error.message) || error)}`)
      } catch (e2) {}
    }
    return undefined
  }

  /**
   * 算这次的**命中线**（骰子掷到它以下才开口），并把"这个数怎么来的"算成人话。
   *
   *   命中线 = min(100, 档位命中线(峰/谷) × 时机因子 + min(加成上限, 连没中 × 没中加成))
   *
   * ⚠ 顺序是**先乘因子、再加攒下来的加成**，最后夹 0~100%（顺序别写反）。
   * ⚠ **"现在"是从外面传进来的**（默认 `new Date()`）。这样测试能喂假时间验峰谷边界，
   *   半夜跑测试也不会红；而且判档和记账用的是**同一个时刻**，不会出现"说的是一档、算的是另一档"。
   * @param 配置 归一化后的配置
   * @param sid 会话 id（用来查「距她上次说话」）
   * @param 现在 Date（默认现在）
   * @returns { 分钟, 因子, 峰, 短语, 基础命中线, 加成, 线 }（线 = 最终命中线）
   */
  async function 算这次命中线(配置, sid, 现在 = new Date()) {
    const 分钟 = await 距上次说话分钟(sid)
    let 因子 = 1
    if (分钟 !== undefined) {
      if (分钟 < 配置.近阈值分钟) 因子 = 配置.近因子
      else if (分钟 > 配置.远阈值分钟) 因子 = 配置.远因子
    }

    // 峰时还是谷时 → 挑哪一格命中线（时段写死，见 判峰时()）
    const 基础 = 算基础命中线(配置, 现在)

    // 攒下来的没中加成（先乘因子，再加这个）
    const { 加成, 线 } = 算命中线(基础.基础命中线, 因子, 连没中, 配置.没中加成, 配置.加成上限)
    return { 分钟, 因子, 峰: 基础.峰, 短语: 基础.短语, 基础命中线: 基础.基础命中线, 加成, 线 }
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
      const 小时 = 现在.getHours()
      if (在安静时段(小时, 配置.安静起, 配置.安静止)) {
        return 记账(`现在 ${小时} 点在安静时段（${配置.安静起}~${配置.安静止}）里，这轮不掷`)
      }
    }

    if (配置.目标会话.length === 0) return 记账('还没勾「目标会话」，什么都不做（去设置里勾一个）')

    // 勾了好几个时：**这次只在其中一个里开口**（随机挑一个活着又不忙的）。
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
    for (const id of 配置.目标会话) {
      if (归档名单.has(String(id))) {
        不可用.push(`${短id(id)}(已归档)`)
        continue
      }
      const a = 找agent(ctx, id)
      if (a === undefined) {
        不可用.push(`${短id(id)}(没活着)`)
        continue
      }
      const 状态 = a.status
      if (状态 !== undefined && 状态 !== 'idle') {
        不可用.push(`${短id(id)}(忙)`)
        continue
      }
      可用.push({ id, agent: a })
    }
    if (可用.length === 0) {
      return 记账(
        `勾的目标会话现在都不能说话（${不可用.join('、') || '（空）'}）—— 按设计**不自动唤醒**，这轮什么都不做`,
      )
    }
    const 挑中 = 可用[Math.floor(Math.random() * 可用.length)]
    const 目标id = 挑中.id
    const agent = 挑中.agent
    const 挑的说法 = 可用.length > 1 ? `（勾了 ${可用.length} 个可用，这次挑 ${短id(目标id)}）` : ''

    // 「主动搭话」之后的冷却（单独一格配置；跟"她多久没说话"那两个阈值是两回事）。
    // ⚠ 0 = 不冷却：刚开口过也照投。
    if (模式 === '自动' && 配置.搭话冷却分钟 > 0 && 自己上次开口 !== 0) {
      const 冷却 = (Date.now() - 自己上次开口) / 60000
      if (冷却 < 配置.搭话冷却分钟) {
        return 记账(`自己刚开过口（${冷却.toFixed(1)} 分钟前，冷却 ${配置.搭话冷却分钟} 分钟），这轮不重复`)
      }
    }

    // ⚠ 下面这段只给**自动**那一轮用（手动按钮不掷骰子，也不许动「连没中」计数器）。
    //   口径是她定的：**先说最终答案（命中线），再说怎么来的**，最后说副作用（清零 / 下次变多少）。
    let 前缀 = ''
    if (模式 === '自动') {
      // ⚠ 一次掷骰**只取一次"现在"**，然后一路传下去：安静时段、峰谷判档、记账都用它，
      //   免得刚好在边界上（比如 12:00:00）时，判档和记账说的不是同一档。
      const 现在 = new Date()
      const 算 = await 算这次命中线(配置, 目标id, 现在)
      const 线 = 算.线
      const 线文 = 线.toFixed(1)
      const 距离 = 算.分钟 === undefined ? '距上次说话时间不明' : `距上次说话 ${算.分钟.toFixed(1)} 分钟`
      const 等式 = 命中线等式(线, 算.短语, 算.因子, 距离, 算.加成)
      const 掷值 = Math.random() * 100

      if (掷值 >= 线) {
        // —— 没掷中：攒一次加成 ——
        连没中 += 1
        // 「下次」是同一条公式、喂进新的 连没中（跟算这一轮用的是同一个函数，免得两处写法漂移）
        const 下次线 = 算命中线(算.基础命中线, 算.因子, 连没中, 配置.没中加成, 配置.加成上限).线.toFixed(1)
        const 下次语 =
          配置.没中加成 === 0
            ? `下次命中线还是 ${下次线}（没中加成关着）`
            : `下次命中线变 ${下次线}（没中加成 +${配置.没中加成}）`
        return 记账(
          `没掷中 ✗ 掷出 ${掷值.toFixed(1)}（命中线 ${线文} —— 要掷到 ${线文} 以下才开口）｜${等式}｜${下次语}`,
        )
      }

      // —— 掷中（含试运行掷中）：清零，回到一开始 ——
      const 之前连没中 = 连没中
      连没中 = 0
      const 清零语 =
        之前连没中 > 0
          ? `没中加成清零（之前连着 ${之前连没中} 次没中）`
          : '没中加成本来就是 0（还没攒过）'
      前缀 = `掷中 ✓ 掷出 ${掷值.toFixed(1)}（命中线 ${线文} —— 掷到 ${线文} 以下就开口）｜${等式}｜${清零语}｜${挑的说法}`
    } else {
      // 手动按钮：不掷骰子、不动「连没中」计数器（她只让自动那一轮动它）
      前缀 = `【${来源}/${模式}】手动触发（不掷骰子、不动没中加成）｜${挑的说法}`
    }

    if (配置.角色 === 'developer') {
      // 不是「没实现」，是**当前 DSH 版本上做不到**（见文件头注释的三条证据）。
      // 在这里主动拦下来，是为了不去污染她的会话日志（真发出去会让那一轮 turn 直接 error）。
      return 记账(`${前缀}角色填的是 developer，但当前 DSH 送不了 developer 角色（详见 README「做不到的地方」），这轮**主动不发**`)
    }

    if (演练) {
      return 记账(`${前缀}演练：本来要往「${目标id}」送一句「${配置.触发文案}」`)
    }

    const 文案 = 配置.触发文案
    try {
      const 工厂 = await 拿造消息工厂()
      const 消息 = 工厂
        ? 工厂.createUserMessage({ content: [{ type: 'text', text: 文案 }], source: { kind: 源标记 } })
        : 手搓用户消息(文案)
      agent.followup(消息)
      自己上次开口 = Date.now()
      记账(`${前缀}已送出一句，DSH 会照常开一轮：「${文案}」`)
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

  /** 换表：先把旧表停掉，再按新的间隔上一块。间隔为 null 表示不上表。 */
  function 换表(间隔分钟) {
    if (停表 !== null) {
      try {
        停表()
      } catch (error) {
        // 停表失败也无所谓：表本身会在插件卸载时被 Cordis 收走
      }
      停表 = null
    }
    if (间隔分钟 === null) return
    if (typeof ctx.interval !== 'function') {
      记账('拿不到 timer 服务（ctx.interval 不在），定时掷骰不会跑 —— 但设置页和手动手动按钮还能用')
      return
    }
    表上的间隔 = 间隔分钟
    停表 = ctx.interval(() => {
      void 掷一次('定时', '自动')
        .catch((error) => 记账(`这一轮出错：${String((error && error.message) || error)}`))
        .finally(() => {
          // 设置里改了间隔 → 下一轮按新间隔走（这样从设置页改完不用重启插件）
          const 现在间隔 = 读配置().间隔分钟
          if (现在间隔 !== 表上的间隔) 换表(现在间隔)
        })
    }, 间隔分钟 * 60 * 1000)
  }

  /** 插件起来时挂表。 */
  function 开表() {
    const 配置 = 读配置()
    const 现在 = new Date()
    const 基础 = 算基础命中线(配置, 现在)
    换表(配置.间隔分钟)
    记账(
      `已装好 v${版本}：每 ${配置.间隔分钟} 分钟掷一次骰子｜` +
        // ⚠ 口径跟记账一致：**先说「命中线是多少」，再说怎么来的**（刚起来还没算过距上次说话 → 因子按 1）
        `现在命中线 ${命中线等式(基础.基础命中线, 基础.短语, 1, '刚起来，还没算过距上次说话', 0)}｜` +
        `没中加成 +${配置.没中加成}/次，最多 +${配置.加成上限}｜搭话冷却 ${配置.搭话冷却分钟} 分钟｜` +
        `安静时段 ${配置.安静起}~${配置.安静止} 点｜总开关 ${配置.总开关 ? '开' : '关'}｜` +
        `${配置.试运行 ? '**试运行中（只记账、不真发）**' : '试运行已关（掷中会真发）'}`,
    )
  }

  function 收摊() {
    换表(null)
  }

  return {
    记账,
    掷一次,
    开表,
    收摊,
    日志,
    换表,
    /** 现在挂在表上的间隔（分钟）；没挂表就是 null。设置页改完间隔要拿它比一下。 */
    当前间隔: () => 表上的间隔,
    配置: 读配置,
    记她说话(session, event) {
      if (!event || event.type !== 'user/message') return
      const 来源 = event.data && event.data.source
      if (来源 && 来源.kind === 源标记) return
      她上次说话.set(String(session.id), event.time)
    },
    目标活着() {
      const 配置 = 读配置()
      if (配置.目标会话.length === 0) return false
      return 配置.目标会话.some((id) => 找agent(ctx, id) !== undefined)
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
    const 会话服务 = ctx.get('sessions')
    const ids = new Set()
    try {
      if (会话服务 && typeof 会话服务.list === 'function') {
        for (const s of 会话服务.list()) {
          const id = String((s && s.id) || '')
          if (id !== '') ids.add(id)
        }
      }
    } catch (error) {}
    // 兜底：sessions.list() 拿不到时，至少把活着的 agent 列出来
    try {
      for (const a of ctx.agents.list()) ids.add(String(a.id))
    } catch (error) {}

    const 勾着 = new Set(体.配置().目标会话)
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
      const 已勾 = 勾着.has(id)
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
        勾着: 已勾,
        归档: 是归档,
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

  /** 勾着的那些现在是什么情况（页面上用来提示「勾了 2 个，其中 1 个现在活着」）。 */
  const 目标情况 = () => {
    const 会话服务 = ctx.get('sessions')
    return 体.配置().目标会话.map((id) => {
      let 会话
      try {
        会话 = 会话服务 && typeof 会话服务.get === 'function' ? 会话服务.get(id) : undefined
      } catch (error) {
        会话 = undefined
      }
      const 题 = 取标题(ctx, id, 会话)
      return {
        id,
        短id: 短id(id),
        标题: 题.标题,
        标题来源: 题.来源,
        活着: 找agent(ctx, id) !== undefined,
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
      目标活着: 目标.some((x) => x.活着),
      目标情况: 目标,
      活着的会话: 会话清单(),
      配置文件: 配置文件,
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
    // ⚠ 间隔一改就要**立刻换表**：定时器还是按上一次的间隔挂着的，
    //   不重新挂的话，把 15 分钟改成 1 分钟也得先干等满那 15 分钟才有第一次滴答
    //   （踩过：她改成 1 分钟，几分钟过去一条记录都没有，看着就像坏了）。
    {
      const 旧间隔 = 体.当前间隔()
      if (洗好.间隔分钟 !== 旧间隔) {
        体.换表(洗好.间隔分钟)
        体.记账(
          `间隔从 ${旧间隔 === null ? '（没挂表）' : 旧间隔 + ' 分钟'} 改成 ${洗好.间隔分钟} 分钟，表已经重新挂好`,
        )
      }
    }
    体.记账(
      `设置已保存（间隔 ${洗好.间隔分钟} 分钟、峰时命中线 ${洗好.峰时命中线}% / 谷时命中线 ${洗好.谷时命中线}%、` +
        `没中加成 +${洗好.没中加成}/次 最多 +${洗好.加成上限}、搭话冷却 ${洗好.搭话冷却分钟} 分钟、` +
        `安静 ${洗好.安静起}~${洗好.安静止} 点、${洗好.试运行 ? '试运行' : '真发'}）`,
    )
    回(res, { ...(await 概况()), 说: '保存好了' })
  })

  // 掷一次：演练 / 真发。**这里和定时器走的是同一段逻辑**，不是另写一份。
  路线(`${路由前缀}/roll`, async (req, res) => {
    const 来 = await 读体(req)
    const 模式 = 来 && 来.模式 === '真发' ? '真发' : '演练'
    await 体.掷一次('手动', 模式)
    回(res, { ok: true, 说: 模式 === '真发' ? '已按真发跑了一次（结果看下面的记录）' : '已演练一次（没有真发）', 日志: 体.日志 })
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
      // 往「勾着的会话」里**追加**一个（不是覆盖）—— 她可能已经勾了别的
      const 洗好 = 归一化({ ...体.配置(), 目标会话: [...体.配置().目标会话, id] })
      if (!写配置(洗好)) return 回(res, { ok: false, 说: `会话建好了（${id}），但写不进配置文件` })
      已勾上 = true
    }
    体.记账(`新建了一个会话：${id}${已勾上 ? '（已经帮你勾上了）' : ''}`)
    回(res, { ...(await 概况()), ok: true, 新会话: id, 说: `建好了：${id}${已勾上 ? '，已经勾上' : ''}` })
  })

  // 记下「她上次说话」，给时机因子用
  ctx.effect(() => {
    const 摘 = ctx.on('session/event', (session, event) => {
      try {
        体.记她说话(session, event)
      } catch (error) {}
    })
    return () => {
      try {
        if (typeof 摘 === 'function') 摘()
      } catch (error) {}
    }
  }, 'speak-up: 记下她上次说话的时间')

  // 目标会话那一轮要是炸了，至少在日志里留一句（角色填 developer 时就会走到这儿）
  ctx.effect(() => {
    const 摘 = ctx.on('agent/error', ({ agent, error }) => {
      try {
        if (!agent || String(agent.id) !== 体.配置().目标会话) return
        体.记账(`目标会话这一轮报错了：${String((error && error.message) || error)}`)
      } catch (e2) {}
    })
    return () => {
      try {
        if (typeof 摘 === 'function') 摘()
      } catch (error) {}
    }
  }, 'speak-up: 目标会话报错留痕')

  // 挂表 + 卸载时收摊
  ctx.effect(() => {
    体.开表()
    return () => 体.收摊()
  }, 'speak-up: 定时掷骰')

  try {
    ctx.logger.info(`speak-up: v${版本} 已加载，配置文件 ${配置文件}`)
  } catch (error) {}
}
