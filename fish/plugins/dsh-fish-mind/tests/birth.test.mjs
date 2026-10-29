import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_IDENTITY,
  buildSelfPrompt,
  loadIdentity,
  normalizeIdentityInput,
  parseIdentityDocument,
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
    ownerGender: '女',
    origin: '从一片海图里醒来。',
    style: '句子短一点。',
    relations: [
      { name: ' 时光 ', relation: ' 妈妈 ' },
      { name: '小陈', relation: '' },
      { name: '时光', relation: '干妈' },
    ],
  }, 1234)
  assert.equal(saved.name, '小鲸')
  assert.equal(saved.ownerAddress, '船长')
  assert.equal(saved.ownerGender, '女')
  assert.equal(saved.updatedAt, 1234)
  assert.deepEqual(saved.relations, [{ name: '时光', relation: '干妈' }])

  const onDisk = JSON.parse(readFileSync(join(dir, 'identity.json'), 'utf8'))
  assert.equal(onDisk.format, 'mydearfish.identity')
  assert.equal(onDisk.version, 1)
  assert.equal(onDisk.ownerGender, '女')
  assert.deepEqual(onDisk.relations, [{ name: '时光', relation: '干妈' }])
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
  assert.ok(prompt.includes('主人是女性，提到主人时用「她」'))
  assert.ok(prompt.includes('句子短一点。'))
  assert.ok(prompt.includes('时光：干妈'))
  assert.ok(prompt.includes('这些关系是固定的'))
  assert.ok(prompt.includes('权限层也会拒绝改鱼脑代码'))

  const reset = resetIdentity(dir, 5678)
  assert.equal(reset.name, DEFAULT_IDENTITY.name)
  assert.equal(loadIdentity(dir).updatedAt, 5678)

  writeFileSync(join(dir, 'identity.json'), '{坏掉的 json')
  assert.deepEqual(loadIdentity(dir), { ...DEFAULT_IDENTITY })
})

test('群友关系只留填齐的条目，最多 12 条；出厂设定不写人际关系', () => {
  const base = {
    name: '大肥鱼',
    species: '鲸鱼娘',
    appearance: '蓝白色长发。',
    ownerAddress: '主人',
    origin: '',
    style: '',
  }
  const many = Array.from({ length: 15 }, (_, i) => ({ name: `群友${i}`, relation: '朋友' }))
  const normalized = normalizeIdentityInput({ ...base, relations: [...many, { name: '没填关系' }, null] })
  assert.equal(normalized.relations.length, 12)
  assert.deepEqual(normalized.relations[0], { name: '群友0', relation: '朋友' })
  assert.equal(normalized.relations.some((item) => item.name === '没填关系'), false)
  assert.equal(buildSelfPrompt(DEFAULT_IDENTITY).includes('你认下的人际关系'), false)
})

test('主人的性别只能是「女」「男」或「未说」；旧身份文件里的代词会读成对应性别', () => {
  const base = {
    name: '大肥鱼',
    species: '鲸鱼娘',
    appearance: '蓝白色长发。',
    ownerAddress: '主人',
    origin: '',
    style: '',
  }
  assert.equal(normalizeIdentityInput(base).ownerGender, '未说')
  assert.equal(normalizeIdentityInput({ ...base, ownerGender: '女' }).ownerGender, '女')
  assert.equal(normalizeIdentityInput({ ...base, ownerPronoun: '她' }).ownerGender, '女')
  assert.equal(normalizeIdentityInput({ ...base, ownerPronoun: '他' }).ownerGender, '男')
  assert.equal(normalizeIdentityInput({ ...base, ownerPronoun: 'TA' }).ownerGender, '未说')
  assert.equal(parseIdentityDocument({
    format: 'mydearfish.identity',
    version: 1,
    ...base,
    ownerPronoun: '她',
    updatedAt: 1,
  }).ownerGender, '女')
  assert.throws(() => normalizeIdentityInput({ ...base, ownerGender: '少女' }), /「女」「男」或「未说」/)
  assert.ok(buildSelfPrompt({ ...base, ownerGender: '男' }).includes('主人是男性，提到主人时用「他」'))
  assert.ok(buildSelfPrompt({ ...base, ownerGender: '未说' }).includes('不要猜着用「他」或「她」'))
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
