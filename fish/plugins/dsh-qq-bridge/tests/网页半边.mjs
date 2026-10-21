// 「通到 QQ」网页半边冒烟测试 —— 用假的 React / 假的 slots 把设置页渲染成一棵对象树。
// 验：模块 id、inject、挂到 settings.section（id=qq-bridge）、关键元素都渲染出来、不抛错。
// 跑法： node tests/网页半边.mjs

let 捕获 = null
globalThis.window = { __ModuleLoader__: { load: (o) => { 捕获 = o } } }

globalThis.fetch = async (url) => {
  return {
    json: async () => ({
      ok: true, 版本: '0.2.0',
      配置: {
        总开关: false, 试运行: true, 目标会话: '', 私聊QQ: '', 群号: '', 转私聊: true, 转群: false, NapCat: 'http://127.0.0.1:3000',
        社交: {
          启用: true, 试运行: true, 群: ['1001'], 好友: ['2002'], 模式: 'auto', 旁听: true, 关注上限: 12, 快判: true,
          冷却秒: 90, 每小时上限: 6, 每天上限: 30, 每天总上限: 80, 最低余额: 1, 静音: '23:00-08:00',
          称呼: ['大肥鱼'], 兴趣词: [], 判断模型: '', 判断阈值: 0.55, 判断冷却秒: 60, 回复模型: '',
        },
      },
      NapCat状态: { 用户: 10001, 昵称: '大肥鱼' },
      活着的会话: [{ id: 'session-X', 标题: '大肥鱼 × 小鱿鱼' }],
      目标情况: [],
      社交: {
        启用: true, 试运行: true, 模式: 'auto', 在静音: false, 自己: { 号: '999', 昵称: '大肥鱼' }, 今日已接: 2,
        目标: [{ key: 'group:1001', 类型: 'group', 号: '1001', 会话id: 'session-qq-social-group-1001', 叫: '群 1001', 活着: true, 本小时: 1, 今日: 2, 待看: 1, 待发: false, 限额: '', 画像: { 样本: 20, 稳定词: 6, 成熟: true, 门槛样本: 20, 门槛词: 6, 快判丢: 12, 快判跳过: 2 } }],
      },
      日志: [{ 时间: '01-01 00:00:00', 文本: '已装好' }],
    }),
  }
}

let 状态槽 = []
let 下标 = 0
const 造React = () => ({
  createElement: (t, p, ...kids) => ({ t, p: p || {}, kids: kids.flat(9).filter((k) => k !== null && k !== undefined && k !== false) }),
  useState: (init) => {
    const i = 下标++
    if (!(i in 状态槽)) 状态槽[i] = init
    return [状态槽[i], (v) => { 状态槽[i] = typeof v === 'function' ? v(状态槽[i]) : v }]
  },
  useEffect: () => {},
  useCallback: (f) => f,
})
const 假require = (n) => {
  if (n === 'react') return 造React()
  throw new Error('不该 require 这个：' + n)
}

await import(new URL('../lib/client.js', import.meta.url).href)

const exports = 捕获.factory(假require)
let 挂了 = 0
const 报 = (标签, 过, 详情) => { if (!过) 挂了++; console.log(`${过 ? 'PASS' : 'FAIL'}  ${标签}${详情 ? '  :: ' + 详情 : ''}`) }

报('模块 id = dsh-qq-bridge', 捕获.id === 'dsh-qq-bridge', 捕获.id)
报('inject 只依赖 slots', Array.isArray(exports.inject) && exports.inject.join() === 'slots')

let 注册 = null
let 组件 = null
const slots = {
  inject: (n, cb) => { if (n !== 'settings.section') throw new Error('槽位名不对：' + n); cb() },
  register: (d, c) => { 注册 = d; 组件 = c; return () => {} },
}
exports.apply({ get: (n) => (n === 'slots' ? slots : undefined) })
报('挂到 settings.section，id = qq-bridge', 注册 !== null && 注册.id === 'qq-bridge' && 注册.name === 'settings.section', JSON.stringify(注册))

// 预先填好「已经读到状态」的第一格（体），这样不用等 useEffect 拉数据，组件一次渲染就出整页
const 初始态 = {
  ok: true, 版本: '0.2.0',
  配置: {
    总开关: false, 试运行: true, 目标会话: '', 私聊QQ: '', 群号: '', 转私聊: true, 转群: false, NapCat: 'http://127.0.0.1:3000',
    社交: {
      启用: true, 试运行: true, 群: ['1001'], 好友: ['2002'], 模式: 'auto', 旁听: true, 关注上限: 12, 快判: true,
      冷却秒: 90, 每小时上限: 6, 每天上限: 30, 每天总上限: 80, 最低余额: 1, 静音: '23:00-08:00',
      称呼: ['大肥鱼'], 兴趣词: [], 判断模型: '', 判断阈值: 0.55, 判断冷却秒: 60, 回复模型: '',
    },
  },
  NapCat状态: { 用户: 10001, 昵称: '大肥鱼' },
  活着的会话: [{ id: 'session-X', 标题: '大肥鱼 × 小鱿鱼' }],
  目标情况: [],
  社交: {
    启用: true, 试运行: true, 模式: 'auto', 在静音: false, 自己: { 号: '999', 昵称: '大肥鱼' }, 今日已接: 2,
    目标: [{ key: 'group:1001', 类型: 'group', 号: '1001', 会话id: 'session-qq-social-group-1001', 叫: '群 1001', 活着: true, 本小时: 1, 今日: 2, 待看: 1, 待发: false, 限额: '', 画像: { 样本: 20, 稳定词: 6, 成熟: true, 门槛样本: 20, 门槛词: 6, 快判丢: 12, 快判跳过: 2 } }],
  },
  日志: [{ 时间: '01-01 00:00:00', 文本: '已装好' }],
}
下标 = 0
状态槽 = [初始态]
const 树 = 组件()
const 文 = JSON.stringify(树)
const 要有 = [
  '通到 QQ', '总开关', '试运行', '目标会话', '私聊 QQ 号', '群号', '测试一句', '保存设置',
  '大肥鱼 × 小鱿鱼', '连着的 QQ：大肥鱼（10001）',
  '社交（她在群里自己接话）', '启用社交', '判断模型', '判断冷却秒', '回复模型', '静音时段', '关注上限', '快判',
  '判断模型每次只挑她感兴趣的消息', '能回答、被 @、群里热闹都不是理由', '不是被叫必回',
  '今天已接：2', '群 1001', '会话活着', '待看 1 条', '快判已成熟（挡了 12 条）',
]
const 缺 = 要有.filter((x) => !文.includes(x))
报('关键元素都渲染出来（含连接状态 + 目标会话标题）', 缺.length === 0, 缺.length ? '缺：' + 缺.join('、') : 文.length + ' 字节')

console.log(`\n${挂了 === 0 ? '全部通过 ✅' : `有 ${挂了} 条没过 ❌`}`)
process.exitCode = 挂了 === 0 ? 0 : 1