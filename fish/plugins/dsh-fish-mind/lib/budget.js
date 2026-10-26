// 大肥鱼的私密零花钱账本。
//
// 规矩是主人定的：
//   · 每天 ¥10 起步，用不完自动累计；主人在设置页「零花钱」里改每日额度，对话、工具和配置热加载都改不了。
//   · 每一次模型调用都算花钱：说话、思考、判断心情、刷 B 站、压缩上下文，全部经过 llm/stream 结算。
//   · 账户余额只给她自己看；对外通道（QQ、B 站评论/私信）在代码层再做一道脱敏。
//
// 价格是估算：仓库里没有文本 token 价目表，中转 provider 的价格也各不相同。
// DEFAULT_PRICE 故意取得偏高，宁可提前停，也不要把主人的钱花超；按路由配好官方价后，
// 可以用 offPeak / peakHours / peakDays 描述峰谷日程，让账本对上真实账单。

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const BIRTH_DAILY_GRANT_CNY = 10
export const MAX_DAILY_GRANT_CNY = 10000
// B 站巡检最多占当天每日额度的四分之一；这是软上限，普通聊天不受影响。
export const DEFAULT_BILI_SHARE = 0.25
export const DEFAULT_PRICE = Object.freeze({ input: 4, cacheRead: 1, cacheWrite: 4, output: 16, reasoning: 0 })

const PRICE_KEYS = ['input', 'cacheRead', 'cacheWrite', 'output', 'reasoning']
const PER_MILLION = 1_000_000
const DAY_MS = 86_400_000
const BUDGET_WORDS = /余额|额度|预算|账本|小金库|零花钱|钱包|账户|充值|欠费|限额|模型费|调用费/i
// 没有「余额」这种词，但“我只剩 8 块”同样是在说自己有多少钱；宁可误伤一句，也不漏出去。
const PRIVATE_MONEY = /(?:只剩|剩下|剩|还有|只有|仅有|不到|花完|用完|没(?:钱|额度)|欠(?:费)?)[^。！？!?\n]{0,12}(?:[¥￥]\s*\d|\d[\d,.]*\s*(?:元|块(?:钱)?|人民币|CNY)|[零一二两三四五六七八九十百千万亿点]+\s*(?:元|块(?:钱)?))/
const CURRENCY_AMOUNT = /[¥￥]\s*\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s*(?:元|块(?:钱)?|人民币|CNY)/gi
const CHINESE_AMOUNT = /[零一二两三四五六七八九十百千万亿点]+\s*(?:元|块(?:钱)?)/g

/** 本地日历日，按用户所在时区算，不用 UTC。 */
export function localDay(now = Date.now()) {
  const date = new Date(now)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dayNumber(day) {
  const value = Date.parse(`${day}T00:00:00Z`)
  return Number.isFinite(value) ? Math.floor(value / DAY_MS) : null
}

function round(value, digits = 6) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 把一份价格表归一成五个非负数字；不是对象就返回 null。 */
export function normalizePrice(raw) {
  if (!isPlainObject(raw)) return null
  const price = {}
  for (const key of PRICE_KEYS) {
    const value = Number(raw[key])
    price[key] = Number.isFinite(value) && value >= 0 ? value : 0
  }
  return price
}

function flatPrice(price) {
  const flat = {}
  for (const key of PRICE_KEYS) flat[key] = price[key]
  return flat
}

/** 把 `[[9,12],[14,18]]` 归一成按起点排序的小时区间；空、越界或倒序都返回 null。 */
export function normalizePeakHours(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const ranges = []
  for (const item of raw) {
    if (!Array.isArray(item) || item.length !== 2) return null
    const start = Number(item[0])
    const end = Number(item[1])
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null
    if (start < 0 || end > 24 || start >= end) return null
    ranges.push([start, end])
  }
  return ranges.sort((a, b) => a[0] - b[0])
}

/** 高峰日按 0=周日 … 6=周六；不写就是每天，写错就是没有日程。 */
export function normalizePeakDays(raw) {
  if (raw === undefined) return [0, 1, 2, 3, 4, 5, 6]
  if (!Array.isArray(raw) || raw.length === 0) return null
  const days = new Set()
  for (const item of raw) {
    const day = Number(item)
    if (!Number.isInteger(day) || day < 0 || day > 6) return null
    days.add(day)
  }
  return [...days].sort((a, b) => a - b)
}

/**
 * 归一一条价格：基础五项是高峰价，`offPeak`、`peakHours`、`peakDays` 是可选日程。
 * 日程缺项或非法就丢掉日程、只留基础价——宁可按高峰高估，也不要漏算。
 */
export function normalizePriceEntry(raw) {
  if (!isPlainObject(raw)) return null
  const price = normalizePrice(raw)
  if (price === null) return null
  const offPeak = normalizePrice(raw.offPeak)
  const peakHours = normalizePeakHours(raw.peakHours)
  const peakDays = normalizePeakDays(raw.peakDays)
  if (offPeak === null || peakHours === null || peakDays === null) return price
  return { ...price, offPeak, peakHours, peakDays }
}

function isPeakAt(at, entry) {
  const date = new Date(at)
  if (!entry.peakDays.includes(date.getDay())) return false
  const hour = date.getHours() + date.getMinutes() / 60
  return entry.peakHours.some(([start, end]) => hour >= start && hour < end)
}

/**
 * 找这次调用该用哪档价：`provider/model` → `model` → `provider` → 默认价。
 * 配了完整峰谷日程的路由，按 `at` 所在的本地时间选高峰价或谷时价。
 * @param {object} prices - 配置里的 `budget.prices`。
 * @param {object} fallback - 配置里的 `budget.defaultPrice`。
 * @param {string} provider - provider 路由名。
 * @param {string} model - 模型名。
 * @param {number} [at] - 判断高峰用的时间戳，默认当前时间。
 * @returns {{input:number,cacheRead:number,cacheWrite:number,output:number,reasoning:number}} 每百万 token 的人民币价。
 */
export function resolvePrice(prices, fallback, provider, model, at = Date.now()) {
  const table = isPlainObject(prices) ? prices : {}
  for (const key of [`${provider}/${model}`, model, provider]) {
    if (typeof key !== 'string' || key === '') continue
    const entry = normalizePriceEntry(table[key])
    if (entry === null) continue
    if (entry.offPeak !== undefined) {
      return flatPrice(isPeakAt(at, entry) ? entry : entry.offPeak)
    }
    return flatPrice(entry)
  }
  return normalizePrice(fallback) || { ...DEFAULT_PRICE }
}

function textOfContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (!block) continue
    if (typeof block === 'string') parts.push(block)
    else if (typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

function estimateTextTokens(text) {
  if (typeof text !== 'string' || text === '') return 0
  let cjk = 0
  for (const char of text) {
    const code = char.codePointAt(0)
    if (
      (code >= 0x3400 && code <= 0x9fff)
      || (code >= 0x3040 && code <= 0x30ff)
      || (code >= 0xac00 && code <= 0xd7af)
      || (code >= 0xf900 && code <= 0xfaff)
    ) cjk += 1
  }
  const other = Math.max(0, text.length - cjk)
  return Math.ceil(cjk + other / 3.5)
}

/**
 * 粗估一次请求的输入 token。宁可偏高：中文按一字一 token，英文按 3.5 字符一 token。
 * @param {object} options - `GenerateOptions`。
 * @returns {number} 估算输入 token。
 */
export function estimateInputTokens(options) {
  try {
    let tokens = 256
    tokens += estimateTextTokens(options && options.system)
    const messages = options && Array.isArray(options.messages) ? options.messages : []
    for (const message of messages) {
      tokens += 16
      tokens += estimateTextTokens(textOfContent(message && message.content))
    }
    if (options && Array.isArray(options.tools) && options.tools.length > 0) {
      tokens += estimateTextTokens(JSON.stringify(options.tools))
    }
    if (options && options.toolHistory !== undefined) {
      tokens += estimateTextTokens(JSON.stringify(options.toolHistory))
    }
    return tokens
  } catch {
    return 4096
  }
}

/**
 * 一次调用最坏能花多少：输入按未命中缓存算，输出按 maxTokens 上限算。
 * @param {object} options - `GenerateOptions`。
 * @param {object} price - 每百万 token 价。
 * @param {number} defaultMaxOutputTokens - 请求没写 maxTokens 时的保守上限。
 * @returns {number} 估算人民币。
 */
export function estimateRequestCost(options, price, defaultMaxOutputTokens = 8192) {
  const input = estimateInputTokens(options)
  const configured = Number(options && options.maxTokens)
  const output = Number.isFinite(configured) && configured > 0 ? configured : defaultMaxOutputTokens
  return (input * price.input + output * price.output) / PER_MILLION
}

/** 按 usage 算实际成本；缓存 token 用缓存价，reasoning 默认不重复计费。 */
export function costOfUsage(usage, price) {
  if (!usage || typeof usage !== 'object') return 0
  const input = Math.max(0, Number(usage.inputTokens) || 0)
  const cacheRead = Math.max(0, Number(usage.cacheReadTokens) || 0)
  const cacheWrite = Math.max(0, Number(usage.cacheWriteTokens) || 0)
  const output = Math.max(0, Number(usage.outputTokens) || 0)
  const reasoning = Math.max(0, Number(usage.reasoningTokens) || 0)
  return (
    input * price.input
    + cacheRead * price.cacheRead
    + cacheWrite * price.cacheWrite
    + output * price.output
    + reasoning * price.reasoning
  ) / PER_MILLION
}

function normalizeWallet(value) {
  if (!isPlainObject(value)) return null
  const currency = value.currency === 'CNY' || value.currency === 'USD' ? value.currency : ''
  const balance = typeof value.balance === 'string' ? value.balance.trim() : ''
  if (currency === '' || !/^\d+(?:\.\d+)?$/.test(balance)) return null
  return { currency, balance }
}

function decimals(value) {
  const text = String(value)
  return text.includes('.') ? text.split('.')[1].length : 0
}

function blankState(today, at = Date.now()) {
  return {
    version: 1,
    createdAt: new Date(at).toISOString(),
    createdAtDay: today,
    dailyGrantCny: BIRTH_DAILY_GRANT_CNY,
    walletCny: BIRTH_DAILY_GRANT_CNY,
    lastGrantDay: today,
    days: {},
    lastBalance: null,
    lastBalanceAttempt: null,
  }
}

function normalizeState(raw, today) {
  const state = blankState(today)
  if (!isPlainObject(raw)) return state
  state.createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : state.createdAt
  state.createdAtDay = typeof raw.createdAtDay === 'string' && dayNumber(raw.createdAtDay) !== null ? raw.createdAtDay : today
  const grant = Number(raw.dailyGrantCny)
  state.dailyGrantCny = Number.isFinite(grant) && grant >= 0 ? round(grant, 6) : BIRTH_DAILY_GRANT_CNY
  const wallet = Number(raw.walletCny)
  state.walletCny = Number.isFinite(wallet) ? round(wallet, 6) : state.dailyGrantCny
  state.lastGrantDay = typeof raw.lastGrantDay === 'string' && dayNumber(raw.lastGrantDay) !== null
    ? raw.lastGrantDay
    : today
  if (isPlainObject(raw.days)) {
    for (const [day, value] of Object.entries(raw.days)) {
      if (dayNumber(day) === null || !isPlainObject(value)) continue
      state.days[day] = {
        spentCny: round(Math.max(0, Number(value.spentCny) || 0), 6),
        calls: Math.max(0, Math.round(Number(value.calls) || 0)),
        unmetered: Math.max(0, Math.round(Number(value.unmetered) || 0)),
        biliSpentCny: round(Math.max(0, Number(value.biliSpentCny) || 0), 6),
        biliCalls: Math.max(0, Math.round(Number(value.biliCalls) || 0)),
      }
    }
  }
  if (isPlainObject(raw.lastBalance) && Array.isArray(raw.lastBalance.wallets)) {
    const wallets = raw.lastBalance.wallets.map(normalizeWallet).filter(Boolean)
    const bonusWallets = Array.isArray(raw.lastBalance.bonusWallets)
      ? raw.lastBalance.bonusWallets.map(normalizeWallet).filter(Boolean)
      : []
    if (wallets.length > 0 || bonusWallets.length > 0) {
      state.lastBalance = {
        at: Number(raw.lastBalance.at) || 0,
        wallets,
        bonusWallets,
      }
    }
  }
  if (isPlainObject(raw.lastBalanceAttempt)) {
    state.lastBalanceAttempt = {
      at: Number(raw.lastBalanceAttempt.at) || 0,
      ok: raw.lastBalanceAttempt.ok === true,
      error: typeof raw.lastBalanceAttempt.error === 'string' ? raw.lastBalanceAttempt.error.slice(0, 200) : '',
    }
  }
  return state
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 去掉句子里带钱的数字；只在确认整段在谈钱时调用。 */
function scrubAmounts(text) {
  return text
    .replace(CURRENCY_AMOUNT, '[金额已隐去]')
    .replace(CHINESE_AMOUNT, '[金额已隐去]')
}

/**
 * 打开账本。状态常驻内存、同步落盘，避免并发模型调用把余额改乱。
 * @param {object} options - `{ dir, config, diag, now }`。
 * @returns {object} 账本读写接口。
 */
export function openBudget({ dir, config, diag = () => {}, now = Date.now }) {
  mkdirSync(dir, { recursive: true })
  const statePath = join(dir, 'budget.json')
  const ledgerPath = join(dir, 'budget-ledger.jsonl')
  let currentConfig = config && isPlainObject(config) ? config : {}
  let persistError = ''

  const today = localDay(now())
  const existed = existsSync(statePath)
  let reset = !existed
  let state
  try {
    state = normalizeState(JSON.parse(readFileSync(statePath, 'utf8')), today)
  } catch (error) {
    if (existed) diag(`budget: budget.json 读不了（${String((error && error.message) || error)}），按新出生重新记账`)
    state = blankState(today, now())
    reset = true
  }

  function persist() {
    try {
      const temp = `${statePath}.tmp`
      writeFileSync(temp, JSON.stringify(state, null, 2) + '\n', 'utf8')
      renameSync(temp, statePath)
      persistError = ''
    } catch (error) {
      persistError = String((error && error.message) || error)
      diag(`budget: 写不了 ${statePath}（${persistError}）`)
    }
  }

  function ledger(entry) {
    try {
      appendFileSync(ledgerPath, JSON.stringify(entry) + '\n', 'utf8')
    } catch (error) {
      diag(`budget: 写不了账本（${String((error && error.message) || error)}）`)
    }
  }

  function ensureGrant() {
    const day = localDay(now())
    if (state.lastGrantDay === day) return 0
    const from = dayNumber(state.lastGrantDay)
    const to = dayNumber(day)
    if (from === null || to === null) return 0
    if (to < from) {
      diag(`budget: 系统日期从 ${state.lastGrantDay} 退到 ${day}，这次不发钱`)
      return 0
    }
    const days = to - from
    if (days <= 0) return 0
    const amount = round(state.dailyGrantCny * days, 6)
    state.walletCny = round(state.walletCny + amount, 6)
    state.lastGrantDay = day
    state.createdAtDay = state.createdAtDay || day
    persist()
    ledger({ type: 'grant', at: now(), day, days, amountCny: amount, walletAfterCny: state.walletCny })
    return amount
  }

  function isEnabled() {
    return currentConfig.enabled !== false
  }

  function priceFor(provider, model) {
    return resolvePrice(currentConfig.prices, currentConfig.defaultPrice, provider, model, now())
  }

  function biliShare() {
    const value = Number(currentConfig.biliShare)
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULT_BILI_SHARE
  }

  function biliCapCny() {
    return round(state.dailyGrantCny * biliShare(), 6)
  }

  /**
   * 主人改每日额度。当天已发过的额度按差额补进或扣回余额，余额不会因此变成负数；
   * 已经花掉的部分不追回。
   * @param {number|string} value - 新额度（元）。
   * @returns {{changed:boolean, dailyGrantCny:number, previousCny:number, adjustedCny:number}}
   */
  function setDailyGrantCny(value) {
    const raw = typeof value === 'number' ? value : typeof value === 'string' ? value.trim() : NaN
    const amount = raw === '' ? NaN : Number(raw)
    if (!Number.isFinite(amount) || amount < 0 || amount > MAX_DAILY_GRANT_CNY) {
      const error = new Error(`每天额度必须是 0 到 ${MAX_DAILY_GRANT_CNY} 元之间的数字`)
      error.statusCode = 400
      throw error
    }
    const next = round(amount, 2)
    ensureGrant()
    const previous = state.dailyGrantCny
    if (next === previous) {
      return { changed: false, dailyGrantCny: next, previousCny: previous, adjustedCny: 0 }
    }
    const before = state.walletCny
    state.dailyGrantCny = next
    state.walletCny = round(Math.max(0, state.walletCny + next - previous), 6)
    persist()
    const adjustedCny = round(state.walletCny - before, 6)
    ledger({
      type: 'grant-change',
      at: now(),
      fromCny: previous,
      toCny: next,
      adjustedCny,
      walletAfterCny: state.walletCny,
    })
    return { changed: true, dailyGrantCny: next, previousCny: previous, adjustedCny }
  }

  function status() {
    ensureGrant()
    const day = localDay(now())
    const bucket = state.days[day] || { spentCny: 0, calls: 0, unmetered: 0, biliSpentCny: 0, biliCalls: 0 }
    const balance = state.lastBalance
    const biliSpent = round(Math.max(0, Number(bucket.biliSpentCny) || 0), 6)
    const cap = biliCapCny()
    return {
      version: 1,
      enabled: isEnabled(),
      createdAtDay: state.createdAtDay,
      dailyGrantCny: round(state.dailyGrantCny, 4),
      dailyGrantMaxCny: MAX_DAILY_GRANT_CNY,
      walletCny: round(state.walletCny, 4),
      availableCny: round(Math.max(0, state.walletCny), 4),
      spentTodayCny: round(bucket.spentCny, 4),
      callsToday: bucket.calls,
      unmeteredToday: bucket.unmetered,
      bili: {
        share: round(biliShare(), 4),
        capCny: round(cap, 4),
        spentTodayCny: round(biliSpent, 4),
        remainingCny: round(Math.max(0, cap - biliSpent), 4),
        callsToday: Math.max(0, Math.round(Number(bucket.biliCalls) || 0)),
      },
      lastGrantDay: state.lastGrantDay,
      account: balance === null
        ? null
        : {
          at: balance.at,
          wallets: balance.wallets.map((wallet) => ({ ...wallet })),
          bonusWallets: balance.bonusWallets.map((wallet) => ({ ...wallet })),
        },
      accountAttempt: state.lastBalanceAttempt === null ? null : { ...state.lastBalanceAttempt },
      paths: { state: statePath, ledger: ledgerPath },
      persistError: persistError || undefined,
    }
  }

  /**
   * 调用前预留。余额不够，或这次属于 B 站巡检且已到巡检上限，就返回 `ok:false`，
   * 调用方不得再请求模型。
   * @param {object} options - `GenerateOptions`。
   * @param {'bili'|''} [scope] - 预算归属；`bili` 表示巡检触发及其子代理。
   * @returns {{ok:boolean, reason?:string, walletCny?:number, neededCny?:number, capCny?:number, spentCny?:number, reservation?:object, disabled?:boolean}}
   */
  function reserve(options, scope = '') {
    if (!isEnabled()) return { ok: true, disabled: true }
    ensureGrant()
    const provider = String(options && options.provider ? options.provider : '')
    const model = String(options && options.model ? options.model : '')
    const tag = scope === 'bili' ? 'bili' : ''
    const price = priceFor(provider, model)
    const defaultOutput = Math.max(1, Number(currentConfig.defaultMaxOutputTokens) || 8192)
    // 模型目录把 maxTokens 报到 25.6 万，按整段输出预留会把一次群聊估成四块多，
    // 实际只花一毛。预留只按默认上限封顶输出，结算仍按真实 usage。
    const requestedOutput = Number(options && options.maxTokens)
    const reserveOptions = Number.isFinite(requestedOutput) && requestedOutput > defaultOutput
      ? { ...options, maxTokens: defaultOutput }
      : options
    const estimatedCny = round(estimateRequestCost(reserveOptions, price, defaultOutput), 6)
    if (state.walletCny < estimatedCny) {
      ledger({
        type: 'blocked',
        at: now(),
        provider,
        model,
        purpose: options && options.purpose ? String(options.purpose) : '',
        scope: tag || undefined,
        walletCny: round(state.walletCny, 6),
        neededCny: estimatedCny,
      })
      return { ok: false, reason: 'insufficient', walletCny: round(state.walletCny, 4), neededCny: round(estimatedCny, 4) }
    }
    if (tag === 'bili') {
      const day = localDay(now())
      const bucket = state.days[day] || { spentCny: 0, calls: 0, unmetered: 0, biliSpentCny: 0, biliCalls: 0 }
      const cap = biliCapCny()
      const spent = round(Math.max(0, Number(bucket.biliSpentCny) || 0), 6)
      if (spent + estimatedCny > cap + 1e-9) {
        ledger({
          type: 'blocked',
          at: now(),
          provider,
          model,
          purpose: options && options.purpose ? String(options.purpose) : '',
          scope: 'bili',
          reason: 'bili-cap',
          capCny: cap,
          spentCny: spent,
          walletCny: round(state.walletCny, 6),
          neededCny: estimatedCny,
        })
        return {
          ok: false,
          reason: 'bili-cap',
          walletCny: round(state.walletCny, 4),
          neededCny: round(estimatedCny, 4),
          capCny: round(cap, 4),
          spentCny: round(spent, 4),
        }
      }
    }
    return {
      ok: true,
      reservation: {
        at: now(),
        provider,
        model,
        purpose: options && options.purpose ? String(options.purpose) : '',
        sessionId: options && options.sessionId ? String(options.sessionId) : '',
        scope: tag || undefined,
        estimatedCny,
        price,
      },
    }
  }

  /** 调用后按 usage 结算。没有 usage 也记一笔，方便知道有多少调用没计量到。 */
  function settle(reservation, usage, error) {
    if (!reservation || !isEnabled()) return { ok: true, costCny: 0 }
    const costCny = round(costOfUsage(usage, reservation.price), 6)
    const day = localDay(now())
    const bucket = state.days[day] || { spentCny: 0, calls: 0, unmetered: 0 }
    bucket.calls += 1
    if (usage === null || usage === undefined) bucket.unmetered += 1
    bucket.spentCny = round(bucket.spentCny + costCny, 6)
    if (reservation.scope === 'bili') {
      bucket.biliCalls = Math.max(0, Number(bucket.biliCalls) || 0) + 1
      bucket.biliSpentCny = round(Math.max(0, Number(bucket.biliSpentCny) || 0) + costCny, 6)
    }
    state.days[day] = bucket
    state.walletCny = round(state.walletCny - costCny, 6)
    persist()
    ledger({
      type: 'spend',
      at: now(),
      day,
      provider: reservation.provider,
      model: reservation.model,
      purpose: reservation.purpose,
      sessionId: reservation.sessionId,
      scope: reservation.scope,
      estimatedCny: reservation.estimatedCny,
      costCny,
      walletAfterCny: state.walletCny,
      usage: usage && typeof usage === 'object'
        ? {
          inputTokens: Number(usage.inputTokens) || 0,
          outputTokens: Number(usage.outputTokens) || 0,
          cacheReadTokens: Number(usage.cacheReadTokens) || 0,
          cacheWriteTokens: Number(usage.cacheWriteTokens) || 0,
          reasoningTokens: Number(usage.reasoningTokens) || 0,
          totalTokens: Number(usage.totalTokens) || 0,
        }
        : null,
      error: typeof error === 'string' ? error.slice(0, 200) : '',
    })
    return { ok: true, costCny }
  }

  /** 可选的花钱动作先问这里；账本关着时一律允许。 */
  function canAfford(cny) {
    if (!isEnabled()) return true
    ensureGrant()
    return state.walletCny >= Math.max(0, Number(cny) || 0)
  }

  function recordBalance(result) {
    const at = now()
    if (result === null || (isPlainObject(result) && result.status === 'failed')) {
      state.lastBalanceAttempt = { at, ok: false, error: 'unavailable' }
      persist()
      return
    }
    const wallets = isPlainObject(result) && Array.isArray(result.value)
      ? result.value.map(normalizeWallet).filter(Boolean)
      : []
    const bonusWallets = isPlainObject(result) && Array.isArray(result.bonusWallets)
      ? result.bonusWallets.map(normalizeWallet).filter(Boolean)
      : []
    if (!isPlainObject(result) || result.status !== 'ready' || wallets.length === 0) {
      state.lastBalanceAttempt = { at, ok: false, error: 'no-wallet' }
      persist()
      return
    }
    state.lastBalance = { at, wallets, bonusWallets }
    state.lastBalanceAttempt = { at, ok: true, error: '' }
    persist()
  }

  function recordBalanceError(error) {
    state.lastBalanceAttempt = {
      at: now(),
      ok: false,
      error: String((error && error.message) || error || 'error').slice(0, 200),
    }
    persist()
  }

  function knownAmounts() {
    const values = []
    values.push(state.walletCny.toFixed(2))
    const day = localDay(now())
    const bucket = state.days[day]
    if (bucket) values.push(bucket.spentCny.toFixed(2))
    if (state.lastBalance) {
      for (const wallet of [...state.lastBalance.wallets, ...state.lastBalance.bonusWallets]) {
        const value = Number(wallet.balance)
        if (Number.isFinite(value) && decimals(wallet.balance) >= 2) values.push(value.toFixed(2))
      }
    }
    return [...new Set(values)].filter((value) => value.length >= 4 && value !== '10.00' && value !== '0.00')
  }

  /**
   * 对外脱敏：QQ、B 站评论/私信、任何离开本机的内容都要先过这里。
   * 带“余额/额度/账本”等词的一整句直接删掉；其余句子清掉货币金额；
   * 即使没有这些词，只要出现了账本里精确到分的私密数字，也会被换掉。
   * 整条只剩私密内容时返回空串，调用方据此整条不发。
   * @param {string} text - 准备发出去的文本。
   * @returns {{text:string, hits:number, reasons:string[]}} 处理后的文本与命中原因。
   */
  function redactOutbound(text) {
    const source = typeof text === 'string' ? text : ''
    if (source === '') return { text: '', hits: 0, reasons: [] }
    const reasons = []
    const mentionsBudget = BUDGET_WORDS.test(source) || PRIVATE_MONEY.test(source)
    let hits = 0
    let output = source

    if (mentionsBudget) {
      hits += 1
      reasons.push('budget-word')
      const parts = output.split(/([。！？!?]+|\n+)/)
      let rebuilt = ''
      let dropped = false
      for (let index = 0; index < parts.length; index += 2) {
        const body = parts[index] || ''
        const delimiter = parts[index + 1] || ''
        if (BUDGET_WORDS.test(body) || PRIVATE_MONEY.test(body)) {
          dropped = true
          // 换行分隔必须留住，否则删掉中间一句会把前后两句粘成一句。
          if (delimiter.includes('\n')) rebuilt += '\n'
        } else {
          rebuilt += scrubAmounts(body) + delimiter
        }
      }
      output = dropped ? rebuilt.replace(/\n{2,}/g, '\n').trim() : rebuilt
    }

    for (const amount of knownAmounts()) {
      if (!output.includes(amount)) continue
      output = output.replace(new RegExp(escapeRegExp(amount), 'g'), '[金额已隐去]')
      hits += 1
      reasons.push('private-amount')
    }

    if (output !== source && hits > 0) output = output.replace(/[ \t]{2,}/g, ' ').trim()
    return { text: output, hits, reasons: [...new Set(reasons)] }
  }

  function setConfig(next) {
    currentConfig = next && isPlainObject(next) ? next : {}
  }

  if (reset) {
    persist()
    ledger({
      type: 'grant',
      at: now(),
      day: today,
      days: 1,
      amountCny: state.walletCny,
      walletAfterCny: state.walletCny,
      reason: existed ? 'reset' : 'birth',
    })
  }
  ensureGrant()

  return {
    statePath,
    ledgerPath,
    status,
    reserve,
    settle,
    canAfford,
    recordBalance,
    recordBalanceError,
    redactOutbound,
    setConfig,
    setDailyGrantCny,
    dailyGrantCny: () => state.dailyGrantCny,
    isEnabled,
  }
}
