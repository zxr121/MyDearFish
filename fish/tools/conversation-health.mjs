// 线上观测：从会话日志里按天看她的回复有没有变短、变重复，主人提示里有没有又出现
// 教截短的话，主人窗口有没有只剩「我：」的短期记忆。只看已经记在模型可见输入里的东西。
//
// 跑法：
//   node fish/tools/conversation-health.mjs                 # 近 14 天
//   node fish/tools/conversation-health.mjs --days 30
//   node fish/tools/conversation-health.mjs --home C:\\MyDearFish\\data
//   node fish/tools/conversation-health.mjs --json
// 最近一天的主人回复中位字数比前 7 天跌 40%，或主人提示里又出现禁句/缺护栏/只我窗口时，退出码 1。
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  列会话, 读日志, 会话种类, 会话id, 正文, 思考, 字数, 中位, 开场, 本地日,
} from './session-log.mjs'

// 这些句子是 2026-10 回复退化的直接触发词：主人提示里只要出现就不该静默。
const 禁句 = /几个字就停|句子短一点|多拆成短句|拆成两三条|句子可以短|别只回几个字|可以多说两句/u
const 护栏 = /把想说的说完整|把意思说完整|把意思说清楚/u
const 短期窗标题 = '【刚才在聊的·短期记忆】'

function 新桶() {
  return { 回复: [], 推理: [], 正文们: [], 提示: 0, 禁句: 0, 缺护栏: 0, 短期窗: 0, 只我窗: 0 }
}

function 取窗口(文字) {
  const at = String(文字).indexOf(短期窗标题)
  if (at < 0) return null
  const rest = String(文字).slice(at + 短期窗标题.length)
  const end = rest.search(/\n【/u)
  const block = end >= 0 ? rest.slice(0, end) : rest
  const rows = block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\d{2}-\d{2} \d{2}:\d{2} /u.test(line))
  if (rows.length === 0) return null
  return { 条数: rows.length, 只我: rows.every((line) => /^\d{2}-\d{2} \d{2}:\d{2} 我：/u.test(line)) }
}

/**
 * 扫一遍数据目录里的会话日志，按天汇总主人和 QQ 各屋的回复与提示信号。
 * @param {string} home - DSH_HOME。
 * @param {number} [天数] - 保留多少天（按日志里的日期过滤）。
 * @returns {object} 每天的统计、近 7 天概览和警报。
 */
export function 分析(home, 天数 = 14) {
  const files = 列会话(home)
  const 会话们 = []
  let 读不了 = 0
  for (const { file } of files) {
    let events
    try {
      events = 读日志(file).events
    } catch {
      读不了 += 1
      continue
    }
    const id = 会话id(file, events)
    const kind = 会话种类(id)
    const header = events.find((event) => event && event.type === 'session') || {}
    if (header.origin === 'subagent' || Number(header.delegationDepth) > 0) continue
    const session = { kind, replies: [], 提示们: [], 窗口们: [] }
    for (const event of events) {
      if (!event || typeof event !== 'object') continue
      if (event.type === 'assistant/message') {
        const message = event.data?.message
        if (message?.source?.kind !== 'model') continue
        const text = 正文(message)
        if (text === '') continue
        session.replies.push({ 日: 本地日(event.time), 字数: 字数(text), 推理: 字数(思考(message)), 正文: text })
        continue
      }
      if (event.type !== 'user/message' || kind !== 'desktop') continue
      const text = 正文(event.data)
      if (text === '') continue
      const window = 取窗口(text)
      if (window) session.窗口们.push({ 日: 本地日(event.time), ...window })
      if (text.includes('说话节奏')) {
        session.提示们.push({
          日: 本地日(event.time),
          禁句: 禁句.test(text),
          缺护栏: !护栏.test(text),
        })
      }
    }
    if (session.replies.length === 0 && session.提示们.length === 0 && session.窗口们.length === 0) continue
    session.主人聊 = kind === 'desktop' && session.提示们.length > 0
    会话们.push(session)
  }

  const 天们 = new Map()
  const 拿天 = (日) => {
    if (!天们.has(日)) {
      天们.set(日, { 日, 主人: 新桶(), 桌面其他: 新桶(), 群: 新桶(), 好友: 新桶(), 私聊: 新桶() })
    }
    return 天们.get(日)
  }
  for (const session of 会话们) {
    for (const reply of session.replies) {
      const day = 拿天(reply.日)
      const bucket = session.主人聊 ? day.主人 : session.kind === 'desktop' ? day.桌面其他 : session.kind === 'qq-group' ? day.群 : session.kind === 'qq-friend' ? day.好友 : day.私聊
      bucket.回复.push(reply.字数)
      bucket.推理.push(reply.推理)
      bucket.正文们.push(reply.正文)
    }
    if (!session.主人聊) continue
    for (const hint of session.提示们) {
      const bucket = 拿天(hint.日).主人
      bucket.提示 += 1
      if (hint.禁句) bucket.禁句 += 1
      if (hint.缺护栏) bucket.缺护栏 += 1
    }
    for (const window of session.窗口们) {
      const bucket = 拿天(window.日).主人
      bucket.短期窗 += 1
      if (window.只我) bucket.只我窗 += 1
    }
  }

  const 重复率 = (正文们) => {
    const counts = new Map()
    for (const text of 正文们) {
      const head = 开场(text)
      if (head === '') continue
      counts.set(head, (counts.get(head) || 0) + 1)
    }
    return 正文们.length === 0 ? 0 : Math.max(0, ...counts.values()) / 正文们.length
  }

  const 内部天们 = [...天们.values()].sort((a, b) => a.日.localeCompare(b.日))
  const 天列表 = 内部天们
    .map((day) => {
      const row = { 日: day.日 }
      for (const [name, bucket] of [['主人', day.主人], ['桌面其他', day.桌面其他], ['群', day.群], ['好友', day.好友], ['私聊', day.私聊]]) {
        row[name] = {
          回复: bucket.回复.length,
          字数中位: Math.round(中位(bucket.回复)),
          推理中位: Math.round(中位(bucket.推理)),
          重复率: Number(重复率(bucket.正文们).toFixed(2)),
          提示: bucket.提示,
          禁句: bucket.禁句,
          缺护栏: bucket.缺护栏,
          短期窗: bucket.短期窗,
          只我窗: bucket.只我窗,
        }
      }
      return row
    })
    .slice(-天数)

  const 主人天 = 内部天们.filter((day) => day.主人.回复.length > 0)
  const 近七天 = (() => {
    const recent = 主人天.slice(-7)
    const lengths = recent.flatMap((day) => day.主人.回复)
    const reasons = recent.flatMap((day) => day.主人.推理)
    return {
      天数: recent.length,
      回复: lengths.length,
      字数中位: Math.round(中位(lengths)),
      推理中位: Math.round(中位(reasons)),
    }
  })()
  const 天列表主人 = 主人天.map((day) => ({
    日: day.日,
    回复: day.主人.回复.length,
    字数中位: Math.round(中位(day.主人.回复)),
  }))

  const 警报 = []
  const 足够 = 天列表主人.filter((row) => row.回复 >= 5)
  const latest = 足够.at(-1)
  if (latest) {
    const index = 天列表主人.findIndex((row) => row.日 === latest.日)
    const prior = 天列表主人.slice(Math.max(0, index - 7), index).filter((row) => row.回复 > 0)
    if (prior.length > 0) {
      const baseline = 中位(prior.map((row) => row.字数中位))
      if (baseline > 0 && latest.字数中位 < baseline * 0.6) {
        const 降幅 = Math.round((1 - latest.字数中位 / baseline) * 100)
        警报.push(`${latest.日} 主人回复中位 ${latest.字数中位} 字，比前 7 天中位 ${Math.round(baseline)} 字下降 ${降幅}%`)
      }
    }
  } else if (天列表主人.length > 0) {
    警报.push(`近 ${天数} 天没有一天主人回复达到 5 条，无法判断趋势（最后一天 ${天列表主人.at(-1).日}）`)
  }
  const 最近主人 = [...天列表].reverse().find((row) => row.主人.回复 > 0 || row.主人.提示 > 0 || row.主人.只我窗 > 0)
  if (最近主人) {
    if (最近主人.主人.禁句 > 0) 警报.push(`${最近主人.日} 有 ${最近主人.主人.禁句} 条主人提示又出现教截短的话`)
    if (最近主人.主人.缺护栏 > 0) 警报.push(`${最近主人.日} 有 ${最近主人.主人.缺护栏} 条主人提示没带完整性护栏`)
    if (最近主人.主人.只我窗 > 0) 警报.push(`${最近主人.日} 有 ${最近主人.主人.只我窗} 个主人短期窗口只剩「我：」`)
  }
  return { home, 日志数: files.length, 读不了, 天们: 天列表, 近七天, 警报 }
}

function 打表(结果) {
  const 头 = ['日期', '主人回复', '字数中位', '推理中位', '重复开头', '提示', '禁句', '缺护栏', '只我窗']
  const 宽 = [12, 10, 10, 10, 10, 6, 6, 8, 8]
  const 行 = (values) => values.map((value, index) => String(value).padEnd(宽[index])).join(' ')
  console.log(行(头))
  for (const row of 结果.天们) {
    const owner = row.主人
    console.log(行([
      row.日,
      owner.回复,
      owner.字数中位,
      owner.推理中位,
      `${Math.round(owner.重复率 * 100)}%`,
      owner.提示,
      owner.禁句,
      owner.缺护栏,
      owner.只我窗,
    ]))
  }
  const 末 = 结果.天们.at(-1)
  if (末) {
    console.log('')
    console.log(`最近一天各屋回复中位：主人 ${末.主人.字数中位} 字（${末.主人.回复} 条） · 群 ${末.群.字数中位} 字（${末.群.回复} 条） · 好友 ${末.好友.字数中位} 字（${末.好友.回复} 条） · 私聊 ${末.私聊.字数中位} 字（${末.私聊.回复} 条）`)
  }
  console.log(`近 7 天主人：${结果.近七天.回复} 条 · 字数中位 ${结果.近七天.字数中位} · 推理中位 ${结果.近七天.推理中位}`)
  console.log(`日志 ${结果.日志数} 份${结果.读不了 > 0 ? `，${结果.读不了} 份读不了` : ''}`)
}

function 参数(argv) {
  let home = process.env.DSH_HOME || join(process.cwd(), 'data')
  let 天数 = 14
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--home') home = argv[++i]
    else if (arg === '--days') 天数 = Math.min(365, Math.max(1, Number(argv[++i]) || 14))
    else if (arg === '--json') json = true
    else if (arg === '-h' || arg === '--help') {
      console.log('用法：node fish/tools/conversation-health.mjs [--home <DSH_HOME>] [--days 14] [--json]')
      process.exit(0)
    } else {
      console.error(`不认识的参数：${arg}`)
      process.exit(2)
    }
  }
  return { home, 天数, json }
}

export function 主(argv = process.argv.slice(2)) {
  const { home, 天数, json } = 参数(argv)
  if (!existsSync(join(home, 'sessions'))) {
    console.error(`没有找到会话日志：${join(home, 'sessions')}`)
    process.exit(2)
  }
  const 结果 = 分析(home, 天数)
  if (json) {
    console.log(JSON.stringify(结果, null, 2))
  } else {
    console.log(`大肥鱼会话健康 · ${home} · 近 ${天数} 天`)
    打表(结果)
    if (结果.警报.length > 0) {
      console.log('\n警报：')
      for (const line of 结果.警报) console.log(`  - ${line}`)
    } else {
      console.log('\n没有发现回复变短或提示退化的信号 ✅')
    }
  }
  process.exitCode = 结果.警报.length > 0 ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) 主()
