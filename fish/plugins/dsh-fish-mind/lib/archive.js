// 大肥鱼的搬家包：整条鱼导出成一个 zip，导入时严格验包、只进空鱼。
//
// 包里装的是「经历」：出生设定、经历流、长期事实、心情、QQ 人物志和短期提炼水位；
// 另外把本机设置按白名单塞进 manifest.configs，旧版会忽略这一段、只导入记忆。
// 不装凭据、账号、群号、目标会话、零花钱账本、诊断日志、SQLite 派生库和收藏数据；
// 这些跟这台机器、这个账号绑定，换一台机器要重新配。
//
// 导入分两步：设置页上传后先落到 .import-pending，重启时在打开 SQLite 之前应用。
// 这样导入要么整包生效，要么原样退回；中途失败会留下备份和 import-report.json。
// 配置先应用、身份后应用，避免旧称呼盖掉新身份；单份配置坏只跳过，不阻断记忆导入。

import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'
import {
  IDENTITY_FORMAT,
  IDENTITY_VERSION,
  parseIdentityDocument,
  saveIdentity,
  syncMoodNames,
} from './birth.js'
import { applyPortableConfigs, collectPortableConfigs, parsePortableConfigs, PORTABLE_CONFIGS } from './portable-configs.js'
import { createZip, readZip } from './zip.js'

export const ARCHIVE_FORMAT = 'mydearfish.fish'
export const ARCHIVE_VERSION = 1

const PENDING_DIR = '.import-pending'
const REPORT_FILE = 'import-report.json'
const IMPORT_FACTS_FILE = 'import-facts.json'

const MAX_EXPERIENCES = 500000
const MAX_FACTS = 20000
const MAX_PEOPLE = 300
const MAX_PEOPLE_BYTES = 4 * 1024 * 1024
const MAX_MOOD_POINTS = 5000
const MAX_LINE_CHARS = 2_000_000
const MAX_REASON_CHARS = 500

const ALLOWED_FILES = new Set([
  'manifest.json',
  'identity.json',
  'memory/experience.jsonl',
  'memory/facts.json',
  'memory/working.json',
  'mood.json',
  'people.json',
])

const REQUIRED_FILES = ['identity.json', 'memory/experience.jsonl', 'memory/facts.json']
const DIMS = ['happy', 'calm', 'sweet', 'heartache', 'worry', 'sad', 'jealous']

function bad(message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function cleanText(value, max) {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max)
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.tmp`
  writeFileSync(temp, data)
  renameSync(temp, path)
}

function writeAtomicJson(path, value) {
  writeAtomic(path, JSON.stringify(value, null, 2) + '\n')
}

function copyIfExists(source, target, label) {
  if (!existsSync(source)) return false
  try {
    copyFileSync(source, target)
    return true
  } catch (error) {
    throw bad(`备份${label}失败：${String((error && error.message) || error)}`, 500)
  }
}

function stamp(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

/** 导出文件名，带日期方便主人自己归档。 */
export function archiveFileName(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `mydearfish-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.zip`
}

function identityDocument(identity, now) {
  const updatedAt = finite(identity && identity.updatedAt)
  const parsed = parseIdentityDocument({
    format: IDENTITY_FORMAT,
    version: IDENTITY_VERSION,
    ...identity,
    updatedAt: updatedAt === null ? now : updatedAt,
  })
  return { format: IDENTITY_FORMAT, version: IDENTITY_VERSION, ...parsed }
}

function parseExperienceJsonl(text, warnings) {
  const lines = String(text).split('\n')
  const records = []
  let skipped = 0
  for (const line of lines) {
    if (line.trim() === '') continue
    if (line.length > MAX_LINE_CHARS) {
      skipped += 1
      continue
    }
    let record
    try {
      record = JSON.parse(line)
    } catch {
      skipped += 1
      continue
    }
    if (!isPlainObject(record)) {
      skipped += 1
      continue
    }
    const at = finite(record.at)
    const hash = typeof record.hash === 'string' ? record.hash : ''
    if (at === null || !/^[0-9a-f]{64}$/i.test(hash) || typeof record.kind !== 'string' || record.kind === '') {
      skipped += 1
      continue
    }
    if (record.text !== undefined && typeof record.text !== 'string') {
      skipped += 1
      continue
    }
    if (record.meta !== undefined && !isPlainObject(record.meta)) {
      skipped += 1
      continue
    }
    records.push({
      ...record,
      at,
      hash: hash.toLowerCase(),
      sessionId: record.sessionId === undefined ? '' : String(record.sessionId).slice(0, 200),
      text: record.text === undefined ? '' : record.text.slice(0, MAX_LINE_CHARS),
    })
    if (records.length > MAX_EXPERIENCES) throw bad(`经历太多，一次最多导入 ${MAX_EXPERIENCES} 条`)
  }
  if (skipped > 0) warnings.push(`经历流里有 ${skipped} 行格式不对，已跳过`)
  if (records.length === 0 && lines.some((line) => line.trim() !== '')) {
    throw bad('经历流里没有一条能读懂的记录')
  }
  return records
}

function parseFactsDocument(raw, warnings = []) {
  if (!isPlainObject(raw)) throw bad('长期事实文件不是对象')
  if (raw.format !== 'mydearfish.facts' || raw.version !== 1) throw bad('长期事实文件版本不对')
  if (!Array.isArray(raw.facts)) throw bad('长期事实文件缺少 facts 列表')
  if (raw.facts.length > MAX_FACTS) throw bad(`长期事实太多，一次最多导入 ${MAX_FACTS} 条`)
  const facts = []
  const seen = new Set()
  let skipped = 0
  for (const item of raw.facts) {
    if (!isPlainObject(item)) {
      skipped += 1
      continue
    }
    const subject = cleanText(item.subject, 60).replace(/\s+/g, ' ')
    const predicate = cleanText(item.predicate, 60).replace(/\s+/g, ' ')
    const object = cleanText(item.object, 240).replace(/\s+/g, ' ')
    if (subject === '' || predicate === '' || object === '') {
      skipped += 1
      continue
    }
    const key = `${subject}\u0000${predicate}\u0000${object}`
    if (seen.has(key)) continue
    seen.add(key)
    const confidence = finite(item.confidence)
    const validFrom = finite(item.validFrom)
    facts.push({
      subject,
      predicate,
      object,
      confidence: confidence === null ? 0.7 : Math.min(1, Math.max(0, confidence)),
      validFrom: validFrom === null ? undefined : validFrom,
    })
  }
  if (skipped > 0) warnings.push(`长期事实里有 ${skipped} 条不完整，已跳过`)
  return facts
}

function parseMoodDocument(raw, warnings = []) {
  if (!isPlainObject(raw)) throw bad('心情文件不是对象')
  if (raw.format !== 'mydearfish.mood' || raw.version !== 1) throw bad('心情文件版本不对')
  const state = raw.state
  if (!isPlainObject(state)) throw bad('心情文件缺少 state')
  const mood = finite(state.mood)
  if (mood === null) throw bad('心情文件缺少 mood 数值')
  const dims = {}
  for (const key of DIMS) {
    const value = finite(isPlainObject(state.dims) ? state.dims[key] : undefined)
    dims[key] = value === null ? 0 : Math.min(100, Math.max(0, value))
  }
  const timeline = []
  if (Array.isArray(state.timeline)) {
    for (const item of state.timeline.slice(-MAX_MOOD_POINTS)) {
      if (!isPlainObject(item)) continue
      const at = finite(item.at)
      if (at === null) continue
      const pointMood = finite(item.mood)
      const pointDelta = finite(item.delta)
      const pointDims = {}
      if (isPlainObject(item.dims)) {
        for (const key of DIMS) {
          const value = finite(item.dims[key])
          if (value !== null) pointDims[key] = Math.min(100, Math.max(0, value))
        }
      }
      const point = {
        at,
        mood: pointMood === null ? Math.min(100, Math.max(0, mood)) : Math.min(100, Math.max(0, pointMood)),
        delta: pointDelta === null ? 0 : Math.max(-100, Math.min(100, pointDelta)),
        reason: cleanText(item.reason, MAX_REASON_CHARS),
        dims: pointDims,
      }
      timeline.push(point)
    }
    if (state.timeline.length > MAX_MOOD_POINTS) {
      warnings.push(`心情时间线超过 ${MAX_MOOD_POINTS} 条，只保留最近的`)
    }
  }
  const updatedAt = finite(state.updatedAt)
  const lastDecayAt = finite(state.lastDecayAt)
  return {
    mood: Math.min(100, Math.max(0, mood)),
    dims,
    lastReason: cleanText(state.lastReason, MAX_REASON_CHARS),
    updatedAt: updatedAt === null ? 0 : updatedAt,
    lastDecayAt: lastDecayAt === null ? 0 : lastDecayAt,
    timeline,
  }
}

function parsePeopleDocument(raw, warnings = []) {
  if (!isPlainObject(raw)) throw bad('人物志文件不是对象')
  if (raw.format !== 'mydearfish.people' || raw.version !== 1) throw bad('人物志文件版本不对')
  if (!isPlainObject(raw.people)) throw bad('人物志文件缺少 people')
  const people = {}
  let count = 0
  let skipped = 0
  for (const [key, value] of Object.entries(raw.people)) {
    if (typeof key !== 'string' || key.length === 0 || key.length > 64 || /[\u0000-\u001f]/.test(key)) {
      skipped += 1
      continue
    }
    if (!isPlainObject(value)) {
      skipped += 1
      continue
    }
    const serialized = JSON.stringify(value)
    if (serialized.length > 16384) {
      skipped += 1
      continue
    }
    people[key] = value
    count += 1
    if (count > MAX_PEOPLE) throw bad(`人物志超过 ${MAX_PEOPLE} 人，不能导入`)
  }
  if (skipped > 0) warnings.push(`人物志里有 ${skipped} 条读不懂，已跳过`)
  return people
}

function parseWorkingDocument(raw) {
  if (!isPlainObject(raw)) return { lastConsolidatedAt: 0, lastConsolidatedId: 0 }
  const at = finite(raw.lastConsolidatedAt)
  const id = finite(raw.lastConsolidatedId)
  return {
    lastConsolidatedAt: at === null || at < 0 ? 0 : at,
    // 导入包里不带 id 是旧包；导入后经历库会按 JSONL 重排，id 本来也要重新校验。
    lastConsolidatedId: id === null || id < 0 ? 0 : id,
  }
}

function readExperienceFile(dir, warnings) {
  const path = join(dir, 'experience.jsonl')
  if (!existsSync(path)) return { records: [], text: '' }
  const text = readFileSync(path, 'utf8')
  const records = parseExperienceJsonl(text, warnings)
  return { records, text: records.map((record) => JSON.stringify(record)).join('\n') + (records.length > 0 ? '\n' : '') }
}

function readMoodFile(dshHome, warnings) {
  const path = join(dshHome, 'feiyu-mood', 'state.json')
  if (!existsSync(path)) return null
  try {
    return parseMoodDocument({
      format: 'mydearfish.mood',
      version: 1,
      state: readJson(path),
    }, warnings)
  } catch (error) {
    warnings.push(`心情状态读不出来，这次没有带进包里（${String((error && error.message) || error)}）`)
    return null
  }
}

function readPeopleFile(dshHome, warnings) {
  const path = join(dshHome, 'qq-social-people.json')
  if (!existsSync(path)) return null
  try {
    const raw = readJson(path)
    if (!isPlainObject(raw) || !isPlainObject(raw.people)) return null
    if (Object.keys(raw.people).length === 0) return null
    const people = parsePeopleDocument({ format: 'mydearfish.people', version: 1, people: raw.people }, warnings)
    if (Object.keys(people).length === 0) return null
    const bytes = Buffer.byteLength(JSON.stringify(people), 'utf8')
    if (bytes > MAX_PEOPLE_BYTES) {
      warnings.push('人物志太大，这次没有带进包里')
      return null
    }
    return people
  } catch (error) {
    warnings.push(`人物志读不出来，这次没有带进包里（${String((error && error.message) || error)}）`)
    return null
  }
}

function readWorkingFile(dir) {
  const path = join(dir, 'working.json')
  if (!existsSync(path)) return null
  try {
    return parseWorkingDocument(readJson(path))
  } catch {
    return null
  }
}

function manifestFiles(entries) {
  const files = {}
  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8')
    files[entry.name] = { bytes: data.length, sha256: sha256(data) }
  }
  return files
}

function sameCount(manifest, key, actual) {
  const counts = isPlainObject(manifest.counts) ? manifest.counts : {}
  const value = finite(counts[key])
  if (value === null) throw bad(`manifest.json 缺少 counts.${key}`)
  if (Math.round(value) !== actual) {
    throw bad(`manifest.json 记的 ${key} 数量和内容对不上`)
  }
}

/**
 * 把当前这条鱼打成一个 zip。
 * @param {object} options - `{ dir, dshHome, store, identity, pluginVersion, personaText, now }`。
 * @returns {{ buffer: Buffer, fileName: string, counts: object, warnings: string[] }}
 */
export function buildFishArchive({ dir, dshHome, store, identity, pluginVersion = '', personaText = '', now = Date.now() }) {
  const warnings = []
  const createdAt = finite(now) === null ? Date.now() : Number(now)
  const experience = readExperienceFile(dir, warnings)
  let facts = []
  if (store && typeof store.exportFacts === 'function') {
    if (store.degraded) warnings.push('检索库现在不可用，长期事实这次没有带进包里')
    else facts = store.exportFacts(5000)
  } else {
    warnings.push('检索库没有提供事实导出，长期事实这次没有带进包里')
  }
  const mood = readMoodFile(dshHome, warnings)
  const people = readPeopleFile(dshHome, warnings)
  const working = readWorkingFile(dir)
  const document = identityDocument(identity, createdAt)
  const configs = collectPortableConfigs({ dshHome, personaText })
  if (configs !== null) warnings.push(...configs.warnings)

  const entries = [
    { name: 'identity.json', data: JSON.stringify(document, null, 2) + '\n' },
    { name: 'memory/experience.jsonl', data: experience.text },
    {
      name: 'memory/facts.json',
      data: JSON.stringify({ format: 'mydearfish.facts', version: 1, facts }, null, 2) + '\n',
    },
  ]
  if (working !== null) {
    entries.push({
      name: 'memory/working.json',
      data: JSON.stringify({ format: 'mydearfish.working', version: 1, ...working }, null, 2) + '\n',
    })
  }
  if (mood !== null) {
    entries.push({
      name: 'mood.json',
      data: JSON.stringify({ format: 'mydearfish.mood', version: 1, state: mood }, null, 2) + '\n',
    })
  }
  if (people !== null) {
    entries.push({
      name: 'people.json',
      data: JSON.stringify({ format: 'mydearfish.people', version: 1, source: 'qq-bridge', people }, null, 2) + '\n',
    })
  }

  const counts = {
    experiences: experience.records.length,
    facts: facts.length,
    moodPoints: mood === null ? 0 : mood.timeline.length,
    people: people === null ? 0 : Object.keys(people).length,
    configs: configs === null ? 0 : Object.keys(configs.files).length,
  }
  const manifest = {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    createdAt,
    pluginVersion,
    identity: { name: document.name, species: document.species },
    counts,
    files: manifestFiles(entries),
    warnings,
  }
  // 旧版只校验 manifest.files 和 zip 条目，不认识的 manifest 字段直接忽略；
  // 所以配置放在这里，既不改包格式，也不会让旧版拒绝整包。
  if (configs !== null) manifest.configs = configs
  entries.unshift({ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) + '\n' })
  const buffer = createZip(entries, { now: new Date(createdAt) })
  return { buffer, fileName: archiveFileName(new Date(createdAt)), counts, warnings }
}

function checkManifest(manifest, entries) {
  if (!isPlainObject(manifest)) throw bad('manifest.json 不是对象')
  if (manifest.format !== ARCHIVE_FORMAT) throw bad('这不是大肥鱼的记忆包')
  if (manifest.version !== ARCHIVE_VERSION) {
    throw bad(`这份记忆包版本是 ${String(manifest.version)}，这个版本的大肥鱼读不了`)
  }
  if (!isPlainObject(manifest.files)) throw bad('manifest.json 缺少文件清单')
  const present = [...entries.keys()].filter((name) => name !== 'manifest.json')
  for (const name of present) {
    if (!ALLOWED_FILES.has(name)) throw bad(`记忆包里有不认识的文件：${name}`)
  }
  for (const name of REQUIRED_FILES) {
    if (!entries.has(name)) throw bad(`记忆包缺少 ${name}`)
  }
  const listed = Object.keys(manifest.files)
  if (listed.length !== present.length || listed.some((name) => !entries.has(name) || name === 'manifest.json')) {
    throw bad('manifest.json 的文件清单和包里的内容对不上')
  }
  for (const name of present) {
    const item = manifest.files[name]
    const data = entries.get(name)
    if (!isPlainObject(item)) throw bad(`manifest.json 里 ${name} 的校验信息不对`)
    if (finite(item.bytes) !== data.length || item.sha256 !== sha256(data)) {
      throw bad(`记忆包里的 ${name} 校验失败，可能被改过或没传完整`)
    }
  }
}

function parseManifest(entries) {
  let manifest
  try {
    manifest = JSON.parse(entries.get('manifest.json').toString('utf8'))
  } catch {
    throw bad('manifest.json 不是合法 JSON')
  }
  return manifest
}

function parseStagedIdentity(entries, warnings) {
  let raw
  try {
    raw = JSON.parse(entries.get('identity.json').toString('utf8'))
  } catch {
    throw bad('identity.json 不是合法 JSON')
  }
  try {
    return parseIdentityDocument(raw)
  } catch (error) {
    throw bad(`出生设定不合法：${String((error && error.message) || error)}`)
  }
}

/**
 * 读一个记忆包，完整验完再返回；任何一处不对都抛错，调用方据此拒绝导入。
 * @param {Buffer} buffer - zip 字节。
 * @returns {object} 验过的内容。
 */
export function parseFishArchive(buffer) {
  const entries = readZip(buffer)
  if (!entries.has('manifest.json')) throw bad('这不是大肥鱼的记忆包：缺少 manifest.json')
  const manifest = parseManifest(entries)
  checkManifest(manifest, entries)
  const warnings = Array.isArray(manifest.warnings)
    ? manifest.warnings.filter((item) => typeof item === 'string').slice(0, 20)
    : []
  const configs = parsePortableConfigs(manifest.configs, warnings)
  const identity = parseStagedIdentity(entries, warnings)
  if (isPlainObject(manifest.identity) && manifest.identity.name !== identity.name) {
    throw bad('manifest.json 里的名字和出生设定对不上')
  }
  const experience = parseExperienceJsonl(entries.get('memory/experience.jsonl').toString('utf8'), warnings)

  let factsRaw
  try {
    factsRaw = JSON.parse(entries.get('memory/facts.json').toString('utf8'))
  } catch {
    throw bad('长期事实文件不是合法 JSON')
  }
  const facts = parseFactsDocument(factsRaw, warnings)

  let mood = null
  if (entries.has('mood.json')) {
    let raw
    try {
      raw = JSON.parse(entries.get('mood.json').toString('utf8'))
    } catch {
      throw bad('心情文件不是合法 JSON')
    }
    mood = parseMoodDocument(raw, warnings)
  }
  let people = null
  if (entries.has('people.json')) {
    let raw
    try {
      raw = JSON.parse(entries.get('people.json').toString('utf8'))
    } catch {
      throw bad('人物志文件不是合法 JSON')
    }
    people = parsePeopleDocument(raw, warnings)
  }
  let working = null
  if (entries.has('memory/working.json')) {
    try {
      working = parseWorkingDocument(JSON.parse(entries.get('memory/working.json').toString('utf8')))
    } catch {
      throw bad('短期提炼水位不是合法 JSON')
    }
  }

  sameCount(manifest, 'experiences', experience.length)
  sameCount(manifest, 'facts', facts.length)
  sameCount(manifest, 'moodPoints', mood === null ? 0 : mood.timeline.length)
  sameCount(manifest, 'people', people === null ? 0 : Object.keys(people).length)

  return {
    manifest,
    identity,
    identityText: entries.get('identity.json').toString('utf8'),
    configs,
    experience,
    experienceText: experience.map((record) => JSON.stringify(record)).join('\n') + (experience.length > 0 ? '\n' : ''),
    facts,
    mood,
    people,
    working,
    warnings,
  }
}

function countExperienceLines(dir) {
  const path = join(dir, 'experience.jsonl')
  if (!existsSync(path)) return 0
  const size = statSync(path).size
  if (size === 0) return 0
  if (size > 8 * 1024 * 1024) return 2
  const text = readFileSync(path, 'utf8')
  return text.split('\n').filter((line) => line.trim() !== '').length
}

function readPeopleCount(dshHome) {
  const path = join(dshHome, 'qq-social-people.json')
  if (!existsSync(path)) return 0
  try {
    const raw = readJson(path)
    return isPlainObject(raw) && isPlainObject(raw.people) ? Object.keys(raw.people).length : 0
  } catch {
    return 0
  }
}

function readMoodPoints(dshHome) {
  const path = join(dshHome, 'feiyu-mood', 'state.json')
  if (!existsSync(path)) return 0
  try {
    const raw = readJson(path)
    return isPlainObject(raw) && Array.isArray(raw.timeline) ? raw.timeline.length : 0
  } catch {
    return 0
  }
}

function inspectOccupancy({ dir, dshHome, store }) {
  let experiences = countExperienceLines(dir)
  if (store && typeof store.stats === 'function') {
    try {
      const stats = store.stats()
      if (Number.isFinite(stats.total) && stats.total > experiences) experiences = stats.total
    } catch {}
  }
  const people = readPeopleCount(dshHome)
  const moodPoints = readMoodPoints(dshHome)
  return {
    empty: experiences === 0 && people === 0 && moodPoints === 0,
    experiences,
    people,
    moodPoints,
  }
}

function notEmptyMessage(occupancy) {
  const parts = []
  if (occupancy.experiences > 0) parts.push(`${occupancy.experiences} 段经历`)
  if (occupancy.people > 0) parts.push(`${occupancy.people} 个人物`)
  if (occupancy.moodPoints > 0) parts.push(`${occupancy.moodPoints} 条心情记录`)
  return `当前这条鱼已经有${parts.join('、') || '记忆'}，不能直接导入覆盖。请先导出备份，或在一个全新的 profile 里导入。`
}

function pendingPath(dir) {
  return join(dir, PENDING_DIR)
}

/** 有没有已经上传、等重启生效的导入包。 */
export function importIsPending(dir) {
  return existsSync(pendingPath(dir))
}

/** 最近一次导入的结果；没有就是 null。 */
export function readImportReport(dir) {
  const path = join(dir, REPORT_FILE)
  if (!existsSync(path)) return null
  try {
    return readJson(path)
  } catch {
    return null
  }
}

function writeReport(dir, report) {
  try {
    writeAtomicJson(join(dir, REPORT_FILE), report)
  } catch {}
  return report
}

/**
 * 人设是启动后才有配置层可写的，单独把结果补进导入报告。
 * @param {string} dir - 鱼脑目录。
 * @param {'applied'|'unavailable'} status - 应用结果。
 * @returns {object|null} 更新后的报告；没有报告时返回 null。
 */
export function markImportedPersona(dir, status) {
  const report = readImportReport(dir)
  if (!isPlainObject(report) || report.ok !== true) return report
  const configs = isPlainObject(report.configs) ? { ...report.configs } : {}
  configs.persona = status
  return writeReport(dir, { ...report, configs })
}

function readStaged(dir) {
  const root = pendingPath(dir)
  if (!existsSync(root)) return null
  const read = (name) => {
    const path = join(root, name)
    return existsSync(path) ? readFileSync(path, 'utf8') : null
  }
  const manifestText = read('manifest.json')
  if (manifestText === null) throw bad('暂存的导入包缺少 manifest.json')
  let manifest
  try {
    manifest = JSON.parse(manifestText)
  } catch {
    throw bad('暂存的导入包 manifest.json 坏了')
  }
  if (!isPlainObject(manifest) || manifest.format !== ARCHIVE_FORMAT || manifest.version !== ARCHIVE_VERSION) {
    throw bad('暂存的导入包版本不对')
  }
  const warnings = Array.isArray(manifest.warnings) ? manifest.warnings.filter((item) => typeof item === 'string') : []
  // 不信任磁盘：manifest 里的配置段重新校验一遍，坏配置只警告。
  const configs = parsePortableConfigs(manifest.configs, warnings)
  const identity = parseStagedIdentity(new Map([['identity.json', Buffer.from(read('identity.json') || '', 'utf8')]]), warnings)
  const experienceText = read('memory/experience.jsonl') || ''
  const experience = parseExperienceJsonl(experienceText, warnings)
  const factsText = read('memory/facts.json')
  if (factsText === null) throw bad('暂存的导入包缺少长期事实')
  let factsRaw
  try {
    factsRaw = JSON.parse(factsText)
  } catch {
    throw bad('暂存的长期事实不是合法 JSON')
  }
  const facts = parseFactsDocument(factsRaw, warnings)
  let mood = null
  const moodText = read('mood.json')
  if (moodText !== null) {
    try {
      mood = parseMoodDocument(JSON.parse(moodText), warnings)
    } catch (error) {
      throw bad(`暂存的心情文件不合法：${String((error && error.message) || error)}`)
    }
  }
  let people = null
  const peopleText = read('people.json')
  if (peopleText !== null) {
    try {
      people = parsePeopleDocument(JSON.parse(peopleText), warnings)
    } catch (error) {
      throw bad(`暂存的人物志不合法：${String((error && error.message) || error)}`)
    }
  }
  let working = null
  const workingText = read('memory/working.json')
  if (workingText !== null) {
    try {
      working = parseWorkingDocument(JSON.parse(workingText))
    } catch {
      throw bad('暂存的短期提炼水位不是合法 JSON')
    }
  }
  sameCount(manifest, 'experiences', experience.length)
  sameCount(manifest, 'facts', facts.length)
  sameCount(manifest, 'moodPoints', mood === null ? 0 : mood.timeline.length)
  sameCount(manifest, 'people', people === null ? 0 : Object.keys(people).length)
  let applyState = null
  const applyText = read('apply-state.json')
  if (applyText !== null) {
    try {
      applyState = JSON.parse(applyText)
    } catch {
      applyState = null
    }
  }
  return {
    manifest,
    identity,
    configs,
    experience,
    experienceText: experience.map((record) => JSON.stringify(record)).join('\n') + (experience.length > 0 ? '\n' : ''),
    facts,
    mood,
    people,
    working,
    warnings,
    applyState: isPlainObject(applyState) ? applyState : null,
  }
}

/**
 * 验包并通过空鱼检查后，把包暂存到 `.import-pending`，等下次启动应用。
 * @param {object} options - `{ dir, dshHome, store, buffer, now }`。
 * @returns {object} 暂存摘要。
 */
export function stageFishImport({ dir, dshHome, store, buffer, now = Date.now() }) {
  if (importIsPending(dir)) throw bad('已经有一个导入包在等重启生效，先重启完成它', 409)
  const parsed = parseFishArchive(buffer)
  const occupancy = inspectOccupancy({ dir, dshHome, store })
  if (!occupancy.empty) throw bad(notEmptyMessage(occupancy), 409)
  const root = pendingPath(dir)
  const temp = join(dir, `.import-pending.tmp-${process.pid}-${Date.now()}`)
  try {
    mkdirSync(temp, { recursive: true })
    writeFileSync(join(temp, 'manifest.json'), JSON.stringify({ ...parsed.manifest, stagedAt: now }, null, 2) + '\n')
    writeFileSync(join(temp, 'identity.json'), parsed.identityText)
    mkdirSync(join(temp, 'memory'), { recursive: true })
    writeFileSync(join(temp, 'memory', 'experience.jsonl'), parsed.experienceText)
    writeFileSync(join(temp, 'memory', 'facts.json'), JSON.stringify({ format: 'mydearfish.facts', version: 1, facts: parsed.facts }, null, 2) + '\n')
    if (parsed.working !== null) {
      writeFileSync(join(temp, 'memory', 'working.json'), JSON.stringify({ format: 'mydearfish.working', version: 1, ...parsed.working }, null, 2) + '\n')
    }
    if (parsed.mood !== null) {
      writeFileSync(join(temp, 'mood.json'), JSON.stringify({ format: 'mydearfish.mood', version: 1, state: parsed.mood }, null, 2) + '\n')
    }
    if (parsed.people !== null) {
      writeFileSync(join(temp, 'people.json'), JSON.stringify({ format: 'mydearfish.people', version: 1, source: 'qq-bridge', people: parsed.people }, null, 2) + '\n')
    }
    renameSync(temp, root)
  } catch (error) {
    try {
      rmSync(temp, { recursive: true, force: true })
    } catch {}
    throw error
  }
  return {
    ok: true,
    pending: true,
    stagedAt: now,
    counts: {
      experiences: parsed.experience.length,
      facts: parsed.facts.length,
      moodPoints: parsed.mood === null ? 0 : parsed.mood.timeline.length,
      people: parsed.people === null ? 0 : Object.keys(parsed.people).length,
      configs: parsed.configs === null ? 0 : Object.keys(parsed.configs.files).length,
    },
    warnings: parsed.warnings,
  }
}

function backupFiles({ dir, dshHome, backup }) {
  mkdirSync(backup, { recursive: true })
  copyIfExists(join(dir, 'experience.jsonl'), join(backup, 'experience.jsonl'), '经历流')
  copyIfExists(join(dir, 'identity.json'), join(backup, 'identity.json'), '出生设定')
  copyIfExists(join(dir, 'working.json'), join(backup, 'working.json'), '短期提炼水位')
  copyIfExists(join(dshHome, 'feiyu-mood', 'state.json'), join(backup, 'mood-state.json'), '心情状态')
  copyIfExists(join(dshHome, 'qq-social-people.json'), join(backup, 'qq-social-people.json'), '人物志')
  for (const entry of PORTABLE_CONFIGS) {
    const source = join(dshHome, ...entry.path)
    if (!existsSync(source)) continue
    const target = join(backup, 'configs', ...entry.path)
    mkdirSync(dirname(target), { recursive: true })
    copyIfExists(source, target, entry.name)
  }
  const database = join(dir, 'mind.sqlite')
  if (existsSync(database)) {
    copyIfExists(database, join(backup, 'mind.sqlite'), '检索库')
    copyIfExists(`${database}-wal`, join(backup, 'mind.sqlite-wal'), '检索库日志')
    copyIfExists(`${database}-shm`, join(backup, 'mind.sqlite-shm'), '检索库索引')
  }
}

function applyStaged({ dir, dshHome, staged, backup, now, diag = () => {} }) {
  // 先恢复设置：人设/称呼随后由出生设定覆盖，避免旧称呼盖掉新身份。
  const configs = applyPortableConfigs({ dshHome, dir, configs: staged.configs, diag })
  writeAtomic(join(dir, 'experience.jsonl'), staged.experienceText)
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      rmSync(`${join(dir, 'mind.sqlite')}${suffix}`, { force: true })
    } catch (error) {
      throw bad(`旧的检索库删不掉：${String((error && error.message) || error)}`, 500)
    }
  }
  const saved = saveIdentity(dir, staged.identity, Number.isFinite(staged.identity.updatedAt) ? staged.identity.updatedAt : now)
  syncMoodNames(dshHome, saved)
  if (staged.working !== null) {
    writeAtomicJson(join(dir, 'working.json'), {
      lastConsolidatedAt: staged.working.lastConsolidatedAt,
      lastConsolidatedId: staged.working.lastConsolidatedId,
    })
  }
  if (staged.mood !== null) {
    writeAtomicJson(join(dshHome, 'feiyu-mood', 'state.json'), staged.mood)
  }
  if (staged.people !== null) {
    writeAtomicJson(join(dshHome, 'qq-social-people.json'), { version: 1, people: staged.people })
  }
  writeAtomicJson(join(dir, IMPORT_FACTS_FILE), { format: 'mydearfish.facts.pending', version: 1, facts: staged.facts })
  return { backup, configs }
}

/**
 * 启动时调用：把重启前暂存的导入包落到磁盘。只在这里动 SQLite 和经历流，
 * 因为调用点必须早于 `openStore`。没有暂存包时返回 null。
 * @param {object} options - `{ dir, dshHome, diag }`。
 * @returns {object|null} 导入报告。
 */
export function applyPendingImport({ dir, dshHome, diag = () => {} }) {
  if (!importIsPending(dir)) return null
  const now = Date.now()
  let staged
  try {
    staged = readStaged(dir)
  } catch (error) {
    const report = writeReport(dir, { ok: false, at: now, stage: 'validate', error: String((error && error.message) || error) })
    try {
      rmSync(pendingPath(dir), { recursive: true, force: true })
    } catch {}
    diag(`import: 暂存的导入包没通过校验（${report.error}）`)
    return report
  }

  const applyState = staged.applyState
  let backup = isPlainObject(applyState) && typeof applyState.backup === 'string' ? applyState.backup : ''
  let phase = 'backup'
  try {
    if (applyState === null || applyState.phase !== 'applying') {
      const occupancy = inspectOccupancy({ dir, dshHome })
      if (!occupancy.empty) {
        const report = writeReport(dir, {
          ok: false,
          at: now,
          stage: 'empty-check',
          error: notEmptyMessage(occupancy),
          counts: { experiences: occupancy.experiences, people: occupancy.people, moodPoints: occupancy.moodPoints },
        })
        rmSync(pendingPath(dir), { recursive: true, force: true })
        diag(`import: 当前鱼已经不空，导入包已丢弃（${report.error}）`)
        return report
      }
      backup = join(dir, `import-backup-${stamp(new Date(now))}`)
      let suffix = 1
      while (existsSync(backup)) backup = join(dir, `import-backup-${stamp(new Date(now))}-${suffix++}`)
      backupFiles({ dir, dshHome, backup })
      writeAtomicJson(join(pendingPath(dir), 'apply-state.json'), {
        phase: 'applying',
        backup,
        startedAt: now,
        attempts: 1,
      })
    } else {
      const inside = !isAbsolute(relative(dir, backup)) && !relative(dir, backup).startsWith('..')
      if (!inside || !existsSync(backup)) {
        throw bad('导入备份找不到了，拒绝继续覆盖现有数据', 500)
      }
      writeAtomicJson(join(pendingPath(dir), 'apply-state.json'), {
        ...applyState,
        startedAt: applyState.startedAt || now,
        attempts: (Number(applyState.attempts) || 1) + 1,
      })
    }
    phase = 'apply'

    const applied = applyStaged({ dir, dshHome, staged, backup, now, diag })
    rmSync(pendingPath(dir), { recursive: true, force: true })
    const configs = {
      present: staged.configs !== null,
      applied: applied.configs.applied,
      skipped: applied.configs.skipped,
      warnings: applied.configs.warnings,
      persona: applied.configs.persona === '' ? 'none' : 'pending',
    }
    if (staged.configs === null) configs.warnings.push('这个包没带配置，只导入了记忆')
    const report = writeReport(dir, {
      ok: true,
      at: now,
      stage: 'done',
      importedAt: now,
      source: {
        createdAt: finite(staged.manifest.createdAt) || 0,
        pluginVersion: typeof staged.manifest.pluginVersion === 'string' ? staged.manifest.pluginVersion : '',
        name: staged.identity.name,
        species: staged.identity.species,
      },
      counts: {
        experiences: staged.experience.length,
        facts: staged.facts.length,
        moodPoints: staged.mood === null ? 0 : staged.mood.timeline.length,
        people: staged.people === null ? 0 : Object.keys(staged.people).length,
        configs: configs.present ? configs.applied + configs.skipped : 0,
      },
      configs,
      backup,
      warnings: staged.warnings,
    })
    diag(`import: 已导入 ${report.counts.experiences} 段经历、${report.counts.facts} 条事实、${configs.applied} 份配置；备份在 ${backup}`)
    return report
  } catch (error) {
    const report = writeReport(dir, {
      ok: false,
      at: now,
      stage: phase,
      error: String((error && error.message) || error),
      backup,
    })
    diag(`import: 应用导入包失败（${report.error}）；原数据备份在 ${backup || '（尚未建立）'}，暂存包留着下次启动重试`)
    return report
  }
}

/**
 * 打开 SQLite 之后调用：把导入包里的长期事实写进新库。幂等，失败就留着下次再试。
 * @param {object} options - `{ dir, store, diag }`。
 * @returns {number} 成功处理的事实条数。
 */
export function applyImportedFacts({ dir, store, diag = () => {} }) {
  const path = join(dir, IMPORT_FACTS_FILE)
  if (!existsSync(path) || !store || store.degraded) return 0
  let raw
  try {
    raw = readJson(path)
  } catch (error) {
    diag(`import: 待写入的长期事实读不出来（${String((error && error.message) || error)}）`)
    return 0
  }
  if (!isPlainObject(raw) || !Array.isArray(raw.facts)) {
    diag('import: 待写入的长期事实格式不对，保留文件等待人工处理')
    return 0
  }
  let written = 0
  for (const fact of raw.facts) {
    const result = store.upsertFact({
      subject: fact.subject,
      predicate: fact.predicate,
      object: fact.object,
      confidence: fact.confidence,
      validFrom: fact.validFrom,
      source: 'import',
      at: fact.validFrom,
    })
    if (result.action !== 'skipped') written += 1
  }
  try {
    rmSync(path, { force: true })
  } catch {}
  const report = readImportReport(dir)
  if (report && report.ok) {
    writeReport(dir, { ...report, factsApplied: written })
  }
  diag(`import: 已把 ${written} 条长期事实写回检索库`)
  return written
}
