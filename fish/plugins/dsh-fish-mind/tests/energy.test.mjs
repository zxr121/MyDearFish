import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_PRICE, openBudget } from '../lib/budget.js'
import { energyOf, isNight } from '../lib/energy.js'

const 中午 = new Date(2026, 9, 21, 12, 0, 0).getTime()
const 深夜 = new Date(2026, 9, 21, 2, 0, 0).getTime()

test('余额决定底档：满、正常、累、空', () => {
  assert.equal(energyOf({ availableCny: 20, dailyGrantCny: 10, now: 中午 }).level, 'full')
  assert.equal(energyOf({ availableCny: 10, dailyGrantCny: 10, now: 中午 }).level, 'good')
  assert.equal(energyOf({ availableCny: 4, dailyGrantCny: 10, now: 中午 }).level, 'normal')
  assert.equal(energyOf({ availableCny: 2, dailyGrantCny: 10, now: 中午 }).level, 'low')
  assert.equal(energyOf({ availableCny: 1, dailyGrantCny: 10, now: 中午 }).level, 'tight')
  assert.equal(energyOf({ availableCny: 0.3, dailyGrantCny: 10, now: 中午 }).level, 'empty')
})

test('今天用得多会再累一档，用超一整天再降一档', () => {
  const 用了六成 = energyOf({ availableCny: 20, dailyGrantCny: 10, spentTodayCny: 6, now: 中午 })
  assert.equal(用了六成.level, 'good')
  const 用超了 = energyOf({ availableCny: 20, dailyGrantCny: 10, spentTodayCny: 10, now: 中午 })
  assert.equal(用超了.level, 'normal')
})

test('深夜整体降一档，但不会降到空以下', () => {
  assert.equal(isNight(深夜), true)
  assert.equal(isNight(中午), false)
  assert.equal(energyOf({ availableCny: 20, dailyGrantCny: 10, now: 深夜 }).level, 'good')
  assert.equal(energyOf({ availableCny: 10, dailyGrantCny: 10, now: 深夜 }).level, 'normal')
  const 见底 = energyOf({ availableCny: 0.1, dailyGrantCny: 10, spentTodayCny: 30, now: 深夜 })
  assert.equal(见底.level, 'empty')
})

test('额度为 0 或缺失时按 10 算，不把好状态算成空', () => {
  assert.equal(energyOf({ availableCny: 10, dailyGrantCny: 0, now: 中午 }).level, 'good')
  assert.equal(energyOf({ availableCny: 10, now: 中午 }).level, 'good')
})

test('累了就不主动、不探索，篇幅也收', () => {
  const 累 = energyOf({ availableCny: 1, dailyGrantCny: 10, now: 中午 })
  assert.equal(累.proactiveScale, 0)
  assert.equal(累.explore, false)
  assert.equal(累.maxBubbles, 1)
  assert.match(累.promptLine, /能一句带过/)
  assert.match(累.promptLine, /不要提累、精力、额度、余额或钱/)
  const 有点累 = energyOf({ availableCny: 2, dailyGrantCny: 10, now: 中午 })
  assert.equal(有点累.proactiveScale, 0.5)
  assert.equal(有点累.explore, false)
})

test('精神好的时候不往提示里塞精力，免得多一段废话', () => {
  for (const availableCny of [20, 10, 4]) {
    const 好 = energyOf({ availableCny, dailyGrantCny: 10, now: 中午 })
    assert.equal(好.promptLine, '')
  }
})

test('账本快照带出精力，和余额对得上', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fish-mind-energy-'))
  let clock = 中午
  const budget = openBudget({
    dir,
    config: { enabled: true, prices: {}, defaultPrice: { ...DEFAULT_PRICE }, biliShare: 0.25 },
    now: () => clock,
  })
  const first = budget.status()
  assert.equal(first.energy.level, 'good')
  assert.equal(first.energy.ratio, 1)

  const reservation = budget.reserve({ provider: 'p', model: 'm', maxTokens: 8 }).reservation
  budget.settle(reservation, { inputTokens: 1_000_000, outputTokens: 0 })
  const after = budget.status()
  assert.equal(after.availableCny, 6)
  assert.equal(after.energy.level, 'normal')
})
