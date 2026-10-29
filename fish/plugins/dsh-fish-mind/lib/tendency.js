// 主人倾向：设置里的一段话，编译成一组确定性的倾向维度。
//
// 每个维度都声明自己的落点：能落到现有旋钮的（主动额度、判断阈值、每批关注、
// 表情收藏上限）直接乘/加；只能靠语气的进每轮提示；没有落点的回到 unmatched，
// 由设置页提示交给创造模式改代码。编译是纯函数，同样的文本永远得到同样的 policy，
// 设置页预览和运行时注入用的是同一份结果。
//
// 原文只存在 `$DSH_HOME/fish-mind/tendency.json`，不进 12k 人设；识别不了的句子
// 不丢，原文照样作为偏好提示注入。

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const TENDENCY_FORMAT = 'mydearfish.tendency'
export const TENDENCY_VERSION = 1
export const TENDENCY_LIMIT = 2000

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g
const CLAUSE_SPLIT = /[。！？!?；;\n，,]/

/** 五个高信号维度；顺序就是设置页预览的顺序。 */
export const DIMENSIONS = Object.freeze([
  { id: 'talk', label: '话多话少', landing: 'knob', landingLabel: '现有旋钮' },
  { id: 'length', label: '话长话短', landing: 'prompt', landingLabel: '每轮提示' },
  { id: 'humor', label: '玩笑多少', landing: 'knob', landingLabel: '现有旋钮' },
  { id: 'stickerSend', label: '发不发表情', landing: 'prompt', landingLabel: '每轮提示' },
  { id: 'stickerSave', label: '存不存表情', landing: 'knob', landingLabel: '现有旋钮' },
])

const DIMENSION_BY_ID = new Map(DIMENSIONS.map((item) => [item.id, item]))

// 每个维度的规则按顺序匹配，先命中先算。否定/反向组合写在前面，
// 这样「别多存」不会被「多存」抢先，「别太简短」也不会被「简短」抢先。
const RULES = Object.freeze({
  talk: [
    {
      // 反向组合先判：「别那么安静」是希望活泼，不能被后面的「安静」抢先。
      mode: 'more',
      pattern: /(?:别|不要|不用|甭)(?:那么|太|老是|总是)?(?:安静|沉默|高冷)/,
    },
    {
      mode: 'less',
      pattern: /(安静|话少|少说(?:点|一点)?话|少吭声|少冒泡|少插嘴|别插嘴|少主动|别(?:太|那么|老|总)?主动|不(?:要|用|太|那么)?主动|别(?:老|总|太|那么)?(?:说话|冒泡|插嘴)|潜水|沉默|高冷|别(?:那么|太)?(?:活跃|活泼|热情))/,
    },
    {
      mode: 'more',
      pattern: /(活泼|热情|主动一?点|主动些|多主动|多说话|多冒泡|多插嘴|多参与|多搭话|多开口|话多|活跃|热络|外向|健谈)/,
    },
  ],
  length: [
    {
      mode: 'long',
      pattern: /(别(?:太|那么)?(?:简短|省字|惜字)|不要(?:太)?简短|别(?:太|那么)?(?:短|少))/,
    },
    {
      mode: 'long',
      pattern: /(话长|说详细|详细|讲完整|说完整|展开(?:说|讲)|多写|多讲|多说|长一点|长些|讲清楚|说清楚)/,
    },
    {
      mode: 'short',
      pattern: /(话短|短一点|短些|简短|简洁|精炼|精简|少说(?:两|几)?句|一两句|几个字|惜字如金|别(?:太|那么)?(?:啰嗦|唠叨)|别(?:说)?(?:那么|太)多)/,
    },
  ],
  humor: [
    {
      mode: 'more',
      pattern: /(?:别|不要|不用|甭)(?:那么|太)?(?:正经|严肃|高冷)/,
    },
    {
      mode: 'less',
      pattern: /(别(?:再|老|总)?(?:开|讲|说)?(?:玩笑|梗)|少(?:开|讲|说)?(?:点|一点)?(?:玩笑|梗)|不(?:要|用)?(?:开|讲|说)(?:玩笑|梗)|正(?:经|式)(?:一)?点|严肃(?:一)?点|别(?:那么|太)?(?:贫|逗|搞笑|幽默)|高冷)/,
    },
    {
      mode: 'more',
      pattern: /(多(?:开|讲|说)(?:点|一点)?(?:玩笑|梗)|(?:幽默|搞笑|毒舌|调皮|损)(?:一)?点|多(?:点)?玩笑|爱开玩笑)/,
    },
  ],
  stickerSend: [
    {
      mode: 'less',
      pattern: /((?:少|别多|不要多|不用多)(?:发|用|甩)(?:点|一点)?(?:表情|表情包)|(?:表情|表情包)(?:少发|发少))/,
    },
    {
      mode: 'more',
      pattern: /((?:多|勤|经常|常常)(?:发|用|甩)(?:点|一点)?(?:表情|表情包)|(?:表情|表情包)(?:多发|发多))/,
    },
    {
      mode: 'off',
      pattern: /((?:别|不要|不用|甭|不准|不许)(?:再)?(?:发|用|甩)(?:表情|表情包)|不发(?:表情|表情包))/,
    },
  ],
  stickerSave: [
    {
      mode: 'less',
      pattern: /((?:少|别多|不要多|不用多)(?:存|保存|收|收藏)(?:点|一点)?(?:表情|表情包|图)|(?:表情|表情包)(?:少存|存少|少收|少收藏))/,
    },
    {
      mode: 'more',
      pattern: /((?:勤|多|经常|常常|看到就)(?:保存|存|收|收藏)(?:点|一点)?(?:表情|表情包|图)|(?:表情|表情包)(?:勤存|多存|存多|多收|多收藏)|存(?:下来|起来)(?:表情|表情包))/,
    },
    {
      mode: 'off',
      pattern: /((?:别|不要|不用|甭|不准|不许)(?:再)?(?:存|保存|收|收藏)(?:表情|表情包|图)|不存(?:表情|表情包)|别收(?:表情|表情包))/,
    },
  ],
})

function bad(message) {
  const error = new Error(message)
  error.statusCode = 400
  return error
}

/**
 * 校验并清理主人写进设置页的一段话。空字符串是合法的「清空」。
 * @param {unknown} raw - 设置页提交的原文。
 * @returns {string} 清理后的文本。
 */
export function normalizeTendencyInput(raw) {
  if (typeof raw !== 'string') throw bad('倾向要是一段文字')
  const text = raw.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '').trim()
  if (text.includes('{{')) throw bad('倾向里不能包含 {{')
  if (text.length > TENDENCY_LIMIT) throw bad(`倾向最多 ${TENDENCY_LIMIT} 字`)
  return text
}

/**
 * 读主人倾向；缺失或损坏时返回空文本，不让设置页打不开。
 * @param {string} dir - `$DSH_HOME/fish-mind`。
 * @param {(message: string) => void} [diag] - 诊断日志。
 * @returns {{ text: string, updatedAt: number, warning: string }}
 */
export function loadTendency(dir, diag = () => {}) {
  const path = join(dir, 'tendency.json')
  if (!existsSync(path)) return { text: '', updatedAt: 0, warning: '' }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return { text: '', updatedAt: 0, warning: '倾向文件不是对象' }
    }
    const text = typeof raw.text === 'string' ? raw.text.replace(CONTROL_CHARS, '').trim().slice(0, TENDENCY_LIMIT) : ''
    const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0
    // 高版本仍然尽量读 text：降级不丢主人原话，只是新字段用不上。
    if (typeof raw.version === 'number' && raw.version > TENDENCY_VERSION) {
      diag(`tendency: 文件版本 ${raw.version} 比当前高，只读取原文`)
    }
    return { text, updatedAt, warning: '' }
  } catch (error) {
    diag(`tendency: 读不了 ${path}（${String((error && error.message) || error)}）`)
    return { text: '', updatedAt: 0, warning: '倾向文件读不出来，已按空文本处理' }
  }
}

/**
 * 原子写主人倾向。
 * @param {string} dir - `$DSH_HOME/fish-mind`。
 * @param {unknown} raw - 设置页提交的原文。
 * @param {number} [now] - 写入时间。
 * @param {(message: string) => void} [diag] - 诊断日志。
 * @returns {{ text: string, updatedAt: number }}
 */
export function saveTendency(dir, raw, now = Date.now(), diag = () => {}) {
  const text = normalizeTendencyInput(raw)
  const updatedAt = Number.isFinite(now) ? now : Date.now()
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'tendency.json')
  const temp = `${path}.tmp`
  try {
    writeFileSync(temp, JSON.stringify({ format: TENDENCY_FORMAT, version: TENDENCY_VERSION, text, updatedAt }, null, 2) + '\n')
    renameSync(temp, path)
  } catch (error) {
    try {
      if (existsSync(temp)) renameSync(temp, `${temp}.failed`)
    } catch {}
    throw error
  }
  diag(`tendency: 已保存 ${text === '' ? '（清空）' : `${text.length} 字`}`)
  return { text, updatedAt }
}

/**
 * 把一段话编译成倾向 policy。后写的从句覆盖先写的；同一句里否定优先。
 * @param {string} text - 主人原文。
 * @returns {object} `{ policy, matches, unmatchedClauses }`
 */
export function compileTendency(text) {
  const policy = {
    talk: { mode: 'normal', proactiveScale: 1, thresholdDelta: 0, attentionScale: 1 },
    length: { mode: 'normal' },
    humor: { mode: 'normal' },
    stickerSend: { mode: 'normal' },
    stickerSave: { mode: 'normal' },
  }
  const latest = new Map()
  const clauses = String(text === undefined || text === null ? '' : text)
    .split(CLAUSE_SPLIT)
    .map((item) => item.trim())
    .filter((item) => item !== '')
  const unmatchedClauses = []

  for (const clause of clauses) {
    let hit = false
    for (const dimension of DIMENSIONS) {
      const rules = RULES[dimension.id]
      const rule = rules.find((item) => item.pattern.test(clause))
      if (rule === undefined) continue
      hit = true
      latest.set(dimension.id, { clause, dimension: dimension.id, mode: rule.mode })
    }
    if (!hit) unmatchedClauses.push(clause)
  }

  for (const [dimension, match] of latest) {
    if (dimension === 'talk') {
      if (match.mode === 'less') {
        policy.talk = { mode: 'less', proactiveScale: 0.6, thresholdDelta: 0.06, attentionScale: 0.75 }
      } else if (match.mode === 'more') {
        policy.talk = { mode: 'more', proactiveScale: 1.5, thresholdDelta: -0.06, attentionScale: 1.25 }
      }
    } else {
      policy[dimension] = { mode: match.mode }
    }
  }

  const matches = DIMENSIONS
    .filter((dimension) => latest.has(dimension.id))
    .map((dimension) => latest.get(dimension.id))
  return { policy, matches, unmatchedClauses }
}

function positive(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function scaledQuota(base, scale) {
  return Math.max(1, Math.round(positive(base, 1) * scale))
}

function thresholdText(value) {
  return Number(value).toFixed(2)
}

function talkEffect(mode, base) {
  const 每时 = positive(base && base.proactivePerHour, 6)
  const 每日 = positive(base && base.proactivePerDay, 40)
  const 阈值 = Number(base && base.threshold)
  const 关注 = positive(base && base.attention, 12)
  const scale = mode === 'less' ? 0.6 : 1.5
  const delta = mode === 'less' ? 0.06 : -0.06
  const attentionScale = mode === 'less' ? 0.75 : 1.25
  const 有效阈值 = Math.max(0, Math.min(1, (Number.isFinite(阈值) ? 阈值 : 0.4) + delta))
  return `主动话量 ${每时}/时·${每日}/日 → ${scaledQuota(每时, scale)}/时·${scaledQuota(每日, scale)}/日；判断阈值 ${thresholdText(Number.isFinite(阈值) ? 阈值 : 0.4)} → ${thresholdText(有效阈值)}；每批关注 ${Math.round(关注)} → ${scaledQuota(关注, attentionScale)}（现有设置）。`
}

/**
 * 把编译结果翻成设置页能直接看懂的「她会这样理解」。
 * @param {object} compiled - `compileTendency` 的返回值。
 * @param {object} [base] - QQ 当前基础值 `{ proactivePerHour, proactivePerDay, threshold, attention }`。
 * @returns {object[]} 每条带落点和生效值。
 */
export function describeTendency(compiled, base = {}) {
  const lines = []
  for (const match of compiled.matches) {
    const dimension = DIMENSION_BY_ID.get(match.dimension)
    if (dimension === undefined) continue
    let effect
    let landing = dimension.landing
    let landingLabel = dimension.landingLabel
    if (match.dimension === 'talk') {
      effect = talkEffect(match.mode, base)
    } else if (match.dimension === 'length') {
      effect = match.mode === 'short' ? '回话收在一两句，能一句说清就不展开（每轮提示）。' : '需要解释时讲完整，别只丢结论（每轮提示）。'
    } else if (match.dimension === 'humor') {
      effect = match.mode === 'less' ? '关掉幽默层，先正经说事（现有开关）。' : '聊天里可以多开一点玩笑（每轮提示）。'
    } else if (match.dimension === 'stickerSend') {
      effect = match.mode === 'off'
        ? '尽量不发表情，用文字说（每轮提示）。'
        : match.mode === 'less'
          ? '少发表情，只在真的合适时发（每轮提示）。'
          : '可以多发表情，别每次都只发字（每轮提示）。'
    } else if (match.dimension === 'stickerSave') {
      effect = match.mode === 'more'
        ? '自动收藏上限放宽：每天 40 张、见过 1 次就收、每条最多 2 张（现有设置）。'
        : match.mode === 'less'
          ? '自动收藏收紧：每天 4 张、见过 3 次才收、每条最多 1 张（现有设置）。'
          : '不再自动收藏表情（现有设置；手动收藏不受影响）。'
    }
    lines.push({
      clause: match.clause,
      dimension: match.dimension,
      label: dimension.label,
      mode: match.mode,
      landing,
      landingLabel,
      effect,
    })
  }
  for (const clause of compiled.unmatchedClauses) {
    lines.push({
      clause,
      dimension: '',
      label: '还没识别',
      mode: '',
      landing: 'code',
      landingLabel: '需要改代码',
      effect: '还没有代码直接支持，可以交给创造模式改这条鱼。',
    })
  }
  return lines
}

/**
 * 生成交给本地创造模式的说明：把没有代码落点的倾向变成确定性行为。
 * @param {object} compiled - `compileTendency` 的返回值。
 * @param {string} text - 主人原文。
 * @param {boolean} available - 当前目录是不是能改的源码仓库。
 * @returns {string} 可复制的 brief。
 */
export function buildCreationBrief(compiled, text, available) {
  const matched = compiled.matches.length === 0
    ? '（没有已经识别并生效的句子）'
    : compiled.matches.map((match) => `- 「${match.clause}」→ ${match.dimension}/${match.mode}`).join('\n')
  const unmatched = compiled.unmatchedClauses.length === 0
    ? '（没有未识别的句子；也可以主动把现有规则改得更贴近主人）'
    : compiled.unmatchedClauses.map((clause) => `- ${clause}`).join('\n')
  return [
    '请修改这条大肥鱼自己的代码，把下面这些主人倾向变成确定性行为，而不是只加一段提示词。',
    '',
    '主人原话：',
    text,
    '',
    '已经识别并生效的落点：',
    matched,
    '',
    '还没有代码落点、需要你实现的句子：',
    unmatched,
    '',
    '代码位置：',
    '- QQ 的判断、接话、主动额度和表情收藏在 fish/plugins/dsh-qq-bridge/lib/host.js',
    '- 鱼脑的倾向编译、注入和设置页在 fish/plugins/dsh-fish-mind',
    '- 新增倾向维度时，在 lib/tendency.js 的维度表里加规则，并声明落点是旋钮、每轮提示还是代码',
    '',
    '硬约束（必须遵守）：',
    '- 不动安全、隐私、法律红线、额度、权限、试运行、群规相关代码。',
    '- 不读不写 DSH_HOME（data 目录）、凭据、日志和会话。',
    '- 不提交、不推送，不动别人正在改的文件。',
    '- 能做成确定性规则就别只加提示词；只影响这条鱼，不改出厂默认值。',
    '- 不要改安装目录里正在运行的那份；改源码仓库，改完说明是否需要重启或重跑 fish/sync-runtime.mjs --profile desktop。',
    '',
    '完成后报告：改了哪些文件、跑了哪些测试、需要重启还是需要重新同步运行时。',
    available
      ? '当前目录看起来是源码仓库，可以直接改。'
      : '当前目录看起来不是源码仓库（可能是打包版）；先只把这份 brief 交给主人，不要假装能编译进去。',
  ].join('\n')
}

/**
 * 生成本轮注入的倾向提示块。只看提示的维度靠它生效。
 * @param {object} policy - `compileTendency().policy`。
 * @param {string} text - 主人原文。
 * @param {{ unmatchedClauses?: string[] }} [extra] - 未识别的从句。
 * @returns {string} 提示块；没有倾向时为空字符串。
 */
export function buildTendencyPrompt(policy, text, extra = {}) {
  const source = typeof text === 'string' ? text.trim() : ''
  if (source === '') return ''
  const lines = []
  const 话 = policy && policy.talk ? policy.talk.mode : 'normal'
  if (话 === 'less') lines.push('- 话少一点：少主动、少插话；没人接话时宁可安静。')
  if (话 === 'more') lines.push('- 话多一点：遇到接得上的话题可以主动搭一句，但别硬插。')
  const 长 = policy && policy.length ? policy.length.mode : 'normal'
  if (长 === 'short') lines.push('- 回话短一点：能一两句说清就不展开。')
  if (长 === 'long') lines.push('- 回话可以长一点：需要解释时讲完整，别只丢结论。')
  const 玩笑 = policy && policy.humor ? policy.humor.mode : 'normal'
  if (玩笑 === 'less') lines.push('- 少开玩笑：先正经说事，别贫。')
  if (玩笑 === 'more') lines.push('- 玩笑可以多一点：接得住就损一句、逗一句。')
  const 发 = policy && policy.stickerSend ? policy.stickerSend.mode : 'normal'
  if (发 === 'off') lines.push('- 尽量不发表情，用文字说。')
  if (发 === 'less') lines.push('- 少发表情，只在真的合适时发。')
  if (发 === 'more') lines.push('- 可以多发表情，别每次都只发字。')
  const 存 = policy && policy.stickerSave ? policy.stickerSave.mode : 'normal'
  if (存 === 'more') lines.push('- 看到合适的表情包就顺手存下来，别嫌麻烦。')
  if (存 === 'less') lines.push('- 表情包少存一点，只留真的会用的。')
  if (存 === 'off') lines.push('- 不用自动存表情包。')
  const unmatched = Array.isArray(extra.unmatchedClauses) ? extra.unmatchedClauses : []
  if (unmatched.length > 0) lines.push(`- 主人还说过：${unmatched.join('；')}。这些还没有专门规则，按原话理解。`)

  const header = '【主人的倾向】\n主人对你长期的希望如下。它优先于你的出厂性格和临场习惯，但安全、隐私、法律、群规、额度和权限永远优先；冲突时听规则，其余按这里。'
  const body = lines.length > 0 ? `\n${lines.join('\n')}` : ''
  return `${header}${body}\n主人原话：「${source}」`
}
