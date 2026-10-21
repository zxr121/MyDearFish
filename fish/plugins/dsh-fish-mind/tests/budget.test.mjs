import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_PRICE,
  costOfUsage,
  estimateInputTokens,
  estimateRequestCost,
  localDay,
  normalizePrice,
  openBudget,
  resolvePrice,
} from '../lib/budget.js'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'fish-mind-budget-'))
}

function clockAt(dayOffset = 0) {
  return new Date(2026, 9, 21 + dayOffset, 12, 0, 0).getTime()
}

function baseConfig(overrides = {}) {
  return {
    enabled: true,
    inject: true,
    prices: {},
    defaultPrice: { ...DEFAULT_PRICE },
    defaultMaxOutputTokens: 8192,
    balanceRefreshMinutes: 15,
    ...overrides,
  }
}

function readLedger(dir) {
  return readFileSync(join(dir, 'budget-ledger.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

test('出生就有 ¥10，账本写一条 birth', () => {
  const dir = tempDir()
  const clock = clockAt()
  const budget = openBudget({ dir, config: baseConfig(), now: () => clock })
  const status = budget.status()
  assert.equal(status.dailyGrantCny, 10)
  assert.equal(status.walletCny, 10)
  assert.equal(status.availableCny, 10)
  assert.equal(status.createdAtDay, localDay(clock))
  assert.equal(status.spentTodayCny, 0)
  assert.equal(status.callsToday, 0)
  assert.equal(budget.dailyGrantCny(), 10)

  const birth = readLedger(dir).find((entry) => entry.reason === 'birth')
  assert.ok(birth)
  assert.equal(birth.type, 'grant')
  assert.equal(birth.amountCny, 10)
  assert.equal(birth.walletAfterCny, 10)
})

test('同一天重开不重复发钱，花掉的还在', () => {
  const dir = tempDir()
  const clock = clockAt()
  const first = openBudget({ dir, config: baseConfig(), now: () => clock })
  const reservation = first.reserve({ provider: 'p', model: 'm', maxTokens: 8 }).reservation
  first.settle(reservation, { inputTokens: 100_000, outputTokens: 100_000 })
  assert.equal(first.status().walletCny, 8)

  const second = openBudget({ dir, config: baseConfig(), now: () => clock })
  const status = second.status()
  assert.equal(status.walletCny, 8)
  assert.equal(status.spentTodayCny, 2)
  assert.equal(status.callsToday, 1)
})

test('隔天自动累计，跳过的日子也补', () => {
  const dir = tempDir()
  let clock = clockAt()
  const budget = openBudget({ dir, config: baseConfig(), now: () => clock })

  clock = clockAt(3)
  assert.equal(budget.status().walletCny, 40)
  assert.equal(budget.status().lastGrantDay, localDay(clock))

  const grant = readLedger(dir).filter((entry) => entry.type === 'grant').at(-1)
  assert.equal(grant.days, 3)
  assert.equal(grant.amountCny, 30)
  assert.equal(grant.walletAfterCny, 40)
})

test('日期倒退不发钱', () => {
  const dir = tempDir()
  let clock = clockAt()
  const lines = []
  const budget = openBudget({ dir, config: baseConfig(), now: () => clock, diag: (line) => lines.push(line) })

  clock = clockAt(2)
  assert.equal(budget.status().walletCny, 30)
  clock = clockAt(1)
  assert.equal(budget.status().walletCny, 30)
  assert.equal(budget.status().lastGrantDay, localDay(clockAt(2)))
  assert.ok(lines.some((line) => line.includes('退到')))
})

test('每天额度改不了：配置里写多少都不影响出生额度', () => {
  const dir = tempDir()
  let clock = clockAt()
  const budget = openBudget({
    dir,
    config: baseConfig({ dailyGrantCny: 9999 }),
    now: () => clock,
  })
  assert.equal(budget.dailyGrantCny(), 10)
  clock = clockAt(1)
  assert.equal(budget.status().walletCny, 20)
})

test('budget.json 坏了按重新出生处理，发 ¥10 而不是继承坏档', () => {
  const dir = tempDir()
  writeFileSync(join(dir, 'budget.json'), '{ 这不是 JSON', 'utf8')
  const lines = []
  const budget = openBudget({ dir, config: baseConfig(), now: () => clockAt(), diag: (line) => lines.push(line) })
  assert.equal(budget.status().walletCny, 10)
  assert.ok(lines.some((line) => line.includes('重新记账')))
  assert.equal(readLedger(dir).at(-1).reason, 'reset')
})

test('预留-结算：按实际用量扣钱，没拿到用量也记一次', () => {
  const dir = tempDir()
  const clock = clockAt()
  const budget = openBudget({ dir, config: baseConfig(), now: () => clock })

  const options = { provider: 'p', model: 'm', messages: [{ role: 'user', content: '你好' }], maxTokens: 8 }
  const reserved = budget.reserve(options)
  assert.equal(reserved.ok, true)
  assert.ok(reserved.reservation.estimatedCny > 0)
  assert.ok(reserved.reservation.estimatedCny < 10)

  const settled = budget.settle(reserved.reservation, { inputTokens: 100_000, outputTokens: 100_000 })
  assert.equal(settled.costCny, 2)
  let status = budget.status()
  assert.equal(status.walletCny, 8)
  assert.equal(status.spentTodayCny, 2)
  assert.equal(status.callsToday, 1)
  assert.equal(status.unmeteredToday, 0)

  budget.settle(reserved.reservation, null, 'stream failed')
  status = budget.status()
  assert.equal(status.walletCny, 8)
  assert.equal(status.callsToday, 2)
  assert.equal(status.unmeteredToday, 1)
  assert.equal(readLedger(dir).at(-1).error, 'stream failed')
})

test('余额不够就不发预留，并记一条 blocked', () => {
  const dir = tempDir()
  const clock = clockAt()
  const budget = openBudget({ dir, config: baseConfig(), now: () => clock })
  const reservation = budget.reserve({ provider: 'p', model: 'm', maxTokens: 8 }).reservation
  budget.settle(reservation, { outputTokens: 10_000_000 })
  assert.equal(budget.status().walletCny, -150)

  const blocked = budget.reserve({ provider: 'p', model: 'm', maxTokens: 128 })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.reason, 'insufficient')
  assert.equal(blocked.walletCny, -150)
  assert.ok(blocked.neededCny > 0)
  assert.equal(readLedger(dir).at(-1).type, 'blocked')
})

test('价格按 provider/model → model → provider → 默认价找', () => {
  const fallback = { input: 9, cacheRead: 9, cacheWrite: 9, output: 9, reasoning: 9 }
  assert.deepEqual(
    resolvePrice({ 'p/m': { input: 1 } }, fallback, 'p', 'm'),
    { input: 1, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 },
  )
  assert.deepEqual(
    resolvePrice({ m: { input: 2 } }, fallback, 'p', 'm'),
    { input: 2, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 },
  )
  assert.deepEqual(
    resolvePrice({ p: { input: 3 } }, fallback, 'p', 'm'),
    { input: 3, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 },
  )
  assert.deepEqual(resolvePrice({}, fallback, 'p', 'm'), fallback)
})

test('价格归一：缺项补 0，负数和垃圾值不收', () => {
  assert.equal(normalizePrice(null), null)
  assert.deepEqual(
    normalizePrice({ input: '3', cacheRead: -1, cacheWrite: 'x', output: 4 }),
    { input: 3, cacheRead: 0, cacheWrite: 0, output: 4, reasoning: 0 },
  )
})

test('输入估算：中文一字一 token，英文 3.5 字符一 token', () => {
  assert.equal(estimateInputTokens({ messages: [{ role: 'user', content: '你好' }] }), 274)
  assert.equal(estimateInputTokens({ messages: [{ role: 'user', content: 'abcdefg' }] }), 274)
  assert.equal(estimateInputTokens({ system: '你好', messages: [] }), 258)
})

test('请求预估按 maxTokens 上限算输出，没写就用默认上限', () => {
  const options = { messages: [{ role: 'user', content: '你好' }], maxTokens: 100 }
  assert.equal(estimateRequestCost(options, DEFAULT_PRICE, 8192), 0.002696)
  assert.equal(estimateRequestCost({ messages: [] }, DEFAULT_PRICE, 8192), 0.132096)
})

test('实际成本：缓存读写分开计价，reasoning 默认不重复收钱', () => {
  assert.equal(costOfUsage({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, DEFAULT_PRICE), 20)
  assert.equal(
    costOfUsage({ cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000, reasoningTokens: 1_000_000 }, DEFAULT_PRICE),
    5,
  )
  assert.equal(costOfUsage(null, DEFAULT_PRICE), 0)
})

test('账户余额只认合法钱包，读失败不覆盖上一次成功值', () => {
  const dir = tempDir()
  const budget = openBudget({ dir, config: baseConfig(), now: () => clockAt() })

  budget.recordBalance({
    status: 'ready',
    value: [{ currency: 'CNY', balance: '123.45' }],
    bonusWallets: [{ currency: 'CNY', balance: '5.00' }],
  })
  let status = budget.status()
  assert.deepEqual(status.account.wallets, [{ currency: 'CNY', balance: '123.45' }])
  assert.deepEqual(status.account.bonusWallets, [{ currency: 'CNY', balance: '5.00' }])
  assert.equal(status.accountAttempt.ok, true)

  budget.recordBalance({ status: 'ready', value: [{ currency: 'BTC', balance: '1' }], bonusWallets: [] })
  status = budget.status()
  assert.deepEqual(status.account.wallets, [{ currency: 'CNY', balance: '123.45' }])
  assert.equal(status.accountAttempt.ok, false)
  assert.equal(status.accountAttempt.error, 'no-wallet')

  budget.recordBalanceError(new Error('network down'))
  assert.equal(budget.status().accountAttempt.error, 'network down')

  budget.recordBalance({ status: 'failed' })
  status = budget.status()
  assert.equal(status.accountAttempt.ok, false)
  assert.equal(status.accountAttempt.error, 'unavailable')
})

test('对外脱敏：带额度/余额的句子整句换掉，精确金额也换掉', () => {
  const dir = tempDir()
  const clock = clockAt()
  const budget = openBudget({ dir, config: baseConfig(), now: () => clock })

  assert.equal(budget.redactOutbound('你好呀，今天风很大。').hits, 0)
  assert.equal(
    budget.redactOutbound('我今天的额度还剩 8.00 块，账户余额 123.45 元。').text,
    '（这个我不方便说）。',
  )
  assert.equal(budget.redactOutbound('今天很开心。我的余额不多了。').text, '今天很开心。（这个我不方便说）。')
  assert.equal(budget.redactOutbound('我看了 10.00 块的电影').text, '我看了 10.00 块的电影')

  const reservation = budget.reserve({ provider: 'p', model: 'm', maxTokens: 8 }).reservation
  budget.settle(reservation, { outputTokens: 500_000 })
  assert.equal(budget.status().walletCny, 2)

  const privateAmount = budget.redactOutbound('听说 2.00 这个数很特别')
  assert.equal(privateAmount.text, '听说 [金额已隐去] 这个数很特别')
  assert.deepEqual(privateAmount.reasons, ['private-amount'])

  // 没有「余额」这种词，但第一人称 + 剩余金额，同样算私密。
  const poor = budget.redactOutbound('我只剩 2 块钱了')
  assert.equal(poor.text, '（这个我不方便说）')
  assert.ok(poor.hits > 0)
})

test('对外脱敏：正常谈钱不误伤，非字符串返回空', () => {
  const dir = tempDir()
  const budget = openBudget({ dir, config: baseConfig(), now: () => clockAt() })
  assert.equal(budget.redactOutbound('今天看了个视频，讲了 10 块钱怎么花。').text, '今天看了个视频，讲了 10 块钱怎么花。')
  assert.deepEqual(budget.redactOutbound(null), { text: '', hits: 0, reasons: [] })
})

test('账本关着时一律放行，不记账', () => {
  const dir = tempDir()
  const budget = openBudget({ dir, config: baseConfig({ enabled: false }), now: () => clockAt() })
  assert.equal(budget.reserve({ provider: 'p', model: 'm' }).disabled, true)
  assert.equal(budget.canAfford(9999), true)
  assert.equal(budget.status().callsToday, 0)
})

test('setConfig 只换价格和开关，不动已发的钱', () => {
  const dir = tempDir()
  const budget = openBudget({ dir, config: baseConfig(), now: () => clockAt() })
  budget.setConfig(baseConfig({ enabled: false, defaultPrice: { input: 100, output: 100 } }))
  assert.equal(budget.isEnabled(), false)
  assert.equal(budget.status().walletCny, 10)
  budget.setConfig(baseConfig())
  assert.equal(budget.isEnabled(), true)
})
