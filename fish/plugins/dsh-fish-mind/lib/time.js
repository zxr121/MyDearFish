// 时间表达：模型看到的时间必须是人话，不是一串要自己算的日期。
//
// 记忆、短期窗口、承诺和章节里存的是时间戳；直接给模型“11-05 22:30”，
// 它要先跟现在做一次日期减法，跨午夜时经常算成“刚才”。这里统一换成
// “今天 09:18 / 昨天 22:30 / 3 天前 / 10月29日”这样的说法，并给出一段
// 当前时间和上次说话的间隔；跨过一夜时明确说出来。

const DAY_MS = 86_400_000
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

function pad(value) {
  return String(value).padStart(2, '0')
}

function valid(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

/**
 * 本机时区里这一天的零点。
 * @param {number} value - 毫秒时间戳。
 * @returns {number} 当天零点的时间戳。
 */
export function startOfLocalDay(value) {
  const date = new Date(valid(value) || Date.now())
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * 两个时间相隔几个本机日历日；只看日期，不看钟点。
 * @param {number} at - 较早的时间戳。
 * @param {number} [now] - 现在的时间戳。
 * @returns {number} 0 表示同一天，1 表示昨天，以此类推；未来时间返回 0。
 */
export function dayDistance(at, now = Date.now()) {
  const from = valid(at)
  if (from === 0) return 0
  const diff = Math.round((startOfLocalDay(now) - startOfLocalDay(from)) / DAY_MS)
  return Math.max(0, diff)
}

/**
 * 一天里的粗时段，用来决定“早上好”还是“晚上好”。
 * @param {number} [now] - 毫秒时间戳。
 * @returns {string} 凌晨、早上、上午、中午、下午、晚上或深夜。
 */
export function partOfDay(now = Date.now()) {
  const hour = new Date(now).getHours()
  if (hour < 5) return '凌晨'
  if (hour < 9) return '早上'
  if (hour < 12) return '上午'
  if (hour < 14) return '中午'
  if (hour < 18) return '下午'
  if (hour < 23) return '晚上'
  return '深夜'
}

/**
 * 当前时间的完整说法。
 * @param {number} [now] - 毫秒时间戳。
 * @returns {string} 例如 `2026-11-06 星期五 15:30（下午，本机时间）`。
 */
export function nowText(now = Date.now()) {
  const date = new Date(now)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} 星期${WEEKDAYS[date.getDay()]} ${pad(date.getHours())}:${pad(date.getMinutes())}（${partOfDay(now)}，本机时间）`
}

/**
 * 只到“哪一天”的说法，用在章节目录这类日粒度的位置。
 * @param {number} at - 毫秒时间戳。
 * @param {number} [now] - 现在的时间戳。
 * @returns {string} 今天、昨天、前天、N 天前、上周X 或具体日期。
 */
export function dayText(at, now = Date.now()) {
  const stamp = valid(at)
  if (stamp === 0) return '时间不详'
  const diff = dayDistance(stamp, now)
  if (diff === 0) return '今天'
  if (diff === 1) return '昨天'
  if (diff === 2) return '前天'
  if (diff <= 6) return `${diff} 天前`
  const date = new Date(stamp)
  if (diff <= 13) return `上周${WEEKDAYS[date.getDay()]}`
  const nowDate = new Date(now)
  const monthDay = `${date.getMonth() + 1}月${date.getDate()}日`
  return date.getFullYear() === nowDate.getFullYear() ? monthDay : `${date.getFullYear()}年${monthDay}`
}

/**
 * 一条记忆或一句话的发生时间。相对日期在前，钟点在后。
 * @param {number} at - 毫秒时间戳。
 * @param {number} [now] - 现在的时间戳。
 * @returns {string} 例如 `昨天 22:30`；无效时间返回“时间不详”。
 */
export function whenText(at, now = Date.now()) {
  const stamp = valid(at)
  if (stamp === 0) return '时间不详'
  const date = new Date(stamp)
  const day = dayText(stamp, now)
  return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 从某个时间到现在的间隔，给“上次说话”用。
 * @param {number} at - 较早的时间戳。
 * @param {number} [now] - 现在的时间戳。
 * @returns {string} 刚刚、N 分钟、N 小时 M 分钟或 N 天。
 */
export function gapText(at, now = Date.now()) {
  const stamp = valid(at)
  if (stamp === 0) return ''
  const ms = Math.max(0, Number(now) - stamp)
  if (ms < 60_000) return '刚刚'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours < 24) return rest > 0 ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`
  return `${dayDistance(stamp, now)} 天`
}

/**
 * 跨日说明：同一场对话被一夜或几天打断时，提醒她这是新的一天。
 * @param {number} at - 上一次说话的时间戳。
 * @param {number} [now] - 现在的时间戳。
 * @returns {string} 中间隔了一夜、中间隔了 N 天；同一天返回空串。
 */
export function dayGapText(at, now = Date.now()) {
  const diff = dayDistance(at, now)
  if (diff === 0) return ''
  return diff === 1 ? '中间隔了一夜' : `中间隔了 ${diff} 天`
}

/**
 * 给余额、备份这类“多久以前读到”的位置用的短说法。
 * @param {number} at - 毫秒时间戳。
 * @param {number} [now] - 现在的时间戳。
 * @returns {string} 刚刚、N 分钟前、N 小时前、N 天前或具体日期。
 */
export function ageText(at, now = Date.now()) {
  const stamp = valid(at)
  if (stamp === 0) return '时间不详'
  const ms = Math.max(0, Number(now) - stamp)
  if (ms < 60_000) return '刚刚'
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} 分钟前`
  if (ms < DAY_MS) return `${Math.round(ms / 3_600_000)} 小时前`
  const days = dayDistance(stamp, now)
  if (days <= 30) return `${Math.max(1, days)} 天前`
  return whenText(stamp, now)
}
