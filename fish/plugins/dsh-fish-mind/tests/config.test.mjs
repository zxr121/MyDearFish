import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildDefaults, expandPath, loadConfig, normalizeConfig } from '../lib/config.js'

function tempHome() {
  return mkdtempSync(join(tmpdir(), 'fish-mind-config-'))
}

test('默认配置是完整功能，权限开着，后台自主关着', () => {
  const home = tempHome()
  const config = buildDefaults(home)
  assert.equal(config.mode, 'live')
  assert.equal(config.inject, true)
  assert.equal(config.permissions.enabled, true)
  assert.equal(config.permissions.emergencyStop, false)
  assert.equal(config.permissions.autonomous.enabled, false)
  assert.equal(config.innerLife.inject, true)
  assert.equal(config.humor.inject, true)
  assert.ok(config.permissions.protectedReadPaths.includes('~/.ssh'))
  assert.ok(config.permissions.protectedReadPaths.some((path) => path.includes('.credentials.yaml')))
})

test('坏 JSON 退回默认值，而且不覆盖原文件', () => {
  const home = tempHome()
  mkdirSync(join(home, 'fish-mind'), { recursive: true })
  const path = join(home, 'fish-mind', 'config.json')
  writeFileSync(path, '{ 这不是 JSON', 'utf8')
  const lines = []
  const config = loadConfig({ dshHome: home, diag: (line) => lines.push(line) })
  assert.equal(config.mode, 'live')
  assert.equal(config.inject, true)
  assert.equal(readFileSync(path, 'utf8'), '{ 这不是 JSON')
  assert.ok(lines.some((line) => line.includes('默认值')))
})

test('第一次启动会写出一份默认配置', () => {
  const home = tempHome()
  loadConfig({ dshHome: home })
  const written = JSON.parse(readFileSync(join(home, 'fish-mind', 'config.json'), 'utf8'))
  assert.equal(written.mode, 'live')
  assert.equal(written.inject, true)
  assert.equal(written.permissions.enabled, true)
})

test('不合法的字段逐个退回，不影响其它字段', () => {
  const home = tempHome()
  const config = normalizeConfig({
    mode: 'turbo',
    inject: 'yes',
    retentionDays: -3,
    maxTextChars: 99,
    archiveChars: 10,
    capture: { user: false, assistant: 'no' },
    permissions: {
      emergencyStop: true,
      protectedReadPaths: [],
      autonomous: { enabled: true, allowTools: ['recall', 42], allowPaths: [] },
    },
  }, { dshHome: home })
  assert.equal(config.mode, 'live')
  assert.equal(config.inject, true)
  assert.equal(config.retentionDays, 1)
  assert.equal(config.maxTextChars, 200)
  assert.equal(config.archiveChars, 200)
  assert.equal(config.capture.user, false)
  assert.equal(config.capture.assistant, true)
  assert.equal(config.capture.compaction, true)
  assert.equal(config.permissions.emergencyStop, true)
  assert.ok(config.permissions.protectedReadPaths.length > 0)
  assert.deepEqual(config.permissions.autonomous.allowTools, ['recall'])
})

test('幽默层可以单独关掉，坏值退回默认', () => {
  const home = tempHome()
  assert.equal(normalizeConfig({ humor: { inject: false } }, { dshHome: home }).humor.inject, false)
  assert.equal(normalizeConfig({ humor: { inject: 'no' } }, { dshHome: home }).humor.inject, true)
  assert.equal(normalizeConfig({ humor: [] }, { dshHome: home }).humor.inject, true)
})

test('外部 MCP 只读白名单：默认只认读类动作，配置里的首尾空格去掉', () => {
  const home = tempHome()
  assert.deepEqual(buildDefaults(home).permissions.mcpReadOnlyTools, [
    'get_*', 'list_*', 'search_*', 'read_*', 'describe_*', 'query_*', 'count_*', 'check_*',
  ])
  const config = normalizeConfig({
    permissions: { mcpReadOnlyTools: [' get_* ', 'send_message', '', 42] },
  }, { dshHome: home })
  assert.deepEqual(config.permissions.mcpReadOnlyTools, ['get_*', 'send_message'])

  const empty = normalizeConfig({ permissions: { mcpReadOnlyTools: [] } }, { dshHome: home })
  assert.ok(empty.permissions.mcpReadOnlyTools.length > 0)
})

test('预算默认开着，每天额度不在配置里，价格逐字段归一', () => {
  const home = tempHome()
  const defaults = buildDefaults(home)
  assert.equal(defaults.budget.enabled, true)
  assert.equal(defaults.budget.inject, true)
  assert.equal(defaults.budget.dailyGrantCny, undefined)
  assert.equal(defaults.budget.defaultMaxOutputTokens, 8192)
  assert.equal(defaults.budget.balanceRefreshMinutes, 15)
  assert.equal(defaults.budget.biliShare, 0.25)
  assert.equal(defaults.budget.defaultPrice.input, 4)

  const config = normalizeConfig({
    budget: {
      enabled: false,
      inject: 'yes',
      defaultMaxOutputTokens: 1,
      balanceRefreshMinutes: 99999,
      defaultPrice: { input: -1, output: 20 },
      prices: { 'p/m': { input: 2 }, bad: 'not-a-price' },
    },
  }, { dshHome: home })
  assert.equal(config.budget.enabled, false)
  assert.equal(config.budget.inject, true)
  assert.equal(config.budget.defaultMaxOutputTokens, 64)
  assert.equal(config.budget.balanceRefreshMinutes, 1440)
  assert.equal(config.budget.biliShare, 0.25)
  assert.deepEqual(config.budget.defaultPrice, { input: 0, cacheRead: 0, cacheWrite: 0, output: 20, reasoning: 0 })
  assert.deepEqual(config.budget.prices['p/m'], { input: 2, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 })
  assert.equal(config.budget.prices.bad, undefined)
})

test('B 站巡检占比超出 0–1 就夹住，坏值退回默认', () => {
  const home = tempHome()
  assert.equal(normalizeConfig({ budget: { biliShare: 2 } }, { dshHome: home }).budget.biliShare, 1)
  assert.equal(normalizeConfig({ budget: { biliShare: -1 } }, { dshHome: home }).budget.biliShare, 0)
  assert.equal(normalizeConfig({ budget: { biliShare: '四分之一' } }, { dshHome: home }).budget.biliShare, 0.25)
  assert.equal(normalizeConfig({ budget: { biliShare: 0.4 } }, { dshHome: home }).budget.biliShare, 0.4)
})

test('预算价格条目保留峰谷日程，日程写坏就退回高峰价', () => {
  const home = tempHome()
  const config = normalizeConfig({
    budget: {
      prices: {
        'p/m': {
          input: 2,
          output: 8,
          offPeak: { input: 1, output: 4 },
          peakHours: [[14, 18], [9, 12]],
          peakDays: [5, 1, 2, 3, 4],
        },
        'q/n': { input: 3, offPeak: { input: 1 }, peakHours: [[18, 9]] },
      },
    },
  }, { dshHome: home })
  const entry = config.budget.prices['p/m']
  assert.deepEqual(entry.peakHours, [[9, 12], [14, 18]])
  assert.deepEqual(entry.peakDays, [1, 2, 3, 4, 5])
  assert.deepEqual(entry.offPeak, { input: 1, cacheRead: 0, cacheWrite: 0, output: 4, reasoning: 0 })
  assert.deepEqual(config.budget.prices['q/n'], { input: 3, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 })
})

test('情景切分和召回参数有默认值，比例不会被四舍五入', () => {
  const home = tempHome()
  const defaults = buildDefaults(home)
  assert.equal(defaults.maxTextChars, 4000)
  assert.equal(defaults.archiveChars, 200000)
  assert.equal(defaults.capture.compaction, true)
  assert.equal(defaults.episodes.gapMinutes, 45)
  assert.equal(defaults.episodes.topicShift, 0.06)
  assert.equal(defaults.episodes.splitMinExperiences, 3)
  assert.equal(defaults.episodes.salienceThreshold, 0.35)
  assert.equal(defaults.recall.routeLimit, 20)
  assert.equal(defaults.recall.fuseLimit, 6)
  assert.equal(defaults.recall.minScore, 0.35)
  assert.equal(defaults.recall.toolLimit, 10)
  assert.equal(defaults.recall.detailMessages, 40)
  assert.equal(defaults.recall.detailChars, 6000)
  assert.equal(defaults.recall.workspaceSlots, 5)
  assert.equal(defaults.recall.workspaceChars, 900)
  assert.equal(defaults.recall.excludeCurrentSession, true)

  const config = normalizeConfig({
    archiveChars: 9_000_000,
    episodes: { gapMinutes: 0, topicShift: 0.06, splitMinExperiences: 0, salienceThreshold: 2 },
    recall: {
      routeLimit: 0,
      fuseLimit: 99,
      minScore: -1,
      toolLimit: 0,
      detailMessages: 999,
      detailChars: 1,
      workspaceSlots: 99,
      workspaceChars: 1,
      excludeCurrentSession: 'yes',
    },
  }, { dshHome: home })
  assert.equal(config.episodes.gapMinutes, 1)
  assert.equal(config.archiveChars, 2000000)
  assert.equal(config.episodes.topicShift, 0.06)
  assert.equal(config.episodes.splitMinExperiences, 1)
  assert.equal(config.episodes.salienceThreshold, 1)
  assert.equal(config.recall.routeLimit, 1)
  assert.equal(config.recall.fuseLimit, 20)
  assert.equal(config.recall.minScore, 0)
  assert.equal(config.recall.toolLimit, 1)
  assert.equal(config.recall.detailMessages, 200)
  assert.equal(config.recall.detailChars, 200)
  assert.equal(config.recall.workspaceSlots, 10)
  assert.equal(config.recall.workspaceChars, 200)
  assert.equal(config.recall.excludeCurrentSession, true)
})

test('情景或召回配置不是对象时退回默认值并记诊断', () => {
  const home = tempHome()
  const lines = []
  const config = normalizeConfig({ episodes: 'nope', recall: [], working: 'nope' }, {
    dshHome: home,
    diag: (line) => lines.push(line),
  })
  assert.equal(config.episodes.gapMinutes, 45)
  assert.equal(config.recall.workspaceChars, 900)
  assert.equal(config.working.ttlMinutes, 30)
  assert.ok(lines.some((line) => line.includes('episodes 不是对象')))
  assert.ok(lines.some((line) => line.includes('recall 不是对象')))
  assert.ok(lines.some((line) => line.includes('working 不是对象')))
})

test('短期层默认开，取值被夹到能用范围内', () => {
  const home = tempHome()
  const defaults = buildDefaults(home)
  assert.deepEqual(defaults.working, {
    enabled: true,
    inject: true,
    ttlMinutes: 30,
    rows: 12,
    chars: 1200,
    idleMinutes: 20,
    maxRows: 40,
    minRows: 2,
    consolidate: true,
    maxFacts: 8,
    maxTokens: 600,
    tickSeconds: 60,
  })

  const config = normalizeConfig({
    working: {
      enabled: 'yes',
      inject: false,
      consolidate: false,
      ttlMinutes: 99999,
      rows: 1,
      chars: 10,
      idleMinutes: -5,
      maxRows: 9999,
      minRows: 99,
      maxFacts: 0,
      maxTokens: 1,
      tickSeconds: 1,
    },
  }, { dshHome: home })
  assert.equal(config.working.enabled, true, '非布尔退回默认')
  assert.equal(config.working.inject, false)
  assert.equal(config.working.consolidate, false)
  assert.equal(config.working.ttlMinutes, 1440)
  assert.equal(config.working.rows, 2)
  assert.equal(config.working.chars, 200)
  assert.equal(config.working.idleMinutes, 1)
  assert.equal(config.working.maxRows, 200)
  assert.equal(config.working.minRows, 20)
  assert.equal(config.working.maxFacts, 1)
  assert.equal(config.working.maxTokens, 128)
  assert.equal(config.working.tickSeconds, 10)

  const narrowed = normalizeConfig({ working: { maxRows: 2, minRows: 20 } }, { dshHome: home })
  assert.equal(narrowed.working.minRows, 2, '门槛不能高于窗口容量，否则永远攒不够')
})

test('~ 和 $DSH_HOME 会展开', () => {
  const home = tempHome()
  assert.equal(expandPath('~/x', { dshHome: home }), join(homedir(), 'x'))
  assert.equal(expandPath('$DSH_HOME/x', { dshHome: home }), join(home, 'x'))
  assert.equal(expandPath('${DSH_HOME}/x', { dshHome: home }), join(home, 'x'))
})
