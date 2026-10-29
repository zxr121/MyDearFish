// 可搬运的本机设置：导出只带白名单里的字段，导入时先关掉所有对外通道。
//
// 包里的配置放在 manifest.configs，不新增 zip 条目：旧版大肥鱼会拒绝不认识的
// zip 文件，但会忽略 manifest 里多出来的字段，所以新包在旧版里仍然只导入记忆。
//
// 白名单是默认拒绝的：新加的秘密字段不会自动进包，直到有人把它写进注册表。
// 导入按文件独立成败，坏一份只跳过并记警告，绝不阻断记忆导入；本地已有的
// 凭据、账号、会话 id 等秘密字段因为不在白名单里，合并后原样保留。

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { normalizePersonaInput, PERSONA_MAX_CHARS } from './persona.js'
import { normalizeTendencyInput, TENDENCY_FORMAT, TENDENCY_VERSION } from './tendency.js'

export const PORTABLE_FORMAT = 'mydearfish.fish-configs'
export const PORTABLE_VERSION = 1
export const PORTABLE_FILE_LIMIT = 256 * 1024
export const PORTABLE_TOTAL_LIMIT = 1024 * 1024
export const PORTABLE_FILES_LIMIT = 16

const PERSONA_FILE = 'persona.txt'
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

const FISH_MIND_KEYS = [
  'mode',
  'inject',
  'retentionDays',
  'maxTextChars',
  'archiveChars',
  'episodes',
  'recall',
  'chapters',
  'working',
  'capture',
  'innerLife',
  'humor',
  'phrases',
  'backup',
]

const MOOD_KEYS = [
  'selfAliases',
  'judgeProvider',
  'judgeModel',
  'moodBase',
  'moodFloor',
  'injectMood',
  'autoJudge',
]

const QQ_SOCIAL_KEYS = [
  '主动每时',
  '主动每日',
  '连说上限',
  '连说歇秒',
  '记人',
  '学说话',
  '学表情',
  '复读',
  '模式',
  '旁听',
  '冷却秒',
  '冷却最短秒',
  '冷却最长倍率',
  '余额吃紧线',
  '余额吃紧倍率',
  '最低余额',
  '静音',
  '称呼',
  '兴趣词',
  '不聊游戏',
  '不聊话题',
  '关注上限',
  '快判',
  '快判阈值',
  '快判最多',
  '探索间隔秒',
  '探索最低余额',
  '判断模型',
  '判断阈值',
  '判断冷却秒',
  '聚拢秒',
  '并行',
  '并行上限',
  '回复模型',
  '短应',
  '迟到',
]

const SPEAK_KEYS = [
  '间隔分钟',
  '峰时命中线',
  '谷时命中线',
  '没中加成',
  '加成上限',
  '倾述加成',
  '安静起',
  '安静止',
  '近阈值分钟',
  '近因子',
  '远阈值分钟',
  '远因子',
  '搭话冷却分钟',
  '触发文案',
  '角色',
]

const BILI_KEYS = [
  'perDay',
  'gapHours',
  'peakValley',
  'noon',
  'night',
  'keywords',
  'commentPerRound',
  'replyPerRound',
  'mentionName',
  'reportLevel',
  'subProvider',
  'subModel',
  'perScan',
  'ownerName',
  'scanPrompt',
  'minViews',
  'minAgeDays',
]

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function pickKeys(source, keys) {
  const out = {}
  if (!isPlainObject(source)) return out
  for (const key of keys) {
    if (Object.hasOwn(source, key)) out[key] = clone(source[key])
  }
  return out
}

function hasDangerousKey(value, depth = 0) {
  if (depth > 8) return true
  if (Array.isArray(value)) return value.some((item) => hasDangerousKey(item, depth + 1))
  if (!isPlainObject(value)) return false
  for (const [key, item] of Object.entries(value)) {
    if (DANGEROUS_KEYS.has(key)) return true
    if (hasDangerousKey(item, depth + 1)) return true
  }
  return false
}

function sanitizeDeep(value, depth = 0) {
  if (depth > 12) return null
  if (Array.isArray(value)) return value.map((item) => sanitizeDeep(item, depth + 1))
  if (!isPlainObject(value)) return value
  const out = {}
  for (const [key, item] of Object.entries(value)) {
    if (DANGEROUS_KEYS.has(key)) continue
    out[key] = sanitizeDeep(item, depth + 1)
  }
  return out
}

function mergeDeep(base, patch) {
  if (!isPlainObject(patch)) return sanitizeDeep(clone(patch))
  const out = isPlainObject(base) ? { ...base } : {}
  for (const [key, value] of Object.entries(patch)) {
    if (DANGEROUS_KEYS.has(key)) continue
    out[key] = isPlainObject(value) ? mergeDeep(out[key], value) : sanitizeDeep(clone(value))
  }
  return out
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.tmp`
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n')
  renameSync(temp, path)
}

function sha256(text) {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')
}

function byteLength(text) {
  return Buffer.byteLength(text, 'utf8')
}

function safeName(name) {
  if (typeof name !== 'string' || name === '') return false
  if (name.includes('\\') || name.startsWith('/') || name.includes('..')) return false
  return name === PERSONA_FILE || PORTABLE_CONFIGS.some((entry) => entry.name === name)
}

function qqSocialSafe(social) {
  if (!isPlainObject(social)) return social
  return { ...social, 启用: false, 试运行: true }
}

function qqSafe(picked) {
  const out = { ...picked, 总开关: false, 试运行: true }
  if (isPlainObject(out['社交'])) out['社交'] = qqSocialSafe(out['社交'])
  return out
}

function speakSafe(picked) {
  return { ...picked, 总开关: false, 试运行: true }
}

function biliSafe(picked) {
  return { ...picked, autoComment: false, autoReply: false, dmMode: 'off' }
}

/** 注册表：每个文件只带走白名单里的字段，`safe` 在导入时强制关掉对外通道。 */
export const PORTABLE_CONFIGS = Object.freeze([
  {
    name: 'fish-mind/config.json',
    path: ['fish-mind', 'config.json'],
    kind: 'json',
    excluded: ['budget', 'permissions', 'developer'],
    pick(raw) {
      return pickKeys(raw, FISH_MIND_KEYS)
    },
  },
  {
    name: 'fish-mind/tendency.json',
    path: ['fish-mind', 'tendency.json'],
    kind: 'json',
    excluded: [],
    pick(raw) {
      if (!isPlainObject(raw)) return {}
      let text = ''
      try {
        text = normalizeTendencyInput(raw.text)
      } catch {
        return {}
      }
      return {
        format: TENDENCY_FORMAT,
        version: TENDENCY_VERSION,
        text,
        updatedAt: typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0,
      }
    },
  },
  {
    name: 'feiyu-mood/config.json',
    path: ['feiyu-mood', 'config.json'],
    kind: 'json',
    excluded: ['targetSession', 'selfName', 'ownerName'],
    pick(raw) {
      return pickKeys(raw, MOOD_KEYS)
    },
  },
  {
    name: 'qq-bridge-config.json',
    path: ['qq-bridge-config.json'],
    kind: 'json',
    excluded: [
      '目标会话',
      '私聊QQ',
      '群号',
      'NapCat',
      'SnowLuma',
      '戳一戳',
      '导入',
      '总开关',
      '试运行',
      '社交.群',
      '社交.好友',
      '社交.关掉',
      '社交.只听',
      '社交.少掺和',
      '社交.人的态度',
      '社交.话量',
      '社交.歇着',
    ],
    pick(raw) {
      if (!isPlainObject(raw)) return {}
      const out = {}
      if (typeof raw['转私聊'] === 'boolean') out['转私聊'] = raw['转私聊']
      if (typeof raw['转群'] === 'boolean') out['转群'] = raw['转群']
      if (isPlainObject(raw['社交'])) out['社交'] = pickKeys(raw['社交'], QQ_SOCIAL_KEYS)
      return out
    },
    safe: qqSafe,
  },
  {
    name: 'speak-up-config.json',
    path: ['speak-up-config.json'],
    kind: 'json',
    excluded: ['目标会话', '总开关', '试运行'],
    pick(raw) {
      return pickKeys(raw, SPEAK_KEYS)
    },
    safe: speakSafe,
  },
  {
    name: 'tts-bridge.json',
    path: ['tts-bridge.json'],
    kind: 'json',
    excluded: ['watch', 'favorites.messageId', 'favorites.sessionId', 'favorites.who'],
    pick(raw) {
      if (!isPlainObject(raw)) return {}
      const out = {
        panel: raw.panel !== false,
        everSeen: raw.everSeen === true,
      }
      if (Array.isArray(raw.folders)) {
        out.folders = raw.folders
          .filter((item) => isPlainObject(item) && typeof item.id === 'string' && item.id !== '')
          .map((item) => ({
            id: item.id,
            name: typeof item.name === 'string' ? item.name : item.id,
          }))
      }
      if (Array.isArray(raw.favorites)) {
        out.favorites = raw.favorites
          .filter((item) => isPlainObject(item) && typeof item.text === 'string' && item.text !== '')
          .map((item) => ({
            text: item.text.slice(0, 400),
            folder: typeof item.folder === 'string' && item.folder !== '' ? item.folder : 'default',
          }))
      }
      return out
    },
  },
  {
    name: 'bili-duty/config.json',
    path: ['bili-duty', 'config.json'],
    kind: 'json',
    excluded: ['pythonPath', 'targetSession', 'dmUid', 'autoComment', 'autoReply', 'dmMode'],
    pick(raw) {
      return pickKeys(raw, BILI_KEYS)
    },
    safe: biliSafe,
  },
])

function entryFor(name) {
  return PORTABLE_CONFIGS.find((entry) => entry.name === name) || null
}

/**
 * 收集本机能搬走的设置；缺文件就跳过，超限只跳过并警告。
 * @param {{ dshHome: string, personaText?: string }} options - 本机数据目录和可选的已自定义人设。
 * @returns {{ format: string, version: number, files: object, warnings: string[] } | null}
 */
export function collectPortableConfigs({ dshHome, personaText = '' }) {
  const warnings = []
  const files = {}
  let total = 0
  let count = 0

  const add = (name, text, redacted) => {
    const bytes = byteLength(text)
    if (bytes > PORTABLE_FILE_LIMIT) {
      warnings.push(`${name} 超过 ${Math.round(PORTABLE_FILE_LIMIT / 1024)}KB，这次没有带进包里`)
      return
    }
    if (count >= PORTABLE_FILES_LIMIT) {
      warnings.push(`配置文件超过 ${PORTABLE_FILES_LIMIT} 份，后面几份没有带进包里`)
      return false
    }
    total += bytes
    if (total > PORTABLE_TOTAL_LIMIT) {
      warnings.push('配置文件合计超过 1MB，后面几份没有带进包里')
      return false
    }
    count += 1
    files[name] = { bytes, sha256: sha256(text), text, redacted }
  }

  for (const entry of PORTABLE_CONFIGS) {
    const path = join(dshHome, ...entry.path)
    if (!existsSync(path)) continue
    let raw
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
      warnings.push(`${entry.name} 读不出来，这次没有带进包里（${String((error && error.message) || error)}）`)
      continue
    }
    if (hasDangerousKey(raw)) {
      warnings.push(`${entry.name} 里有不认识的原型字段，这次没有带进包里`)
      continue
    }
    let picked
    try {
      picked = entry.pick(raw)
    } catch (error) {
      warnings.push(`${entry.name} 整理失败，这次没有带进包里（${String((error && error.message) || error)}）`)
      continue
    }
    if (!isPlainObject(picked) || (entry.name !== 'fish-mind/tendency.json' && Object.keys(picked).length === 0)) continue
    const redacted = entry.excluded.filter((key) => {
      if (key.includes('.')) {
        const [outer, inner] = key.split('.')
        return isPlainObject(raw[outer]) && Object.hasOwn(raw[outer], inner)
      }
      return Object.hasOwn(raw, key)
    })
    add(entry.name, JSON.stringify(picked, null, 2) + '\n', redacted)
  }

  if (typeof personaText === 'string' && personaText.trim() !== '') {
    try {
      const text = normalizePersonaInput(personaText)
      add(PERSONA_FILE, text, [])
    } catch (error) {
      warnings.push(`已自定义人设读不出来，这次没有带进包里（${String((error && error.message) || error)}）`)
    }
  }

  if (Object.keys(files).length === 0) return null
  return { format: PORTABLE_FORMAT, version: PORTABLE_VERSION, files, warnings }
}

/**
 * 校验包里的配置段。坏配置只记警告，永远不阻断记忆导入。
 * @param {unknown} raw - `manifest.configs`。
 * @param {string[]} [warnings] - 收集警告的数组。
 * @returns {{ files: object, warnings: string[] } | null} 没有配置段时返回 null。
 */
export function parsePortableConfigs(raw, warnings = []) {
  if (raw === undefined || raw === null) return null
  if (!isPlainObject(raw)) {
    warnings.push('记忆包里的配置段格式不对，已跳过配置')
    return null
  }
  if (raw.format !== PORTABLE_FORMAT) {
    warnings.push('记忆包里的配置不是大肥鱼的格式，已跳过配置')
    return null
  }
  if (raw.version !== PORTABLE_VERSION) {
    warnings.push(`记忆包里的配置版本 ${String(raw.version)} 不认识，已跳过配置`)
    return null
  }
  if (!isPlainObject(raw.files)) {
    warnings.push('记忆包里的配置缺少文件清单，已跳过配置')
    return null
  }
  const files = {}
  let total = 0
  let count = 0
  for (const [name, item] of Object.entries(raw.files)) {
    if (!safeName(name)) {
      warnings.push(`记忆包里有不认识的配置：${name}，已跳过`)
      continue
    }
    if (!isPlainObject(item) || typeof item.text !== 'string') {
      warnings.push(`配置 ${name} 的内容读不出来，已跳过`)
      continue
    }
    const bytes = byteLength(item.text)
    if (bytes > PORTABLE_FILE_LIMIT) {
      warnings.push(`配置 ${name} 超过 ${Math.round(PORTABLE_FILE_LIMIT / 1024)}KB，已跳过`)
      continue
    }
    if (count >= PORTABLE_FILES_LIMIT) {
      warnings.push(`配置超过 ${PORTABLE_FILES_LIMIT} 份，后面几份已跳过`)
      break
    }
    total += bytes
    if (total > PORTABLE_TOTAL_LIMIT) {
      warnings.push('配置合计超过 1MB，后面几份已跳过')
      break
    }
    if (typeof item.sha256 === 'string' && item.sha256 !== '' && item.sha256 !== sha256(item.text)) {
      warnings.push(`配置 ${name} 校验失败，已跳过`)
      continue
    }
    if (typeof item.bytes === 'number' && Number.isFinite(item.bytes) && Math.round(item.bytes) !== bytes) {
      warnings.push(`配置 ${name} 大小对不上，已跳过`)
      continue
    }
    count += 1
    files[name] = item.text
  }
  return { files, warnings }
}

function readLocalJson(path) {
  const raw = existsSync(path) ? readJson(path) : null
  return isPlainObject(raw) ? raw : {}
}

/**
 * 把包里的配置合并到本机：先配置、后身份由调用方保证；每个文件独立成败。
 * 导入时所有对外通道都会先关掉，秘密字段不在白名单里所以本地原值保留。
 * @param {object} options - `{ dshHome, dir, configs, diag }`。
 * @returns {{ applied: number, skipped: number, warnings: string[], persona: string }}
 */
export function applyPortableConfigs({ dshHome, dir, configs, diag = () => {} }) {
  const result = { applied: 0, skipped: 0, warnings: [], persona: '' }
  if (configs === null || configs === undefined) return result
  for (const [name, text] of Object.entries(configs.files || {})) {
    try {
      if (name === PERSONA_FILE) {
        if (text.length > PERSONA_MAX_CHARS) throw new Error(`人设超过 ${PERSONA_MAX_CHARS} 字`)
        const persona = normalizePersonaInput(text)
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, 'persona-import.txt'), persona)
        result.persona = persona
        result.applied += 1
        continue
      }
      const entry = entryFor(name)
      if (entry === null) {
        result.skipped += 1
        result.warnings.push(`不认识的配置：${name}`)
        continue
      }
      let raw
      try {
        raw = JSON.parse(text)
      } catch {
        throw new Error('不是合法 JSON')
      }
      if (hasDangerousKey(raw)) throw new Error('含有不认识的原型字段')
      let picked = entry.pick(raw)
      if (!isPlainObject(picked)) picked = {}
      if (typeof entry.safe === 'function') picked = entry.safe(picked)
      if (Object.keys(picked).length === 0) {
        result.skipped += 1
        result.warnings.push(`配置 ${name} 里没有能恢复的字段，已跳过`)
        continue
      }
      const path = join(dshHome, ...entry.path)
      const merged = mergeDeep(readLocalJson(path), picked)
      writeJson(path, merged)
      result.applied += 1
    } catch (error) {
      result.skipped += 1
      const message = String((error && error.message) || error)
      result.warnings.push(`配置 ${name} 没导入成功：${message}`)
      diag(`import: 配置 ${name} 没导入成功（${message}）`)
    }
  }
  return result
}

/**
 * 启动时把暂存的人设交给配置层；没有配置层就丢弃并记日志。
 * @param {object} options - `{ dir, personaEditor, diag }`。
 * @returns {Promise<string>} 已应用的人设文本；没有可应用的人设时为空字符串。
 */
export async function applyImportedPersona({ dir, personaEditor, diag = () => {} }) {
  const path = join(dir, 'persona-import.txt')
  if (!existsSync(path)) return ''
  let text = ''
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    diag(`import: 暂存的人设读不出来（${String((error && error.message) || error)}）`)
    return ''
  }
  try {
    await personaEditor.save(text)
    diag('import: 已恢复导入包里的人设')
    return text
  } catch (error) {
    diag(`import: 导入的人设没有应用（${String((error && error.message) || error)}）`)
    return ''
  } finally {
    try {
      renameSync(path, `${path}.done`)
    } catch {}
  }
}
