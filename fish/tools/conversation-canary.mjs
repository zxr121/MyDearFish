#!/usr/bin/env node
// 真模型行为金丝雀：固定 8 条客观上要求说完整的主人消息，把当前提示词和仓库里冻结的
// known-good 静态提示词各跑一遍，比中位字数、开头重复率和线索命中。
//
// 这是夜间/手动检查，不进 test:fish 的硬门禁：模型抖动不该卡发布。
// 跑法：
//   node fish/tools/conversation-canary.mjs                # 两轮成对比较，两轮都明显变短才失败
//   node fish/tools/conversation-canary.mjs --dry-run      # 不调模型，只看组装出来的提示
//   node fish/tools/conversation-canary.mjs --freeze       # 提示词有意改动后刷新 known-good
//   node fish/tools/conversation-canary.mjs --rounds 1     # 快速跑一轮
// 需要 DEEPSEEK_API_KEY；没有 key 时明确打印“跳过”，退出码 2，不算通过。
// 可选：DEEPSEEK_BASE_URL、FISH_CANARY_MODEL（默认 deepseek-flash）、
//       FISH_CANARY_MAX_TOKENS（预算，默认 400000，对应单次远低于 ¥1）、FISH_CANARY_THINKING=1 打开推理。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const 冻结路径 = join(REPO, 'fish', 'tools', 'expected', 'canary-known-good.json')
const 真实fetch = globalThis.fetch
const 模型 = process.env.FISH_CANARY_MODEL || 'deepseek-flash'
const 接口根 = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/anthropic').replace(/\/+$/, '')
const 接口 = /\/v1$/u.test(接口根) ? `${接口根}/messages` : `${接口根}/v1/messages`
const 最大词元 = Math.max(20_000, Number(process.env.FISH_CANARY_MAX_TOKENS) || 400_000)
const 开推理 = process.env.FISH_CANARY_THINKING === '1'

const 参数 = { dryRun: false, freeze: false, rounds: 2 }
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (a === '--dry-run') 参数.dryRun = true
  else if (a === '--freeze') 参数.freeze = true
  else if (a === '--rounds') 参数.rounds = Math.min(3, Math.max(1, Number(process.argv[++i]) || 2))
  else if (a === '-h' || a === '--help') {
    console.log('用法：node fish/tools/conversation-canary.mjs [--dry-run|--freeze] [--rounds 1|2|3]')
    process.exit(0)
  } else {
    console.error(`不认识的参数：${a}`)
    process.exit(2)
  }
}

// 固定消息：每条都客观上要求说完整，不能拿“嗯”“确实”糊过去。
// clue 是这条里必须被接住的具体细节，用来量她有没有真的看人说话。
const 消息们 = [
  {
    文: '今天开会我把客户名字叫错了，旁边同事还笑了一声，我当时脸一下就热了。你帮我看看这事该怎么收场，别只安慰我。',
    线索: '',
  },
  {
    文: '我最近总是睡不好，躺下就开始想明天的活，越躺越清醒。你陪我理一理，我该怎么把睡觉这事调回来？',
    线索: '',
  },
  {
    文: '帮我给房东发一段话：热水器坏了，维修师傅要后天才能来，我想晚两天交这个月房租。语气客气一点，别显得我在找借口。',
    线索: '热水器',
  },
  {
    文: '我的猫团子上周走了。你先别急着安慰我，我就想有人听我说完它最后那几天是怎么过的。',
    线索: '团子',
  },
  {
    文: '如果我明天想开始跑步，你帮我排一个前三周的计划。我膝盖以前跑伤过，医生让我别跑太久。',
    线索: '膝盖',
  },
  {
    文: '你觉得人为什么会在乎别人怎么看自己？我最近老在想这个，想听你认真说说你的看法。',
    线索: '',
  },
  {
    文: '把今天下午的经过帮我记一下：我先去医院拿报告，然后绕去菜市场买了鱼，回来发现钥匙忘在办公室了。',
    线索: '',
  },
  {
    文: '如果你只能记住我们之间的一件事，你会记哪件？说说为什么是那件。',
    线索: '',
  },
]

const 动态段 = new Set(['fish-mind-shortterm', 'fish-mind-inner', 'fish-mind-budget', 'fish-mind-humor', 'fish-mind-tendency'])
const 图片 = process.stdout.isTTY ? '🐟' : ''

function 说(文 = '') {
  console.log(图片 ? `${图片} ${文}` : 文)
}

function 字数(文) {
  return Array.from(String(文 || '').replace(/\s+/gu, '')).length
}

function 中位(数们) {
  const 排 = [...数们].sort((a, b) => a - b)
  if (排.length === 0) return 0
  const 中 = Math.floor(排.length / 2)
  return 排.length % 2 === 1 ? 排[中] : (排[中 - 1] + 排[中]) / 2
}

function 开头(文) {
  return Array.from(String(文 || '').replace(/[\s\p{P}\p{S}]/gu, '')).slice(0, 6).join('')
}

function 重复率(回复们) {
  const 计 = new Map()
  for (const 文 of 回复们) {
    const 头 = 开头(文)
    if (头 === '') continue
    计.set(头, (计.get(头) || 0) + 1)
  }
  const 最多 = Math.max(0, ...计.values())
  return 回复们.length === 0 ? 0 : 最多 / 回复们.length
}

async function 造提示(home) {
  const { createComposedHarness, matureOwnerPerson, readPersonaPrefix } = await import(
    new URL('../tests/harness/composed.mjs', import.meta.url).href
  )
  const now = Date.now()
  const person = matureOwnerPerson({ at: now })
  const harness = await createComposedHarness({
    home,
    people: { 837263217: person },
  })
  // 先放两条真正发生过的事：后面两条消息会问膝盖和团子，看她接不接得住。
  harness.mind.observe({
    at: now - 30 * 60_000,
    sessionId: 'session-desktop',
    kind: 'user',
    role: 'user',
    actor: 'owner',
    source: 'user',
    text: '我膝盖以前跑步跑伤过，医生让我别跑太久',
  })
  harness.mind.observe({
    at: now - 45 * 60_000,
    sessionId: 'session-desktop',
    kind: 'user',
    role: 'user',
    actor: 'owner',
    source: 'user',
    text: '我的猫叫团子，是三年前从楼下捡回来的',
  })
  const persona = readPersonaPrefix()
  const 当前风格 = harness.qqBridge.拼风格贴合(person.风格, {
    名: '主人',
    阶段: '老友',
    张力: 0,
    主人: true,
    群: false,
  })
  const 段们 = harness.surface('session-desktop')
  return { harness, persona, 当前风格, 段们, now }
}

function 拆静态(段们) {
  return 段们
    .filter((段) => !动态段.has(段.name))
    .filter((段) => String(段.text || '').trim() !== '')
    .map((段) => ({ name: 段.name, order: 段.order || 0, text: String(段.text).trim() }))
}

function 拼系统(persona, 静态段们, 动态段们) {
  const 全部 = [...静态段们, ...动态段们]
    .filter((段) => String(段.text || '').trim() !== '')
    .sort((a, b) => (a.order || 0) - (b.order || 0))
  return [String(persona || '').trim(), ...全部.map((段) => String(段.text).trim())]
    .filter(Boolean)
    .join('\n\n')
}

function 读冻结() {
  if (!existsSync(冻结路径)) {
    console.error(`缺少 known-good 提示词：${冻结路径}\n先跑一次 node fish/tools/conversation-canary.mjs --freeze`)
    process.exit(1)
  }
  return JSON.parse(readFileSync(冻结路径, 'utf8'))
}

async function 冻结({ persona, 当前风格, 段们 }) {
  const 静态 = 拆静态(段们)
  const 内容 = {
    createdAt: new Date().toISOString().slice(0, 10),
    note: '2026-10 回复退化的修复版：主人不收教句长/拆短/连发，提示必须带“把想说的说完整”。提示词有意改动后手动刷新，别在普通跑里自动覆盖。',
    model: 模型,
    persona,
    staticComponents: 静态,
    ownerHint: 当前风格,
    messageCount: 消息们.length,
  }
  mkdirSync(dirname(冻结路径), { recursive: true })
  writeFileSync(冻结路径, `${JSON.stringify(内容, null, 2)}\n`, 'utf8')
  说(`已冻结 known-good：${冻结路径}`)
  说(`静态提示段 ${静态.length} 个 · 人设 ${persona.text.length} 字 · 风格贴合 ${当前风格.length} 字`)
}

class 预算爆了 extends Error {}

let 已用词元 = 0

async function 模型一次({ system, user, 带推理 = 开推理 }) {
  const 体 = {
    model: 模型,
    max_tokens: 800,
    temperature: 0.4,
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
    ...(带推理 ? { thinking: { type: 'enabled', budget_tokens: 1024 } } : {}),
  }
  let 最后错误 = null
  for (let 次 = 1; 次 <= 2; 次++) {
    const 控 = new AbortController()
    const 计时 = setTimeout(() => 控.abort(new Error('模型请求超时')), 120_000)
    try {
      const 回 = await 真实fetch(接口, {
        method: 'POST',
        signal: 控.signal,
        headers: {
          'content-type': 'application/json',
          'accept': 'application/json',
          'x-api-key': process.env.DEEPSEEK_API_KEY,
          'anthropic-version': '2023-06-01',
          authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify(体),
      })
      const 文 = await 回.text()
      if (!回.ok) {
        // 推理参数不被接受时退回普通请求，别让 canary 因为接口差异整轮失败。
        if (回.status === 400 && 带推理 && /thinking|budget_tokens|reasoning/iu.test(文)) {
          return 模型一次({ system, user, 带推理: false })
        }
        throw new Error(`HTTP ${回.status}：${文.slice(0, 300)}`)
      }
      const 解 = JSON.parse(文)
      const 块们 = Array.isArray(解.content) ? 解.content : []
      const 正文 = 块们.filter((块) => 块 && 块.type === 'text').map((块) => String(块.text || '')).join('').trim()
      const 推理 = 块们
        .filter((块) => 块 && (块.type === 'thinking' || 块.type === 'reasoning'))
        .map((块) => String(块.thinking || 块.text || ''))
        .join('')
      const 用量 = 解.usage || {}
      const 本次 = Number(用量.input_tokens || 0) + Number(用量.output_tokens || 0)
      已用词元 += 本次
      if (已用词元 > 最大词元) throw new 预算爆了(`本轮累计 ${已用词元} 词元，超过上限 ${最大词元}`)
      if (正文 === '') throw new Error('模型回了空正文')
      return { 正文, 推理字数: 字数(推理), 词元: 本次 }
    } catch (错误) {
      if (错误 instanceof 预算爆了) throw 错误
      最后错误 = 错误
      if (次 < 2) await new Promise((r) => setTimeout(r, 1500 * 次))
    } finally {
      clearTimeout(计时)
    }
  }
  throw 最后错误 || new Error('模型请求失败')
}

async function 跑一组({ 名, 冻结样, 当前 }) {
  const { harness, persona, 当前风格, 段们 } = 当前
  const 静态 = 名 === '当前' ? 拆静态(段们) : 冻结样.staticComponents
  const 人设 = 名 === '当前' ? persona : 冻结样.persona
  const 贴合 = 名 === '当前' ? 当前风格 : 冻结样.ownerHint
  const 回复们 = []
  for (let i = 0; i < 消息们.length; i++) {
    const 消息 = 消息们[i]
    const 最新段们 = harness.surface('session-desktop')
    const 动态 = 最新段们.filter((段) => 动态段.has(段.name))
    const system = 拼系统(人设 && 人设.text !== undefined ? 人设.text : 人设, 静态, 动态)
    const user = [消息.文, 贴合].filter(Boolean).join('\n\n')
    const 回 = await 模型一次({ system, user })
    回复们.push({ ...消息, 回复: 回.正文, 推理字数: 回.推理字数 })
    // 把她这轮说的话写回桌面短期窗口；下一轮她能看到自己刚才怎么回的。
    await harness.emit('session-desktop', {
      type: 'user/message',
      seq: i * 2 + 1,
      time: Date.now(),
      data: { role: 'user', id: `canary-u${i}`, content: [{ type: 'text', text: 消息.文 }], source: { kind: 'user' } },
    })
    await harness.emit('session-desktop', {
      type: 'assistant/message',
      seq: i * 2 + 2,
      time: Date.now(),
      data: {
        turn: i + 1,
        message: { role: 'assistant', id: `canary-a${i}`, content: [{ type: 'text', text: 回.正文 }], source: { kind: 'model' } },
      },
    })
  }
  return 回复们
}

function 汇总(回复们) {
  const 长们 = 回复们.map((条) => 字数(条.回复))
  const 有线索 = 回复们.filter((条) => 条.线索 !== '')
  const 命中 = 有线索.filter((条) => 条.回复.includes(条.线索)).length
  return {
    中位: 中位(长们),
    平均: 长们.reduce((a, b) => a + b, 0) / Math.max(1, 长们.length),
    重复率: 重复率(回复们.map((条) => 条.回复)),
    线索: `${命中}/${有线索.length}`,
    推理中位: 中位(回复们.map((条) => 条.推理字数 || 0)),
  }
}

async function 一轮(轮号) {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const 冻结样 = 读冻结()
  // 两组各用一份独立的宿主和同一份种子，避免对话历史互相污染。
  const 当前 = await 造提示(mkdtempSync(join(tmpdir(), `fish-canary-current-${轮号}-`)))
  const 对照 = await 造提示(mkdtempSync(join(tmpdir(), `fish-canary-control-${轮号}-`)))
  try {
    const 当前回 = await 跑一组({ 名: '当前', 冻结样, 当前 })
    const 对照回 = await 跑一组({ 名: '对照', 冻结样, 当前: 对照 })
    const 甲 = 汇总(当前回)
    const 乙 = 汇总(对照回)
    const 偏低 = 甲.中位 < 乙.中位 * 0.5 && 甲.中位 < 60
    说(`第 ${轮号} 轮：当前中位 ${甲.中位} 字 / 对照 ${乙.中位} 字 · 平均 ${甲.平均.toFixed(1)} / ${乙.平均.toFixed(1)} · 重复开头 ${(甲.重复率 * 100).toFixed(0)}% / ${(乙.重复率 * 100).toFixed(0)}% · 线索 ${甲.线索} / ${乙.线索} · 推理中位 ${甲.推理中位} / ${乙.推理中位}`)
    if (偏低) 说(`第 ${轮号} 轮判定：当前明显变短（不到对照一半，且中位低于 60 字）`)
    return { 偏低, 甲, 乙, 当前回, 对照回 }
  } finally {
    对照.harness.dispose()
    当前.harness.dispose()
  }
}

async function 主流程() {
  说(`大肥鱼真模型金丝雀 · ${模型} · ${消息们.length} 条 × ${参数.rounds} 轮 × 2 组 · 预算 ${最大词元} 词元`)
  if (参数.freeze) {
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const 当前 = await 造提示(mkdtempSync(join(tmpdir(), 'fish-canary-freeze-')))
    try {
      await 冻结(当前)
    } finally {
      当前.harness.dispose()
    }
    return
  }
  if (参数.dryRun) {
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const 当前 = await 造提示(mkdtempSync(join(tmpdir(), 'fish-canary-dry-')))
    try {
      const 冻结样 = existsSync(冻结路径) ? 读冻结() : null
      const 最新段们 = 当前.harness.surface('session-desktop')
      const 动态 = 最新段们.filter((段) => 动态段.has(段.name))
      const 当前系统 = 拼系统(当前.persona.text, 拆静态(最新段们), 动态)
      const 对照系统 = 冻结样 ? 拼系统(冻结样.persona.text, 冻结样.staticComponents, 动态) : ''
      说(`当前提示 ${当前系统.length} 字 · 静态段 ${拆静态(最新段们).length} 个 · 风格贴合 ${当前.当前风格.length} 字`)
      if (对照系统) 说(`对照提示 ${对照系统.length} 字 · 静态段 ${冻结样.staticComponents.length} 个 · 风格贴合 ${冻结样.ownerHint.length} 字`)
      else 说('还没有 known-good；先跑 --freeze')
      说(`第一条用户消息：${消息们[0].文}`)
      if (当前.当前风格) 说(`当前贴合提示：${当前.当前风格}`)
      if (冻结样?.ownerHint && 冻结样.ownerHint !== 当前.当前风格) 说(`对照贴合提示：${冻结样.ownerHint}`)
      return
    } finally {
      当前.harness.dispose()
    }
  }
  const 果们 = []
  for (let 轮 = 1; 轮 <= 参数.rounds; 轮++) {
    果们.push(await 一轮(轮))
  }
  const 连续偏低 = 果们.length >= 2 && 果们.slice(-2).every((果) => 果.偏低)
  const 任一轮偏低 = 果们.some((果) => 果.偏低)
  if (连续偏低) {
    console.error(`\n连续 ${Math.min(2, 果们.length)} 轮明显变短：先查最近的提示词/记忆窗口/风格贴合改动，再决定是否发布 ❌`)
    process.exit(1)
  }
  if (任一轮偏低) {
    说(`\n有一轮偏低，但还没连续：先观察，别急着发布`)
    process.exit(0)
  }
  说(`\n金丝雀通过（消耗约 ${已用词元} 词元）✅`)
}

if (!参数.dryRun && !参数.freeze && !process.env.DEEPSEEK_API_KEY) {
  console.error('没有 DEEPSEEK_API_KEY：跳过真模型金丝雀（这不是通过）。')
  process.exit(2)
}

主流程().catch((错误) => {
  console.error(`金丝雀没跑完：${错误?.stack || String(错误)}`)
  process.exit(1)
})
