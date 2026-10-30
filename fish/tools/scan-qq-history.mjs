#!/usr/bin/env node
// 在别的 Windows 机器上找 QQ 群聊记录（SnowLuma 本地库），只读。
//
// 用法（建议用它自带的 node 跑，版本够新、node:sqlite 直接可用）：
//   D:\SnowLuma\app\node.exe scan-qq-history.mjs --group 795789868 --user 2595029053
//   D:\SnowLuma\app\node.exe scan-qq-history.mjs --group 795789868 --user 2595029053 --export 795789868.jsonl
//
// 它会：
//   1. 从各个盘（或 --roots 指定的目录）里找 SnowLuma 的 messages.db；
//   2. 只读打开，打印每个库的覆盖范围、目标群条数、目标账号条数；
//   3. 指定 --export 时，把目标群导成一份 JSONL，跨库按 message_hash 去重；
//   4. 顺带探测 Tulpa 的 MCP 端口（18777）和 QQ 桥配置里的 SnowLuma 目录。
//
// 不会写任何源库。扫全盘可能要几分钟，用 --roots 收窄更快。

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, basename, resolve } from 'node:path'
import { connect } from 'node:net'

const 跳过目录 = new Set([
  'node_modules', '.git', '$Recycle.Bin', 'System Volume Information', 'Windows', 'WinSxS',
  'Package Cache', 'Temp', 'tmp', 'proc', 'sys', 'dev', 'snap', 'cache', 'Cache',
])

function 读取参数(argv) {
  const 参 = { roots: [], maxDepth: 8, group: '', user: '', export: '', help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--group') 参.group = String(argv[++i] || '')
    else if (a === '--user') 参.user = String(argv[++i] || '')
    else if (a === '--export') 参.export = String(argv[++i] || '')
    else if (a === '--roots') 参.roots.push(...String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean))
    else if (a === '--max-depth') 参.maxDepth = Number(argv[++i]) || 8
    else if (a === '--help' || a === '-h') 参.help = true
  }
  return 参
}

function 打印帮助() {
  console.log(`找 QQ 群聊记录（SnowLuma messages.db，只读）

用法:
  node scan-qq-history.mjs --group <群号> [--user <QQ号>] [--export <输出.jsonl>]
                           [--roots C:\\,D:\\,C:\\Users\\你] [--max-depth 8]

说明:
  --group     要统计/导出的群号（必填才会做统计）
  --user      附带统计这个人发了多少条（可选）
  --export    把目标群导成 JSONL；跨库按 message_hash 去重，按时间排序
  --roots     只扫这些目录；不填就扫所有盘符
  --max-depth 每个根往下最多钻几层（默认 8）

跑完把 --export 生成的 jsonl（或原始 messages.db）拷回主机的 data/clone/raw/。
`)
}

function 默认根() {
  const 根 = []
  for (const 字 of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const p = `${字}:\\`
    try {
      if (existsSync(p)) 根.push(p)
    } catch (e) {
      // 没插的盘符直接跳过。
    }
  }
  if (根.length === 0) 根.push(process.cwd())
  return 根
}

function 走目录(根, 最大深度, 找到) {
  const 栈 = [{ dir: 根, depth: 0 }]
  let 看过 = 0
  while (栈.length > 0) {
    const { dir, depth } = 栈.pop()
    看过 += 1
    if (看过 % 4000 === 0) process.stdout.write(`  …扫了 ${看过} 个目录\n`)
    let 项
    try {
      项 = readdirSync(dir, { withFileTypes: true })
    } catch (e) {
      continue
    }
    for (const 条 of 项) {
      const 名 = 条.name
      const 全 = join(dir, 名)
      if (条.isDirectory()) {
        if (depth >= 最大深度) continue
        if (跳过目录.has(名)) continue
        if (名.startsWith('$')) continue
        栈.push({ dir: 全, depth: depth + 1 })
      } else if (条.isFile()) {
        const 小 = 名.toLowerCase()
        if (小 === 'messages.db') 找到({ kind: 'db', path: 全 })
        else if (小 === 'qq-bridge-config.json') 找到({ kind: 'bridge', path: 全 })
      }
    }
  }
  return 看过
}

async function 读库(path, 目标群, 目标人) {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const 表 = db.prepare("select name from sqlite_master where type='table' and name='messages'").get()
    if (!表) return null
    const 列 = new Set(db.prepare('pragma table_info(messages)').all().map((c) => c.name))
    if (!列.has('data')) return null
    const 总量 = db.prepare('select count(*) n, min(timestamp) a, max(timestamp) b from messages').get()
    const 群 = db.prepare(`select session_id, count(*) n, min(timestamp) a, max(timestamp) b
      from messages where is_group=1 group by session_id order by n desc limit 15`).all()
    let 目标 = null
    let 本人 = null
    if (目标群 !== '') {
      const 条件 = `is_group=1 and session_id=${Number(目标群) || 'NULL'}`
      目标 = db.prepare(`select count(*) n, min(timestamp) a, max(timestamp) b from messages where ${条件}`).get()
      if (目标人 !== '') {
        本人 = db.prepare(`select count(*) n from messages where ${条件}
          and json_extract(data,'$.user_id')=${Number(目标人) || 'NULL'}`).get()
      }
    }
    return { 列, 总量, 群, 目标, 本人, 目标群 }
  } finally {
    db.close()
  }
}

function 读桥配置(path) {
  try {
    const c = JSON.parse(readFileSync(path, 'utf8'))
    const 摘要 = []
    const 找 = (o, p = '') => {
      if (o === null || typeof o !== 'object') return
      for (const [k, v] of Object.entries(o)) {
        if (v !== null && typeof v === 'object') {
          找(v, `${p}/${k}`)
        } else if (typeof v === 'string' && (/目录|directory|^dir$|路径/i.test(k) || /^[A-Za-z]:[\\/]/.test(v) || v.startsWith('\\\\'))) {
          if (!/密码|password|令牌|token|secret/i.test(k)) 摘要.push(`${p}/${k} = ${v}`)
        }
      }
    }
    找(c)
    return 摘要
  } catch (e) {
    return []
  }
}

function 时刻(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return '—'
  const ms = n < 1e11 ? n * 1000 : n
  const d = new Date(ms)
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function 段文字(段) {
  if (!Array.isArray(段)) return ''
  const 出 = []
  for (const 块 of 段) {
    if (!块 || typeof 块 !== 'object') continue
    if (块.type === 'text' && 块.data && typeof 块.data.text === 'string') 出.push(块.data.text)
    else if (块.type === 'image') 出.push('[图片]')
    else if (块.type === 'face') 出.push('[表情]')
    else if (块.type === 'mface') 出.push('[表情]')
    else if (块.type === 'record') 出.push('[语音]')
    else if (块.type === 'video') 出.push('[视频]')
    else if (块.type === 'file') 出.push('[文件]')
  }
  return 出.join(' ')
}

function 导群(库们, 目标群, 输出) {
  const 见 = new Map()
  let 坏 = 0
  for (const 库 of 库们) {
    let 行
    try {
      行 = 库.db.prepare(`select cast(message_hash as text) h, timestamp, data
        from messages where is_group=1 and session_id=${Number(目标群)} order by timestamp`).all()
    } catch (e) {
      行 = 库.db.prepare(`select rowid as h, timestamp, data
        from messages where is_group=1 and session_id=${Number(目标群)} order by timestamp`).all()
    }
    for (const r of 行) {
      let d
      try {
        d = JSON.parse(r.data)
      } catch (e) {
        坏 += 1
        continue
      }
      const 键 = r.h !== null && r.h !== undefined ? String(r.h) : `${r.timestamp}|${d.message_id}|${d.raw_message}`
      if (见.has(键)) continue
      见.set(键, { 库: 库.标签, r, d })
    }
  }
  const 行们 = [...见.values()].sort((a, b) => Number(a.r.timestamp) - Number(b.r.timestamp))
  const 文 = 行们.map(({ 库, r, d }) => {
    const 段 = Array.isArray(d.message) ? d.message : []
    const 引 = 段.find((s) => s && s.type === 'reply')
    const at = 段.filter((s) => s && s.type === 'at').map((s) => s.data && s.data.qq).filter(Boolean)
    return JSON.stringify({
      ts: Number(r.timestamp),
      time: 时刻(r.timestamp),
      room: String(d.group_id || d.session_id || 目标群),
      group_name: d.group_name || '',
      uid: String(d.user_id || (d.sender && d.sender.user_id) || ''),
      name: (d.sender && d.sender.nickname) || '',
      card: (d.sender && d.sender.card) || '',
      role: (d.sender && d.sender.role) || '',
      text: 段文字(段),
      raw: d.raw_message || '',
      reply: 引 && 引.data ? String(引.data.id || '') : '',
      at,
      mid: d.message_id === undefined ? '' : String(d.message_id),
      seq: d.message_seq === undefined ? 0 : Number(d.message_seq),
      src: 库,
    })
  })
  mkdirSync(dirname(resolve(输出)), { recursive: true })
  writeFileSync(输出, 文.join('\n') + (文.length > 0 ? '\n' : ''), 'utf8')
  return { 条数: 文.length, 坏, 人: new Set(行们.map(({ d }) => String(d.user_id || ''))).size }
}

async function 探测Tulpa() {
  return new Promise((完成) => {
    const s = connect({ host: '127.0.0.1', port: 18777 })
    const 收 = (v) => {
      s.destroy()
      完成(v)
    }
    s.setTimeout(800, () => 收(false))
    s.on('connect', () => 收(true))
    s.on('error', () => 收(false))
  })
}

const 参 = 读取参数(process.argv.slice(2))
if (参.help) {
  打印帮助()
  process.exit(0)
}

const 根 = 参.roots.length > 0 ? 参.roots.map((p) => resolve(p)) : 默认根()
console.log(`扫描根目录：${根.join('  ')}（最多 ${参.maxDepth} 层）`)

const 库路径 = []
const 桥路径 = []
for (const r of 根) {
  console.log(`\n== ${r}`)
  const 看过 = 走目录(r, 参.maxDepth, (项) => {
    if (项.kind === 'db') {
      if (!库路径.includes(项.path)) {
        库路径.push(项.path)
        console.log(`  [库] ${项.path}`)
      }
    } else if (!桥路径.includes(项.path)) {
      桥路径.push(项.path)
      console.log(`  [桥配置] ${项.path}`)
    }
  })
  console.log(`  扫过 ${看过} 个目录`)
}

if (桥路径.length > 0) {
  console.log('\n== 桥配置里的 SnowLuma 目录')
  for (const p of 桥路径) {
    for (const 行 of 读桥配置(p)) console.log(`  ${p}\n    ${行}`)
  }
}

const 库们 = []
console.log(`\n== 找到 ${库路径.length} 个消息库`)
for (const p of 库路径) {
  let 大小 = ''
  try {
    大小 = `${(statSync(p).size / 1024 / 1024).toFixed(1)} MB`
  } catch (e) {
    continue
  }
  let 读
  try {
    读 = await 读库(p, 参.group, 参.user)
  } catch (e) {
    console.log(`  ${p}: 打不开（${String(e.message || e).slice(0, 80)}）`)
    continue
  }
  if (读 === null) {
    console.log(`  ${p}: 不是 SnowLuma 的消息表，跳过`)
    continue
  }
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(p, { readOnly: true })
  库们.push({ db, 标签: p.split(/[\\/]/).slice(-3).join('/') })
  console.log(`\n  ${p}  (${大小})`)
  console.log(`    总量 ${读.总量.n}，范围 ${时刻(读.总量.a)} → ${时刻(读.总量.b)}`)
  for (const g of 读.群) {
    const 记 = 参.group !== '' && String(g.session_id) === String(参.group) ? '  ← 目标群' : ''
    console.log(`    群 ${g.session_id}: ${g.n} 条，${时刻(g.a)} → ${时刻(g.b)}${记}`)
  }
  if (读.目标 !== null && 读.目标 !== undefined) {
    console.log(`    目标群合计 ${读.目标.n} 条，${时刻(读.目标.a)} → ${时刻(读.目标.b)}`)
    if (读.本人 !== null && 读.本人 !== undefined) console.log(`    其中 ${参.user} 发了 ${读.本人.n} 条`)
  }
}

if (库们.length === 0) {
  console.log('\n没找到可读的消息库。再试试：\n  · --roots 指向 SnowLuma 安装目录或它的 data 目录\n  · 确认这台机器上跑过 SnowLuma（<安装目录>/data/<机器人QQ>/messages.db）')
}

if (参.export !== '') {
  if (库们.length === 0) {
    console.log('\n没有库可导。')
  } else {
    const 结果 = 导群(库们, 参.group, 参.export)
    console.log(`\n== 导出 ${参.export}`)
    console.log(`  ${结果.条数} 条（跨库去重），${结果.人} 个说话人${结果.坏 > 0 ? `，${结果.坏} 条解析失败已跳过` : ''}`)
    if (参.user !== '') {
      const 行 = readFileSync(参.export, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
      console.log(`  其中 ${参.user}: ${行.filter((x) => x.uid === String(参.user)).length} 条`)
    }
    console.log('  把它拷回主机的 data/clone/raw/ 下。')
  }
}

for (const 库 of 库们) 库.db.close()

const Tulpa开着 = await 探测Tulpa()
console.log(`\n== Tulpa MCP（127.0.0.1:18777）：${Tulpa开着 ? '开着，历史可能更全，先别关' : '没开'}`)
console.log(`
下一步：
  1. 把导出的 jsonl（或原始 messages.db 加 -wal、-shm 两个同名文件）拷回主机 data/clone/raw/；
  2. 有 Tulpa 的话保持运行，把 MCP 地址和令牌给主机，走导入器扩群聊；
  3. 都没有就让号主在电脑 QQ「消息管理器」里导出这个群的记录（txt/mht），同样放进 data/clone/raw/。
`)
