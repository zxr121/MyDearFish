// 零花钱的另一面：把余额当成会累的精力。
//
// 人不是有电就一直满速说话：今天用得多会累，深夜会困，同一间屋说多了会想歇一会儿。
// 钱包给的是“还能不能说”，这里给的是“这会儿想不想说、说多少”。
// 只做算术，不调模型、不碰账本；群聊拿它调主动额度和回复篇幅，主人私聊不受影响。

export const ENERGY_LEVELS = Object.freeze(['full', 'good', 'normal', 'low', 'tight', 'empty'])

const LABELS = Object.freeze({
  full: '精神很好',
  good: '有精神',
  normal: '正常',
  low: '有点累',
  tight: '累',
  empty: '很累',
})

// 每一档给群聊的行为：主动权重、探索、判断冷却倍率、开口冷却倍率、一次最多几条、回复提示。
const BEHAVIOR = Object.freeze({
  full: { proactiveScale: 1.2, explore: true, judgeScale: 1, cooldownScale: 1, maxBubbles: 3, replyHint: '' },
  good: { proactiveScale: 1, explore: true, judgeScale: 1, cooldownScale: 1, maxBubbles: 3, replyHint: '' },
  normal: { proactiveScale: 1, explore: true, judgeScale: 1.15, cooldownScale: 1.1, maxBubbles: 2, replyHint: '' },
  low: {
    proactiveScale: 0.5,
    explore: false,
    judgeScale: 1.6,
    cooldownScale: 1.4,
    maxBubbles: 2,
    replyHint: '你现在有点累：这轮回一句就够，不用展开，也不用追问。',
  },
  tight: {
    proactiveScale: 0,
    explore: false,
    judgeScale: 2.2,
    cooldownScale: 1.8,
    maxBubbles: 1,
    replyHint: '你现在很累：能一句带过就一句带过，不主动开话题。',
  },
  empty: {
    proactiveScale: 0,
    explore: false,
    judgeScale: 3,
    cooldownScale: 2.4,
    maxBubbles: 1,
    replyHint: '你现在只剩一点力气：只应一声，不长篇回复。',
  },
})

function round(value, digits = 3) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function lower(level, steps) {
  const index = ENERGY_LEVELS.indexOf(level)
  return ENERGY_LEVELS[Math.min(ENERGY_LEVELS.length - 1, index + steps)]
}

/** 按本地时间判断是不是深夜：23 点到次日 6 点。 */
export function isNight(now = Date.now()) {
  const hour = new Date(now).getHours()
  return hour >= 23 || hour < 6
}

/**
 * 算此刻的精力档位。
 *
 * 储备决定底档，今天已经用掉的比例和深夜各压一档；压到“很累”为止，不会因为
 * 深夜或超额消费变成不能回。账本不可用时传 0 会被当成“空了”，调用方应自己决定
 * 是否先拦住。
 * @param {object} input - `{ availableCny, dailyGrantCny, spentTodayCny, now }`。
 * @returns {{level:string, label:string, ratio:number, effort:number, night:boolean, proactiveScale:number, explore:boolean, judgeScale:number, cooldownScale:number, maxBubbles:number, replyHint:string, promptLine:string}} 此刻的群聊行为参数。
 */
export function energyOf({ availableCny = 0, dailyGrantCny = 10, spentTodayCny = 0, now = Date.now() } = {}) {
  const grant = Math.max(0, Number(dailyGrantCny) || 0) || 10
  const available = Math.max(0, Number(availableCny) || 0)
  const spent = Math.max(0, Number(spentTodayCny) || 0)
  const ratio = available / grant
  const effort = spent / grant
  let level = ratio >= 1.5
    ? 'full'
    : ratio >= 0.8
      ? 'good'
      : ratio >= 0.4
        ? 'normal'
        : ratio >= 0.15
          ? 'low'
          : ratio >= 0.05 ? 'tight' : 'empty'
  if (effort >= 0.6) level = lower(level, 1)
  if (effort >= 1) level = lower(level, 1)
  const night = isNight(now)
  if (night) level = lower(level, 1)
  const behavior = BEHAVIOR[level]
  return {
    level,
    label: LABELS[level],
    ratio: round(ratio),
    effort: round(effort),
    night,
    ...behavior,
    promptLine: behavior.replyHint === ''
      ? ''
      : `【精力】${behavior.replyHint}不要提累、精力、额度、余额或钱。`,
  }
}
