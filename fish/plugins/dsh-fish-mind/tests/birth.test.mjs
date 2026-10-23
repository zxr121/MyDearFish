import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_IDENTITY,
  buildSelfPrompt,
  loadIdentity,
  resetIdentity,
  saveIdentity,
  syncMoodNames,
} from '../lib/birth.js'

test('出生设定能保存、读回、重置；坏文件退回出厂值', () => {
  const home = mkdtempSync(join(tmpdir(), 'fish-birth-'))
  const dir = join(home, 'fish-mind')
  mkdirSync(dir, { recursive: true })

  assert.deepEqual(loadIdentity(dir), { ...DEFAULT_IDENTITY })

  const saved = saveIdentity(dir, {
    name: '  小鲸  ',
    species: '虎鲸娘',
    appearance: '黑白配色，短发。',
    ownerAddress: '船长',
    origin: '从一片海图里醒来。',
    style: '句子短一点。',
  }, 1234)
  assert.equal(saved.name, '小鲸')
  assert.equal(saved.ownerAddress, '船长')
  assert.equal(saved.updatedAt, 1234)

  const onDisk = JSON.parse(readFileSync(join(dir, 'identity.json'), 'utf8'))
  assert.equal(onDisk.format, 'mydearfish.identity')
  assert.equal(onDisk.version, 1)
  assert.equal(loadIdentity(dir).species, '虎鲸娘')

  const before = readFileSync(join(dir, 'identity.json'), 'utf8')
  assert.throws(() => saveIdentity(dir, {
    name: '',
    species: '虎鲸娘',
    appearance: 'x',
    ownerAddress: '船长',
  }), /名字不能为空/)
  assert.equal(readFileSync(join(dir, 'identity.json'), 'utf8'), before)

  const prompt = buildSelfPrompt(saved)
  assert.ok(prompt.includes('小鲸'))
  assert.ok(prompt.includes('虎鲸娘'))
  assert.ok(prompt.includes('黑白配色，短发。'))
  assert.ok(prompt.includes('船长'))
  assert.ok(prompt.includes('句子短一点。'))
  assert.ok(prompt.includes('权限层也会拒绝改鱼脑代码'))

  const reset = resetIdentity(dir, 5678)
  assert.equal(reset.name, DEFAULT_IDENTITY.name)
  assert.equal(loadIdentity(dir).updatedAt, 5678)

  writeFileSync(join(dir, 'identity.json'), '{坏掉的 json')
  assert.deepEqual(loadIdentity(dir), { ...DEFAULT_IDENTITY })
})

test('改出生设定会同步心情插件的名字，其他心情配置原样保留', () => {
  const home = mkdtempSync(join(tmpdir(), 'fish-birth-sync-'))
  const dir = join(home, 'fish-mind')
  mkdirSync(dir, { recursive: true })
  mkdirSync(join(home, 'feiyu-mood'), { recursive: true })
  const moodPath = join(home, 'feiyu-mood', 'config.json')
  writeFileSync(moodPath, JSON.stringify({ selfName: '旧名字', ownerName: '旧称呼', moodBase: 70, trial: true }, null, 2))

  const saved = saveIdentity(dir, {
    name: '小鲸',
    species: '虎鲸娘',
    appearance: '黑白配色。',
    ownerAddress: '船长',
    origin: '',
    style: '',
  })
  assert.equal(syncMoodNames(home, saved), true)
  const mood = JSON.parse(readFileSync(moodPath, 'utf8'))
  assert.equal(mood.selfName, '小鲸')
  assert.equal(mood.ownerName, '船长')
  assert.equal(mood.moodBase, 70)
  assert.equal(mood.trial, true)
  assert.equal(syncMoodNames(home, saved), false)
})
