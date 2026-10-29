import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyImportedFacts,
  applyPendingImport,
  buildFishArchive,
  importIsPending,
  parseFishArchive,
  readImportReport,
  stageFishImport,
} from '../lib/archive.js'
import { saveIdentity } from '../lib/birth.js'
import { buildDefaults } from '../lib/config.js'
import { buildOverview } from '../lib/overview.js'
import { openStore } from '../lib/store.js'
import { createZip, readZip } from '../lib/zip.js'

const IDENTITY = {
  name: '小鲸',
  species: '虎鲸娘',
  appearance: '黑白配色，短发。',
  ownerAddress: '船长',
  ownerGender: '女',
  origin: '从一片海图里醒来。',
  style: '句子短一点。',
}

function writeSource() {
  const home = mkdtempSync(join(tmpdir(), 'fish-archive-src-'))
  const dir = join(home, 'fish-mind')
  mkdirSync(dir, { recursive: true })
  const store = openStore({ dir, config: buildDefaults(home), diag: () => {} })
  store.upsertFact({
    subject: '阿蓝',
    predicate: '喜欢',
    object: '鲸鱼',
    confidence: 0.9,
    validFrom: 1000,
    source: 'test',
    at: 1000,
  })
  const identity = saveIdentity(dir, IDENTITY, 2000)
  const hash = createHash('sha256').update('hello').digest('hex')
  writeFileSync(join(dir, 'experience.jsonl'), JSON.stringify({
    hash,
    at: 3000,
    kind: 'user/message',
    role: 'user',
    actor: 'owner',
    sessionId: 'session-1',
    sourceKind: 'user',
    text: '【QQ 群聊·群 555666777】今天去看海了',
  }) + '\n')
  mkdirSync(join(home, 'feiyu-mood'), { recursive: true })
  writeFileSync(join(home, 'feiyu-mood', 'state.json'), JSON.stringify({
    mood: 72,
    dims: { happy: 80, calm: 60 },
    lastReason: '一起看海',
    updatedAt: 3500,
    lastDecayAt: 3600,
    timeline: [{ at: 3500, mood: 72, delta: 6, reason: '一起看海', dims: { happy: 80 } }],
  }, null, 2))
  writeFileSync(join(home, 'qq-social-people.json'), JSON.stringify({
    version: 1,
    people: {
      'qq-123456789': {
        名: '阿蓝',
        别名: ['蓝'],
        主人: false,
        关系: { 熟: 60, 暖: 70, 张力: 5, 见过: 4, 记忆: [{ 文: '一起看过海' }] },
        房: { 'group:987654321': { 熟: 30, 互动: 12 } },
        事实: [{ 文: '喜欢鲸鱼' }],
        边界: [{ 文: '不想被深夜打扰' }],
        最后At: 4000,
      },
    },
  }, null, 2))
  writeFileSync(join(home, 'qq-bridge-config.json'), JSON.stringify({
    总开关: true,
    试运行: false,
    私聊QQ: '10001',
    群号: '20002',
    社交: { 启用: true, 试运行: true },
  }))
  writeFileSync(join(home, 'speak-up-config.json'), JSON.stringify({ 总开关: true, 试运行: true, 目标会话: ['session-1'] }))
  writeFileSync(join(home, 'tts-bridge.json'), JSON.stringify({ watch: [], favorites: ['a', 'b'], panel: false }))
  mkdirSync(join(home, 'bili-duty'), { recursive: true })
  writeFileSync(join(home, 'bili-duty', 'config.json'), JSON.stringify({
    perDay: 3,
    peakValley: true,
    autoComment: false,
    targetSession: 'session-1',
  }))
  return { home, dir, store, identity }
}

test('整条鱼能打包再读回，校验数量、身份、心情和人物志', () => {
  const source = writeSource()
  const bundle = buildFishArchive({
    dir: source.dir,
    dshHome: source.home,
    store: source.store,
    identity: source.identity,
    pluginVersion: '0.4.0',
    now: 1_700_000_000_000,
  })
  assert.match(bundle.fileName, /^mydearfish-2023-11-1[45]\.zip$/)
  assert.deepEqual(bundle.counts, { experiences: 1, facts: 1, moodPoints: 1, people: 1 })

  const parsed = parseFishArchive(bundle.buffer)
  assert.equal(parsed.identity.name, '小鲸')
  assert.equal(parsed.identity.ownerGender, '女')
  assert.equal(parsed.experience.length, 1)
  assert.equal(parsed.experience[0].text, '【QQ 群聊·群 555666777】今天去看海了')
  assert.deepEqual(parsed.facts, [{ subject: '阿蓝', predicate: '喜欢', object: '鲸鱼', confidence: 0.9, validFrom: 1000 }])
  assert.equal(parsed.mood.mood, 72)
  assert.equal(parsed.mood.timeline.length, 1)
  assert.equal(Object.keys(parsed.people).length, 1)
  assert.equal(parsed.people['qq-123456789'].名, '阿蓝')
  source.store.close()
})

test('格式、校验、文件清单不对都拒绝导入', () => {
  const source = writeSource()
  const bundle = buildFishArchive({
    dir: source.dir,
    dshHome: source.home,
    store: source.store,
    identity: source.identity,
  })
  source.store.close()

  assert.throws(() => parseFishArchive(Buffer.from('这不是 zip')), /不是有效的 zip/)

  const original = readZip(bundle.buffer)
  const tampered = new Map(original)
  tampered.set('memory/experience.jsonl', Buffer.from(
    original.get('memory/experience.jsonl').toString('utf8').replace('看海', '看山'),
  ))
  const badChecksum = createZip([...tampered].map(([name, data]) => ({ name, data })))
  assert.throws(() => parseFishArchive(badChecksum), /校验失败/)

  const extra = new Map(original)
  extra.set('evil.txt', Buffer.from('x'))
  assert.throws(() => parseFishArchive(createZip([...extra].map(([name, data]) => ({ name, data })))), /不认识的文件/)

  const encrypted = Buffer.from(bundle.buffer)
  encrypted.writeUInt16LE(1, 6)
  const central = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  encrypted.writeUInt16LE(1, central + 8)
  assert.throws(() => parseFishArchive(encrypted), /加密/)

  const descriptor = Buffer.from(bundle.buffer)
  descriptor.writeUInt16LE(0x0008, 6)
  const descriptorCentral = descriptor.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  descriptor.writeUInt16LE(0x0008, descriptorCentral + 8)
  assert.throws(() => parseFishArchive(descriptor), /data descriptor/)

  assert.throws(() => createZip([{ name: '../evil', data: 'x' }]), /路径不合法/)
  assert.throws(() => createZip([{ name: 'C:/evil', data: 'x' }]), /绝对路径/)
})

test('失败的导入不动现有数据；非空鱼拒绝导入', () => {
  const source = writeSource()
  const bundle = buildFishArchive({
    dir: source.dir,
    dshHome: source.home,
    store: source.store,
    identity: source.identity,
  })
  source.store.close()

  const home = mkdtempSync(join(tmpdir(), 'fish-archive-target-'))
  const dir = join(home, 'fish-mind')
  mkdirSync(dir, { recursive: true })
  const experience = join(dir, 'experience.jsonl')
  const line = JSON.stringify({ hash: 'a'.repeat(64), at: 1, kind: 'user/message', text: '原来的经历' }) + '\n'
  writeFileSync(experience, line)

  assert.throws(() => stageFishImport({ dir, dshHome: home, buffer: Buffer.from('坏包') }), /不是有效的 zip/)
  assert.equal(readFileSync(experience, 'utf8'), line)
  assert.equal(importIsPending(dir), false)

  assert.throws(() => stageFishImport({ dir, dshHome: home, buffer: bundle.buffer }), (error) => {
    assert.equal(error.statusCode, 409)
    assert.match(error.message, /不能直接导入覆盖/)
    return true
  })
  assert.equal(importIsPending(dir), false)
  assert.equal(readFileSync(experience, 'utf8'), line)
})

test('导入到空鱼：验包、暂存、重启时应用、备份并写回事实', () => {
  const source = writeSource()
  const bundle = buildFishArchive({
    dir: source.dir,
    dshHome: source.home,
    store: source.store,
    identity: source.identity,
  })
  source.store.close()

  const home = mkdtempSync(join(tmpdir(), 'fish-archive-apply-'))
  const dir = join(home, 'fish-mind')
  mkdirSync(dir, { recursive: true })

  const staged = stageFishImport({ dir, dshHome: home, buffer: bundle.buffer, now: 5000 })
  assert.equal(staged.ok, true)
  assert.equal(staged.pending, true)
  assert.deepEqual(staged.counts, { experiences: 1, facts: 1, moodPoints: 1, people: 1 })
  assert.equal(importIsPending(dir), true)
  assert.equal(existsSync(join(dir, 'experience.jsonl')), false)

  const report = applyPendingImport({ dir, dshHome: home })
  assert.equal(report.ok, true)
  assert.equal(report.counts.experiences, 1)
  assert.equal(report.counts.facts, 1)
  assert.equal(importIsPending(dir), false)
  assert.equal(existsSync(join(dir, 'import-report.json')), true)
  assert.ok(existsSync(report.backup))
  assert.equal(readFileSync(join(dir, 'experience.jsonl'), 'utf8').includes('今天去看海了'), true)
  assert.equal(JSON.parse(readFileSync(join(dir, 'identity.json'), 'utf8')).name, '小鲸')
  assert.equal(JSON.parse(readFileSync(join(home, 'feiyu-mood', 'state.json'), 'utf8')).mood, 72)
  assert.equal(JSON.parse(readFileSync(join(home, 'qq-social-people.json'), 'utf8')).people['qq-123456789'].名, '阿蓝')
  assert.deepEqual(readImportReport(dir), report)

  const store = openStore({ dir, config: buildDefaults(home), diag: () => {} })
  const written = applyImportedFacts({ dir, store, diag: () => {} })
  assert.equal(written, 1)
  assert.equal(store.listFacts(5)[0].object, '鲸鱼')
  assert.equal(existsSync(join(dir, 'import-facts.json')), false)
  assert.equal(readImportReport(dir).factsApplied, 1)
  store.close()
})

test('设置页总览带完整画像，但不带 QQ 号、群号和本机路径', () => {
  const source = writeSource()
  source.store.catchUpFromJsonl()
  const overview = buildOverview({
    dir: source.dir,
    dshHome: source.home,
    identity: source.identity,
    defaults: IDENTITY,
    limits: { name: 24, species: 40 },
    store: source.store,
    budget: {
      enabled: true,
      dailyGrantCny: 10,
      availableCny: 9.5,
      spentTodayCny: 0.5,
      callsToday: 2,
      unmeteredToday: 0,
      account: null,
    },
    backup: {
      enabled: true,
      intervalHours: 12,
      keep: 5,
      dirName: 'fish-backups',
      count: 1,
      lastAt: 3000,
      nextAt: 3000 + 12 * 60 * 60 * 1000,
      due: false,
      files: [{ name: 'mydearfish-2026-10-27-164530.zip', bytes: 2048, at: 3000 }],
      lastRun: { at: 3000, ok: true, reason: 'tick', fileName: 'mydearfish-2026-10-27-164530.zip', bytes: 2048, pruned: 0 },
    },
    permissions: {
      enabled: true,
      emergencyStop: false,
      protectedReadPaths: ['a', 'b'],
      protectedWritePaths: ['a'],
      sealedWritePaths: ['c'],
      mcpReadOnlyTools: ['get_*'],
      hard: { dangerousCommands: true, credentialStores: 3 },
      autonomous: { enabled: false },
    },
    privacy: { exactFacts: 8, learnedSecrets: 2, hardGuards: ['stream-redaction'], stats: { streamHits: 1 } },
    injection: { fixedRule: true, untrustedResults: 2, suspiciousResults: 1 },
    phase: '影子运行',
    now: 4000,
  })
  assert.equal(overview.identity.name, '小鲸')
  assert.equal(overview.identity.limits.name, 24)
  assert.equal(overview.memory.total, 1)
  assert.equal(overview.mood.available, true)
  assert.equal(overview.mood.label, '开心')
  assert.equal(overview.social.count, 1)
  assert.equal(overview.social.people[0].name, '阿蓝')
  assert.deepEqual(overview.social.people[0].rooms, [{ kind: '群聊', familiar: 30, interactions: 12 }])
  assert.equal(overview.channels.qq.enabled, true)
  assert.equal(overview.channels.speakUp.targets, 1)
  assert.equal(overview.channels.tts.panelOpen, false)
  assert.equal(overview.channels.bili.perDay, 3)
  assert.equal(overview.wallet.availableCny, 9.5)
  assert.equal(overview.boundaries.permissions.protectedReadPaths, 2)
  assert.equal(overview.archive.pending, false)
  assert.equal(overview.backup.enabled, true)
  assert.equal(overview.backup.intervalHours, 12)
  assert.equal(overview.backup.count, 1)
  assert.equal(overview.backup.files[0].name, 'mydearfish-2026-10-27-164530.zip')
  assert.equal(overview.backup.lastRun.ok, true)

  const serialized = JSON.stringify(overview)
  assert.equal(serialized.includes('123456789'), false)
  assert.equal(serialized.includes('987654321'), false)
  assert.equal(serialized.includes('555666777'), false)
  assert.equal(overview.memory.recent[0].text.includes('群 ***'), true)
  assert.equal(serialized.includes(source.home), false)
  source.store.close()
})
