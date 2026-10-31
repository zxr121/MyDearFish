// 诊断工具自身的测试：会话语义按天汇总、版本/内容对比和模型配置解析都要在
// 假数据上说得清，免得工具自己先把线上观测带偏。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { 分析 } from '../tools/conversation-health.mjs'
import { 诊断 } from '../tools/doctor.mjs'

function 写会话(home, id, events) {
  const dir = join(home, 'sessions', 'workspace', id)
  mkdirSync(dir, { recursive: true })
  const frames = events.map((event) => zstdCompressSync(Buffer.from(`${JSON.stringify(event)}\n`, 'utf8')))
  writeFileSync(join(dir, 'session.v4.jsonl.zstd'), Buffer.concat(frames))
}

let seq = 0
function 用户(time, text) {
  seq += 1
  return {
    type: 'user/message',
    seq,
    time,
    data: { role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } },
  }
}

function 她(time, text, reasoning = '先想一下怎么接') {
  seq += 1
  return {
    type: 'assistant/message',
    seq,
    time,
    data: {
      turn: 1,
      step: 1,
      message: {
        role: 'assistant',
        content: [{ type: 'reasoning', text: reasoning }, { type: 'text', text }],
        source: { kind: 'model', provider: 'fake', model: 'chat' },
      },
    },
  }
}

function 长文(字, 前缀 = '') {
  return `${前缀}${'今天把前因后果说清楚'.repeat(20)}`.slice(0, 字)
}

function 主人会话(home, id, { 旧日, 新日 }) {
  const events = [{ type: 'session', version: 4, id, createdAt: 旧日, origin: 'user' }]
  events.push(用户(旧日 + 60_000, '【说话节奏·内部提示，不是对方说的话，别复述】你正在回主人。句尾偶尔带“呀”。句子长短照你自己的来，把想说的说完整。'))
  for (let index = 0; index < 5; index++) events.push(她(旧日 + index * 60_000, 长文(80)))
  events.push(用户(新日 + 60_000, '【刚才在聊的·短期记忆】\n10-30 10:00 我：好呀好呀\n10-30 10:01 我：在呢在呢\n【其它段】'))
  events.push(用户(新日 + 120_000, '【说话节奏·内部提示，不是对方说的话，别复述】你正在回主人。句子短一点，几个字就停。'))
  for (let index = 0; index < 5; index++) events.push(她(新日 + 180_000 + index * 60_000, 长文(20, '嗯，'),
    '这次只回几个字'))
  写会话(home, id, events)
}

test('会话健康：按天算主人回复中位，认出禁句、缺护栏和只我窗口', () => {
  const home = mkdtempSync(join(tmpdir(), 'fish-health-'))
  try {
    const 旧日 = new Date(2026, 9, 28, 12, 0, 0).getTime()
    const 新日 = new Date(2026, 9, 30, 12, 0, 0).getTime()
    主人会话(home, 'session-owner-chat', { 旧日, 新日 })
    // 群里回得短是常态，不能拉低主人这一列。
    写会话(home, 'session-qq-social-group-3001', [
      { type: 'session', version: 4, id: 'session-qq-social-group-3001', createdAt: 新日 },
      用户(新日, '群里聊两句'),
      她(新日 + 60_000, '好呀好呀'),
    ])
    const result = 分析(home, 14)
    const 旧 = result.天们.find((row) => row.日 === '2026-10-28')
    const 新 = result.天们.find((row) => row.日 === '2026-10-30')
    assert.ok(旧 && 新)
    assert.equal(旧.主人.回复, 5)
    assert.equal(旧.主人.字数中位, 80)
    assert.equal(旧.主人.禁句, 0)
    assert.equal(旧.主人.缺护栏, 0)
    assert.equal(新.主人.回复, 5)
    assert.equal(新.主人.字数中位, 20)
    assert.equal(新.主人.禁句, 1)
    assert.equal(新.主人.缺护栏, 1)
    assert.equal(新.主人.只我窗, 1)
    assert.equal(新.群.回复, 1, '群回复单独记，不混进主人')
    assert.ok(result.警报.some((line) => line.includes('下降') && line.includes('2026-10-30')), JSON.stringify(result.警报))
    assert.ok(result.警报.some((line) => line.includes('短期窗口')))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('版本诊断：同一版本但 lib 内容不同要说出来，模型/effort 从配置和请求里读', () => {
  const root = mkdtempSync(join(tmpdir(), 'fish-doctor-'))
  try {
    const repo = join(root, 'repo')
    const home = join(root, 'home')
    const 源码 = join(repo, 'fish', 'plugins', 'dsh-demo')
    mkdirSync(join(源码, 'lib'), { recursive: true })
    writeFileSync(join(源码, 'package.json'), JSON.stringify({ name: 'dsh-demo', version: '1.2.3' }))
    writeFileSync(join(源码, 'lib', 'index.js'), 'export const 版本 = "源码"\n')

    const 副本 = join(home, 'profiles', 'desktop', 'node_modules', 'dsh-demo')
    mkdirSync(join(副本, 'lib'), { recursive: true })
    writeFileSync(join(副本, 'package.json'), JSON.stringify({ name: 'dsh-demo', version: '1.2.3' }))
    writeFileSync(join(副本, 'lib', 'index.js'), 'export const 版本 = "旧副本"\n')
    mkdirSync(join(home, 'profiles', 'desktop'), { recursive: true })
    writeFileSync(join(home, 'profiles', 'desktop', 'cordis.patch.yml'), [
      '- id: agent-default-model',
      '  name: "@deepseek-ai/dsh-agent-default-model"',
      '  config:',
      '    provider: deepseek-official',
      '    model: deepseek-flash',
      '    reasoningEffort: max',
      '',
    ].join('\n'))

    const 时间 = new Date(2026, 9, 30, 12, 0, 0).getTime()
    写会话(home, 'session-model', [
      { type: 'session', version: 4, id: 'session-model', createdAt: 时间 },
      {
        type: 'request/header',
        seq: 1,
        time: 时间,
        data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max' } } },
      },
      用户(时间, '你好'),
      她(时间 + 1000, '在呢，今天想聊点什么'),
    ])

    const result = 诊断(home, repo)
    assert.equal(result.插件们.length, 1)
    assert.equal(result.插件们[0].hash === result.插件们[0].runtime[0].hash, false)
    assert.ok(result.不一致.some((line) => line.includes('dsh-demo') && line.includes('内容和源码不同')))
    assert.equal(result.配置[0].model, 'deepseek-flash')
    assert.equal(result.配置[0].reasoningEffort, 'max')
    assert.equal(result.实际.model, 'deepseek-flash')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
