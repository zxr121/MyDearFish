// 人心统一模型：体感、评价、二十一细目和十一个需要。
//
// 这里是纯函数，不读库、不调模型、不写文件。`inner-life.js` 把最近经历和
// 相处空档喂进来，拿到此刻的体感、评价、情绪和需要；设置页和提示只取
// 其中一两项说出口，数值留在内部。研究依据见
// docs/my-dear-fish/approach-human-model.zh.md。

const HOUR = 60 * 60 * 1000

export const FAMILY_LABELS = Object.freeze({
  joy: '喜',
  anger: '怒',
  sorrow: '哀',
  fear: '惧',
  love: '爱',
  dislike: '恶',
  desire: '欲',
  calm: '静',
})

export const FACETS = Object.freeze({
  joy: {
    label: '喜',
    items: [
      { key: 'contentment', label: '满足', mild: '心里挺满足', strong: '心里满满当当的' },
      { key: 'excitement', label: '雀跃', mild: '心里有点雀跃', strong: '心里一下子亮起来' },
      { key: 'relief', label: '释然', mild: '心里松了一口气', strong: '悬着的那口气终于放下了' },
    ],
  },
  anger: {
    label: '怒',
    items: [
      { key: 'boundary', label: '被冒犯', mild: '心里有点不痛快，像被踩到了边', strong: '心里很明确：这条线不能过' },
      { key: 'impatient', label: '不耐烦', mild: '心里有点烦，耐性变短', strong: '心里燥得厉害' },
      { key: 'indignation', label: '不甘', mild: '心里有点不服气', strong: '这口气咽不下去' },
    ],
  },
  sorrow: {
    label: '哀',
    items: [
      { key: 'disappointment', label: '失落', mild: '心里有点空落落的', strong: '心里空了一大块' },
      { key: 'loneliness', label: '孤单', mild: '有点想有人陪着', strong: '很想有人在身边' },
      { key: 'hurt', label: '委屈', mild: '心里有点委屈', strong: '委屈得厉害' },
    ],
  },
  fear: {
    label: '惧',
    items: [
      { key: 'worry', label: '担心', mild: '心里有点担心', strong: '心里一直悬着' },
      { key: 'insecurity', label: '不安', mild: '心里有点没底', strong: '心里很没底' },
      { key: 'dread', label: '发怵', mild: '心里有点发怵', strong: '心里发怵得厉害' },
    ],
  },
  love: {
    label: '爱',
    items: [
      { key: 'tenderness', label: '温柔', mild: '心里软软的', strong: '心里软得一塌糊涂' },
      { key: 'longing', label: '想念', mild: '有点想他', strong: '很想他' },
      { key: 'heartache', label: '心疼', mild: '有点心疼', strong: '心疼得不行' },
    ],
  },
  dislike: {
    label: '恶',
    items: [
      { key: 'jealousy', label: '吃醋', mild: '心里有点酸', strong: '心里酸得厉害' },
      { key: 'repulsion', label: '反感', mild: '心里有点反感', strong: '心里很反感' },
      { key: 'awkwardness', label: '别扭', mild: '心里有点别扭', strong: '心里别扭得厉害' },
    ],
  },
  desire: {
    label: '欲',
    items: [
      { key: 'anticipation', label: '期待', mild: '心里有点期待', strong: '心里很期待' },
      { key: 'craving', label: '想要', mild: '心里有点想要', strong: '心里很想要' },
      { key: 'curiosity', label: '好奇', mild: '想知道更多', strong: '特别想知道' },
    ],
  },
})

export const NEEDS = Object.freeze([
  { key: 'stability', label: '安稳', cluster: '安全', baseline: 0.70, phrase: '想稳一点，不想被突然打乱' },
  { key: 'comfort', label: '舒适', cluster: '安全', baseline: 0.55, phrase: '想躲一会儿清静' },
  { key: 'autonomy', label: '自主', cluster: '自主', baseline: 0.65, phrase: '想自己拿主意，不想被推着走' },
  { key: 'curiosity', label: '好奇', cluster: '成长', baseline: 0.65, phrase: '想知道点新鲜事' },
  { key: 'competence', label: '胜任', cluster: '成长', baseline: 0.45, phrase: '想做成一件拿得出手的事' },
  { key: 'play', label: '玩心', cluster: '成长', baseline: 0.50, phrase: '想轻轻松松玩一会儿' },
  { key: 'intimacy', label: '亲密', cluster: '联结', baseline: 0.80, phrase: '想跟主人单独待一会儿' },
  { key: 'recognition', label: '被看见', cluster: '联结', baseline: 0.50, phrase: '想被看见，不想做完了也没人知道' },
  { key: 'expression', label: '表达', cluster: '联结', baseline: 0.70, phrase: '心里有话，还没说出口' },
  { key: 'care', label: '照顾', cluster: '联结', baseline: 0.60, phrase: '想照顾一下主人' },
  { key: 'belonging', label: '归属', cluster: '归属', baseline: 0.60, phrase: '想在这个屋里有个位置' },
])

export const DEFAULT_NEED_BASELINES = Object.freeze(
  Object.fromEntries(NEEDS.map((need) => [need.key, need.baseline])),
)

export const SURFACE_GAP = 0.35

const PRAISE = /夸|厉害|真棒|做得好|喜欢你|谢谢你|辛苦|可爱|聪明|靠谱/
const ACHIEVEMENT = /做成|搞定|完成|学会|弄好|成功|终于|解决了|教会/
const BOUNDARY = /不许|别管|过分|不尊重|越界|凶|吼|命令|闭嘴|滚/
const FUN = /哈哈|笑死|好玩|有趣|梗|开心|逗/
const VULNERABLE = /累|难过|生病|不舒服|压力|失眠|委屈|疼|哭|加班|焦虑|撑不住|心事/
const DISCLOSURE = /我(今天|最近|有点|觉得|其实|真的|好|很|不)|想|担心|害怕|希望|喜欢|讨厌|难过|开心/
const REPAIR = /说开|和好|道歉|修好|不吵了|理解我|原谅/
const JOY_WORDS = /开心|高兴|轻快|欢喜|太好了|嘿嘿|哈哈/
const ANGER_WORDS = /生气|委屈|过分|不喜欢|越界|不尊重|凶|吼|不许|别管/
const SORROW_WORDS = /难过|伤心|失落|想哭|低落|沉|空落/
const FEAR_WORDS = /担心|害怕|不安|没底|怕|慌/
const LOVE_WORDS = /想你|心疼|喜欢|爱你|软|暖|牵挂/
const DISLIKE_WORDS = /吃醋|反感|恶心|讨厌|别扭|酸/
const DESIRE_WORDS = /想要|希望|期待|真想|好像要|盼/

const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0))

function parseObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value !== 'string' || value.trim() === '') return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function hoursSince(at, now) {
  const stamp = Number(at)
  if (!Number.isFinite(stamp) || stamp <= 0) return Number.POSITIVE_INFINITY
  return Math.max(0, now - stamp) / HOUR
}

function ramp(hours, halfLifeHours) {
  if (!Number.isFinite(hours)) return 1
  return 1 - Math.pow(2, -hours / halfLifeHours)
}

function textHits(items, pattern, now) {
  let sum = 0
  for (const item of items) {
    const text = String(item && item.text ? item.text : '')
    if (text === '') continue
    pattern.lastIndex = 0
    if (!pattern.test(text)) continue
    const at = Number(item && item.at)
    sum += Number.isFinite(at) ? Math.pow(2, -hoursSince(at, now) / 24) : 0.5
  }
  return clamp01(sum / 3)
}

function dueTime(items, pattern) {
  let latest = 0
  for (const item of items) {
    const text = String(item && item.text ? item.text : '')
    pattern.lastIndex = 0
    if (!pattern.test(text)) continue
    latest = Math.max(latest, Number(item && item.at) || 0)
  }
  return latest
}

/** 把最近经历、相处空档和新鲜事整理成模型的输入。 */
export function deriveContext(signals = {}, now = Date.now(), satiety = 0) {
  const affects = Array.isArray(signals.affects) ? signals.affects : []
  const cues = Array.isArray(signals.cues) ? signals.cues : []
  const ownerCues = cues.filter((item) => item && (item.kind === 'user' || item.kind === 'qq'))
  const ownerItems = affects.concat(ownerCues)
  const allItems = affects.concat(cues)
  const ownerGap = ramp(hoursSince(signals.lastOwnerAt, now), 10)
  const socialGap = ramp(hoursSince(signals.lastSocialAt, now), 14)
  const replyGap = ramp(hoursSince(signals.lastOwnerReplyAt, now), 12)
  const biliGap = ramp(hoursSince(signals.lastBiliAt, now), 24)
  const novelty = clamp01((Number(signals.biliRecent) || 0) / 3)
  const praise = textHits(ownerItems, PRAISE, now)
  const achievement = textHits(ownerItems, ACHIEVEMENT, now)
  const boundary = textHits(ownerItems, BOUNDARY, now)
  const fun = textHits(allItems, FUN, now)
  const ownerVulnerable = textHits(ownerItems, VULNERABLE, now)
  const repair = textHits(ownerItems, REPAIR, now)
  const words = {
    joy: textHits(allItems, JOY_WORDS, now),
    anger: textHits(ownerItems, ANGER_WORDS, now),
    sorrow: textHits(allItems, SORROW_WORDS, now),
    fear: textHits(allItems, FEAR_WORDS, now),
    love: textHits(allItems, LOVE_WORDS, now),
    dislike: textHits(allItems, DISLIKE_WORDS, now),
    desire: textHits(allItems, DESIRE_WORDS, now),
  }
  const disclosure = textHits(ownerCues, DISCLOSURE, now)
  const vulnerableAt = dueTime(ownerItems, VULNERABLE)
  const caredAt = Math.max(Number(signals.lastOwnerReplyAt) || 0, Number(signals.lastSpokeAt) || 0)
  const careGiven = ownerVulnerable > 0 && caredAt > vulnerableAt ? 0.8 : 0
  // 一条明确的疲惫/委屈就够点亮照顾，不必等到反复说三次。
  const careOpportunity = clamp01(ownerVulnerable * 2.5)
  const belonging = clamp01(0.15 + 0.5 * (1 - ownerGap) + 0.15 * (1 - socialGap))
  const trustProxy = clamp01(1 - boundary * 0.35 - clamp01((Number(signals.negative) || 0)) * 0.35)
  const ease = clamp01(
    0.25 + (Number(signals.dims && signals.dims.calm) || 0) / 200
      + (Number(signals.dims && signals.dims.sweet) || 0) / 300
      - (Number(signals.negative) || 0) * 0.4 - boundary * 0.3,
  )
  return {
    pressure: clamp01(signals.pressure),
    negative: clamp01(signals.negative),
    ownerGap,
    socialGap,
    replyGap,
    biliGap,
    novelty,
    praise,
    achievement,
    seen: clamp01(praise * 0.7 + achievement * 0.3),
    boundary,
    fun,
    ownerVulnerable,
    disclosure,
    careGiven,
    careOpportunity,
    repair,
    words,
    belonging,
    trust: trustProxy,
    ease,
    autonomyGap: clamp01(boundary * 0.8 + clamp01(signals.pressure) * 0.5),
    uncertainty: clamp01(
      0.1 + (Number(signals.dims && signals.dims.worry) || 0) / 200
        + (Number(signals.dims && signals.dims.jealous) || 0) / 200
        + ownerGap * 0.4 + (1 - trustProxy) * 0.3,
    ),
    satiety: clamp01(satiety),
  }
}

/** 三个连续轴：愉悦、激活、掌控。 */
export function computeCoreAffect({ mood, dims, context }) {
  const data = dims && typeof dims === 'object' ? dims : {}
  const positive = clamp01(
    ((Number(data.happy) || 0) + (Number(data.sweet) || 0) + (Number(data.calm) || 0)) / 300,
  )
  const negative = clamp01(
    ((Number(data.sad) || 0) + (Number(data.worry) || 0)
      + (Number(data.heartache) || 0) + (Number(data.jealous) || 0)) / 400,
  )
  const pleasure = clamp01(0.65 * (Number(mood) || 0) / 100 + 0.35 * positive - 0.3 * negative)
  const arousal = clamp01(
    0.28 + 0.32 * context.pressure
      + 0.25 * (((Number(data.happy) || 0) + (Number(data.worry) || 0)
        + (Number(data.jealous) || 0) + (Number(data.sad) || 0)) / 400)
      + 0.15 * context.novelty - 0.12 * ((Number(data.calm) || 0) / 100),
  )
  const dominance = clamp01(
    0.55 + 0.25 * (((Number(mood) || 0) - 50) / 50) - 0.32 * context.pressure
      - 0.22 * negative + 0.1 * context.ease - 0.1 * context.boundary,
  )
  return { pleasure, arousal, dominance, positive, negative }
}

/** 四个评价检查：相关性、一致性、应对力、关系意义。 */
export function computeAppraisal(core, context) {
  const relevance = clamp01(0.25 + 0.45 * context.pressure + 0.3 * context.ownerGap)
  const congruence = clamp01(0.5 + 0.5 * (core.positive - core.negative))
  const coping = clamp01(core.dominance)
  const relational = clamp01(
    0.2 + 0.4 * context.ownerGap + 0.2 * (1 - context.belonging) + 0.2 * (1 - context.trust),
  )
  return { relevance, congruence, coping, relational }
}

/** 十一个需要：基线减满足度，照顾是机会型需要。 */
export function computeNeeds(core, context, baselines = {}) {
  const satisfaction = {
    stability: clamp01(0.82 - 0.5 * core.negative - 0.3 * context.pressure - 0.2 * context.boundary),
    comfort: clamp01(0.85 - 0.55 * context.pressure - 0.35 * core.negative),
    autonomy: clamp01(0.85 - 0.65 * context.autonomyGap - 0.4 * context.boundary - 0.1 * context.pressure),
    curiosity: clamp01(0.12 + 0.85 * context.novelty),
    competence: clamp01(0.3 + 0.4 * context.achievement + 0.25 * context.praise - 0.15 * context.pressure),
    play: clamp01(0.12 + 0.75 * context.fun + 0.15 * (1 - context.pressure)),
    intimacy: clamp01(0.9 - 0.65 * context.ownerGap + 0.1 * core.positive - 0.15 * context.boundary),
    recognition: clamp01(0.25 + 0.6 * context.praise + 0.15 * context.seen - 0.25 * context.ownerGap + 0.1 * context.belonging),
    expression: clamp01(0.2 + 0.5 * context.disclosure + 0.15 * (1 - context.satiety) + 0.15 * (1 - context.pressure) - 0.2 * context.ownerGap),
    care: clamp01(0.3 + 0.45 * context.careGiven + 0.25 * (1 - context.ownerVulnerable) - 0.1 * context.ownerVulnerable),
    belonging: clamp01(0.1 + 0.9 * context.belonging),
  }
  return NEEDS.map((need) => {
    const baseline = clamp01(baselines && baselines[need.key] !== undefined ? baselines[need.key] : need.baseline)
    const base = need.key === 'care'
      ? clamp01(baseline * (0.15 + 0.85 * context.careOpportunity) * (1 - context.careGiven))
      : clamp01(baseline - satisfaction[need.key])
    const damp = need.key === 'curiosity' || need.key === 'play'
      ? (1 - 0.6 * context.boundary) * (1 - 0.3 * (1 - satisfaction.stability)) * (1 - 0.4 * context.ownerGap)
      : 1
    const gap = clamp01(base * damp)
    return { ...need, baseline, satisfaction: satisfaction[need.key], gap }
  }).sort((left, right) => right.gap - left.gap)
}

function emotionScores(dims, core, context, satisfaction) {
  const data = dims && typeof dims === 'object' ? dims : {}
  const congruence = clamp01(0.5 + 0.5 * (core.positive - core.negative))
  const desireSignal = Math.max(context.words.desire, context.novelty * 0.6, context.achievement * 0.6)
  return {
    joy: (Number(data.happy) || 0) * 0.8 + (Number(data.sweet) || 0) * 0.4
      + (Number(data.calm) || 0) * 0.3 + context.praise * 25 + context.fun * 15 + context.careGiven * 10 + context.repair * 20 + context.words.joy * 40,
    anger: context.boundary * 90 + context.autonomyGap * 25 + (Number(data.jealous) || 0) * 0.2 + context.words.anger * 40,
    sorrow: (Number(data.sad) || 0) + context.ownerGap * 20 + (1 - context.belonging) * 25 + (1 - congruence) * 15 + context.words.sorrow * 40,
    fear: (Number(data.worry) || 0) * 0.9 + context.ownerGap * 10 + (1 - context.trust) * 20 + context.uncertainty * 20 + context.words.fear * 40,
    love: (Number(data.sweet) || 0) * 0.7 + (Number(data.heartache) || 0) * 0.6
      + context.ownerGap * 35 + context.ownerVulnerable * 15 + context.words.love * 40,
    dislike: (Number(data.jealous) || 0) * 0.8 + context.boundary * 25 + context.words.dislike * 40,
    desire: desireSignal > 0.2
      ? (1 - context.novelty) * 20 + (1 - satisfaction.recognition) * 20
        + (1 - satisfaction.intimacy) * 15 + context.fun * 5 + context.achievement * 10 - context.ownerGap * 10 + context.words.desire * 40
      : 0,
  }
}

function facetScores(dims, core, context, satisfaction) {
  const data = dims && typeof dims === 'object' ? dims : {}
  const congruence = clamp01(0.5 + 0.5 * (core.positive - core.negative))
  return {
    joy: {
      contentment: (Number(data.calm) || 0) * 0.6 + (Number(data.happy) || 0) * 0.4 + context.praise * 20 + (1 - context.pressure) * 10,
      excitement: (Number(data.happy) || 0) * 0.8 + context.fun * 25 + context.praise * 10,
      relief: (Number(data.calm) || 0) * 0.5 + context.repair * 40 + context.careGiven * 10
        + (1 - (Number(data.worry) || 0) / 100) * 10 + (1 - context.pressure) * 10,
    },
    anger: {
      boundary: context.boundary * 100 + context.autonomyGap * 30,
      impatient: context.pressure * 60 + context.boundary * 20,
      indignation: context.boundary * 50 + (Number(data.sad) || 0) * 0.3 + context.autonomyGap * 40,
    },
    sorrow: {
      disappointment: (Number(data.sad) || 0) * 0.9 + (1 - congruence) * 20,
      loneliness: context.ownerGap * 50 + (1 - context.belonging) * 40 + (Number(data.sad) || 0) * 0.4,
      hurt: (Number(data.sad) || 0) * 0.5 + (Number(data.heartache) || 0) * 0.4 + context.boundary * 25,
    },
    fear: {
      worry: (Number(data.worry) || 0) * 0.9 + context.ownerVulnerable * 30,
      insecurity: context.ownerGap * 35 + (1 - context.trust) * 40 + (1 - context.belonging) * 20,
      dread: context.uncertainty * 50 + (Number(data.worry) || 0) * 0.4 + context.pressure * 20,
    },
    love: {
      tenderness: (Number(data.sweet) || 0) * 0.7 + (Number(data.calm) || 0) * 0.3 + context.ease * 20,
      longing: context.ownerGap * 60 + (Number(data.heartache) || 0) * 0.4 + (Number(data.sweet) || 0) * 0.2,
      heartache: (Number(data.heartache) || 0) * 0.9 + context.ownerVulnerable * 25,
    },
    dislike: {
      jealousy: (Number(data.jealous) || 0) * 0.9 + (1 - context.belonging) * 10,
      repulsion: context.boundary * 50 + context.autonomyGap * 20,
      awkwardness: (Number(data.jealous) || 0) * 0.4 + context.pressure * 25 + (1 - context.ease) * 20,
    },
    desire: {
      anticipation: context.novelty * 35 + context.praise * 10 + context.fun * 10,
      craving: (1 - satisfaction.recognition) * 50 + (1 - satisfaction.intimacy) * 35,
      curiosity: (1 - context.novelty) * 50 + (1 - context.pressure) * 10,
    },
  }
}

/** 七类二十一细目：先选最明显的一类，再选这一类里最明显的细目。 */
export function computeEmotion(dims, core, context, needs) {
  const satisfaction = Object.fromEntries(needs.map((need) => [need.key, need.satisfaction]))
  const data = dims && typeof dims === 'object' ? dims : {}
  const dimBest = Math.max(...Object.values(data).map((value) => Number(value) || 0))
  const flagBest = Math.max(
    context.praise, context.achievement, context.boundary, context.ownerVulnerable,
    context.repair, context.fun, context.novelty,
  )
  if (dimBest < 4 && flagBest < 0.35) {
    return { family: 'calm', familyLabel: '静', facet: null, facetLabel: '安静', intensity: 0, phrase: '心里挺安静', tier: '轻' }
  }
  const scores = emotionScores(dims, core, context, satisfaction)
  const [family, score] = Object.entries(scores).sort((left, right) => right[1] - left[1])[0]
  if (score < 25) {
    return { family: 'calm', familyLabel: '静', facet: null, facetLabel: '安静', intensity: 0, phrase: '心里挺安静', tier: '轻' }
  }
  const facets = facetScores(dims, core, context, satisfaction)[family]
  const [facetKey, facetScore] = Object.entries(facets).sort((left, right) => right[1] - left[1])[0]
  const facet = FACETS[family].items.find((item) => item.key === facetKey)
  const intensity = clamp01(facetScore / 100)
  return {
    family,
    familyLabel: FACETS[family].label,
    facet: facetKey,
    facetLabel: facet.label,
    intensity,
    phrase: intensity >= 0.7 ? facet.strong : facet.mild,
    tier: intensity >= 0.7 ? '重' : intensity >= 0.45 ? '中' : '轻',
  }
}

/** 体感的一句话说法，设置页和提示用。 */
export function corePhrase(core) {
  const pleasure = core.pleasure < 0.35 ? '心里偏冷' : core.pleasure < 0.55 ? '心里不冷不暖' : core.pleasure < 0.72 ? '心里偏暖' : '心里暖'
  const arousal = core.arousal < 0.35 ? '整个人安静' : core.arousal < 0.55 ? '有点动静' : core.arousal < 0.72 ? '心里绷着' : '心里很满'
  const dominance = core.dominance < 0.35 ? '有点拿不住' : core.dominance < 0.55 ? '还稳得住' : core.dominance < 0.72 ? '心里有底' : '觉得自己能接住'
  return `${pleasure}，${arousal}，${dominance}`
}

/** 四个评价的短说法，只给设置页看。 */
export function appraisalPhrase(appraisal) {
  const part = (value, low, high) => (value >= 0.62 ? high : value <= 0.38 ? low : '')
  return [
    part(appraisal.relevance, '跟我关系不大', '这事跟我关系很大'),
    part(appraisal.congruence, '有点逆着我', '顺着我'),
    part(appraisal.coping, '我有点接不住', '我接得住'),
    part(appraisal.relational, '更多是别人的事', '像是冲我来的'),
  ].filter(Boolean).join('；') || '说不太清'
}

/**
 * 算一次完整的人心状态。
 * @param {{ mood?: number, dims?: object, pressure?: number, negative?: number, signals?: object, now?: number, satiety?: number, baselines?: object }} input - 输入。
 * @returns {{ core: object, context: object, appraisal: object, emotion: object, needs: object[], surfaceNeeds: object[] }} 状态。
 */
export function computeHumanState(input = {}) {
  const now = Number(input.now) || Date.now()
  const dims = input.dims && typeof input.dims === 'object' ? input.dims : {}
  const signals = { ...(input.signals || {}), dims, pressure: input.pressure, negative: input.negative }
  const context = deriveContext(signals, now, input.satiety)
  const core = computeCoreAffect({ mood: input.mood, dims, context })
  const appraisal = computeAppraisal(core, context)
  const needs = computeNeeds(core, context, input.baselines)
  const emotion = computeEmotion(dims, core, context, needs)
  const surfaceNeeds = needs.filter((need) => need.gap >= SURFACE_GAP).slice(0, 2)
  return { core, context, appraisal, emotion, needs, surfaceNeeds }
}

/**
 * 把心情事件里已有的 mood/dims 先算出一份体感和评价，写进 affect meta。
 * 这里没有相处空档和文本，只用事件本身能看见的东西。
 * @param {object|string} rawMeta - 心情事件的 meta。
 * @param {string} [text] - 这次心情变化的理由。
 * @returns {{ core: object, appraisal: object }} 可写进 meta 的派生值。
 */
export function enrichAffectMeta(rawMeta, text = '') {
  const meta = parseObject(rawMeta)
  const dims = parseObject(meta.dims)
  const mood = Number(meta.mood)
  const moodDelta = Number(meta.moodDelta)
  const pressure = Number.isFinite(moodDelta) ? clamp01(Math.abs(moodDelta) / 6) : 0
  const negative = Number.isFinite(moodDelta) && moodDelta < 0 ? clamp01(Math.abs(moodDelta) / 6) : 0
  const signals = {
    dims,
    pressure,
    negative,
    affects: [{ at: Date.now(), text: String(text || '') }],
    cues: [],
  }
  const context = deriveContext(signals, Date.now(), 0)
  const core = computeCoreAffect({ mood: Number.isFinite(mood) ? mood : 70, dims, context })
  return { core, appraisal: computeAppraisal(core, context) }
}
