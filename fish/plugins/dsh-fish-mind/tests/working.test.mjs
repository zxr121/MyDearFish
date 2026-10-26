import test from 'node:test'
import assert from 'node:assert/strict'
import { extractionPrompt, factSentence, parseFacts, parseFactsDetailed, planConsolidation, shorttermText } from '../lib/working.js'

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

test('社交短期窗口说清这是 QQ 上的话，我那一句带“我：”', () => {
  const list = [
    { at: BASE, role: 'user', text: '群友甲：今天食堂好难吃' },
    { at: BASE + 1000, role: 'assistant', text: '确实，我也吃不下' },
    { at: BASE + 2000, role: 'user', text: '主人：晚上去吃火锅吧' },
  ]
  const text = shorttermText(list, { chars: 1200, social: true })
  assert.match(text, /【刚才在 QQ 上聊的·短期记忆】/)
  assert.ok(text.includes('群友甲：今天食堂好难吃'))
  assert.ok(text.includes('我：确实，我也吃不下'))
  assert.ok(text.includes('主人：晚上去吃火锅吧'))
  assert.ok(text.indexOf('群友甲') < text.indexOf('我：'), '仍按时间正序')
  assert.ok(!text.includes('主人：群友甲'), '不再套“主人”标签')
})

test('社交短期窗口里多个说话人各占一行，不把两个人的话揉成一句', () => {
  const list = [{ at: BASE, role: 'user', text: '主人：[图片]\n？！区区！？：[图片]' }]
  const text = shorttermText(list, { chars: 1200, social: true })
  const lines = text.split('\n').filter((line) => line.includes('：[图片]'))
  assert.equal(lines.length, 2)
  assert.ok(lines.some((line) => line.includes('主人：[图片]')))
  assert.ok(lines.some((line) => line.includes('？！区区！？：[图片]')))
  assert.ok(lines.every((line) => !line.includes('主人：[图片] ？！区区！？')))
})

test('提炼计划：不够条数不动，放凉和攒多都动', () => {
  const now = BASE + 60 * 60_000
  const idleMs = 20 * 60_000

  const few = planConsolidation(rows(1, now - 5 * 60_000), { now, idleMs, maxRows: 40, minRows: 2 })
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

test('只剩一条时安静够久也会送进提炼，不永远卡在水位后', () => {
  const idleMs = 20 * 60_000
  const single = rows(1, BASE)

  const fresh = planConsolidation(single, { now: BASE + idleMs, idleMs, minRows: 2 })
  assert.equal(fresh.ready, false, '普通放凉只等够 idleMs 时单条还不动')

  const quiet = planConsolidation(single, { now: BASE + idleMs * 3, idleMs, minRows: 2 })
  assert.equal(quiet.ready, true)
  assert.equal(quiet.reason, 'idle-single')
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

test('有经历 id 水位时按 id 认新行：时钟回拨和补录旧时间戳都漏不掉', () => {
  const now = BASE + 3 * 3_600_000
  const list = [
    { id: 11, at: BASE + 5_000, role: 'user', text: '水位之前的老话' },
    { id: 12, at: BASE - 10 * 60_000, role: 'user', text: '时钟回拨后录进来的话' },
    { id: 13, at: BASE + 6_000, role: 'assistant', text: '跟着回的一句' },
  ]
  const plan = planConsolidation(list, {
    now,
    lastConsolidatedAt: BASE + 5_000,
    lastConsolidatedId: 11,
    idleMs: 0,
    minRows: 1,
  })
  assert.equal(plan.ready, true)
  assert.deepEqual(plan.pending.map((row) => row.text), ['时钟回拨后录进来的话', '跟着回的一句'])
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

test('事实解析能救回被 maxTokens 截断的 JSON，并分清空数组和没写数组', () => {
  const truncated = '[{"subject":"主人","predicate":"昵称","object":"EMT"},{"subject":"主人","predicate":"喜欢","object":"鲸鱼娘"},{"subject":"主'
  assert.deepEqual(parseFacts(truncated, { max: 8 }).map((fact) => fact.predicate), ['昵称', '喜欢'])

  const empty = parseFactsDetailed('[]', { max: 8 })
  assert.equal(empty.ok, true, '空数组是模型明确说没有值得记的事')
  assert.deepEqual(empty.facts, [])

  const prose = parseFactsDetailed('我觉得这段没什么好记的。', { max: 8 })
  assert.equal(prose.ok, false, '没写数组要留着重试，不能当成“没什么”')
  assert.deepEqual(prose.facts, [])

  const cutInFirst = parseFactsDetailed('[{"subject":"主', { max: 8 })
  assert.equal(cutInFirst.ok, false)
})

test('事实写成一句她能直接说的话', () => {
  assert.equal(factSentence({ subject: '主人', predicate: '昵称', object: 'EMT' }), '主人的昵称是EMT')
})
