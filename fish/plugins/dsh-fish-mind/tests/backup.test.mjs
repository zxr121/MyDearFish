import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseFishArchive } from '../lib/archive.js'
import {
  BACKUP_KEEP,
  backupDir,
  backupFileName,
  backupIsDue,
  describeBackups,
  listBackups,
  writeBackup,
} from '../lib/backup.js'
import { saveIdentity } from '../lib/birth.js'
import { buildDefaults } from '../lib/config.js'
import { openStore } from '../lib/store.js'

function writeSource() {
  const home = mkdtempSync(join(tmpdir(), 'fish-backup-'))
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
  const identity = saveIdentity(dir, {
    name: '小鲸',
    species: '虎鲸娘',
    appearance: '黑白配色，短发。',
    ownerAddress: '船长',
    origin: '从一片海图里醒来。',
    style: '句子短一点。',
  }, 2000)
  writeFileSync(join(dir, 'experience.jsonl'), JSON.stringify({
    hash: createHash('sha256').update('hello').digest('hex'),
    at: 3000,
    kind: 'user/message',
    role: 'user',
    actor: 'owner',
    text: '今天去看海了',
  }) + '\n')
  return { home, dir, store, identity }
}

test('自动备份写到安装目录，文件名带秒，能重新读回', () => {
  const source = writeSource()
  const now = new Date(2026, 9, 27, 16, 45, 30).getTime()
  const result = writeBackup({
    dir: source.dir,
    dshHome: source.home,
    store: source.store,
    identity: source.identity,
    pluginVersion: '0.2.75',
    now,
  })
  assert.equal(result.ok, true)
  assert.equal(result.fileName, 'mydearfish-2026-10-27-164530.zip')
  assert.equal(result.path, join(backupDir(source.home), result.fileName))
  assert.deepEqual(result.pruned, [])
  assert.equal(backupFileName(now), result.fileName)

  const parsed = parseFishArchive(readFileSync(result.path))
  assert.equal(parsed.identity.name, '小鲸')
  assert.equal(parsed.experience.length, 1)
  assert.equal(parsed.facts.length, 1)
  assert.deepEqual(result.counts, { experiences: 1, facts: 1, moodPoints: 0, people: 0, configs: 0 })

  const listed = listBackups({ dshHome: source.home })
  assert.equal(listed.length, 1)
  assert.equal(listed[0].name, result.fileName)
  assert.equal(listed[0].bytes, result.bytes)
  source.store.close()
})

test('最多保留 5 份，只删除自己写出的备份文件', () => {
  const source = writeSource()
  const folder = backupDir(source.home)
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'notes.txt'), '主人自己的笔记')
  writeFileSync(join(folder, 'mydearfish-2020-01-01.zip'), '手动起的名字，别动')
  mkdirSync(join(folder, 'mydearfish-2020-01-02-000000.zip'))

  const base = new Date(2026, 9, 27, 8, 0, 0).getTime()
  const names = []
  for (let index = 0; index < 7; index += 1) {
    const result = writeBackup({
      dir: source.dir,
      dshHome: source.home,
      store: source.store,
      identity: source.identity,
      now: base + index * 60 * 60 * 1000,
    })
    names.push(result.fileName)
  }
  assert.equal(names.length, 7)

  const kept = listBackups({ dshHome: source.home })
  assert.equal(BACKUP_KEEP, 5)
  assert.equal(kept.length, 5)
  assert.deepEqual(kept.map((file) => file.name), names.slice(2).reverse())
  assert.equal(existsSync(join(folder, names[0])), false)
  assert.equal(existsSync(join(folder, names[1])), false)
  assert.equal(existsSync(join(folder, 'notes.txt')), true)
  assert.equal(existsSync(join(folder, 'mydearfish-2020-01-01.zip')), true)
  assert.equal(existsSync(join(folder, 'mydearfish-2020-01-02-000000.zip')), true)

  const status = describeBackups({
    dshHome: source.home,
    enabled: true,
    intervalHours: 24,
    now: base + 6 * 60 * 60 * 1000,
  })
  assert.equal(status.count, 5)
  assert.equal(status.keep, 5)
  assert.equal(status.dirName, 'fish-backups')
  assert.equal(status.files.length, 5)
  assert.equal(status.files[0].name, names[6])
  assert.equal(status.lastAt, status.files[0].at)
  assert.equal(JSON.stringify(status).includes(source.home), false, '总览状态不带绝对路径')

  assert.equal(backupIsDue({ dshHome: source.home, intervalHours: 24, now: status.lastAt + 60 * 60 * 1000 }), false)
  assert.equal(backupIsDue({ dshHome: source.home, intervalHours: 24, now: status.lastAt + 25 * 60 * 60 * 1000 }), true)
  source.store.close()
})

test('同一秒内连续备份不会互相覆盖', () => {
  const source = writeSource()
  const now = new Date(2026, 9, 27, 16, 45, 30).getTime()
  const first = writeBackup({ dir: source.dir, dshHome: source.home, store: source.store, identity: source.identity, now })
  const second = writeBackup({ dir: source.dir, dshHome: source.home, store: source.store, identity: source.identity, now })
  assert.equal(first.fileName, 'mydearfish-2026-10-27-164530.zip')
  assert.equal(second.fileName, 'mydearfish-2026-10-27-164530-2.zip')
  assert.equal(listBackups({ dshHome: source.home }).length, 2)
  source.store.close()
})

test('备份目录被同名文件占住时直接报错，不往别处写', () => {
  const source = writeSource()
  const folder = backupDir(source.home)
  writeFileSync(folder, '不是目录')
  assert.throws(
    () => writeBackup({ dir: source.dir, dshHome: source.home, store: source.store, identity: source.identity }),
    /备份目录不是普通文件夹/,
  )
  assert.equal(readdirSync(source.home).includes('fish-backups'), true)
  source.store.close()
})
