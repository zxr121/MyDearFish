// 鱼脑测试共用的假宿主：事件、服务、代理会话和提示段收集。
// 单独成文件是为了让组合测试只拿夹具，不用 import 整个 plugin.test.mjs 把它的用例再注册一遍。

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function fakeContext() {
  const handlers = new Map()
  const disposers = []
  const services = new Map()
  return {
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
      return services.get(name)
    },
    inject(names, callback) {
      if (!names.every((name) => services.has(name))) return () => {}
      const child = Object.create(this)
      for (const name of names) child[name] = services.get(name)
      return callback(child)
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
  }
}

export function messageEvent(type, text, { seq = 1, time = Date.now(), source = { kind: 'user' }, turn } = {}) {
  if (type === 'user/message') {
    return {
      type,
      seq,
      time,
      data: { role: 'user', id: `u${seq}`, content: [{ type: 'text', text }], source },
    }
  }
  return {
    type,
    seq,
    time,
    data: {
      turn: turn ?? 1,
      message: { role: 'assistant', id: `a${seq}`, content: [{ type: 'text', text }], source: { kind: 'model' } },
    },
  }
}

export function session(id = 'session-1', header = {}) {
  return { id, header: { id, cwd: process.cwd(), ...header } }
}

export function writeConfig(home, config) {
  const dir = join(home, 'fish-mind')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config) + '\n', 'utf8')
}

export function memoryHarness(ctx) {
  const sections = []
  const contexts = []
  const tools = new Map()
  const drop = (list, entry) => {
    const index = list.indexOf(entry)
    if (index >= 0) list.splice(index, 1)
  }
  ctx.set('systemPrompt', {
    section(entry) {
      sections.push(entry)
      return () => drop(sections, entry)
    },
    context(entry) {
      contexts.push(entry)
      return () => drop(contexts, entry)
    },
  })
  ctx.set('tools', {
    register(definition) {
      tools.set(definition.name, definition)
      return () => tools.delete(definition.name)
    },
  })
  // 提示与工具跟着代理会话挂：给一个 ctx 落在根 mock 上的主会话代理。
  ctx.set('agents', { list: () => [{ session: session('session-1'), ctx }] })
  return { sections, contexts, tools }
}

export function exec(name, args, sessionId = 'session-1') {
  return {
    name,
    arguments: args,
    agent: { session: { id: sessionId, header: { cwd: process.cwd() } } },
  }
}
