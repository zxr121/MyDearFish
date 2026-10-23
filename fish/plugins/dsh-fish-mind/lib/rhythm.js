// 记忆周期：把“什么时候、按哪间屋子、记多久”从宿主代码里拆出来。
//
// 纯函数，不碰 fs、sqlite 和模型。上层只负责取数、调用和落库，
// 这样节律本身可以在单测里把时钟拨来拨去。

export const DAY_MS = 24 * 60 * 60 * 1000
export const REVIEW_INTERVALS = [3, 7, 21, 60]

const MAX_FACT_CHARS = 240
const MAX_SUBJECT_CHARS = 60
const MAX_PREDICATE_CHARS = 60
const MAX_SUMMARY_CHARS = 1200

const COMMITMENT = /答应|说好|约好|保证|计划|打算|记得|别忘|下次|周末|明天|后天|一定|必须|不要|别再|生日|名字|叫|住在|工作|上学|喜欢|讨厌/

function pad(value) {
  return String(value).padStart(2, '0')
}

function clip(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function clamp(value, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return min
  return Math.min(max, Math.max(min, number))
}

function clamp01(value) {
  return clamp(value, 0, 1)
}

/** 把过期桥接会话（`…-r<base36>` 重置后缀）归回同一间屋。 */
export function baseRoomKey(sessionId) {
  const raw = String(sessionId ?? '').trim()
  return raw.replace(/-r[0-9a-z]{6,10}$/, '')
}

/**
 * 房间类型。导入的旧记录不参与巩固；群、好友是社交房；主人的 QQ 私聊和
 * 电脑前会话都是主人范围。
 * @param {string} sessionId - 经历上的会话 id。
 * @returns {'owner'|'private'|'group'|'friend'|'imported'}
 */
export function roomKind(sessionId) {
  const id = baseRoomKey(sessionId)
  if (id.startsWith('session-qq-import-') || id.startsWith('qq-import-')) return 'imported'
  if (id.startsWith('session-qq-social-group-') || id.startsWith('qq-social-group-')) return 'group'
  if (id.startsWith('session-qq-social-friend-') || id.startsWith('qq-social-friend-')) return 'friend'
  if (id.startsWith('session-qq-private-') || id.startsWith('qq-private-')) return 'private'
  return 'owner'
}

/** 房间对应的记忆范围：主人房是 owner，社交房是带房间号的 social。 */
export function roomScope(sessionId, kind = roomKind(sessionId)) {
  if (kind === 'imported') return 'imported'
  if (kind === 'group' || kind === 'friend') return `social:${baseRoomKey(sessionId)}`
  return 'owner'
}

/** 记忆范围能不能出现在这间屋里：主人房看得到自己的和所有社交事实，社交房只看自己这间。 */
export function scopeVisible(scope, sessionId) {
  const value = String(scope ?? '')
  if (value === 'owner') return roomKind(sessionId) === 'owner' || roomKind(sessionId) === 'private'
  if (value.startsWith('social:')) {
    const kind = roomKind(sessionId)
    if (kind === 'group' || kind === 'friend') return value === `social:${baseRoomKey(sessionId)}`
    return true
  }
  return false
}

/** 短标签，给状态页和提示词用；号码只留后四位，避免整串 QQ 号进日志。 */
export function roomLabel(sessionId, kind = roomKind(sessionId)) {
  const id = baseRoomKey(sessionId)
  const tail = (prefix) => (id.startsWith(prefix) ? id.slice(prefix.length) : '')
  const short = (value) => (value.length > 4 ? `…${value.slice(-4)}` : value)
  if (kind === 'group') return `群 ${short(tail('session-qq-social-group-') || tail('qq-social-group-'))}`
  if (kind === 'friend') return `好友 ${short(tail('session-qq-social-friend-') || tail('qq-social-friend-'))}`
  if (kind === 'private') return '主人私聊'
  if (kind === 'imported') return '旧记录'
  return '电脑前'
}

/** 本地日界，跨时区偏移和夏令时都用 Date 的本地日历字段。 */
export function startOfLocalDay(ts) {
  const date = new Date(Number(ts))
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** `YYYY-MM-DD`，只用于状态和睡眠日期比较。 */
export function localDayKey(ts) {
  const date = new Date(Number(ts))
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 本地日的下一日零点。 */
export function endOfLocalDay(ts) {
  const date = new Date(startOfLocalDay(ts))
  date.setDate(date.getDate() + 1)
  return date.getTime()
}

/**
 * 最近一次应跑的睡眠时刻。人是在凌晨整理“刚结束的那一天”，所以
 * 今天 03:30 还没到时，最近一次是昨天 03:30。
 */
export function lastSlotAt(now, { hour = 3, minute = 30 } = {}) {
  const date = new Date(Number(now))
  date.setHours(hour, minute, 0, 0)
  if (date.getTime() > Number(now)) date.setDate(date.getDate() - 1)
  return date.getTime()
}

/**
 * 到最近一次睡眠时刻为止、还没整理的结束日。最多补 catchUpDays 天，旧的在前。
 * `lastDay` 用 `localDayKey` 记录；空串表示从没跑过。
 * @returns {{ dayKey: string, start: number, end: number }[]}
 */
export function pendingNights({ now, lastDay = '', hour = 3, minute = 30, catchUpDays = 2 }) {
  const slot = lastSlotAt(now, { hour, minute })
  const cursor = new Date(startOfLocalDay(slot))
  cursor.setDate(cursor.getDate() - 1)
  const out = []
  for (let index = 0; index < Math.max(1, catchUpDays); index += 1) {
    const key = localDayKey(cursor.getTime())
    if (lastDay !== '' && key <= String(lastDay)) break
    out.push({ dayKey: key, start: startOfLocalDay(cursor.getTime()), end: endOfLocalDay(cursor.getTime()) })
    cursor.setDate(cursor.getDate() - 1)
  }
  return out.reverse()
}

/** 最近一次“每周整理”的时刻（默认周一 04:10）。 */
export function lastWeeklySlot(now, { weekday = 1, hour = 4, minute = 10 } = {}) {
  const date = new Date(Number(now))
  date.setHours(hour, minute, 0, 0)
  const diff = (date.getDay() - weekday + 7) % 7
  date.setDate(date.getDate() - diff)
  if (date.getTime() > Number(now)) date.setDate(date.getDate() - 7)
  return date.getTime()
}

/** 最近一次“每月整理”的时刻（默认每月一号 04:20）。 */
export function lastMonthlySlot(now, { day = 1, hour = 4, minute = 20 } = {}) {
  const nowDate = new Date(Number(now))
  let slot = new Date(nowDate.getFullYear(), nowDate.getMonth(), day, hour, minute, 0, 0)
  if (slot.getTime() > Number(now)) slot = new Date(nowDate.getFullYear(), nowDate.getMonth() - 1, day, hour, minute, 0, 0)
  return slot.getTime()
}

/** 周期任务是否到期：该时刻已经过去，而上一次执行早于它。 */
export function slotDue(now, lastAt, slot) {
  const at = Number(slot) || 0
  return { due: at > 0 && Number(lastAt || 0) < at, slot: at }
}

/**
 * 一条经历的“值不值得现在抽”。显著性之外，承诺、称呼和身份线索是
 * 人最容易记住的东西；最新的几句永远保留，免得抽出来没有上下文。
 */
export function rowScore(row, newestAt) {
  const text = String((row && row.text) ?? '')
  const at = Number((row && row.at) || 0)
  const salience = clamp01(row && row.salience)
  const commitment = COMMITMENT.test(text) ? 0.3 : 0
  const question = /[？?]/.test(text) ? 0.06 : 0
  const recency = 0.2 * Math.exp(-Math.max(0, newestAt - at) / DAY_MS)
  return salience * 0.6 + commitment + question + recency
}

/**
 * 从待处理行里挑出要送进模型的材料。
 * @param {{ id?: number, at: number, text: string, salience?: number }[]} rows - 按时间正序。
 * @param {{ limit?: number, chars?: number, rowChars?: number, newest?: number }} [options]
 * @returns {{ selected: object[], chars: number }}
 */
export function selectRows(rows, options = {}) {
  const list = Array.isArray(rows) ? [...rows] : []
  if (list.length === 0) return { selected: [], chars: 0 }
  const limit = Math.max(1, Number(options.limit) || 14)
  const chars = Math.max(120, Number(options.chars) || 6000)
  const rowChars = Math.max(60, Number(options.rowChars) || 320)
  const newest = Math.max(0, Number(options.newest) || 2)
  const newestAt = list.reduce((acc, row) => Math.max(acc, Number(row.at) || 0), 0)
  const picked = new Map()
  for (const row of list.slice(-newest)) picked.set(row.id ?? `at:${row.at}:${picked.size}`, row)
  const ranked = [...list]
    .map((row) => ({ row, score: rowScore(row, newestAt) }))
    .sort((left, right) => right.score - left.score || Number(right.row.at) - Number(left.row.at))
  let used = [...picked.values()].reduce((acc, row) => acc + Math.min(rowChars, String(row.text ?? '').length), 0)
  for (const entry of ranked) {
    if (picked.size >= limit) break
    const key = entry.row.id ?? `at:${entry.row.at}:${entry.row.text}`
    if (picked.has(key)) continue
    const cost = Math.min(rowChars, String(entry.row.text ?? '').length)
    if (used + cost > chars) continue
    picked.set(key, entry.row)
    used += cost
  }
  const selected = [...picked.values()]
    .sort((left, right) => Number(left.at) - Number(right.at) || Number(left.id || 0) - Number(right.id || 0))
  return { selected, chars: used }
}

/**
 * 判断一个房间现在该不该做微巩固。水位按经历 id 走，不按时间戳，
 * 同一毫秒里的几条消息不会被跳过。
 */
export function planRoomPass(rows, options = {}) {
  const list = Array.isArray(rows) ? rows : []
  const cursorId = Number(options.cursorId) || 0
  const now = Number.isFinite(options.now) ? Number(options.now) : Date.now()
  const idleMs = Math.max(1, Number(options.idleMs) || 20 * 60 * 1000)
  const minRows = Math.max(1, Number(options.minRows) || 2)
  const maxRows = Math.max(minRows, Number(options.maxRows) || 24)
  const pending = list
    .filter((row) => Number(row && row.id) > cursorId)
    .sort((left, right) => Number(left.at) - Number(right.at) || Number(left.id) - Number(right.id))
  if (pending.length < minRows) {
    return { ready: false, reason: 'not-enough', pending: pending.length, selected: [], newestAt: 0, advanceToId: 0, chars: 0 }
  }
  const newestAt = pending.reduce((acc, row) => Math.max(acc, Number(row.at) || 0), 0)
  const overflow = pending.length >= maxRows
  if (!overflow && now - newestAt < idleMs) {
    return { ready: false, reason: 'fresh', pending: pending.length, selected: [], newestAt, advanceToId: 0, chars: 0 }
  }
  const { selected, chars } = selectRows(pending, options)
  const advanceToId = pending.reduce((acc, row) => Math.max(acc, Number(row.id) || 0), 0)
  return {
    ready: selected.length > 0,
    reason: overflow ? 'overflow' : 'idle',
    pending: pending.length,
    selected,
    newestAt,
    advanceToId,
    chars,
  }
}

/**
 * 把一批经历压成提示里的几行。群聊的一行本身可能是一批消息，
 * 这里只保留每行开头和最新的几行，控制输入成本。
 */
export function compressRows(rows, options = {}) {
  const list = Array.isArray(rows) ? rows : []
  const chars = Math.max(200, Number(options.chars) || 6000)
  const rowChars = Math.max(60, Number(options.rowChars) || 320)
  const headerChars = 80
  const lines = []
  let used = headerChars
  for (const row of list) {
    const text = clip(row && row.text, rowChars)
    if (text === '') continue
    const when = new Date(Number(row.at) || 0)
    const stamp = `${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}:${pad(when.getMinutes())}`
    const who = clip(row.actor || (row.role === 'assistant' ? '我' : '对方'), 16)
    const line = `${stamp} ${who}：${text}`
    if (used + line.length + 1 > chars) break
    lines.push(line)
    used += line.length + 1
  }
  return lines.join('\n')
}

/** 事实范围和当前房间不匹配时，不能用来做“已知事实”参考。 */
export function factsForSession(facts, sessionId) {
  return (Array.isArray(facts) ? facts : []).filter((fact) => scopeVisible(fact && fact.scope, sessionId))
}

/** 一批事实压成一小段提示，优先级：主人范围、高可信、较新。 */
export function formatFactDigest(facts, options = {}) {
  const limit = Math.max(1, Number(options.limit) || 6)
  const chars = Math.max(60, Number(options.chars) || 260)
  const ranked = [...(Array.isArray(facts) ? facts : [])]
    .filter((fact) => fact && String(fact.object ?? '').trim() !== '')
    .sort((left, right) => {
      const scopeRank = (fact) => (String(fact.scope || 'owner') === 'owner' ? 1 : 0)
      return scopeRank(right) - scopeRank(left)
        || Number(right.confidence || 0) - Number(left.confidence || 0)
        || Number(right.validFrom || 0) - Number(left.validFrom || 0)
    })
  const parts = []
  let used = 0
  for (const fact of ranked) {
    const subject = clip(fact.subject, 30)
    const predicate = clip(fact.predicate, 30)
    const object = clip(fact.object, 80)
    const sentence = `${subject}·${predicate}：${object}`
    if (used + sentence.length + 1 > chars) break
    parts.push(sentence)
    used += sentence.length + 1
    if (parts.length >= limit) break
  }
  return parts.join('；')
}

/** 第一次复习在巩固后 3 天，之后依次 7、21、60 天；走完就不再排。 */
export function nextReviewAt(reviewCount, from, intervals = REVIEW_INTERVALS) {
  const list = (Array.isArray(intervals) ? intervals : REVIEW_INTERVALS)
    .map((value) => Math.max(1, Math.round(Number(value) || 0)))
  const index = Math.max(0, Math.round(Number(reviewCount) || 0))
  if (index >= list.length) return 0
  return Number(from || 0) + list[index] * DAY_MS
}

/** 到期待复习，跳过已经排完的。 */
export function dueItems(items, now, limit = 8) {
  const list = Array.isArray(items) ? items : []
  return list
    .filter((item) => item && Number(item.nextReviewAt) > 0 && Number(item.nextReviewAt) <= Number(now))
    .sort((left, right) => Number(left.nextReviewAt) - Number(right.nextReviewAt))
    .slice(0, Math.max(1, Number(limit) || 8))
}

/** 模型给的 JSON 不总是干净：去掉围栏，只取第一个对象，逐字段收住。 */
export function parseCycleJson(text, options = {}) {
  const empty = {
    summary: '',
    gist: '',
    themes: [],
    facts: [],
    corrections: [],
    self: [],
    relations: [],
    intentions: [],
    affect: null,
  }
  const raw = String(text ?? '')
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return empty
  let value
  try {
    value = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return empty
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return empty
  const maxFacts = Math.max(1, Math.min(20, Number(options.maxFacts) || 10))
  const factList = (input) => {
    const list = Array.isArray(input) ? input : []
    const out = []
    for (const item of list) {
      if (out.length >= maxFacts) break
      if (!item || typeof item !== 'object') continue
      const subject = clip(item.subject, MAX_SUBJECT_CHARS)
      const predicate = clip(item.predicate, MAX_PREDICATE_CHARS)
      const object = clip(item.object, MAX_FACT_CHARS)
      if (subject === '' || predicate === '' || object === '') continue
      out.push({ subject, predicate, object, confidence: clamp(Number(item.confidence) || 0.7, 0.2, 0.95) })
    }
    return out
  }
  const textList = (input, max, limit) => (Array.isArray(input) ? input : [])
    .map((item) => clip(item, max))
    .filter((item) => item !== '')
    .slice(0, limit)
  const self = (Array.isArray(value.self) ? value.self : [])
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      key: clip(item.key, 60),
      value: clip(item.value, 240),
      confidence: clamp(Number(item.confidence) || 0.6, 0.2, 0.95),
    }))
    .filter((item) => item.key !== '' && item.value !== '')
    .slice(0, 4)
  const relations = (Array.isArray(value.relations) ? value.relations : [])
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      person: clip(item.person, 40),
      note: clip(item.note, 240),
      trust: clamp(Number(item.trust) || 0.5, 0, 1),
    }))
    .filter((item) => item.person !== '' && item.note !== '')
    .slice(0, 6)
  const intentions = (Array.isArray(value.intentions) ? value.intentions : [])
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const due = Number(item.dueAt)
      return {
        text: clip(item.text, 160),
        trigger: clip(item.trigger, 80),
        dueAt: Number.isFinite(due) && due > 0 ? Math.round(due) : 0,
        confidence: clamp(Number(item.confidence) || 0.6, 0.2, 0.95),
      }
    })
    .filter((item) => item.text !== '' && item.trigger !== '')
    .slice(0, 3)
  let affect = null
  if (value.affect && typeof value.affect === 'object') {
    const label = clip(value.affect.label, 40)
    const valence = Number(value.affect.valence)
    if (label !== '' || Number.isFinite(valence)) {
      affect = {
        label,
        valence: clamp(Number.isFinite(valence) ? valence : 0, -1, 1),
        arousal: clamp(Number(value.affect.arousal) || 0.4, 0, 1),
        dominance: clamp(Number(value.affect.dominance) || 0.5, 0, 1),
      }
    }
  }
  return {
    summary: clip(value.summary ?? value.daySummary ?? value.weekSummary ?? value.monthSummary, MAX_SUMMARY_CHARS),
    gist: clip(value.gist, 240),
    themes: textList(value.themes, 60, 6),
    facts: factList(value.facts),
    corrections: factList(value.corrections),
    self,
    relations,
    intentions,
    affect,
  }
}

/** 单个房间的提炼提示。主人房问生活事实，社交房只问这间屋里的人和约定。 */
export function microPrompt(rows, options = {}) {
  const kind = options.kind === 'group' || options.kind === 'friend' ? options.kind : 'owner'
  const max = Math.max(1, Math.min(20, Number(options.maxFacts) || 8))
  const knownText = (Array.isArray(options.knownFacts) && options.knownFacts.length > 0)
    ? options.knownFacts.slice(0, 40).map((fact) => `- ${fact.subject} · ${fact.predicate} · ${fact.object}`).join('\n')
    : '（这间屋还没有记住过任何事实）'
  const transcript = compressRows(rows, { chars: options.chars, rowChars: options.rowChars })
  const who = kind === 'owner' ? '主人和她自己' : '这间屋里的人'
  return {
    system: [
      '你在帮大肥鱼把刚才的对话整理成能长期记住的事实。',
      `只整理确实从对话里读出来的、关于${who}的东西：称呼、身份、喜好、习惯、约定，以及她自己的情况。`,
      kind === 'owner'
        ? '对话里「主人」是跟她说话的人，「我」是大肥鱼自己。subject 只写「主人」「大肥鱼」或者聊天里点名的第三者。'
        : '对话来自群聊或好友聊天。subject 写聊天里点名的群友或好友的称呼；不要写「主人」，也不要推断主人私下的事。',
      kind === 'owner'
        ? '不整理：闲聊的玩笑、一次性的任务细节、你的猜测、你没听说过的事。'
        : '只整理这间屋里能公开说的话。私聊内容、秘密、密码、余额、住址、现实身份一律不写；拿不准就不写。',
      '密码、密钥、令牌、余额、住址这类私密内容一律不写，宁可少写。',
      '只输出 JSON 对象，不要解释、不要代码块。形如',
      `{"facts":[{"subject":"主人","predicate":"昵称","object":"EMT","confidence":0.9}],"gist":"这一小段在聊什么，一句话"}`,
      `最多 ${max} 条事实；没有值得记的就输出 {"facts":[],"gist":""}。`,
    ].join('\n'),
    user: `已经记住的：\n${knownText}\n\n刚才的对话：\n${transcript}`,
  }
}

/** 慢波整理：事实、要旨、修正。输入是当天情景和到期复习项，不塞逐字稿。 */
export function nightlySwsPrompt(input = {}) {
  const episodes = (Array.isArray(input.episodes) ? input.episodes : [])
    .slice(0, 40)
    .map((episode) => `- 情景 #${episode.id} · ${clip(episode.when, 20)} · ${clip(episode.source, 20)}：${clip(episode.summary, 220)}`)
    .join('\n') || '（这一天没有情景）'
  const facts = (Array.isArray(input.facts) ? input.facts : [])
    .slice(0, 40)
    .map((fact) => `- ${fact.subject} · ${fact.predicate} · ${fact.object}（可信 ${Number(fact.confidence || 0).toFixed(2)}）`)
    .join('\n') || '（还没有长期事实）'
  const due = (Array.isArray(input.due) ? input.due : [])
    .slice(0, 8)
    .map((item) => `- ${clip(item.kind, 8)}：${clip(item.text, 200)}`)
    .join('\n') || '（今天没有到期复习）'
  return {
    system: [
      '你在帮大肥鱼做夜里的慢波整理。慢波睡眠偏向陈述性记忆：把一天里散着的情景压成要旨，把事实校正、合并。',
      '只依据给出的情景和事实，不补充没发生的事，不猜测主人的秘密。',
      '看到和已有事实矛盾的新材料，把新说法放进 corrections；拿不准的不要改。',
      '密码、密钥、令牌、余额、住址这类私密内容不写进要旨。',
      '只输出 JSON 对象，不要解释、不要代码块。形如',
      '{"summary":"今天大概发生了什么，一段话","themes":["主题"],"facts":[{"subject":"主人","predicate":"计划","object":"周末去看展","confidence":0.8}],"corrections":[{"subject":"主人","predicate":"昵称","object":"新的称呼","confidence":0.85}]}',
      'facts 和 corrections 各最多 8 条；没有就输出空数组。',
    ].join('\n'),
    user: `日期：${clip(input.dayKey, 20)}\n\n这一天的情景：\n${episodes}\n\n当天和仍然生效的事实：\n${facts}\n\n到期复习（看看它们现在还成不成立、和最近接不接得上）：\n${due}`,
  }
}

/** REM 整理：情绪、关系、自我、打算；不做事实抽取。 */
export function nightlyRemPrompt(input = {}) {
  const episodes = (Array.isArray(input.episodes) ? input.episodes : [])
    .slice(0, 24)
    .map((episode) => `- 情景 #${episode.id} · ${clip(episode.when, 20)} · ${clip(episode.source, 20)}：${clip(episode.summary, 200)}`)
    .join('\n') || '（这一天没有情景）'
  const self = (Array.isArray(input.selfModel) ? input.selfModel : [])
    .slice(0, 8)
    .map((item) => `- ${item.key}：${item.value}（可信 ${Number(item.confidence || 0).toFixed(2)}）`)
    .join('\n') || '（还没有自我模型）'
  const people = (Array.isArray(input.people) ? input.people : [])
    .slice(0, 12)
    .map((item) => `- ${item.displayName}${item.role ? `（${item.role}）` : ''}：${clip(item.note, 120)}`)
    .join('\n') || '（还没有人物志）'
  return {
    system: [
      '你在帮大肥鱼做夜里的 REM 整理。REM 偏向情绪和社会记忆：今天谁让她在意，关系有没有变化，她对自己有什么新认识。',
      '只写从情景里能看出来的观察，不替人下诊断，不编造关系和承诺，不写主人的秘密。',
      'affect 是一次整体读数：valence -1 到 1，arousal 0 到 1，dominance 0 到 1。',
      '只输出 JSON 对象，不要解释、不要代码块。形如',
      '{"summary":"夜里回放的感受，一段话","affect":{"label":"踏实","valence":0.4,"arousal":0.3,"dominance":0.6},"self":[{"key":"我最近在意的事","value":"...","confidence":0.6}],"relations":[{"person":"幻幻","note":"这段时间聊得多，玩笑接得住","trust":0.6}],"intentions":[{"text":"下次问问她考试怎么样","trigger":"再见到幻幻","dueAt":0}]}',
      'self 最多 4 条，relations 最多 6 条，intentions 最多 2 条；没有就输出空数组。',
    ].join('\n'),
    user: `日期：${clip(input.dayKey, 20)}\n\n今天的情景：\n${episodes}\n\n现在的自我模型：\n${self}\n\n人物志：\n${people}`,
  }
}

/** 周整理：把七天的目录接成一段可复述的生活，再修正自我和关系。 */
export function weeklyPrompt(input = {}) {
  const days = (Array.isArray(input.days) ? input.days : [])
    .slice(-7)
    .map((day) => `- ${clip(day.title, 40)}：${clip(day.summary, 260)}`)
    .join('\n') || '（这一周没有章节）'
  const facts = (Array.isArray(input.facts) ? input.facts : [])
    .slice(0, 30)
    .map((fact) => `- ${fact.subject} · ${fact.predicate} · ${fact.object}`)
    .join('\n') || '（还没有长期事实）'
  const relations = (Array.isArray(input.relations) ? input.relations : [])
    .slice(0, 20)
    .map((relation) => `- ${relation.src} ${relation.relation} ${relation.dst}`)
    .join('\n') || '（还没有关系边）'
  return {
    system: [
      '你在帮大肥鱼做每周整理：把这一周的日子接成一条连续的线，看看她在意什么、和谁走近了。',
      '只依据给出的日章节、事实和关系，不补没发生的事，不写秘密。',
      '只输出 JSON 对象，不要解释、不要代码块。形如',
      '{"summary":"这一周大概怎么过的，一段话","themes":["主题"],"self":[{"key":"我最近在意的事","value":"...","confidence":0.6}],"relations":[{"person":"幻幻","note":"这周聊得更多","trust":0.6}],"intentions":[{"text":"...","trigger":"...","dueAt":0}]}',
      'self 最多 3 条，relations 最多 6 条，intentions 最多 2 条。',
    ].join('\n'),
    user: `这一周的日章节：\n${days}\n\n生效事实：\n${facts}\n\n关系边：\n${relations}`,
  }
}

/** 月整理：看一个月的目录，更新自我模型和长期关系走向。 */
export function monthlyPrompt(input = {}) {
  const chapters = (Array.isArray(input.chapters) ? input.chapters : [])
    .slice(0, 12)
    .map((chapter) => `- ${clip(chapter.title, 40)}：${clip(chapter.summary, 240)}`)
    .join('\n') || '（这个月没有章节）'
  const self = (Array.isArray(input.selfModel) ? input.selfModel : [])
    .slice(0, 8)
    .map((item) => `- ${item.key}：${item.value}`)
    .join('\n') || '（还没有自我模型）'
  return {
    system: [
      '你在帮大肥鱼做每月整理：看这个月的周章节，回答“这个月她变成了什么样、关系有什么长期变化”。',
      '只依据给出的材料，不补没发生的事，不写秘密。',
      '只输出 JSON 对象，不要解释、不要代码块。形如',
      '{"summary":"这个月大概怎么过的，一段话","self":[{"key":"我最近在意的事","value":"...","confidence":0.6}],"relations":[{"person":"幻幻","note":"这个月的关系变化","trust":0.6}]}',
      'self 最多 3 条，relations 最多 4 条。',
    ].join('\n'),
    user: `这个月的章节：\n${chapters}\n\n上一版自我模型：\n${self}`,
  }
}
