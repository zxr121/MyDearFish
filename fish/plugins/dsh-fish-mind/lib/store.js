// 经历库与情景记忆：SQLite 是查询副本，experience.jsonl 是重建源。
//
// 写路径是同步的：一条消息落库再落盘，耗时在一毫秒级。SQLite 用 WAL，
// 查询和写入不会互相把对方锁死。node:sqlite 在拿不到时降级为「只写 JSONL」，
// 插件仍然能启动，但 recall 会明确说不可用，而不是假装有记忆。
//
// 阶段 1 在经历之上派生出情景：
//   - 按时间间隔和话题变化切段，写 episodes；
//   - 用规则显著性 S 决定一条经历是否值得进入长期情景，低于阈值只留原文；
//   - 召回四路（FTS、实体、时间窗口、图扩展）各自取候选，再按固定权重融合。
// 情景和索引都从经历流派生：JSONL 不改，SQLite 可以随时重建。

import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

let DatabaseSync
try {
  ({ DatabaseSync } = require('node:sqlite'))
} catch {
  DatabaseSync = undefined
}

export const SCHEMA_VERSION = 2

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_PARAMETERS = {
  gapMs: 45 * 60 * 1000,
  topicShift: 0.06,
  splitMinExperiences: 3,
  salienceThreshold: 0.35,
  routeLimit: 20,
  fuseLimit: 6,
  minScore: 0.35,
  indexChars: 4000,
}

const RELATION_WORDS = [
  '主人', '大肥鱼', '妈妈', '爸爸', '奶奶', '爷爷', '外婆', '外公',
  '朋友', '同事', '老板', '老师', '同学', '对象', '男朋友', '女朋友',
  '姐姐', '妹妹', '哥哥', '弟弟',
]
const PLACE_WORDS = [
  '海边', '公司', '学校', '医院', '机场', '车站', '公园', '家里',
  '办公室', '咖啡馆', '咖啡店', '餐厅', '超市', '图书馆', '电影院', '健身房',
]
const TIME_WORDS = [
  '今天', '明天', '昨天', '后天', '前天', '上周', '这周', '下周',
  '上个月', '这个月', '下个月', '今年', '去年', '明年', '周末',
  '早上', '中午', '晚上', '半夜', '凌晨',
]
const KNOWN_WORDS = ['B站', 'QQ', 'DeepSeek', 'DSH', 'GitHub', 'Windows', 'macOS', 'Linux']
const WEEKDAY_NUMBERS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 }

const SOURCE_LABELS = {
  user: '主人说的',
  qq: 'QQ 里说的',
  'qq-group': 'QQ 群里说的',
  'qq-friend': 'QQ 好友说的',
  'qq-import': '旧记录（导入）',
  'speak-up': '主动搭话',
  bili: 'B 站报告',
  compaction: '上下文压缩摘要',
  model: '她自己说的',
  assistant: '她自己说的',
  plugin: '插件记录',
}

/** 中文按字符二元组切，英文/数字按整词切；查询和建索引必须用同一个函数。 */
export function tokenize(text) {
  const source = typeof text === 'string' ? text : ''
  const runs = source.match(/[\p{Script=Han}]+|[\p{L}\p{N}_-]+/gu) || []
  const tokens = []
  for (const run of runs) {
    const chars = Array.from(run)
    if (/^\p{Script=Han}+$/u.test(run)) {
      if (chars.length === 1) tokens.push(run)
      else for (let index = 0; index + 1 < chars.length; index += 1) tokens.push(chars[index] + chars[index + 1])
    } else {
      tokens.push(run.toLowerCase())
    }
  }
  return tokens
}

function tokenSet(text) {
  return new Set(tokenize(text))
}

/** 交集相对于较短文本的比例；短句和长句聊同一件事时比 Jaccard 更稳。 */
function containment(left, right) {
  if (left.size === 0 || right.size === 0) return 0
  let overlap = 0
  for (const token of left) if (right.has(token)) overlap += 1
  return overlap / Math.min(left.size, right.size)
}

/** 从文本里抽可做结构化匹配的实体；不调模型，只覆盖常见称呼、地点、时间和显式标记。 */
export function extractEntities(text) {
  const source = typeof text === 'string' ? text : ''
  if (source === '') return []
  const found = new Map()
  const add = (value) => {
    const cleaned = String(value).replace(/\s+/g, ' ').trim()
    if (cleaned === '' || cleaned.length > 32) return
    const key = cleaned.toLowerCase()
    if (!found.has(key)) found.set(key, cleaned)
  }
  for (const match of source.matchAll(/[「“"《]([^」”"》\n]{1,24})[」”"》]/g)) add(match[1])
  for (const match of source.matchAll(/@([\p{L}\p{N}_-]{1,24})/gu)) add(match[1])
  for (const match of source.matchAll(/#([^#\n]{1,24})#/g)) add(match[1])
  for (const match of source.matchAll(/\b([A-Z][A-Za-z0-9_-]{1,23})\b/g)) add(match[1])
  for (const word of RELATION_WORDS) if (source.includes(word)) add(word)
  for (const word of PLACE_WORDS) if (source.includes(word)) add(word)
  for (const word of TIME_WORDS) if (source.includes(word)) add(word)
  const lower = source.toLowerCase()
  for (const word of KNOWN_WORDS) if (lower.includes(word.toLowerCase())) add(word)
  return [...found.values()].slice(0, 32)
}

function mergeEntities(existing, incoming) {
  const merged = new Map()
  for (const value of [...existing, ...incoming]) {
    const key = String(value).toLowerCase()
    if (!merged.has(key)) merged.set(key, String(value))
  }
  return [...merged.values()].slice(0, 64)
}

function escapeLike(text) {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`)
}

function quoteFts(token) {
  return `"${token.replaceAll('"', '""')}"`
}

function contentHash(record) {
  return createHash('sha256')
    .update(JSON.stringify([record.sessionId, record.seq ?? randomUUID(), record.kind, record.role, record.text ?? record.content]))
    .digest('hex')
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true })
}

function fileSize(path) {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

function clamp01(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.min(1, Math.max(0, number))
}

function round2(value) {
  return Number(clamp01(value).toFixed(2))
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []
  } catch {
    return []
  }
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function clipText(text, max) {
  const oneLine = String(text ?? '').replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine
}

function sourceLabel(value) {
  const key = typeof value === 'string' ? value : ''
  return SOURCE_LABELS[key] || '经历记录'
}

/** 规则显著性：惊讶、自我相关、社交、承诺、新鲜度减去重复习惯。 */
function salienceScore({ text, role, maxSimilarity, repeats }) {
  const selfRef = /(你|我|我们|主人|大肥鱼)/.test(text) ? 1 : 0
  const commitment = /(答应|说好|约好|保证|计划|打算|记得|别忘|下次|周末|明天|一定|必须|不要)/.test(text) ? 1 : 0
  // 她自己的话主要靠情景附着，不该单独撑起一段记忆；重复的客套话因此会落到阈值下。
  const social = role === 'user' ? 1 : role === 'assistant' ? 0.2 : 0.1
  const surprise = 1 - clamp01(maxSimilarity)
  const habituation = Math.min(1, Math.max(0, repeats) / 5)
  const value = 1.1 * surprise
    + 0.8 * selfRef
    + 0.5 * social
    + 0.6 * commitment
    + 0.4 * surprise
    - 0.5 * habituation
    - 0.8
  return 1 / (1 + Math.exp(-value))
}

function startOfLocalDay(now) {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** 把“上周三”“3 月 5 日”“最近”这类线索变成一个左闭右开的时间窗。 */
export function parseTimeWindow(query, now = Date.now()) {
  const text = typeof query === 'string' ? query : ''
  const day = startOfLocalDay(now)
  let match
  if ((match = text.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?/))) {
    const start = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime()
    return { start, end: start + DAY_MS, label: match[0] }
  }
  if ((match = text.match(/(\d{1,2})月(\d{1,2})日?/))) {
    const year = new Date(now).getFullYear()
    let start = new Date(year, Number(match[1]) - 1, Number(match[2])).getTime()
    if (start > now + DAY_MS) start = new Date(year - 1, Number(match[1]) - 1, Number(match[2])).getTime()
    return { start, end: start + DAY_MS, label: match[0] }
  }
  if (/前天/.test(text)) return { start: day - 2 * DAY_MS, end: day - DAY_MS, label: '前天' }
  if (/昨天|昨日/.test(text)) return { start: day - DAY_MS, end: day, label: '昨天' }
  if (/今天|今日/.test(text)) return { start: day, end: now + 1, label: '今天' }

  // 先认“上周三”“这周三”“周三”；否则“上周”会把具体星期吞掉。
  if ((match = text.match(/(上周|上个星期|上星期|这周|本周|这个星期|下周|下个星期|下星期)\s*([一二三四五六日天])/))) {
    const target = WEEKDAY_NUMBERS[match[2]]
    const weekday = ((new Date(day).getDay() + 6) % 7) + 1
    const monday = day - (weekday - 1) * DAY_MS
    const prefix = match[1]
    const weekOffset = /上周|上个星期|上星期/.test(prefix) ? -7 : /下周|下个星期|下星期/.test(prefix) ? 7 : 0
    const start = monday + weekOffset * DAY_MS + (target - 1) * DAY_MS
    return { start, end: start + DAY_MS, label: match[0] }
  }
  if ((match = text.match(/(?:周|星期)([一二三四五六日天])/))) {
    const target = WEEKDAY_NUMBERS[match[1]]
    const weekday = ((new Date(day).getDay() + 6) % 7) + 1
    const monday = day - (weekday - 1) * DAY_MS
    let start = monday + (target - 1) * DAY_MS
    if (start > day) start -= 7 * DAY_MS
    return { start, end: start + DAY_MS, label: match[0] }
  }

  if (/上周|上个星期|上星期/.test(text)) {
    const weekday = (new Date(day).getDay() + 6) % 7
    const monday = day - weekday * DAY_MS
    return { start: monday - 7 * DAY_MS, end: monday, label: '上周' }
  }
  if (/这周|本周|这个星期/.test(text)) {
    const weekday = (new Date(day).getDay() + 6) % 7
    return { start: day - weekday * DAY_MS, end: now + 1, label: '这周' }
  }
  if (/上个月|上月/.test(text)) {
    const date = new Date(now)
    return {
      start: new Date(date.getFullYear(), date.getMonth() - 1, 1).getTime(),
      end: new Date(date.getFullYear(), date.getMonth(), 1).getTime(),
      label: '上个月',
    }
  }
  if (/这个月|本月/.test(text)) {
    const date = new Date(now)
    return { start: new Date(date.getFullYear(), date.getMonth(), 1).getTime(), end: now + 1, label: '这个月' }
  }
  if (/最近|这几天|近期/.test(text)) return { start: day - 6 * DAY_MS, end: now + 1, label: '最近' }
  return null
}

function normalizeParameters(config) {
  const episodes = config && typeof config === 'object' && config.episodes ? config.episodes : {}
  const recall = config && typeof config === 'object' && config.recall ? config.recall : {}
  const number = (value, fallback) => (Number.isFinite(value) ? Number(value) : fallback)
  return {
    gapMs: Math.max(1, number(episodes.gapMinutes, DEFAULT_PARAMETERS.gapMs / 60000)) * 60_000,
    topicShift: clamp01(number(episodes.topicShift, DEFAULT_PARAMETERS.topicShift)),
    splitMinExperiences: Math.max(1, Math.round(number(episodes.splitMinExperiences, DEFAULT_PARAMETERS.splitMinExperiences))),
    salienceThreshold: clamp01(number(episodes.salienceThreshold, DEFAULT_PARAMETERS.salienceThreshold)),
    routeLimit: Math.max(1, Math.round(number(recall.routeLimit, DEFAULT_PARAMETERS.routeLimit))),
    fuseLimit: Math.max(1, Math.round(number(recall.fuseLimit, DEFAULT_PARAMETERS.fuseLimit))),
    minScore: clamp01(number(recall.minScore, DEFAULT_PARAMETERS.minScore)),
    indexChars: Math.max(200, Math.round(number(config && config.maxTextChars, DEFAULT_PARAMETERS.indexChars))),
  }
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS experiences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hash TEXT NOT NULL UNIQUE,
  ts INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL,
  session_id TEXT NOT NULL DEFAULT '',
  turn INTEGER,
  kind TEXT NOT NULL,
  role TEXT,
  actor TEXT,
  source_kind TEXT,
  content TEXT NOT NULL,
  entities TEXT NOT NULL DEFAULT '[]',
  affect TEXT NOT NULL DEFAULT '{}',
  salience REAL NOT NULL DEFAULT 0,
  episode_id INTEGER REFERENCES episodes(id),
  source_trust REAL NOT NULL DEFAULT 0.8,
  dropped TEXT,
  meta TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS experiences_ts ON experiences(ts);
CREATE INDEX IF NOT EXISTS experiences_session ON experiences(session_id, ts);
CREATE VIRTUAL TABLE IF NOT EXISTS experience_fts USING fts5(
  id UNINDEXED,
  body,
  tokenize = 'unicode61'
);

CREATE TABLE IF NOT EXISTS episodes (
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
  chapter_id INTEGER REFERENCES chapters(id)
);

CREATE TABLE IF NOT EXISTS facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  valid_from INTEGER,
  valid_to INTEGER,
  confidence REAL NOT NULL,
  source TEXT NOT NULL,
  source_ids TEXT NOT NULL DEFAULT '[]',
  superseded_by INTEGER REFERENCES facts(id)
);

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT,
  model TEXT NOT NULL DEFAULT '{}',
  trust REAL NOT NULL DEFAULT 0.5,
  last_seen INTEGER
);

CREATE TABLE IF NOT EXISTS intentions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  trigger TEXT NOT NULL,
  due_at INTEGER,
  status TEXT NOT NULL DEFAULT 'open',
  created_by TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.7
);

CREATE TABLE IF NOT EXISTS affect_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  valence REAL NOT NULL,
  arousal REAL NOT NULL,
  dominance REAL NOT NULL,
  label TEXT,
  drives TEXT NOT NULL DEFAULT '{}',
  body TEXT NOT NULL DEFAULT '{}',
  reason TEXT
);

CREATE TABLE IF NOT EXISTS predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  about TEXT NOT NULL,
  expected TEXT NOT NULL,
  observed TEXT,
  error REAL,
  resolved_at INTEGER
);

CREATE TABLE IF NOT EXISTS self_model (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  confidence REAL NOT NULL,
  source TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  start_ts INTEGER,
  end_ts INTEGER,
  summary TEXT,
  key_episode_ids TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS sleep_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL,
  tasks TEXT NOT NULL DEFAULT '[]',
  notes TEXT
);
`

/**
 * 打开经历库。
 * @param {object} options - `{ dir, config, diag }`。
 * @returns {object} 经历库句柄；SQLite 不可用时 `degraded` 为 true。
 */
export function openStore({ dir, config, diag = () => {} }) {
  ensureDir(dir)
  const dbPath = join(dir, 'mind.sqlite')
  const jsonlPath = join(dir, 'experience.jsonl')
  let db = null
  let degraded = DatabaseSync === undefined
  let parameters = normalizeParameters(config)

  const migrate = (handle) => {
    const version = Number(handle.prepare('PRAGMA user_version').get()?.user_version ?? 0)
    if (version > SCHEMA_VERSION) {
      throw new Error(`数据库版本 ${version} 比插件认识的 ${SCHEMA_VERSION} 新，拒绝写入`)
    }
    if (version === SCHEMA_VERSION) return
    handle.exec('BEGIN IMMEDIATE')
    try {
      if (version < 2) {
        const columns = new Set(handle.prepare('PRAGMA table_info(episodes)').all().map((row) => row.name))
        if (!columns.has('session_id')) {
          handle.exec("ALTER TABLE episodes ADD COLUMN session_id TEXT NOT NULL DEFAULT ''")
        }
        if (!columns.has('source_trust')) {
          handle.exec('ALTER TABLE episodes ADD COLUMN source_trust REAL NOT NULL DEFAULT 0.8')
        }
        if (!columns.has('entities')) {
          handle.exec("ALTER TABLE episodes ADD COLUMN entities TEXT NOT NULL DEFAULT '[]'")
        }
        handle.exec('CREATE INDEX IF NOT EXISTS episodes_session_end ON episodes(session_id, end_ts)')
        handle.exec('CREATE INDEX IF NOT EXISTS episodes_end ON episodes(end_ts)')
        handle.exec('CREATE INDEX IF NOT EXISTS experiences_episode ON experiences(episode_id)')
      }
      handle.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
      handle.exec('COMMIT')
    } catch (error) {
      try {
        handle.exec('ROLLBACK')
      } catch {}
      throw error
    }
  }

  const openDatabase = () => {
    if (DatabaseSync === undefined) return null
    try {
      const handle = new DatabaseSync(dbPath)
      handle.exec(SCHEMA)
      migrate(handle)
      return handle
    } catch (error) {
      diag(`store: 打不开 ${dbPath}（${String((error && error.message) || error)}）`)
      return null
    }
  }

  db = openDatabase()
  if (db === null) {
    degraded = true
    if (DatabaseSync !== undefined && existsSync(dbPath)) {
      // 损坏的库挪到一边，下一次启动会从 JSONL 重建；不直接删，留证据。
      const aside = `${dbPath}.corrupt-${Date.now()}`
      try {
        renameSync(dbPath, aside)
        diag(`store: 坏库已挪到 ${aside}，这次只写 JSONL`)
      } catch (error) {
        diag(`store: 坏库挪不动（${String((error && error.message) || error)}）`)
      }
      db = openDatabase()
      degraded = db === null
      if (db !== null) diag('store: 新库已建好；如需恢复，调用 rebuild()')
    }
  }

  const insertStmt = db && db.prepare(`
    INSERT OR IGNORE INTO experiences
      (hash, ts, recorded_at, session_id, turn, kind, role, actor, source_kind, content,
       entities, affect, salience, episode_id, source_trust, dropped, meta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const ftsStmt = db && db.prepare('INSERT INTO experience_fts (id, body) VALUES (?, ?)')
  const byHashStmt = db && db.prepare('SELECT id FROM experiences WHERE hash = ?')
  const ftsHasStmt = db && db.prepare('SELECT 1 AS ok FROM experience_fts WHERE id = ? LIMIT 1')
  const deleteFtsStmt = db && db.prepare('DELETE FROM experience_fts WHERE id = ?')
  const recentTextsStmt = db && db.prepare(`
    SELECT content FROM experiences
    WHERE dropped IS NULL AND content <> '' AND id <> ?
    ORDER BY ts DESC, id DESC LIMIT 12
  `)
  const latestEpisodeStmt = db && db.prepare(`
    SELECT id, start_ts, end_ts, importance, source_trust, entities, participants, channel
    FROM episodes WHERE session_id = ? ORDER BY end_ts DESC, id DESC LIMIT 1
  `)
  const episodeCountStmt = db && db.prepare('SELECT COUNT(*) AS n FROM experiences WHERE episode_id = ?')
  const recentEpisodeTextsStmt = db && db.prepare(`
    SELECT content FROM experiences
    WHERE episode_id = ? AND dropped IS NULL AND content <> ''
    ORDER BY ts DESC, id DESC LIMIT 8
  `)
  const episodeByIdStmt = db && db.prepare(`
    SELECT id, start_ts, end_ts, session_id, importance, source_trust, entities, participants, channel
    FROM episodes WHERE id = ?
  `)
  const createEpisodeStmt = db && db.prepare(`
    INSERT INTO episodes (start_ts, end_ts, participants, channel, importance, session_id, source_trust, entities)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const updateEpisodeStmt = db && db.prepare(`
    UPDATE episodes
    SET start_ts = ?, end_ts = ?, participants = ?, importance = ?, source_trust = ?, entities = ?
    WHERE id = ?
  `)
  const updateEncodedStmt = db && db.prepare(`
    UPDATE experiences SET entities = ?, salience = ?, episode_id = ?, source_trust = ? WHERE id = ?
  `)
  const recallExperienceStmt = db && db.prepare(`
    SELECT role, actor, content, ts, source_kind, source_trust, salience
    FROM experiences
    WHERE episode_id = ? AND dropped IS NULL AND content <> ''
    ORDER BY ts ASC, id ASC LIMIT 12
  `)
  const episodeTextCountStmt = db && db.prepare(`
    SELECT COUNT(*) AS n FROM experiences
    WHERE episode_id = ? AND dropped IS NULL AND content <> ''
  `)
  const episodeMessagesStmt = db && db.prepare(`
    SELECT role, actor, content, ts
    FROM experiences
    WHERE episode_id = ? AND dropped IS NULL AND content <> ''
    ORDER BY ts ASC, id ASC
  `)
  const windowStmt = db && db.prepare(`
    SELECT ts, session_id, role, actor, source_kind, content
    FROM experiences
    WHERE dropped IS NULL AND content <> '' AND ts >= ? AND role IN ('user', 'assistant')
    ORDER BY ts DESC, id DESC LIMIT ?
  `)
  const factActiveStmt = db && db.prepare(`
    SELECT id, object FROM facts
    WHERE subject = ? AND predicate = ? AND superseded_by IS NULL
    ORDER BY id DESC LIMIT 1
  `)
  const factInsertStmt = db && db.prepare(`
    INSERT INTO facts (subject, predicate, object, valid_from, confidence, source, source_ids)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const factSupersedeStmt = db && db.prepare(`
    UPDATE facts SET superseded_by = ?, valid_to = ? WHERE id = ?
  `)
  const factListStmt = db && db.prepare(`
    SELECT subject, predicate, object, confidence, valid_from AS validFrom
    FROM facts WHERE superseded_by IS NULL ORDER BY id DESC LIMIT ?
  `)
  const runInsertStmt = db && db.prepare(`
    INSERT INTO sleep_runs (started_at, finished_at, status, tasks, notes) VALUES (?, ?, ?, ?, ?)
  `)

  function appendJsonl(record) {
    appendFileSync(jsonlPath, JSON.stringify(record) + '\n', 'utf8')
  }

  function encodeRecord(record, { excludeId = -1 } = {}) {
    // 正文完整留在经历里；索引、实体和显著性只看前段，避免一次超长粘贴拖慢热路径。
    const text = (typeof record.text === 'string' ? record.text : '').slice(0, parameters.indexChars)
    const entities = extractEntities(text)
    const trustValue = record.sourceTrust ?? record.meta?.trust ?? 0.8
    const trust = Number.isFinite(Number(trustValue)) ? clamp01(trustValue) : 0.8
    if (text.trim() === '' || record.dropped) return { salience: 0, episodeId: null, entities, trust }

    const tokens = tokenSet(text)
    let maxSimilarity = 0
    let repeats = 0
    for (const row of recentTextsStmt.all(excludeId)) {
      const similarity = containment(tokens, tokenSet(row.content))
      if (similarity > maxSimilarity) maxSimilarity = similarity
      if (similarity >= 0.8) repeats += 1
    }
    const salience = salienceScore({ text, role: record.role || 'user', maxSimilarity, repeats })

    const sessionId = record.sessionId === undefined ? '' : String(record.sessionId)
    const at = Number.isFinite(record.at) ? Number(record.at) : Date.now()
    const open = latestEpisodeStmt.get(sessionId)
    let attach = false
    if (open) {
      const gap = at - Number(open.end_ts)
      if (Math.abs(gap) <= parameters.gapMs) {
        let topicBreak = false
        const count = Number(episodeCountStmt.get(open.id)?.n ?? 0)
        if (record.role === 'user' && count >= parameters.splitMinExperiences) {
          const episodeTokens = new Set()
          for (const row of recentEpisodeTextsStmt.all(open.id)) {
            for (const token of tokenize(row.content)) episodeTokens.add(token)
          }
          topicBreak = containment(tokens, episodeTokens) < parameters.topicShift
        }
        attach = !topicBreak
      }
    }

    if (attach) {
      const participants = mergeEntities(parseJsonArray(open.participants), record.actor ? [String(record.actor)] : [])
      const mergedEntities = mergeEntities(parseJsonArray(open.entities), entities)
      updateEpisodeStmt.run(
        Math.min(Number(open.start_ts), at),
        Math.max(Number(open.end_ts), at),
        JSON.stringify(participants),
        Math.max(clamp01(open.importance), salience),
        Math.max(clamp01(open.source_trust), trust),
        JSON.stringify(mergedEntities),
        open.id,
      )
      return { salience, episodeId: open.id, entities, trust }
    }

    if (salience >= parameters.salienceThreshold) {
      const participants = record.actor ? [String(record.actor)] : []
      const result = createEpisodeStmt.run(
        at,
        at,
        JSON.stringify(participants),
        record.source ? String(record.source) : '',
        salience,
        sessionId,
        trust,
        JSON.stringify(entities),
      )
      return { salience, episodeId: Number(result.lastInsertRowid), entities, trust }
    }

    return { salience, episodeId: null, entities, trust }
  }

  function insertOne(full) {
    if (byHashStmt.get(full.hash)) return { inserted: false, id: null, hash: full.hash }
    const encoded = encodeRecord(full)
    const result = insertStmt.run(
      full.hash,
      full.at,
      full.recordedAt,
      full.sessionId ?? '',
      full.turn ?? null,
      full.kind,
      full.role ?? null,
      full.actor ?? null,
      full.source ?? null,
      full.text ?? '',
      JSON.stringify(encoded.entities),
      JSON.stringify(full.affect ?? {}),
      encoded.salience,
      encoded.episodeId,
      encoded.trust,
      full.dropped ?? null,
      JSON.stringify(full.meta ?? {}),
    )
    const inserted = Number(result.changes) > 0
    if (inserted && !full.dropped && full.text) {
      ftsStmt.run(full.hash, tokenize(full.text.slice(0, parameters.indexChars)).join(' '))
    }
    return {
      inserted,
      id: inserted ? Number(result.lastInsertRowid) : null,
      hash: full.hash,
    }
  }

  /**
   * 写一条经历；同一会话事件重复投递时按 hash 去重。
   * 情景、实体、显著性和来源可信度都在同一个事务里派生。
   * @param {object} record - 已归一、已清洗的经历。
   * @returns {{ inserted: boolean, id: number|null, hash: string }}
   */
  function insert(record) {
    const hash = record.hash || contentHash(record)
    const full = { ...record, hash, recordedAt: record.recordedAt ?? Date.now() }
    appendJsonl(full)
    if (db === null) return { inserted: true, id: null, hash }

    db.exec('BEGIN IMMEDIATE')
    try {
      const result = insertOne(full)
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  /**
   * 检索经历。单字/单字母查询退回 LIKE。
   * @param {string} query - 查询词。
   * @param {number} limit - 最多返回几条。
   * @returns {object[]} 按相关度或时间排序的经历。
   */
  function search(query, limit = 6) {
    if (db === null) return []
    const text = typeof query === 'string' ? query.trim() : ''
    if (text === '') return []
    const tokens = tokenize(text)
    if (tokens.length === 0) return []
    const max = Math.min(Math.max(1, Number(limit) || 6), 50)

    if (tokens.every((token) => Array.from(token).length <= 1)) {
      const rows = db.prepare(`
        SELECT id, hash, ts, session_id, kind, role, content
        FROM experiences
        WHERE dropped IS NULL AND content LIKE ? ESCAPE '\\'
        ORDER BY ts DESC LIMIT ?
      `).all(`%${escapeLike(text)}%`, max)
      return rows.map(mapRow)
    }

    const rows = db.prepare(`
      SELECT e.id, e.hash, e.ts, e.session_id, e.kind, e.role, e.content, bm25(experience_fts) AS score
      FROM experience_fts
      JOIN experiences e ON e.hash = experience_fts.id
      WHERE experience_fts MATCH ?
      ORDER BY score LIMIT ?
    `).all(tokens.map(quoteFts).join(' '), max)
    return rows.map(mapRow)
  }

  function mapRow(row) {
    return {
      id: row.id,
      hash: row.hash,
      at: row.ts,
      sessionId: row.session_id,
      kind: row.kind,
      role: row.role,
      text: row.content,
      ...(row.score === undefined ? {} : { score: row.score }),
    }
  }

  function episodeRow(id) {
    return episodeByIdStmt.get(id)
  }

  function emptyEpisodeDetail(id, reason) {
    return {
      enabled: true,
      reason,
      id,
      at: 0,
      endAt: 0,
      sessionId: '',
      source: '',
      confidence: 0,
      participants: [],
      total: 0,
      totalChars: 0,
      offset: 0,
      nextOffset: null,
      truncated: false,
      messages: [],
    }
  }

  /**
   * 打开一条情景的原文。召回只给线索；这里按情景编号取回当时真正说过的话。
   * 一页放不下时返回 nextOffset，下一次从那个字符位置继续，单条超长消息也不会被永久截掉。
   * @param {number} rawId - 情景编号。
   * @param {{ limit?: number, maxChars?: number, offset?: number }} [options] - 每页条数、每页字数和字符游标。
   * @returns {object} 原文包；找不到、读完或存储降级时 reason 说明原因。
   */
  function openEpisode(rawId, options = {}) {
    if (db === null) return emptyEpisodeDetail(Number(rawId) || 0, 'storage-degraded')
    const id = Math.trunc(Number(rawId))
    if (!Number.isFinite(id) || id <= 0) return emptyEpisodeDetail(0, 'bad-id')
    const row = episodeRow(id)
    if (!row) return emptyEpisodeDetail(id, 'not-found')
    const limit = Math.max(1, Math.min(Math.round(Number(options.limit) || 40), 200))
    const maxChars = Math.max(1, Math.min(Math.round(Number(options.maxChars) || 6000), 20000))
    const offset = Math.max(0, Math.trunc(Number(options.offset) || 0))
    const rows = episodeMessagesStmt.all(id)
    const detail = {
      enabled: true,
      reason: 'ok',
      id,
      at: Number(row.start_ts),
      endAt: Number(row.end_ts),
      sessionId: String(row.session_id || ''),
      source: sourceLabel(row.channel || ''),
      confidence: round2(row.source_trust),
      participants: parseJsonArray(row.participants),
      total: rows.length,
      totalChars: 0,
      offset,
      nextOffset: null,
      truncated: false,
      messages: [],
    }
    if (rows.length === 0) {
      detail.reason = 'empty'
      return detail
    }

    let position = 0
    const segments = rows.map((message, index) => {
      const text = String(message.content ?? '')
      const segment = {
        role: message.role || 'user',
        actor: message.actor || '',
        at: Number(message.ts),
        text,
        start: position,
        end: position + text.length,
      }
      position = segment.end + (index + 1 < rows.length ? 1 : 0)
      return segment
    })
    detail.totalChars = position
    if (offset >= position) {
      detail.reason = 'end'
      return detail
    }

    let used = 0
    let nextOffset = position
    for (const segment of segments) {
      if (segment.end <= offset) continue
      if (detail.messages.length >= limit) {
        nextOffset = Math.max(offset, segment.start)
        break
      }
      const room = maxChars - used
      if (room <= 0) {
        nextOffset = Math.max(offset, segment.start)
        break
      }
      const localStart = Math.max(0, offset - segment.start)
      const available = segment.text.length - localStart
      let take = Math.min(available, room)
      let clipped = take < available
      // 留一个字符给省略号；nextOffset 仍指向被切掉部分的起点，下一页能接上。
      if (clipped && room >= 2) take = room - 1
      if (take <= 0) {
        nextOffset = Math.max(offset, segment.start)
        break
      }
      const shown = segment.text.slice(localStart, localStart + take)
      const text = clipped && room >= 2 ? `${shown}…` : shown
      detail.messages.push({
        role: segment.role,
        actor: segment.actor,
        at: segment.at,
        text,
        continued: localStart > 0,
      })
      used += text.length
      nextOffset = segment.start + localStart + take
      if (clipped) break
      nextOffset = segment.end + (segment.end < position ? 1 : 0)
    }
    detail.nextOffset = nextOffset < position ? nextOffset : null
    detail.truncated = detail.nextOffset !== null
    return detail
  }

  function hydrateEpisode(row, score, routes) {
    const rows = recallExperienceStmt.all(row.id)
    if (rows.length === 0) return null
    const users = rows.filter((item) => item.role === 'user')
    const primary = users[0] || rows[0]
    const picked = []
    for (const item of users.slice(0, 2)) picked.push(item)
    const tail = rows[rows.length - 1]
    if (tail && !picked.includes(tail)) picked.push(tail)
    const quotes = picked.slice(0, 3).map((item) => ({
      role: item.role || 'user',
      text: clipText(item.content, 120),
      at: item.ts,
    }))
    const source = row.channel || primary.source_kind || (primary.role === 'assistant' ? 'model' : 'user')
    return {
      id: row.id,
      type: 'episode',
      at: row.start_ts,
      endAt: row.end_ts,
      sessionId: row.session_id,
      participants: parseJsonArray(row.participants),
      source: sourceLabel(source),
      confidence: round2(row.source_trust),
      importance: round2(row.importance),
      excerpt: clipText(primary.content, 180),
      quotes,
      score: Number(score.toFixed(3)),
      routes: [...routes],
    }
  }

  /**
   * 四路召回并按固定权重融合。没有强相关时返回空，不硬塞。
   * @param {string} rawQuery - 线索文本。
   * @param {{ limit?: number, minScore?: number, excludeSessionId?: string, sessionId?: string, minTrust?: number, maxTrust?: number, excludeSources?: string[] }} [options] - 结果上限、强相关门槛、要排除的会话、只查的精确会话、可信度区间和要排除的来源。
   * @returns {{ enabled: boolean, items: object[], reason: string, latencyMs: number }} 证据包。
   */
  function recall(rawQuery, options = {}) {
    if (db === null) return { enabled: true, items: [], reason: 'storage-degraded', latencyMs: 0 }
    const query = typeof rawQuery === 'string' ? rawQuery.trim() : ''
    if (query === '') return { enabled: true, items: [], reason: 'empty-query', latencyMs: 0 }
    const started = process.hrtime.bigint()
    const routeLimit = parameters.routeLimit
    const fuseLimit = Math.min(Math.max(1, Number(options.limit) || parameters.fuseLimit), 20)
    const minScore = Number.isFinite(options.minScore) ? Number(options.minScore) : parameters.minScore
    const excludeSessionId = options.excludeSessionId === undefined ? '' : String(options.excludeSessionId)
    // 精确匹配：群/好友会话 id 是“前缀+号码”，用前缀会串到 123 和 1234 两间屋子。
    const onlySessionId = options.sessionId === undefined ? '' : String(options.sessionId)
    const minTrust = Number.isFinite(options.minTrust) ? clamp01(options.minTrust) : 0
    const maxTrust = Number.isFinite(options.maxTrust) ? clamp01(options.maxTrust) : 1
    const excludeSources = new Set(
      Array.isArray(options.excludeSources) ? options.excludeSources.map((source) => String(source)) : [],
    )
    const candidates = new Map()
    const accept = (sessionId) => {
      const session = String(sessionId)
      if (excludeSessionId !== '' && session === excludeSessionId) return false
      if (onlySessionId !== '' && session !== onlySessionId) return false
      return true
    }
    const touch = (id, sessionId, route, update = {}) => {
      if (!accept(sessionId)) return false
      let candidate = candidates.get(id)
      if (!candidate) {
        candidate = { id, lex: 0, entity: 0, time: false, graph: false, routes: new Set() }
        candidates.set(id, candidate)
      }
      candidate.routes.add(route)
      if (update.lex !== undefined) candidate.lex = Math.max(candidate.lex, update.lex)
      if (update.entity !== undefined) candidate.entity = Math.max(candidate.entity, update.entity)
      if (update.time === true) candidate.time = true
      if (update.graph === true) candidate.graph = true
      return true
    }

    const tokens = tokenize(query)
    if (tokens.length > 0) {
      if (tokens.every((token) => Array.from(token).length <= 1)) {
        const rows = db.prepare(`
          SELECT e.episode_id AS id, ep.session_id AS session_id
          FROM experiences e
          JOIN episodes ep ON ep.id = e.episode_id
          WHERE e.dropped IS NULL AND e.content LIKE ? ESCAPE '\\'
          ORDER BY e.ts DESC LIMIT ?
        `).all(`%${escapeLike(query)}%`, routeLimit * 4)
        let accepted = 0
        for (const row of rows) {
          if (accepted >= routeLimit) break
          if (touch(row.id, row.session_id, 'fts', { lex: 1 })) accepted += 1
        }
      } else {
        // bm25 不能在 GROUP BY 里用；先按分数取一批命中，再在 JS 里按情景取最好的那条。
        const rows = db.prepare(`
          SELECT e.episode_id AS id, ep.session_id AS session_id, bm25(experience_fts) AS score
          FROM experience_fts
          JOIN experiences e ON e.hash = experience_fts.id
          JOIN episodes ep ON ep.id = e.episode_id
          WHERE experience_fts MATCH ? AND e.dropped IS NULL
          ORDER BY score LIMIT ?
        `).all(tokens.map(quoteFts).join(' OR '), Math.max(100, routeLimit * 8))
        const bestByEpisode = new Map()
        for (const row of rows) {
          const score = Number(row.score)
          const current = bestByEpisode.get(row.id)
          if (!current || score < current.score) {
            bestByEpisode.set(row.id, { id: row.id, sessionId: row.session_id, score })
          }
        }
        const rankedRows = [...bestByEpisode.values()].sort((left, right) => left.score - right.score).slice(0, routeLimit)
        // bm25 的绝对值可以很小；拿固定小数当分母会把所有命中压到接近 0。
        const best = Math.max(...rankedRows.map((row) => -row.score))
        for (const row of rankedRows) {
          const lex = best > 0 ? Math.max(0, Math.min(1, -row.score / best)) : 0
          touch(row.id, row.sessionId, 'fts', { lex })
        }
      }
    }

    const queryEntities = extractEntities(query)
    if (queryEntities.length > 0) {
      const clauses = queryEntities.map(() => "entities LIKE ? ESCAPE '\\'").join(' OR ')
      const likes = queryEntities.map((entity) => `%"${escapeLike(entity)}"%`)
      const rows = db.prepare(`
        SELECT id, session_id, entities FROM episodes
        WHERE (${clauses}) ORDER BY end_ts DESC LIMIT ?
      `).all(...likes, routeLimit * 4)
      const wanted = new Set(queryEntities.map((entity) => entity.toLowerCase()))
      let accepted = 0
      for (const row of rows) {
        if (accepted >= routeLimit) break
        const own = new Set(parseJsonArray(row.entities).map((entity) => entity.toLowerCase()))
        let overlap = 0
        for (const entity of wanted) if (own.has(entity)) overlap += 1
        if (overlap === 0) continue
        if (touch(row.id, row.session_id, 'entity', { entity: overlap / wanted.size })) accepted += 1
      }
    }

    const window = parseTimeWindow(query)
    if (window) {
      const rows = db.prepare(`
        SELECT id, session_id FROM episodes
        WHERE end_ts >= ? AND start_ts < ?
        ORDER BY end_ts DESC LIMIT ?
      `).all(window.start, window.end, routeLimit * 2)
      let accepted = 0
      for (const row of rows) {
        if (accepted >= routeLimit) break
        if (touch(row.id, row.session_id, 'time', { time: true })) accepted += 1
      }
    }

    // 图扩展只走一跳：从已有候选里找它们和查询都不共享的实体，再找共享这些实体的情景。
    const seedEntities = new Set()
    const wantedEntities = new Set(queryEntities.map((entity) => entity.toLowerCase()))
    for (const candidate of [...candidates.values()].slice(0, 5)) {
      const row = episodeRow(candidate.id)
      if (!row) continue
      for (const entity of parseJsonArray(row.entities)) {
        if (!wantedEntities.has(entity.toLowerCase())) seedEntities.add(entity)
      }
    }
    if (seedEntities.size > 0) {
      const list = [...seedEntities].slice(0, 12)
      const clauses = list.map(() => "entities LIKE ? ESCAPE '\\'").join(' OR ')
      const likes = list.map((entity) => `%"${escapeLike(entity)}"%`)
      const rows = db.prepare(`
        SELECT id, session_id FROM episodes
        WHERE (${clauses}) ORDER BY end_ts DESC LIMIT ?
      `).all(...likes, routeLimit * 4)
      let accepted = 0
      for (const row of rows) {
        if (accepted >= routeLimit) break
        if (candidates.has(row.id)) continue
        if (touch(row.id, row.session_id, 'graph', { graph: true })) accepted += 1
      }
    }

    const ids = [...candidates.keys()]
    if (ids.length === 0) {
      return { enabled: true, items: [], reason: 'no-strong-match', latencyMs: elapsedMs(started) }
    }
    const placeholders = ids.map(() => '?').join(',')
    const rows = db.prepare(`
      SELECT id, start_ts, end_ts, session_id, importance, source_trust, entities, participants, channel
      FROM episodes WHERE id IN (${placeholders})
    `).all(...ids)
    const now = Date.now()
    const ranked = []
    for (const row of rows) {
      const candidate = candidates.get(row.id)
      if (!candidate) continue
      const trust = clamp01(row.source_trust)
      if (trust < minTrust || trust > maxTrust) continue
      if (excludeSources.has(String(row.channel || ''))) continue
      const lex = candidate.lex === 0 && candidate.time ? 0.45 : candidate.lex
      const recency = Math.pow(1 + Math.max(0, now - Number(row.end_ts)) / DAY_MS / 7, -0.6)
      const graph = candidate.graph ? 0.5 : 0
      const score = 0.32 * lex
        + 0.18 * candidate.entity
        + 0.14 * recency
        + 0.14 * clamp01(row.importance)
        + 0.10 * 0.5
        + 0.07 * graph
        + 0.05 * clamp01(row.source_trust)
      if (score < minScore) continue
      ranked.push({ row, score, routes: candidate.routes })
    }
    ranked.sort((left, right) => right.score - left.score || Number(right.row.end_ts) - Number(left.row.end_ts))
    const items = []
    for (const entry of ranked.slice(0, fuseLimit)) {
      const item = hydrateEpisode(entry.row, entry.score, entry.routes)
      if (item) items.push(item)
    }
    return {
      enabled: true,
      items,
      reason: items.length > 0 ? 'ok' : 'no-strong-match',
      latencyMs: elapsedMs(started),
    }
  }

  function elapsedMs(started) {
    return Number(process.hrtime.bigint() - started) / 1e6
  }

  /**
   * 把阶段 0 留下、还没编码的经历补成情景。处理过的低显著经历会留下 salience，
   * 不会被反复扫描。
   * @param {number} limit - 这一批最多处理多少条。
   * @returns {number} 实际处理的条数。
   */
  function encodePending(limit = 200) {
    if (db === null) return 0
    const max = Math.min(Math.max(1, Math.round(Number(limit) || 200)), 5000)
    const rows = db.prepare(`
      SELECT id, ts, session_id, turn, kind, role, actor, source_kind, content, entities, source_trust, meta
      FROM experiences
      WHERE episode_id IS NULL AND salience = 0 AND dropped IS NULL AND content <> ''
      ORDER BY ts ASC, id ASC LIMIT ?
    `).all(max)
    let processed = 0
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const row of rows) {
        const record = {
          at: Number(row.ts),
          sessionId: row.session_id,
          turn: row.turn,
          kind: row.kind,
          role: row.role,
          actor: row.actor,
          source: row.source_kind,
          text: row.content,
          sourceTrust: Number(row.source_trust),
          meta: parseJsonObject(row.meta),
        }
        const encoded = encodeRecord(record, { excludeId: row.id })
        updateEncodedStmt.run(
          JSON.stringify(encoded.entities),
          encoded.salience,
          encoded.episodeId,
          encoded.trust,
          row.id,
        )
        processed += 1
      }
      db.exec('COMMIT')
    } catch (error) {
      try {
        db.exec('ROLLBACK')
      } catch {}
      throw error
    }
    return processed
  }

  /**
   * 短期窗口：最近一段时间里还“当场想得起”的对话原文。
   * 只读 experiences，不写派生表——它是长期记忆的取景框，不是第二份存储。
   * @param {{ since?: number, rows?: number, onlySessionId?: string, excludeSessionId?: string, excludeSources?: string[] }} [options]
   * @returns {{ at: number, sessionId: string, role: string, actor: string, source: string, text: string }[]} 按时间正序
   */
  function recentWindow(options = {}) {
    if (db === null) return []
    const since = Number.isFinite(options.since) ? Number(options.since) : 0
    const want = Math.min(Math.max(1, Number(options.rows) || 12), 200)
    const only = typeof options.onlySessionId === 'string' ? options.onlySessionId : ''
    const exclude = typeof options.excludeSessionId === 'string' ? options.excludeSessionId : ''
    const skip = new Set(Array.isArray(options.excludeSources) ? options.excludeSources : [])
    let raw
    try {
      raw = windowStmt.all(since, want * 3)
    } catch (error) {
      diag(`store: 短期窗口读失败（${String((error && error.message) || error)}）`)
      return []
    }
    const out = []
    for (const row of raw) {
      const sessionId = String(row.session_id ?? '')
      const source = String(row.source_kind ?? '')
      if (only !== '' && sessionId !== only) continue
      if (exclude !== '' && sessionId === exclude) continue
      if (skip.has(source)) continue
      out.push({
        at: Number(row.ts) || 0,
        sessionId,
        role: String(row.role ?? ''),
        actor: String(row.actor ?? ''),
        source,
        text: String(row.content ?? ''),
      })
      if (out.length >= want) break
    }
    out.reverse()
    return out
  }

  /**
   * 写一条从对话里提炼出来的事实。同一 subject+predicate 已经有现值时：
   * 内容相同就跳过（别把“昵称是 EMT”存成十份），内容不同就把旧值标成被取代
   * ——改了昵称不该留下两条同时生效。
   * @param {{ subject: string, predicate: string, object: string, confidence?: number, source?: string, sourceIds?: number[], validFrom?: number, at?: number }} fact
   * @returns {{ action: string, id?: number, reason?: string }}
   */
  function upsertFact(fact) {
    if (db === null) return { action: 'skipped', reason: 'degraded' }
    const trim = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
    const subject = trim(fact.subject, 60)
    const predicate = trim(fact.predicate, 60)
    const object = trim(fact.object, 240)
    if (subject === '' || predicate === '' || object === '') return { action: 'skipped', reason: 'empty' }
    const at = Number.isFinite(fact.at) ? Number(fact.at) : Date.now()
    try {
      const active = factActiveStmt.get(subject, predicate)
      if (active && String(active.object) === object) return { action: 'same', id: Number(active.id) }
      const info = factInsertStmt.run(
        subject,
        predicate,
        object,
        Number.isFinite(fact.validFrom) ? Number(fact.validFrom) : at,
        clamp01(Number.isFinite(fact.confidence) ? Number(fact.confidence) : 0.7),
        trim(fact.source || 'consolidation', 40),
        JSON.stringify(Array.isArray(fact.sourceIds) ? fact.sourceIds.slice(0, 40) : []),
      )
      const id = Number(info.lastInsertRowid)
      if (active) factSupersedeStmt.run(id, at, Number(active.id))
      return { action: active ? 'superseded' : 'added', id }
    } catch (error) {
      diag(`store: 事实写入失败（${String((error && error.message) || error)}）`)
      return { action: 'skipped', reason: 'error' }
    }
  }

  /** 当前生效的事实（被取代的不返回）；给状态页和提炼前的粗筛用。 */
  function listFacts(limit = 40) {
    if (db === null) return []
    const max = Math.min(Math.max(1, Number(limit) || 40), 500)
    try {
      return factListStmt.all(max).map((row) => ({
        subject: String(row.subject ?? ''),
        predicate: String(row.predicate ?? ''),
        object: String(row.object ?? ''),
        confidence: Number(row.confidence) || 0,
        validFrom: Number(row.validFrom) || 0,
      }))
    } catch {
      return []
    }
  }

  /** 记一次转长期提炼的流水，方便事后看“她什么时候把什么变成了长期记忆”。 */
  function recordRun({ startedAt, finishedAt, status, tasks = [], notes = '' }) {
    if (db === null) return false
    try {
      runInsertStmt.run(
        Number(startedAt) || Date.now(),
        Number(finishedAt) || null,
        String(status || 'ok').slice(0, 40),
        JSON.stringify(Array.isArray(tasks) ? tasks.slice(0, 20) : []),
        String(notes ?? '').slice(0, 400),
      )
      return true
    } catch {
      return false
    }
  }

  /**
   * 按会话聚合最近经历，给其他插件选“她最近待在哪个会话”用。
   * @param {number} limit - 最多返回多少个会话。
   * @returns {{ id: string, lastAt: number, events: number }[]} 按最近活动倒序。
   */
  function sessionOverview(limit = 20) {
    if (db === null) return []
    const max = Math.min(Math.max(1, Number(limit) || 20), 200)
    const rows = db.prepare(`
      SELECT session_id AS id, MAX(ts) AS last_at, COUNT(*) AS events
      FROM experiences
      WHERE session_id <> ''
      GROUP BY session_id
      ORDER BY last_at DESC
      LIMIT ?
    `).all(max)
    return rows.map((row) => ({ id: row.id, lastAt: Number(row.last_at), events: Number(row.events) }))
  }

  /** 经历条数、情景条数、丢弃条数与文件体积。 */
  function stats() {
    if (db === null) {
      return { degraded: true, total: 0, dropped: 0, episodes: 0, facts: 0, runs: 0, lastEpisodeAt: 0, dbBytes: 0, jsonlBytes: fileSize(jsonlPath) }
    }
    const total = Number(db.prepare('SELECT COUNT(*) AS n FROM experiences').get()?.n ?? 0)
    const dropped = Number(db.prepare('SELECT COUNT(*) AS n FROM experiences WHERE dropped IS NOT NULL').get()?.n ?? 0)
    const episodes = Number(db.prepare('SELECT COUNT(*) AS n FROM episodes').get()?.n ?? 0)
    const facts = Number(db.prepare('SELECT COUNT(*) AS n FROM facts WHERE superseded_by IS NULL').get()?.n ?? 0)
    const runs = Number(db.prepare('SELECT COUNT(*) AS n FROM sleep_runs').get()?.n ?? 0)
    const lastEpisodeAt = Number(db.prepare('SELECT MAX(end_ts) AS at FROM episodes').get()?.at ?? 0)
    return { degraded: false, total, dropped, episodes, facts, runs, lastEpisodeAt, dbBytes: fileSize(dbPath), jsonlBytes: fileSize(jsonlPath) }
  }

  /** 今天的经历条数（按本地日期）。 */
  function countToday(now = Date.now()) {
    if (db === null) return 0
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    return countBetween(start.getTime(), start.getTime() + DAY_MS)
  }

  /** 区间内的经历条数，左闭右开。 */
  function countBetween(start, end) {
    if (db === null) return 0
    return Number(db.prepare('SELECT COUNT(*) AS n FROM experiences WHERE ts >= ? AND ts < ?').get(start, end)?.n ?? 0)
  }

  /** 内容哈希：按 hash 排序后对「hash + 正文」做 sha256，用来验证重建一致。 */
  function contentDigest() {
    if (db === null) {
      const hash = createHash('sha256')
      const lines = existsSync(jsonlPath) ? readFileSync(jsonlPath, 'utf8').split('\n').filter(Boolean) : []
      for (const line of lines.map((item) => JSON.parse(item)).sort((a, b) => String(a.hash).localeCompare(String(b.hash)))) {
        hash.update(`${line.hash}\0${line.text ?? ''}\n`)
      }
      return hash.digest('hex')
    }
    const hash = createHash('sha256')
    const rows = db.prepare('SELECT hash, content FROM experiences ORDER BY hash').all()
    for (const row of rows) hash.update(`${row.hash}\0${row.content}\n`)
    return hash.digest('hex')
  }

  /**
   * 从 experience.jsonl 全量重放。清空派生表后再写回，不改 JSONL；
   * 情景、实体和显著性也会按同一套规则重新生成。
   * @returns {Promise<{ count: number, lines: number, digest: string }>} 重放结果。
   */
  async function rebuild() {
    if (db === null) throw new Error('SQLite 不可用，无法重建；JSONL 本身仍然完整')
    if (!existsSync(jsonlPath)) return { count: 0, lines: 0, digest: contentDigest() }

    db.exec('BEGIN IMMEDIATE')
    db.exec('DELETE FROM experience_fts; DELETE FROM experiences; DELETE FROM episodes;')
    db.exec('COMMIT')

    let lines = 0
    let count = 0
    let batch = 0
    db.exec('BEGIN IMMEDIATE')
    try {
      const stream = createReadStream(jsonlPath, 'utf8')
      const reader = createInterface({ input: stream, crlfDelay: Infinity })
      for await (const line of reader) {
        if (!line.trim()) continue
        lines += 1
        let record
        try {
          record = JSON.parse(line)
        } catch (error) {
          diag(`store: 重建时跳过坏行 ${lines}（${String((error && error.message) || error)}）`)
          continue
        }
        const full = {
          ...record,
          hash: record.hash || contentHash(record),
          recordedAt: record.recordedAt ?? record.at,
        }
        const result = insertOne(full)
        if (result.inserted && !record.dropped && record.text) count += 1
        batch += 1
        if (batch >= 1000) {
          db.exec('COMMIT')
          db.exec('BEGIN IMMEDIATE')
          batch = 0
        }
      }
      db.exec('COMMIT')
    } catch (error) {
      try {
        db.exec('ROLLBACK')
      } catch {}
      throw error
    }
    return { count, lines, digest: contentDigest() }
  }

  // 打开时就补齐 JSONL 里有、库里没有的记录（上次异常退出留下的尾巴）。
  function catchUpFromJsonl() {
    if (db === null || !existsSync(jsonlPath)) return 0
    let added = 0
    const lines = readFileSync(jsonlPath, 'utf8').split('\n')
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const line of lines) {
        if (!line.trim()) continue
        let record
        try {
          record = JSON.parse(line)
        } catch {
          continue
        }
        if (byHashStmt.get(record.hash)) continue
        const full = {
          ...record,
          hash: record.hash || contentHash(record),
          recordedAt: record.recordedAt ?? record.at,
        }
        const result = insertOne(full)
        if (result.inserted && !record.dropped && record.text) added += 1
      }
      db.exec('COMMIT')
    } catch (error) {
      try {
        db.exec('ROLLBACK')
      } catch {}
      diag(`store: 补齐 JSONL 失败（${String((error && error.message) || error)}）`)
    }
    return added
  }

  function setConfig(config) {
    parameters = normalizeParameters(config)
    return { ...parameters }
  }

  function close() {
    try {
      db?.close()
    } catch (error) {
      diag(`store: 关库时出错（${String((error && error.message) || error)}）`)
    }
    db = null
  }

  return {
    dbPath,
    jsonlPath,
    get degraded() { return degraded },
    insert,
    search,
    recall,
    openEpisode,
    encodePending,
    sessionOverview,
    recentWindow,
    upsertFact,
    listFacts,
    recordRun,
    stats,
    countToday,
    countBetween,
    contentDigest,
    rebuild,
    catchUpFromJsonl,
    setConfig,
    close,
    // 给测试和后续阶段用，不作为公开服务面
    _db: () => db,
    _deleteFts: (hash) => deleteFtsStmt?.run(hash),
    _hasFts: (hash) => Boolean(ftsHasStmt?.get(hash)),
  }
}
