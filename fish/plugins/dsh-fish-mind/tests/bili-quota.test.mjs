import test from 'node:test'
import assert from 'node:assert/strict'
import { createBiliQuota } from '../lib/bili-quota.js'

const T0 = new Date(2026, 9, 23, 12, 0, 0).getTime()

test('普通聊天不算 B 站巡检', () => {
  const quota = createBiliQuota({ now: () => T0 })
  quota.noteUser('session-1', 'user')
  assert.equal(quota.scopeOf('session-1'), '')
  assert.equal(quota.scopeOf('session-unknown'), '')
})

test('巡检触发那一轮算 B 站，窗口过了就退出', () => {
  let clock = T0
  const quota = createBiliQuota({ windowMs: 60_000, now: () => clock })
  quota.noteUser('session-1', 'bili')
  assert.equal(quota.scopeOf('session-1'), 'bili')
  clock = T0 + 60_000
  assert.equal(quota.scopeOf('session-1'), 'bili')
  clock = T0 + 60_001
  assert.equal(quota.scopeOf('session-1'), '')
})

test('主人在巡检窗口里插话，普通聊天立刻退出 B 站归属', () => {
  const quota = createBiliQuota({ now: () => T0 })
  quota.noteUser('session-1', 'bili')
  assert.equal(quota.scopeOf('session-1'), 'bili')
  quota.noteUser('session-1', 'user')
  assert.equal(quota.scopeOf('session-1'), '')
})

test('巡检派出的子代理和孙子会话都算 B 站', () => {
  const quota = createBiliQuota({ now: () => T0 })
  quota.noteUser('session-1', 'bili')
  quota.noteSession('child', { parentSession: 'session-1' })
  assert.equal(quota.scopeOf('child'), 'bili')
  quota.noteSession('grandchild', { parentSession: 'child' })
  assert.equal(quota.scopeOf('grandchild'), 'bili')
  assert.equal(quota.scopeOf('other'), '')
})

test('普通会话派出的子代理不算 B 站', () => {
  const quota = createBiliQuota({ now: () => T0 })
  quota.noteUser('session-1', 'user')
  quota.noteSession('child', { parentSession: 'session-1' })
  assert.equal(quota.scopeOf('child'), '')
})

test('主人后来聊别的，已经派出的巡检子代理仍按自己的 TTL 归属', () => {
  let clock = T0
  const quota = createBiliQuota({ windowMs: 60_000, sessionTtlMs: 10 * 60_000, now: () => clock })
  quota.noteUser('session-1', 'bili')
  quota.noteSession('child', { parentSession: 'session-1' })
  quota.noteUser('session-1', 'user')
  assert.equal(quota.scopeOf('session-1'), '')
  clock = T0 + 5 * 60_000
  assert.equal(quota.scopeOf('child'), 'bili')
  clock = T0 + 10 * 60_000
  assert.equal(quota.scopeOf('child'), 'bili')
  clock = T0 + 10 * 60_001
  assert.equal(quota.scopeOf('child'), '')
})

test('没有父会话头的事件不会被误认成子代理', () => {
  const quota = createBiliQuota({ now: () => T0 })
  quota.noteUser('session-1', 'bili')
  quota.noteSession('session-2', {})
  assert.equal(quota.scopeOf('session-2'), '')
})

test('子代理归属不会因为后续事件无限续期', () => {
  let clock = T0
  const quota = createBiliQuota({ windowMs: 60_000, sessionTtlMs: 10 * 60_000, now: () => clock })
  quota.noteUser('session-1', 'bili')
  quota.noteSession('child', { parentSession: 'session-1' })
  clock = T0 + 9 * 60_000
  quota.noteSession('child', { parentSession: 'session-1' })
  clock = T0 + 10 * 60_001
  assert.equal(quota.scopeOf('child'), '')
})
