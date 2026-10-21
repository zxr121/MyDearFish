import test from 'node:test'
import assert from 'node:assert/strict'
import { extractionPrompt, factSentence, parseFacts, planConsolidation, shorttermText } from '../lib/working.js'

const BASE = 1_790_000_000_000

function rows(count, start = BASE) {
  return Array.from({ length: count }, (_, index) => ({
    at: start + index * 60_000,
    role: index % 2 === 0 ? 'user' : 'assistant',
    text: `第 ${index + 1} 句`,
  }))
}

test('短期窗口没有内容时整段不留', () => {
  assert.equal(shorttermText([]), '')
  assert.equal(shorttermText([{ at: BASE, role: 'user', text: '   ' }]), '')
})

test('短期窗口按时间正序，并在字数不够时先丢最旧的', () => {
  const list = [
    { at: BASE, role: 'user', text: '甲'.repeat(120) },
    { at: BASE + 1000, role: 'assistant', text: '乙'.repeat(120) },
    { at: BASE + 2000, role: 'user', text: '丙'.repeat(120) },
  ]
  const full = shorttermText(list, { chars: 1200 })
  assert.ok(full.indexOf('乙') < full.indexOf('丙'))
  assert.match(full, /【刚才在聊的·短期记忆】/)

  const tight = shorttermText(list, { chars: 400 })
  assert.ok(tight.includes('丙'))
  assert.ok(tight.includes('乙'))
  assert.ok(!tight.includes('甲'))
})

test('单条原文只留一小截，短期层不放逐字稿', () => {
  const long = '啊'.repeat(400)
  const text = shorttermText([{ at: BASE, role: 'user', text: long }])
  assert.ok(text.includes('…'))
  assert.ok(text.length < 400)
})

test('提炼计划：不够条数不动，放凉和攒多都动', () => {
  const now = BASE + 60 * 60_000
  const idleMs = 20 * 60_000

  const few = planConsolidation(rows(1, BASE), { now, idleMs, maxRows: 40, minRows: 2 })
  assert.equal(few.ready, false)
  assert.equal(few.reason, 'not-enough')

  const fresh = planConsolidation(rows(4, now - 60_000), { now, idleMs, maxRows: 40, minRows: 2 })
  assert.equal(fresh.ready, false)
  assert.equal(fresh.reason, 'fresh')

  const stale = planConsolidation(rows(4, BASE), { now, idleMs, maxRows: 40, minRows: 2 })
  assert.equal(stale.ready, true)
  assert.equal(stale.reason, 'idle')

  const many = planConsolidation(rows(40, now - 60_000), { now, idleMs, maxRows: 40, minRows: 2 })
  assert.equal(many.ready, true)
  assert.equal(many.reason, 'overflow')
})

test('提炼计划只看过水位之后的内容', () => {
  const now = BASE + 3 * 3_600_000
  const list = rows(10, BASE)
  const last = list[list.length - 1].at
  const seen = planConsolidation(list, { now, lastConsolidatedAt: last, idleMs: 0, minRows: 1 })
  assert.equal(seen.ready, false)
  assert.equal(seen.pending.length, 0)

  const fresh = planConsolidation([...list, { at: now - 1000, role: 'user', text: '新的' }], {
    now,
    lastConsolidatedAt: last,
    idleMs: 0,
    minRows: 1,
  })
  assert.equal(fresh.ready, true)
  assert.equal(fresh.pending.length, 1)
})

test('提炼提示带上已记住的事实和对话原文', () => {
  const prompt = extractionPrompt(rows(2, BASE), {
    knownFacts: [{ subject: '主人', predicate: '昵称', object: 'EMT' }],
  })
  assert.match(prompt.system, /只输出 JSON 数组/)
  assert.match(prompt.system, /别把主人的名字写成大肥鱼的称呼/)
  assert.ok(prompt.user.includes('主人 · 昵称 · EMT'))
  assert.ok(prompt.user.includes('第 1 句'))
})

test('事实解析容错：代码围栏、坏条目、可信度越界都能收住', () => {
  const wrapped = '```json\n[\n{"subject":"主人","predicate":"昵称","object":"EMT","confidence":1.8},\n{"subject":"","predicate":"x","object":"y"},\n"跳过我"\n]\n```'
  const facts = parseFacts(wrapped, { max: 8 })
  assert.equal(facts.length, 1)
  assert.equal(facts[0].object, 'EMT')
  assert.equal(facts[0].confidence, 0.95)

  assert.deepEqual(parseFacts('我没想到什么', { max: 8 }), [])
  assert.deepEqual(parseFacts('[{"subject":"a","predicate":"b","object":"c"},[]]', { max: 8 }), [
    { subject: 'a', predicate: 'b', object: 'c', confidence: 0.7 },
  ])

  const many = parseFacts(JSON.stringify(Array.from({ length: 20 }, () => ({ subject: 'a', predicate: 'b', object: 'c' }))), { max: 3 })
  assert.equal(many.length, 3)
})

test('事实写成一句她能直接说的话', () => {
  assert.equal(factSentence({ subject: '主人', predicate: '昵称', object: 'EMT' }), '主人的昵称是EMT')
})
