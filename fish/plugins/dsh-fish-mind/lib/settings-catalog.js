// 她可以替主人改的设置：只收行为旋钮，安全、预算、名单、试运行和凭据不在里面。
//
// 每个设置项都声明落点（QQ 社交段 / 主动搭话配置 / 性格倾向原文）和取值规则；
// 写入走 config-files 的原子读-改-写，先校验再落盘，某一项不合法就一项都不写。
// 读取不需要开发者模式，写入由 permissions.js 把关。

import { join } from 'node:path'
import {
  QQ_SOCIAL_LIMITS,
  SPEAK_LIMITS,
  readQqSocial,
  qqSocialValues,
  updateQqSocial,
  readSpeakConfig,
  speakUpValues,
  updateSpeakConfig,
} from './config-files.js'
import { TENDENCY_LIMIT, loadTendency, normalizeTendencyInput } from './tendency.js'

export const TENDENCY_KEY = 'mind.tendency'

const QQ_PAGE = '通到QQ'
const SPEAK_PAGE = '主动搭话'
const MIND_PAGE = '大肥鱼'

/** 设置目录：顺序就是 `fish_config` 的展示顺序。 */
export const SETTING_ITEMS = Object.freeze([
  {
    key: 'qq.proactivePerHour',
    page: QQ_PAGE,
    label: '主动每时',
    target: 'qq',
    field: '主动每时',
    type: 'integer',
    ...QQ_SOCIAL_LIMITS['主动每时'],
    default: 6,
    description: '同一间群每小时最多主动搭话几轮；0 = 不限。被叫和主人找她不算。',
  },
  {
    key: 'qq.proactivePerDay',
    page: QQ_PAGE,
    label: '主动每日',
    target: 'qq',
    field: '主动每日',
    type: 'integer',
    ...QQ_SOCIAL_LIMITS['主动每日'],
    default: 40,
    description: '同一间群每天最多主动搭话几轮；0 = 不限。',
  },
  {
    key: 'qq.attention',
    page: QQ_PAGE,
    label: '关注上限',
    target: 'qq',
    field: '关注上限',
    type: 'integer',
    ...QQ_SOCIAL_LIMITS['关注上限'],
    default: 12,
    description: '她一次最多挑几条新消息进视线；没挑中的当没看见。',
  },
  {
    key: 'qq.threshold',
    page: QQ_PAGE,
    label: '判断阈值',
    target: 'qq',
    field: '判断阈值',
    type: 'number',
    ...QQ_SOCIAL_LIMITS['判断阈值'],
    default: 0.4,
    description: '小模型想接话的把握低于这个数就不接；越高越挑。只看不回不受影响。',
  },
  {
    key: 'qq.learnStickers',
    page: QQ_PAGE,
    label: '学表情',
    target: 'qq',
    field: '学表情',
    type: 'boolean',
    default: true,
    description: '是否摸清群里的表情习惯，并顺手收藏反复见到的表情。',
  },
  {
    key: 'qq.mode',
    page: QQ_PAGE,
    label: '模式',
    target: 'qq',
    field: '模式',
    type: 'enum',
    values: ['auto', 'mention'],
    default: 'auto',
    description: 'auto = 没被叫也让她自己挑消息；mention = 只把被叫到的消息交给她。',
  },
  {
    key: 'qq.calls',
    page: QQ_PAGE,
    label: '称呼',
    target: 'qq',
    field: '称呼',
    type: 'list',
    minItems: 1,
    maxItems: 30,
    default: ['大肥鱼', '肥鱼'],
    description: '群里文字出现这些词就等于在叫她；至少留一个。',
  },
  {
    key: 'qq.interests',
    page: QQ_PAGE,
    label: '兴趣词',
    target: 'qq',
    field: '兴趣词',
    type: 'list',
    minItems: 0,
    maxItems: 30,
    default: [],
    description: '她明确感兴趣的话题；留空 = 不限定。',
  },
  {
    key: 'qq.avoidTopics',
    page: QQ_PAGE,
    label: '不聊话题',
    target: 'qq',
    field: '不聊话题',
    type: 'list',
    minItems: 0,
    maxItems: 60,
    default: [],
    description: '主人划出的话题；群里聊这些她不主动接，被叫到可以短应一句。',
  },
  {
    key: 'qq.cooldownSeconds',
    page: QQ_PAGE,
    label: '冷却秒',
    target: 'qq',
    field: '冷却秒',
    type: 'integer',
    ...QQ_SOCIAL_LIMITS['冷却秒'],
    default: 15,
    description: '同一个群/好友两次开口的成熟期基础间隔（秒）；实际还会按兴致和余额走曲线。',
  },
  {
    key: 'speakUp.enabled',
    page: SPEAK_PAGE,
    label: '总开关',
    target: 'speak',
    field: '总开关',
    type: 'boolean',
    default: true,
    description: '关掉后主动搭话完全不动（定时器还在，但什么都不做）。',
  },
  {
    key: 'speakUp.intervalMinutes',
    page: SPEAK_PAGE,
    label: '间隔分钟',
    target: 'speak',
    field: '间隔分钟',
    type: 'integer',
    ...SPEAK_LIMITS['间隔分钟'],
    default: 30,
    description: '多久掷一次骰子决定要不要主动开口。',
  },
  {
    key: 'speakUp.peakChance',
    page: SPEAK_PAGE,
    label: '峰时命中线',
    target: 'speak',
    field: '峰时命中线',
    type: 'number',
    ...SPEAK_LIMITS['峰时命中线'],
    default: 20,
    description: '峰时（贵）的命中线，越低越少开口。',
  },
  {
    key: 'speakUp.idleChance',
    page: SPEAK_PAGE,
    label: '谷时命中线',
    target: 'speak',
    field: '谷时命中线',
    type: 'number',
    ...SPEAK_LIMITS['谷时命中线'],
    default: 60,
    description: '谷时（便宜）的命中线，越高越常开口。',
  },
  {
    key: 'speakUp.quietStart',
    page: SPEAK_PAGE,
    label: '安静起',
    target: 'speak',
    field: '安静起',
    type: 'integer',
    ...SPEAK_LIMITS['安静起'],
    default: 1,
    description: '安静时段从几点开始（含起不含止）；起 === 止 表示不启用。',
  },
  {
    key: 'speakUp.quietEnd',
    page: SPEAK_PAGE,
    label: '安静止',
    target: 'speak',
    field: '安静止',
    type: 'integer',
    ...SPEAK_LIMITS['安静止'],
    default: 8,
    description: '安静时段到几点结束；那段时间根本不掷骰子。',
  },
  {
    key: 'speakUp.trigger',
    page: SPEAK_PAGE,
    label: '触发文案',
    target: 'speak',
    field: '触发文案',
    type: 'text',
    maxLength: 200,
    allowEmpty: false,
    default: '好久没人跟我说话了，我该主动去打个招呼',
    description: '没人说话时用来提醒自己开口的动机句子，用她自己的口吻。',
  },
  {
    key: TENDENCY_KEY,
    page: MIND_PAGE,
    label: '性格倾向',
    target: 'mind',
    type: 'tendency',
    default: '',
    description: '主人写给她的长期倾向；保存后会直接写进对应设置页，留空 = 清空。',
  },
])

const ITEM_BY_KEY = new Map(SETTING_ITEMS.map((item) => [item.key, item]))

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function rangeText(item) {
  if (item.type === 'boolean') return '开 / 关'
  if (item.type === 'enum') return item.values.join(' / ')
  if (item.type === 'integer' || item.type === 'number') return `${item.min} ~ ${item.max}`
  if (item.type === 'list') return `最多 ${item.maxItems ?? 30} 项，每项不超过 32 字`
  if (item.type === 'tendency') return `最多 ${TENDENCY_LIMIT} 字；留空 = 清空`
  return `最多 ${item.maxLength ?? 200} 字`
}

function coerceNumber(item, value) {
  if (typeof value === 'string' && value.trim() === '') {
    throw new Error(`「${item.label}」要填一个 ${item.type === 'integer' ? '整数' : '数'}`)
  }
  const raw = Number(value)
  if (!Number.isFinite(raw)) throw new Error(`「${item.label}」要填一个 ${item.type === 'integer' ? '整数' : '数'}`)
  const number = item.type === 'integer' ? Math.round(raw) : Math.round(raw * 1000) / 1000
  if (number < item.min || number > item.max) {
    throw new Error(`「${item.label}」要在 ${item.min} ~ ${item.max} 之间（给的是 ${number}）`)
  }
  return number
}

function coerceBoolean(item, value) {
  if (value === true || value === false) return value
  if (value === 1 || value === 0) return value === 1
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase()
    if (['true', '开', '打开', 'yes', 'on', '1'].includes(text)) return true
    if (['false', '关', '关闭', 'no', 'off', '0'].includes(text)) return false
  }
  throw new Error(`「${item.label}」只能是开或关`)
}

function coerceEnum(item, value) {
  const text = typeof value === 'string' ? value.trim() : String(value)
  if (!item.values.includes(text)) {
    throw new Error(`「${item.label}」只能是 ${item.values.join(' / ')}（给的是「${text}」）`)
  }
  return text
}

function coerceText(item, value) {
  if (typeof value !== 'string') throw new Error(`「${item.label}」要是一段文字`)
  const text = value.trim()
  if (text === '' && item.allowEmpty !== true) throw new Error(`「${item.label}」不能是空的`)
  const limit = item.maxLength ?? 200
  if (text.length > limit) throw new Error(`「${item.label}」最多 ${limit} 字（现在是 ${text.length} 字）`)
  return text
}

function coerceList(item, value) {
  const entries = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[、,，\n]/)
      : null
  if (entries === null) throw new Error(`「${item.label}」要是一组词（数组，或用顿号/逗号隔开的文字）`)
  const out = []
  for (const entry of entries) {
    if (typeof entry !== 'string') throw new Error(`「${item.label}」的每一项都要是文字`)
    const word = entry.trim()
    if (word === '') continue
    if (word.length > 32) throw new Error(`「${item.label}」里的每一项最多 32 字（「${word.slice(0, 12)}…」太长）`)
    if (!out.includes(word)) out.push(word)
  }
  if (out.length < (item.minItems ?? 0)) throw new Error(`「${item.label}」至少要有 ${item.minItems} 项`)
  if (out.length > (item.maxItems ?? 30)) throw new Error(`「${item.label}」最多 ${item.maxItems} 项（现在是 ${out.length} 项）`)
  return out
}

function coerceTendency(value) {
  try {
    return normalizeTendencyInput(value)
  } catch (error) {
    throw new Error(`「性格倾向」没通过校验：${(error && error.message) || error}`)
  }
}

function coerceValue(item, value) {
  switch (item.type) {
    case 'integer':
    case 'number':
      return coerceNumber(item, value)
    case 'boolean':
      return coerceBoolean(item, value)
    case 'enum':
      return coerceEnum(item, value)
    case 'text':
      return coerceText(item, value)
    case 'list':
      return coerceList(item, value)
    case 'tendency':
      return coerceTendency(value)
    default:
      throw new Error(`设置项「${item.key}」的类型不认识：${item.type}`)
  }
}

function sameValue(left, right) {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => value === right[index])
  }
  return left === right
}

function displayValue(item, value) {
  if (item.type === 'boolean') return value ? '开' : '关'
  if (item.type === 'list') return value.length > 0 ? value.join('、') : '（空）'
  if (item.type === 'tendency') return value === '' ? '（未设置）' : value
  return String(value)
}

function changeText(value) {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat
}

function readValues(dshHome) {
  const qqRead = readQqSocial(dshHome)
  const speakRead = readSpeakConfig(dshHome)
  const tendency = loadTendency(join(dshHome, 'fish-mind'))
  return {
    qqRead,
    speakRead,
    tendency,
    qq: qqSocialValues(qqRead.social),
    speak: speakUpValues(speakRead.value),
  }
}

function currentValue(item, state) {
  if (item.target === 'qq') return state.qq[item.field]
  if (item.target === 'speak') return state.speak[item.field]
  return state.tendency.text
}

function listWarnings(state) {
  const warnings = []
  if (state.qqRead.broken) {
    warnings.push(`QQ 设置文件读不出来（${state.qqRead.error}）；下面显示的是出厂值，写入会被拒绝。`)
  }
  if (state.speakRead.broken) {
    warnings.push(`「主动搭话」设置文件读不出来（${state.speakRead.error}）；下面显示的是出厂值，写入会被拒绝。`)
  }
  if (state.tendency.warning !== '') warnings.push(state.tendency.warning)
  return warnings
}

function itemsFrom(state) {
  return SETTING_ITEMS.map((item) => ({
    key: item.key,
    page: item.page,
    label: item.label,
    type: item.type,
    value: displayValue(item, currentValue(item, state)),
    defaultValue: displayValue(item, item.default),
    range: rangeText(item),
    description: item.description,
  }))
}

/**
 * 读全部可改设置项，值和范围都转成给模型看的字符串。
 * @param {{ dshHome: string }} options - DSH 主目录。
 * @returns {{ items: object[], warnings: string[] }} 设置清单和读取告警。
 */
export function listFishSettings({ dshHome }) {
  const state = readValues(dshHome)
  return { items: itemsFrom(state), warnings: listWarnings(state) }
}

/**
 * 批量改设置：先校验全部，再按配置文件分组原子写入；倾向走调用方给的保存回调。
 * @param {object} options - `{ dshHome, patch, saveTendencyText }`。
 * @param {string} options.dshHome - DSH 主目录。
 * @param {Record<string, unknown>} options.patch - 键是设置项 key，值是新值。
 * @param {(text: string) => { warnings?: string[], note?: string }} [options.saveTendencyText] - 保存并落地倾向的回调。
 * @returns {{ items: object[], changes: object[], warnings: string[], note: string }} 改完后的清单和逐项变更。
 */
export function applyFishSettings({ dshHome, patch, saveTendencyText }) {
  if (!isPlainObject(patch)) throw new Error('patch 要是一个对象：键是设置项名，值是新值')
  const keys = Object.keys(patch)
  if (keys.length === 0) throw new Error('patch 是空的：要改设置就至少给一项，例如 {"qq.proactivePerDay": 60}')
  const unknown = keys.filter((key) => !ITEM_BY_KEY.has(key))
  if (unknown.length > 0) {
    throw new Error(`不认识这些设置项：${unknown.join('、')}。先不带 patch 读一遍，键名照抄清单里的 key。`)
  }

  const state = readValues(dshHome)
  const changes = []
  for (const key of keys) {
    const item = ITEM_BY_KEY.get(key)
    const after = coerceValue(item, patch[key])
    const before = currentValue(item, state)
    if (!sameValue(before, after)) changes.push({ item, before, after })
  }

  const targets = new Set(changes.map((change) => change.item.target))
  if (targets.has('qq') && state.qqRead.broken) {
    throw new Error(`QQ 设置文件读不出来（${state.qqRead.error}），先让主人修好或删掉再改，别覆盖原文件。`)
  }
  if (targets.has('speak') && state.speakRead.broken) {
    throw new Error(`「主动搭话」设置文件读不出来（${state.speakRead.error}），先让主人修好或删掉再改，别覆盖原文件。`)
  }

  const warnings = []
  const notes = []
  const changedPlans = changes.map((change) => ({ item: change.item, after: change.after }))
  const qqPlans = changedPlans.filter((plan) => plan.item.target === 'qq')
  const speakPlans = changedPlans.filter((plan) => plan.item.target === 'speak')
  const tendencyPlan = changedPlans.find((plan) => plan.item.target === 'mind')

  if (qqPlans.length > 0) {
    const result = updateQqSocial(dshHome, (social) => {
      for (const plan of qqPlans) social[plan.item.field] = plan.after
    })
    if (result.created) warnings.push(`QQ 设置文件原来不存在，已新建：${result.path}`)
  }
  if (speakPlans.length > 0) {
    const result = updateSpeakConfig(dshHome, (config) => {
      for (const plan of speakPlans) config[plan.item.field] = plan.after
    })
    if (result.created) warnings.push(`「主动搭话」设置文件原来不存在，已新建：${result.path}`)
  }
  if (tendencyPlan !== undefined) {
    if (typeof saveTendencyText !== 'function') throw new Error('性格倾向现在改不了：设置页的保存通道还没准备好')
    const saved = saveTendencyText(tendencyPlan.after)
    if (saved && Array.isArray(saved.warnings)) warnings.push(...saved.warnings)
    if (saved && typeof saved.note === 'string' && saved.note !== '') notes.push(saved.note)
  }

  const afterState = readValues(dshHome)
  const parts = []
  if (changes.length === 0) {
    parts.push('没有改动：给的新值和当前一样。')
  } else {
    parts.push(`已改 ${changes.length} 项。`)
    if (qqPlans.length > 0 || speakPlans.length > 0) parts.push('QQ 桥和主动搭话每次用设置时都会重新读文件，不用重启。')
  }
  for (const note of notes) parts.push(note)

  return {
    items: itemsFrom(afterState),
    changes: changes.map((change) => ({
      key: change.item.key,
      label: change.item.label,
      page: change.item.page,
      before: changeText(displayValue(change.item, change.before)),
      after: changeText(displayValue(change.item, change.after)),
    })),
    warnings,
    note: parts.join(''),
  }
}
