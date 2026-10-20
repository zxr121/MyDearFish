// 网页半边冒烟测试 —— 用假的 React / 假的 slots 把设置页渲染成一棵普通对象树。
//
// ⚠ 它**不装插件、不开浏览器**。这里带了一个**能真的存值的 useState**，
//   所以「点一下 = 勾上/取消」这个交互是**真跑过**的（不是只看字符串在不在）。
//
// 验的是：
//   1) exports.inject 只依赖 slots；apply 挂到 settings.section；
//   2) 设置页 7 组 + 所有按钮都渲染得出来，渲染过程不抛错；
//   3) 会话清单每行是「复选框 + 标题 + 短 id + 状态」，点一下真的勾上、再点一下真的取消；
//   4) 标题拿不到时显示「（还没起名）」+ 短 id，并且**照样能勾**；
//   5) 没有会话 / 没有日志 / 旧数据形状时不崩。
// ⚠ 它验不了真实浏览器里的样子（样式、fetch 往返）。
//
// 跑法： node tests/网页半边.mjs

let 捕获 = null
globalThis.window = { __ModuleLoader__: { load: (o) => { 捕获 = o } } }

// ---- 假的 fetch：把每次请求记下来，这样「勾选是否真的自动保存」能被验到 ----
// ⚠ 自动保存回来后，页面会拿响应里的 日志/目标情况/活着的会话 刷新自己，所以
//   这里必须回一份**像真的**会话清单（用下面那个可变量，等 fixture 建好再填）。
let 请求 = []
let 服务端会话 = []
globalThis.fetch = async (url, 选项) => {
  let 体 = null
  try { 体 = 选项 && 选项.body ? JSON.parse(选项.body) : null } catch (e) { 体 = null }
  请求.push({ url: String(url), 方法: (选项 && 选项.method) || 'GET', 体 })
  const 目标 = 体 && Array.isArray(体.目标会话) ? 体.目标会话 : []
  return {
    json: async () => ({
      ok: true, 说: '保存好了', 版本: '0.1.0', 配置文件: 'C:/x/speak-up-config.json',
      配置: 体 || {},
      日志: [],
      目标情况: 目标.map((id) => ({
        id, 短id: String(id).slice(-8),
        标题: ((服务端会话.find((s) => s.id === id) || {}).标题) || '',
        活着: ((服务端会话.find((s) => s.id === id) || {}).有agent) === true,
      })),
      目标活着: 目标.some((id) => (服务端会话.find((s) => s.id === id) || {}).有agent === true),
      活着的会话: 服务端会话,
    }),
  }
}

// ---- 一点点「真」React：useState 真的存值、setter 真的改值 ----
let 状态槽 = []
let 下标 = 0
let 要重渲染 = false
const 造React = () => ({
  createElement: (t, p, ...kids) => ({
    t,
    p: p || {},
    kids: kids.flat(9).filter((k) => k !== null && k !== undefined && k !== false),
  }),
  useState: (init) => {
    const i = 下标++
    if (!(i in 状态槽)) 状态槽[i] = init
    return [
      状态槽[i],
      (v) => {
        状态槽[i] = typeof v === 'function' ? v(状态槽[i]) : v
        要重渲染 = true
      },
    ]
  },
  useEffect: () => {},
  useCallback: (f) => f,
})

const 假require = (名字) => {
  if (名字 === 'react') return 造React()
  throw new Error('不该 require 这个：' + 名字)
}

await import(new URL('../lib/client.js', import.meta.url).href)
const exports = 捕获.factory(假require)

let 挂 = 0
const 报 = (标签, 过, 详情) => { if (!过) 挂++; console.log(`${过 ? 'PASS' : 'FAIL'}  ${标签}${详情 ? '  :: ' + 详情 : ''}`) }

let 注册 = null
let 组件 = null
const slots = {
  inject: (名字, cb) => { if (名字 !== 'settings.section') throw new Error('槽位名不对：' + 名字); cb() },
  register: (定义, c) => { 注册 = 定义; 组件 = c; return () => {} },
}

报('模块 id 正确', 捕获.id === 'dsh-speak-up', 捕获.id)
报('inject 只依赖 slots', Array.isArray(exports.inject) && exports.inject.join() === 'slots')
exports.apply({ get: (n) => (n === 'slots' ? slots : undefined) })
报('挂到 settings.section 槽位',
  注册 !== null && 注册.name === 'settings.section' && 注册.id === 'speak-up', JSON.stringify(注册))

const 渲染 = () => { 下标 = 0; 要重渲染 = false; return 组件() }
const 首次渲染 = (初始态) => { 状态槽 = [初始态]; return 渲染() }

// 会话清单的每一行 = label 里第一个孩子是复选框
const 收集会话行 = (树) => {
  const 行 = []
  const 走 = (n) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(走)
    if (n.t === 'label' && Array.isArray(n.kids) && n.kids[0] && n.kids[0].t === 'input') 行.push(n)
    ;(n.kids || []).forEach(走)
  }
  走(树)
  return 行
}
const 行文字 = (行) => JSON.stringify(行.kids.filter((k) => k && k.t === 'span'))
const 找行 = (树, 关键词) => 收集会话行(树).find((r) => 行文字(r).includes(关键词))

const ID_长 = 'session-0f1e2d3c-4b5a-6978-8c9d-0a1b2c3d4e5f'

// ---------- 还没读到状态 ----------
状态槽 = []
报('还没读到状态时渲染「读取中…」', JSON.stringify(渲染()).includes('读取中'))

// ---------- 完整页面 ----------
const 会话清单 = [
  { id: 'sess-abc', 标题: '甲会话', 标题来源: '会话标题服务', 状态: 'idle', 有agent: true, 勾着: true },
  { id: ID_长, 标题: '乙会话', 标题来源: '投影缓存 title', 状态: 'idle', 有agent: true, 勾着: false },
  { id: 'sess-没名字', 标题: '', 标题来源: '没有', 状态: '没活着', 有agent: false, 勾着: false },
]
服务端会话 = 会话清单
const 造态 = (目标, 日志 = [{ 时间: '01-01 00:00:00', 文本: '已装好' }]) => ({
  ok: true,
  版本: '0.1.0',
  配置文件: 'C:/x/speak-up-config.json',
  活着的会话: 会话清单,
  目标情况: 目标.map((id) => {
    const s = 会话清单.find((x) => x.id === id) || {}
    return { id, 短id: String(id).slice(-8), 标题: s.标题 || '', 活着: s.有agent === true }
  }),
  目标活着: 目标.some((id) => (会话清单.find((x) => x.id === id) || {}).有agent === true),
  日志,
  配置: {
    总开关: true, 试运行: true, 目标会话: 目标, 间隔分钟: 30,
    搭话冷却分钟: 20, 没中加成: 10, 加成上限: 40,
    安静起: 1, 安静止: 8, 近阈值分钟: 20, 近因子: 0.15, 远阈值分钟: 360, 远因子: 1.5,
    峰时命中线: 20, 谷时命中线: 60,
    触发文案: '（这里是她自己写的那句话）', 角色: 'user',
  },
})

let 树 = 首次渲染(造态(['sess-abc']))
let 文 = JSON.stringify(树)
const 要有 = ['主动搭话', '总开关', '试运行', '掷骰子间隔', '安静时段', '时机因子',
  '峰谷分时', '峰时命中线', '谷时命中线', '搭话冷却', '没中加成', '加成上限',
  '近：', '远：', '目标会话', '触发文案', '角色', '保存设置', '演练一次', '真发一次', '新建一个小屋', '最近', 'developer']
const 缺 = 要有.filter((x) => !文.includes(x))
报('7 组设置 + 峰谷 + 攒加成 + 冷却 + 所有按钮都渲染出来了', 缺.length === 0, 缺.length ? '缺：' + 缺.join('、') : `${文.length} 字节`)
报('渲染过程没崩', 树 && 树.t === 'div')
报('「掷中概率」那一格已经没了', !文.includes('掷中概率'))

// ---------- 「命中线」口径要说清楚（她特意纠正过：那不叫概率）----------
报('页面上不再用「峰时概率 / 谷时概率」这种叫法',
  !文.includes('峰时概率') && !文.includes('谷时概率') && !文.includes('有效概率'))
报('骰子卡片写了「每轮掷一个 0~100 的数，比命中线小就开口」',
  文.includes('每轮掷一个 0~100 的数') && 文.includes('比命中线小就开口'))
报('命中线两格写了「掷到命中线以下才开口；掷在上面就不开」',
  文.includes('掷到命中线以下才开口') && 文.includes('掷在上面就不开'))
报('命中线两格写了「基础命中线」和最终命中线的算法',
  文.includes('基础命中线') && 文.includes('最终命中线 = 这格（看是峰时还是谷时）× 时机因子 + 攒下来的没中加成'))
报('攒加成两格写了「填 0 = 关掉这个功能」', 文.includes('填 0 = 关掉这个功能'))
报('攒加成写了「掷中（含试运行掷中）就清零，从头开始」',
  文.includes('掷中（含试运行掷中）就清零，从头开始'))
报('攒加成写了「只影响自动的定时掷骰，手动按钮不掷骰子」',
  文.includes('只影响**自动**的定时掷骰') && 文.includes('手动按钮（演练/真发）不掷骰子'))
报('写了「连着没中只记在内存里，DSH 一重启就回到 0」',
  文.includes('DSH 一重启就回到 0'))
报('冷却那格写了「0 = 不冷却」和「手动按钮不受它限制」',
  文.includes('0 = 不冷却') && 文.includes('手动按钮不受它限制'))
报('时机因子两行改成命中线口径（×0.15 更难开口 / ×1.5 更容易开口 / 中间 ×1）',
  文.includes('命中线 ×0.15') && 文.includes('更难开口') &&
  文.includes('命中线 ×1.5') && 文.includes('更容易开口') && 文.includes('中间那一段：命中线 ×1'))

// ---------- 安静时段：起===止 那条必须单独、显眼地写着 ----------
报('「两个数字填成一样 = 不启用」单独成一行写着',
  文.includes('两个数字填成一样') && 文.includes('= 不启用安静时段：整天都可能掷骰子'))
{
  // 它得是一个独立节点（不是埋在长句子里），而且用了醒目样式（红字）
  let 单独行 = null
  const 走 = (n) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(走)
    if (n.kids && n.kids.some && n.kids.some((k) => typeof k === 'string' && k.indexOf('两个数字填成一样') >= 0)) 单独行 = n
    ;(n.kids || []).forEach(走)
  }
  走(树)
  报('那行是独立节点且用了醒目样式（红字，不是普通说明）',
    !!单独行 && !!单独行.p && !!单独行.p.style && 单独行.p.style.color === '#c0392b', JSON.stringify(单独行 && 单独行.p))
}

// ---------- 峰谷卡片：只有两个数字，没有时段格子 ----------
报('峰谷卡片写清了时段规则（周一~周五 9:00~12:00、14:00~18:00 是峰时）',
  文.includes('周一~周五 9:00~12:00、14:00~18:00'))
报('峰谷卡片写清了「其余全是谷时」以及午休/晚上到早上/周末全天',
  文.includes('午休 12:00~14:00') && 文.includes('18:00 到次日 9:00') && 文.includes('周六周日全天'))
报('峰谷卡片写了「两个数字填成一样 = 不分峰谷」',
  文.includes('两个数字填成一样 = 不分峰谷'))
报('峰谷卡片提醒「安静时段会盖住谷时」', 文.includes('安静时段会盖住谷时'))
报('峰谷卡片写了「时段是固定的，不用你填」', 文.includes('时段是**固定**的，不用你填'))
{
  const 输入框 = []
  const 走 = (n) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(走)
    if (n.t === 'input') 输入框.push(n)
    ;(n.kids || []).forEach(走)
  }
  走(树)
  const 文本框 = 输入框.filter((i) => i.p.type === 'text')
  const 数字框 = 输入框.filter((i) => i.p.type === 'number')
  const 值们 = 数字框.map((i) => Number(i.p.value))
  报('整页只剩「手填 id」那一个文本框（时段格子一个都没有）',
    文本框.length === 1 && 文本框[0].p.value === 'sess-abc',
    JSON.stringify(文本框.map((i) => i.p.value)))
  报('峰时/谷时命中线是两个数字框（20 / 60）', 值们.includes(20) && 值们.includes(60), JSON.stringify(值们))
  报('攒加成/冷却也是数字框（10 / 40 / 20）', 值们.includes(10) && 值们.includes(40), JSON.stringify(值们))
  报('没有留下旧的因子数字框（0.5 不在页面上）', !值们.includes(0.5), JSON.stringify(值们))
}

// ---------- 清单：标题 + 短 id + 状态 ----------
报('清单里每个会话一行（3 行）', 收集会话行(树).length === 3)
const 甲行 = 找行(树, '甲会话')
报('行里有标题', !!甲行 && 行文字(甲行).includes('甲会话'))
报('行里的 id 是**后** 8 位（不是前 8 位）',
  !!甲行 && 行文字(甲行).includes('sess-abc'.slice(-8)) && !行文字(甲行).includes('session-'),
  甲行 ? 行文字(甲行) : '')
const 长行 = 找行(树, '乙会话')
报('长 id 也只显示尾巴', !!长行 && 行文字(长行).includes(ID_长.slice(-8)), 长行 ? 行文字(长行) : '')
报('行里有状态', !!长行 && 行文字(长行).includes('idle'))

// ---------- 没标题的：显示「（还没起名）」+ 短 id，照样能勾 ----------
const 无题行 = 找行(树, '（还没起名）')
报('拿不到标题的那行显示「（还没起名）」（不是空白）', !!无题行)
报('没标题那行也有短 id 和状态', !!无题行 && 行文字(无题行).includes('sess-没名字') && 行文字(无题行).includes('没活着'))
报('没标题那行照样是一个能勾的复选框', !!无题行 && 无题行.kids[0].p.type === 'checkbox')

// ---------- 交互：点一下 = 勾上（并且**立刻自动保存**）----------
报('初始：甲勾着、乙没勾、没名字的没勾',
  找行(树, '甲会话').kids[0].p.checked === true &&
  找行(树, '乙会话').kids[0].p.checked === false &&
  找行(树, '（还没起名）').kids[0].p.checked === false)
报('顶部写着「已勾 1 个」', 文.includes('已勾 1 个'))
报('清单上面明写「勾选/取消一点就生效（自动保存）」', 文.includes('一点就生效'))
报('顶部有同步状态提示', 文.includes('已同步'))

请求 = []
找行(树, '乙会话').kids[0].p.onChange({ target: { checked: true } })
报('点乙会话 → 触发了重渲染', 要重渲染 === true)
await new Promise((r) => setTimeout(r, 0)) // 等自动保存那一下
报('点一下**真的发了保存请求**（POST /dsh-speak-up/save）',
  请求.length === 1 && 请求[0].url === '/dsh-speak-up/save' && 请求[0].方法 === 'POST',
  JSON.stringify(请求))
报('自动保存的内容就是勾上的那两个 id（含刚点的那个）',
  请求.length === 1 && Array.isArray(请求[0].体.目标会话) && 请求[0].体.目标会话.length === 2 &&
  请求[0].体.目标会话.includes('sess-abc') && 请求[0].体.目标会话.includes(ID_长),
  JSON.stringify(请求[0] && 请求[0].体))
树 = 渲染()
报('重渲染后乙会话是勾上的', 找行(树, '乙会话').kids[0].p.checked === true)
报('重渲染后甲会话还是勾着的（支持勾多个）', 找行(树, '甲会话').kids[0].p.checked === true)
报('顶部变成「已勾 2 个」', JSON.stringify(树).includes('已勾 2 个'))

// ---------- 交互：再点一下 = 取消（也自动保存）----------
请求 = []
找行(树, '乙会话').kids[0].p.onChange({ target: { checked: false } })
await new Promise((r) => setTimeout(r, 0))
树 = 渲染()
报('再点一下乙会话 → 取消勾选', 找行(树, '乙会话').kids[0].p.checked === false)
报('又回到「已勾 1 个」', JSON.stringify(树).includes('已勾 1 个'))
报('取消也自动保存了，补丁里只剩一个 id',
  请求.length === 1 && 请求[0].体.目标会话.length === 1 && 请求[0].体.目标会话[0] === 'sess-abc',
  JSON.stringify(请求[0] && 请求[0].体))

// ---------- 交互：没标题的也能勾上 ----------
请求 = []
找行(树, '（还没起名）').kids[0].p.onChange({ target: { checked: true } })
await new Promise((r) => setTimeout(r, 0))
树 = 渲染()
报('没标题的会话点一下也能勾上', 找行(树, '（还没起名）').kids[0].p.checked === true)
报('勾上没标题的那行后，顶部提示里用短 id 表示它', JSON.stringify(树).includes('sess-没名字'))
报('没标题的也能被自动存进目标会话', 请求.length === 1 && 请求[0].体.目标会话.includes('sess-没名字'))

// ---------- 勾了一个「没活着」的 → 页面说清楚 ----------
树 = 首次渲染(造态(['sess-没名字']))
报('勾的全都没活着时，页面明确提示会跳过', JSON.stringify(树).includes('现在没活着') && JSON.stringify(树).includes('跳过'))

// ---------- 一个都没勾 ----------
树 = 首次渲染(造态([]))
报('一个都没勾时，页面红字提醒「掷中了也不会开口」', JSON.stringify(树).includes('掷中了也不会开口'))

// ---------- 手填（次要路径）还在，并且明确「手填要点保存」----------
树 = 首次渲染(造态(['sess-abc']))
报('次要路径还在：手填/粘贴 id 的输入框', JSON.stringify(树).includes('也可以直接手填'))
报('手填那条明确写了「必须点保存才生效」', JSON.stringify(树).includes('必须点保存才生效'))
报('手填旁边就有「保存手填的 id」按钮', JSON.stringify(树).includes('保存手填的 id'))

// ---------- 空数据别炸 ----------
状态槽 = []
let 没崩 = true
try { 渲染() } catch (e) { 没崩 = false; console.log(e) }
报('还没读到状态时不崩', 没崩)
没崩 = true
try {
  首次渲染({
    ok: true,
    配置: {
      总开关: true, 试运行: true, 目标会话: [], 间隔分钟: 30, 概率: 35, 安静起: 1, 安静止: 8,
      近阈值分钟: 20, 近因子: 0.15, 远阈值分钟: 360, 远因子: 1.5, 触发文案: 'x', 角色: 'user',
    },
  })
} catch (e) { 没崩 = false; console.log(e) }
报('没有会话 / 没有日志 / 没有目标情况时也能渲染（旧数据形状）', 没崩)

// ---------- 有改动 → 底部浮出「保存设置」条（她的要求：不用每次往下翻）----------
const 全部节点 = (树) => {
  const 出 = []
  const 走 = (n) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(走)
    出.push(n)
    ;(n.kids || []).forEach(走)
  }
  走(树)
  return 出
}
const 是悬浮条 = (n) => !!(n && n.p && n.p.style && n.p.style.position === 'sticky' && n.p.style.bottom === 0)

const 干净树 = 首次渲染(造态(['sess-abc']))
报('没有改动时**不**渲染悬浮保存条（平时不挡视线）', 全部节点(干净树).filter(是悬浮条).length === 0)

const 数字框 = 全部节点(干净树).find((n) => n.t === 'input' && n.p.type === 'number')
报('页面里有数字输入框（拿它试一下）', !!数字框, 数字框 ? '值=' + 数字框.p.value : '没找到')
if (数字框) 数字框.p.onChange({ target: { value: '35' } })

const 脏树 = 渲染()
const 浮条 = 全部节点(脏树).filter(是悬浮条)
报('一改数字 → 底下立刻冒出保存条（带「有改动还没保存」+ 保存按钮）',
  浮条.length === 1 &&
    JSON.stringify(浮条[0]).includes('有改动还没保存') &&
    JSON.stringify(浮条[0]).includes('保存设置'),
  浮条.length ? JSON.stringify(浮条[0].kids).slice(0, 150) : '没冒出来')

const 存键 = 浮条.length ? 全部节点(浮条[0]).find((n) => n.t === 'button' && n.p.title === '保存设置') : null
报('保存条上那个按钮点得动（就是「保存设置」本体）', !!存键)
if (存键) {
  await 存键.p.onClick()
  const 存完树 = 渲染()
  报('保存完 → 保存条自己收起来', 全部节点(存完树).filter(是悬浮条).length === 0)
}

console.log(`\n${挂 === 0 ? '全部通过 ✅' : `有 ${挂} 条没过 ❌`}`)
process.exitCode = 挂 === 0 ? 0 : 1
