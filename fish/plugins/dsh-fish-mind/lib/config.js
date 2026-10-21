// 鱼脑配置：`$DSH_HOME/fish-mind/config.json`。
//
// 两条规矩：
//   1) 坏配置永远退回默认值，并把原因写进 diag.log —— 插件不能因为一个手滑的逗号就不启动。
//   2) 权限是默认拒绝的。配置只能把口子开大，不能把默认的护栏整个拿掉。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, normalize } from 'node:path'
import { DEFAULT_PRICE, normalizePrice } from './budget.js'

const MODES = new Set(['off', 'shadow', 'live'])

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
    mode: 'shadow',
    inject: false,
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
    capture: {
      user: true,
      assistant: true,
      qq: true,
      proactive: true,
      bili: true,
      compaction: true,
    },
    // 每天 ¥10 写死在 budget.js 的出生额度里，这里不提供修改项。
    budget: {
      enabled: true,
      inject: true,
      prices: {},
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

  if (isPlainObject(raw.capture)) {
    for (const key of Object.keys(config.capture)) {
      config.capture[key] = pickBoolean(raw.capture[key], config.capture[key])
    }
  } else if (raw.capture !== undefined) {
    diag('config: capture 不是对象，使用默认值')
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
    const defaultPrice = normalizePrice(b.defaultPrice)
    if (defaultPrice !== null) config.budget.defaultPrice = defaultPrice
    if (isPlainObject(b.prices)) {
      const prices = {}
      for (const [key, value] of Object.entries(b.prices)) {
        if (key.trim() === '') continue
        const price = normalizePrice(value)
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
