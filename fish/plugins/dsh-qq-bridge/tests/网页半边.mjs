// 「通到 QQ」网页半边冒烟测试 —— 用假的 React / 假的 slots 把设置页渲染成一棵对象树。
// 验：模块 id、inject、挂到 settings.section（id=qq-bridge）、关键元素都渲染出来、不抛错。
// 跑法： node tests/网页半边.mjs

let 捕获 = null
globalThis.window = { __ModuleLoader__: { load: (o) => { 捕获 = o } } }

globalThis.fetch = async (url) => {
  return {
    json: async () => ({
      ok: true, 版本: '0.2.1',
      配置: {
        总开关: false, 试运行: true, 目标会话: '', 私聊QQ: '', 群号: '', 转私聊: true, 转群: false, NapCat: 'http://127.0.0.1:3000',
        社交: {
          启用: true, 试运行: true, 群: ['1001'], 好友: ['2002'], 模式: 'auto', 旁听: true, 关注上限: 12, 快判: true,
          冷却秒: 60, 冷却最短秒: 5, 冷却最长倍率: 1.5, 余额吃紧线: 5, 余额吃紧倍率: 1.5, 最低余额: 1, 静音: '23:00-08:00',
          称呼: ['大肥鱼'], 兴趣词: [], 判断模型: '', 判断阈值: 0.55, 判断冷却秒: 60, 回复模型: '',
        },
      },
      NapCat状态: { 用户: 10001, 昵称: '大肥鱼' },
      活着的会话: [{ id: 'session-X', 标题: '大肥鱼 × 小鱿鱼' }],
      目标情况: [],
      社交: {
        启用: true, 试运行: true, 模式: 'auto', 在静音: false, 自己: { 号: '999', 昵称: '大肥鱼' }, 今日已接: 2,
        目标: [{ key: 'group:1001', 类型: 'group', 号: '1001', 会话id: 'session-qq-social-group-1001', 叫: '群 1001', 活着: true, 本小时: 1, 今日: 2, 待看: 1, 待发: false, 冷却: '', 画像: { 样本: 20, 稳定词: 6, 成熟: true, 门槛样本: 20, 门槛词: 6, 快判丢: 12, 快判跳过: 2 } }],
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
  useRef: (init) => ({ current: init }),
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
  ok: true, 版本: '0.2.1',
  配置: {
    总开关: false, 试运行: true, 目标会话: '', 私聊QQ: '', 群号: '', 转私聊: true, 转群: false, NapCat: 'http://127.0.0.1:3000',
    社交: {
      启用: true, 试运行: true, 群: ['1001'], 好友: ['2002'], 模式: 'auto', 旁听: true, 关注上限: 12, 快判: true,
      冷却秒: 60, 冷却最短秒: 5, 冷却最长倍率: 1.5, 余额吃紧线: 5, 余额吃紧倍率: 1.5, 最低余额: 1, 静音: '23:00-08:00',
      称呼: ['大肥鱼'], 兴趣词: [], 判断模型: '', 判断阈值: 0.55, 判断冷却秒: 60, 回复模型: '',
    },
    导入: { 启用: true, 地址: 'http://127.0.0.1:18777/mcp', 令牌: '(已设置)', 白名单: ['10001'], 每轮条数: 200, 每轮页数: 5 },
    SnowLuma: { 目录: 'C:\\dsh\\snowluma', 后台密码: 'abc123', 同意协议: true, 自动启动: true },
  },
  SnowLuma: {
    目录: 'C:\\dsh\\snowluma', 已安装: true, 版本: '2.1.0', 运行中: true, 后台在跑: true,
    已连QQ: true, 昵称: '大肥鱼', 用户: '10001', 错: '', 同意协议: true, 自动启动: true,
    是我们启动的: true, 后台: { 地址: 'http://127.0.0.1:5099/', 密码: 'abc123' },
    安装: { 进行中: false, 阶段: '完成', 错: '', 已下载: 0, 总: 0 },
  },
  NapCat状态: { 用户: 10001, 昵称: '大肥鱼' },
  活着的会话: [{ id: 'session-X', 标题: '大肥鱼 × 小鱿鱼' }],
  目标情况: [],
  社交: {
    启用: true, 试运行: true, 模式: 'auto', 在静音: false, 自己: { 号: '999', 昵称: '大肥鱼' }, 今日已接: 2,
    目标: [{
      key: 'group:1001', 类型: 'group', 号: '1001', 会话id: 'session-qq-social-group-1001', 叫: '群 1001',
      活着: true, 本小时: 1, 今日: 2, 待看: 1, 待发: false, 冷却: '',
      画像: { 样本: 20, 稳定词: 6, 成熟: true, 门槛样本: 20, 门槛词: 6, 快判丢: 12, 快判跳过: 2 },
      故障: { 连续: 3, 最后At: 1760000000000, 最后说: 'transport closed', 最后码: 'TRANSPORT', 暂停到: 1760000600000 },
      暂停中: true,
      重置: null,
    }],
    私聊: {
      key: 'private:10001', 叫: '主人私聊', 号: '10001', 会话id: 'session-qq-private-10001', 活着: false,
      故障: { 连续: 1, 最后At: 1760000000000, 最后说: 'cold request failed', 最后码: 'TRANSPORT', 暂停到: 0 },
      重置: null,
    },
  },
  导入: {
    运行中: false, 会话数: 2, 本轮: { 写: 3, 重: 1, 跳: 0, 页数: 2 },
    工具: 'get_friend_messages + list_conversations', 错误: '', 最近: 0,
    状态文件: 'C:\\dsh\\qq-import-state.json',
    启用: true, 地址: 'http://127.0.0.1:18777/mcp', 白名单: ['10001'], 每轮条数: 200, 每轮页数: 5,
    有令牌: true, 鱼脑可用: true,
  },
  日志: [{ 时间: '01-01 00:00:00', 文本: '已装好' }],
}
下标 = 0
状态槽 = [初始态]
const 树 = 组件()
const 文 = JSON.stringify(树)
const 要有 = [
  '通到 QQ', '总开关', '试运行', '目标会话', '私聊 QQ 号', '群号', '测试一句', '保存设置',
  '大肥鱼 × 小鱿鱼', '第一次接通 QQ', '安装并配置 SnowLuma', '已安装 v2.1.0',
  '重新配置并重启', '登录鱼 QQ，并在 SnowLuma 后台接上它', '回来检测这条线',
  '✓ 已经连上：大肥鱼（10001）', '打开 SnowLuma 后台', '复制后台密码',
  '社交（她在群里自己接话）', '启用社交', '判断模型', '判断冷却秒', '回复模型', '静音时段', '关注上限', '快判',
  '冷却曲线', '接话次数', '不设上限', '只受鱼脑零花钱额度约束',
  '有消息进来就先给那个群 / 好友建一间屋子', '能回答、被 @、群里热闹都不是理由', '不是被叫必回',
  '今天已接：2', '群 1001', '会话活着', '待看 1 条', '快判已成熟（挡了 12 条）',
  '连续 3 轮失败会先停 10 分钟', '重置这个聊天', '⏸ 连续失败 3 次', 'TRANSPORT',
  '主人私聊（', 'cold request failed', '等主人第一句',
  '学说话', '慢慢摸清对方打字的节奏', '对方说「别学我」会立刻停',
  '人物志（她认识的人）', '搜名字、QQ、小号、房间、关系或她记得的事', '只看熟人以上',
  '群和私聊里是同一段关系', '一个人一张卡', '大号和小号都算同一个人', '人和人之间的关系',
  '翻旧记录（Tulpa → 她的过去）', '启用翻旧记录', '访问令牌', '继续导', '清游标重来', '刷新进度',
  '群聊一条都不取', '是翻到的聊天文字，不是她亲眼经历过的事', '令牌只落本机配置文件，不进日志、不进仓库',
  '写进 3 条', '本来就有的 1 条', '有进度的会话：2 间', '鱼脑：在', '令牌：有',
  '思想活动 · 0 条', '暂停刷新', '立刻刷一次', '还没有动静', '心情 / 鱼脑的账本还没读到',
  '判断', '思考', '心情', '记忆', '开口',
]
const 缺 = 要有.filter((x) => !文.includes(x))
报('关键元素都渲染出来（含连接状态 + 目标会话标题）', 缺.length === 0, 缺.length ? '缺：' + 缺.join('、') : 文.length + ' 字节')

// ② 思想活动：自动刷新只拉 /thoughts 增量，绝不碰 /state（不然会冲掉没保存的表单值）
const 拉过的 = []
const 定时们 = []
const 真setInterval = globalThis.setInterval
globalThis.setInterval = (f, ms) => { 定时们.push({ f, ms }); return 定时们.length }
globalThis.clearInterval = () => {}
const 绪返回 = {
  ok: true, 序号: 7, 类别: ['判断', '思考', '心情', '记忆', '开口'], 重发: true,
  思绪: [{ 序号: 7, at: 1, 时间: '10-24 22:00:00', 类别: '判断', 谁: '群 1001', 文本: '快判：最高 3 分，挡掉 2 条', 详情: { 最高分: 3, 挡掉: 2 } }],
  心情: { 可用: true, 心情: 72, 上次想法: '他提起鱼片，我心里痒痒的' },
  预算: { 可用: true, 今日花费: 1.2, 今日调用: 30, 余额: 24.3 },
  落盘: 'C:\\dsh\\qq-thoughts.jsonl', 外源话: '',
}
globalThis.fetch = async (url) => {
  const u = String(url)
  拉过的.push(u)
  return { json: async () => (u.includes('/thoughts') ? 绪返回 : 初始态) }
}
const 效应 = []
let 下标2 = 0
let 槽2 = [初始态]
const 造React2 = () => ({
  createElement: (t, p, ...kids) => ({ t, p: p || {}, kids: kids.flat(9).filter((k) => k !== null && k !== undefined && k !== false) }),
  useState: (init) => {
    const i = 下标2++
    if (!(i in 槽2)) 槽2[i] = init
    return [槽2[i], (v) => { 槽2[i] = typeof v === 'function' ? v(槽2[i]) : v }]
  },
  useEffect: (f) => { 效应.push(f) },
  useRef: (init) => ({ current: init }),
  useCallback: (f) => f,
})
const exports2 = 捕获.factory((n) => {
  if (n === 'react') return 造React2()
  throw new Error('不该 require 这个：' + n)
})
下标2 = 0
let 组件2 = null
exports2.apply({
  get: (n) => (n === 'slots' ? {
    inject: (名字, cb) => cb(),
    register: (d, c) => { 组件2 = c; return () => {} },
  } : undefined),
})
组件2() // 第一次渲染：挂上 effect 并注册轮询定时器
for (const f of 效应) f()
await new Promise((r) => setTimeout(r, 30))
const 轮询 = 定时们.find((x) => x.ms === 3000)
报('思想活动挂了 3 秒自动刷新', !!轮询)
拉过的.length = 0
下标2 = 0
组件2() // 第二次渲染：数据已经进了状态槽
const 有拉过 = 拉过的.length
await 轮询.f()
await new Promise((r) => setTimeout(r, 30))
报('自动刷新拉的是 /thoughts 增量，不碰 /state', 拉过的.length === 有拉过 + 1 && 拉过的.at(-1).includes('/thoughts?since=7'), JSON.stringify(拉过的))
const 文2 = (() => { 下标2 = 0; return JSON.stringify(组件2()) })()
报('面板顶部给出当前心情和今日花费', 文2.includes('心情 72 分') && 文2.includes('今天花了 ¥1.2（30 次）') && 文2.includes('余额 ¥24.3'), 文2.includes('心情 72 分') ? '' : '没渲染出摘要')
报('一条思绪带类别标签、时间和正文', 文2.includes('快判：最高 3 分，挡掉 2 条') && 文2.includes('10-24 22:00:00') && 文2.includes('群 1001'), '')
报('落盘路径写在提示里，能回看', 文2.includes('qq-thoughts.jsonl'), '')
globalThis.setInterval = 真setInterval

console.log(`\n${挂了 === 0 ? '全部通过 ✅' : `有 ${挂了} 条没过 ❌`}`)
process.exitCode = 挂了 === 0 ? 0 : 1