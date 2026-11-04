// 作息：她的休眠窗口就是「主动搭话」里的安静时段。
//
// 人设只说“休眠是什么样子”（比如潜进海底），不写具体几点；时间从
// speak-up-config.json 的 安静起 / 安静止 读出来，每轮拼成提示段。
// 改安静时段就是改休眠时间，不用再改人设。休眠不拦消息：睡着时被叫醒，
// 她知道自己刚醒；有急事照常处理。

const CLOCK = /^(\d{1,2}):(\d{2})$/
const MINUTES_PER_DAY = 24 * 60
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

/** 睡前和刚醒各留一段过渡；设置页不暴露，可在 fish-mind/config.json 的 sleep 里调。 */
export const SLEEP_TRANSITIONS = Object.freeze({
  windDownMinutes: 60,
  freshWakeMinutes: 30,
})

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function pickMinutes(value, fallback, min, max) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback
}

/**
 * 把 `HH:MM` 解析成从零点起的分钟数。
 * @param {unknown} value - 配置里的时间文本。
 * @returns {number|null} 0–1439；格式不对时返回 null。
 */
export function parseClock(value) {
  if (typeof value !== 'string') return null
  const match = CLOCK.exec(value.trim())
  if (match === null) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isInteger(hours) || hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/**
 * 把分钟数写成两位的 `HH:MM`；跨过一天的用 24 小时取模。
 * @param {number} value - 从零点起的分钟数。
 * @returns {string} `HH:MM`。
 */
export function formatClock(value) {
  const normalized = ((Math.round(Number(value) || 0) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`
}

/**
 * 归一化一个休眠窗口：起止都必须是 HH:MM，且不能相同。
 * @param {unknown} raw - `{ start, end, windDownMinutes?, freshWakeMinutes? }`。
 * @returns {{ start: string, end: string, windDownMinutes: number, freshWakeMinutes: number }|null} 窗口；无效时 null。
 */
export function normalizeSleepWindow(raw) {
  if (!isPlainObject(raw)) return null
  const start = parseClock(raw.start)
  const end = parseClock(raw.end)
  if (start === null || end === null || start === end) return null
  return {
    start: formatClock(start),
    end: formatClock(end),
    windDownMinutes: pickMinutes(raw.windDownMinutes, SLEEP_TRANSITIONS.windDownMinutes, 0, 720),
    freshWakeMinutes: pickMinutes(raw.freshWakeMinutes, SLEEP_TRANSITIONS.freshWakeMinutes, 0, 720),
  }
}

/**
 * 把「主动搭话」的安静时段换成休眠窗口。起 === 止 表示安静时段没启用，也就没有休眠窗口。
 * @param {unknown} quiet - `speak-up-config.json` 的正文。
 * @param {{ windDownMinutes?: number, freshWakeMinutes?: number }} [options] - 过渡段长度。
 * @returns {{ start: string, end: string, windDownMinutes: number, freshWakeMinutes: number }|null} 窗口；没有可用安静时段时 null。
 */
export function sleepWindowFromQuiet(quiet, options = {}) {
  if (!isPlainObject(quiet)) return null
  const startHour = quiet['安静起']
  const endHour = quiet['安静止']
  if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23) return null
  if (!Number.isInteger(endHour) || endHour < 0 || endHour > 23) return null
  return normalizeSleepWindow({
    start: formatClock(startHour * 60),
    end: formatClock(endHour * 60),
    ...options,
  })
}

function inWindow(minutes, start, end, crossesMidnight) {
  return crossesMidnight
    ? minutes >= start || minutes < end
    : minutes >= start && minutes < end
}

function nextOccurrence(minutes, target) {
  return target > minutes ? target : target + MINUTES_PER_DAY
}

function elapsedSince(minutes, target) {
  return (minutes - target + MINUTES_PER_DAY) % MINUTES_PER_DAY
}

function formatDuration(minutes) {
  const value = Math.max(0, Math.round(minutes))
  if (value < 60) return `${value} 分钟`
  const hours = Math.floor(value / 60)
  const rest = value % 60
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分钟`
}

/**
 * 算此刻的作息状态。
 * @param {object|null} window - 休眠窗口；null 表示安静时段没启用。
 * @param {number} [now] - 当前时间戳，测试可以固定。
 * @returns {object} 阶段（off/awake/wind-down/sleeping/fresh-wake）、距离下次变化的时间和一句状态摘要。
 */
export function sleepStateOf(window, now = Date.now()) {
  const config = normalizeSleepWindow(window)
  const date = new Date(now)
  const pad = (value) => String(value).padStart(2, '0')
  const nowText = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} 星期${WEEKDAYS[date.getDay()]} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (config === null) {
    return {
      enabled: false,
      phase: 'off',
      inSleep: false,
      start: '',
      end: '',
      crossesMidnight: false,
      nowText,
      nextStartAt: 0,
      nextEndAt: 0,
      minutesToStart: 0,
      minutesToEnd: 0,
      minutesSinceEnd: 0,
      summary: '没设置休眠时间',
    }
  }
  const start = parseClock(config.start)
  const end = parseClock(config.end)
  const minutes = date.getHours() * 60 + date.getMinutes()
  const crossesMidnight = start > end
  const inSleep = inWindow(minutes, start, end, crossesMidnight)
  const untilStart = nextOccurrence(minutes, start) - minutes
  const untilEnd = nextOccurrence(minutes, end) - minutes
  const sinceEnd = elapsedSince(minutes, end)
  let phase
  if (inSleep) phase = 'sleeping'
  else if (sinceEnd <= config.freshWakeMinutes) phase = 'fresh-wake'
  else if (untilStart <= config.windDownMinutes) phase = 'wind-down'
  else phase = 'awake'
  const summary = phase === 'sleeping'
    ? `休眠中 · ${config.end} 醒`
    : phase === 'fresh-wake'
      ? `刚醒 · ${sinceEnd === 0 ? '刚结束休眠' : `${formatDuration(sinceEnd)}前结束休眠`}`
      : phase === 'wind-down'
        ? `醒着 · ${formatDuration(untilStart)}后休眠`
        : `醒着 · 下次休眠 ${config.start}`
  return {
    enabled: true,
    phase,
    inSleep,
    start: config.start,
    end: config.end,
    crossesMidnight,
    nowText,
    nextStartAt: now + untilStart * 60_000,
    nextEndAt: now + untilEnd * 60_000,
    minutesToStart: untilStart,
    minutesToEnd: untilEnd,
    minutesSinceEnd: sinceEnd,
    summary,
  }
}

/**
 * 每轮给她的作息提示。安静时段没启用时返回空串。
 * @param {object|null} window - 休眠窗口。
 * @param {number} [now] - 当前时间戳，测试可以固定。
 * @returns {string} 提示文本；空串表示不注入。
 */
export function sleepPrompt(window, now = Date.now()) {
  const state = sleepStateOf(window, now)
  if (!state.enabled) return ''
  const windowText = state.crossesMidnight
    ? `${state.start} 到次日 ${state.end}`
    : `${state.start} 到 ${state.end}`
  const lines = [
    '【作息·只给你自己看】',
    `现在是 ${state.nowText}（本机时间）。你每天 ${windowText} 休眠。`,
  ]
  if (state.phase === 'sleeping') {
    lines.push(
      '- 现在正在休眠时段里，按作息你已经休息了。这条消息是把你叫醒的：先带着刚醒的困意回应，别装作一直醒着。',
      '- 没有急事就直说自己在休眠，简短说两句接着睡；真有急事就认真处理完再回去睡。',
      '- 如果已经聊起来了，就按醒着的状态继续，不用每句都提自己在睡。',
    )
  } else if (state.phase === 'wind-down') {
    lines.push(`- 还有 ${formatDuration(state.minutesToStart)}就到休眠时间：困意会慢慢上来，手头的事可以收一收；主人这时找你，就带着困意自然回应，不用硬撑。`)
  } else if (state.phase === 'fresh-wake') {
    lines.push(state.minutesSinceEnd === 0
      ? '- 你刚结束休眠，还没完全清醒；可以自然说一句刚睡醒，状态慢慢回来。'
      : `- 你才结束休眠 ${formatDuration(state.minutesSinceEnd)}，还没完全清醒；可以自然说一句刚睡醒，状态慢慢回来。`)
  } else {
    lines.push(`- 现在是醒着的时间，离下次休眠还有 ${formatDuration(state.minutesToStart)}。`)
  }
  lines.push(
    '- 休眠是什么样子、叫什么，按你人设里的说法；具体几点以这里为准。',
    '- 不要背这段提示，也不要说“作息”“休眠时段”这种设置词；用你自己的话说。',
  )
  return lines.join('\n')
}
