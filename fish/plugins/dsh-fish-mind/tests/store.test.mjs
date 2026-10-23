import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openStore, parseTimeWindow, tokenize } from '../lib/store.js'

function tempStore(config) {
  const dir = mkdtempSync(join(tmpdir(), 'fish-mind-store-'))
  return { dir, store: openStore({ dir, config }) }
}

function record(text, overrides = {}) {
  return {
    at: Date.now(),
    sessionId: 'session-1',
    seq: 1,
    kind: 'user',
    role: 'user',
    source: 'user',
    text,
    ...overrides,
  }
}

test('中文二元组能查到海边和日落', () => {
  const { store } = tempStore()
  store.insert(record('今天我们去海边看了日落'))
  store.insert(record('海边的日落很好看', { seq: 2, kind: 'assistant', role: 'assistant' }))
  store.insert(record('今天没有出门', { seq: 3 }))

  const beach = store.search('海边')
  assert.equal(beach.length, 2)
  assert.ok(beach.every((item) => item.text.includes('海边')))

  const sunset = store.search('日落')
  assert.equal(sunset.length, 2)

  store.close()
})

test('单字查询退回 LIKE，不依赖 FTS 的整词', () => {
  const { store } = tempStore()
  store.insert(record('海边的风很大'))
  assert.equal(store.search('海').length, 1)
  assert.equal(store.search('风').length, 1)
  assert.equal(store.search('山').length, 0)
  store.close()
})

test('丢弃的经历不进 FTS，也搜不到原文', () => {
  const { store } = tempStore()
  const dropped = store.insert(record('', { seq: 9, dropped: 'password' }))
  assert.equal(dropped.inserted, true)
  assert.equal(store.search('密码').length, 0)
  assert.equal(store._hasFts(dropped.hash), false)
  store.close()
})

test('同一事件重复投递只写一条', () => {
  const { store } = tempStore()
  const first = store.insert(record('重复的一句话', { seq: 7 }))
  const second = store.insert(record('重复的一句话', { seq: 7 }))
  assert.equal(first.inserted, true)
  assert.equal(second.inserted, false)
  assert.equal(first.hash, second.hash)
  assert.equal(store.stats().total, 1)
  store.close()
})

test('JSONL 条数与 SQLite 一致，重建后摘要不变', async () => {
  const { dir, store } = tempStore()
  store.insert(record('今天我们去海边看了日落', { seq: 1 }))
  store.insert(record('海边的日落很好看', { seq: 2, kind: 'assistant', role: 'assistant' }))
  store.insert(record('只留元数据', { seq: 3, text: '', dropped: 'password' }))

  const before = store.contentDigest()
  const lines = readFileSync(join(dir, 'experience.jsonl'), 'utf8').trim().split('\n')
  assert.equal(lines.length, 3)

  const rebuilt = await store.rebuild()
  assert.equal(rebuilt.lines, 3)
  assert.equal(rebuilt.count, 2)
  assert.equal(rebuilt.digest, before)
  assert.equal(store.stats().total, 3)
  assert.equal(store.search('海边').length, 2)
  store.close()
})

test('重建能补回只落在 JSONL 里的记录', async () => {
  const { dir, store } = tempStore()
  store.insert(record('这句话只写进了 JSONL', { seq: 1 }))
  // 模拟「JSONL 落盘了，SQLite 事务还没提交就断电」
  store._db().exec('DELETE FROM experience_fts; DELETE FROM experiences;')
  assert.equal(store.stats().total, 0)

  const rebuilt = await store.rebuild()
  assert.equal(rebuilt.lines, 1)
  assert.equal(store.stats().total, 1)
  assert.equal(store.search('JSONL').length, 1)
  assert.equal(join(dir, 'experience.jsonl').length > 0, true)
  store.close()
})

test('二元组切分保留英文整词', () => {
  assert.deepEqual(tokenize('海边 sunset'), ['海边', 'sunset'])
  assert.deepEqual(tokenize('API key'), ['api', 'key'])
  assert.deepEqual(tokenize('海'), ['海'])
  assert.deepEqual(tokenize(''), [])
})

test('按时间间隔切情景，间隔太久的另起一段', () => {
  const { store } = tempStore()
  const now = Date.now()
  store.insert(record('第一段的第一句', { seq: 1, at: now - 3 * 3_600_000 }))
  store.insert(record('隔了一小时的一句', { seq: 2, at: now - 2 * 3_600_000 }))
  store.insert(record('又隔了一小时的一句', { seq: 3, at: now - 3_600_000 }))
  assert.equal(store.stats().episodes, 3)
  store.close()
})

test('短间隔内的话题跳变会切段，同一话题的消息归到一段', () => {
  const { store } = tempStore()
  const now = Date.now()
  store.insert(record('今天我们去海边看了日落', { seq: 1, at: now - 10 * 60_000 }))
  store.insert(record('海边的风很大，记得穿外套', {
    seq: 2,
    at: now - 9 * 60_000,
    kind: 'assistant',
    role: 'assistant',
    source: 'model',
  }))
  store.insert(record('日落是橙色的', { seq: 3, at: now - 8 * 60_000 }))
  assert.equal(store.stats().episodes, 1)

  store.insert(record('明天要交项目报告了', { seq: 4, at: now - 7 * 60_000 }))
  assert.equal(store.stats().episodes, 2)
  store.close()
})

test('重复的客套话低于显著性阈值，只留原文不建情景', () => {
  const { store } = tempStore()
  const now = Date.now()
  store.insert(record('嗯。', {
    sessionId: 'session-a',
    seq: 1,
    at: now - 3_600_000,
    kind: 'assistant',
    role: 'assistant',
    source: 'model',
  }))
  assert.equal(store.stats().episodes, 1)

  store.insert(record('嗯。', {
    sessionId: 'session-b',
    seq: 1,
    at: now,
    kind: 'assistant',
    role: 'assistant',
    source: 'model',
  }))
  assert.equal(store.stats().episodes, 1)
  assert.equal(store.search('嗯').length, 2)
  store.close()
})

test('四路召回：关键词、实体、时间窗和图扩展都能找到对应情景', () => {
  const { store } = tempStore()
  const now = Date.now()
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)
  const yesterdayNoon = dayStart.getTime() - 12 * 3_600_000

  store.insert(record('「小蓝」今天在咖啡馆陪我坐了一下午', {
    sessionId: 'session-a', seq: 1, at: now - 2 * 3_600_000,
  }))
  store.insert(record('咖啡馆的拿铁很好喝', {
    sessionId: 'session-a', seq: 2, at: now - 2 * 3_600_000 + 60_000,
  }))
  store.insert(record('「小蓝」说鲸鱼在夜里会唱歌', {
    sessionId: 'session-b', seq: 1, at: now - 3_600_000,
  }))
  store.insert(record('晚上吃了火锅', {
    sessionId: 'session-c', seq: 1, at: yesterdayNoon,
  }))
  assert.equal(store.stats().episodes, 3)

  const cafe = store.recall('咖啡馆')
  assert.equal(cafe.reason, 'ok')
  assert.equal(cafe.items[0].sessionId, 'session-a')
  assert.equal(cafe.items[0].type, 'episode')
  assert.ok(cafe.items[0].importance > 0)
  assert.ok(cafe.items[0].routes.includes('fts'))
  assert.ok(cafe.items[0].routes.includes('entity'))
  // 图扩展只走一跳：小蓝把咖啡馆和另一段连接起来。
  assert.ok(cafe.items.some((item) => item.sessionId === 'session-b'))

  const yesterday = store.recall('昨天')
  assert.equal(yesterday.reason, 'ok')
  assert.equal(yesterday.items[0].sessionId, 'session-c')
  assert.ok(yesterday.items[0].routes.includes('time'))

  const none = store.recall('火星基地的稀有矿石')
  assert.equal(none.reason, 'no-strong-match')
  assert.deepEqual(none.items, [])
  store.close()
})

test('召回能排除当前会话，并带来源标签和置信度', () => {
  const { store } = tempStore()
  const now = Date.now()
  store.insert(record('「小蓝」在公园里等我', {
    sessionId: 'session-a', seq: 1, at: now - 2 * 3_600_000, source: 'user', meta: { trust: 1 },
  }))
  store.insert(record('「小蓝」说周末去公园', {
    sessionId: 'session-b', seq: 1, at: now - 3_600_000, source: 'qq',
  }))
  store.insert(record('你上次说的公园，我记住了', {
    sessionId: 'session-c', seq: 1, at: now - 30 * 60_000,
    kind: 'assistant', role: 'assistant', source: 'model',
  }))

  const all = store.recall('小蓝')
  assert.equal(all.reason, 'ok')
  assert.deepEqual(all.items.map((item) => item.sessionId).sort(), ['session-a', 'session-b', 'session-c'])
  const bySession = new Map(all.items.map((item) => [item.sessionId, item]))
  assert.equal(bySession.get('session-a').source, '主人说的')
  assert.equal(bySession.get('session-b').source, 'QQ 里说的')
  assert.equal(bySession.get('session-c').source, '她自己说的')
  assert.equal(bySession.get('session-a').confidence, 1)

  const excluded = store.recall('小蓝', { excludeSessionId: 'session-a' })
  assert.deepEqual(excluded.items.map((item) => item.sessionId).sort(), ['session-b', 'session-c'])
  const only = store.recall('小蓝', { sessionId: 'session-b' })
  assert.deepEqual(only.items.map((item) => item.sessionId), ['session-b'])
  store.close()
})

test('打开情景能读回原文，条数和字数都有上限', () => {
  const { store } = tempStore()
  const now = Date.now()
  const long = `「小蓝」说下次带我去看鲸鱼，${'海风很大，'.repeat(80)}最后在灯塔下吃了热狗`
  store.insert(record(long, { sessionId: 'session-a', seq: 1, at: now - 3_600_000 }))
  store.insert(record('好，我记得。', {
    sessionId: 'session-a', seq: 2, at: now - 3_540_000, kind: 'assistant', role: 'assistant', source: 'model',
  }))
  store.insert(record('', { sessionId: 'session-a', seq: 3, at: now - 3_500_000, dropped: 'password' }))

  const found = store.recall('鲸鱼')
  assert.equal(found.reason, 'ok')
  const id = found.items[0].id
  assert.ok(!found.items[0].excerpt.includes('灯塔下吃了热狗'), '召回只给线索')

  const full = store.openEpisode(id, { limit: 10, maxChars: 20000 })
  assert.equal(full.reason, 'ok')
  assert.equal(full.total, 2)
  assert.equal(full.messages.length, 2)
  assert.ok(full.messages[0].text.includes('灯塔下吃了热狗'))
  assert.equal(full.messages[1].role, 'assistant')
  assert.equal(full.truncated, false)

  const clipped = store.openEpisode(id, { limit: 1, maxChars: 40 })
  assert.equal(clipped.messages.length, 1)
  assert.equal(clipped.truncated, true)
  assert.ok(clipped.messages[0].text.endsWith('…'))
  assert.ok(Array.from(clipped.messages[0].text).length <= 40)

  assert.equal(store.openEpisode(999999).reason, 'not-found')
  assert.equal(store.openEpisode(0).reason, 'bad-id')
  store.close()
})

test('超长原文完整存档，索引和召回线索只看前缀', () => {
  const { dir, store } = tempStore({ maxTextChars: 200 })
  const head = `开头提到灯塔，${'海风。'.repeat(200)}`
  const tail = '结尾提到深海鲸歌'
  const text = head + tail
  assert.ok(text.length > 400)
  store.insert(record(text, { sessionId: 'session-a', seq: 1 }))

  assert.equal(store.search('灯塔').length, 1)
  assert.equal(store.search('深海鲸歌').length, 0, '索引只吃前缀，尾部不参与热路径')

  const found = store.recall('灯塔')
  assert.equal(found.reason, 'ok')
  assert.ok(!found.items[0].excerpt.includes('深海鲸歌'), '召回只给前缀线索')

  const opened = store.openEpisode(found.items[0].id)
  assert.equal(opened.messages[0].text, text, '原文按完整长度存档，深入时能读回尾部')
  assert.equal(opened.totalChars, text.length)

  const lines = readFileSync(join(dir, 'experience.jsonl'), 'utf8').trim().split('\n')
  assert.equal(JSON.parse(lines[0]).text, text)
  store.close()
})

test('深入原文用字符游标分页，单条长消息也能读完', () => {
  const { store } = tempStore()
  const now = Date.now()
  const first = `「小蓝」说下次带我去看鲸鱼，${'海风很大，'.repeat(30)}最后在灯塔下吃了热狗`
  const second = '好，我记得。'
  store.insert(record(first, { sessionId: 'session-a', seq: 1, at: now - 3_600_000 }))
  store.insert(record(second, {
    sessionId: 'session-a', seq: 2, at: now - 3_540_000, kind: 'assistant', role: 'assistant', source: 'model',
  }))

  const id = store.recall('鲸鱼').items[0].id
  const joined = []
  let offset = 0
  let pages = 0
  let sawContinued = false
  for (;;) {
    const page = store.openEpisode(id, { maxChars: 30, offset })
    assert.equal(page.reason, 'ok')
    assert.equal(page.total, 2)
    assert.equal(page.totalChars, first.length + 1 + second.length)
    assert.ok(page.messages.length >= 1)
    for (const message of page.messages) {
      if (message.continued) sawContinued = true
      joined.push(message.text.replace(/…$/, ''))
    }
    pages += 1
    if (page.nextOffset === null) {
      assert.equal(page.truncated, false)
      break
    }
    assert.equal(page.truncated, true)
    assert.ok(page.nextOffset > offset)
    offset = page.nextOffset
    assert.ok(pages < 1000, '分页必须收敛')
  }
  assert.ok(pages >= 2, '长原文要跨多页')
  assert.ok(sawContinued, '续页会标明这是同一条消息的后半段')
  assert.equal(joined.join(''), first + second)

  const end = store.openEpisode(id, { offset: 999999 })
  assert.equal(end.reason, 'end')
  assert.equal(end.nextOffset, null)
  assert.deepEqual(end.messages, [])
  store.close()
})

test('社交召回按完整会话 id 过滤，群号前缀相同也不串；可信度与来源可筛', () => {
  const { store } = tempStore()
  const now = Date.now()
  store.insert(record('周末去爬山看日出', {
    sessionId: 'session-qq-social-group-123', seq: 1, at: now - 60_000, source: 'qq-group', meta: { trust: 0.3 },
  }))
  store.insert(record('明天爬山记得带水', {
    sessionId: 'session-qq-social-group-1234', seq: 1, at: now - 60_000, source: 'qq-group', meta: { trust: 0.3 },
  }))
  store.insert(record('爬山穿运动鞋比较稳', {
    sessionId: 'session-qq-social-friend-123', seq: 1, at: now - 60_000, source: 'qq-friend', meta: { trust: 0.5 },
  }))

  const scoped = store.recall('爬山', { sessionId: 'session-qq-social-group-123' })
  assert.deepEqual(scoped.items.map((item) => item.sessionId), ['session-qq-social-group-123'])

  const lowTrust = store.recall('爬山', { maxTrust: 0.35 })
  assert.deepEqual(lowTrust.items.map((item) => item.sessionId).sort(), ['session-qq-social-group-123', 'session-qq-social-group-1234'])

  const noGroup = store.recall('爬山', { excludeSources: ['qq-group'] })
  assert.deepEqual(noGroup.items.map((item) => item.sessionId), ['session-qq-social-friend-123'])
  store.close()
})

test('旧经历可以补编码，补过的不再重复扫描', () => {
  const { store } = tempStore()
  store.insert(record('今天我们去海边看了日落', { seq: 1 }))
  store._db().exec('UPDATE experiences SET episode_id = NULL, salience = 0; DELETE FROM episodes;')
  assert.equal(store.stats().episodes, 0)

  assert.ok(store.encodePending(10) >= 1)
  assert.ok(store.stats().episodes >= 1)
  assert.equal(store.encodePending(10), 0)
  store.close()
})

test('重建会按同一套规则重新生成情景', async () => {
  const { store } = tempStore()
  const now = Date.now()
  store.insert(record('今天我们去海边看了日落', { seq: 1, at: now - 3_600_000 }))
  store.insert(record('海边的风很大，记得穿外套', {
    seq: 2,
    at: now - 3_500_000,
    kind: 'assistant',
    role: 'assistant',
    source: 'model',
  }))
  store.insert(record('日落是橙色的', { seq: 3, at: now - 3_400_000 }))
  store.insert(record('明天要交项目报告了', { seq: 4, at: now - 3_000_000 }))
  const before = store.stats().episodes
  assert.equal(before, 2)
  await store.rebuild()
  assert.equal(store.stats().episodes, before)
  assert.equal(store.recall('海边').reason, 'ok')
  store.close()
})

test('时间窗识别昨天、上周和具体日期', () => {
  const now = new Date(2026, 9, 21, 14, 30).getTime()
  const yesterday = parseTimeWindow('昨天', now)
  assert.equal(yesterday.label, '昨天')
  assert.equal(new Date(yesterday.start).getDate(), 20)
  const lastWeek = parseTimeWindow('上周', now)
  assert.equal(lastWeek.label, '上周')
  assert.ok(lastWeek.start < now && lastWeek.end <= now)
  const date = parseTimeWindow('2026-10-03', now)
  assert.equal(new Date(date.start).getDate(), 3)
  const lastWednesday = parseTimeWindow('上周三', now)
  assert.equal(new Date(lastWednesday.start).getDate(), 14)
  const thisWednesday = parseTimeWindow('周三', now)
  assert.equal(new Date(thisWednesday.start).getDate(), 21)
  assert.equal(parseTimeWindow('随便聊聊', now), null)
})

test('会话摘要按最近活动倒序，空会话不出现', () => {
  const { store } = tempStore()
  const now = Date.now()
  store.insert(record('旧会话的一句', { sessionId: 'session-old', seq: 1, at: now - 60_000 }))
  store.insert(record('新会话的第一句', { sessionId: 'session-new', seq: 1, at: now - 20_000 }))
  store.insert(record('新会话的第二句', { sessionId: 'session-new', seq: 2, at: now - 10_000 }))
  store.insert(record('没有会话的插件经历', { sessionId: '', seq: 1, at: now }))

  assert.deepEqual(store.sessionOverview().map((item) => [item.id, item.events]), [
    ['session-new', 2],
    ['session-old', 1],
  ])
  assert.deepEqual(store.sessionOverview(1).map((item) => item.id), ['session-new'])
  store.close()
})

test('短期窗口按时间正序给当场想得起的原话，工具消息和被丢弃的不进', () => {
  const { store } = tempStore()
  const now = Date.now()
  store.insert(record('我是EMT', { sessionId: 'session-a', seq: 1, at: now - 30_000 }))
  store.insert(record('记住了，EMT。', {
    sessionId: 'session-a', seq: 2, at: now - 20_000, kind: 'assistant', role: 'assistant', source: 'model',
  }))
  store.insert(record('工具回显的一大段', { sessionId: 'session-a', seq: 3, at: now - 15_000, kind: 'tool', role: 'tool' }))
  store.insert(record('', { sessionId: 'session-a', seq: 4, at: now - 12_000, dropped: 'password' }))
  store.insert(record('太久了想不起来', { sessionId: 'session-a', seq: 5, at: now - 90 * 60_000 }))

  const rows = store.recentWindow({ since: now - 60 * 60_000, rows: 10 })
  assert.deepEqual(rows.map((row) => row.text), ['我是EMT', '记住了，EMT。'])
  assert.deepEqual(rows.map((row) => row.role), ['user', 'assistant'])
  assert.ok(rows[0].at < rows[1].at, '必须是从早到晚')
  assert.equal(rows[0].sessionId, 'session-a')
  assert.equal(rows[0].source, 'user')
  store.close()
})

test('短期窗口能只看某个会话，也能排除某个会话或来源', () => {
  const { store } = tempStore()
  const now = Date.now()
  store.insert(record('私聊里说的', { sessionId: 'session-me', seq: 1, at: now - 10_000 }))
  store.insert(record('群里说的', { sessionId: 'session-qq', seq: 1, at: now - 9_000, source: 'qq-group' }))
  store.insert(record('好友说的', { sessionId: 'session-friend', seq: 1, at: now - 8_000, source: 'qq-friend' }))

  assert.deepEqual(
    store.recentWindow({ onlySessionId: 'session-qq' }).map((row) => row.text),
    ['群里说的'],
  )
  assert.deepEqual(
    store.recentWindow({ excludeSessionId: 'session-me' }).map((row) => row.text),
    ['群里说的', '好友说的'],
  )
  assert.deepEqual(
    store.recentWindow({ excludeSources: ['qq-group', 'qq-friend'] }).map((row) => row.text),
    ['私聊里说的'],
  )
  store.close()
})

test('短期窗口只要最近几行，超出的旧行不再返回', () => {
  const { store } = tempStore()
  const now = Date.now()
  for (let i = 0; i < 20; i += 1) {
    store.insert(record(`第${i}句`, { sessionId: 'session-a', seq: i + 1, at: now - (20 - i) * 1_000 }))
  }
  const rows = store.recentWindow({ rows: 5 })
  assert.equal(rows.length, 5)
  assert.deepEqual(rows.map((row) => row.text), ['第15句', '第16句', '第17句', '第18句', '第19句'])
  store.close()
})

test('事实写入：同一件事重复提炼不会存成两份', () => {
  const { store } = tempStore()
  const at = Date.now()
  const base = { subject: '主人', predicate: '昵称', object: 'EMT', at }
  assert.equal(store.upsertFact(base).action, 'added')
  assert.equal(store.upsertFact({ ...base, object: 'EMT' }).action, 'same')
  assert.equal(store.upsertFact({ ...base, object: '  EMT  ' }).action, 'same', '首尾空格不算改变')
  assert.equal(store.stats().facts, 1)

  const changed = store.upsertFact({ ...base, object: '小鱼', at: at + 1_000 })
  assert.equal(changed.action, 'superseded')
  assert.equal(store.stats().facts, 1, '旧值被取代，生效的还是一条')
  assert.deepEqual(store.listFacts(), [{
    subject: '主人', predicate: '昵称', object: '小鱼', confidence: 0.7, validFrom: at + 1_000,
  }])

  const rows = store._db().prepare('SELECT id, object, valid_to, superseded_by FROM facts ORDER BY id').all()
  assert.equal(rows.length, 2)
  assert.equal(rows[0].object, 'EMT')
  assert.equal(rows[0].superseded_by, rows[1].id)
  assert.equal(rows[0].valid_to, at + 1_000)

  for (const bad of [{ subject: '', predicate: '昵称', object: 'EMT' }, { subject: '主人', predicate: '昵称', object: '   ' }]) {
    assert.deepEqual(store.upsertFact(bad), { action: 'skipped', reason: 'empty' })
  }
  store.close()
})

test('事实按主谓存，不同主语互不覆盖', () => {
  const { store } = tempStore()
  const at = Date.now()
  store.upsertFact({ subject: '主人', predicate: '职业', object: '急诊技师', at })
  store.upsertFact({ subject: '小蓝', predicate: '职业', object: '程序员', at })
  assert.equal(store.stats().facts, 2)
  assert.deepEqual(store.listFacts(1).map((fact) => fact.subject), ['小蓝'])
  store.close()
})

test('转长期流水记进 sleep_runs，状态页能计数', () => {
  const { store } = tempStore()
  const at = Date.now()
  assert.equal(store.recordRun({ startedAt: at, finishedAt: at + 500, status: 'ok', tasks: ['facts'], notes: '提炼 2 条' }), true)
  store.upsertFact({ subject: '主人', predicate: '昵称', object: 'EMT', at })
  const stats = store.stats()
  assert.equal(stats.runs, 1)
  assert.equal(stats.facts, 1)

  const row = store._db().prepare('SELECT started_at, status, tasks, notes FROM sleep_runs').get()
  assert.equal(row.started_at, at)
  assert.equal(row.status, 'ok')
  assert.deepEqual(JSON.parse(row.tasks), ['facts'])
  assert.equal(row.notes, '提炼 2 条')
  store.close()
})

test('旧 v2 库打开时补齐章节列、索引和关系表', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fish-mind-store-'))
  const legacy = new DatabaseSync(join(dir, 'mind.sqlite'))
  legacy.exec(`
    CREATE TABLE chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      start_ts INTEGER,
      end_ts INTEGER,
      summary TEXT,
      key_episode_ids TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      start_ts INTEGER NOT NULL,
      end_ts INTEGER NOT NULL,
      title TEXT,
      summary TEXT,
      participants TEXT NOT NULL DEFAULT '[]',
      channel TEXT,
      topic TEXT,
      outcome TEXT,
      importance REAL NOT NULL DEFAULT 0,
      chapter_id INTEGER REFERENCES chapters(id),
      session_id TEXT NOT NULL DEFAULT '',
      source_trust REAL NOT NULL DEFAULT 0.8,
      entities TEXT NOT NULL DEFAULT '[]'
    );
    PRAGMA user_version = 2;
  `)
  legacy.close()

  const store = openStore({ dir })
  assert.equal(store.stats().degraded, false)
  const columns = store._db().prepare('PRAGMA table_info(chapters)').all().map((row) => row.name)
  for (const name of ['parent_id', 'level', 'scope', 'entities', 'importance', 'channel', 'source_trust']) {
    assert.ok(columns.includes(name), name)
  }
  assert.equal(store._db().prepare('PRAGMA user_version').get().user_version, 3)
  store.insert(record('今天在咖啡馆见到小蓝', { at: Date.now() }))
  store.upsertFact({ subject: '小蓝', predicate: '喜欢', object: '咖啡馆' })
  assert.equal(store.listRelations().length, 1)
  const built = store.buildChapters({ force: true })
  assert.equal(built.built, true)
  assert.ok(store.stats().chapters > 0)
  store.close()
})

test('章节树按日、周、月分层，群聊单独成树，导入记录不编进亲历', () => {
  const { store } = tempStore()
  const noon = new Date()
  noon.setHours(12, 0, 0, 0)
  const at = noon.getTime()
  const socialId = 'session-qq-social-group-7'

  store.insert(record('早上在咖啡馆写代码', { at: at - 2 * 3_600_000, seq: 1 }))
  store.insert(record('下午去公园散步，风很舒服', { at: at + 2 * 3_600_000, seq: 2 }))
  store.insert(record('群里在聊火星基地的矿石', {
    at, sessionId: socialId, seq: 1, source: 'qq-group', kind: 'user',
  }))
  store.insert(record('旧记录里提到海边的灯塔', {
    at, sessionId: 'qq-import-batch-1', seq: 1, source: 'qq-import', kind: 'user',
  }))

  const built = store.buildChapters({ force: true })
  assert.equal(built.built, true)
  assert.equal(built.days, 2, '主人一天一段，群聊自己一天一段')
  assert.ok(built.weeks >= 2)
  assert.ok(built.months >= 1)

  const tree = store.chapterTree({ months: 3 })
  assert.equal(tree.scope, 'owner')
  const ownerMonth = tree.months[0]
  assert.equal(ownerMonth.level, 'month')
  const ownerWeek = ownerMonth.children[0]
  assert.equal(ownerWeek.level, 'week')
  const ownerDay = ownerWeek.children[0]
  assert.equal(ownerDay.level, 'day')
  assert.equal(ownerDay.episodeCount, 2)
  assert.equal(ownerWeek.episodeCount, 2)
  assert.equal(ownerMonth.episodeCount, 2)
  assert.ok(ownerDay.summary.includes('咖啡馆'))
  assert.ok(!ownerDay.summary.includes('旧记录'), '导入的往事不算亲历')

  const socialDays = store.listChapters(10, { scope: `social:${socialId}` })
  assert.equal(socialDays.length, 1)
  assert.ok(socialDays[0].title.includes('群聊'))
  assert.equal(socialDays[0].episodeCount, 1)
  assert.equal(socialDays[0].scope, 'social')
  assert.ok(socialDays[0].summary.includes('火星基地'))
  assert.ok(!socialDays[0].summary.includes('咖啡馆'), '群聊章节不混入主人私人经历')

  const socialTree = store.chapterTree({ months: 3, scope: `social:${socialId}` })
  assert.equal(socialTree.scope, 'social')
  assert.equal(socialTree.months[0].episodeCount, 1)
  store.close()
})

test('补编码进来的旧经历也会触发章节重建', () => {
  const { store } = tempStore()
  const noon = new Date()
  noon.setHours(12, 0, 0, 0)
  const at = noon.getTime()
  store.insert(record('今天在咖啡馆写代码', { at, seq: 1 }))
  assert.equal(store.buildChapters().built, true)
  assert.equal(store.buildChapters().built, false, '没有新情景就不重编')
  store.insert(record('前天在海边看日落', { at: at - 2 * 24 * 3_600_000, seq: 2 }))
  const rebuilt = store.buildChapters()
  assert.equal(rebuilt.built, true, '旧经历补编码后也要进章节')
  assert.equal(rebuilt.days, 2)
  store.close()
})

test('章节召回先给目录再给情景，群聊只查得到自己的章节', () => {
  const { store } = tempStore()
  const noon = new Date()
  noon.setHours(12, 0, 0, 0)
  const at = noon.getTime()
  const socialId = 'session-qq-social-group-7'
  store.insert(record('「小蓝」今天在咖啡馆陪我坐了一下午', { at, seq: 1 }))
  store.insert(record('咖啡馆的拿铁很好喝', { at: at + 2 * 3_600_000, seq: 2 }))
  store.insert(record('群里在聊火星基地的矿石', {
    at, sessionId: socialId, seq: 1, source: 'qq-group', kind: 'user',
  }))
  store.buildChapters({ force: true })

  const recalled = store.recall('咖啡馆')
  assert.equal(recalled.reason, 'ok')
  assert.ok(recalled.items.length >= 1)
  assert.ok(recalled.chapters.length >= 1)
  const day = recalled.chapters.find((chapter) => chapter.level === 'day')
  assert.ok(day)
  assert.equal(day.episodeCount, 2)
  assert.equal(day.scope, 'owner')
  assert.ok(day.title.includes('月'))

  const opened = store.openChapter(day.id)
  assert.equal(opened.reason, 'ok')
  assert.equal(opened.level, 'day')
  assert.equal(opened.episodes.length, 2)
  assert.ok(opened.episodes[0].excerpt.includes('咖啡馆'))

  const monthChapter = recalled.chapters.find((chapter) => chapter.level === 'month')
  const openedMonth = store.openChapter(monthChapter.id)
  assert.equal(openedMonth.children.length, 1)
  assert.equal(openedMonth.children[0].level, 'week')
  assert.ok(openedMonth.episodes.length >= 1, '月章节用关键情景做入口')

  const social = store.recall('火星基地', { sessionId: socialId })
  assert.ok(social.items.every((item) => item.sessionId === socialId))
  assert.ok(social.chapters.length >= 1)
  assert.ok(social.chapters.every((chapter) => chapter.scope === 'social'))
  assert.ok(social.chapters.every((chapter) => !chapter.title.includes('咖啡馆')))

  const ownerOnly = store.recall('咖啡馆', { sessionId: socialId })
  assert.equal(ownerOnly.items.length, 0, '群聊不能顺着咖啡馆查到主人私事')
  assert.equal(ownerOnly.chapters.length, 0)
  store.close()
})

test('关系边跟着事实更新；重建后章节和关系仍然一致', async () => {
  const { store } = tempStore()
  const at = Date.now()
  store.insert(record('「小蓝」今天在咖啡馆陪我坐了一下午', { at }))
  assert.equal(store.upsertFact({ subject: '小蓝', predicate: '喜欢', object: '咖啡馆', at }).action, 'added')
  let relations = store.listRelations()
  assert.equal(relations.length, 1)
  assert.equal(relations[0].src, '小蓝')
  assert.equal(relations[0].dst, '咖啡馆')

  assert.equal(store.upsertFact({ subject: '小蓝', predicate: '喜欢', object: '鲸鱼', at: at + 1_000 }).action, 'superseded')
  relations = store.listRelations()
  assert.equal(relations.length, 1, '旧关系让位，不留下两条同时生效')
  assert.equal(relations[0].dst, '鲸鱼')

  const recalled = store.recall('小蓝喜欢什么')
  assert.ok(recalled.items.length >= 1)
  assert.ok(recalled.items.some((item) => item.routes.includes('relation')))

  store.buildChapters({ force: true })
  const before = store.stats()
  assert.ok(before.chapters > 0)
  assert.equal(before.relations, 1)
  const rebuilt = await store.rebuild()
  assert.ok(rebuilt.chapters > 0)
  assert.equal(rebuilt.relations, 1)
  const after = store.stats()
  assert.equal(after.chapters, before.chapters)
  assert.equal(after.relations, 1)
  assert.equal(store.listRelations()[0].dst, '鲸鱼')
  assert.equal(store.chapterTree({ months: 3 }).months.length, 1)
  store.close()
})
