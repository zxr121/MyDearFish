// 房间隔离矩阵：谁在哪个会话里，能看到哪些屋子的短期原话。
// 2026-10 的回复退化里，QQ 群/私聊房里她自己的回复（assistant 行的 source=model）
// 被当成“我：……”灌进主人窗口；只按 source 过滤挡不住，必须按会话屋子隔离。
// 这张矩阵断言到 shortTermPrompt（模型真正看到的那段话），而不是只测 recentWindow。

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { fakeContext, memoryHarness, messageEvent, session, writeConfig } from './harness.mjs'

const NOW = Date.now()

/** 每种来源在矩阵里的去向；新来源必须在这里登记，否则下面的守卫用例会红。 */
const DECLARED_SOURCES = new Set(['user', 'qq', 'qq-group', 'qq-friend', 'speak-up', 'bili-duty-scan'])

const DESKTOP_FAMILY = [
  '桌面主会话原话', '桌面主会话回复',
  '桌面分会话原话', '桌面分会话回复',
  '自定义房原话', '自定义房回复',
  'B站巡检提示', 'B站巡检回复',
]

const QQ_ROOMS = [
  '群七号原话', '群七号回复',
  '群八号原话', '群八号回复',
  '好友四号原话', '好友四号回复',
  '好友五号原话', '好友五号回复',
  '主人私聊原话', '主人私聊回复',
  '别人私聊原话', '别人私聊回复',
  '群七号重置原话', '群七号重置回复',
]

const NEVER = ['主动开口提示', '宿主注入的上下文', '很久以前的海边']

const VIEWERS = [
  {
    name: '主人桌面',
    id: 'session-desktop',
    sees: DESKTOP_FAMILY.filter((item) => item !== '桌面主会话原话' && item !== '桌面主会话回复'),
  },
  {
    name: '另一个桌面会话',
    id: 'session-other-desktop',
    sees: DESKTOP_FAMILY.filter((item) => item !== '桌面分会话原话' && item !== '桌面分会话回复'),
  },
  {
    name: '自定义目标会话',
    id: 'session-custom-room',
    sees: DESKTOP_FAMILY.filter((item) => item !== '自定义房原话' && item !== '自定义房回复'),
  },
  {
    name: '群七',
    id: 'session-qq-social-group-7',
    sees: ['群七号原话', '群七号回复'],
  },
  {
    name: '群七的分线',
    id: 'session-qq-social-group-7-p2',
    sees: ['群七号原话', '群七号回复'],
  },
  {
    name: '重置后的群七',
    id: 'session-qq-social-group-7-rmvkmde7w',
    sees: ['群七号重置原话', '群七号重置回复'],
  },
  {
    name: '重置后群七的分线',
    id: 'session-qq-social-group-7-rmvkmde7w-p3',
    sees: ['群七号重置原话', '群七号重置回复'],
  },
  {
    name: '群八',
    id: 'session-qq-social-group-8',
    sees: ['群八号原话', '群八号回复'],
  },
  {
    name: '好友四',
    id: 'session-qq-social-friend-3004',
    sees: ['好友四号原话', '好友四号回复'],
  },
  {
    name: '主人私聊房',
    id: 'session-qq-private-837263217',
    sees: DESKTOP_FAMILY,
  },
  {
    name: '旧式私聊房 id',
    id: 'qq-private-999',
    sees: DESKTOP_FAMILY,
  },
]

const SEEDS = [
  // 桌面家族：主人桌面、另一个桌面、自定义目标会话、B 站巡检。
  { sid: 'session-desktop', role: 'user', text: '桌面主会话原话', source: { kind: 'user' } },
  { sid: 'session-desktop', role: 'assistant', text: '桌面主会话回复' },
  { sid: 'session-other-desktop', role: 'user', text: '桌面分会话原话', source: { kind: 'user' } },
  { sid: 'session-other-desktop', role: 'assistant', text: '桌面分会话回复' },
  { sid: 'session-custom-room', role: 'user', text: '自定义房原话', source: { kind: 'user' } },
  { sid: 'session-custom-room', role: 'assistant', text: '自定义房回复' },
  { sid: 'session-bili', role: 'user', text: 'B站巡检提示', source: { kind: 'bili-duty-scan' } },
  { sid: 'session-bili', role: 'assistant', text: 'B站巡检回复' },
  // QQ 房间：群七、群八、好友四、好友五、主人私聊、别人的私聊、重置后的群七。
  { sid: 'session-qq-social-group-7', role: 'user', text: '群七号原话', source: { kind: 'qq-group', excerpt: '群七号原话' } },
  { sid: 'session-qq-social-group-7', role: 'assistant', text: '群七号回复' },
  { sid: 'session-qq-social-group-8', role: 'user', text: '群八号原话', source: { kind: 'qq-group', excerpt: '群八号原话' } },
  { sid: 'session-qq-social-group-8', role: 'assistant', text: '群八号回复' },
  { sid: 'session-qq-social-friend-3004', role: 'user', text: '好友四号原话', source: { kind: 'qq-friend', excerpt: '好友四号原话' } },
  { sid: 'session-qq-social-friend-3004', role: 'assistant', text: '好友四号回复' },
  { sid: 'session-qq-social-friend-3005', role: 'user', text: '好友五号原话', source: { kind: 'qq-friend', excerpt: '好友五号原话' } },
  { sid: 'session-qq-social-friend-3005', role: 'assistant', text: '好友五号回复' },
  { sid: 'session-qq-private-837263217', role: 'user', text: '主人私聊原话', source: { kind: 'qq', excerpt: '主人私聊原话' } },
  { sid: 'session-qq-private-837263217', role: 'assistant', text: '主人私聊回复' },
  { sid: 'session-qq-private-999', role: 'user', text: '别人私聊原话', source: { kind: 'qq', excerpt: '别人私聊原话' } },
  { sid: 'session-qq-private-999', role: 'assistant', text: '别人私聊回复' },
  { sid: 'session-qq-social-group-7-rmvkmde7w', role: 'user', text: '群七号重置原话', source: { kind: 'qq-group', excerpt: '群七号重置原话' } },
  { sid: 'session-qq-social-group-7-rmvkmde7w', role: 'assistant', text: '群七号重置回复' },
  // 脚手架和宿主上下文：主动搭话的提示只落成旁注，不进任何窗口；runtime-context 根本不入库。
  { sid: 'session-desktop', role: 'user', text: '主动开口提示', source: { kind: 'speak-up' } },
  { sid: 'session-desktop', role: 'user', text: '宿主注入的上下文', source: { kind: 'runtime-context' } },
  // 过了 TTL 的话不该再当场想起。
  { sid: 'session-other-desktop', role: 'user', text: '很久以前的海边', source: { kind: 'user' }, ageMs: 3 * 3_600_000 },
]

function buildHarness() {
  const home = mkdtempSync(join(tmpdir(), 'fish-mind-rooms-'))
  process.env.DSH_HOME = home
  writeConfig(home, {
    mode: 'live',
    inject: true,
    working: { ttlMinutes: 60, rows: 200, inject: true, chars: 20_000 },
  })
  const ctx = fakeContext()
  const harness = memoryHarness(ctx)
  apply(ctx)
  const mind = ctx.get('fishMind')
  const shortTerm = harness.contexts.find((entry) => entry.name === 'fish-mind-shortterm')
  assert.ok(shortTerm, '短期窗口提示段没有挂上')
  return { home, ctx, mind, shortTerm }
}

async function seed(ctx) {
  let seq = 1
  for (const row of SEEDS) {
    const at = NOW - 5 * 60_000 + seq * 1000 - (row.ageMs || 0)
    await ctx.emit('session/event', session(row.sid), messageEvent(
      row.role === 'assistant' ? 'assistant/message' : 'user/message',
      row.text,
      {
        seq,
        time: at,
        ...(row.role === 'assistant' ? {} : { source: row.source || { kind: 'user' } }),
      },
    ))
    seq += 1
  }
}

function promptFor(shortTerm, sessionId) {
  return shortTerm.text({ agent: { session: session(sessionId) } })
}

test('房间隔离矩阵：每个视角只看得到自己这间屋和允许共享的桌面主会话原话', async () => {
  const { ctx, mind, shortTerm } = buildHarness()
  try {
    await seed(ctx)
    for (const viewer of VIEWERS) {
      const text = promptFor(shortTerm, viewer.id)
      for (const marker of viewer.sees) {
        assert.ok(text.includes(marker), `${viewer.name}（${viewer.id}）应该看到「${marker}」，实际：\n${text}`)
      }
      const forbidden = [...DESKTOP_FAMILY, ...QQ_ROOMS].filter((marker) => !viewer.sees.includes(marker))
      for (const marker of forbidden) {
        assert.ok(!text.includes(marker), `${viewer.name}（${viewer.id}）不该看到「${marker}」，实际：\n${text}`)
      }
      for (const marker of NEVER) {
        assert.ok(!text.includes(marker), `${viewer.name}（${viewer.id}）不该看到「${marker}」`)
      }
    }

    // 入库侧：宿主注入的 runtime-context 不算经历。
    assert.ok(!mind.recentWindow({ rows: 200 }).some((row) => row.text === '宿主注入的上下文'))
  } finally {
    ctx.dispose()
  }
})

test('群里只有她自己的回复时，主人短期窗口一个字都不给', async () => {
  const home = mkdtempSync(join(tmpdir(), 'fish-mind-rooms-alone-'))
  process.env.DSH_HOME = home
  writeConfig(home, { mode: 'live', inject: true, working: { ttlMinutes: 60, rows: 50 } })
  const ctx = fakeContext()
  const harness = memoryHarness(ctx)
  apply(ctx)
  try {
    const at = NOW - 60_000
    await ctx.emit('session/event', session('session-qq-social-group-7-rmvkmde7w'), messageEvent(
      'assistant/message',
      '好呀',
      { seq: 1, time: at },
    ))
    await ctx.emit('session/event', session('session-qq-private-837263217'), messageEvent(
      'assistant/message',
      '在呢',
      { seq: 2, time: at + 1000 },
    ))
    const shortTerm = harness.contexts.find((entry) => entry.name === 'fish-mind-shortterm')
    assert.equal(promptFor(shortTerm, 'session-desktop'), '', '主人窗口不能是一墙 QQ 房间的“我：”')
    assert.equal(promptFor(shortTerm, 'session-qq-social-group-8'), '', '另一间群也不该看到群七的独白')
  } finally {
    ctx.dispose()
  }
})

test('QQ 摘录只记真正说的话，内部提示、公告和收藏清单都不入库', async () => {
  const home = mkdtempSync(join(tmpdir(), 'fish-mind-excerpt-'))
  process.env.DSH_HOME = home
  writeConfig(home, { mode: 'live', inject: true })
  const ctx = fakeContext()
  apply(ctx)
  const mind = ctx.get('fishMind')
  try {
    let seq = 1
    const emit = (sessionId, text, source) => ctx.emit('session/event', session(sessionId), messageEvent(
      'user/message',
      text,
      { seq: seq++, time: NOW - 60_000 + seq * 1000, source },
    ))
    await emit(
      'session-qq-private-837263217',
      '【说话节奏·内部提示，不是对方说的话，别复述】句子短一点，几个字就停\n今晚吃火锅',
      { kind: 'qq', excerpt: '今晚吃火锅' },
    )
    await emit(
      'session-qq-social-group-7',
      '【最近聊过】群公告：周末团建\n群友甲：今天食堂好难吃',
      { kind: 'qq-group', excerpt: '今天食堂好难吃', sender: '群友甲', group: '7' },
    )
    await emit(
      'session-qq-social-friend-3004',
      '【好友画像】喜欢猫\n在吗',
      { kind: 'qq-friend', excerpt: '在吗', sender: '好友四' },
    )
    await emit(
      'session-qq-private-837263217',
      '旧桥没有摘录，今天风大',
      { kind: 'qq' },
    )

    const rows = mind.recentWindow({ rows: 100 })
    const texts = rows.map((row) => row.text)
    assert.ok(texts.includes('今晚吃火锅'), '私聊只留主人真正说的话')
    assert.ok(texts.includes('今天食堂好难吃'), '群聊只留群友真正说的话')
    assert.ok(texts.includes('在吗'), '好友私聊只留好友真正说的话')
    assert.ok(texts.includes('旧桥没有摘录，今天风大'), '旧桥没有摘录时仍退回全文')
    for (const dirty of ['说话节奏', '几个字就停', '【最近聊过】', '群公告', '【好友画像】']) {
      assert.ok(!texts.some((text) => text.includes(dirty)), `摘录以外不应入库：${dirty}`)
    }
  } finally {
    ctx.dispose()
  }
})

test('classifyUserSource 新增来源时必须先在矩阵里登记去向', () => {
  const source = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  const start = source.indexOf('function classifyUserSource')
  assert.ok(start >= 0, '找不到 classifyUserSource')
  const end = source.indexOf('\n}', start)
  const body = source.slice(start, end)
  const kinds = new Set([...body.matchAll(/if \(kind === '([^']+)'\)/g)].map((match) => match[1]))
  for (const kind of kinds) {
    assert.ok(DECLARED_SOURCES.has(kind), `来源「${kind}」还没在房间隔离矩阵里决定去向，先补 DECLARED_SOURCES 和 VIEWERS 的预期`)
  }
  for (const kind of DECLARED_SOURCES) {
    assert.ok(kinds.has(kind), `矩阵登记了「${kind}」，但 classifyUserSource 已经不认它，删掉过期登记`)
  }
})
