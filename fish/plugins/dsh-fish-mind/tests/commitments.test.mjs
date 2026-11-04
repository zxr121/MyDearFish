// 承诺记忆：解析、写入回读、跨屋可见性、说出口前核对。
//
// 这些用例覆盖主人最在意的一条：她说“记住了”之前，必须真的写进去、读得回来；
// 群里让她记的事，换群/私聊能答，但保密和不熟的人不能套出去。

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { openStore } from '../lib/store.js'
import { parseMemoryRequest, rewriteMemoryClaims, scanMemoryClaims } from '../lib/commitments.js'
import { fakeContext, memoryHarness, messageEvent, session, writeConfig } from './harness.mjs'

function setup({ owner = true } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'fish-mind-commit-'))
  process.env.DSH_HOME = home
  writeConfig(home, { mode: 'live', inject: true })
  const ctx = fakeContext()
  const harness = memoryHarness(ctx)
  if (!owner) ctx.set('agents', { list: () => [] })
  apply(ctx)
  return { home, ctx, harness, mind: ctx.get('fishMind') }
}

function groupSource({ group = '2002', uid = '1001', level = '受信', text = '' } = {}) {
  return {
    kind: 'qq-group',
    group,
    roomKey: `group:${group}`,
    roomTrust: level,
    viewer: { key: uid, name: `人${uid}`, level },
    memoryRequests: text === ''
      ? []
      : [{ uid, name: `人${uid}`, text, owner: false, level }],
  }
}

function textOf(chunks) {
  return chunks.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text).join('')
}

async function runGuard(listener, sessionId, text, { toolCall = false } = {}) {
  const upstream = async function* () {
    if (toolCall) {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: 'call-1', name: 'recall', argumentsDelta: '{}' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call-1', name: 'recall', arguments: {} } }
    }
    yield { type: 'block-start', index: 1, blockType: 'text' }
    yield { type: 'text-delta', index: 1, text }
    yield { type: 'block-end', index: 1, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  const out = []
  for await (const chunk of listener({ sessionId }, upstream)) out.push(chunk)
  return out
}

test('承诺记忆：明确请求和完成说法分得清', () => {
  assert.deepEqual(parseMemoryRequest('记住，我对芒果过敏'), {
    content: '我对芒果过敏', secret: false, correction: false, raw: '记住，我对芒果过敏',
  })
  assert.equal(parseMemoryRequest('帮我记住：我下周三考试')?.content, '我下周三考试')
  assert.equal(parseMemoryRequest('我对芒果过敏，记住')?.content, '我对芒果过敏')
  assert.equal(parseMemoryRequest('记住这个：我对芒果过敏')?.content, '我对芒果过敏')
  assert.equal(parseMemoryRequest('记住，这事保密：我下周三考试')?.secret, true)
  assert.equal(parseMemoryRequest('记住，这事保密：我下周三考试')?.content, '我下周三考试')
  for (const text of ['你记住了吗', '我记得你说过', '没记住', '记住你了', '她说记住，我对芒果过敏', '我记住了，我对芒果过敏', '记得吃饭', '还记得我们上次说的吗', '记住这个', '你给我记住，我对芒果过敏', '我记住了', '我记着']) {
    assert.equal(parseMemoryRequest(text), null, text)
  }

  assert.equal(scanMemoryClaims('我记住了').length, 1)
  assert.equal(scanMemoryClaims('记住了，你对芒果过敏').length, 1)
  assert.equal(scanMemoryClaims('我没记住').length, 0)
  assert.equal(scanMemoryClaims('你记住了吗').length, 0)
  assert.equal(scanMemoryClaims('她说“记住了”').length, 0)
  assert.equal(scanMemoryClaims('我记住你了').length, 0)
  assert.equal(scanMemoryClaims('我记得你').length, 0)
  assert.equal(rewriteMemoryClaims('我记住了').text, '我没记住，你再说一遍好吗')
  assert.equal(rewriteMemoryClaims('记住了，你对芒果过敏').text, '我还没记牢，你对芒果过敏')
  assert.equal(rewriteMemoryClaims('我不会忘的').text, '我没记住，你再说一遍好吗')
})

test('承诺记忆：写入回读、幂等、修正和保密隔离', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fish-mind-store-commit-'))
  const store = openStore({ dir })
  const first = store.commitMemory({ text: '我对芒果过敏', askerKey: '1001', roomKey: 'group:2002' })
  assert.equal(first.ok, true)
  assert.equal(first.verified, true)
  const again = store.commitMemory({ text: '我对芒果过敏。', askerKey: '1001', roomKey: 'group:2002' })
  assert.equal(again.ok, true)
  assert.equal(again.id, first.id)
  assert.equal(again.existing, true)

  const fixed = store.commitMemory({
    text: '我下周四考试',
    askerKey: '1001',
    roomKey: 'group:2002',
    visibility: 'secret',
    replaceId: first.id,
  })
  assert.equal(fixed.ok, true)
  assert.equal(store.getCommitment(first.id).status, 'superseded')
  assert.deepEqual(
    store.recallCommitments({ roomKey: 'group:2002', viewerKey: '1001' }).items.map((item) => item.text),
    ['我下周四考试'],
  )
  assert.equal(store.recallCommitments({ roomKey: 'group:9999', viewerKey: '1001' }).items.length, 0)
  const owner = store.recallCommitments({ roomKey: 'owner', viewerKey: 'owner', isOwner: true })
  assert.equal(owner.items.length, 0)
  assert.equal(owner.hiddenSecret, 1)
  assert.equal(store.commitmentStats().verified, 1)
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

test('承诺记忆：群里说记住，同屋和换群都能答，陌生人不行', async () => {
  const { home, ctx, harness, mind } = setup({ owner: false })
  const a = session('session-qq-social-group-2002')
  await ctx.emit('agent/created', { agent: { session: a, ctx } })
  const cm = harness.contexts.find((entry) => entry.name === 'fish-mind-commitments')
  await ctx.emit('session/event', a, messageEvent('user/message', '记住，我对芒果过敏', {
    source: groupSource({ text: '记住，我对芒果过敏' }),
  }))
  assert.equal(mind.commitmentStats().verified, 1)
  const aText = cm.text({ agent: { session: a } })
  assert.match(aText, /记忆回执/)
  assert.match(aText, /我对芒果过敏/)

  const b = session('session-qq-social-group-3003')
  await ctx.emit('agent/created', { agent: { session: b, ctx } })
  await ctx.emit('session/event', b, messageEvent('user/message', '我对什么过敏', {
    source: groupSource({ group: '3003', level: '普通' }),
  }))
  assert.match(cm.text({ agent: { session: b } }), /我对芒果过敏/)

  const c = session('session-qq-social-group-4004')
  await ctx.emit('agent/created', { agent: { session: c, ctx } })
  await ctx.emit('session/event', c, messageEvent('user/message', '他对什么过敏', {
    source: groupSource({ group: '4004', uid: '3003', level: '普通' }),
  }))
  assert.equal(cm.text({ agent: { session: c } }), '')
  ctx.dispose()
  rmSync(home, { recursive: true, force: true })
})

test('承诺记忆：保密只在原房间说，主人聊天只看到数量', async () => {
  const { home, ctx, harness } = setup()
  const cm = harness.contexts.find((entry) => entry.name === 'fish-mind-commitments')
  const a = session('session-qq-social-group-11')
  await ctx.emit('agent/created', { agent: { session: a, ctx } })
  await ctx.emit('session/event', a, messageEvent('user/message', '记住，这事保密：我下周三考试', {
    source: groupSource({ group: '11', text: '记住，这事保密：我下周三考试' }),
  }))
  assert.match(cm.text({ agent: { session: a } }), /我下周三考试/)
  assert.match(cm.text({ agent: { session: a } }), /保密/)

  const b = session('session-qq-social-group-12')
  await ctx.emit('agent/created', { agent: { session: b, ctx } })
  await ctx.emit('session/event', b, messageEvent('user/message', '我下周三考试吗', {
    source: groupSource({ group: '12' }),
  }))
  assert.equal(cm.text({ agent: { session: b } }), '')

  const owner = session('session-owner-x')
  await ctx.emit('agent/created', { agent: { session: owner, ctx } })
  await ctx.emit('session/event', owner, messageEvent('user/message', '小明最近怎么样', {
    source: { kind: 'user' },
  }))
  const ownerText = cm.text({ agent: { session: owner } })
  assert.match(ownerText, /保密记忆/)
  assert.doesNotMatch(ownerText, /我下周三考试/)
  ctx.dispose()
  rmSync(home, { recursive: true, force: true })
})

test('承诺记忆：说出口前核对会补写，补不上就改口', async () => {
  const ownerRun = setup()
  const ownerSession = session('session-1')
  await ownerRun.ctx.emit('session/event', ownerSession, messageEvent('user/message', '我对芒果过敏', {
    source: { kind: 'user' },
  }))
  const ownerListener = ownerRun.ctx.listeners('llm/stream').at(-1)
  assert.ok(ownerListener)
  const allowed = await runGuard(ownerListener, 'session-1', '我记住了，你对芒果过敏')
  assert.equal(textOf(allowed), '我记住了，你对芒果过敏')
  assert.equal(ownerRun.mind.commitmentStats().verified, 1)
  ownerRun.ctx.dispose()
  rmSync(ownerRun.home, { recursive: true, force: true })

  const socialRun = setup({ owner: false })
  const social = session('session-qq-social-group-77')
  await socialRun.ctx.emit('agent/created', { agent: { session: social, ctx: socialRun.ctx } })
  await socialRun.ctx.emit('session/event', social, messageEvent('user/message', '大家一起聊天', {
    source: { kind: 'qq-group', group: '77', roomKey: 'group:77', roomTrust: '普通' },
  }))
  const socialListener = socialRun.ctx.listeners('llm/stream').at(-1)
  assert.ok(socialListener)
  const rewritten = await runGuard(socialListener, 'session-qq-social-group-77', '我记住了')
  assert.equal(textOf(rewritten), '我没记住，你再说一遍好吗')
  socialRun.ctx.dispose()
  rmSync(socialRun.home, { recursive: true, force: true })
})

test('承诺记忆：有 tool call 的响应不提前改口；销毁后不再拦截', async () => {
  const { home, ctx } = setup()
  const owner = session('session-1')
  await ctx.emit('session/event', owner, messageEvent('user/message', '我去查一下', {
    source: { kind: 'user' },
  }))
  const listener = ctx.listeners('llm/stream').at(-1)
  const withTool = await runGuard(listener, 'session-1', '我记住了，等我查完', { toolCall: true })
  assert.equal(textOf(withTool), '我记住了，等我查完')

  const before = ctx.listeners('llm/stream').length
  await ctx.emit('agent/disposed', { agent: { session: owner, ctx } })
  assert.equal(ctx.listeners('llm/stream').length, before - 1)
  ctx.dispose()
  rmSync(home, { recursive: true, force: true })
})

test('承诺记忆：fish_remember 只挂主人会话，返回已核对回执', async () => {
  const { home, ctx, harness, mind } = setup()
  assert.ok(harness.tools.get('fish_remember'))
  const owner = session('session-1')
  await ctx.emit('session/event', owner, messageEvent('user/message', '我喜欢猫', {
    source: { kind: 'user' },
  }))
  const value = await harness.tools.get('fish_remember').execute(
    { text: '我对花生过敏' },
    { agent: { session: owner } },
  )
  assert.equal(value.ok, true)
  assert.equal(value.verified, true)
  assert.equal(mind.commitments(5)[0].text, '我对花生过敏')
  const cm = harness.contexts.find((entry) => entry.name === 'fish-mind-commitments')
  assert.match(cm.text({ agent: { session: owner } }), /记忆回执/)
  ctx.dispose()
  rmSync(home, { recursive: true, force: true })

  const socialRun = setup({ owner: false })
  const social = session('session-qq-social-group-88')
  await socialRun.ctx.emit('agent/created', { agent: { session: social, ctx: socialRun.ctx } })
  assert.equal(socialRun.harness.tools.has('fish_remember'), false)
  socialRun.ctx.dispose()
  rmSync(socialRun.home, { recursive: true, force: true })
})
