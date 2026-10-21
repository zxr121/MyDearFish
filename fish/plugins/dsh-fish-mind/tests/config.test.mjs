import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildDefaults, expandPath, loadConfig, normalizeConfig } from '../lib/config.js'

function tempHome() {
  return mkdtempSync(join(tmpdir(), 'fish-mind-config-'))
}

test('默认配置是影子模式，权限开着，后台自主关着', () => {
  const home = tempHome()
  const config = buildDefaults(home)
  assert.equal(config.mode, 'shadow')
  assert.equal(config.inject, false)
  assert.equal(config.permissions.enabled, true)
  assert.equal(config.permissions.emergencyStop, false)
  assert.equal(config.permissions.autonomous.enabled, false)
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
  assert.equal(config.mode, 'shadow')
  assert.equal(readFileSync(path, 'utf8'), '{ 这不是 JSON')
  assert.ok(lines.some((line) => line.includes('默认值')))
})

test('第一次启动会写出一份默认配置', () => {
  const home = tempHome()
  loadConfig({ dshHome: home })
  const written = JSON.parse(readFileSync(join(home, 'fish-mind', 'config.json'), 'utf8'))
  assert.equal(written.mode, 'shadow')
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
  assert.equal(config.mode, 'shadow')
  assert.equal(config.inject, false)
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
  assert.deepEqual(config.budget.defaultPrice, { input: 0, cacheRead: 0, cacheWrite: 0, output: 20, reasoning: 0 })
  assert.deepEqual(config.budget.prices['p/m'], { input: 2, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 })
  assert.equal(config.budget.prices.bad, undefined)
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
  const config = normalizeConfig({ episodes: 'nope', recall: [] }, {
    dshHome: home,
    diag: (line) => lines.push(line),
  })
  assert.equal(config.episodes.gapMinutes, 45)
  assert.equal(config.recall.workspaceChars, 900)
  assert.ok(lines.some((line) => line.includes('episodes 不是对象')))
  assert.ok(lines.some((line) => line.includes('recall 不是对象')))
})

test('~ 和 $DSH_HOME 会展开', () => {
  const home = tempHome()
  assert.equal(expandPath('~/x', { dshHome: home }), join(homedir(), 'x'))
  assert.equal(expandPath('$DSH_HOME/x', { dshHome: home }), join(home, 'x'))
  assert.equal(expandPath('${DSH_HOME}/x', { dshHome: home }), join(home, 'x'))
})
