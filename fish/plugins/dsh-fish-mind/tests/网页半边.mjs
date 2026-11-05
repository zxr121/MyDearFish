// 「大肥鱼 / 她在外面」网页半边冒烟测试 —— 用假的 React / 假的 slots 把设置页渲染成对象树。
// 验：两个父页注册、子 tab 槽位、默认落在总览、外部 tab 能合并进来、不抛错。
// 跑法： node tests/网页半边.mjs

let 捕获 = null
globalThis.window = { __ModuleLoader__: { load: (o) => { 捕获 = o } } }

globalThis.fetch = async () => ({ json: async () => ({}) })

const 造的节点 = (tag) => ({
  tagName: String(tag || '').toUpperCase(),
  style: {},
  children: [],
  setAttribute() {},
  appendChild(child) { this.children.push(child) },
  remove() {},
})

const 头部 = 造的节点('head')
const 身体 = 造的节点('body')
globalThis.document = {
  head: 头部,
  body: 身体,
  createElement: (tag) => 造的节点(tag),
}

let 状态槽 = []
let 下标 = 0
const 造React = () => ({
  createElement: (t, p, ...kids) => ({ t, p: p || {}, kids: kids.flat(9).filter((k) => k !== null && k !== undefined && k !== false) }),
  useState: (init) => {
    const i = 下标++
    if (!(i in 状态槽)) 状态槽[i] = typeof init === 'function' ? init() : init
    return [状态槽[i], (v) => { 状态槽[i] = typeof v === 'function' ? v(状态槽[i]) : v }]
  },
  useEffect: () => {},
  useRef: (init) => ({ current: init }),
  useCallback: (f) => f,
})
const 假require = (n) => {
  if (n === 'react') return 造React()
  if (n === 'react-dom/client') return { createRoot: () => ({ render() {}, unmount() {} }) }
  throw new Error('不该 require 这个：' + n)
}

await import(new URL('../client.js', import.meta.url).href)

const exports = 捕获.factory(假require)
let 挂了 = 0
const 报 = (标签, 过, 详情) => { if (!过) 挂了++; console.log(`${过 ? 'PASS' : 'FAIL'}  ${标签}${详情 ? '  :: ' + 详情 : ''}`) }

报('模块 id = dsh-fish-mind', 捕获.id === 'dsh-fish-mind', 捕获.id)
报('inject 只依赖 slots', Array.isArray(exports.inject) && exports.inject.join() === 'slots')

let 注册们 = []
const 子tab = {
  'settings.fish.tab': [{ options: { id: 'mood', order: 30, label: '心情' } }],
  'settings.outside.tab': [
    { options: { id: 'qq', order: 10, label: '通到 QQ' } },
    { options: { id: 'speak-up', order: 20, label: '主动搭话' } },
    { options: { id: 'bili', order: 30, label: '刷 B 站' } },
  ],
}
const slots = {
  inject: (名字, cb) => {
    if (名字 !== 'settings.section') throw new Error('槽位名不对：' + 名字)
    cb()
  },
  register: (定义, 组件) => { 注册们.push({ 定义, 组件 }); return () => {} },
  getVersion: () => 1,
  entries: (名字) => 子tab[名字] || [],
  subscribe: () => () => {},
}
exports.apply({ get: (n) => (n === 'slots' ? slots : undefined), effect: (fn) => fn() })

const 找 = (id) => 注册们.find((item) => item.定义.id === id)
const 鱼页 = 找('fish')
const 外面页 = 找('outside')

报('注册了「大肥鱼」父页', 鱼页 !== undefined && 鱼页.定义.name === 'settings.section' && 鱼页.定义.order === -40, JSON.stringify(鱼页 && 鱼页.定义))
报('大肥鱼声明 settings.fish.tab 子槽位', 鱼页 !== undefined && 鱼页.定义.children && 鱼页.定义.children['settings.fish.tab'] !== undefined)
报('注册了「她在外面」父页', 外面页 !== undefined && 外面页.定义.name === 'settings.section' && 外面页.定义.order === -35, JSON.stringify(外面页 && 外面页.定义))
报('她在外面声明 settings.outside.tab 子槽位', 外面页 !== undefined && 外面页.定义.children && 外面页.定义.children['settings.outside.tab'] !== undefined)
报('不再注册旧的 fish-memes / fish-about 一级页', 找('fish-memes') === undefined && 找('fish-about') === undefined)

const 概览 = {
  identity: { name: '大肥鱼', species: '鲸鱼娘', updatedAt: 0 },
  phase: '醒着',
  memory: { total: 12, today: 2 },
  mood: { available: false },
  channels: {},
  wallet: { available: false },
  backup: {},
  boundaries: {},
  settings: {},
  archive: {},
}
const 表单 = {
  name: '大肥鱼', species: '鲸鱼娘', appearance: '', ownerAddress: '主人',
  ownerGender: '未说', origin: '', style: '', relations: [],
}

const 渲染父页 = (注册, props = {}) => {
  状态槽 = ['overview', new Set(['overview']), 概览, 表单]
  下标 = 0
  const 外壳 = 注册.组件({ renderSlot: () => null, useTabs: (选择) => 选择(子tab['settings.fish.tab'].map((e) => e.options)), ...props })
  return 外壳.t(外壳.p)
}
const 树文 = (树) => JSON.stringify(树)

const 鱼树 = 渲染父页(鱼页)
const 鱼文 = 树文(鱼树)
const 面板 = 鱼文.match(/"data-fishm-pane":"[^"]+","hidden":(?:true|false)/g) || []
报('大肥鱼默认从总览开始', 面板.includes('"data-fishm-pane":"overview","hidden":false'), JSON.stringify(面板) + ' | ' + JSON.stringify(鱼树.kids[1] && 鱼树.kids[1].p))
for (const 标签 of ['总览', '她是谁', '记忆', '零花钱', '梗百科', '心情']) {
  报(`大肥鱼 tab 有「${标签}」`, 鱼文.includes(标签))
}
报('总览里有状态卡', 鱼文.includes('能不能说话') || 鱼文.includes('日常只用管四项'))
报('总览里能直接切 QQ 总开关、社交和主动搭话',
  鱼文.includes('打开总开关') && 鱼文.includes('打开社交') && 鱼文.includes('打开主动搭话'),
  鱼文.slice(0, 400))

const 外树 = (() => {
  状态槽 = []
  下标 = 0
  const 外壳 = 外面页.组件({ renderSlot: () => null, useTabs: (选择) => 选择(子tab['settings.outside.tab'].map((e) => e.options)) })
  return 外壳.t(外壳.p)
})()
const 外文 = 树文(外树)
for (const 标签 of ['通到 QQ', '主动搭话', '刷 B 站']) {
  报(`她在外面 tab 有「${标签}」`, 外文.includes(标签))
}
报('她在外面默认显示第一项', 外文.includes('"data-fishm-pane":"qq"') && !外文.includes('"data-fishm-pane":"qq","hidden":true'))

process.exitCode = 挂了 === 0 ? 0 : 1
