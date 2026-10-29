// 鱼自己的设置文件：QQ 桥和「主动搭话」都放在 `$DSH_HOME` 下的 JSON 里。
//
// 这里只管原子的读-改-写和字段级的默认值，不判断哪些设置允许她改；
// 可写范围和取值校验在 settings-catalog.js，倾向的落地策略在 tendency.js。
// 写入保留文件里其它字段和本模块不认识的字段，避免把 QQ 页或主动搭话页的多余配置抹掉。

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const QQ_CONFIG_FILE = 'qq-bridge-config.json'
export const SPEAK_CONFIG_FILE = 'speak-up-config.json'

/** QQ 社交段里本模块会读的字段的出厂值（跟 dsh-qq-bridge 的默认配置一致）。 */
export const QQ_SOCIAL_DEFAULTS = Object.freeze({
  启用: true,
  群: Object.freeze([]),
  好友: Object.freeze([]),
  关掉: Object.freeze([]),
  只听: Object.freeze([]),
  少掺和: Object.freeze([]),
  主动每时: 6,
  主动每日: 40,
  关注上限: 12,
  判断阈值: 0.4,
  学表情: true,
  模式: 'auto',
  称呼: Object.freeze(['大肥鱼', '肥鱼']),
  兴趣词: Object.freeze([]),
  不聊话题: Object.freeze([]),
  冷却秒: 15,
})

/** 「主动搭话」配置的出厂值（跟 dsh-speak-up 的默认配置一致）。 */
export const SPEAK_DEFAULTS = Object.freeze({
  总开关: true,
  间隔分钟: 30,
  峰时命中线: 20,
  谷时命中线: 60,
  安静起: 1,
  安静止: 8,
  触发文案: '好久没人跟我说话了，我该主动去打个招呼',
})

/** QQ 桥和「主动搭话」读配置时会夹的硬范围，跟各自插件的归一化保持一致。 */
export const QQ_SOCIAL_LIMITS = Object.freeze({
  主动每时: Object.freeze({ min: 0, max: 99 }),
  主动每日: Object.freeze({ min: 0, max: 999 }),
  关注上限: Object.freeze({ min: 1, max: 30 }),
  判断阈值: Object.freeze({ min: 0.1, max: 1 }),
  冷却秒: Object.freeze({ min: 2, max: 3600 }),
})

export const SPEAK_LIMITS = Object.freeze({
  间隔分钟: Object.freeze({ min: 1, max: 1440 }),
  峰时命中线: Object.freeze({ min: 0, max: 100 }),
  谷时命中线: Object.freeze({ min: 0, max: 100 }),
  安静起: Object.freeze({ min: 0, max: 23 }),
  安静止: Object.freeze({ min: 0, max: 23 }),
})

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readJsonObject(path) {
  if (!existsSync(path)) return { value: null, exists: false, error: '' }
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    if (!isPlainObject(value)) return { value: null, exists: true, error: '不是 JSON 对象' }
    return { value, exists: true, error: '' }
  } catch (error) {
    return { value: null, exists: true, error: String((error && error.message) || error) }
  }
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.tmp`
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(temp, path)
}

function finiteNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function booleanValue(value, fallback) {
  if (value === true || value === 'true' || value === 1 || value === '1') return true
  if (value === false || value === 'false' || value === 0 || value === '0') return false
  return fallback
}

function wordList(value, fallback, limit = 30, maxLength = 32) {
  const out = []
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry !== 'string') continue
      const word = entry.trim()
      if (word === '' || word.length > maxLength || out.includes(word)) continue
      out.push(word)
      if (out.length >= limit) break
    }
  }
  return out.length > 0 ? out : [...fallback]
}

/**
 * 读 `$DSH_HOME/qq-bridge-config.json` 的原始对象。
 * @param {string} dshHome - DSH 主目录。
 * @returns {{ path: string, value: object|null, exists: boolean, error: string }} 读取结果。
 */
export function readQqConfig(dshHome) {
  const path = join(dshHome, QQ_CONFIG_FILE)
  return { path, ...readJsonObject(path) }
}

/**
 * 读 QQ 社交段的当前值；文件缺失或损坏时 `social` 为 null。
 * @param {string} dshHome - DSH 主目录。
 * @returns {{ path: string, social: object|null, exists: boolean, broken: boolean, error: string }} 社交段读取结果。
 */
export function readQqSocial(dshHome) {
  const read = readQqConfig(dshHome)
  const social = read.value !== null && isPlainObject(read.value['社交']) ? read.value['社交'] : null
  return { path: read.path, social, exists: read.exists, broken: read.error !== '', error: read.error }
}

/**
 * 把 QQ 社交段洗成本模块使用的数值：缺字段或字段非法时回出厂值。
 * @param {object|null} social - `readQqSocial().social`。
 * @returns {object} `{ 启用, 群, 好友, 关掉, 只听, 少掺和, 主动每时, 主动每日, 关注上限, 判断阈值, 学表情, 模式, 称呼, 兴趣词, 不聊话题, 冷却秒 }`。
 */
export function qqSocialValues(social) {
  const source = isPlainObject(social) ? social : {}
  const defaults = QQ_SOCIAL_DEFAULTS
  return {
    启用: booleanValue(source['启用'], defaults['启用']),
    群: wordList(source['群'], [], 50),
    好友: wordList(source['好友'], [], 50),
    关掉: wordList(source['关掉'], [], 50),
    只听: wordList(source['只听'], [], 50),
    少掺和: wordList(source['少掺和'], [], 50),
    主动每时: Math.round(finiteNumber(source['主动每时'], defaults['主动每时'])),
    主动每日: Math.round(finiteNumber(source['主动每日'], defaults['主动每日'])),
    关注上限: Math.round(finiteNumber(source['关注上限'], defaults['关注上限'])),
    判断阈值: finiteNumber(source['判断阈值'], defaults['判断阈值']),
    学表情: booleanValue(source['学表情'], defaults['学表情']),
    模式: source['模式'] === 'mention' ? 'mention' : 'auto',
    称呼: wordList(source['称呼'], defaults['称呼']),
    兴趣词: wordList(source['兴趣词'], []),
    不聊话题: wordList(source['不聊话题'], [], 60),
    冷却秒: Math.round(finiteNumber(source['冷却秒'], defaults['冷却秒'])),
  }
}

/**
 * 改 QQ 社交段：保留配置文件里其它字段和未知字段，原子写回。
 * 文件不存在时创建一份只带社交段的配置；文件损坏时抛错，不覆盖主人的原文件。
 * @param {string} dshHome - DSH 主目录。
 * @param {(social: object) => void} mutate - 原地修改社交段。
 * @returns {{ path: string, created: boolean, social: object }} 写入结果。
 */
export function updateQqSocial(dshHome, mutate) {
  const read = readQqConfig(dshHome)
  if (read.error !== '') throw new Error(`QQ 设置文件读不出来（${read.error}）`)
  const next = read.value === null ? {} : read.value
  const social = isPlainObject(next['社交']) ? { ...next['社交'] } : {}
  mutate(social)
  next['社交'] = social
  writeJsonAtomic(read.path, next)
  return { path: read.path, created: read.exists !== true, social }
}

/**
 * 读 `$DSH_HOME/speak-up-config.json` 的原始对象。
 * @param {string} dshHome - DSH 主目录。
 * @returns {{ path: string, value: object|null, exists: boolean, error: string }} 读取结果。
 */
export function readSpeakConfig(dshHome) {
  const path = join(dshHome, SPEAK_CONFIG_FILE)
  return { path, ...readJsonObject(path) }
}

/**
 * 把「主动搭话」配置洗成设置页使用的数值：缺字段或字段非法时回出厂值。
 * @param {object|null} config - `readSpeakConfig().value`。
 * @returns {object} `{ 总开关, 间隔分钟, 峰时命中线, 谷时命中线, 安静起, 安静止, 触发文案 }`。
 */
export function speakUpValues(config) {
  const source = isPlainObject(config) ? config : {}
  const defaults = SPEAK_DEFAULTS
  const trigger = typeof source['触发文案'] === 'string' && source['触发文案'].trim() !== ''
    ? source['触发文案']
    : defaults['触发文案']
  return {
    总开关: booleanValue(source['总开关'], defaults['总开关']),
    间隔分钟: Math.round(finiteNumber(source['间隔分钟'], defaults['间隔分钟'])),
    峰时命中线: finiteNumber(source['峰时命中线'], defaults['峰时命中线']),
    谷时命中线: finiteNumber(source['谷时命中线'], defaults['谷时命中线']),
    安静起: Math.round(finiteNumber(source['安静起'], defaults['安静起'])),
    安静止: Math.round(finiteNumber(source['安静止'], defaults['安静止'])),
    触发文案: trigger,
  }
}

/**
 * 改「主动搭话」配置：原子写回，保留文件里其它字段。
 * @param {string} dshHome - DSH 主目录。
 * @param {(config: object) => void} mutate - 原地修改配置对象。
 * @returns {{ path: string, created: boolean, config: object }} 写入结果。
 */
export function updateSpeakConfig(dshHome, mutate) {
  const read = readSpeakConfig(dshHome)
  if (read.error !== '') throw new Error(`「主动搭话」设置文件读不出来（${read.error}）`)
  const next = read.value === null ? {} : read.value
  mutate(next)
  writeJsonAtomic(read.path, next)
  return { path: read.path, created: read.exists !== true, config: next }
}
