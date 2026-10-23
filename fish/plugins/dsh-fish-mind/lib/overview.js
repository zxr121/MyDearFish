// 设置页「大肥鱼」的只读总览：把六个插件的状态收成一张能看懂的画像。
//
// 这里不写任何东西，也不把 QQ 号、账号、令牌和本机路径带出去。人物志只给名字、
// 关系数值和记忆摘要；房间只报类型和数量，不报群号。出生设定的写入口在 index.js
// 的宿主路由里，总览只负责看。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { importIsPending, readImportReport } from './archive.js'
import { buildSelfPrompt } from './birth.js'

const DIM_LABELS = {
  happy: '开心',
  calm: '平静',
  sweet: '甜',
  heartache: '心疼',
  worry: '担心',
  sad: '难过',
  jealous: '吃醋',
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function number(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

// 经历正文常带「【QQ 群聊·群 123456】」这类外壳，总览只做预览，顺手把号码抹掉。
function maskContacts(value) {
  return value.replace(/((?:QQ|qq|群聊|群号|群|私聊)[^0-9]{0,6})(\d{5,12})/g, '$1***')
}

function text(value, max) {
  return typeof value === 'string' ? maskContacts(value.replace(/\s+/g, ' ').trim()).slice(0, max) : ''
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function moodLabel(value) {
  if (value >= 80) return '欢喜'
  if (value >= 62) return '开心'
  if (value >= 42) return '一般'
  if (value >= 25) return '心疼'
  return '难过'
}

function moodOverview(dshHome) {
  const raw = readJson(join(dshHome, 'feiyu-mood', 'state.json'))
  if (!isPlainObject(raw)) return { available: false, mood: null, label: '', dims: [], timeline: [] }
  const mood = number(raw.mood, 50)
  const dims = []
  if (isPlainObject(raw.dims)) {
    for (const [key, label] of Object.entries(DIM_LABELS)) {
      const value = number(raw.dims[key])
      if (value > 0) dims.push({ key, label, value })
    }
  }
  dims.sort((left, right) => right.value - left.value)
  const timeline = Array.isArray(raw.timeline)
    ? raw.timeline.slice(-12).map((item) => ({
      at: number(item && item.at),
      mood: number(item && item.mood, mood),
      delta: number(item && item.delta),
      reason: text(item && item.reason, 160),
    }))
    : []
  return {
    available: true,
    mood,
    label: moodLabel(mood),
    lastReason: text(raw.lastReason, 240),
    updatedAt: number(raw.updatedAt),
    dims,
    timeline,
  }
}

function factText(value) {
  if (typeof value === 'string') return text(value, 200)
  if (isPlainObject(value)) return text(value['文'] || value.text, 200)
  return ''
}

function socialOverview(dshHome) {
  const raw = readJson(join(dshHome, 'qq-social-people.json'))
  const people = isPlainObject(raw) && isPlainObject(raw.people) ? raw.people : null
  if (people === null) return { available: false, count: 0, people: [] }
  const list = []
  for (const person of Object.values(people)) {
    if (!isPlainObject(person)) continue
    const relation = isPlainObject(person['关系']) ? person['关系'] : {}
    const rooms = isPlainObject(person['房'])
      ? Object.entries(person['房']).slice(0, 4).map(([key, room]) => ({
        kind: key.startsWith('group:') ? '群聊' : key.startsWith('friend:') ? '私聊' : '会话',
        familiar: number(room && room['熟']),
        interactions: number(room && room['互动']),
      }))
      : []
    list.push({
      name: text(person['名'], 40) || '没留名字的人',
      aliases: Array.isArray(person['别名'])
        ? person['别名'].map((item) => text(item, 24)).filter(Boolean).slice(0, 4)
        : [],
      isOwner: person['主人'] === true,
      familiar: number(relation['熟']),
      warmth: number(relation['暖']),
      tension: number(relation['张力']),
      met: number(relation['见过']),
      lastAt: number(person['最后At']) || number(relation['最后At']),
      facts: Array.isArray(person['事实'])
        ? person['事实'].map(factText).filter(Boolean).slice(0, 8)
        : [],
      boundaries: Array.isArray(person['边界'])
        ? person['边界'].map(factText).filter(Boolean).slice(0, 4)
        : [],
      memories: Array.isArray(relation['记忆'])
        ? relation['记忆'].map(factText).filter(Boolean).slice(0, 4)
        : [],
      rooms,
    })
  }
  list.sort((left, right) => right.lastAt - left.lastAt)
  return { available: true, count: list.length, people: list.slice(0, 120) }
}

function channelOverview(dshHome) {
  const qq = readJson(join(dshHome, 'qq-bridge-config.json'))
  const speak = readJson(join(dshHome, 'speak-up-config.json'))
  const tts = readJson(join(dshHome, 'tts-bridge.json'))
  const bili = readJson(join(dshHome, 'bili-duty', 'config.json'))
  const qqSocial = isPlainObject(qq) && isPlainObject(qq['社交']) ? qq['社交'] : null
  const ttsWatch = isPlainObject(tts) && Array.isArray(tts.watch) ? tts.watch.length : 0
  return {
    qq: isPlainObject(qq)
      ? {
          available: true,
          enabled: qq['总开关'] === true,
          trial: qq['试运行'] === true,
          privateReady: text(qq['私聊QQ'], 80) !== '',
          groupsReady: text(qq['群号'], 200) !== '',
          socialEnabled: qqSocial !== null && qqSocial['启用'] === true,
          socialTrial: qqSocial !== null && qqSocial['试运行'] === true,
        }
      : { available: false },
    speakUp: isPlainObject(speak)
      ? {
          available: true,
          enabled: speak['总开关'] === true,
          trial: speak['试运行'] === true,
          targets: Array.isArray(speak['目标会话']) ? speak['目标会话'].length : 0,
        }
      : { available: false },
    tts: isPlainObject(tts)
      ? {
          available: true,
          watchingAll: ttsWatch === 0,
          watching: ttsWatch,
          favorites: Array.isArray(tts.favorites) ? tts.favorites.length : 0,
        }
      : { available: false },
    bili: isPlainObject(bili)
      ? {
          available: true,
          perDay: number(bili.perDay),
          peakValley: bili.peakValley === true,
          autoComment: bili.autoComment === true,
          targetReady: text(bili.targetSession, 120) !== '',
        }
      : { available: false },
  }
}

function walletOverview(budget) {
  if (!isPlainObject(budget)) return { available: false }
  return {
    available: true,
    enabled: budget.enabled === true,
    dailyGrantCny: number(budget.dailyGrantCny),
    availableCny: number(budget.availableCny),
    spentTodayCny: number(budget.spentTodayCny),
    callsToday: number(budget.callsToday),
    unmeteredToday: number(budget.unmeteredToday),
    accountReadAt: number(budget.account && budget.account.at),
    accountKnown: isPlainObject(budget.account),
  }
}

function boundariesOverview(permissions, privacy, injection) {
  const permissionInfo = isPlainObject(permissions) ? permissions : {}
  const privacyInfo = isPlainObject(privacy) ? privacy : {}
  return {
    permissions: {
      enabled: permissionInfo.enabled === true,
      emergencyStop: permissionInfo.emergencyStop === true,
      protectedReadPaths: Array.isArray(permissionInfo.protectedReadPaths) ? permissionInfo.protectedReadPaths.length : 0,
      protectedWritePaths: Array.isArray(permissionInfo.protectedWritePaths) ? permissionInfo.protectedWritePaths.length : 0,
      sealedPaths: Array.isArray(permissionInfo.sealedWritePaths) ? permissionInfo.sealedWritePaths.length : 0,
      mcpReadOnlyTools: Array.isArray(permissionInfo.mcpReadOnlyTools) ? permissionInfo.mcpReadOnlyTools.length : 0,
      autonomous: isPlainObject(permissionInfo.autonomous) ? permissionInfo.autonomous.enabled === true : false,
      hard: isPlainObject(permissionInfo.hard) ? permissionInfo.hard : {},
    },
    privacy: {
      exactFacts: number(privacyInfo.exactFacts),
      learnedSecrets: number(privacyInfo.learnedSecrets),
      hardGuards: Array.isArray(privacyInfo.hardGuards) ? privacyInfo.hardGuards : [],
      stats: isPlainObject(privacyInfo.stats) ? privacyInfo.stats : {},
    },
    injection: isPlainObject(injection) ? injection : {},
  }
}

function memoryOverview(store, now) {
  const stats = store.stats()
  const recent = store.recentWindow({ since: now - 30 * 24 * 60 * 60 * 1000, rows: 16 })
    .slice()
    .reverse()
    .map((item) => ({
      at: number(item.at),
      source: text(item.source, 40),
      actor: text(item.actor, 24),
      role: text(item.role, 24),
      text: text(item.text, 220),
    }))
  const facts = store.listFacts(20).map((fact) => ({
    subject: text(fact.subject, 60),
    predicate: text(fact.predicate, 60),
    object: text(fact.object, 240),
    confidence: number(fact.confidence),
    validFrom: number(fact.validFrom),
  }))
  return {
    total: number(stats.total),
    today: typeof store.countToday === 'function' ? number(store.countToday()) : 0,
    dropped: number(stats.dropped),
    episodes: number(stats.episodes),
    facts: number(stats.facts),
    runs: number(stats.runs),
    lastEpisodeAt: number(stats.lastEpisodeAt),
    dbBytes: number(stats.dbBytes),
    jsonlBytes: number(stats.jsonlBytes),
    degraded: stats.degraded === true,
    recent,
    recentFacts: facts,
  }
}

/**
 * 组装设置页的总览。
 * @param {object} options - 当前服务和数据。
 * @returns {object} 只读总览。
 */
export function buildOverview({
  dir,
  dshHome,
  identity,
  defaults,
  limits,
  store,
  budget,
  permissions,
  privacy,
  injection,
  phase,
  now = Date.now(),
}) {
  return {
    identity: {
      name: text(identity && identity.name, 40),
      species: text(identity && identity.species, 40),
      appearance: text(identity && identity.appearance, 240),
      ownerAddress: text(identity && identity.ownerAddress, 40),
      origin: text(identity && identity.origin, 240),
      style: text(identity && identity.style, 600),
      updatedAt: number(identity && identity.updatedAt),
      defaults: isPlainObject(defaults) ? { ...defaults } : {},
      limits: isPlainObject(limits) ? { ...limits } : {},
    },
    selfPrompt: buildSelfPrompt(identity),
    phase: text(phase, 200),
    memory: memoryOverview(store, now),
    mood: moodOverview(dshHome),
    social: socialOverview(dshHome),
    channels: channelOverview(dshHome),
    wallet: walletOverview(budget),
    boundaries: boundariesOverview(permissions, privacy, injection),
    archive: {
      pending: importIsPending(dir),
      report: readImportReport(dir),
    },
  }
}
