// 鱼脑配置：`$DSH_HOME/fish-mind/config.json`。
//
// 两条规矩：
//   1) 坏配置永远退回默认值，并把原因写进 diag.log —— 插件不能因为一个手滑的逗号就不启动。
//   2) 权限是默认拒绝的。配置只能把口子开大，不能把默认的护栏整个拿掉。

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, normalize } from 'node:path'
import { DEFAULT_BILI_SHARE, DEFAULT_PRICE, normalizePrice, normalizePriceEntry, officialPrices } from './budget.js'

const MODES = new Set(['off', 'shadow', 'live'])

/** 自定义话术每句最多这么多字；设置页按同一上限校验。 */
export const PHRASE_LIMIT = 200

/** 自动备份间隔的可调范围（小时）：最短一小时，最长一个月。 */
export const BACKUP_INTERVAL_MIN = 1
export const BACKUP_INTERVAL_MAX = 720

/** 出厂话术：私事被追问时的托词、零花钱被账本拦住时本地回主人的一句。 */
export const DEFAULT_PHRASES = Object.freeze({
  privateDodge: '这个我不方便细说',
  budgetBlock: '今天我这边有点转不动了，先歇一会儿，明天再找你。',
})

/** 敏感文件：命中任意一条就交给权限策略处理，不看路径在哪。 */
const DEFAULT_NAME_PATTERNS = [
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  '.credentials.yaml',
  '.netrc',
  '.git-credentials',
]

/** 外部 MCP 只读白名单：只认「取/列/搜/读」这一类动作，发送和管理一律不进这里。 */
const DEFAULT_MCP_READ_ONLY_TOOLS = [
  'get_*',
  'list_*',
  'search_*',
  'read_*',
  'describe_*',
  'query_*',
  'count_*',
  'check_*',
]

/** 敏感目录/文件：跨平台全列上，不存在的路径不会有副作用。 */
const DEFAULT_PROTECTED_READ_PATHS = [
  '~/.ssh',
  '~/.aws',
  '~/.gnupg',
  '~/.kube',
  '~/.docker/config.json',
  '~/.npmrc',
  '~/.pypirc',
  '~/AppData/Roaming/Microsoft/Credentials',
  '~/AppData/Local/Microsoft/Credentials',
  '~/AppData/Roaming/Microsoft/Protect',
  '~/AppData/Local/Google/Chrome/User Data',
  '~/AppData/Local/Microsoft/Edge/User Data',
  '~/AppData/Roaming/Mozilla/Firefox/Profiles',
  '~/Library/Keychains',
  '~/Library/Application Support/Google/Chrome',
]

/**
 * 默认配置。`dshHome` 只用来拼 `.credentials.yaml`，不要在这里展开用户目录。
 * @param {string} dshHome - DSH 根目录。
 * @returns {object} 一份新的可变配置对象。
 */
export function buildDefaults(dshHome) {
  return {
    mode: 'live',
    inject: true,
    // 开发者模式：主人从设置页打开后，她自己的前台会话可以只读查看 DSH 目录里的
    // 日志、配置和会话，用来排查问题；凭据、身份文件、写入和群聊会话仍然硬拒。
    developer: {
      enabled: false,
    },
    retentionDays: 90,
    maxTextChars: 4000,
    archiveChars: 200000,
    episodes: {
      gapMinutes: 45,
      topicShift: 0.06,
      splitMinExperiences: 3,
      salienceThreshold: 0.35,
    },
    recall: {
      routeLimit: 20,
      fuseLimit: 6,
      minScore: 0.35,
      toolLimit: 10,
      detailMessages: 40,
      detailChars: 6000,
      workspaceSlots: 5,
      workspaceChars: 900,
      excludeCurrentSession: true,
    },
    // 章节树：日 → 周 → 月，从情景自动抽目录；abstractive 开启时用模型生成自然语言摘要。
    chapters: {
      enabled: true,
      tickMinutes: 10,
      summaryChars: 320,
      abstractive: true,
    },
    // 短期记忆：最近一小时的原话直接进提示，放凉或攒多了就提炼成能查的事实转长期。
    working: {
      enabled: true,
      inject: true,
      ttlMinutes: 60,
      rows: 30,
      chars: 3000,
      idleMinutes: 20,
      maxRows: 40,
      minRows: 2,
      consolidate: true,
      maxFacts: 8,
      maxTokens: 600,
      tickSeconds: 60,
    },
    capture: {
      user: true,
      assistant: true,
      qq: true,
      proactive: true,
      bili: true,
      compaction: true,
    },
    // 内心层：七情标签、六欲权重和倾述欲。注入只对主人会话生效，
    // 群聊/好友会话拿不到主人私下的由头。
    innerLife: {
      inject: true,
      cueThreshold: 0.3,
    },
    // 幽默层：只在轻松、没有正事和情绪负担的轮次给具体接话动作；
    // 群聊/好友只在对方先开玩笑时给收敛版。
    humor: {
      inject: true,
    },
    // 她遇到两种情况时说的原话；设置页「大肥鱼 → 自定义话术」可以改写。
    phrases: { ...DEFAULT_PHRASES },
    // 自动备份：把整条鱼定时打包到安装目录下的 fish-backups，最多留 5 份。
    backup: {
      enabled: true,
      intervalHours: 24,
    },
    // 每日额度默认 ¥10，存在 budget.json，由设置页「大肥鱼 → 零花钱」写入；这里不提供修改项。
    budget: {
      enabled: true,
      inject: true,
      // B 站巡检最多花当天出生额度的这个比例；0 = 不让她刷，1 = 不单独限制。
      biliShare: DEFAULT_BILI_SHARE,
      // 她自己的路由出厂按官方价结算；这里写空对象也保留出厂价，按路由覆盖才改价。
      prices: officialPrices(),
      defaultPrice: { ...DEFAULT_PRICE },
      defaultMaxOutputTokens: 8192,
      balanceRefreshMinutes: 15,
    },
    permissions: {
      enabled: true,
      emergencyStop: false,
      auditMaxBytes: 5 * 1024 * 1024,
      protectedReadPaths: [...DEFAULT_PROTECTED_READ_PATHS, join(dshHome, '.credentials.yaml')],
      protectedWritePaths: [...DEFAULT_PROTECTED_READ_PATHS, join(dshHome, '.credentials.yaml')],
      protectedNamePatterns: [...DEFAULT_NAME_PATTERNS],
      // 外部 MCP 默认全拒，只有命中这些名字的才当只读放行；关掉权限开关也不扩大这个口子。
      mcpReadOnlyTools: [...DEFAULT_MCP_READ_ONLY_TOOLS],
      autonomous: {
        enabled: false,
        allowTools: [],
        allowPaths: [],
      },
    },
  }
}

/** @param {unknown} value @returns {boolean} */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** @param {unknown} value @param {string} fallback @returns {string} */
function pickString(value, fallback) {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback
}

/** 一句话压成单行、去掉首尾空白；空值和坏值退回默认。 */
function pickPhrase(value, fallback) {
  if (typeof value !== 'string') return fallback
  const text = value.replace(/\s+/g, ' ').trim()
  return text === '' ? fallback : text.slice(0, PHRASE_LIMIT)
}

/** @param {unknown} value @param {boolean} fallback @returns {boolean} */
function pickBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

/** @param {unknown} value @param {number} fallback @param {number} min @param {number} max @returns {number} */
function pickNumber(value, fallback, min, max) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback
}

/** 比例字段不能四舍五入成整数，否则 0.06 会变成 0。 */
function pickFraction(value, fallback, min, max) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

/** @param {unknown} value @param {string[]} fallback @returns {string[]} */
function pickStringArray(value, fallback) {
  if (!Array.isArray(value)) return [...fallback]
  const kept = value.filter((item) => typeof item === 'string' && item.trim() !== '')
  return kept.length === 0 ? [...fallback] : kept
}

/**
 * 把磁盘上的原始 JSON 归一成可用的配置。
 * @param {unknown} raw - 读出来的 JSON；损坏时传 undefined。
 * @param {object} options - `{ dshHome, diag }`。
 * @returns {object} 归一后的配置。
 */
export function normalizeConfig(raw, { dshHome, diag = () => {} } = {}) {
  const defaults = buildDefaults(dshHome || process.env.DSH_HOME || join(homedir(), '.dsh'))
  if (!isPlainObject(raw)) {
    diag('config: 内容不是对象，全部使用默认值')
    return defaults
  }

  const config = defaults
  if (raw.mode !== undefined) {
    if (MODES.has(raw.mode)) config.mode = raw.mode
    else diag(`config: mode=${JSON.stringify(raw.mode)} 不认识（只认 off/shadow/live），用 shadow`)
  }
  config.inject = pickBoolean(raw.inject, config.inject)
  if (isPlainObject(raw.developer)) {
    config.developer.enabled = pickBoolean(raw.developer.enabled, config.developer.enabled)
  } else if (raw.developer !== undefined) {
    diag('config: developer 不是对象，使用默认值')
  }
  config.retentionDays = pickNumber(raw.retentionDays, config.retentionDays, 1, 3650)
  config.maxTextChars = pickNumber(raw.maxTextChars, config.maxTextChars, 200, 20000)
  config.archiveChars = pickNumber(raw.archiveChars, config.archiveChars, 200, 2000000)

  if (isPlainObject(raw.episodes)) {
    const e = raw.episodes
    config.episodes.gapMinutes = pickNumber(e.gapMinutes, config.episodes.gapMinutes, 1, 1440)
    config.episodes.topicShift = pickFraction(e.topicShift, config.episodes.topicShift, 0, 1)
    config.episodes.splitMinExperiences = pickNumber(
      e.splitMinExperiences,
      config.episodes.splitMinExperiences,
      1,
      50,
    )
    config.episodes.salienceThreshold = pickFraction(
      e.salienceThreshold,
      config.episodes.salienceThreshold,
      0,
      1,
    )
  } else if (raw.episodes !== undefined) {
    diag('config: episodes 不是对象，使用默认值')
  }

  if (isPlainObject(raw.recall)) {
    const r = raw.recall
    config.recall.routeLimit = pickNumber(r.routeLimit, config.recall.routeLimit, 1, 100)
    config.recall.fuseLimit = pickNumber(r.fuseLimit, config.recall.fuseLimit, 1, 20)
    config.recall.minScore = pickFraction(r.minScore, config.recall.minScore, 0, 1)
    config.recall.toolLimit = pickNumber(r.toolLimit, config.recall.toolLimit, 1, 20)
    config.recall.detailMessages = pickNumber(
      r.detailMessages,
      config.recall.detailMessages,
      1,
      200,
    )
    config.recall.detailChars = pickNumber(
      r.detailChars,
      config.recall.detailChars,
      200,
      20000,
    )
    config.recall.workspaceSlots = pickNumber(r.workspaceSlots, config.recall.workspaceSlots, 1, 10)
    config.recall.workspaceChars = pickNumber(r.workspaceChars, config.recall.workspaceChars, 200, 4000)
    config.recall.excludeCurrentSession = pickBoolean(
      r.excludeCurrentSession,
      config.recall.excludeCurrentSession,
    )
  } else if (raw.recall !== undefined) {
    diag('config: recall 不是对象，使用默认值')
  }

  if (isPlainObject(raw.chapters)) {
    const c = raw.chapters
    config.chapters.enabled = pickBoolean(c.enabled, config.chapters.enabled)
    config.chapters.tickMinutes = pickNumber(c.tickMinutes, config.chapters.tickMinutes, 1, 1440)
    config.chapters.summaryChars = pickNumber(c.summaryChars, config.chapters.summaryChars, 80, 2000)
    config.chapters.abstractive = pickBoolean(c.abstractive, config.chapters.abstractive)
  } else if (raw.chapters !== undefined) {
    diag('config: chapters 不是对象，使用默认值')
  }

  if (isPlainObject(raw.working)) {
    const w = raw.working
    config.working.enabled = pickBoolean(w.enabled, config.working.enabled)
    config.working.inject = pickBoolean(w.inject, config.working.inject)
    config.working.consolidate = pickBoolean(w.consolidate, config.working.consolidate)
    config.working.ttlMinutes = pickNumber(w.ttlMinutes, config.working.ttlMinutes, 1, 1440)
    config.working.rows = pickNumber(w.rows, config.working.rows, 2, 60)
    config.working.chars = pickNumber(w.chars, config.working.chars, 200, 4000)
    config.working.idleMinutes = pickNumber(w.idleMinutes, config.working.idleMinutes, 1, 1440)
    config.working.maxRows = pickNumber(w.maxRows, config.working.maxRows, 2, 200)
    config.working.minRows = pickNumber(w.minRows, config.working.minRows, 1, 20)
    config.working.maxFacts = pickNumber(w.maxFacts, config.working.maxFacts, 1, 20)
    config.working.maxTokens = pickNumber(w.maxTokens, config.working.maxTokens, 128, 4096)
    config.working.tickSeconds = pickNumber(w.tickSeconds, config.working.tickSeconds, 10, 3600)
    // 待提炼窗口最多只看 maxRows 行，门槛比它还高的话永远攒不够，提炼会静默死掉。
    if (config.working.minRows > config.working.maxRows) {
      config.working.minRows = config.working.maxRows
    }
    // 0.6.0 及以前的出厂值是 30 分钟 / 12 条 / 1200 字；三样都还是旧值的配置
    // 抬到一小时窗口。用户改过其中任何一项就按用户的值来。
    if (w.ttlMinutes === 30 && w.rows === 12 && w.chars === 1200) {
      config.working.ttlMinutes = 60
      config.working.rows = 30
      config.working.chars = 3000
    }
  } else if (raw.working !== undefined) {
    diag('config: working 不是对象，使用默认值')
  }

  if (isPlainObject(raw.capture)) {
    for (const key of Object.keys(config.capture)) {
      config.capture[key] = pickBoolean(raw.capture[key], config.capture[key])
    }
  } else if (raw.capture !== undefined) {
    diag('config: capture 不是对象，使用默认值')
  }

  if (isPlainObject(raw.innerLife)) {
    const inner = raw.innerLife
    config.innerLife.inject = pickBoolean(inner.inject, config.innerLife.inject)
    config.innerLife.cueThreshold = pickFraction(inner.cueThreshold, config.innerLife.cueThreshold, 0, 1)
  } else if (raw.innerLife !== undefined) {
    diag('config: innerLife 不是对象，使用默认值')
  }

  if (isPlainObject(raw.humor)) {
    config.humor.inject = pickBoolean(raw.humor.inject, config.humor.inject)
  } else if (raw.humor !== undefined) {
    diag('config: humor 不是对象，使用默认值')
  }

  if (isPlainObject(raw.phrases)) {
    config.phrases.privateDodge = pickPhrase(raw.phrases.privateDodge, config.phrases.privateDodge)
    config.phrases.budgetBlock = pickPhrase(raw.phrases.budgetBlock, config.phrases.budgetBlock)
  } else if (raw.phrases !== undefined) {
    diag('config: phrases 不是对象，使用默认值')
  }

  if (isPlainObject(raw.backup)) {
    const b = raw.backup
    config.backup.enabled = pickBoolean(b.enabled, config.backup.enabled)
    config.backup.intervalHours = pickNumber(
      b.intervalHours,
      config.backup.intervalHours,
      BACKUP_INTERVAL_MIN,
      BACKUP_INTERVAL_MAX,
    )
  } else if (raw.backup !== undefined) {
    diag('config: backup 不是对象，使用默认值')
  }

  if (isPlainObject(raw.budget)) {
    const b = raw.budget
    config.budget.enabled = pickBoolean(b.enabled, config.budget.enabled)
    config.budget.inject = pickBoolean(b.inject, config.budget.inject)
    config.budget.defaultMaxOutputTokens = pickNumber(
      b.defaultMaxOutputTokens,
      config.budget.defaultMaxOutputTokens,
      64,
      131072,
    )
    config.budget.balanceRefreshMinutes = pickNumber(
      b.balanceRefreshMinutes,
      config.budget.balanceRefreshMinutes,
      1,
      1440,
    )
    config.budget.biliShare = pickFraction(b.biliShare, config.budget.biliShare, 0, 1)
    const defaultPrice = normalizePrice(b.defaultPrice)
    if (defaultPrice !== null) config.budget.defaultPrice = defaultPrice
    if (isPlainObject(b.prices)) {
      // 按路由覆盖出厂价；没写的路由保留出厂价，空对象也一样。
      const prices = { ...config.budget.prices }
      for (const [key, value] of Object.entries(b.prices)) {
        if (key.trim() === '') continue
        const price = normalizePriceEntry(value)
        if (price !== null) prices[key] = price
      }
      config.budget.prices = prices
    } else if (b.prices !== undefined) {
      diag('config: budget.prices 不是对象，忽略')
    }
  } else if (raw.budget !== undefined) {
    diag('config: budget 不是对象，使用默认值')
  }

  if (isPlainObject(raw.permissions)) {
    const p = raw.permissions
    config.permissions.enabled = pickBoolean(p.enabled, config.permissions.enabled)
    config.permissions.emergencyStop = pickBoolean(p.emergencyStop, config.permissions.emergencyStop)
    config.permissions.auditMaxBytes = pickNumber(p.auditMaxBytes, config.permissions.auditMaxBytes, 64 * 1024, 100 * 1024 * 1024)
    config.permissions.protectedReadPaths = pickStringArray(p.protectedReadPaths, config.permissions.protectedReadPaths)
    config.permissions.protectedWritePaths = pickStringArray(p.protectedWritePaths, config.permissions.protectedWritePaths)
    config.permissions.protectedNamePatterns = pickStringArray(p.protectedNamePatterns, config.permissions.protectedNamePatterns)
    // 逐条去掉首尾空格：` get_* ` 带着空格就匹配不上任何工具，静默失效比报错更难查。
    config.permissions.mcpReadOnlyTools = pickStringArray(
      p.mcpReadOnlyTools,
      config.permissions.mcpReadOnlyTools,
    ).map((item) => item.trim())
    if (isPlainObject(p.autonomous)) {
      const a = p.autonomous
      config.permissions.autonomous.enabled = pickBoolean(a.enabled, config.permissions.autonomous.enabled)
      config.permissions.autonomous.allowTools = pickStringArray(a.allowTools, config.permissions.autonomous.allowTools)
      config.permissions.autonomous.allowPaths = pickStringArray(a.allowPaths, config.permissions.autonomous.allowPaths)
    } else if (p.autonomous !== undefined) {
      diag('config: permissions.autonomous 不是对象，使用默认值')
    }
  } else if (raw.permissions !== undefined) {
    diag('config: permissions 不是对象，使用默认值')
  }

  return config
}

/**
 * 读配置；文件不存在就写一份默认配置，坏 JSON 只告警不覆盖。
 * @param {object} options - `{ dshHome, diag }`。
 * @returns {object} 归一后的配置。
 */
export function loadConfig({ dshHome, diag = () => {} }) {
  const path = join(dshHome, 'fish-mind', 'config.json')
  let raw
  try {
    if (existsSync(path)) {
      raw = JSON.parse(readFileSync(path, 'utf8'))
    } else {
      const defaults = buildDefaults(dshHome)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, JSON.stringify(defaults, null, 2) + '\n', 'utf8')
      diag(`config: 第一次启动，已写入默认配置 ${path}`)
      return defaults
    }
  } catch (error) {
    diag(`config: 读不了或不是合法 JSON（${String((error && error.message) || error)}），使用默认值；原文件没有改动`)
    return buildDefaults(dshHome)
  }
  return normalizeConfig(raw, { dshHome, diag })
}

/**
 * 只改 `phrases` 两项并原子写回 config.json；其它字段和注释外的内容原样保留。
 * 原文件不是合法 JSON 时抛 400，不动它。
 * @param {object} options - `{ dshHome, phrases, diag }`。
 * @returns {{ privateDodge: string, budgetBlock: string }} 归一后的两句话。
 */
export function savePhrases({ dshHome, phrases, diag = () => {} }) {
  const path = join(dshHome, 'fish-mind', 'config.json')
  let raw = {}
  if (existsSync(path)) {
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
      const failure = new Error(`config.json 不是合法 JSON（${String((error && error.message) || error)}），先修好再保存`)
      failure.statusCode = 400
      throw failure
    }
  }
  if (!isPlainObject(raw)) {
    const failure = new Error('config.json 内容不是对象，先修好再保存')
    failure.statusCode = 400
    throw failure
  }
  const fallback = isPlainObject(raw.phrases) ? raw.phrases : DEFAULT_PHRASES
  const saved = {
    privateDodge: pickPhrase(phrases && phrases.privateDodge, pickPhrase(fallback.privateDodge, DEFAULT_PHRASES.privateDodge)),
    budgetBlock: pickPhrase(phrases && phrases.budgetBlock, pickPhrase(fallback.budgetBlock, DEFAULT_PHRASES.budgetBlock)),
  }
  raw.phrases = saved
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.tmp`
  writeFileSync(temp, JSON.stringify(raw, null, 2) + '\n', 'utf8')
  renameSync(temp, path)
  diag(`config: 自定义话术已保存（私事兜底 ${saved.privateDodge.length} 字，额度兜底 ${saved.budgetBlock.length} 字）`)
  return saved
}

/**
 * 只改自动备份的开关和间隔并原子写回 config.json；其它字段原样保留。
 * 原文件不是合法 JSON 时抛 400，不动它。
 * @param {object} options - `{ dshHome, backup, diag }`。
 * @returns {{ enabled: boolean, intervalHours: number }} 归一后的备份设置。
 */
export function saveBackup({ dshHome, backup, diag = () => {} }) {
  const path = join(dshHome, 'fish-mind', 'config.json')
  let raw = {}
  if (existsSync(path)) {
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
      const failure = new Error(`config.json 不是合法 JSON（${String((error && error.message) || error)}），先修好再保存`)
      failure.statusCode = 400
      throw failure
    }
  }
  if (!isPlainObject(raw)) {
    const failure = new Error('config.json 内容不是对象，先修好再保存')
    failure.statusCode = 400
    throw failure
  }
  const current = isPlainObject(raw.backup) ? raw.backup : {}
  const saved = {
    enabled: pickBoolean(backup && backup.enabled, pickBoolean(current.enabled, true)),
    intervalHours: pickNumber(
      backup && backup.intervalHours,
      pickNumber(current.intervalHours, 24, BACKUP_INTERVAL_MIN, BACKUP_INTERVAL_MAX),
      BACKUP_INTERVAL_MIN,
      BACKUP_INTERVAL_MAX,
    ),
  }
  raw.backup = { ...current, ...saved }
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.tmp`
  writeFileSync(temp, JSON.stringify(raw, null, 2) + '\n', 'utf8')
  renameSync(temp, path)
  diag(`config: 自动备份${saved.enabled ? '开' : '关'}，间隔 ${saved.intervalHours} 小时`)
  return saved
}

/**
 * 只改开发者模式开关并原子写回 config.json；其它字段原样保留。
 * 原文件不是合法 JSON 时抛 400，不动它。
 * @param {object} options - `{ dshHome, enabled, diag }`。
 * @returns {{ enabled: boolean }} 归一后的开关。
 */
export function saveDeveloper({ dshHome, enabled, diag = () => {} }) {
  const path = join(dshHome, 'fish-mind', 'config.json')
  let raw = {}
  if (existsSync(path)) {
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
      const failure = new Error(`config.json 不是合法 JSON（${String((error && error.message) || error)}），先修好再保存`)
      failure.statusCode = 400
      throw failure
    }
  }
  if (!isPlainObject(raw)) {
    const failure = new Error('config.json 内容不是对象，先修好再保存')
    failure.statusCode = 400
    throw failure
  }
  const current = isPlainObject(raw.developer) ? raw.developer : {}
  const saved = { enabled: pickBoolean(enabled, pickBoolean(current.enabled, false)) }
  raw.developer = { ...current, ...saved }
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.tmp`
  writeFileSync(temp, JSON.stringify(raw, null, 2) + '\n', 'utf8')
  renameSync(temp, path)
  diag(`config: 开发者模式${saved.enabled ? '开' : '关'}`)
  return saved
}

/** 把配置里的 `~` 和 `$DSH_HOME` 展开成绝对路径。 */
export function expandPath(value, { dshHome = process.env.DSH_HOME || join(homedir(), '.dsh') } = {}) {
  if (typeof value !== 'string' || value === '') return value
  let out = value
  if (out === '~') out = homedir()
  else if (out.startsWith('~/') || out.startsWith('~\\')) out = join(homedir(), out.slice(2))
  out = out.replaceAll('$DSH_HOME', dshHome).replaceAll('${DSH_HOME}', dshHome)
  return normalize(out)
}

/** 配置里的模式是否合法（给设置页/测试用）。 */
export function isValidMode(mode) {
  return MODES.has(mode)
}
