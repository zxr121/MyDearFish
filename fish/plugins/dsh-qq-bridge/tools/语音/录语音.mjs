// 自动录语音 —— 看门狗（边录边发版）
//  · 开始：哨兵在网页读到朗读桥面板「点朗读」→ POST /start
//  · 边录边切：录音脚本每 N 秒吐一个分段 wav，看门狗见一个发一个，不用等整段念完
//  · 停止：盯朗读桥 /status 的 playing 转静 → 放停止文件 → 脚本写残段退出
//  · 朗读桥地址不再写死：启动敲「问路端口」，问出真实地址后锁死它
import http from 'node:http'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// ─────────────────────────── 配置（都能改） ───────────────────────────
// 模式：1 = 切断发（边录边发，念一段发一段）；2 = 完整发（录完整段，只发一条）
// 用法：node 录语音.mjs 1   /   node 录语音.mjs 2   （也可以用环境变量 QQ_VOICE_MODE）
const 模式 = String(process.argv[2] || process.env.QQ_VOICE_MODE || '1').trim() === '2' ? 2 : 1
const 模式名 = 模式 === 2 ? '完整发（录完再发一条）' : '切断发（边录边发）'

// QQ 后端地址（SnowLuma / NapCat 的 OneBot 11 HTTP 接口）
const QQ后端 = process.env.QQ_BACKEND || 'http://127.0.0.1:3000'
// 语音发给谁（QQ 号）。不填就只录不发，方便先试通。
const 私聊QQ = process.env.QQ_VOICE_TARGET || ''

// 录音脚本：默认跟本文件放同一目录
const 录音脚本 = process.env.RECORDER_PS1 || path.join(import.meta.dirname, '录音回环.ps1')
// 分段/成品放哪
const 输出目录 = process.env.VOICE_OUT_DIR || path.join(os.homedir(), 'Desktop', 'AI语音')
const 停文件 = path.join(os.tmpdir(), 'qqrec-stop.txt')

// 朗读桥（tts-bridge）的端口候选：DSH 每次启动端口会变，所以挨个问
// 可以用 DSH_PORTS=1234,5678 覆盖
const 问路端口 = (process.env.DSH_PORTS || '19387,39871,39872')
  .split(',')
  .map((x) => Number(x.trim()))
  .filter(Boolean)

const 端口 = Number(process.env.VOICE_WATCHDOG_PORT || 8765)
const 目标秒 = Number(process.env.VOICE_SEG_SECONDS || 10)

fs.mkdirSync(输出目录, { recursive: true })

let 录音进程 = null
let 批前缀 = null // 本次录制的分段基名（绝对路径，不带 .wav）
let 开始时刻 = 0
let 上次播 = null
let 桥base = '' // 朗读桥真实地址（问路拿到）

const 已收 = new Set() // 已收下的分段文件名（防重复处理）
const 待拼 = [] // 模式 2：先攒着，录完整段再合成一条发
const 发队列 = []
let 发送中 = false

function 格式时间() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
function 记(t) {
  try {
    const 行 = `${格式时间()}  ${t}`
    fs.appendFileSync(path.join(输出目录, '记录.log'), 行 + '\n', 'utf8')
    console.log(行)
  } catch (e) {}
}

// 敲问路端口，问出朗读桥现在的真实地址
async function 问路拿base() {
  for (const p of 问路端口) {
    try {
      const r = await fetch(`http://127.0.0.1:${p}/dsh-tts-bridge/where`, { signal: AbortSignal.timeout(1500) })
      const j = await r.json().catch(() => null)
      if (j && j.ok && typeof j.base === 'string' && j.base) return j.base
    } catch (e) {}
  }
  return ''
}

async function 刷新桥() {
  if (桥base) return
  const b = await 问路拿base()
  if (b) {
    桥base = b
    记(`找到朗读桥：${b}`)
  }
}

function 开始录() {
  if (录音进程 && 录音进程.exitCode === null) return
  try {
    fs.rmSync(停文件, { force: true })
  } catch (e) {}
  const ts = 格式时间().replace(/[-: ]/g, '').slice(2)
  // 分段写进系统临时目录（纯 ASCII 路径）：发 QQ 的 file:/// 最稳，不踩中文路径的坑
  批前缀 = path.join(os.tmpdir(), `qqrec-${ts}`)
  已收.clear()
  待拼.length = 0
  发送中 = false
  发队列.length = 0
  记(`▶ 开始录（目标 ${目标秒} 秒，停顿处切，${模式名}） ${path.basename(批前缀)}-*.wav`)
  录音进程 = spawn(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 录音脚本, '-智能', String(目标秒), '-停', 停文件, '-输出', 批前缀],
    { windowsHide: true },
  )
  开始时刻 = Date.now()
  const 这批 = 批前缀
  录音进程.on('exit', (code) => {
    记(`录完（exit=${code}）`)
    录音进程 = null
    // 给脚本吐残段留一点时间，再做最后一次清扫
    setTimeout(() => {
      扫新段(这批)
      if (模式 === 2) 合成一条发()   // 完整发：录完了，把攒的段拼成一条
      批前缀 = null
    }, 300)
  })
}

function 停() {
  if (录音进程 && 录音进程.exitCode === null) {
    try {
      fs.writeFileSync(停文件, '')
    } catch (e) {}
    return true
  }
  return false
}

// 扫出这一批里新出现、还没发过的分段，塞进队列（见一个发一个）
function 扫新段(prefix) {
  if (!prefix) return
  const 目录 = path.dirname(prefix)
  const 基名 = path.basename(prefix)
  let 文件们 = []
  try {
    文件们 = fs.readdirSync(目录).filter((f) => f.startsWith(基名 + '-') && f.endsWith('.wav')).sort()
  } catch (e) {
    return
  }
  for (const f of 文件们) {
    if (已收.has(f)) continue
    已收.add(f)
    const 整 = path.join(目录, f)
    if (模式 === 2) {
      待拼.push(整)          // 完整发：先攒着，等录完再合
      continue
    }
    发队列.push(整)          // 切断发：见一个发一个
  }
  if (模式 === 1) 消费()
}

// 串行发：一条接一条，保证 QQ 端顺序不乱
async function 消费() {
  if (发送中) return
  发送中 = true
  try {
    while (发队列.length) {
      const f = 发队列.shift()
      await 发单段(f)
    }
  } finally {
    发送中 = false
  }
}

// 模式 2：把这一轮攒下的分段拼成一条 wav 再发（同一次录音、格式一致，只拼 PCM 数据）
async function 合成一条发() {
  const 段们 = 待拼.slice().sort()
  待拼.length = 0
  if (段们.length === 0) return
  const 有效 = 段们.filter((f) => {
    try { return fs.statSync(f).size > 1000 } catch (e) { return false }
  })
  if (有效.length === 0) {
    记('（这一轮没录到声，什么都不发）')
    return
  }
  if (有效.length === 1) {
    await 发单段(有效[0])
    return
  }
  try {
    const 各段 = 有效.map((f) => fs.readFileSync(f))
    const 头 = 各段[0].subarray(0, 44)
    const 体 = Buffer.concat(各段.map((x) => x.subarray(44)))
    const 出 = Buffer.alloc(44 + 体.length)
    头.copy(出, 0)
    体.copy(出, 44)
    出.writeUInt32LE(36 + 体.length, 4)   // RIFF 大小
    出.writeUInt32LE(体.length, 40)       // data 大小
    const 合成 = 有效[0].replace(/-\d+\.wav$/, '-整段.wav')
    fs.writeFileSync(合成, 出)
    for (const f of 有效) { try { fs.rmSync(f, { force: true }) } catch (e) {} }
    记(`（${有效.length} 段合成一条，${Math.round(出.length / 1024)} KB）`)
    await 发单段(合成)
  } catch (e) {
    记('合成失败，改成分段发：' + String((e && e.message) || e))
    for (const f of 有效) await 发单段(f)
  }
}

async function 发单段(wav) {
  const 名 = path.basename(wav)
  try {
    const st = fs.statSync(wav)
    if (st.size <= 1000) {
      记(`（${名} 没录到声，跳过）`)
      try {
        fs.rmSync(wav, { force: true })
      } catch (e) {}
      return
    }
    if (!私聊QQ) {
      记(`（没设 QQ_VOICE_TARGET，只录音不发送：【${名}】）`)
      return
    }
    const url = 'file:///' + wav.replace(/\\/g, '/')
    const r = await fetch(`${QQ后端}/send_private_msg`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: Number(私聊QQ), message: [{ type: 'record', data: { file: url } }] }),
    })
    const j = await r.json().catch(() => null)
    if (j && j.status === 'ok') {
      记(`✅ 已发【${名}】`)
      try {
        fs.rmSync(wav, { force: true })
      } catch (e) {}
    } else {
      记(`⚠ 发送失败【${名}】：${JSON.stringify(j).slice(0, 100)}`)
    }
  } catch (e) {
    记(`发语音出错【${名}】：${String((e && e.message) || e)}`)
  }
}

// 哨兵口（网页侧读面板「点朗读」→ POST /start）
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'POST' && req.url === '/start') {
    开始录()
    res.end('{"ok":true}')
  } else if (req.method === 'POST' && req.url === '/stop') {
    res.end(停() ? '{"ok":true}' : '{"ok":false}')
  } else if (req.url === '/ping') {
    res.end('pong')
  } else {
    res.writeHead(404)
    res.end()
  }
})
server.on('error', (e) => {
  if (e && e.code === 'EADDRINUSE') {
    console.log('已经有一个看门狗在跑（端口被占）。先关掉旧的那个黑窗口，再重新双击。')
    process.exit(0)
  }
  throw e
})
server.listen(端口, '127.0.0.1', () => 记(`哨兵口就绪 http://127.0.0.1:${端口}/start`))

// 主循环：问路 + 停止信号 + 超时保护
setInterval(async () => {
  if (!桥base) await 刷新桥()

  let p = false
  if (桥base) {
    try {
      const r = await fetch(桥base + '/status')
      const j = await r.json().catch(() => null)
      p = !!(j && j.playing)
    } catch (e) {
      p = false
    }
  }

  if (上次播 === null) {
    上次播 = p
    return
  }
  if (上次播 && !p) {
    if (停()) 记('⏹ 静了 → 停')
  }
  上次播 = p

  if (录音进程 && 录音进程.exitCode === null && Date.now() - 开始时刻 > 300000) {
    if (停()) 记('⏹ 超过 5 分钟，强制停')
  }
}, 400)

// 边录边发：每 500ms 扫一次有没有新分段
setInterval(() => {
  扫新段(批前缀)
}, 500)

记(`自动录语音已启动：${模式名}｜目标 ${目标秒} 秒｜QQ 后端 ${QQ后端}｜发给 ${私聊QQ || '（未设置，只录不发）'}`)