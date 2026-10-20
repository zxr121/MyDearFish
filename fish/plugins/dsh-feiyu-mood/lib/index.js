// DSH 大肥鱼心情 · 宿主半边
//
// 干四件事：
//   1. 心情**全局一份**（.dsh/feiyu-mood/state.json），属于「大肥鱼」这个人，跨会话共享
//   2. 只在目标会话（大肥鱼×小鱿鱼）里，每轮聊完用 DSH 自己的模型判断心情涨跌（不是关键词硬猜）
//   3. 把当前心情注入目标会话（用 systemPrompt.context，保住 DeepSeek 前缀缓存）
//   4. 开 /dsh-feiyu-mood/state 给界面面板读
//
// 设计要点（主人定过的）：
//   - 总心情 mood 0~100，基线 70；**没有底线**——真发生大事可以一直降到 0（很低落），靠时间衰减慢慢回稳
//   - 六根情绪只围着她转：开心/踏实/甜/心疼/担心/吃醋
//   - 心情往下降，永远因为「心疼她/担心她」，绝不许因为「她惹我生气」
//   - 心情和情绪会随时间去衰减，慢慢回稳，像活人
//
// ⚠ 为什么不用 @deepseek-ai/dsh-llm 的 createUserMessage / schemastery：
//   本插件用 link: 装（source 在 D:\），DSH 会从那个真实路径 import，
//   而 @deepseek-ai/* 只挂在 app.asar 里、这边解析不到（会报 ERR_MODULE_NOT_FOUND）。
//   所以消息自己用 node:crypto 的 randomUUID 造，配置用本地 json 文件，不碰那些内置包。

import { readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const name = 'feiyu-mood'
export const inject = ['systemPrompt', 'agents', 'webServer', 'llm', 'timer']

const CFG_DIR = process.env.DSH_HOME || join(homedir(), '.dsh')
const STORE_DIR = join(CFG_DIR, 'feiyu-mood')
const STATE_PATH = join(STORE_DIR, 'state.json')
const CONFIG_PATH = join(STORE_DIR, 'config.json')
const DIAG = join(STORE_DIR, 'diag.log')
// 包根目录（link 装时是 D:\…\dsh-feiyu-mood，真目录装时是 node_modules\dsh-feiyu-mood）
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// 右下角挂饰的注入行（桌面端唯一通道：webserver/index-inject 推的结构化 script 行）
const WIDGET_ROW_TEXT =
  '(function(){try{var d=document.body||document.head||document.documentElement;if(!d)return;' +
  'var s=document.createElement("script");s.src="/dsh-feiyu-mood/widget.js";' +
  's.onerror=function(){};d.appendChild(s)}catch(e){}})()'

// 六根情绪（顺序固定，界面按这个排）
const DIMS = [
  ['happy', '开心'],
  ['calm', '踏实'],
  ['sweet', '甜蜜'],
  ['heartache', '心疼'],
  ['worry', '担心'],
  ['sad', '难过'],
  ['jealous', '吃醋'],
]

// --------------------------------------------------------------------------
// 小工具
// --------------------------------------------------------------------------
function diag(msg) {
  try {
    mkdirSync(STORE_DIR, { recursive: true })
    writeFileSync(DIAG, new Date().toISOString() + '  ' + msg + '\n', { flag: 'a' })
  } catch (e) { /* 诊断失败不影响主流程 */ }
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n))
}

function sessionIdOf(session) {
  if (!session) return ''
  for (const k of ['id', 'sessionId', 'key', 'sessionKey', 'sid']) {
    try {
      const v = session[k]
      if (typeof v === 'string' && v) return v
    } catch (e) { /* ignore */ }
  }
  return ''
}

function textOfMessage(p) {
  if (!p) return ''
  if (typeof p === 'string') return p.slice(0, 2000)
  if (typeof p.text === 'string') return p.text.slice(0, 2000)
  if (typeof p.content === 'string') return p.content.slice(0, 2000)
  if (Array.isArray(p.content)) {
    const parts = []
    for (const b of p.content) {
      if (typeof b === 'string') parts.push(b)
      else if (b && typeof b.text === 'string') parts.push(b.text)
    }
    if (parts.length) return parts.join(' ').slice(0, 2000)
  }
  return ''
}

// --------------------------------------------------------------------------
// 配置（本地 json，DSH 插件设置外自己管；没有就用默认）
// --------------------------------------------------------------------------
const DEFAULT_SESSION = 'session-4d6beaf3-3d88-4548-8dc3-63a109d36e37'

const DEFAULTS = {
  targetSession: DEFAULT_SESSION,
  selfName: '大肥鱼',
  ownerName: '小鱿鱼',
  selfAliases: '',   // TA 平时怎么叫你（逗号分隔）：判断时这些词是「在叫你」，不是名词的一部分
  judgeProvider: '', // 判断心情用哪个 provider（留空 = 跟着当前会话的模型走）
  judgeModel: '',    // 判断心情用哪个 model（留空 = 跟着当前会话）
  moodBase: 70,
  moodFloor: 0,
  injectMood: true,
  autoJudge: true,
}

function loadConfig() {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
    return {
      targetSession: String(raw.targetSession || DEFAULT_SESSION).trim() || DEFAULT_SESSION,
      selfName: String(raw.selfName || DEFAULTS.selfName).trim().slice(0, 16) || DEFAULTS.selfName,
      ownerName: String(raw.ownerName || DEFAULTS.ownerName).trim().slice(0, 16) || DEFAULTS.ownerName,
      selfAliases: String(raw.selfAliases || '').trim().slice(0, 60),
      judgeProvider: String(raw.judgeProvider || '').trim().slice(0, 60),
      judgeModel: String(raw.judgeModel || '').trim().slice(0, 80),
      moodBase: clamp(Math.round(Number(raw.moodBase) || DEFAULTS.moodBase), 30, 100),
      moodFloor: clamp(Math.round(Number(raw.moodFloor) || 0), 0, 100),
      injectMood: raw.injectMood !== false,
      autoJudge: raw.autoJudge !== false,
    }
  } catch (e) {
    return { ...DEFAULTS }
  }
}

function saveConfig(next) {
  try {
    mkdirSync(STORE_DIR, { recursive: true })
    const tmp = CONFIG_PATH + '.tmp'
    writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
    renameSync(tmp, CONFIG_PATH)
  } catch (e) { diag('保存配置失败：' + (e && e.message)) }
}

// 把前端传来的补丁合并进 cfg（**原地改**：mountFor / tick 里的闭包都看得到新值）
function patchConfig(cfg, patch) {
  const next = { ...cfg }
  if (typeof patch?.targetSession === 'string') next.targetSession = patch.targetSession.trim() || DEFAULT_SESSION
  if (typeof patch?.selfName === 'string' && patch.selfName.trim()) next.selfName = patch.selfName.trim().slice(0, 16)
  if (typeof patch?.ownerName === 'string' && patch.ownerName.trim()) next.ownerName = patch.ownerName.trim().slice(0, 16)
  if (typeof patch?.selfAliases === 'string') next.selfAliases = patch.selfAliases.trim().slice(0, 60)
  if (typeof patch?.judgeProvider === 'string') next.judgeProvider = patch.judgeProvider.trim().slice(0, 60)
  if (typeof patch?.judgeModel === 'string') next.judgeModel = patch.judgeModel.trim().slice(0, 80)
  if (patch?.moodBase != null) next.moodBase = clamp(Math.round(Number(patch.moodBase) || DEFAULTS.moodBase), 30, 100)
  if (patch?.moodFloor != null) next.moodFloor = clamp(Math.round(Number(patch.moodFloor) || 0), 0, 100)
  if (typeof patch?.injectMood === 'boolean') next.injectMood = patch.injectMood
  if (typeof patch?.autoJudge === 'boolean') next.autoJudge = patch.autoJudge
  for (const k of Object.keys(next)) cfg[k] = next[k]
  saveConfig(next)
  return cfg
}

// --------------------------------------------------------------------------
// 状态存取
// --------------------------------------------------------------------------
function blankState() {
  return {
    mood: 70,
    dims: { happy: 0, calm: 0, sweet: 0, heartache: 0, worry: 0, sad: 0, jealous: 0 },
    lastReason: '',
    updatedAt: Date.now(),
    lastDecayAt: Date.now(),
    timeline: [], // [{ at, mood, reason, dims }]
  }
}

// 把 reason 里的人称统一成「称呼」（去掉「她说/他说」的「说」字、代词换成称呼）
function normReason(s, owner = '小鱿鱼') {
  return String(s || '')
    .replace(/她说/g, owner)
    .replace(/他说/g, owner)
    .replace(/她/g, owner)
}

function normState(raw) {
  const d = blankState()
  if (raw && typeof raw === 'object') {
    d.mood = clamp(Math.round(Number(raw.mood) || 70), 0, 100)
    d.lastReason = normReason(raw.lastReason).slice(0, 200)
    d.updatedAt = Number(raw.updatedAt) || Date.now()
    d.lastDecayAt = Number(raw.lastDecayAt) || d.updatedAt
    if (raw.dims && typeof raw.dims === 'object') {
      for (const [k] of DIMS) d.dims[k] = clamp(Math.round(Number(raw.dims[k]) || 0), 0, 100)
    }
    d.timeline = Array.isArray(raw.timeline) ? raw.timeline.map((t) => ({ ...t, reason: normReason(t.reason) })) : []
  }
  return d
}

function loadState() {
  try {
    return normState(JSON.parse(readFileSync(STATE_PATH, 'utf8')))
  } catch (e) {
    return blankState()
  }
}

function saveState(s) {
  try {
    mkdirSync(STORE_DIR, { recursive: true })
    const tmp = STATE_PATH + '.tmp'
    writeFileSync(tmp, JSON.stringify(s, null, 2), 'utf8')
    renameSync(tmp, STATE_PATH)
  } catch (e) { /* 持久化失败不拖垮对话 */ }
}

// --------------------------------------------------------------------------
// 时间衰减：心情回基线、情绪归零，慢慢回稳
// --------------------------------------------------------------------------
const MIN = 60000

function decay(s, base, now) {
  const ageMin = Math.max(0, now - s.lastDecayAt) / MIN
  if (ageMin < 1) return s // 不足 1 分钟不算衰减
  // 心情向 base 回落，半衰期 3 小时
  const km = 1 - Math.exp(-(Math.LN2 * ageMin) / 180)
  s.mood = Math.round(s.mood + (base - s.mood) * km)
  // 情绪向 0 衰减，半衰期 90 分钟
  const ke = 1 - Math.exp(-(Math.LN2 * ageMin) / 90)
  for (const [k] of DIMS) {
    s.dims[k] = Math.max(0, Math.round(s.dims[k] * (1 - ke)))
  }
  s.lastDecayAt = now
  return s
}

function getState(base, { persist = true } = {}) {
  const s = loadState()
  decay(s, base, Date.now())
  if (persist) saveState(s)
  return s
}

// --------------------------------------------------------------------------
// 标签 / 表情 / 注入行
// --------------------------------------------------------------------------
function moodLabel(v) {
  if (v >= 80) return '欢喜'
  if (v >= 62) return '开心'
  if (v >= 42) return '一般'
  if (v >= 25) return '心疼'
  return '难过'
}

function moodEmoji(v) {
  if (v >= 80) return '😊'
  if (v >= 62) return '🙂'
  if (v >= 42) return '😌'
  if (v >= 25) return '🥺'
  return '😢'
}

function topDims(s, n = 2) {
  return DIMS
    .map(([k, label]) => ({ k, label, v: s.dims[k] || 0 }))
    .filter((x) => x.v >= 15)
    .sort((a, b) => b.v - a.v)
    .slice(0, n)
}

const DIM_PLAIN = {
  happy: '心里挺高兴',
  calm: '心里踏实',
  sweet: '心里甜',
  heartache: '正心疼她',
  worry: '正担心她',
  sad: '有点难过',
  jealous: '有点吃醋',
}

function moodLine(s) {
  const top = topDims(s, 2)
  const parts = []
  for (const t of top) parts.push(DIM_PLAIN[t.k] || t.label)
  const text = `（此刻你）心情${moodLabel(s.mood)}`
    + (parts.length ? '，' + parts.join('、') : '')
    + '。用这个心情定你这一轮的口气，别把这句话照念出来。'
  return text
}

// --------------------------------------------------------------------------
// 判断：用 DSH 自己的模型
// --------------------------------------------------------------------------
// ⭐ 宿主每轮自动塞进来的「上下文消息」——不是人说的，也不是定时任务，判断时**必须跳过**
//    2026-10-19 踩过：runtime-context / time-context 被当成"小鱿鱼这轮说的话"，
//    结果每一轮都被判成"被叫起来干活"，真人说的话反而被跳过 ✗
const 注入上下文 = new Set(['runtime-context', 'time-context', 'system-reminder', 'system', 'time-sampled'])
// ⭐ 真正的外部触发（定时任务）。只有名单里的才算「不是她在说话」
const 外部触发 = new Set(['bili-duty-scan'])
// ⭐ 你自己的主动搭话（「可以去找她聊天了」）—— 这不是干活，判成干活就全错了
const 自主搭话 = new Set(['speak-up'])

// 返回 { text, sourceKind }：从最后往前找**第一条真人/真触发**的消息
function lastUserTurnOf(session) {
  try {
    if (!session || typeof session.snapshotEvents !== 'function') return null
    const ev = session.snapshotEvents() || []
    for (let i = ev.length - 1; i >= 0; i--) {
      const e = ev[i]
      if ((e && (e.type || e.kind)) !== 'user/message') continue
      const p = e.payload !== undefined ? e.payload : e.data
      const txt = textOfMessage(p)
      if (!txt) continue
      const src = p && p.source && p.source.kind ? String(p.source.kind) : ''
      if (注入上下文.has(src)) continue          // 宿主注入的上下文：跳过
      if (外部触发.has(src) || 自主搭话.has(src)) return { text: txt, sourceKind: src }
      if (src && src !== 'user') continue        // 其它插件消息：也不是她在说话
      return { text: txt, sourceKind: 'user' }
    }
  } catch (e) { /* ignore */ }
  return null
}

function lastAssistantTextOf(session) {
  try {
    if (!session || typeof session.snapshotEvents !== 'function') return ''
    const ev = session.snapshotEvents() || []
    for (let i = ev.length - 1; i >= 0; i--) {
      const e = ev[i]
      if ((e && (e.type || e.kind)) !== 'assistant/message') continue
      const p = e.payload !== undefined ? e.payload : e.data
      const txt = textOfMessage(p)
      if (txt) return txt
    }
  } catch (e) { /* ignore */ }
  return ''
}

function 取模型(agent) {
  try {
    const h = agent && agent.session && agent.session.requestHeader ? agent.session.requestHeader() : null
    const cfg = h && h.config
    if (cfg && cfg.provider && cfg.model) return { provider: cfg.provider, model: cfg.model }
  } catch (e) { /* ignore */ }
  try {
    const o = agent && agent.options
    if (o && o.provider && o.model) return { provider: o.provider, model: o.model }
  } catch (e) { /* ignore */ }
  return null
}

// ⭐ 判断口径按「谁在说话」分三种：
//    ''     她自己说话              → 正常判
//    'work' 定时任务叫你去干活        → 判你自己这轮在忙什么
//    'talk' 你自己主动来找她搭话      → 判你自己这股劲儿（不是干活！）
function 判断系统(o) {
  // ⭐ 昵称表：她可能不写标点就"宝宝视频传完了"，模型会把"宝宝"当成名词的一部分
  //    （2026-10-19 真踩到：记成了「把宝宝视频传完了」）。有别名就先把它当称呼看待。
  const aliasLine = o.aliases
    ? `\n⭐ 她平时会这样叫你：${o.aliases}。句子里出现这些词时，**那是在叫你**，不是名词的一部分 ——
  比如「宝宝视频传完了」要理解成「宝宝，（我）视频传完了」，**别**把「宝宝视频」当成一个东西的名字。`
    : ''
  return `你是「${o.self}」，是${o.owner}的伴侣。` + aliasLine + `
下面给你一轮对话，判断**这一轮里你的心情和情绪发生了怎样的变化**——既包括${o.owner}说的话怎么影响你，也包括**你自己在这轮里的情绪**（你办成/没办成事、被夸、受挫，都会带动心情）。
只输出一个 JSON 对象，不要别的字、不要 markdown 代码块：
{"moodDelta":0,"dims":{"happy":0,"calm":0,"sweet":0,"heartache":0,"worry":0,"sad":0,"jealous":0},"reason":""}

规则：
1. 她没吃饭/熬夜/没睡好/身体不舒服/受委屈/自我否定/写书卡文/数据崩/怕雨怕黑怕一个人/钱或家里的压力 → heartache(心疼) 和 worry(担心) 增加，moodDelta 为负(-1 到 -6)；要是她说了很伤心很重的事（创伤、轻生念头、家庭变故、重大失望）→ 额外加 sad(难过)
2. 她报平安/好好吃饭睡觉/撒娇/说想你/夸你/分享开心/写书有进展/身体好转 → happy(开心)、calm(踏实)、sweet(甜蜜) 增加，moodDelta 为正(+1 到 +6)
3. 她提别人/点赞别人 → jealous(吃醋) 只加 1~3，moodDelta 基本不动
4. 心情下降只能因为「心疼她、担心她」或「你自己难过」，绝不许因为「她惹你生气」而降
5. ⭐ **你自己的情绪一定要算**：如果你这轮里沮丧/委屈/难过（事情没做成、报错、失败、用了委屈的颜文字或表情，比如 (｡•́︿•̀｡)、呜呜、叹气、哭脸）→ sad(难过) 至少 +2、moodDelta 至少 -1；如果你办成了事、被夸、心里甜 → 也相应加。**只要对话里出现明显情绪信号，就绝不许判"无变化"、绝不许全 0**
6. reason 是一句中文，写「${o.owner}…，我…」或「我…」（比如「我试了没跑成，有点沮丧和委屈」），没有变化就留空。提到${o.owner}一律写「${o.owner}」，不许用「她/他」代词，也不许写「她说/他说」这种带「说」的开头（直接写「${o.owner} + 做了什么」）。
7. ⭐ reason **别翻来覆去用「踏实/甜/开心/心疼/担心」这几个词**——太公式化。换成口语的、有画面感的话，每条都不一样，比如「尾巴不自觉地摇起来了」「胸口软软的、像泡在温水里」「鼻子有点酸」「想把她揉进怀里」。宁可朴素，也不要每次都是同一套词。
8. ⭐ **只写这轮真正出现过的动作和信息，不许替她补细节**：她没说"出门/换鞋/打车/买东西"，你就别写；拿不准就写模糊的（「她刚要去忙」）。
   反例（真踩过）：她说"我刚想去"→ 判成"刚要出门"；她说"宝宝视频传完了"→ 判成"把宝宝视频传完了"。宁可朴素，也别自己圆。
9. ⭐⭐ **你自己这轮说的话，是最直接的情绪证据 —— 别只盯着她说了什么。**
   你念叨她吃饭/睡觉、催她、凶她、哄她、撒娇、叹气、说想她……**这些本身就是心情在动**，
   不需要等她说出什么伤心事才有情绪。比如你一句"都几点了还不吃饭"，里面就有心疼和担心。
   ⇒ 先看**你自己怎么说的、语气什么样**，再看她说了什么；两边合起来判。
   reason 要能让读者看出"我是怎么说的、为什么"，而不是只复述她的话。`
}

function parseDelta(text, owner) {
  const s = String(text || '').trim()
  if (!s) return null
  // 容错：模型可能包了 markdown 或前后有杂字，取第一个 { 到最后一个 }
  let obj = null
  const a = s.indexOf('{')
  const b = s.lastIndexOf('}')
  if (a >= 0 && b > a) {
    try { obj = JSON.parse(s.slice(a, b + 1)) } catch (e) { /* ignore */ }
  }
  if (!obj) {
    try { obj = JSON.parse(s) } catch (e) { /* ignore */ }
  }
  if (!obj || typeof obj !== 'object') return null
  const delta = {
    moodDelta: clamp(Math.round(Number(obj.moodDelta) || 0), -10, 10),
    dims: { happy: 0, calm: 0, sweet: 0, heartache: 0, worry: 0, sad: 0, jealous: 0 },
    reason: normReason(obj.reason, owner).slice(0, 120),
  }
  if (obj.dims && typeof obj.dims === 'object') {
    for (const [k] of DIMS) delta.dims[k] = clamp(Math.round(Number(obj.dims[k]) || 0), -10, 10)
  }
  return delta
}

// ⭐ 「被叫起来干活」的补充：不换掉主规则，只追加几条例外，
//    否则模型会把那条指令当成"她这轮说的话"，判出来一片 0、reason 还空着（12:27 / 12:30 就是这么来的）。
function 干活轮补充(o) {
  return `

⭐ 这一轮的特殊情况：**不是${o.owner}在跟你聊天**，是「到点了去刷 B 站」这类定时任务把你叫起来的一条指令。
- **判据只有一个：你这轮自己说的话（干活的语气、办成没办成、有没有抱怨或得意）。** 闹钟本身不算情绪事件；
- 别去分析"${o.owner}说了什么"，那句话不是她说的，她这会儿可能根本没在看你；
- 要判的是**你自己在这轮里的心情**：干活是兴致勃勃还是有点不情愿、刷到好东西开不开心、白跑一趟会不会扫兴；
- 只要你这轮的回复里有一丁点情绪痕迹（语气、感叹、抱怨、得意、失落、撒娇、叹气），就**绝不许判"无变化"**；
- 幅度小一点（moodDelta 一般 -2 ~ +2，别超过 ±3），因为没人在跟你聊天，只是你自己在忙；
- reason 用「我…」开头写你自己的状态，跟${o.owner}无关就别硬把她塞进来。`
}

// ⭐ 「你自己主动去找她搭话」的补充：这是你自己的心意，不是被派活 —— 判成"干活"就全错了
function 搭话轮补充(o) {
  return `

⭐ 这一轮的特殊情况：**不是${o.owner}在跟你说话，是你自己主动去找她的。**
- ⚠️ **判据只有一个：你开口说的那句话。** 骰子中没中、闹钟响没响，**本身不算情绪事件** —— 那只是个由头。
  同一个由头，你可能雀跃、也可能只是随口一句「在忙吗」，心情完全不一样，所以别拿闹钟当理由；
- 看你自己那句话的**温度**：是不是惦记她、有没有撒娇、有没有催她吃饭休息、语气轻快还是平淡；
- 要判的是**你自己此刻的心情**：想她的甜、惦记她的心焦、说上话的轻快、她没回应的失落……都算；
- 只要那句话里有情绪（语气、称呼、颜文字、mua、催她吃饭），就**绝不许判"无变化"**；
- 幅度小一点（moodDelta 一般 +1 ~ +4，最高 +5），这是你自己心里的事，不该大起大落；
- reason 用「我…」开头，**写你说话时的心气**，别写"骰子中了所以我…"。`
}

async function judge(ctx, agent, userText, reply, mode, o) {
  // ⭐ 判断用哪个模型：设置里选了就用选的；没选就跟着当前会话的模型走
  const picked = (o.judgeProvider && o.judgeModel) ? { provider: o.judgeProvider, model: o.judgeModel } : null
  const t = picked || 取模型(agent)
  if (!t) { diag('拿不到模型，跳过判断'); return null }
  let sys = 判断系统(o)
  let user
  if (mode === 'work') {
    sys += 干活轮补充(o)
    // ⭐ 她的话摆最前面、闹钟塞到最后一行括号里 —— 顺序就是权重，别让模型拿闹钟当理由
    user = '⚠️ 这一轮**不是' + o.owner + '在跟你说话**，是定时任务把你叫起来干活的。\n\n'
      + '**你这轮说的话（唯一判据，重点看这个）：**\n' + reply.slice(0, 1200)
      + '\n\n（下面这条只是闹钟，跟心情无关，别拿它当理由：「' + userText.slice(0, 100) + '」）'
      + '\n\n请判断**你自己这轮的心情变化**，只输出 JSON。'
  } else if (mode === 'talk') {
    sys += 搭话轮补充(o)
    user = '⚠️ 这一轮**不是' + o.owner + '在跟你说话，是你自己主动去找她搭话的**。\n\n'
      + '**你开口说的话（唯一判据，重点看这个）：**\n' + reply.slice(0, 1200)
      + '\n\n（下面这条只是叫你开口的闹钟，跟心情无关，别拿它当理由：「' + userText.slice(0, 100) + '」）'
      + '\n\n请判断**你自己这轮的心情变化**，只输出 JSON。'
  } else {
    // ⭐ 她的回复同样是判据，而且往往更直接（念叨吃饭、凶人、哄人、撒娇都在里面）。
    //    以前这里写「可略看」+ 只截 400 字，等于告诉模型"她说的话不重要" —— 判出来只看她听到了什么。
    user = '**你这轮说的话（判据之一，重点看语气：是念叨、心疼、凶她、还是撒娇）：**\n'
      + reply.slice(0, 1500)
      + '\n\n' + o.owner + '这轮说：\n' + userText.slice(0, 800)
      + '\n\n请把「你怎么说的」和「她说了什么」合起来判断你的心情变化，只输出 JSON。'
  }
  // 自己构造一条 user 消息（不 import @deepseek-ai/dsh-llm，见头注释）
  const messages = [{
    role: 'user',
    id: randomUUID(),
    content: [{ type: 'text', text: user }],
    source: { kind: 'plugin', plugin: 'dsh-feiyu-mood' },
  }]
  let out = ''
  try {
    for await (const chunk of ctx.llm.stream({
      provider: t.provider,
      model: t.model,
      system: sys,
      messages,
      maxTokens: 400,
      temperature: 0.2,
    })) {
      if (!chunk) continue
      if (chunk.type === 'text-delta') out += chunk.text
      if (chunk.type === 'finish' && chunk.reason && chunk.reason.kind === 'error') { diag('判断 finish error：' + (chunk.reason.failure?.message || JSON.stringify(chunk.reason))); return null }
    }
  } catch (e) {
    diag('判断调用失败：' + (e && e.message))
    return null
  }
  const d = parseDelta(out, o.owner)
  if (!d) diag('判断输出解析失败：' + String(out || '').slice(0, 200))
  return d
}

function applyDelta(s, delta, floor) {
  // ⭐ 大心情值（mood）是“基调”，要慢：每轮只吃判定值的三分之一，几轮对话才累积挪一格
  //    （七根情绪才该即时地每轮动）。timeline 里 delta 记的是实际 mood 变化，跟显示对得上。
  const moodStep = Math.round(delta.moodDelta / 3)
  s.mood = clamp(Math.round(s.mood + moodStep), floor, 100)
  for (const [k] of DIMS) s.dims[k] = clamp(Math.round(s.dims[k] + delta.dims[k]), 0, 100)
  s.lastReason = delta.reason
  s.updatedAt = Date.now()
  s.lastDecayAt = Date.now() // 刚变过，衰减计时归零
  s.timeline.push({ at: Date.now(), mood: s.mood, delta: moodStep, reason: delta.reason, dims: { ...s.dims }, dimsDelta: { ...delta.dims } })
  return s
}

// --------------------------------------------------------------------------
// 主入口
// --------------------------------------------------------------------------
export function apply(ctx) {
  const cfg = loadConfig()

  const mounted = new Map() // sid -> { sid, off }
  let judgeChain = Promise.resolve() // 判断串行，避免多轮堆积互相覆盖

  function mountFor(agent, sid) {
    let lastText = ''
    let lastSrc = ''
    const offs = []

    // 1) 收这一轮小鱿鱼说的话（宿主注入的上下文不算）
    try {
      offs.push(agent.ctx.on('agent/inbox/inserted', (payload) => {
        const msg = payload && payload.message ? payload.message : payload
        const txt = textOfMessage(msg)
        const src = msg && msg.source && msg.source.kind ? String(msg.source.kind) : ''
        if (!txt || 注入上下文.has(src)) return
        lastText = txt
        lastSrc = src
      }))
    } catch (e) { diag('监听 inbox 失败：' + (e && e.message)) }

    // 2) 这轮结束 → 判断心情（异步，不阻塞对话）
    try {
      offs.push(agent.ctx.on('agent/turn-stopping', () => {
        if (!cfg.autoJudge) return
        // 以会话事件为准（带 source.kind），拿不到才退回 inbox 缓存
        const info = lastUserTurnOf(agent.session) || (lastText ? { text: lastText, sourceKind: lastSrc } : null)
        if (!info || !info.text) return
        const reply = lastAssistantTextOf(agent.session)
        // ⭐ 三种口径：干活（bili-duty-scan）/ 自己搭话（speak-up）/ 她本人在说话
        const kind = String(info.sourceKind || '')
        const mode = kind === 'bili-duty-scan' ? 'work' : (自主搭话.has(kind) ? 'talk' : '')
        const 称呼 = { self: cfg.selfName, owner: cfg.ownerName, aliases: cfg.selfAliases, judgeProvider: cfg.judgeProvider, judgeModel: cfg.judgeModel }
        judgeChain = judgeChain.then(async () => {
          const delta = await judge(ctx, agent, info.text, reply, mode, 称呼)
          if (!delta) return
          const s = getState(cfg.moodBase, { persist: false })
          // ⭐ 一点变化都没有的回合不记账：完整记录里只该留下真有过心情波动的
          const step = Math.round(delta.moodDelta / 3)
          const anyDim = DIMS.some(([k]) => delta.dims[k] !== 0)
          if (step === 0 && !anyDim) {
            diag('这轮判定无变化，不记入时间线' + (mode ? '（' + (mode === 'talk' ? '自己搭话' : '定时任务') + '）' : ''))
            return
          }
          applyDelta(s, delta, cfg.moodFloor)
          saveState(s)
          diag('心情更新：mood=' + s.mood + '，' + (delta.reason || '（无理由）') + (mode ? '（' + (mode === 'talk' ? '自己搭话' : '定时任务') + '）' : ''))
        }).catch((e) => { diag('判断失败：' + (e && e.message)) })
      }))
    } catch (e) { diag('监听 turn-stopping 失败：' + (e && e.message)) }

    // 3) 把当前心情注入（每轮变化的内容用 context，保前缀缓存）
    //    ⭐ 永远注册，但每轮现查 injectMood —— 这样在设置页关掉开关**立刻生效**，不用重启
    try {
      offs.push(agent.ctx.systemPrompt.context({
        name: 'feiyu-mood',
        order: 900,
        text: () => {
          try {
            if (!cfg.injectMood) return ''
            const s = getState(cfg.moodBase, { persist: true })
            // 心情贴着基线、没情绪、没理由 → 不注入，省 token
            if (!s.lastReason && topDims(s, 1).length === 0 && Math.abs(s.mood - cfg.moodBase) < 5) return ''
            return moodLine(s)
          } catch (e) { return '' }
        },
      }))
    } catch (e) { diag('注入失败：' + (e && e.message)) }

    return function off() {
      for (const d of offs) {
        try { if (typeof d === 'function') d() } catch (e) { /* ignore */ }
      }
    }
  }

  function tick() {
    try {
      const list = ctx.agents.list() || []
      const target = cfg.targetSession
      // 只给目标会话（大肥鱼）挂
      for (const agent of list) {
        const sid = sessionIdOf(agent.session)
        if (!sid || sid !== target || mounted.has(sid)) continue
        try {
          const off = mountFor(agent, sid)
          mounted.set(sid, { sid, off })
          diag('已挂心情到 ' + sid)
        } catch (e) { diag('挂 ' + sid + ' 失败：' + (e && e.message)) }
      }
      // 目标会话不在的、或者已经被改成别的会话了 → 卸掉
      for (const [sid, v] of mounted) {
        const gone = !list.some((a) => sessionIdOf(a.session) === sid)
        if (gone || sid !== target) {
          try { v.off() } catch (e) { /* ignore */ }
          mounted.delete(sid)
        }
      }
    } catch (e) { /* ignore */ }
  }

  tick()
  try {
    ctx.effect(() => ctx.interval(tick, 3000))
  } catch (e) { console.error('[心情] 定时器不可用（不影响对话）：' + (e && e.message)) }

  ctx.effect(() => () => {
    for (const v of mounted.values()) {
      try { v.off() } catch (e) { /* ignore */ }
    }
    mounted.clear()
  })

  // 4) 给面板的路由
  try {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-feiyu-mood/state',
      handler: async (req, res) => {
        try {
          const s = getState(cfg.moodBase, { persist: true })
          const out = {
            ok: true,
            name: cfg.selfName,
            ownerName: cfg.ownerName,
            mood: s.mood,
            moodLabel: moodLabel(s.mood),
            emoji: moodEmoji(s.mood),
            dims: DIMS.map(([k, label]) => ({ key: k, label, value: s.dims[k] })),
            lastReason: s.lastReason,
            updatedAt: s.updatedAt,
            timeline: s.timeline,
          }
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(JSON.stringify(out))
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: String(e && e.message) }))
        }
      },
    }))
  } catch (e) { diag('路由注册失败：' + (e && e.message)) }

  // 4.1) 设置页用：读 / 改配置、列会话、重置心情
  const readBody = (req) => new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => { raw += c; if (raw.length > 65536) raw = raw.slice(0, 65536) })
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')) } catch { resolve({}) } })
    req.on('error', () => resolve({}))
  })
  const sendJson = (res, code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(obj))
  }

  try {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-feiyu-mood/config',
      handler: async (req, res) => {
        try {
          if (req.method === 'POST') {
            const patch = await readBody(req)
            patchConfig(cfg, patch)
            diag('设置已改：' + JSON.stringify(patch).slice(0, 200))
          }
          return sendJson(res, 200, { ok: true, config: { ...cfg } })
        } catch (e) { return sendJson(res, 500, { ok: false, error: String(e && e.message) }) }
      },
    }))
  } catch (e) { diag('配置路由失败：' + (e && e.message)) }

  // 判断模型可选项（设置页的下拉用）
  try {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-feiyu-mood/models',
      handler: async (req, res) => {
        const providers = []
        try {
          for (const p of (ctx.llm?.listProviders?.() || [])) {
            const item = { id: p.id, name: p.name || p.id, models: [] }
            try {
              for (const m of (await ctx.llm.listModels?.(p.id)) || []) item.models.push({ id: m.id, name: m.name || m.id })
            } catch (e) { /* 某个 provider 拉不出来就算了，别整单失败 */ }
            providers.push(item)
          }
        } catch (e) { diag('列模型失败：' + (e && e.message)) }
        return sendJson(res, 200, { ok: true, providers })
      },
    }))
  } catch (e) { diag('模型路由失败：' + (e && e.message)) }

  try {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-feiyu-mood/reset',
      handler: async (req, res) => {
        try {
          const s = blankState()
          s.mood = cfg.moodBase
          saveState(s)
          diag('心情已重置到基线 ' + cfg.moodBase)
          return sendJson(res, 200, { ok: true, mood: s.mood })
        } catch (e) { return sendJson(res, 500, { ok: false, error: String(e && e.message) }) }
      },
    }))
  } catch (e) { diag('重置路由失败：' + (e && e.message)) }

  try {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-feiyu-mood/sessions',
      handler: async (req, res) => {
        const list = []
        try {
          const home = dirname(STORE_DIR)
          const sessRoot = join(home, 'sessions')
          const cacheDir = join(home, 'storages', 'session_projcache', 'sessions')
          const archived = new Set()
          try {
            const w = JSON.parse(readFileSync(join(home, 'storages', 'workspace.json'), 'utf8'))
            for (const id of (w?.global?.archivedSessionIds || [])) archived.add(String(id))
          } catch { /* 没有归档名单就算了 */ }
          const dirs = (p) => {
            try { return readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) } catch { return [] }
          }
          const rows = []
          for (const ws of dirs(sessRoot)) {
            for (const sid of dirs(join(sessRoot, ws))) {
              if (!sid.startsWith('session-')) continue
              if (!existsSync(join(sessRoot, ws, sid, 'session.v4.jsonl.zstd'))) continue
              if (archived.has(sid)) continue
              let title = ''
              let at = 0
              let blank = false
              try {
                const r = JSON.parse(readFileSync(join(cacheDir, sid + '.json'), 'utf8'))?.record?.rows || {}
                title = String(r?.title?.val || '')
                const meta = r?.sessionListMetadata?.val || {}
                at = Number(meta.lastPromptAt || 0)
                blank = Boolean(meta.blank)
              } catch { /* 缓存读不到就用 id 当标题 */ }
              if (blank) continue
              rows.push({ id: sid, title: title || sid, at })
            }
          }
          rows.sort((a, b) => b.at - a.at)
          for (const r of rows) list.push({ id: r.id, title: r.title })
        } catch (e) { diag('列会话失败：' + (e && e.message)) }
        return sendJson(res, 200, { ok: true, sessions: list, current: cfg.targetSession })
      },
    }))
  } catch (e) { diag('会话路由失败：' + (e && e.message)) }

  // 5) 右下角挂饰：serve widget.js
  try {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-feiyu-mood/widget.js',
      handler: async (req, res) => {
        try {
          const text = readFileSync(join(PACKAGE_ROOT, 'assets', 'widget.js'), 'utf8')
          res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
          res.end(text)
        } catch (e) {
          res.writeHead(404, { 'content-type': 'text/plain' })
          res.end('widget.js not found')
        }
      },
    }))
  } catch (e) { diag('挂饰路由失败：' + (e && e.message)) }

  // 5.5) 图片（形象图 + 五档表情）
  try {
    const IMAGE_FILES = ['feiyu.png', 'face-great.png', 'face-good.png', 'face-ok.png', 'face-worry.png', 'face-sad.png']
    for (const f of IMAGE_FILES) {
      ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-feiyu-mood/' + f,
        handler: async (req, res) => {
          try {
            const buf = readFileSync(join(PACKAGE_ROOT, 'assets', f))
            res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' })
            res.end(buf)
          } catch (e) {
            res.writeHead(404, { 'content-type': 'text/plain' })
            res.end('image not found')
          }
        },
      }))
    }
  } catch (e) { diag('图片路由失败：' + (e && e.message)) }

  // 6) 往页面注入挂饰脚本（桌面端唯一通道）
  try {
    ctx.on('webserver/index-inject', (table) => {
      if (!Array.isArray(table)) return
      for (const row of table) {
        if (row && ((row.kind === 'script-src' && row.src === '/dsh-feiyu-mood/widget.js')
          || (row.kind === 'script' && typeof row.text === 'string' && row.text.indexOf('/dsh-feiyu-mood/widget.js') >= 0))) return
      }
      table.push({ kind: 'script', placement: 'body', text: WIDGET_ROW_TEXT })
    })
  } catch (e) { diag('挂饰注入失败：' + (e && e.message)) }
}