import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildCreationBrief,
  buildTendencyPrompt,
  compileTendency,
  describeTendency,
  loadTendency,
  normalizeTendencyInput,
  planTendencyApply,
  reconcileTendency,
  saveTendency,
  talkFieldsOf,
  tuneTalk,
} from '../lib/tendency.js'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'fish-tendency-'))
}

test('五个维度都能从一句话里编译出来', () => {
  const cases = [
    ['群里安静一点', 'talk', 'less'],
    ['活泼一点', 'talk', 'more'],
    ['话短一点', 'length', 'short'],
    ['说详细一点', 'length', 'long'],
    ['少开玩笑', 'humor', 'less'],
    ['多开玩笑', 'humor', 'more'],
    ['少发表情', 'stickerSend', 'less'],
    ['多发表情', 'stickerSend', 'more'],
    ['别发表情', 'stickerSend', 'off'],
    ['勤保存表情包', 'stickerSave', 'more'],
    ['少存表情', 'stickerSave', 'less'],
    ['别存表情', 'stickerSave', 'off'],
  ]
  for (const [clause, dimension, mode] of cases) {
    const compiled = compileTendency(clause)
    assert.equal(compiled.policy[dimension].mode, mode, clause)
    assert.equal(compiled.matches.length, 1, clause)
    assert.equal(compiled.matches[0].dimension, dimension, clause)
    assert.deepEqual(compiled.unmatchedClauses, [], clause)
  }
})

test('否定优先，后写的覆盖先写的', () => {
  assert.equal(compileTendency('别多存表情').policy.stickerSave.mode, 'less')
  assert.equal(compileTendency('别太简短').policy.length.mode, 'long')
  assert.equal(compileTendency('别那么安静').policy.talk.mode, 'more')
  assert.equal(compileTendency('安静一点，活泼一点').policy.talk.mode, 'more')
  assert.equal(compileTendency('活泼一点，安静一点').policy.talk.mode, 'less')
  assert.equal(compileTendency('勤保存表情包，别存表情').policy.stickerSave.mode, 'off')
})

test('不确定的句子原样留下，交给创造模式', () => {
  const compiled = compileTendency('用颜文字，存完回一句，安静一点')
  assert.equal(compiled.policy.talk.mode, 'less')
  assert.deepEqual(compiled.unmatchedClauses, ['用颜文字', '存完回一句'])
  const lines = describeTendency(compiled)
  assert.equal(lines.length, 3)
  assert.equal(lines[0].landingLabel, '写入设置')
  assert.equal(lines[0].landing, 'settings')
  assert.match(lines[0].effect, /保存后写入「通到QQ」/)
  assert.equal(lines[1].landingLabel, '需要改代码')
  assert.match(lines[1].effect, /创造模式/)
})

test('空文本回到默认，不识别也不报错', () => {
  for (const text of ['', '   ', undefined, null]) {
    const compiled = compileTendency(text)
    assert.deepEqual(compiled.policy.talk, { mode: 'normal' })
    assert.equal(compiled.policy.length.mode, 'normal')
    assert.equal(compiled.policy.humor.mode, 'normal')
    assert.equal(compiled.policy.stickerSend.mode, 'normal')
    assert.equal(compiled.policy.stickerSave.mode, 'normal')
    assert.deepEqual(compiled.matches, [])
    assert.deepEqual(compiled.unmatchedClauses, [])
  }
})

test('输入校验：长度、花括号、控制字符、非字符串', () => {
  assert.equal(normalizeTendencyInput('  安静一点  '), '安静一点')
  assert.equal(normalizeTendencyInput('安静\r\n一点'), '安静\n一点')
  assert.equal(normalizeTendencyInput('安静\u0000一点\u001f'), '安静一点')
  assert.equal(normalizeTendencyInput(''), '')
  assert.throws(() => normalizeTendencyInput('长'.repeat(2001)), /最多 2000 字/)
  assert.equal(normalizeTendencyInput('长'.repeat(2000)).length, 2000)
  assert.throws(() => normalizeTendencyInput('{{主人}}'), /不能包含 \{\{/)
  assert.throws(() => normalizeTendencyInput(42), /一段文字/)
  assert.throws(() => normalizeTendencyInput(null), /一段文字/)
})

test('读写往返、损坏和高版本都收得住', () => {
  const dir = tempDir()
  assert.deepEqual(loadTendency(dir).text, '')
  const saved = saveTendency(dir, '安静一点', 1760000000000)
  assert.equal(saved.text, '安静一点')
  assert.equal(saved.updatedAt, 1760000000000)
  const stored = JSON.parse(readFileSync(join(dir, 'tendency.json'), 'utf8'))
  assert.equal(stored.format, 'mydearfish.tendency')
  assert.equal(stored.version, 2)
  assert.equal(stored.text, '安静一点')
  const loaded = loadTendency(dir)
  assert.equal(loaded.text, '安静一点')
  assert.equal(loaded.updatedAt, 1760000000000)
  assert.equal(loaded.applied, null)

  const record = {
    at: 1760000000000,
    base: { ...QQ_BASE },
    written: { 主动每时: 4, 主动每日: 24, 判断阈值: 0.46, 关注上限: 9 },
    drifted: false,
  }
  saveTendency(dir, '安静一点', 1760000000000, () => {}, record)
  assert.deepEqual(loadTendency(dir).applied, record)

  assert.equal(saveTendency(dir, '', 1760000000001).text, '')
  assert.equal(loadTendency(dir).text, '')

  writeFileSync(join(dir, 'tendency.json'), '{坏掉的')
  const brokenLogs = []
  const broken = loadTendency(dir, (message) => brokenLogs.push(message))
  assert.equal(broken.text, '')
  assert.match(broken.warning, /读不出来/)
  assert.equal(brokenLogs.length, 1)

  writeFileSync(join(dir, 'tendency.json'), JSON.stringify({ format: 'mydearfish.tendency', version: 9, text: '话短一点' }))
  const futureLogs = []
  const future = loadTendency(dir, (message) => futureLogs.push(message))
  assert.equal(future.text, '话短一点', '高版本仍然尽量读原话')
  assert.match(futureLogs[0], /版本 9/)
})

const QQ_BASE = Object.freeze({ 主动每时: 6, 主动每日: 40, 判断阈值: 0.4, 关注上限: 12 })

function qqHome(values = {}) {
  const home = tempDir()
  writeFileSync(join(home, 'qq-bridge-config.json'), JSON.stringify({
    总开关: true,
    社交: {
      启用: true,
      学表情: true,
      主动每时: 6,
      主动每日: 40,
      判断阈值: 0.4,
      关注上限: 12,
      ...values,
    },
  }))
  return home
}

function readQqSocial(home) {
  return JSON.parse(readFileSync(join(home, 'qq-bridge-config.json'), 'utf8')).社交
}

test('安静和活泼落到四个设置，方向和幅度都可预期', () => {
  assert.deepEqual(tuneTalk(QQ_BASE, 'less'), { 主动每时: 4, 主动每日: 24, 判断阈值: 0.46, 关注上限: 9 })
  assert.deepEqual(tuneTalk(QQ_BASE, 'more'), { 主动每时: 9, 主动每日: 60, 判断阈值: 0.34, 关注上限: 15 })
  assert.deepEqual(tuneTalk(QQ_BASE, 'normal'), { ...QQ_BASE })
  assert.equal(tuneTalk({ ...QQ_BASE, 主动每日: 2000 }, 'more').主动每日, 999, '按 QQ 的硬上限夹住')
  assert.equal(tuneTalk({ ...QQ_BASE, 判断阈值: 0.12 }, 'more').判断阈值, 0.1)
})

test('倾向落设置：重复保存不叠加，改口先回基础', () => {
  const home = qqHome()
  const quiet = compileTendency('安静一点')
  const first = planTendencyApply({ dshHome: home, compiled: quiet, now: 1 })
  assert.equal(first.available, true)
  assert.deepEqual(first.current, { ...QQ_BASE })
  assert.deepEqual(first.applied.base, { ...QQ_BASE })
  assert.deepEqual(first.applied.written, { 主动每时: 4, 主动每日: 24, 判断阈值: 0.46, 关注上限: 9 })
  assert.deepEqual(first.changed, first.applied.written)
  first.apply()
  assert.deepEqual(talkFieldsOf(readQqSocial(home)), first.applied.written)

  const repeat = planTendencyApply({ dshHome: home, compiled: quiet, applied: first.applied, now: 2 })
  assert.equal(repeat.changed, null, '同一句话不会在已经调低的数值上再乘一次')
  assert.deepEqual(repeat.applied.written, first.applied.written)

  const lively = compileTendency('活泼一点')
  const flip = planTendencyApply({ dshHome: home, compiled: lively, applied: first.applied, now: 3 })
  assert.deepEqual(flip.applied.base, { ...QQ_BASE }, '改口时从保存前的基础值重算')
  assert.deepEqual(flip.applied.written, { 主动每时: 9, 主动每日: 60, 判断阈值: 0.34, 关注上限: 15 })
  flip.apply()
  assert.deepEqual(talkFieldsOf(readQqSocial(home)), flip.applied.written)
})

test('QQ 桥没配置时倾向只留在本机，并说明原因', () => {
  const home = tempDir()
  const compiled = compileTendency('安静一点')
  const plan = planTendencyApply({ dshHome: home, compiled })
  assert.equal(plan.available, false)
  assert.equal(plan.apply, null)
  assert.match(plan.warnings[0], /还没配置 QQ 桥/)
  const reconciled = reconcileTendency({ dshHome: home, text: '安静一点', compiled, applied: null })
  assert.equal(reconciled.persist, false)
  assert.equal(reconciled.applied, null)
  assert.deepEqual(reconciled.warnings, [], '没配 QQ 桥时启动不刷告警，只在设置页说明')
})

test('旧版没有落地记录时启动补落一次', () => {
  const home = qqHome()
  const compiled = compileTendency('安静一点')
  const reconciled = reconcileTendency({ dshHome: home, text: '安静一点', compiled, applied: null, now: 5 })
  assert.equal(reconciled.persist, true)
  assert.equal(reconciled.applied.written.主动每时, 4)
  assert.equal(typeof reconciled.apply, 'function')
  reconciled.apply()
  assert.equal(readQqSocial(home).主动每时, 4)
})

test('主人手动改过 QQ 设置后不覆盖，下一次保存以当前值为基础', () => {
  const home = qqHome()
  const quiet = compileTendency('安静一点')
  const first = planTendencyApply({ dshHome: home, compiled: quiet, now: 1 })
  first.apply()
  const config = JSON.parse(readFileSync(join(home, 'qq-bridge-config.json'), 'utf8'))
  config.社交.主动每时 = 2
  writeFileSync(join(home, 'qq-bridge-config.json'), JSON.stringify(config))
  const reconciled = reconcileTendency({ dshHome: home, text: '安静一点', compiled: quiet, applied: first.applied, now: 6 })
  assert.equal(reconciled.persist, true)
  assert.equal(reconciled.apply, null, '手动值不被覆盖')
  assert.equal(reconciled.applied.drifted, true)
  assert.equal(reconciled.applied.base.主动每时, 2)
  assert.match(reconciled.warnings[0], /手动改过/)
  const next = planTendencyApply({ dshHome: home, compiled: quiet, applied: reconciled.applied, now: 7 })
  assert.equal(next.applied.base.主动每时, 2)
  assert.equal(next.applied.written.主动每时, 1)
})

test('生效值按 QQ 现有基础值算，设置页看到的就是运行时用的', () => {
  const compiled = compileTendency('群里安静一点')
  const pending = describeTendency(compiled, { ...QQ_BASE }, 'pending')
  assert.equal(pending.length, 1)
  assert.equal(pending[0].clause, '群里安静一点')
  assert.equal(pending[0].landing, 'settings')
  assert.equal(pending[0].landingLabel, '写入设置')
  assert.match(pending[0].effect, /主动话量 6\/时·40\/日 → 4\/时·24\/日/)
  assert.match(pending[0].effect, /判断阈值 0\.40 → 0\.46/)
  assert.match(pending[0].effect, /每批关注 12 → 9（保存后写入「通到QQ」）/)

  const applied = describeTendency(compiled, { ...QQ_BASE }, 'applied')
  assert.equal(applied[0].landingLabel, '已写入设置')
  assert.match(applied[0].effect, /（已写入「通到QQ」）/)
  const missing = describeTendency(compiled, {}, 'missing')
  assert.equal(missing[0].landingLabel, 'QQ 桥没配置')
  assert.match(missing[0].effect, /先只影响语气/)
  const drifted = describeTendency(compiled, { ...QQ_BASE }, 'drifted')
  assert.equal(drifted[0].landingLabel, '手动改过，保存后重算')
})

test('提示块带优先级和原话，空倾向不生成', () => {
  const compiled = compileTendency('安静一点，话短一点，用颜文字')
  const block = buildTendencyPrompt(compiled.policy, '安静一点，话短一点，用颜文字', {
    unmatchedClauses: compiled.unmatchedClauses,
  })
  assert.match(block, /【主人的倾向】/)
  assert.match(block, /安全、隐私、法律、群规、额度和权限永远优先/)
  assert.match(block, /话少一点/)
  assert.match(block, /回话短一点/)
  assert.match(block, /用颜文字/)
  assert.match(block, /主人原话：「安静一点，话短一点，用颜文字」/)
  assert.equal(buildTendencyPrompt(compiled.policy, ''), '')
  assert.equal(buildTendencyPrompt(compiled.policy, '   '), '')
})

test('创造模式说明始终可复制，并写明硬约束和能否直接改', () => {
  const compiled = compileTendency('用颜文字')
  const yes = buildCreationBrief(compiled, '用颜文字', true)
  assert.match(yes, /主人原话：\n用颜文字/)
  assert.match(yes, /用颜文字\n/)
  assert.match(yes, /不动安全、隐私、法律红线/)
  assert.match(yes, /不提交、不推送/)
  assert.match(yes, /当前目录看起来是源码仓库/)
  const no = buildCreationBrief(compiled, '用颜文字', false)
  assert.match(no, /不是源码仓库/)
})
