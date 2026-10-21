import test from 'node:test'
import assert from 'node:assert/strict'
import { hostname, homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import { createPrivacyGuard } from '../lib/privacy.js'

function makeGuard() {
  return createPrivacyGuard({ dshHome: join(homedir(), '.dsh-privacy-test') })
}

test('local：主机名、用户名、主目录都换成标签', () => {
  const guard = makeGuard()
  const text = `主机名 ${hostname()}，用户 ${userInfo().username}，目录 ${homedir()}`
  const result = guard.redact(text, 'local')
  assert.ok(result.hits >= 2)
  assert.ok(!result.text.includes(hostname()), result.text)
  assert.ok(!result.text.includes(homedir()), result.text)
  assert.ok(result.text.includes('已隐去'))
})

test('tool：保留路径和用户名，只清真正的秘密', () => {
  const secret = 'tok-privacy-1234567890'
  process.env.FISH_TEST_TOKEN = secret
  try {
    const guard = makeGuard()
    const path = join(process.cwd(), 'src', 'a.js')
    const result = guard.redact(`open ${path} as ${userInfo().username} token ${secret}`, 'tool')
    assert.ok(result.text.includes(path), result.text)
    assert.ok(result.text.includes(userInfo().username), result.text)
    assert.ok(!result.text.includes(secret), result.text)
  } finally {
    delete process.env.FISH_TEST_TOKEN
  }
})

test('outbound：谈本机信息的整句直接换掉，正常句子保留', () => {
  const guard = makeGuard()
  const result = guard.redact(`这台电脑的主机名是 ${hostname()}。今天天气不错。`, 'outbound')
  assert.ok(!result.text.includes(hostname()), result.text)
  assert.ok(result.text.includes('（这个我不方便说）'), result.text)
  assert.ok(result.text.includes('今天天气不错'), result.text)
})

test('outbound：盘符路径和账号密码都留不下', () => {
  const guard = makeGuard()
  const result = guard.redact('账号 admin，密码 Zx9-Qw7-123，文件在 D:\\work\\private\\a.txt', 'outbound')
  assert.ok(!result.text.includes('Zx9-Qw7-123'), result.text)
  assert.ok(!result.text.includes('D:\\work'), result.text)
})

test('hasCredential：只认高置信度凭据，代码引用和雪花 id 不算', () => {
  const guard = makeGuard()
  for (const text of [
    'sk-1234567890abcdefghijkl',
    `ghp_${'a'.repeat(30)}`,
    'password: hunter2',
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345',
    '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----',
  ]) {
    assert.equal(guard.hasCredential(text), true, text)
  }
  for (const text of [
    'const password = process.env.PASSWORD',
    'API_KEY=your-key-here',
    '用户 id 1729501234567890123',
    '今天去海边看日落',
  ]) {
    assert.equal(guard.hasCredential(text), false, text)
  }
})

test('learn：用户亲口贴出的密码，之后任何模式都不再复述', () => {
  const guard = makeGuard()
  const secret = 'P@ssw0rd-987654'
  const learned = guard.learn(`我的密码是 ${secret}`)
  assert.equal(learned.added, 1)
  assert.equal(guard.learnedCount(), 1)
  for (const mode of ['tool', 'local', 'outbound']) {
    const result = guard.redact(`再说一次 ${secret}`, mode)
    assert.ok(!result.text.includes(secret), `${mode}: ${result.text}`)
  }
  assert.ok(!JSON.stringify(guard.describe()).includes(secret))
})

test('assess：密码整条敏感，主机名只脱敏不丢上下文', () => {
  const guard = makeGuard()
  const secret = guard.assess('我的密码是 abc12345')
  assert.equal(secret.sensitive, true)
  assert.ok(secret.sensitiveKinds.includes('password'))

  const machine = guard.assess(`主机是 ${hostname()}`)
  assert.equal(machine.sensitive, false)
  assert.ok(!machine.text.includes(hostname()), machine.text)
})

test('protectStream：跨 delta 的秘密不会流出去，块结束保留合法 chunk', async () => {
  const guard = makeGuard()
  async function* source() {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: '我的密钥是 ' }
    yield { type: 'text-delta', index: 0, text: 'sk-1234567890abcdefghijkl' }
    yield { type: 'text-delta', index: 0, text: '，别告诉别人。' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: '我的密钥是 sk-1234567890abcdefghijkl，别告诉别人。' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }

  const chunks = []
  for await (const chunk of guard.protectStream(source(), { mode: 'local' })) chunks.push(chunk)

  const streamed = chunks.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text).join('')
  assert.ok(!streamed.includes('sk-'), streamed)
  assert.ok(streamed.includes('别告诉别人'), streamed)

  const end = chunks.find((chunk) => chunk.type === 'block-end')
  assert.ok(end)
  assert.equal(end.text, undefined)
  assert.equal(end.block.type, 'text')
  assert.ok(!end.block.text.includes('sk-'), end.block.text)
})

test('protectStream：工具参数攒齐再清，不让半截秘密先出去', async () => {
  const guard = makeGuard()
  const args = '{"command":"echo sk-1234567890abcdefghijkl"}'
  async function* source() {
    yield { type: 'block-start', index: 1, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 1, id: 't1', name: 'bash', argumentsDelta: args.slice(0, 18) }
    yield { type: 'tool-call-delta', index: 1, id: 't1', argumentsDelta: args.slice(18) }
    yield { type: 'block-end', index: 1, block: { type: 'tool-call', id: 't1', name: 'bash', arguments: args } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }

  const chunks = []
  for await (const chunk of guard.protectStream(source(), { mode: 'local' })) chunks.push(chunk)

  const deltas = chunks.filter((chunk) => chunk.type === 'tool-call-delta')
  assert.equal(deltas.length, 1)
  assert.ok(!deltas[0].argumentsDelta.includes('sk-'), deltas[0].argumentsDelta)
  const end = chunks.find((chunk) => chunk.type === 'block-end')
  assert.ok(!end.block.arguments.includes('sk-'), end.block.arguments)
})

test('protectStream：报错信息也要清洗', async () => {
  const guard = makeGuard()
  async function* source() {
    yield {
      type: 'finish',
      reason: { kind: 'error', failure: { message: 'bad token sk-1234567890abcdefghijkl' } },
    }
  }
  const chunks = []
  for await (const chunk of guard.protectStream(source(), { mode: 'local' })) chunks.push(chunk)
  assert.ok(!chunks[0].reason.failure.message.includes('sk-'), chunks[0].reason.failure.message)
})

test('redactBlock：没改动时返回原对象', () => {
  const guard = makeGuard()
  const block = { type: 'text', text: '今天天气不错' }
  assert.equal(guard.redactBlock(block, 'local'), block)
})

test('describe 只报数量，不报任何具体值', () => {
  const guard = makeGuard()
  const text = JSON.stringify(guard.describe())
  assert.ok(!text.includes(hostname()), text)
  assert.ok(!text.includes(homedir()), text)
  assert.ok(text.includes('credential-arguments'))
})
