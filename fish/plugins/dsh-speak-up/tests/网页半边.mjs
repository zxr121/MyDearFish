// 网页半边冒烟测试 —— 用假的 React / 假的 slots / 假的 fetch 把设置页渲染成一棵普通对象树。
//
// ⚠ 它**不装插件、不开浏览器**。这里带了一个**能真的存值的 useState**，
//   所以「点一下 = 勾上/取消」「切曲线类型」「开/关分段」这些交互是真跑过的。
//
// 验的是：
//   1) exports.inject 只依赖 slots；apply 挂到 settings.section；
//   2) 设置页渲染出概率曲线 SVG（坐标轴、刻度、两条曲线、检查点、当前点、保底线）；
//   3) 曲线类型切换会 POST /curve，未保存草稿也能预览；
//   4) 总开关/试运行是明确的开/关分段；
//   5) 房间勾选仍是一点自动保存；有改动时底部浮出保存条；
//   6) 旧命中线/加成/因子/冷却文案不再出现；旧数据没有曲线时不崩。
//
// 跑法： node tests/网页半边.mjs

let 捕获 = null
globalThis.window = { __ModuleLoader__: { load: (o) => { 捕获 = o } } }

// ---- 假的 fetch：记录请求；/state、/curve、/save 都回像真的数据 ----
let 请求 = []
let 服务端会话 = []
const 勾着们 = (体) => {
  if (!体) return []
  if (体.全选 === true) {
    const 排 = new Set(Array.isArray(体.不主动的会话) ? 体.不主动的会话 : [])
    return 服务端会话.map((s) => s.id).filter((id) => !排.has(id))
  }
  return Array.isArray(体.目标会话) ? 体.目标会话 : []
}
const 默认配置 = {
  总开关: true, 试运行: false, 全选: false, 目标会话: ['sess-abc'], 不主动的会话: [],
  间隔分钟: 30, 最长间隔分钟: 180, 曲线类型: '慢热', 曲线强度: 4, 峰时倍率: 0.5, 谷时倍率: 1,
  安静起: 1, 安静止: 8, 触发文案: '（这里是她自己写的那句话）', 保底文案: '（到点用的保底句子）', 角色: 'user',
}
const 造曲线 = (over = {}) => ({
  最长间隔分钟: 180, 曲线类型: '慢热', 曲线强度: 4, 峰时倍率: 0.5, 谷时倍率: 1,
  谷: [[0, 0], [45, 0.5], [90, 11.92], [135, 35], [179, 50], [180, 50], [180, 100]],
  峰: [[0, 0], [45, 0.25], [90, 5.96], [135, 17.5], [179, 25], [180, 25], [180, 100]],
  检查点们: [30, 60, 90, 120, 150, 180],
  当前: { 分钟: 74, 谷: 8.9, 峰: 4.45, 生效: '谷' },
  保底: { 分钟: 180, 百分比: 100 },
  ...over,
})
const 造概率状态 = (over = {}) => ({
  已过分钟: 74, 进度: 0.41, 峰: false, 倍率: 1, 本次概率: 8.9, 保底: false,
  上次主动开口: 1, 上次主动开口显示: '10-19 14:00:00', 状态: '正常',
  下次检查: '10-19 15:00:00', 下次检查毫秒: 900000, 下次原因: '间隔',
  安静中: false, 安静到: '', 待确认: null,
  ...over,
})
const 造态 = (over = {}) => {
  const 配置 = { ...默认配置, ...over.配置 }
  const 目标 = 勾着们(配置)
  return {
    ok: true,
    版本: '0.2.5',
    配置文件: 'C:/x/speak-up-config.json',
    状态文件: 'C:/x/speak-up-state.json',
    活着的会话: 服务端会话,
    目标情况: 目标.map((id) => {
      const s = 服务端会话.find((x) => x.id === id) || {}
      return { id, 短id: String(id).slice(-8), 标题: s.标题 || '', 活着: s.有agent === true, 可开: s.可开 === true, qq: s.qq || '' }
    }),
    目标活着: 目标.some((id) => {
      const s = 服务端会话.find((x) => x.id === id) || {}
      return s.有agent === true || s.可开 === true
    }),
    日志: [{ 时间: '01-01 00:00:00', 文本: '已装好' }],
    配置,
    概率状态: 造概率状态(over.概率状态),
    曲线: 造曲线({ 曲线类型: 配置.曲线类型, 最长间隔分钟: 配置.最长间隔分钟, 峰时倍率: 配置.峰时倍率, 谷时倍率: 配置.谷时倍率, ...(over.曲线 || {}) }),
  }
}
globalThis.fetch = async (url, 选项) => {
  let 体 = null
  try { 体 = 选项 && 选项.body ? JSON.parse(选项.body) : null } catch (e) { 体 = null }
  请求.push({ url: String(url), 方法: (选项 && 选项.method) || 'GET', 体 })
  if (String(url).endsWith('/curve')) {
    return { json: async () => ({ ok: true, 曲线: 造曲线({ 曲线类型: 体.曲线类型, 最长间隔分钟: Number(体.最长间隔分钟) || 180, 峰时倍率: Number(体.峰时倍率), 谷时倍率: Number(体.谷时倍率) }), 概率状态: 造概率状态() }) }
  }
  if (String(url).endsWith('/save')) {
    const 新 = { ...默认配置, ...(体 || {}) }
    return { json: async () => ({ ...造态({ 配置: 新 }), 说: '保存好了' }) }
  }
  return { json: async () => 造态() }
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
const 文 = (树) => JSON.stringify(树)
const 找节点 = (树, 条件) => 全部节点(树).find(条件)
const 按t找 = (树, t) => 全部节点(树).filter((n) => n.t === t)
const 是行 = (n, 标签) =>
  n && n.t === 'div' && Array.isArray(n.kids) && n.kids[0] && n.kids[0].t === 'div' &&
  Array.isArray(n.kids[0].kids) && n.kids[0].kids.some((k) => typeof k === 'string' && k.includes(标签))
const 找行 = (树, 标签) => 全部节点(树).find((n) => 是行(n, 标签))
const 行按钮 = (树, 标签, 文字) => {
  const 行 = 找行(树, 标签)
  if (!行) return null
  return 全部节点(行).find((n) => n.t === 'button' && n.kids.some((k) => k === 文字))
}
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
const 找会话行 = (树, 关键词) => 收集会话行(树).find((r) => 行文字(r).includes(关键词))
const 是悬浮条 = (n) => !!(n && n.p && n.p.style && n.p.style.position === 'sticky' && n.p.style.bottom === 0)

const ID_长 = 'session-0f1e2d3c-4b5a-6978-8c9d-0a1b2c3d4e5f'

// ---------- 还没读到状态 ----------
状态槽 = []
报('还没读到状态时渲染「读取中…」', 文(渲染()).includes('读取中'))

// ---------- 完整页面 ----------
const 会话清单 = [
  { id: 'sess-abc', 标题: '甲会话', 标题来源: '会话标题服务', 状态: 'idle', 有agent: true, 勾着: true },
  { id: ID_长, 标题: '乙会话', 标题来源: '投影缓存 title', 状态: 'idle', 有agent: true, 勾着: false },
  { id: 'sess-没名字', 标题: '', 标题来源: '没有', 状态: '没活着', 有agent: false, 勾着: false },
]
服务端会话 = 会话清单
let 树 = 首次渲染(造态({ 配置: { 全选: false, 目标会话: ['sess-abc'] } }))
let 全文 = 文(树)

const 要有 = ['概率曲线', '最长间隔（分钟，保底）', '检查间隔（分钟）', '曲线类型', '曲线强度',
  '峰时倍率', '谷时倍率', '触发文案（平时）', '保底文案（到点）', '她能主动开口的房间',
  '安静时段', '保存设置', '演练一次', '真发一次', '新建一个小屋', '最近', 'developer']
const 缺 = 要有.filter((x) => !全文.includes(x))
报('新页面所有卡片/按钮都渲染出来了', 缺.length === 0, 缺.length ? '缺：' + 缺.join('、') : `${全文.length} 字节`)
报('旧命中线/加成/因子/冷却文案已经不在页面上',
  ['峰时命中线', '谷时命中线', '没中加成', '加成上限', '搭话冷却', '近：', '远：', '命中线'].every((x) => !全文.includes(x)))
报('开关是明确的开/关分段（不是裸 checkbox）',
  !!行按钮(树, '总开关', '开') && !!行按钮(树, '总开关', '关') &&
  !!行按钮(树, '试运行', '开') && !!行按钮(树, '试运行', '关'))
报('总开关默认「开」、试运行默认「关」',
  行按钮(树, '总开关', '开').p['aria-pressed'] === true &&
  行按钮(树, '试运行', '关').p['aria-pressed'] === true &&
  行按钮(树, '试运行', '开').p['aria-pressed'] === false)
{
  const 文本域 = 按t找(树, 'textarea')
  报('触发文案/保底文案都填进了 textarea',
    文本域.length === 2 &&
    文本域[0].p.value.includes('这里是她自己写的那句话') &&
    文本域[1].p.value.includes('到点用的保底句子'),
    JSON.stringify(文本域.map((x) => x.p.value)))
}

// ---------- SVG 函数图 ----------
const svg = 按t找(树, 'svg')[0]
报('页面里有 SVG 函数图', !!svg)
报('曲线是直角坐标系：有横轴/纵轴标题',
  全文.includes('距上次主动开口（分钟）') && 全文.includes('本次检查开口概率（%）'))
const 折线们 = 按t找(树, 'polyline')
报('图里有谷时/峰时两条曲线', 折线们.length === 2 && 折线们.every((p) => typeof p.p.points === 'string' && p.p.points.includes(',')),
  JSON.stringify(折线们.map((p) => p.p.stroke)))
const 圆们 = 按t找(树, 'circle')
报('图里有检查点圆点（至少 6 个）', 圆们.filter((c) => c.p.r === 2.2).length >= 6, String(圆们.filter((c) => c.p.r === 2.2).length))
报('图里有当前点（大圆点）', 圆们.some((c) => c.p.r === 4.5))
报('图里有保底红色竖向虚线', 按t找(树, 'line').some((l) => l.p.stroke === '#c0392b' && l.p.strokeDasharray === '5 4'))
报('图里有 0/25/50/75/100 的纵轴刻度', ['0%', '25%', '50%', '75%', '100%'].every((x) => 全文.includes(x)))
报('图里有 180（保底）横轴刻度', 全文.includes('180（保底）'))
报('摘要写出当前距上次主动开口、本次概率和保底', 全文.includes('距上次主动开口 74.0 分钟') && 全文.includes('本次概率 8.9%') && 全文.includes('保底 100%'))

// ---------- 开/关分段：点「关」→ 脏、浮出保存条 ----------
行按钮(树, '总开关', '关').p.onClick()
树 = 渲染()
报('点总开关「关」→ 开关变成关、底部浮出保存条',
  行按钮(树, '总开关', '关').p['aria-pressed'] === true && 全部节点(树).filter(是悬浮条).length === 1,
  行按钮(树, '总开关', '关').p['aria-pressed'])
报('点总开关「关」会送 /curve 预览', await (async () => { await new Promise((r) => setTimeout(r, 260)); return 请求.some((q) => q.url.endsWith('/curve') && q.体 && q.体.总开关 === false) })(),
  JSON.stringify(请求.filter((q) => q.url.endsWith('/curve')).slice(-1)))

// 保存后浮条收起
const 存键 = 全部节点(树).find((n) => n.t === 'button' && n.p.title === '保存设置')
报('浮条上有保存按钮', !!存键)
if (存键) {
  await 存键.p.onClick()
  树 = 渲染()
  报('保存后浮条收起', 全部节点(树).filter(是悬浮条).length === 0)
}

// ---------- 曲线类型切换 → /curve ----------
请求 = []
行按钮(树, '曲线类型', '快起').p.onClick()
await new Promise((r) => setTimeout(r, 260))
报('切曲线类型 → POST /dsh-speak-up/curve 带上「快起」',
  请求.some((q) => q.url === '/dsh-speak-up/curve' && q.方法 === 'POST' && q.体 && q.体.曲线类型 === '快起'),
  JSON.stringify(请求.filter((q) => q.url.endsWith('/curve')).slice(-1)))
树 = 渲染()
报('切完曲线类型后页面不崩，图还在', !!按t找(树, 'svg')[0] && 按t找(树, 'polyline').length === 2)

// ---------- 数字改动 → 脏 ----------
树 = 首次渲染(造态({ 配置: { 全选: false, 目标会话: ['sess-abc'] } }))
const 数字框 = 全部节点(树).find((n) => n.t === 'input' && n.p.type === 'number')
报('页面里有数字输入框', !!数字框)
if (数字框) 数字框.p.onChange({ target: { value: '35' } })
树 = 渲染()
报('一改数字 → 立刻冒出保存条', 全部节点(树).filter(是悬浮条).length === 1)

// ---------- 房间勾选：一点自动保存 ----------
请求 = []
树 = 首次渲染(造态({ 配置: { 全选: false, 目标会话: ['sess-abc'] } }))
const 乙行 = 找会话行(树, '乙会话')
报('会话清单每行是复选框 + 标题 + 短 id', !!乙行 && 行文字(乙行).includes(ID_长.slice(-8)))
乙行.kids[0].p.onChange({ target: { checked: true } })
await new Promise((r) => setTimeout(r, 0))
报('点一下乙会话 → 立刻 POST /save（勾选自动保存）',
  请求.some((q) => q.url === '/dsh-speak-up/save' && q.方法 === 'POST' && Array.isArray(q.体.不主动的会话)),
  JSON.stringify(请求))

// ---------- 空/旧数据不崩 ----------
状态槽 = []
let 没崩 = true
try { 渲染() } catch (e) { 没崩 = false; console.log(e) }
报('还没读到状态时不崩', 没崩)

没崩 = true
let 旧树 = null
try {
  旧树 = 首次渲染({
    ok: true,
    配置: { 总开关: true, 试运行: true, 目标会话: [], 间隔分钟: 30, 触发文案: 'x', 角色: 'user' },
  })
} catch (e) { 没崩 = false; console.log(e) }
报('旧数据没有曲线/概率状态时也能渲染（空态提示）', 没崩 && 文(旧树).includes('宿主没有给出曲线数据'))

报('手填 id 的次要路径还在', 文(树).includes('也可以直接手填') || 文(旧树).includes('也可以直接手填'))
报('页面有「保存手填的 id」按钮', 文(树).includes('保存手填的 id'))

console.log(`\n${挂 === 0 ? '全部通过 ✅' : `有 ${挂} 条没过 ❌`}`)
process.exitCode = 挂 === 0 ? 0 : 1
