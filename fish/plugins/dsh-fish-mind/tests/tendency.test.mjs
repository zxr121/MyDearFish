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
  saveTendency,
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
  assert.equal(lines[0].landingLabel, '现有旋钮')
  assert.equal(lines[1].landingLabel, '需要改代码')
  assert.match(lines[1].effect, /创造模式/)
})

test('空文本回到默认，不识别也不报错', () => {
  for (const text of ['', '   ', undefined, null]) {
    const compiled = compileTendency(text)
    assert.deepEqual(compiled.policy.talk, { mode: 'normal', proactiveScale: 1, thresholdDelta: 0, attentionScale: 1 })
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
  assert.equal(stored.version, 1)
  assert.equal(stored.text, '安静一点')
  const loaded = loadTendency(dir)
  assert.equal(loaded.text, '安静一点')
  assert.equal(loaded.updatedAt, 1760000000000)

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

test('安静和活泼的旋钮方向相反', () => {
  const quiet = compileTendency('安静一点').policy.talk
  assert.ok(quiet.proactiveScale < 1)
  assert.ok(quiet.thresholdDelta > 0)
  assert.ok(quiet.attentionScale < 1)
  const lively = compileTendency('活泼一点').policy.talk
  assert.ok(lively.proactiveScale > 1)
  assert.ok(lively.thresholdDelta < 0)
  assert.ok(lively.attentionScale > 1)
})

test('生效值按 QQ 现有基础值算，设置页看到的就是运行时用的', () => {
  const compiled = compileTendency('群里安静一点')
  const lines = describeTendency(compiled, {
    proactivePerHour: 6,
    proactivePerDay: 40,
    threshold: 0.4,
    attention: 12,
  })
  assert.equal(lines.length, 1)
  assert.equal(lines[0].clause, '群里安静一点')
  assert.equal(lines[0].landing, 'knob')
  assert.match(lines[0].effect, /6\/时·40\/日 → 4\/时·24\/日/)
  assert.match(lines[0].effect, /0\.40 → 0\.46/)
  assert.match(lines[0].effect, /12 → 9/)
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
