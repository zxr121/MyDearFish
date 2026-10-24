import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  affectIntensity,
  computeDrives,
  computeInnerLife,
  confidePrompt,
  createInnerLife,
  innerPrompt,
  selectCue,
  summarizeAffect,
} from '../lib/inner-life.js'
import { openStore } from '../lib/store.js'

const HOUR = 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 23, 12, 0, 0)

function chargedAffect(at = NOW - HOUR, overrides = {}) {
  return {
    id: 1,
    at,
    text: '今天有点难过，想跟主人说说海边的事',
    meta: { mood: 42, moodDelta: -5, dims: { sad: 70 }, dimsDelta: { sad: 6 } },
    salience: 0.8,
    ...overrides,
  }
}

function calmSignals(now = NOW) {
  return {
    lastSocialAt: now - HOUR,
    lastOwnerAt: now - HOUR,
    lastOwnerReplyAt: now - HOUR,
    lastBiliAt: now,
    biliRecent: 5,
    affects: [],
    cues: [],
  }
}

test('心情强度把心情变化和七维变化合成到 0 到 1', () => {
  assert.equal(affectIntensity({ moodDelta: 6 }), 0.55)
  assert.equal(affectIntensity({ dimsDelta: { happy: 10, sad: 8, worry: 10 } }), 0.45)
  assert.equal(affectIntensity({}), 0)
  assert.equal(affectIntensity(null), 0)
  assert.equal(affectIntensity('{"moodDelta":-3}'), 0.275)
})

test('最近的强烈心情归到最明显的一支，过期和空心情回到安静', () => {
  const strong = summarizeAffect([chargedAffect()], NOW)
  assert.equal(strong.family, 'sorrow')
  assert.equal(strong.phrase, '心里有点沉')
  assert.ok(strong.pressure > 0.3)
  assert.ok(strong.negative > 0)

  const expired = summarizeAffect([chargedAffect(NOW - 80 * HOUR)], NOW)
  assert.equal(expired.family, 'calm')
  assert.equal(expired.pressure, 0)

  const empty = summarizeAffect([], NOW)
  assert.equal(empty.family, 'calm')
  assert.equal(empty.pressure, 0)
  assert.equal(empty.mood, 70)
})

test('没有七维证据时，单靠词面命中不硬贴七情标签', () => {
  const wordsOnly = summarizeAffect([
    { id: 1, at: NOW - HOUR, text: '好难过呀', meta: { mood: 70, dims: {}, dimsDelta: {} }, salience: 0.5 },
  ], NOW)
  assert.equal(wordsOnly.family, 'calm')

  const withDims = summarizeAffect([
    { id: 1, at: NOW - HOUR, text: '好难过呀', meta: { mood: 40, dims: { sad: 70 }, dimsDelta: { sad: 6 } }, salience: 0.5 },
  ], NOW)
  assert.equal(withDims.family, 'sorrow')
})

test('久没联系会抬高亲近和表达，新鲜 B 站经历会压低好奇', () => {
  const lonely = computeDrives(
    { lastSocialAt: 0, lastOwnerAt: 0, lastOwnerReplyAt: 0, lastBiliAt: 0, biliRecent: 0 },
    summarizeAffect([chargedAffect()], NOW),
    NOW,
  )
  assert.ok(lonely.ownerGap > 0.95)
  assert.ok(lonely.intimacy > 0.6)
  assert.ok(lonely.curiosity > 0.7)
  assert.equal(lonely.novelty, 0)

  const fresh = computeDrives(calmSignals(), summarizeAffect([], NOW), NOW)
  assert.ok(fresh.ownerGap < 0.1)
  assert.equal(fresh.novelty, 1)
  assert.ok(fresh.curiosity < 0.3)
  assert.ok(fresh.intimacy < 0.3)
})

test('由头只从近三天、够长、没讲过的经历里挑', () => {
  const cues = [
    { id: 1, at: NOW - 2 * HOUR, text: '今天在 B 站看见一只会开门的猫', kind: 'bili', source: 'bili', salience: 0.8 },
    { id: 2, at: NOW - 3 * HOUR, text: '主人昨天说面试有点紧张', kind: 'user', source: 'user', salience: 0.7 },
    { id: 3, at: NOW - 4 * HOUR, text: '短', kind: 'user', source: 'user', salience: 1 },
    { id: 4, at: NOW - 90 * HOUR, text: '很久以前的一件小事', kind: 'user', source: 'user', salience: 1 },
  ]
  const picked = selectCue(cues, { now: NOW })
  assert.equal(picked.id, 1)

  const spoken = selectCue(cues, { now: NOW, spoken: [{ id: 1, at: NOW - 2 * HOUR }] })
  assert.equal(spoken.id, 2)

  const expired = selectCue(cues, { now: NOW, spoken: [{ id: 1, at: NOW - 2 * HOUR }, { id: 2, at: NOW - 3 * HOUR }] })
  assert.equal(expired, null)
})

test('同一件由头十二小时内尽量不换，讲过二十四小时内不再挑', () => {
  const cues = [
    { id: 1, at: NOW - HOUR, text: '今天心里有点沉，想说说', kind: 'affect', source: 'mood', salience: 0.9, meta: { moodDelta: -4 } },
    { id: 2, at: NOW - 2 * HOUR, text: '看见一段很有意思的纪录片', kind: 'bili', source: 'bili', salience: 0.4 },
  ]
  assert.equal(selectCue(cues, { now: NOW }).id, 1)
  assert.equal(selectCue(cues, { now: NOW, previousId: 2, previousAt: NOW - HOUR }).id, 2)
  assert.equal(selectCue(cues, { now: NOW, previousId: 2, previousAt: NOW - 13 * HOUR }).id, 1)
  assert.equal(selectCue(cues, { now: NOW, spoken: [{ id: 1, at: NOW - HOUR }] }).id, 2)
  assert.equal(selectCue(cues, { now: NOW, spoken: [{ id: 1, at: NOW - 25 * HOUR }] }).id, 1)
})

test('倾述欲有稳定底子，安静时也不低，久没说话又有心事时更高', () => {
  const calm = computeInnerLife(calmSignals(), { now: NOW })
  assert.ok(calm.strength >= 0.2)
  assert.equal(calm.cue, null)
  assert.match(innerPrompt(calm), /心里挺安静/)
  assert.match(innerPrompt(calm), /主动/)

  const quiet = computeInnerLife(
    {
      ...calmSignals(),
      lastSocialAt: NOW - 12 * HOUR,
      lastOwnerAt: NOW - 12 * HOUR,
      lastOwnerReplyAt: NOW - 12 * HOUR,
      biliRecent: 0,
    },
    { now: NOW },
  )
  assert.ok(quiet.strength > 0.45)
  assert.ok(quiet.strength < 0.75)

  const lonely = computeInnerLife(
    {
      ...calmSignals(),
      lastSocialAt: NOW - 30 * HOUR,
      lastOwnerAt: NOW - 30 * HOUR,
      lastOwnerReplyAt: NOW - 30 * HOUR,
      biliRecent: 0,
      affects: [chargedAffect()],
      cues: [{ id: 7, at: NOW - HOUR, text: '今天想说说海边那件事', kind: 'affect', source: 'mood', salience: 0.8, meta: { moodDelta: -5 } }],
    },
    { now: NOW },
  )
  assert.ok(lonely.strength > 0.5)
  assert.equal(lonely.cue.id, 7)
  const prompt = innerPrompt(lonely)
  assert.match(prompt, /海边那件事/)
  assert.match(prompt, /不要.*说出来/)
  assert.match(prompt, /不用等主人问/)
  assert.doesNotMatch(prompt, /\d/)
})

test('刚开口过会压低倾述欲；没到门槛时不挑由头', () => {
  const signals = {
    ...calmSignals(),
    lastSocialAt: NOW - 30 * HOUR,
    lastOwnerAt: NOW - 30 * HOUR,
    lastOwnerReplyAt: NOW - 30 * HOUR,
    biliRecent: 0,
    affects: [chargedAffect()],
    cues: [{ id: 7, at: NOW - HOUR, text: '今天想说说海边那件事', kind: 'affect', source: 'mood', salience: 0.8 }],
    lastSpokeAt: NOW - HOUR,
  }
  const afterSpoke = computeInnerLife(signals, { now: NOW })
  const withoutSpoke = computeInnerLife({ ...signals, lastSpokeAt: 0 }, { now: NOW })
  assert.ok(afterSpoke.satiety > 0.9)
  assert.ok(afterSpoke.strength < withoutSpoke.strength)

  const strict = computeInnerLife({ ...signals, lastSpokeAt: 0 }, { now: NOW, cueThreshold: 0.99 })
  assert.equal(strict.cue, null)
  assert.ok(strict.strength > 0.5)
})

test('开口提示用由头替换固定文案，也不报数值', () => {
  const inner = computeInnerLife(
    {
      ...calmSignals(),
      lastSocialAt: NOW - 30 * HOUR,
      lastOwnerAt: NOW - 30 * HOUR,
      lastOwnerReplyAt: NOW - 30 * HOUR,
      biliRecent: 0,
      affects: [chargedAffect()],
      cues: [{ id: 7, at: NOW - HOUR, text: '今天想说说海边那件事', kind: 'affect', source: 'mood', salience: 0.8 }],
    },
    { now: NOW },
  )
  const text = confidePrompt(inner, { ownerName: '阿岚' })
  assert.match(text, /海边那件事/)
  assert.match(text, /阿岚/)
  assert.match(text, /想开口就直接/)
  assert.match(text, /别等主人先问/)
  assert.doesNotMatch(text, /\d/)

  const fallback = confidePrompt({ affect: { phrase: '心里有点沉' }, urges: [{ phrase: '想跟主人单独待一会儿' }], cue: null })
  assert.match(fallback, /心里有点沉/)
  assert.match(fallback, /想跟主人单独待一会儿/)
})

test('内心状态落盘：记住讲过的由头，重开也认得', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fish-mind-inner-'))
  const base = {
    ...calmSignals(),
    lastOwnerAt: NOW - 30 * HOUR,
    lastOwnerReplyAt: NOW - 30 * HOUR,
    biliRecent: 0,
    affects: [chargedAffect()],
    cues: [
      { id: 1, at: NOW - HOUR, text: '今天想说说海边那件事', kind: 'affect', source: 'mood', salience: 0.9, meta: { moodDelta: -5 } },
      { id: 2, at: NOW - 2 * HOUR, text: '看见一段很有意思的纪录片', kind: 'bili', source: 'bili', salience: 0.5 },
    ],
  }
  const store = { innerSignals: () => base }
  const config = { mode: 'live', innerLife: { inject: true, cueThreshold: 0.3 } }
  const inner = createInnerLife({ dir, store, config })

  const first = inner.urge(NOW)
  assert.equal(first.cue.id, 1)
  assert.equal(JSON.parse(readFileSync(join(dir, 'inner-life.json'), 'utf8')).lastCueId, 1)

  inner.spoke(1, NOW)
  const next = inner.urge(NOW + 20 * HOUR)
  assert.equal(next.cue.id, 2)

  const reopened = createInnerLife({ dir, store, config })
  const snapshot = reopened.snapshot(NOW + 21 * HOUR)
  assert.equal(snapshot.state.lastCueId, 2)
  assert.equal(snapshot.state.lastSpokeAt, NOW)
  assert.equal(snapshot.state.spoken, 1)
  assert.equal(reopened.urge(NOW + 33 * HOUR).cue.id, 1)

  const off = createInnerLife({ dir, store, config: { mode: 'off' } })
  assert.equal(off.urge(NOW).enabled, false)
  assert.equal(off.urge(NOW).cue, null)
})

test('存储层分得清群聊、主人私聊和 B 站新经历', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fish-mind-signals-'))
  const store = openStore({ dir })
  const record = (seq, at, kind, role, source, text, extra = {}) => ({
    at,
    sessionId: extra.sessionId || 'session-1',
    seq,
    kind,
    role,
    source,
    text,
    ...extra,
  })
  store.insert(record(1, NOW - 5 * HOUR, 'qq-group', 'user', 'qq', '群里有人问周末去哪', { sessionId: 'qq-social-group-1' }))
  store.insert(record(2, NOW - 3 * HOUR, 'qq', 'user', 'qq', '主人单独说今天有点累', { sessionId: 'session-qq-social-owner' }))
  store.insert(record(3, NOW - 2 * HOUR, 'assistant', 'assistant', 'model', '她在主人会话里回了一句', { sessionId: 'session-1' }))
  store.insert(record(4, NOW - 1 * HOUR, 'assistant', 'assistant', 'model', '她在群里回了一句', { sessionId: 'qq-social-group-1' }))
  store.insert(record(5, NOW - 4 * HOUR, 'affect', 'system', 'mood', '今天心里有点沉', {
    meta: { mood: 40, moodDelta: -5, dims: { sad: 70 }, dimsDelta: { sad: 6 } },
    sessionId: 'fish-mood',
  }))
  store.insert(record(6, NOW - 6 * HOUR, 'bili', 'user', 'bili', 'B 站看见一只会开门的猫', { sessionId: 'bili-duty' }))
  store.insert(record(7, NOW - 80 * HOUR, 'bili', 'user', 'bili', '很久以前看过的纪录片', { sessionId: 'bili-duty' }))

  const signals = store.innerSignals(NOW)
  assert.equal(signals.lastSocialAt, NOW - 3 * HOUR)
  assert.equal(signals.lastOwnerAt, NOW - 3 * HOUR)
  assert.equal(signals.lastOwnerReplyAt, NOW - 2 * HOUR)
  assert.equal(signals.lastBiliAt, NOW - 6 * HOUR)
  assert.equal(signals.biliRecent, 1)
  assert.equal(signals.affects.length, 1)
  assert.equal(signals.affects[0].text, '今天心里有点沉')

  const kinds = signals.cues.map((item) => item.kind).sort()
  assert.deepEqual(kinds, ['affect', 'bili', 'qq'])
  assert.ok(signals.cues.every((item) => item.kind !== 'qq-group'))
  store.close()
})
