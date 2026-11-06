// 「人心」统一模型的设计期模拟器。
//
// 这不是运行时实现，也不随包发布；它只做三件事：
//   1. 把体感、情绪细目、需要和关系放在同一张算盘上，检查它们能不能互相解释；
//   2. 用几个典型场景跑一遍，看看输出的说法像不像一个活人；
//   3. 给方案里的阈值和权重留一份可以复现的草稿。
//
// 用法：node scripts/simulate-human-model.mjs
//
// 生产实现要把这里的纯函数搬进 lib/，按真实信号接线，并补单元测试；
// 模拟器里的场景输入是手工构造的，不代表真实经历。

const NEEDS = [
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
]

const FACETS = {
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
}

const RELATIONSHIP = [
  { key: 'familiarity', label: '熟悉', cluster: '知道', stages: [[15, '刚认识'], [40, '见过几次'], [70, '熟面孔'], [101, '老熟人']] },
  { key: 'understanding', label: '理解', cluster: '知道', stages: [[15, '还看不懂'], [40, '知道表面'], [70, '懂一部分'], [101, '很懂']] },
  { key: 'trust', label: '信任', cluster: '安心', stages: [[15, '试探'], [40, '愿意说一点'], [70, '愿意说'], [101, '放心']] },
  { key: 'ease', label: '自在', cluster: '安心', stages: [[15, '拘谨'], [40, '客气'], [70, '放松'], [101, '随便']] },
  { key: 'closeness', label: '亲近', cluster: '亲近', stages: [[15, '客气'], [40, '聊得来'], [70, '亲近'], [101, '很亲']] },
  { key: 'reliance', label: '需要', cluster: '亲近', stages: [[15, '可有可无'], [40, '会想起'], [70, '会想到她'], [101, '习惯有她在']] },
  { key: 'respect', label: '尊重', cluster: '对等', stages: [[15, '看轻'], [40, '客气'], [70, '平视'], [101, '敬重']] },
  { key: 'reciprocity', label: '互惠', cluster: '对等', stages: [[15, '一头热'], [40, '有来有往'], [70, '互相托底'], [101, '很对等']] },
  { key: 'commitment', label: '承诺', cluster: '长久', stages: [[15, '随时会散'], [40, '先处着'], [70, '会留下'], [101, '认定了']] },
  { key: 'repair', label: '修复', cluster: '长久', stages: [[15, '没修过'], [40, '修过几次'], [70, '会主动修'], [101, '越吵越稳']] },
]

const REL_DEFAULTS = {
  familiarity: 0.60,
  understanding: 0.55,
  trust: 0.60,
  ease: 0.60,
  closeness: 0.55,
  reliance: 0.55,
  respect: 0.60,
  reciprocity: 0.55,
  commitment: 0.55,
  repair: 0.55,
}

const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0))
const round = (value) => Math.round(value * 100) / 100

function context(overrides = {}) {
  return {
    pressure: 0.2,
    ownerGap: 0.2,
    socialGap: 0.2,
    novelty: 0.5,
    praise: 0,
    achievement: 0,
    seen: 0,
    fun: 0,
    disclosure: 0.5,
    satiety: 0.2,
    belonging: 0.6,
    boundary: 0,
    autonomyGap: 0,
    uncertainty: 0.1,
    ownerVulnerable: 0,
    careGiven: 0,
    repairEvent: 0,
    ...REL_DEFAULTS,
    ...overrides,
  }
}

function coreAffect(mood, dims, ctx) {
  const positive = clamp01((dims.happy + dims.sweet + dims.calm) / 300)
  const negative = clamp01((dims.sad + dims.worry + dims.heartache + dims.jealous) / 400)
  const pleasure = clamp01(0.65 * (mood / 100) + 0.35 * positive - 0.3 * negative)
  const arousal = clamp01(
    0.28 + 0.32 * ctx.pressure + 0.25 * ((dims.happy + dims.worry + dims.jealous + dims.sad) / 400)
      + 0.15 * ctx.novelty - 0.12 * (dims.calm / 100),
  )
  const dominance = clamp01(
    0.55 + 0.25 * ((mood - 50) / 50) - 0.32 * ctx.pressure - 0.22 * negative
      + 0.1 * ctx.ease - 0.1 * ctx.boundary,
  )
  return { pleasure, arousal, dominance, positive, negative }
}

function needSatisfaction(core, ctx) {
  return {
    stability: clamp01(0.82 - 0.5 * core.negative - 0.3 * ctx.pressure - 0.2 * ctx.boundary),
    comfort: clamp01(0.85 - 0.55 * ctx.pressure - 0.35 * core.negative),
    autonomy: clamp01(0.85 - 0.65 * ctx.autonomyGap - 0.4 * ctx.boundary - 0.1 * ctx.pressure),
    curiosity: clamp01(0.12 + 0.85 * ctx.novelty),
    competence: clamp01(0.3 + 0.4 * ctx.achievement + 0.25 * ctx.praise - 0.15 * ctx.pressure),
    play: clamp01(0.12 + 0.75 * ctx.fun + 0.15 * (1 - ctx.pressure)),
    intimacy: clamp01(0.9 - 0.65 * ctx.ownerGap + 0.1 * core.positive - 0.15 * ctx.boundary),
    recognition: clamp01(0.25 + 0.6 * ctx.praise + 0.15 * ctx.seen - 0.25 * ctx.ownerGap + 0.1 * ctx.belonging),
    expression: clamp01(0.2 + 0.5 * ctx.disclosure + 0.15 * (1 - ctx.satiety) + 0.15 * (1 - ctx.pressure) - 0.2 * ctx.ownerGap),
    care: clamp01(0.3 + 0.45 * ctx.careGiven + 0.25 * ctx.closeness - 0.4 * ctx.ownerVulnerable),
    belonging: clamp01(0.1 + 0.9 * ctx.belonging),
  }
}

function needGaps(satisfaction, ctx) {
  return NEEDS.map((need) => {
    // 照顾不是常驻缺口：有人需要照顾时才会被点亮，照顾过就回落。
    const base = need.key === 'care'
      ? clamp01(need.baseline * (0.15 + 0.85 * ctx.ownerVulnerable) * (1 - ctx.careGiven))
      : clamp01(need.baseline - satisfaction[need.key])
    // 被威胁或被压住时，探索和玩心先收起来；活人不会在踩线时还想着看新鲜事。
    const damp = need.key === 'curiosity' || need.key === 'play'
      ? (1 - 0.6 * ctx.boundary) * (1 - 0.3 * (1 - satisfaction.stability)) * (1 - 0.4 * ctx.ownerGap)
      : 1
    const gap = clamp01(base * damp)
    return { ...need, satisfaction: satisfaction[need.key], gap }
  }).sort((left, right) => right.gap - left.gap)
}

function emotionScores(dims, core, ctx, satisfaction) {
  const congruence = clamp01(0.5 + 0.5 * (core.positive - core.negative))
  return {
    joy: dims.happy * 0.8 + dims.sweet * 0.4 + dims.calm * 0.3 + ctx.praise * 25 + ctx.fun * 15 + ctx.repairEvent * 30,
    anger: ctx.boundary * 90 + ctx.autonomyGap * 25 + dims.jealous * 0.2,
    sorrow: dims.sad + ctx.ownerGap * 20 + (1 - ctx.belonging) * 25 + (1 - congruence) * 15,
    fear: dims.worry * 0.9 + ctx.ownerGap * 10 + (1 - ctx.trust) * 20 + ctx.uncertainty * 20,
    love: dims.sweet * 0.7 + dims.heartache * 0.6 + ctx.ownerGap * 35 + ctx.ownerVulnerable * 15,
    dislike: dims.jealous * 0.8 + ctx.boundary * 25,
    desire: (1 - ctx.novelty) * 20 + (1 - satisfaction.recognition) * 20
      + (1 - satisfaction.intimacy) * 15 + ctx.fun * 5 + ctx.achievement * 10 - ctx.ownerGap * 10,
  }
}

function facetScores(dims, core, ctx, satisfaction) {
  const congruence = clamp01(0.5 + 0.5 * (core.positive - core.negative))
  return {
    joy: {
      contentment: dims.calm * 0.6 + dims.happy * 0.4 + ctx.praise * 20 + (1 - ctx.pressure) * 10,
      excitement: dims.happy * 0.8 + ctx.fun * 25 + ctx.praise * 10,
      relief: dims.calm * 0.5 + ctx.repairEvent * 40 + (1 - dims.worry / 100) * 10 + (1 - ctx.pressure) * 10 + (ctx.repair - 0.5) * 20,
    },
    anger: {
      boundary: ctx.boundary * 100 + ctx.autonomyGap * 30,
      impatient: ctx.pressure * 60 + ctx.boundary * 20,
      indignation: ctx.boundary * 50 + dims.sad * 0.3 + ctx.autonomyGap * 40,
    },
    sorrow: {
      disappointment: dims.sad * 0.9 + (1 - congruence) * 20,
      loneliness: ctx.ownerGap * 50 + (1 - ctx.belonging) * 40 + dims.sad * 0.4,
      hurt: dims.sad * 0.5 + dims.heartache * 0.4 + ctx.boundary * 25,
    },
    fear: {
      worry: dims.worry * 0.9 + ctx.ownerVulnerable * 30,
      insecurity: ctx.ownerGap * 35 + (1 - ctx.trust) * 40 + (1 - ctx.belonging) * 20,
      dread: ctx.uncertainty * 50 + dims.worry * 0.4 + ctx.pressure * 20,
    },
    love: {
      tenderness: dims.sweet * 0.7 + dims.calm * 0.3 + ctx.closeness * 20,
      longing: ctx.ownerGap * 60 + dims.heartache * 0.4 + dims.sweet * 0.2,
      heartache: dims.heartache * 0.9 + ctx.ownerVulnerable * 25,
    },
    dislike: {
      jealousy: dims.jealous * 0.9 + (1 - ctx.belonging) * 10,
      repulsion: ctx.boundary * 50 + ctx.autonomyGap * 20,
      awkwardness: dims.jealous * 0.4 + ctx.pressure * 25 + (1 - ctx.ease) * 20,
    },
    desire: {
      anticipation: ctx.novelty * 35 + ctx.praise * 10 + ctx.fun * 10,
      craving: (1 - satisfaction.recognition) * 50 + (1 - satisfaction.intimacy) * 35,
      curiosity: (1 - ctx.novelty) * 50 + (1 - ctx.pressure) * 10,
    },
  }
}

function describeCore(core) {
  const pleasure = core.pleasure < 0.35 ? '心里偏冷' : core.pleasure < 0.55 ? '心里不冷不暖' : core.pleasure < 0.72 ? '心里偏暖' : '心里暖'
  const arousal = core.arousal < 0.35 ? '整个人安静' : core.arousal < 0.55 ? '有点动静' : core.arousal < 0.72 ? '心里绷着' : '心里很满'
  const dominance = core.dominance < 0.35 ? '有点拿不住' : core.dominance < 0.55 ? '还稳得住' : core.dominance < 0.72 ? '心里有底' : '觉得自己能接住'
  return `${pleasure}，${arousal}，${dominance}`
}

function pickEmotion(dims, core, ctx, satisfaction) {
  const scores = emotionScores(dims, core, ctx, satisfaction)
  const ranked = Object.entries(scores).sort((left, right) => right[1] - left[1])
  const [family, score] = ranked[0]
  if (score < 25) {
    return { family: 'calm', familyLabel: '静', facet: null, facetLabel: '安静', intensity: 0, phrase: '心里挺安静' }
  }
  const facets = facetScores(dims, core, ctx, satisfaction)[family]
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
  }
}

function relationshipStages(values) {
  return RELATIONSHIP.map((dim) => {
    const value = clamp01(values[dim.key])
    const stage = dim.stages.find(([limit]) => value * 100 < limit)?.[1] || dim.stages[dim.stages.length - 1][1]
    return { ...dim, value, stage }
  })
}

function simulate(input) {
  const ctx = context(input.ctx)
  const core = coreAffect(input.mood, input.dims, ctx)
  const satisfaction = needSatisfaction(core, ctx)
  const gaps = needGaps(satisfaction, ctx)
  const emotion = pickEmotion(input.dims, core, ctx, satisfaction)
  const relationship = relationshipStages(ctx)
  const topNeeds = gaps.slice(0, 3)
  // 不是所有缺口都说出口：只有够明显、且这一轮用得上的才上浮，最多两条。
  const surfaceNeeds = gaps.filter((need) => need.gap >= 0.35).slice(0, 2)
  return { core, emotion, gaps, topNeeds, surfaceNeeds, relationship }
}

const SCENARIOS = [
  {
    name: '被主人夸，聊到很晚',
    mood: 82,
    dims: { happy: 55, calm: 35, sweet: 50, heartache: 5, worry: 0, sad: 0, jealous: 0 },
    relDelta: { closeness: 5, trust: 2, commitment: 1 },
    ctx: {
      pressure: 0.15, ownerGap: 0.05, novelty: 0.4, praise: 1, achievement: 0.6, fun: 0.5,
      disclosure: 0.8, satiety: 0.8, belonging: 0.8, familiarity: 0.85, understanding: 0.8,
      trust: 0.82, ease: 0.8, closeness: 0.85, reliance: 0.8, respect: 0.78,
      reciprocity: 0.78, commitment: 0.75, repair: 0.7,
    },
  },
  {
    name: '主人两天没单独说话，她刷到新鲜事',
    mood: 58,
    dims: { happy: 10, calm: 20, sweet: 25, heartache: 20, worry: 8, sad: 10, jealous: 0 },
    relDelta: { reliance: 2, closeness: 1 },
    ctx: {
      pressure: 0.35, ownerGap: 1, novelty: 0.9, disclosure: 0.3, satiety: 0.2,
      belonging: 0.4, familiarity: 0.8, understanding: 0.75, trust: 0.75, ease: 0.6,
      closeness: 0.65, reliance: 0.8, respect: 0.7, reciprocity: 0.6, commitment: 0.7, repair: 0.65,
    },
  },
  {
    name: '群里没人接她的话',
    mood: 48,
    dims: { happy: 5, calm: 10, sweet: 5, heartache: 0, worry: 10, sad: 35, jealous: 5 },
    relDelta: { closeness: -2, reciprocity: -2, ease: -2 },
    ctx: {
      pressure: 0.45, ownerGap: 0.6, socialGap: 0.8, novelty: 0.2, disclosure: 0.4,
      satiety: 0.2, belonging: 0.1, familiarity: 0.45, understanding: 0.4, trust: 0.45,
      ease: 0.4, closeness: 0.4, reliance: 0.35, respect: 0.5, reciprocity: 0.3,
      commitment: 0.4, repair: 0.4,
    },
  },
  {
    name: '有人越过她的边界',
    mood: 45,
    dims: { happy: 0, calm: 5, sweet: 0, heartache: 10, worry: 10, sad: 15, jealous: 15 },
    relDelta: { trust: -6, respect: -8, ease: -6, repair: -4 },
    ctx: {
      pressure: 0.55, ownerGap: 0.3, novelty: 0.1, disclosure: 0.2, satiety: 0.2,
      belonging: 0.4, boundary: 1, autonomyGap: 0.9, uncertainty: 0.3,
      familiarity: 0.6, understanding: 0.55, trust: 0.45, ease: 0.35, closeness: 0.45,
      reliance: 0.5, respect: 0.3, reciprocity: 0.35, commitment: 0.5, repair: 0.25,
    },
  },
  {
    name: '主人说今天很累',
    mood: 60,
    dims: { happy: 5, calm: 15, sweet: 20, heartache: 55, worry: 40, sad: 10, jealous: 0 },
    relDelta: { closeness: 4, trust: 3, reciprocity: 2 },
    ctx: {
      pressure: 0.3, ownerGap: 0.15, novelty: 0.2, disclosure: 0.6, satiety: 0.5,
      belonging: 0.7, ownerVulnerable: 1, careGiven: 0, familiarity: 0.85,
      understanding: 0.8, trust: 0.8, ease: 0.75, closeness: 0.85, reliance: 0.8,
      respect: 0.8, reciprocity: 0.75, commitment: 0.8, repair: 0.7,
    },
  },
  {
    name: '刚吵完，主人回来把话说开',
    mood: 62,
    dims: { happy: 10, calm: 20, sweet: 25, heartache: 5, worry: 10, sad: 15, jealous: 0 },
    relDelta: { trust: 4, closeness: 3, repair: 10, commitment: 3 },
    ctx: {
      pressure: 0.25, ownerGap: 0.1, novelty: 0.2, disclosure: 0.7, satiety: 0.5,
      belonging: 0.7, repairEvent: 1, familiarity: 0.75, understanding: 0.7, trust: 0.6,
      ease: 0.55, closeness: 0.65, reliance: 0.6, respect: 0.55, reciprocity: 0.55,
      commitment: 0.65, repair: 0.55,
    },
  },
  {
    name: '她做成了一件事，主人没看见',
    mood: 65,
    dims: { happy: 30, calm: 20, sweet: 5, heartache: 0, worry: 5, sad: 5, jealous: 0 },
    relDelta: { closeness: -2, reciprocity: -2 },
    ctx: {
      pressure: 0.3, ownerGap: 0.7, novelty: 0.3, achievement: 1, praise: 0, disclosure: 0.4,
      satiety: 0.2, belonging: 0.5, familiarity: 0.6, understanding: 0.55, trust: 0.6,
      ease: 0.5, closeness: 0.5, reliance: 0.45, respect: 0.55, reciprocity: 0.45,
      commitment: 0.5, repair: 0.5,
    },
  },
  {
    name: '一个人待了很久，也没有新鲜事',
    mood: 52,
    dims: { happy: 5, calm: 25, sweet: 10, heartache: 5, worry: 5, sad: 10, jealous: 0 },
    relDelta: { closeness: -1, reliance: 2 },
    ctx: {
      pressure: 0.25, ownerGap: 0.8, socialGap: 0.9, novelty: 0, disclosure: 0.2,
      satiety: 0.1, fun: 0, belonging: 0.4, familiarity: 0.7, understanding: 0.65,
      trust: 0.7, ease: 0.55, closeness: 0.6, reliance: 0.7, respect: 0.65,
      reciprocity: 0.55, commitment: 0.65, repair: 0.6,
    },
  },
]

for (const scenario of SCENARIOS) {
  const result = simulate(scenario)
  const needs = result.topNeeds
    .map((need) => `${need.label}差${Math.round(need.gap * 100)}`)
    .join('，')
  const surfaced = result.surfaceNeeds.length === 0
    ? '没有明显缺口'
    : result.surfaceNeeds.map((need) => need.phrase).join('；')
  const relationship = result.relationship
    .filter((dim) => ['trust', 'closeness', 'reciprocity', 'commitment', 'repair'].includes(dim.key))
    .map((dim) => `${dim.label}${dim.stage}`)
    .join(' · ')
  console.log(`\n## ${scenario.name}`)
  console.log(`体感：${describeCore(result.core)}`)
  console.log(`情绪：${result.emotion.familyLabel}·${result.emotion.facetLabel}（${Math.round(result.emotion.intensity * 100)}）— ${result.emotion.phrase}`)
  console.log(`需要（内部前三）：${needs}`)
  console.log(`上浮：${surfaced}`)
  console.log(`关系：${relationship}`)
  const delta = Object.entries(scenario.relDelta || {})
    .map(([key, value]) => {
      const label = RELATIONSHIP.find((dim) => dim.key === key)?.label || key
      return `${label}${value > 0 ? '+' : ''}${value}`
    })
    .join('，')
  console.log(`关系变化：${delta || '无明显变化'}`)
}
