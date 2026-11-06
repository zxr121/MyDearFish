// 「心情」网页半边冒烟测试 —— 用假的 React / 假的 slots 把设置页渲染成对象树。
// 验：挂到 settings.fish.tab、名字只读、开关是开/关分段、页头说明存在。
// 跑法： node tests/网页半边.mjs

let 捕获 = null
globalThis.window = { __ModuleLoader__: { load: (o) => { 捕获 = o } } }
globalThis.fetch = async () => ({ json: async () => ({}) })

const 造的节点 = (tag) => ({
  tagName: String(tag || '').toUpperCase(),
  style: {},
  setAttribute() {},
  appendChild() {},
  remove() {},
})
globalThis.document = {
  head: 造的节点('head'),
  body: 造的节点('body'),
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
  throw new Error('不该 require 这个：' + n)
}

await import(new URL('../client.js', import.meta.url).href)

const exports = 捕获.factory(假require)
let 挂了 = 0
const 报 = (标签, 过, 详情) => { if (!过) 挂了++; console.log(`${过 ? 'PASS' : 'FAIL'}  ${标签}${详情 ? '  :: ' + 详情 : ''}`) }

报('模块 id = dsh-feiyu-mood', 捕获.id === 'dsh-feiyu-mood', 捕获.id)
报('inject 只依赖 slots', Array.isArray(exports.inject) && exports.inject.join() === 'slots')

let 注册 = null
let 组件 = null
const slots = {
  inject: (名字, cb) => { if (名字 !== 'settings.fish.tab') throw new Error('槽位名不对：' + 名字); cb() },
  register: (定义, 渲染) => { 注册 = 定义; 组件 = 渲染; return () => {} },
}
exports.apply({ get: (n) => (n === 'slots' ? slots : undefined), effect: (fn) => fn() })
报('挂到 settings.fish.tab，id = mood', 注册 !== null && 注册.name === 'settings.fish.tab' && 注册.id === 'mood', JSON.stringify(注册))

状态槽 = [
  {
    ownerName: '主人', selfName: '大肥鱼', selfAliases: '',
    autoJudge: true, injectMood: false, moodBase: 70, moodFloor: 0,
    targetSession: '', judgeProvider: '', judgeModel: '',
  },
  {
    mood: 70, moodLabel: '一般', lastReason: '主人一步一步教我怎么找系列', updatedAt: 0, timeline: [],
    inner: {
      enabled: true,
      strength: 0.62,
      affect: { phrase: '心里有点雀跃', family: 'joy', facetLabel: '雀跃', mood: 70 },
      urges: [{ key: 'recognition', phrase: '想让主人看见我做成的事' }],
      cue: { text: '今天把那个弄成了' },
    },
  },
  [], [], '', '',
]
下标 = 0
const 外壳 = 组件()
const 树 = 外壳.t(外壳.p)
const 文 = JSON.stringify(树)
报('页头写清本页能设置什么', 文.includes('本页可以设置') && 文.includes('基线'))
报('鱼脑内心占据主标题', 文.includes('心里有点雀跃') && 文.includes('想让主人看见我做成的事') && 文.includes('今天把那个弄成了'))
报('主标题带情绪大类', 文.includes('"data-fm-chip"') && 文.includes('喜·雀跃'))
报('底色和原始记录放进折叠区', 文.includes('底色与原始记录') && 文.includes('"data-fm-details"') && 文.includes('重置到基线'))
报('名字是只读展示', 文.includes('被关心的那个人') && !文.includes('placeholder":"小鱿鱼"'))
报('两个开关是开/关分段', (文.match(/"aria-pressed":/g) || []).length >= 4 && 文.includes('"data-on":"true"') && 文.includes('"data-on":"false"'))

// 鱼脑没挂时，退回心情插件自己的标签和原因，不显示空的“此刻”。
状态槽 = [
  {
    ownerName: '主人', selfName: '大肥鱼', selfAliases: '',
    autoJudge: true, injectMood: false, moodBase: 70, moodFloor: 0,
    targetSession: '', judgeProvider: '', judgeModel: '',
  },
  { mood: 55, moodLabel: '一般', lastReason: '今天有点累', updatedAt: 0, timeline: [] },
  [], [], '', '',
]
下标 = 0
const 外壳2 = 组件()
const 文2 = JSON.stringify(外壳2.t(外壳2.p))
报('没有鱼脑内心时退回心情标签', 文2.includes('一般') && 文2.includes('今天有点累') && !文2.includes('此刻 · 鱼脑内心'))

process.exitCode = 挂了 === 0 ? 0 : 1
