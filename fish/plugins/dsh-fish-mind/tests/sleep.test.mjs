import test from 'node:test'
import assert from 'node:assert/strict'
import { formatClock, normalizeSleepWindow, parseClock, sleepPrompt, sleepStateOf, sleepWindowFromQuiet } from '../lib/sleep.js'

const at = (hours, minutes = 0) => new Date(2026, 10, 4, hours, minutes, 0, 0).getTime()

test('时间文本：HH:MM 解析、格式化和坏值', () => {
  assert.equal(parseClock('23:00'), 23 * 60)
  assert.equal(parseClock('8:05'), 8 * 60 + 5)
  assert.equal(parseClock('24:00'), null)
  assert.equal(parseClock('12:60'), null)
  assert.equal(parseClock('晚上'), null)
  assert.equal(formatClock(8 * 60 + 5), '08:05')
  assert.equal(formatClock(24 * 60 + 30), '00:30')
})

test('安静时段换成休眠窗口：跨午夜、同小时不启用、坏值不猜', () => {
  const late = sleepWindowFromQuiet({ 安静起: 23, 安静止: 8 })
  assert.deepEqual(late, {
    start: '23:00',
    end: '08:00',
    windDownMinutes: 60,
    freshWakeMinutes: 30,
  })

  const early = sleepWindowFromQuiet({ 安静起: 1, 安静止: 8 })
  assert.equal(early.start, '01:00')
  assert.equal(early.end, '08:00')

  assert.equal(sleepWindowFromQuiet({ 安静起: 8, 安静止: 8 }), null, '起止相同 = 安静时段没启用')
  assert.equal(sleepWindowFromQuiet({ 安静起: 24, 安静止: 8 }), null)
  assert.equal(sleepWindowFromQuiet({ 安静起: '1', 安静止: 8 }), null)
  assert.equal(sleepWindowFromQuiet(null), null)

  const tuned = sleepWindowFromQuiet({ 安静起: 23, 安静止: 8 }, { windDownMinutes: 90, freshWakeMinutes: 15 })
  assert.equal(tuned.windDownMinutes, 90)
  assert.equal(tuned.freshWakeMinutes, 15)

  assert.equal(normalizeSleepWindow({ start: '23:00', end: '23:00' }), null)
  assert.equal(normalizeSleepWindow({ start: '23:00', end: '08:00', windDownMinutes: 9999 }).windDownMinutes, 720)
})

test('默认作息跨午夜：23:00–08:00 的四个阶段', () => {
  const sleep = sleepWindowFromQuiet({ 安静起: 23, 安静止: 8 })

  assert.equal(sleepStateOf(sleep, at(21, 59)).phase, 'awake')
  assert.equal(sleepStateOf(sleep, at(22, 0)).phase, 'wind-down', '开始前一小时进入收尾')
  assert.equal(sleepStateOf(sleep, at(23, 30)).phase, 'sleeping')
  assert.equal(sleepStateOf(sleep, at(3, 0)).phase, 'sleeping')
  assert.equal(sleepStateOf(sleep, at(8, 0)).phase, 'fresh-wake', '结束那一刻就算刚醒')
  assert.equal(sleepStateOf(sleep, at(8, 30)).phase, 'fresh-wake')
  assert.equal(sleepStateOf(sleep, at(8, 31)).phase, 'awake')

  const sleeping = sleepStateOf(sleep, at(3, 0))
  assert.equal(sleeping.inSleep, true)
  assert.equal(sleeping.summary, '休眠中 · 08:00 醒')
  assert.equal(sleeping.minutesToStart, 20 * 60)

  const afternoon = sleepStateOf(sleep, at(12, 0))
  assert.equal(afternoon.inSleep, false)
  assert.equal(afternoon.minutesToStart, 11 * 60)
  assert.equal(afternoon.summary, '醒着 · 下次休眠 23:00')

  const woke = sleepStateOf(sleep, at(8, 10))
  assert.equal(woke.summary, '刚醒 · 10 分钟前结束休眠')

  const winding = sleepStateOf(sleep, at(22, 30))
  assert.equal(winding.summary, '醒着 · 30 分钟后休眠')
})

test('同一天内的休眠：09:00–17:00 不会把白天算成跨午夜', () => {
  const sleep = sleepWindowFromQuiet({ 安静起: 9, 安静止: 17 })
  assert.equal(sleepStateOf(sleep, at(8, 30)).phase, 'wind-down')
  assert.equal(sleepStateOf(sleep, at(10, 0)).phase, 'sleeping')
  assert.equal(sleepStateOf(sleep, at(12, 0)).inSleep, true)
  assert.equal(sleepStateOf(sleep, at(17, 0)).phase, 'fresh-wake')
  assert.equal(sleepStateOf(sleep, at(18, 0)).phase, 'awake')
  assert.equal(sleepStateOf(sleep, at(23, 0)).phase, 'awake')
})

test('安静时段没启用时不注入提示', () => {
  const state = sleepStateOf(null, at(3, 0))
  assert.equal(state.phase, 'off')
  assert.equal(state.summary, '没设置休眠时间')
  assert.equal(sleepPrompt(null, at(3, 0)), '')
})

test('提示带上当前时间、休眠窗口和阶段，并让人设只管样子', () => {
  const sleep = sleepWindowFromQuiet({ 安静起: 23, 安静止: 8 })
  const sleeping = sleepPrompt(sleep, at(3, 0))
  assert.ok(sleeping.includes('【作息·只给你自己看】'))
  assert.ok(sleeping.includes('2026-11-04 星期'))
  assert.ok(sleeping.includes('03:00'))
  assert.ok(sleeping.includes('每天 23:00 到次日 08:00 休眠'))
  assert.ok(sleeping.includes('这条消息是把你叫醒的'))
  assert.ok(sleeping.includes('按你人设里的说法'))

  const awake = sleepPrompt(sleep, at(12, 0))
  assert.ok(awake.includes('离下次休眠还有 11 小时'))

  const winding = sleepPrompt(sleep, at(22, 30))
  assert.ok(winding.includes('还有 30 分钟就到休眠时间'))

  const woke = sleepPrompt(sleep, at(8, 10))
  assert.ok(woke.includes('你才结束休眠 10 分钟'))
})
