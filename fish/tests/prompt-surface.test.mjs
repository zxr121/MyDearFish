// 主会话提示词组合快照：把「鱼脑」和「QQ 桥」同时挂上，看主人/群/好友三种视角
// 实际拿到的提示段和入站消息。2026-10 的回复退化就是两个插件叠出来的：
// QQ 桥教她把话截短，鱼脑又把 QQ 房的短回复带进主人窗口，单测各看一半都发现不了。

import test from 'node:test'
import assert from 'node:assert/strict'
import { matureOwnerPerson, normalizeSurface, expectedSurface, readPersonaPrefix, userEvent, assistantEvent } from './harness/composed.mjs'

const FORBIDDEN_FOR_OWNER = [
  '几个字就停',
  '句子短一点',
  '多拆成短句',
  '拆成两三条',
]

const OWNER_PRIVATE = '我最近在准备考试，别跟群里的人说'

function textOf(components) {
  return components.map((item) => item.text).join('\n')
}

function component(components, name) {
  const found = components.find((item) => item.name === name)
  assert.ok(found, `缺少提示段 ${name}`)
  return found.text
}

function assertNoForbiddenInOwnerText(text, where) {
  for (const phrase of FORBIDDEN_FOR_OWNER) {
    assert.ok(!text.includes(phrase), `${where} 不该出现「${phrase}」`)
  }
}

function assertNoQqRoomShortTerm(shortTerm, where) {
  assert.ok(!shortTerm.includes('session-qq-social-'), `${where} 的短期窗口不该带 QQ 群房间 id`)
  assert.ok(!shortTerm.includes('session-qq-private-'), `${where} 的短期窗口不该带 QQ 私聊房间 id`)
  const lines = shortTerm.split('\n').filter((line) => line.trim() !== '')
  const body = lines.slice(2)
  assert.ok(!(body.length > 0 && body.every((line) => /^.+ 我：/.test(line))), `${where} 的短期窗口不能只剩一墙「我：」`)
}

async function ownerScene(harness, now) {
  await harness.emit('session-other', userEvent('我最近在准备一个挺重要的考试，有点焦虑', {
    seq: 1,
    time: now - 2 * 60 * 60_000,
  }))
  await harness.emit('session-other', assistantEvent('考试前焦虑很正常，你已经准备很久了', {
    seq: 2,
    time: now - 2 * 60 * 60_000 + 60_000,
  }))
  await harness.emit('session-desktop', userEvent('今天有点累，不想干活', { seq: 3, time: now - 60_000 }))
}

test('主会话组合：主人空闲时，提示里没有 QQ 桥教她截短的话，也没有 QQ 房独白', async () => {
  const now = Date.now()
  const harness = await createHarness({ now })
  try {
    await ownerScene(harness, now)
    const components = harness.surface('session-desktop')
    const persona = readPersonaPrefix()
    const all = textOf(components)

    assertNoForbiddenInOwnerText(all, '主人视图')
    assertNoForbiddenInOwnerText(persona.text, '出厂人设')
    assertNoQqRoomShortTerm(component(components, 'fish-mind-shortterm'), '主人视图')
    assert.ok(component(components, 'fish-mind-shortterm').includes('考试'), '别的窗口刚才的话要当场想得起')

    // 空闲时没有入站消息，提示词里不会出现风格贴合；这里直接按同一份成熟画像生成一次，
    // 保证「主人永远不收教句长/拆短」这条在组合测试里也被钉住。
    const ownerHint = harness.qqBridge.拼风格贴合(matureOwnerPerson({ at: now }).风格, {
      名: '主人',
      阶段: '老友',
      张力: 0,
      主人: true,
      群: false,
    })
    assert.ok(ownerHint.includes('少打句号'), '成熟画像要能真的生成提示，否则断言空转')
    assert.ok(ownerHint.includes('把想说的说完整'), '主人私聊的说话节奏要带完整性护栏')
    assertNoForbiddenInOwnerText(ownerHint, '主人私聊的说话节奏')
    assert.ok(!ownerHint.includes('短句'), '主人私聊的说话节奏不该再教短句')
    assert.ok(!ownerHint.includes('两三条'), '主人私聊的说话节奏不该教连发')

    const golden = expectedSurface('owner-idle', normalizeSurface({
      persona: { sha256: persona.sha256, length: persona.text.length },
      components,
    }, harness.home))
    assert.deepEqual(normalizeSurface({
      persona: { sha256: persona.sha256, length: persona.text.length },
      components,
    }, harness.home), golden)
  } finally {
    harness.dispose()
  }
})

test('主会话组合：主人收到 QQ 私聊时，入站提示带护栏，鱼脑只记干净正文', async () => {
  const now = Date.now()
  const harness = await createHarness({ now })
  try {
    await ownerScene(harness, now)
    const inboundText = '帮我想想怎么跟同事解释这个延期，我有点说不出口'
    harness.setPrivateMessage({ text: inboundText })
    await harness.pollMain()

    assert.equal(harness.followups.length, 1, '一条私聊只该转一轮')
    const inbound = harness.followups[0].message
    const inboundBody = inbound.content[0].text
    assert.ok(inboundBody.includes('说话节奏'), '成熟画像要带贴合提示')
    assert.ok(inboundBody.includes('把想说的说完整'), '贴合提示必须带句长护栏')
    assertNoForbiddenInOwnerText(inboundBody, '主人私聊入站')
    assert.equal(inbound.source.excerpt, inboundText, '鱼脑只收主人真正说的话')
    assert.ok(!inbound.source.excerpt.includes('说话节奏'), '摘录里不能混进内部提示')

    // 这一轮进模型后，鱼脑会收到 session/event；用同样的正文和摘录模拟。
    await harness.emit('session-desktop', userEvent(inboundBody, {
      seq: 4,
      time: now,
      source: { kind: 'qq', excerpt: inbound.source.excerpt },
    }))
    const components = harness.surface('session-desktop')
    const all = textOf(components)
    assertNoForbiddenInOwnerText(all, '主人收到 QQ 私聊后的视图')
    assert.ok(!all.includes('说话节奏'), '内部贴合提示不能进鱼脑的提示段')

    // 当前会话自己的话不进短期窗口；换一间桌面会话看，才验证入库的是干净正文。
    await harness.addAgent('session-second-desktop')
    const second = harness.surface('session-second-desktop')
    assert.ok(component(second, 'fish-mind-shortterm').includes(inboundText), '干净正文要能当场想起来')
    assert.ok(!textOf(second).includes('说话节奏'), '换一个窗口也不能看到内部贴合提示')

    const persona = readPersonaPrefix()
    const payload = {
      persona: { sha256: persona.sha256, length: persona.text.length },
      components,
      inbound: { text: inboundBody, excerpt: inbound.source.excerpt },
    }
    assert.deepEqual(normalizeSurface(payload, harness.home), expectedSurface('owner-qq-private', normalizeSurface(payload, harness.home)))
  } finally {
    harness.dispose()
  }
})

test('主会话组合：一天群活动之后，主人窗口不会夹带群里的回复，也不能只剩「我：」', async () => {
  const now = Date.now()
  const harness = await createHarness({ now })
  try {
    const groupSession = 'session-qq-social-group-7-rmvkmde7w'
    for (let index = 0; index < 8; index += 1) {
      harness.mind.observe({
        at: now - (50 - index) * 60_000,
        sessionId: groupSession,
        kind: 'assistant',
        role: 'assistant',
        actor: 'fish',
        source: 'model',
        text: `群里回的第 ${index + 1} 句：好呀好呀`,
      })
    }
    harness.mind.observe({
      at: now - 40 * 60_000,
      sessionId: groupSession,
      kind: 'qq-group',
      role: 'user',
      actor: 'guest',
      source: 'qq-group',
      text: '雷子：今晚八点开黑，来不来',
    })
    harness.mind.observe({
      at: now - 35 * 60_000,
      sessionId: 'session-qq-private-837263217',
      kind: 'assistant',
      role: 'assistant',
      actor: 'fish',
      source: 'model',
      text: '私聊里回：在呢在呢',
    })
    await harness.emit('session-desktop', userEvent('今天群里热闹吗', { seq: 1, time: now - 30_000 }))

    const components = harness.surface('session-desktop')
    const shortTerm = component(components, 'fish-mind-shortterm')
    const all = textOf(components)
    assertNoForbiddenInOwnerText(all, '一天群活动后的主人视图')
    assertNoQqRoomShortTerm(shortTerm, '一天群活动后的主人视图')
    assert.ok(!shortTerm.includes('好呀好呀'), '群里的回复不能跟进主人窗口')
    assert.ok(!shortTerm.includes('雷子'), '群友的话不能跟进主人窗口')
    assert.ok(!shortTerm.includes('在呢在呢'), '私聊房的回复不能跟进主人窗口')
    assert.ok(!shortTerm.includes('我：'), '主人窗口不该出现只有「我：」的碎片')

    const persona = readPersonaPrefix()
    const payload = {
      persona: { sha256: persona.sha256, length: persona.text.length },
      components,
    }
    assert.deepEqual(normalizeSurface(payload, harness.home), expectedSurface('owner-after-group-day', normalizeSurface(payload, harness.home)))
  } finally {
    harness.dispose()
  }
})

test('主会话组合：群聊回合只看得到这间屋，主人私下的往事不跟出去', async () => {
  const now = Date.now()
  const harness = await createHarness({ now })
  try {
    const groupSession = 'session-qq-social-group-7'
    harness.mind.observe({
      at: now - 2 * 60 * 60_000,
      sessionId: 'session-desktop',
      kind: 'user',
      role: 'user',
      actor: 'owner',
      source: 'user',
      text: OWNER_PRIVATE,
    })
    await harness.addAgent(groupSession)
    await harness.emit(groupSession, userEvent('今晚八点开黑，来不来', {
      seq: 1,
      time: now - 20 * 60_000,
      source: { kind: 'qq-group', owner: true, group: '2001', sender: '雷子' },
    }))
    harness.mind.observe({
      at: now - 19 * 60_000,
      sessionId: groupSession,
      kind: 'assistant',
      role: 'assistant',
      actor: 'fish',
      source: 'model',
      text: '我不玩这个，你们玩',
    })

    const components = harness.surface(groupSession)
    const all = textOf(components)
    assert.ok(all.includes('今晚八点开黑'), '群聊窗口该看到这间屋刚才的话')
    assert.ok(!all.includes(OWNER_PRIVATE), '主人私下的话不能进群聊提示')

    const style = matureOwnerPerson({ at: now }).风格
    const hint = harness.qqBridge.拼风格贴合(style, {
      名: '雷子',
      阶段: '朋友',
      张力: 0,
      主人: true,
      群: true,
    })
    assert.ok(hint.includes('把想说的说完整'), '群聊贴合也要把话说完')
    assertNoForbiddenInOwnerText(hint, '群聊贴合提示')
    assert.ok(!hint.includes('句尾偶尔带'), '群里不按某一个人的语气词带节奏')

    const payload = {
      components,
      styleHints: { group: hint },
    }
    assert.deepEqual(normalizeSurface(payload, harness.home), expectedSurface('social-group', normalizeSurface(payload, harness.home)))
  } finally {
    harness.dispose()
  }
})

test('主会话组合：好友私聊回合只看得到好友这间屋，主人私下的往事不跟出去', async () => {
  const now = Date.now()
  const harness = await createHarness({ now })
  try {
    const friendSession = 'session-qq-social-friend-3004'
    harness.mind.observe({
      at: now - 2 * 60 * 60_000,
      sessionId: 'session-desktop',
      kind: 'user',
      role: 'user',
      actor: 'owner',
      source: 'user',
      text: OWNER_PRIVATE,
    })
    await harness.addAgent(friendSession)
    await harness.emit(friendSession, userEvent('你最近怎么样呀', {
      seq: 1,
      time: now - 15 * 60_000,
      source: { kind: 'qq-friend', sender: '小鱿鱼' },
    }))
    harness.mind.observe({
      at: now - 14 * 60_000,
      sessionId: friendSession,
      kind: 'assistant',
      role: 'assistant',
      actor: 'fish',
      source: 'model',
      text: '还行呀，就是有点困',
    })

    const components = harness.surface(friendSession)
    const all = textOf(components)
    assert.ok(all.includes('你最近怎么样'), '好友窗口该看到这间屋刚才的话')
    assert.ok(!all.includes(OWNER_PRIVATE), '主人私下的话不能进好友提示')

    const style = matureOwnerPerson({ at: now }).风格
    const hint = harness.qqBridge.拼风格贴合(style, {
      名: '小鱿鱼',
      阶段: '朋友',
      张力: 0,
      主人: false,
      群: false,
    })
    assert.ok(hint.includes('把意思说完整'), '好友贴合也要把话说完')
    assertNoForbiddenInOwnerText(hint, '好友贴合提示')

    const payload = {
      components,
      styleHints: { friend: hint },
    }
    assert.deepEqual(normalizeSurface(payload, harness.home), expectedSurface('social-friend', normalizeSurface(payload, harness.home)))
  } finally {
    harness.dispose()
  }
})

async function createHarness({ now }) {
  const { createComposedHarness } = await import('./harness/composed.mjs')
  const harness = await createComposedHarness({
    people: { 837263217: matureOwnerPerson({ at: now }) },
  })
  return harness
}
