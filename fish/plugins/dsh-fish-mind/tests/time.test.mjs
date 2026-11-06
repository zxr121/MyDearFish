import test from 'node:test'
import assert from 'node:assert/strict'
import { ageText, dayDistance, dayGapText, dayText, gapText, nowText, partOfDay, startOfLocalDay, whenText } from '../lib/time.js'

const NOW = new Date(2026, 10, 6, 15, 30).getTime()
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function at(month, day, hour, minute = 0) {
  return new Date(2026, month - 1, day, hour, minute).getTime()
}

test('当前时间写成日期、星期和粗时段，不用模型自己算', () => {
  assert.equal(nowText(NOW), '2026-11-06 星期五 15:30（下午，本机时间）')
  assert.equal(partOfDay(at(11, 6, 7)), '早上')
  assert.equal(partOfDay(at(11, 6, 12)), '中午')
  assert.equal(partOfDay(at(11, 6, 20)), '晚上')
  assert.equal(partOfDay(at(11, 6, 2)), '凌晨')
})

test('记忆时间先说今天昨天前天，再说几点', () => {
  assert.equal(whenText(at(11, 6, 9, 5), NOW), '今天 09:05')
  assert.equal(whenText(at(11, 5, 22, 30), NOW), '昨天 22:30')
  assert.equal(whenText(at(11, 4, 18, 0), NOW), '前天 18:00')
  assert.equal(whenText(at(11, 3, 18, 0), NOW), '3 天前 18:00')
  assert.equal(whenText(at(10, 29, 18, 0), NOW), '上周四 18:00')
  assert.equal(whenText(at(10, 21, 18, 0), NOW), '10月21日 18:00')
  assert.equal(whenText(at(11, 5, 23, 0), at(11, 6, 0, 30)), '昨天 23:00', '刚过零点也要说昨天')
  assert.equal(whenText(0, NOW), '时间不详')
})

test('跨年日期带上年份，不让人把去年当成今年', () => {
  const january = new Date(2027, 0, 3, 10, 0).getTime()
  assert.equal(whenText(new Date(2026, 10, 1, 9, 0).getTime(), january), '2026年11月1日 09:00')
  assert.equal(dayText(new Date(2026, 10, 1, 9, 0).getTime(), january), '2026年11月1日')
})

test('日间隔只看日历日，不看过了多少小时', () => {
  assert.equal(dayDistance(at(11, 5, 23, 50), at(11, 6, 0, 10)), 1)
  assert.equal(dayDistance(at(11, 6, 0, 10), at(11, 6, 23, 50)), 0)
  assert.equal(dayGapText(at(11, 5, 22, 30), NOW), '中间隔了一夜')
  assert.equal(dayGapText(at(11, 3, 22, 30), NOW), '中间隔了 3 天')
  assert.equal(dayGapText(at(11, 6, 14, 0), NOW), '')
  assert.equal(startOfLocalDay(NOW), at(11, 6, 0))
})

test('上次说话隔多久用分钟、小时和天人话', () => {
  assert.equal(gapText(NOW - 30_000, NOW), '刚刚')
  assert.equal(gapText(NOW - 7 * MINUTE, NOW), '7 分钟')
  assert.equal(gapText(NOW - 2 * HOUR - 5 * MINUTE, NOW), '2 小时 5 分钟')
  assert.equal(gapText(NOW - 2 * DAY, NOW), '2 天')
  assert.equal(ageText(NOW - 3 * HOUR, NOW), '3 小时前')
  assert.equal(ageText(NOW - 2 * DAY, NOW), '2 天前')
})
