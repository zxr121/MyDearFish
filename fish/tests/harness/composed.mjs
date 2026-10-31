// 组合测试的假宿主：同一套 ctx 同时挂 dsh-fish-mind 和 dsh-qq-bridge，
// 抓到“她这一轮真正看到的系统提示段 + QQ 入站消息”。两个插件各自单测都绿、
// 叠在一起才出问题的回归，只能在这一层看见。

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

// 自动接管会读真机器上的 SnowLuma 进程和目录，假 fetch 分不出来。
process.env.DSH_QQ_BRIDGE_NO_SNOWLUMA_ADOPT = '1'

const FISH_MIND_URL = new URL('../../plugins/dsh-fish-mind/lib/index.js', import.meta.url)
const QQ_HOST_SPEC = '../../plugins/dsh-qq-bridge/lib/host.js'

/** 和真实 Cordis ctx 的最小交集：事件、effect、服务、定时器。 */
export function fakeContext() {
  const handlers = new Map()
  const disposers = []
  const services = new Map()
  const intervals = []
  const ctx = {
    on(event, handler) {
      const list = handlers.get(event) || []
      list.push(handler)
      handlers.set(event, list)
      return () => {
        const index = list.indexOf(handler)
        if (index >= 0) list.splice(index, 1)
      }
    },
    effect(handler) {
      const dispose = handler()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
    provide(name, value) {
      services.set(name, value)
      const dispose = () => services.delete(name)
      disposers.push(dispose)
      return dispose
    },
    set(name, value) {
      services.set(name, value)
    },
    get(name) {
      if (services.has(name)) return services.get(name)
      return ctx[name]
    },
    inject(names, callback) {
      if (!names.every((name) => services.has(name))) return () => {}
      const child = Object.create(ctx)
      for (const name of names) child[name] = services.get(name)
      return callback(child)
    },
    interval(fn, ms) {
      intervals.push({ fn, ms })
      return () => {
        const index = intervals.indexOf(fn)
        if (index >= 0) intervals.splice(index, 1)
      }
    },
    async emit(event, ...args) {
      let result
      for (const handler of handlers.get(event) || []) result = await handler(...args)
      return result
    },
    dispose() {
      for (const dispose of disposers.reverse()) {
        try {
          dispose()
        } catch {}
      }
    },
    logger: { info() {}, warn() {}, error() {} },
    intervals,
  }
  return ctx
}

/** 一条会话对象；header 默认带 cwd，子代理判定不用它。 */
export function session(id, header = {}) {
  return { id, header: { id, cwd: process.cwd(), ...header } }
}

/** 用户消息事件：source 决定鱼脑把它归到哪间屋子、算谁说的。 */
export function userEvent(text, { seq = 1, time = Date.now(), source = { kind: 'user' } } = {}) {
  return {
    type: 'user/message',
    seq,
    time,
    data: { role: 'user', id: `u${seq}`, content: [{ type: 'text', text }], source },
  }
}

/** 她的回复事件。 */
export function assistantEvent(text, { seq = 1, time = Date.now(), turn = 1 } = {}) {
  return {
    type: 'assistant/message',
    seq,
    time,
    data: {
      turn,
      message: { role: 'assistant', id: `a${seq}`, content: [{ type: 'text', text }], source: { kind: 'model' } },
    },
  }
}

export function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

/**
 * 从出厂 bundle 里取出 personaPrefix。YAML 折叠标量按“单换行变空格”近似拼回，
 * 只用于 hash 和禁用短语检查；不整段进 golden，主人在设置页改人设不会让它抖。
 */
export function readPersonaPrefix() {
  const raw = readFileSync(new URL('../../bundle/cordis.patch.yml', import.meta.url), 'utf8')
  const lines = raw.split(/\r?\n/)
  const start = lines.findIndex((line) => /^\s*personaPrefix:\s*>-\s*$/.test(line))
  if (start < 0) throw new Error('cordis.patch.yml 里找不到 personaPrefix')
  const indent = lines[start].match(/^\s*/)[0].length
  const body = []
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') {
      body.push('')
      continue
    }
    if (line.match(/^\s*/)[0].length <= indent) break
    body.push(line.trim())
  }
  const text = body.join(' ').replace(/\s+/g, ' ').trim()
  return { text, sha256: createHash('sha256').update(text).digest('hex') }
}

/** 成熟的主人风格画像：短句、少句号、爱连发；正是本次回归的触发条件。 */
export function matureOwnerPerson({ at = Date.now() } = {}) {
  const relation = {
    熟: 90,
    暖: 70,
    张力: 0,
    见过: 40,
    互动: 40,
    被叫: 0,
    首见At: at - 20 * 86_400_000,
    最后At: at,
    上次她说At: at,
    记忆: [],
    共同话题: [],
  }
  return {
    号: '837263217',
    名: '主人',
    别名: ['主人'],
    账号: [{ 号: '837263217', 名: '主人', 主: true, 来源: '看见', 房: 'friend:837263217', at: at - 20 * 86_400_000 }],
    初见At: at - 20 * 86_400_000,
    最后At: at,
    见过: 40,
    天数: [],
    事实: [],
    边界: [],
    印象: { 暖: 70, 信: 60 },
    主人: true,
    关系: relation,
    房: {
      'friend:837263217': { ...relation, 记忆: [] },
      'group:2001': { ...relation, 熟: 70, 记忆: [] },
    },
    风格: {
      样本: 48,
      句长: 7,
      短句: 0.8,
      问句: 0.4,
      叹号: 0.1,
      句号: 0,
      逗号: 0.4,
      省略: 0.3,
      表情: 0.45,
      网络词: 0.3,
      连发: 0.8,
      语气词: { 哦: 12, 呀: 8 },
      最后At: at,
      摘要: '',
      摘要At: 0,
      摘要样本: 0,
      别学: false,
      别学At: 0,
    },
  }
}

/** 一份能驱动 QQ 主人桥的最小配置；戳一戳收报口关掉，测试不占真端口。 */
export function qqConfig(overrides = {}) {
  return {
    总开关: true,
    试运行: false,
    目标会话: 'session-desktop',
    私聊QQ: '837263217',
    群号: '',
    转私聊: true,
    转群: false,
    NapCat: 'http://127.0.0.1:3000',
    戳一戳: { 启用: false, 端口: 19399 },
    ...overrides,
  }
}

function jsonResponse(body) {
  return { json: async () => body, text: async () => JSON.stringify(body) }
}

function installFakeOneBot(state) {
  const previous = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    const action = String(url).split('/').pop().split('?')[0]
    const body = JSON.parse((options && options.body) || '{}')
    state.calls.push({ action, body })
    if (action === 'get_login_info') {
      return jsonResponse({ status: 'ok', retcode: 0, data: { user_id: 837263217, nickname: '大肥鱼' } })
    }
    if (action === 'get_friend_msg_history') {
      return jsonResponse({
        status: 'ok',
        retcode: 0,
        data: { messages: state.privateMessages.slice() },
      })
    }
    if (action === 'get_group_msg_history') {
      return jsonResponse({ status: 'ok', retcode: 0, data: { messages: [] } })
    }
    if (action === 'get_group_list' || action === 'get_friend_list' || action === 'get_custom_face') {
      return jsonResponse({ status: 'ok', retcode: 0, data: [] })
    }
    return jsonResponse({ status: 'ok', retcode: 0, data: {} })
  }
  return () => {
    globalThis.fetch = previous
  }
}

/**
 * 组一套“鱼脑 + QQ 桥”的假宿主。
 * @param {{fishConfig?: object, qq?: object, people?: object, home?: string}} [options]
 * @returns {Promise<object>} 可组装提示、驱动轮询、读入站消息的句柄。
 */
export async function createComposedHarness(options = {}) {
  const home = options.home || mkdtempSync(join(tmpdir(), 'fish-composed-'))
  process.env.DSH_HOME = home
  mkdirSync(join(home, 'fish-mind'), { recursive: true })
  writeJson(join(home, 'fish-mind', 'config.json'), {
    mode: 'live',
    inject: true,
    working: { ttlMinutes: 7 * 24 * 60, rows: 30, chars: 2000 },
    ...(options.fishConfig || {}),
  })
  writeJson(join(home, 'qq-bridge-config.json'), qqConfig(options.qq || {}))
  if (options.people) writeJson(join(home, 'qq-social-people.json'), { version: 2, people: options.people, 关系网: [] })

  const root = fakeContext()
  const agents = new Map()
  const followups = []

  const makeAgent = (sid, header = {}) => {
    const agentCtx = fakeContext()
    const sections = []
    const contexts = []
    const tools = new Map()
    const drop = (list, entry) => {
      const index = list.indexOf(entry)
      if (index >= 0) list.splice(index, 1)
    }
    agentCtx.set('systemPrompt', {
      section(entry) {
        sections.push(entry)
        return () => drop(sections, entry)
      },
      context(entry) {
        contexts.push(entry)
        return () => drop(contexts, entry)
      },
    })
    agentCtx.set('tools', {
      register(definition) {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
    })
    const agent = {
      session: session(sid, header),
      ctx: agentCtx,
      options: { provider: 'fake', model: 'chat' },
      followup(message) {
        followups.push({ sessionId: sid, message })
      },
    }
    return { agent, sections, contexts, tools }
  }

  const register = (sid, header = {}) => {
    const made = makeAgent(sid, header)
    agents.set(sid, made)
    return made
  }
  const desktop = register('session-desktop')

  const agentService = {
    get: (id) => (agents.get(String(id)) || {}).agent,
    list: () => [...agents.values()].map((item) => item.agent),
    async resume({ resumeSessionId }) {
      const existing = agents.get(String(resumeSessionId))
      if (existing) return { agent: existing.agent, dispose: () => {} }
      const error = new Error('no such session')
      error.name = 'SessionPersistenceNotFoundError'
      throw error
    },
    async create({ sessionId, meta, setup }) {
      const made = register(String(sessionId), { cwd: meta && meta.cwd })
      if (typeof setup === 'function') await setup(made.agent.ctx)
      return {
        agent: made.agent,
        dispose: () => {
          agents.delete(String(sessionId))
        },
      }
    },
  }

  root.agents = agentService
  root.sessions = { flush: async () => {} }
  root.sessionTitle = { get: () => undefined, rename: () => {} }
  root.webServer = { register: () => {} }
  root.workspaceRegistry = {
    archivedSessionIds: [],
    list: () => [],
    resolveByPath: async () => undefined,
    create: async () => ({ attachSession: async () => {} }),
  }
  root.agentDefaultModel = { currentSelection: () => ({ provider: 'fake', model: 'chat' }) }

  const oneBot = { calls: [], privateMessages: [] }
  const restoreFetch = installFakeOneBot(oneBot)

  const fishMind = await import(FISH_MIND_URL)
  fishMind.apply(root)
  const qqBridge = await import(`${QQ_HOST_SPEC}?home=${encodeURIComponent(home)}`)
  qqBridge.apply(root)

  const mind = root.get('fishMind')
  if (!mind) throw new Error('fishMind 服务没有挂上')

  const emit = (sid, event) => root.emit('session/event', session(sid), event)

  const pollMain = async () => {
    const main = root.intervals[0]
    if (!main) throw new Error('QQ 主人桥没有注册轮询')
    await main.fn()
    await new Promise((resolve) => setTimeout(resolve, 20))
  }

  const setPrivateMessage = ({ text, id = 9001, time = Math.floor(Date.now() / 1000) + 60 }) => {
    oneBot.privateMessages = [{
      user_id: 837263217,
      time,
      message_id: id,
      message_type: 'private',
      message: [{ type: 'text', data: { text } }],
    }]
  }

  const surface = (sid = 'session-desktop') => {
    const made = agents.get(sid)
    if (!made) throw new Error(`没有登记会话 ${sid}`)
    const assembly = { agent: made.agent }
    const components = []
    for (const entry of made.sections) {
      components.push({
        kind: 'section',
        name: entry.name,
        order: entry.order,
        text: typeof entry.text === 'function' ? String(entry.text(assembly) ?? '') : String(entry.text ?? ''),
      })
    }
    for (const entry of made.contexts) {
      components.push({
        kind: 'context',
        name: entry.name,
        order: entry.order,
        text: typeof entry.text === 'function' ? String(entry.text(assembly) ?? '') : String(entry.text ?? ''),
      })
    }
    return components
  }

  const addAgent = async (sid, header = {}) => {
    const made = register(sid, header)
    await root.emit('agent/created', { agent: made.agent })
    return made
  }

  const dispose = () => {
    try {
      root.dispose()
    } finally {
      restoreFetch()
    }
  }

  return {
    home,
    root,
    mind,
    qqBridge,
    desktop,
    agents,
    followups,
    oneBot,
    emit,
    pollMain,
    setPrivateMessage,
    surface,
    addAgent,
    dispose,
  }
}

/** 生成的 golden 里去掉每次跑都会变的绝对时间，保留结构和其他正文。 */
export function normalizeSurface(value, home) {
  const replaceHome = (text) => {
    let out = String(text)
    if (home) out = out.split(home).join('<home>').split(home.replace(/\\/g, '/')).join('<home>')
    return out
      .replace(/\b\d{4}\/\d{1,2}\/\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?/g, '<when>')
      .replace(/\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?/g, '<when>')
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '<date>')
      .replace(/\b\d{2}-\d{2} \d{2}:\d{2}\b/g, '<when>')
  }
  if (typeof value === 'string') return replaceHome(value)
  if (Array.isArray(value)) return value.map((item) => normalizeSurface(item, home))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [key, item] of Object.entries(value)) out[key] = normalizeSurface(item, home)
    return out
  }
  return value
}

/** 读/更新 golden：UPDATE_PROMPT_GOLDEN=1 时写盘，平时只比对。 */
export function expectedSurface(name, actual) {
  const file = new URL(`../expected/prompt-surface/${name}.json`, import.meta.url)
  if (process.env.UPDATE_PROMPT_GOLDEN === '1') {
    mkdirSync(new URL('../expected/prompt-surface/', import.meta.url), { recursive: true })
    writeFileSync(file, JSON.stringify(actual, null, 2) + '\n', 'utf8')
    return actual
  }
  return JSON.parse(readFileSync(file, 'utf8'))
}
