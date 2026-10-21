import test from 'node:test'
import assert from 'node:assert/strict'
import { scrub, summarize, textOfMessage } from '../lib/sanitize.js'

test('普通的日常句子不会被误伤', () => {
  for (const text of [
    '今天我们去海边看了日落，风很大。',
    '我下午三点开会，晚上七点回来。',
    '这个函数在 2026 年 10 月改过一次。',
    '项目路径是 D:\\work\\fish，不是 secrets 目录。',
  ]) {
    const result = scrub(text)
    assert.deepEqual(result.hits, {}, text)
  }
})

test('密码、密钥、令牌会被拦下', () => {
  const cases = [
    '我的密码是 abc12345',
    'password: hunter2',
    'api_key = sk-1234567890abcdefghijkl',
    'token: ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'AWS key: AKIAIOSFODNN7EXAMPLE',
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345',
    '数据库地址 postgres://admin:secretpass@example.com/db',
    '-----BEGIN OPENSSH PRIVATE KEY-----',
  ]
  for (const text of cases) {
    const result = scrub(text)
    assert.ok(Object.keys(result.hits).length > 0, text)
    assert.ok(!result.text.includes('abc12345'), text)
  }
})

test('身份证和银行卡会被拦下', () => {
  const id = scrub('身份证 11010519491231002X 请收好')
  assert.equal(id.hits['id-card'], 1)
  assert.ok(!id.text.includes('11010519491231002X'))

  const invalid = scrub('编号 110105194912310021 是库存号')
  assert.equal(invalid.hits['id-card'], undefined)

  const card = scrub('卡号：6222 0212 3456 7890 123')
  assert.equal(card.hits['bank-card'], 1)
})

test('代码里的变量引用不算密码', () => {
  for (const text of [
    'const password = process.env.PASSWORD',
    'API_KEY = process.env.API_KEY',
    'const token = getToken()',
    'if (password === process.env.PASSWORD) { login() }',
  ]) {
    assert.deepEqual(scrub(text).hits, {}, text)
  }
})

test('明确写出的住址会被拦下', () => {
  const result = scrub('地址：北京市朝阳区某某街道 12 号院 3 单元 501')
  assert.equal(result.hits.address, 1)
})

test('摘要先清洗再截断', () => {
  const text = summarize({ command: 'curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345" https://x' }, 40)
  assert.ok(!text.includes('abcdefghijklmnopqrstuvwxyz012345'))
  assert.ok(text.length <= 40)
})

test('只取文本块，不取图片和推理块', () => {
  const message = {
    content: [
      { type: 'text', text: '第一句' },
      { type: 'image', data: 'xxx' },
      { type: 'reasoning', text: '不该出现的推理' },
      { type: 'text', text: '第二句' },
    ],
  }
  assert.equal(textOfMessage(message), '第一句\n第二句')
  assert.equal(textOfMessage(null), '')
})
