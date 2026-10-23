import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  baseRoomKey,
  roomKind,
  roomScope,
  scopeVisible,
  roomLabel,
  startOfLocalDay,
  localDayKey,
  lastSlotAt,
  pendingNights,
  lastWeeklySlot,
  lastMonthlySlot,
  slotDue,
  planRoomPass,
  selectRows,
  compressRows,
  factsForSession,
  formatFactDigest,
  nextReviewAt,
  dueItems,
  parseCycleJson,
  microPrompt,
  nightlySwsPrompt,
  nightlyRemPrompt,
  weeklyPrompt,
  monthlyPrompt,
  DAY_MS,
} from '../lib/rhythm.js'

const at = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime()

function row(id, ts, text, extra = {}) {
  return { id, at: ts, text, role: 'user', actor: '主人', salience: 0.6, ...extra }
}

test('房间：重置后缀归回同一间屋，群/好友/私聊/导入分得清', () => {
  assert.equal(baseRoomKey('session-qq-social-group-795789868-rmvkmde7w'), 'session-qq-social-group-795789868')
  assert.equal(baseRoomKey('session-3050c207-1f33-41c7-ab04-9db2f8472e36'), 'session-3050c207-1f33-41c7-ab04-9db2f8472e36')
  assert.equal(roomKind('session-qq-social-group-795789868'), 'group')
  assert.equal(roomKind('session-qq-social-friend-123456'), 'friend')
  assert.equal(roomKind('session-qq-private-837263217'), 'private')
  assert.equal(roomKind('session-qq-import-abc'), 'imported')
  assert.equal(roomKind('session-3050c207-1f33-41c7-ab04-9db2f8472e36'), 'owner')
  assert.equal(roomScope('session-qq-social-group-795789868'), 'social:session-qq-social-group-795789868')
  assert.equal(roomScope('session-qq-private-837263217'), 'owner')
  assert.equal(roomScope('session-qq-import-abc'), 'imported')
  assert.equal(roomLabel('session-qq-social-group-795789868'), '群 …9868')
  assert.equal(roomLabel('session-qq-private-837263217'), '主人私聊')
})

test('范围：主人看得到社交事实，社交房看不到主人事实，也看不到别的房间', () => {
  const owner = 'session-3050c207-1f33-41c7-ab04-9db2f8472e36'
  const group = 'session-qq-social-group-795789868'
  const other = 'session-qq-social-group-1049180426'
  assert.equal(scopeVisible('owner', owner), true)
  assert.equal(scopeVisible(`social:${group}`, owner), true)
  assert.equal(scopeVisible('owner', group), false)
  assert.equal(scopeVisible(`social:${group}`, group), true)
  assert.equal(scopeVisible(`social:${other}`, group), false)
})

test('本地日界和睡眠时刻：03:30 前算上一场，之后整理昨天', () => {
  const morning = at(2026, 10, 23, 3, 30)
  const before = at(2026, 10, 23, 2, 0)
  const afternoon = at(2026, 10, 23, 15, 25)
  assert.equal(startOfLocalDay(afternoon), at(2026, 10, 23))
  assert.equal(localDayKey(afternoon), '2026-10-23')
  assert.equal(lastSlotAt(before), at(2026, 10, 22, 3, 30))
  assert.equal(lastSlotAt(afternoon), morning)
  assert.deepEqual(pendingNights({ now: afternoon, lastDay: '', hour: 3, minute: 30, catchUpDays: 2 }).map((day) => day.dayKey), ['2026-10-21', '2026-10-22'])
  assert.deepEqual(pendingNights({ now: afternoon, lastDay: '2026-10-21', hour: 3, minute: 30, catchUpDays: 2 }).map((day) => day.dayKey), ['2026-10-22'])
  assert.deepEqual(pendingNights({ now: afternoon, lastDay: '2026-10-22', hour: 3, minute: 30, catchUpDays: 2 }), [])
  assert.deepEqual(pendingNights({ now: before, lastDay: '2026-10-21', hour: 3, minute: 30, catchUpDays: 2 }), [])
})

test('周和月：只在该跑的那一天到期，跑过就不再重复', () => {
  const monday = at(2026, 10, 26, 4, 10)
  const sunday = at(2026, 10, 25, 23, 0)
  assert.equal(lastWeeklySlot(monday), monday)
  assert.equal(lastWeeklySlot(sunday), at(2026, 10, 19, 4, 10))
  assert.deepEqual(slotDue(monday, at(2026, 10, 19, 4, 10), lastWeeklySlot(monday)), { due: true, slot: monday })
  assert.deepEqual(slotDue(monday, monday, lastWeeklySlot(monday)), { due: false, slot: monday })
  const first = at(2026, 11, 1, 4, 20)
  assert.equal(lastMonthlySlot(at(2026, 10, 31, 23, 0)), at(2026, 10, 1, 4, 20))
  assert.equal(lastMonthlySlot(first), first)
})

test('微巩固计划：不够不动，放凉或积压才动，水位按 id 不跳过同毫秒消息', () => {
  const now = at(2026, 10, 23, 15, 0)
  const rows = [
    row(1, now - 50 * 60_000, '很早的一句'),
    row(2, now - 30 * 60_000, '中间'),
    row(3, now - 25 * 60_000, '再一句'),
  ]
  assert.equal(planRoomPass(rows, { cursorId: 1, now, idleMs: 20 * 60_000, minRows: 2, maxRows: 24 }).ready, true)
  const fresh = planRoomPass([row(2, now - 5 * 60_000, '刚说的'), row(3, now - 4 * 60_000, '刚说的')], { cursorId: 1, now, idleMs: 20 * 60_000, minRows: 2 })
  assert.equal(fresh.ready, false)
  assert.equal(fresh.reason, 'fresh')
  const enough = planRoomPass([row(1, now - 2 * 60_000, '一句')], { cursorId: 0, now, minRows: 2 })
  assert.equal(enough.ready, false)
  assert.equal(enough.reason, 'not-enough')
  const overflow = planRoomPass([row(1, now, 'a'), row(2, now, 'b')], { cursorId: 0, now, minRows: 2, maxRows: 2, idleMs: 60 * 60_000 })
  assert.equal(overflow.ready, true)
  assert.equal(overflow.reason, 'overflow')
  assert.equal(overflow.pending, 2)
  assert.equal(overflow.advanceToId, 2)
  const sameMs = planRoomPass([row(1, now, '同一毫秒 A'), row(2, now, '同一毫秒 B')], { cursorId: 0, now, minRows: 2, maxRows: 2 })
  assert.deepEqual(sameMs.selected.map((item) => item.id), [1, 2])
})

test('挑选：显著性优先，最新几句必留，字符预算不超', () => {
  const now = at(2026, 10, 23, 15, 0)
  const rows = [
    row(1, now - 60 * 60_000, '无关紧要的一句', { salience: 0.2 }),
    row(2, now - 30 * 60_000, '我答应你周末一起去看展，别忘了', { salience: 0.9 }),
    row(3, now - 10 * 60_000, '今天天气一般', { salience: 0.1 }),
    row(4, now - 60_000, '那说好了', { salience: 0.1 }),
  ]
  const picked = selectRows(rows, { limit: 3, chars: 400, rowChars: 100, newest: 2 })
  assert.deepEqual(picked.selected.map((item) => item.id), [2, 3, 4])
  assert.ok(picked.chars <= 400)
  const small = selectRows([
    row(1, now - 60 * 60_000, '甲'.repeat(100), { salience: 0.2 }),
    row(2, now - 30 * 60_000, '乙'.repeat(100), { salience: 0.9 }),
    row(3, now - 60_000, '丙'.repeat(100), { salience: 0.1 }),
  ], { limit: 4, chars: 120, rowChars: 100, newest: 1 })
  assert.equal(small.selected.length, 1)
})

test('群聊压缩：只留几行，每行裁短，预算内从旧到新', () => {
  const now = at(2026, 10, 23, 15, 0)
  const rows = [
    row(1, now - 3 * 60_000, 'A'.repeat(300), { actor: '幻幻' }),
    row(2, now - 2 * 60_000, 'B'.repeat(300), { actor: '群主' }),
    row(3, now - 60_000, 'C'.repeat(300), { actor: '大肥鱼', role: 'assistant' }),
  ]
  const text = compressRows(rows, { chars: 300, rowChars: 80 })
  assert.ok(text.length <= 300)
  assert.ok(text.includes('幻幻'))
  assert.ok(!text.includes('A'.repeat(100)))
})

test('事实摘要：按房间过滤，主人范围优先，长度有上限', () => {
  const owner = 'session-3050c207-1f33-41c7-ab04-9db2f8472e36'
  const group = 'session-qq-social-group-795789868'
  const facts = [
    { subject: '主人', predicate: '昵称', object: 'EMT', scope: 'owner', confidence: 0.9, validFrom: 2 },
    { subject: '幻幻', predicate: '习惯', object: '夜猫子', scope: `social:${group}`, confidence: 0.8, validFrom: 3 },
    { subject: '别人', predicate: '秘密', object: '不该看见', scope: 'social:session-qq-social-group-1234', confidence: 0.9, validFrom: 4 },
  ]
  assert.deepEqual(factsForSession(facts, group).map((fact) => fact.subject), ['幻幻'])
  assert.deepEqual(factsForSession(facts, owner).map((fact) => fact.subject), ['主人', '幻幻', '别人'])
  const digest = formatFactDigest(factsForSession(facts, owner), { limit: 2, chars: 100 })
  assert.ok(digest.startsWith('主人'))
  assert.ok(digest.length <= 100)
})

test('复习排期：3、7、21、60 天，走完不再排', () => {
  const from = at(2026, 10, 23, 3, 30)
  assert.equal(nextReviewAt(0, from), from + 3 * DAY_MS)
  assert.equal(nextReviewAt(1, from), from + 7 * DAY_MS)
  assert.equal(nextReviewAt(2, from), from + 21 * DAY_MS)
  assert.equal(nextReviewAt(3, from), from + 60 * DAY_MS)
  assert.equal(nextReviewAt(4, from), 0)
  const items = [
    { id: 1, nextReviewAt: from - DAY_MS },
    { id: 2, nextReviewAt: from - 2 * DAY_MS },
    { id: 3, nextReviewAt: from - 3 * DAY_MS },
    { id: 4, nextReviewAt: 0 },
  ]
  assert.deepEqual(dueItems(items, from, 8).map((item) => item.id), [3, 2, 1])
  assert.equal(dueItems(items, from, 1).length, 1)
})

test('睡眠 JSON：围栏、坏条目、越界值都能收住', () => {
  const raw = '```json\n{"summary":"今天聊了展","gist":"短的","themes":["看展",42],"facts":[{"subject":"主人","predicate":"计划","object":"周末看展","confidence":2},{"subject":"","predicate":"x","object":"y"}],"corrections":[{"subject":"主人","predicate":"昵称","object":"EMT","confidence":0.8}],"self":[{"key":"我最近在意的事","value":"怕打扰他","confidence":0.6}],"relations":[{"person":"幻幻","note":"聊得多","trust":0.7},{"person":"","note":"x"}],"intentions":[{"text":"问考试","trigger":"再见到她","dueAt":1790000000000}],"affect":{"label":"踏实","valence":0.4,"arousal":1.8,"dominance":0.5}}\n```'
  const parsed = parseCycleJson(raw)
  assert.equal(parsed.summary, '今天聊了展')
  assert.equal(parsed.gist, '短的')
  assert.deepEqual(parsed.themes, ['看展', '42'])
  assert.equal(parsed.facts.length, 1)
  assert.equal(parsed.facts[0].confidence, 0.95)
  assert.equal(parsed.corrections.length, 1)
  assert.equal(parsed.self.length, 1)
  assert.equal(parsed.relations.length, 1)
  assert.equal(parsed.intentions.length, 1)
  assert.equal(parsed.affect.arousal, 1)
  assert.equal(parsed.affect.valence, 0.4)
  const broken = parseCycleJson('not json')
  assert.equal(broken.summary, '')
  assert.deepEqual(broken.facts, [])
  assert.equal(broken.affect, null)
  assert.equal(parseCycleJson('{"facts":"nope","affect":"nope"}').facts.length, 0)
})

test('提示词：主人房和社交房的问题不同，私密内容两边都挡住', () => {
  const rows = [row(1, at(2026, 10, 23, 14, 0), '我周末去看展，密码是 123456')]
  const owner = microPrompt(rows, { kind: 'owner', knownFacts: [{ subject: '主人', predicate: '昵称', object: 'EMT' }], maxFacts: 4 })
  assert.match(owner.system, /主人/)
  assert.match(owner.system, /密码/)
  assert.match(owner.user, /EMT/)
  const social = microPrompt(rows, { kind: 'group', knownFacts: [], maxFacts: 4 })
  assert.match(social.system, /群/)
  assert.match(social.system, /不要写「主人」/)
  assert.match(social.system, /私聊内容/)
})

test('睡眠/周/月提示：把到期复习、关系边和自我模型带进去', () => {
  const sws = nightlySwsPrompt({
    dayKey: '2026-10-22',
    episodes: [{ id: 1, when: '10-22 10:00', source: '群聊', summary: '聊了看展' }],
    facts: [{ subject: '主人', predicate: '昵称', object: 'EMT', confidence: 0.9 }],
    due: [{ kind: '情景', text: '三天前的约定' }],
  })
  assert.match(sws.user, /情景 #1/)
  assert.match(sws.user, /三天前的约定/)
  assert.match(sws.user, /EMT/)
  assert.match(sws.system, /慢波/)
  const rem = nightlyRemPrompt({
    dayKey: '2026-10-22',
    episodes: [{ id: 2, when: '10-22 11:00', source: '群聊', summary: '大家开玩笑' }],
    selfModel: [{ key: '我最近在意的事', value: '怕打扰他', confidence: 0.6 }],
    people: [{ displayName: '幻幻', role: '群友', note: '爱开玩笑' }],
  })
  assert.match(rem.user, /怕打扰他/)
  assert.match(rem.user, /幻幻/)
  assert.match(rem.system, /REM/)
  const week = weeklyPrompt({ days: [{ title: '10月22日 · 群', summary: '聊了展' }], facts: [], relations: [{ src: '主人', relation: '朋友', dst: '幻幻' }] })
  assert.match(week.user, /10月22日/)
  assert.match(week.user, /幻幻/)
  const month = monthlyPrompt({ chapters: [{ title: '10月', summary: '一个月的日子' }], selfModel: [] })
  assert.match(month.user, /一个月的日子/)
})
