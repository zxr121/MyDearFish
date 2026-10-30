// DSH「通到 QQ」· SnowLuma 安装与配置
//
// 固定用 SnowLuma：一键下载官方 Windows 发行包、解压、写好 OneBot HTTP、
// 事件上报和后台密码，然后启动。用户只剩两步：登录鱼 QQ、在 SnowLuma
// 后台把那个 QQ 进程接进来。
//
// ⚠ 不替用户接受协议：必须由界面勾选，启动时用 SNOWLUMA_ACCEPT_* 环境变量传入。

import { createHash, randomBytes, scryptSync } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import {
  closeSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createServer } from 'node:net'

export const 后台端口 = 5099
export const 默认OneBot端口 = 3000
/** 认已有实例时先看这几个常见端口；3000 可能被 Grafana 之类的程序占着，SnowLuma 在 3002 被占时会顺延到 3003。 */
export const 认得的OneBot端口 = [3002, 3003, 3000]
const 发行接口 = 'https://api.github.com/repos/SnowLuma/SnowLuma/releases/latest'
const 镜像前缀 = [
  'https://gh-proxy.com/',
  'https://ghproxy.net/',
]
const 探测缓存毫秒 = 2000
const 事件客户端名 = 'dsh-event'
const 默认启动文件 = '.dsh-launch.json'

/** 发布查询直连优先；ghproxy.net 不代理 API，只让 gh-proxy 参与兜底。 */
export function 发行地址候选() {
  return [发行接口, `https://gh-proxy.com/${发行接口}`]
}

/** 发行包先走国内镜像，最后回 GitHub 直连；摘要仍以官方 API 的 digest 为准。 */
export function 下载地址候选(地址) {
  return [...镜像前缀.map((前缀) => `${前缀}${地址}`), 地址]
}

function 读JSON(文件, 兜 = null) {
  try {
    return JSON.parse(readFileSync(文件, 'utf8'))
  } catch (error) {
    return 兜
  }
}

function 写JSON(文件, 值) {
  mkdirSync(dirname(文件), { recursive: true })
  const 临时 = `${文件}.tmp.${process.pid}`
  writeFileSync(临时, JSON.stringify(值, null, 2), 'utf8')
  renameSync(临时, 文件)
}

/** 从 OneBot HTTP 地址里取端口；地址不合法时回退默认端口。 */
export function 取端口(地址) {
  try {
    const u = new URL(String(地址 || ''))
    const 端口 = Number(u.port || (u.protocol === 'https:' ? 443 : 80))
    return Number.isInteger(端口) && 端口 > 0 ? 端口 : 默认OneBot端口
  } catch (error) {
    return 默认OneBot端口
  }
}

/** 去掉末尾斜杠；空值或非 http(s) 地址回退到本机默认端口。 */
export function 规范OneBot地址(值) {
  const 文本 = String(值 || '').trim().replace(/\/+$/, '')
  try {
    const u = new URL(文本)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('协议不对')
    return 文本
  } catch (error) {
    return `http://127.0.0.1:${默认OneBot端口}`
  }
}

function 端口空着(端口) {
  return new Promise((resolve) => {
    const 服 = createServer()
    服.once('error', () => resolve(false))
    服.listen(端口, '127.0.0.1', () => 服.close(() => resolve(true)))
  })
}

export function 是SnowLuma目录(目录) {
  try {
    return existsSync(join(目录, 'index.mjs')) && existsSync(join(目录, 'node.exe'))
  } catch (error) {
    return false
  }
}

export function 读SnowLuma版本(目录) {
  const 发布 = 读JSON(join(目录, 'release.json'), null)
  if (发布 && typeof 发布.version === 'string') return 发布.version
  const 包 = 读JSON(join(目录, 'package.json'), null)
  return 包 && typeof 包.version === 'string' ? 包.version : ''
}

const 协议文件们 = [
  ['eula', 'EULA.md'],
  ['privacy', 'PRIVACY.md'],
]

/**
 * 算安装目录里协议正文的版本号。算法与 SnowLuma 的 consent.json 一致：
 * sha256(id\0正文\0 …) 取前 16 位；正文没改，旧同意跨版本仍然有效。
 * @param {string} 目录 - SnowLuma 安装目录。
 * @returns {string} 16 位十六进制；两份协议都读不到时为空。
 */
export function 协议指纹(目录) {
  const 哈希 = createHash('sha256')
  let 有正文 = 0
  for (const [id, 文件] of 协议文件们) {
    let 文本 = ''
    try {
      文本 = readFileSync(join(目录, 文件), 'utf8')
    } catch (error) {}
    if (文本.trim() !== '') 有正文++
    哈希.update(id)
    哈希.update('\0')
    哈希.update(文本)
    哈希.update('\0')
  }
  return 有正文 > 0 ? 哈希.digest('hex').slice(0, 16) : ''
}

/**
 * 看安装目录里有没有主人以前接受、且协议正文没改过的同意记录。
 * 只认 SnowLuma 自己写的 config/consent.json；环境变量那种临时同意不算。
 * @param {string} 目录 - SnowLuma 安装目录。
 * @returns {{已同意: boolean, 同意时间: string, 原因: string}} 同意证据。
 */
export function 读SnowLuma同意(目录) {
  const 记录 = 读JSON(join(目录, 'config', 'consent.json'), null)
  if (!记录 || typeof 记录.version !== 'string' || 记录.version === '') {
    return { 已同意: false, 同意时间: '', 原因: '没有同意记录' }
  }
  const 现在 = 协议指纹(目录)
  if (现在 !== '' && 现在 !== 记录.version) {
    return { 已同意: false, 同意时间: String(记录.acceptedAt || ''), 原因: '协议正文更新过' }
  }
  return { 已同意: true, 同意时间: String(记录.acceptedAt || ''), 原因: '' }
}

const 要看的盘 = ['C', 'D', 'E', 'F', 'G', 'H']

/**
 * 本机常见的 SnowLuma 位置：安装器、压缩包解压、盘根三种习惯都列一遍。
 * 只做存在性检查，不递归扫盘；环境参数可替换，测试不会碰到真机器。
 * @param {Record<string, string|undefined>} 环境 - 用来取 LOCALAPPDATA / ProgramFiles 等目录。
 * @param {string} 家 - 用户目录。
 * @returns {{路径: string, 来源: string}[]} 去重后的候选位置，不保证真的装了。
 */
export function 常见安装目录(环境 = process.env, 家 = homedir()) {
  const 出 = []
  const 见过 = new Set()
  const 加 = (路径, 来源) => {
    if (!路径 || typeof 路径 !== 'string') return
    const 目录 = resolve(路径)
    const 键 = 目录.toLowerCase()
    if (见过.has(键)) return
    见过.add(键)
    出.push({ 路径: 目录, 来源 })
  }
  const 本机 = 环境.LOCALAPPDATA
  if (本机) {
    加(join(本机, 'SnowLuma', 'app'), '本机应用')
    加(join(本机, 'SnowLuma', 'snowluma'), '本机应用')
    加(join(本机, 'SnowLuma'), '本机应用')
    加(join(本机, 'Programs', 'SnowLuma', 'app'), '本机程序')
    加(join(本机, 'Programs', 'SnowLuma'), '本机程序')
  }
  const 漫游 = 环境.APPDATA
  if (漫游) {
    加(join(漫游, 'SnowLuma', 'app'), '用户配置')
    加(join(漫游, 'SnowLuma'), '用户配置')
  }
  const 公共 = 环境.ProgramData
  if (公共) {
    加(join(公共, 'SnowLuma', 'app'), '公共程序')
    加(join(公共, 'SnowLuma'), '公共程序')
  }
  for (const 根 of [环境.ProgramFiles, 环境['ProgramFiles(x86)']]) {
    if (!根) continue
    加(join(根, 'SnowLuma', 'app'), '程序目录')
    加(join(根, 'SnowLuma'), '程序目录')
  }
  if (家) {
    加(join(家, 'snowluma'), '用户目录')
    加(join(家, 'SnowLuma', 'app'), '用户目录')
    加(join(家, 'Desktop', 'SnowLuma', 'app'), '桌面')
    加(join(家, 'Desktop', 'SnowLuma'), '桌面')
    加(join(家, 'Downloads', 'SnowLuma', 'app'), '下载目录')
    加(join(家, 'Downloads', 'SnowLuma'), '下载目录')
  }
  // 解压到盘根（D:\SnowLuma\app）是最省事的装法，Windows 上顺手看一眼
  if (process.platform === 'win32') {
    for (const 盘 of 要看的盘) {
      加(`${盘}:\\SnowLuma\\app`, `${盘} 盘`)
      加(`${盘}:\\SnowLuma`, `${盘} 盘`)
    }
  }
  return 出
}

export function 生成后台密码() {
  return randomBytes(8).toString('hex')
}

export function 写后台密码(目录, 密码) {
  const 明文 = String(密码 || '')
  if (明文 === '') throw new Error('后台密码不能为空')
  const 盐 = randomBytes(16)
  const 哈希 = scryptSync(明文, 盐, 64, { N: 16384, r: 8, p: 1 })
  const 文件 = join(目录, 'config', 'webui.json')
  const 旧 = 读JSON(文件, {})
  const 现在 = new Date().toISOString()
  写JSON(文件, {
    passwordHash: 哈希.toString('hex'),
    passwordSalt: 盐.toString('hex'),
    mustChangePassword: false,
    generatedAt: (旧 && 旧.generatedAt) || 现在,
    updatedAt: 现在,
  })
  return 文件
}

/** 把 OneBot HTTP 服务收到本机指定端口，并加一个把事件推给 DSH 的 httpClient。 */
export function 写OneBot配置(文件, 事件地址, 端口 = 默认OneBot端口) {
  const 原 = 读JSON(文件, {})
  const 源 = 原 && typeof 原 === 'object' && !Array.isArray(原) ? 原 : {}
  const 网 = 源.networks && typeof 源.networks === 'object' && !Array.isArray(源.networks) ? 源.networks : {}

  const 服务器们 = Array.isArray(网.httpServers) ? 网.httpServers.map((x) => ({ ...x })) : []
  const 服务器位 = 服务器们.findIndex((x) => x && x.name === 'http-default')
  const 服务器 = {
    ...(服务器位 >= 0 && 服务器们[服务器位] ? 服务器们[服务器位] : {}),
    name: 'http-default',
    enabled: true,
    host: '127.0.0.1',
    port: 端口,
    path: '/',
    enableWebSocket: false,
    messageFormat: 'array',
    reportSelfMessage: false,
  }
  delete 服务器.accessToken
  if (服务器位 >= 0) 服务器们[服务器位] = 服务器
  else 服务器们.push(服务器)

  const 客户端们 = Array.isArray(网.httpClients) ? 网.httpClients.map((x) => ({ ...x })) : []
  const 客户端位 = 客户端们.findIndex((x) => x && x.name === 事件客户端名)
  const 客户端 = {
    ...(客户端位 >= 0 && 客户端们[客户端位] ? 客户端们[客户端位] : {}),
    name: 事件客户端名,
    enabled: true,
    url: String(事件地址 || ''),
    messageFormat: 'array',
    reportSelfMessage: false,
  }
  delete 客户端.accessToken
  if (客户端位 >= 0) 客户端们[客户端位] = 客户端
  else 客户端们.push(客户端)

  // SnowLuma 2.x 默认开着群里的 #sl 状态指令，会在群里冒一张机器人口径的状态卡；
  // 状态在鱼的设置页看，装好 / 升级后都保持关闭。
  const 状态指令 = 源.statusCommand && typeof 源.statusCommand === 'object' && !Array.isArray(源.statusCommand) ? 源.statusCommand : {}

  写JSON(文件, {
    ...源,
    statusCommand: { ...状态指令, enabled: false },
    networks: { ...网, httpServers: 服务器们, httpClients: 客户端们 },
  })
  return 文件
}

/** 写运行端口、全局 OneBot，以及所有已经在用的 per-UIN 快照。 */
export function 写SnowLuma配置(目录, 事件地址, 端口 = 默认OneBot端口) {
  const 配置目录 = join(目录, 'config')
  mkdirSync(配置目录, { recursive: true })

  const 运行文件 = join(配置目录, 'runtime.json')
  const 运行 = 读JSON(运行文件, {})
  写JSON(运行文件, {
    ...(运行 && typeof 运行 === 'object' && !Array.isArray(运行) ? 运行 : {}),
    webuiHost: '127.0.0.1',
    webuiPort: 后台端口,
  })

  const 写了 = [运行文件]
  写了.push(写OneBot配置(join(配置目录, 'onebot.json'), 事件地址, 端口))

  let 账号文件 = []
  try {
    账号文件 = readdirSync(配置目录).filter((名) => /^onebot_\d+\.json$/.test(名))
  } catch (error) {}
  for (const 名 of 账号文件) {
    try {
      写了.push(写OneBot配置(join(配置目录, 名), 事件地址, 端口))
    } catch (error) {}
  }
  return 写了
}

export function 创建SnowLuma({ 家目录, 读配置, 存配置, 记账, 事件地址 }) {
  let 安装任务 = { 进行中: false, 阶段: '', 错: '', 已下载: 0, 总: 0 }
  let 探测缓存 = { at: 0, 值: null, 进行中: null }
  let 发现缓存 = { at: 0, 值: [], 进行中: null }
  const 发现毫秒 = 30_000

  const 绝对目录 = (值) => {
    const 文本 = typeof 值 === 'string' ? 值.trim() : ''
    if (文本 === '') return ''
    try {
      return resolve(isAbsolute(文本) ? 文本 : join(家目录, 文本))
    } catch (error) {
      return ''
    }
  }

  const 读PID = (目录) => {
    const 存 = 读JSON(join(目录, 默认启动文件), null)
    const pid = Number(存 && 存.pid)
    return Number.isInteger(pid) && pid > 0 ? pid : 0
  }

  const 进程在 = (pid) => {
    if (!pid) return false
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      return false
    }
  }

  const 跑PowerShell = (脚本, 毫秒 = 8000) =>
    new Promise((resolve) => {
      try {
        execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', 脚本],
          { windowsHide: true, timeout: 毫秒, maxBuffer: 4 * 1024 * 1024 },
          (错, 标准输出) => resolve(错 ? '' : String(标准输出 || '')),
        )
      } catch (error) {
        resolve('')
      }
    })

  /**
   * 找本机正在运行的 SnowLuma：它自带 node.exe，命令行是 `node.exe index.mjs`，
   * 用可执行文件所在目录反推安装位置。PowerShell 一次问完，结果缓存 30 秒。
   */
  async function 找运行中的SnowLuma() {
    const 现在 = Date.now()
    if (现在 - 发现缓存.at < 发现毫秒) return 发现缓存.值
    if (发现缓存.进行中) return 发现缓存.进行中
    发现缓存.进行中 = (async () => {
      const 出 = []
      if (process.platform === 'win32') {
        const 文本 = await 跑PowerShell(
          'Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'" | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress',
        )
        let 清单 = []
        try {
          清单 = JSON.parse(文本)
        } catch (error) {
          清单 = []
        }
        if (!Array.isArray(清单)) 清单 = 清单 && typeof 清单 === 'object' ? [清单] : []
        for (const 项 of 清单) {
          const 可执行 = String((项 && 项.ExecutablePath) || '')
          if (可执行 === '') continue
          const 目录 = dirname(可执行)
          if (!是SnowLuma目录(目录)) continue
          if (出.some((x) => x.目录.toLowerCase() === 目录.toLowerCase())) continue
          出.push({ 目录, pid: Number(项.ProcessId) || 0 })
        }
      }
      发现缓存 = { at: Date.now(), 值: 出, 进行中: null }
      return 出
    })()
    return 发现缓存.进行中
  }

  /** 这个目录能不能当作「主人以前同意过」：SnowLuma 自己的 consent.json，或我们拉起过它的启动记录。 */
  const 同意证据 = (目录) => {
    const 记录 = 读SnowLuma同意(目录)
    if (记录.已同意) return 记录
    if (进程在(读PID(目录))) return { 已同意: true, 同意时间: '', 原因: '这个目录是 DSH 之前启动的' }
    return 记录
  }

  const 候选目录 = (配置) => {
    const 出 = []
    const 加 = (路径, 来源, 运行中 = false) => {
      const 目录 = 绝对目录(路径)
      if (目录 === '' || 出.some((x) => x.目录.toLowerCase() === 目录.toLowerCase())) return
      if (!是SnowLuma目录(目录)) return
      出.push({
        目录,
        来源,
        版本: 读SnowLuma版本(目录),
        运行中,
        同意: 同意证据(目录),
      })
    }
    const 指定 = 绝对目录(配置 && 配置.SnowLuma && 配置.SnowLuma.目录)
    const 运行中 = 发现缓存.值 || []
    if (指定 !== '') 加(指定, '设置里指定', 运行中.some((x) => x.目录.toLowerCase() === 指定.toLowerCase()))
    for (const x of 运行中) 加(x.目录, '正在运行', true)
    加(join(家目录, 'snowluma'), '数据目录')
    if (basename(家目录).toLowerCase() === '.dsh') 加(join(dirname(家目录), 'tools', 'snowluma'), '工作区')
    加(join(homedir(), 'snowluma'), '用户目录')
    for (const x of 常见安装目录()) 加(x.路径, x.来源)
    return 出
  }

  const 目标目录 = (配置) => {
    const 指定 = 绝对目录(配置 && 配置.SnowLuma && 配置.SnowLuma.目录)
    if (指定 !== '') return 指定
    const 候选 = 候选目录(配置)
    return 候选.length > 0 ? 候选[0].目录 : join(家目录, 'snowluma')
  }

  const 改配置 = (改) => {
    const 现在 = 读配置()
    const { NapCat, ...雪 } = 改
    存配置({
      ...现在,
      ...(NapCat ? { NapCat } : {}),
      SnowLuma: { ...(现在.SnowLuma || {}), ...雪 },
    })
    刷新探测()
  }

  async function 探OneBot(地址) {
    const 基 = 规范OneBot地址(地址)
    let 谁 = 基
    try {
      谁 = new URL(基).host
    } catch (error) {}
    try {
      const r = await fetch(`${基}/get_login_info`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(2500),
      })
      const 文本 = await r.text().catch(() => '')
      let j = null
      try {
        j = JSON.parse(文本)
      } catch (error) {}
      if (j && j.status === 'ok' && j.data) {
        return { ok: true, 地址: 基, 用户: String(j.data.user_id || ''), 昵称: String(j.data.nickname || '') }
      }
      if (j && (typeof j.retcode === 'number' || typeof j.status === 'string')) {
        return { ok: false, 是OneBot: true, 地址: 基, 错: `${谁} 上是 OneBot，但还没登录 QQ` }
      }
      return { ok: false, 地址: 基, 错: `${谁} 上响应的不是 OneBot（端口被别的程序占用了）` }
    } catch (error) {
      return { ok: false, 地址: 基, 错: `${谁} 没有回应（SnowLuma 没启动，或 HTTP 服务没开）` }
    }
  }

  /**
   * 配置里的地址先问；没登录也算认得这个 OneBot。
   * 都没人应答时才挑空闲端口，避免再撞上 3000 这种被别的程序占着的口。
   */
  async function 选OneBot地址(配置) {
    const 先看 = [规范OneBot地址(配置 && 配置.NapCat)]
    for (const 端口 of 认得的OneBot端口) {
      const 地址 = `http://127.0.0.1:${端口}`
      if (!先看.includes(地址)) 先看.push(地址)
    }
    let 没登录 = null
    for (const 地址 of 先看) {
      const 探 = await 探OneBot(地址)
      if (探.ok) return { 地址, 探, 沿用: true }
      if (探.是OneBot && !没登录) 没登录 = { 地址, 探, 沿用: true }
    }
    if (没登录) return 没登录

    const 想用 = 取端口(规范OneBot地址(配置 && 配置.NapCat))
    const 候选 = [想用, ...认得的OneBot端口.filter((x) => x !== 想用)]
    for (let 端口 = 3000; 端口 <= 3099; 端口++) {
      if (端口 !== 3001 && !候选.includes(端口)) 候选.push(端口)
    }
    for (const 端口 of 候选) {
      if (await 端口空着(端口)) return { 地址: `http://127.0.0.1:${端口}`, 探: null, 沿用: false }
    }
    throw new Error('本机找不到空闲的 OneBot HTTP 端口（3000–3099 都被占了）')
  }

  async function 探后台() {
    try {
      await fetch(`http://127.0.0.1:${后台端口}/`, { signal: AbortSignal.timeout(1200) })
      return true
    } catch (error) {
      return false
    }
  }

  async function 探测() {
    const 现在 = Date.now()
    if (探测缓存.值 && 现在 - 探测缓存.at < 探测缓存毫秒) return 探测缓存.值
    if (探测缓存.进行中) return 探测缓存.进行中
    探测缓存.进行中 = (async () => {
      try {
        const 地址 = 规范OneBot地址(读配置().NapCat)
        const [OneBot, 后台] = await Promise.all([探OneBot(地址), 探后台()])
        const 值 = { 运行中: OneBot.ok || OneBot.是OneBot || 后台, 后台在跑: 后台, OneBot地址: 地址, ...OneBot }
        探测缓存 = { at: Date.now(), 值, 进行中: null }
        return 值
      } catch (error) {
        探测缓存 = { at: Date.now(), 值: { 运行中: false, 后台在跑: false, ok: false, 错: String(error?.message || error) }, 进行中: null }
        return 探测缓存.值
      }
    })()
    return 探测缓存.进行中
  }

  const 刷新探测 = () => {
    探测缓存 = { at: 0, 值: null, 进行中: null }
  }

  function 快照() {
    const 配置 = 读配置()
    const 目录 = 目标目录(配置)
    const 已安装 = 是SnowLuma目录(目录)
    const 候选 = 候选目录(配置)
    const 首个 = 候选[0] || null
    return {
      ok: true,
      目录,
      已安装,
      版本: 已安装 ? 读SnowLuma版本(目录) : '',
      候选,
      认出: 首个
        ? {
            目录: 首个.目录,
            来源: 首个.来源,
            版本: 首个.版本,
            运行中: 首个.运行中,
            已同意: !!(首个.同意 && 首个.同意.已同意),
            同意时间: (首个.同意 && 首个.同意.同意时间) || '',
          }
        : null,
      后台: { 地址: `http://127.0.0.1:${后台端口}/`, 密码: String((配置.SnowLuma && 配置.SnowLuma.后台密码) || '') },
      同意协议: !!(配置.SnowLuma && 配置.SnowLuma.同意协议),
      自动启动: !!(配置.SnowLuma && 配置.SnowLuma.自动启动),
      是我们启动的: 进程在(读PID(目录)),
      安装: { ...安装任务 },
    }
  }

  async function 状态() {
    const 配置 = 读配置()
    const 目录 = 目标目录(配置)
    const 已安装 = 是SnowLuma目录(目录)
    const 探 = await 探测()
    return {
      ...快照(),
      运行中: 探.运行中,
      后台在跑: 探.后台在跑,
      OneBot: 探.OneBot地址,
      已连QQ: 探.ok === true,
      外部实例: !进程在(读PID(目录)) && 探.后台在跑,
      昵称: 探.昵称 || '',
      用户: 探.用户 || '',
      错: 探.ok ? '' : String(探.错 || ''),
    }
  }

  async function 等就绪(毫秒 = 25000) {
    const 截止 = Date.now() + 毫秒
    while (Date.now() < 截止) {
      刷新探测()
      const 探 = await 探测()
      if (探.运行中) return 探
      await new Promise((r) => setTimeout(r, 700))
    }
    return null
  }

  function 启动(目录, 同意协议) {
    if (!是SnowLuma目录(目录)) throw new Error('这个目录里没有 SnowLuma（缺 index.mjs 或 node.exe）')
    const 旧 = 读PID(目录)
    if (进程在(旧)) return 旧
    const 日志目录 = join(目录, 'logs')
    mkdirSync(日志目录, { recursive: true })
    const 日志 = join(日志目录, 'dsh-launch.log')
    const 句柄 = openSync(日志, 'a')
    const 环境 = { ...process.env }
    if (同意协议) {
      环境.SNOWLUMA_ACCEPT_EULA = '1'
      环境.SNOWLUMA_ACCEPT_PRIVACY = '1'
    }
    let 子
    try {
      子 = spawn(join(目录, 'node.exe'), ['index.mjs'], {
        cwd: 目录,
        detached: true,
        windowsHide: true,
        stdio: ['ignore', 句柄, 句柄],
        env: 环境,
      })
    } finally {
      closeSync(句柄)
    }
    子.unref()
    写JSON(join(目录, 默认启动文件), { pid: 子.pid, at: Date.now() })
    刷新探测()
    return 子.pid
  }

  function 停止(目录) {
    const pid = 读PID(目录)
    if (!pid) return false
    const 在 = 进程在(pid)
    if (在) {
      try {
        execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {})
      } catch (error) {}
    }
    rmSync(join(目录, 默认启动文件), { force: true })
    刷新探测()
    return 在
  }

  const 跑命令 = (命令, 参数) =>
    new Promise((resolve, reject) => {
      execFile(命令, 参数, { windowsHide: true, timeout: 5 * 60_000 }, (错, 标准输出, 错误输出) => {
        if (错) {
          const 说 = String(错误输出 || 标准输出 || 错.message || 错).trim()
          reject(new Error(说.slice(0, 500)))
        } else resolve()
      })
    })

  async function 解压(压缩包, 目录) {
    mkdirSync(目录, { recursive: true })
    const tar = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    if (existsSync(tar)) {
      await 跑命令(tar, ['-xf', 压缩包, '-C', 目录])
      return
    }
    const 单引 = (s) => String(s).replace(/'/g, "''")
    await 跑命令('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${单引(压缩包)}' -DestinationPath '${单引(目录)}' -Force`,
    ])
  }

  async function 取发布() {
    const 失败 = []
    for (const 地址 of 发行地址候选()) {
      const 名 = 地址 === 发行接口 ? 'GitHub 直连' : 'gh-proxy 镜像'
      try {
        const r = await fetch(地址, {
          headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-qq-bridge' },
          signal: AbortSignal.timeout(20_000),
        })
        if (!r.ok) {
          失败.push(`${名} HTTP ${r.status}`)
          continue
        }
        const 发布 = await r.json()
        if (!发布 || !Array.isArray(发布.assets)) {
          失败.push(`${名} 没返回 assets`)
          continue
        }
        return 发布
      } catch (错) {
        失败.push(`${名} ${String(错?.name || 错?.message || 错).slice(0, 40)}`)
      }
    }
    throw new Error(`查不到 SnowLuma 最新版（${失败.join('；')}）`)
  }

  async function 下载文件(地址, 文件, 进度) {
    const 控 = new AbortController()
    let 总时限 = setTimeout(() => 控.abort(new Error('下载超时')), 30 * 60_000)
    let 停滞 = setTimeout(() => 控.abort(new Error('连接超时')), 30_000)
    try {
      const 响应 = await fetch(地址, { redirect: 'follow', signal: 控.signal })
      clearTimeout(停滞)
      if (!响应.ok || !响应.body) throw new Error(`HTTP ${响应.status}`)
      停滞 = setTimeout(() => 控.abort(new Error('下载停滞')), 30_000)
      const 哈希 = createHash('sha256')
      let 已 = 0
      await pipeline(
        Readable.fromWeb(响应.body),
        async function* (源) {
          for await (const 块 of 源) {
            已 += 块.length
            哈希.update(块)
            进度(已)
            clearTimeout(停滞)
            停滞 = setTimeout(() => 控.abort(new Error('下载停滞')), 30_000)
            yield 块
          }
        },
        createWriteStream(文件),
      )
      return { 摘要: 哈希.digest('hex'), 已 }
    } finally {
      clearTimeout(总时限)
      clearTimeout(停滞)
    }
  }

  async function 下载并解压(目录) {
    安装任务 = { 进行中: true, 阶段: '查询最新版', 错: '', 已下载: 0, 总: 0 }
    const 发布 = await 取发布()
    const 资产 = (Array.isArray(发布.assets) ? 发布.assets : []).find((a) =>
      /^SnowLuma-v[\d.]+-win-x64\.zip$/i.test(String((a && a.name) || '')),
    )
    if (!资产) throw new Error('SnowLuma 最新版里没有 Windows x64 发行包')
    const 版本 = String(发布.tag_name || '').replace(/^v/, '') || String(资产.name)
    const 期望摘要 = String(资产.digest || '').replace(/^sha256:/i, '').toLowerCase()
    const 期望大小 = Number(资产.size) || 0
    const 下载源 = 下载地址候选(String(资产.browser_download_url))
    const 压缩包 = `${目录}.download.zip`
    mkdirSync(dirname(压缩包), { recursive: true })

    let 已 = 0
    const 失败 = []
    let 成功 = false
    for (const [序号, 地址] of 下载源.entries()) {
      const 标签 = 序号 === 下载源.length - 1 ? 'GitHub 直连' : `镜像 ${序号 + 1}`
      安装任务 = {
        进行中: true,
        阶段: 序号 === 0 ? `下载 SnowLuma v${版本}（国内镜像）` : `换源重试（${标签}）`,
        错: '',
        已下载: 0,
        总: 期望大小,
      }
      try {
        const 结果 = await 下载文件(地址, 压缩包, (n) => { 安装任务.已下载 = n })
        已 = 结果.已
        if (期望摘要 && 结果.摘要 !== 期望摘要) throw new Error('SHA-256 校验失败')
        if (期望大小 && 已 !== 期望大小) throw new Error(`大小不符（${已}/${期望大小}）`)
        成功 = true
        break
      } catch (错) {
        try {
          rmSync(压缩包, { force: true })
        } catch {}
        失败.push(`${标签}：${String(错?.message || 错).slice(0, 80)}`)
      }
    }
    if (!成功) throw new Error(`下载 SnowLuma 失败（已试 ${下载源.length} 个源）：${失败.join('；')}`)

    安装任务 = { ...安装任务, 阶段: '解压', 已下载: 已, 总: 期望大小 || 已 }
    try {
      await 解压(压缩包, 目录)
    } finally {
      rmSync(压缩包, { force: true })
    }
    if (!是SnowLuma目录(目录)) throw new Error('解压完了，但没找到 index.mjs / node.exe')
    return 版本
  }

  async function 执行安装({ 目录, 密码, 自动启动 }) {
    try {
      if (!是SnowLuma目录(目录)) {
        await 下载并解压(目录)
      } else {
        安装任务 = { 进行中: true, 阶段: '配置 SnowLuma', 错: '', 已下载: 0, 总: 0 }
      }

      const 配置 = 读配置()
      const 旧密码 = String((配置.SnowLuma && 配置.SnowLuma.后台密码) || '')
      const 用户密码 = String(密码 || '')
      const 后台文件 = join(目录, 'config', 'webui.json')
      let 新密码 = 用户密码 || 旧密码
      const 要写密码 = 用户密码 !== '' || !existsSync(后台文件)
      if (要写密码) {
        if (新密码 === '') 新密码 = 生成后台密码()
        写后台密码(目录, 新密码)
      }

      const 选定 = await 选OneBot地址(配置)
      写SnowLuma配置(目录, 事件地址(), 取端口(选定.地址))
      改配置({
        目录,
        后台密码: 新密码,
        同意协议: true,
        自动启动: 自动启动 !== false,
        NapCat: 选定.地址,
      })

      安装任务 = { ...安装任务, 阶段: '启动 SnowLuma' }
      刷新探测()
      const 探 = await 探测()
      let 沿用 = false
      if (探.运行中) {
        if (进程在(读PID(目录))) {
          停止(目录)
          await new Promise((r) => setTimeout(r, 800))
          const pid = 启动(目录, true)
          await 等就绪()
          if (!进程在(pid)) throw new Error(`SnowLuma 重启失败：127.0.0.1:${后台端口} 可能被别的程序占用了`)
        } else if (探.ok) {
          沿用 = true
        } else {
          throw new Error(`127.0.0.1:${后台端口} 已经有另一个 SnowLuma 在运行，但 OneBot 用不了：${探.错 || '还没登录 QQ'}。先停掉它，或在高级里把安装目录指向它`)
        }
      } else {
        const pid = 启动(目录, true)
        await 等就绪()
        if (!进程在(pid)) throw new Error(`SnowLuma 没起来：127.0.0.1:${后台端口} 可能被别的程序占用了`)
      }
      安装任务 = { 进行中: false, 阶段: '完成', 错: '', 已下载: 安装任务.已下载, 总: 安装任务.总 }
      记账(`SnowLuma 已就绪（OneBot ${选定.地址}，后台 127.0.0.1:${后台端口}）${沿用 ? '；用的是已经在运行的实例' : ''}`)
    } catch (错) {
      const 说 = String((错 && 错.message) || 错)
      安装任务 = { ...安装任务, 进行中: false, 阶段: '失败', 错: 说 }
      记账(`SnowLuma 安装失败：${说}`)
    }
  }

  function 设置(选项 = {}) {
    if (选项.同意协议 !== true) return { ok: false, 说: '要先勾选同意 SnowLuma 的 EULA 和隐私政策' }
    if (安装任务.进行中) return { ok: true, 说: '正在装，等这一步跑完', 安装: { ...安装任务 } }
    const 配置 = 读配置()
    const 目录 = 绝对目录(选项.目录) || 目标目录(配置)
    if (目录 === '') return { ok: false, 说: 'SnowLuma 目录无效' }
    const 已有 = 是SnowLuma目录(目录)
    改配置({ 目录, 同意协议: true, 自动启动: 选项.自动启动 !== false })
    安装任务 = {
      进行中: true,
      阶段: 已有 ? '准备配置' : '准备下载',
      错: '',
      已下载: 0,
      总: 0,
    }
    void 执行安装({ 目录, 密码: 选项.密码, 自动启动: 选项.自动启动 !== false })
    return { ok: true, 说: 已有 ? '正在配置并启动 SnowLuma' : '正在下载 SnowLuma（约 42MB），装好会自动配置并启动' }
  }

  function 手动启动() {
    const 配置 = 读配置()
    const 目录 = 目标目录(配置)
    if (!是SnowLuma目录(目录)) return { ok: false, 说: '还没装 SnowLuma' }
    if (!(配置.SnowLuma && 配置.SnowLuma.同意协议)) return { ok: false, 说: '先在上面的安装向导里勾选同意协议' }
    写SnowLuma配置(目录, 事件地址(), 取端口(配置.NapCat))
    const pid = 启动(目录, true)
    return { ok: true, 说: `SnowLuma 已启动（PID ${pid}）`, pid }
  }

  function 手动停止() {
    const 目录 = 目标目录(读配置())
    const 停了 = 停止(目录)
    return { ok: true, 说: 停了 ? 'SnowLuma 已停止' : '没有找到本插件启动的 SnowLuma 进程' }
  }

  function 重置密码() {
    const 配置 = 读配置()
    const 目录 = 目标目录(配置)
    if (!是SnowLuma目录(目录)) return { ok: false, 说: '还没装 SnowLuma' }
    const 密码 = 生成后台密码()
    写后台密码(目录, 密码)
    改配置({ 后台密码: 密码 })
    const 在跑 = 进程在(读PID(目录))
    if (在跑) {
      停止(目录)
      setTimeout(() => {
        try {
          启动(目录, true)
        } catch (error) {
          记账(`SnowLuma 重启失败：${String((error && error.message) || error)}`)
        }
      }, 800)
    }
    return {
      ok: true,
      说: 在跑 ? '后台密码已重置，SnowLuma 正在重启' : '后台密码已重置，下次启动生效',
      密码,
    }
  }

  async function 自动启动() {
    const 配置 = 读配置()
    if (!配置.总开关) return
    if (!(配置.SnowLuma && 配置.SnowLuma.同意协议 && 配置.SnowLuma.自动启动)) return
    const 目录 = 目标目录(配置)
    if (!是SnowLuma目录(目录)) return
    const 探 = await 探测()
    if (探.运行中) return
    写SnowLuma配置(目录, 事件地址(), 取端口(配置.NapCat))
    启动(目录, true)
    记账('SnowLuma 没在跑，已按设置自动启动')
  }

  /**
   * 开机时先把本机已有的 SnowLuma 接过来：正在运行的实例，或留着有效同意记录的安装目录。
   * 有同意证据才自动接管并拉起；没有证据只把目录填进设置，第一次同意仍由主人自己勾。
   * 只在设置里没写目录、或写的目录已经不存在时出手；找不到也不下载。
   * @returns {Promise<{ok: boolean, 接管: boolean, 目录?: string, 版本?: string, 来源?: string, 认出?: object}>} 接管结果。
   */
  async function 自动准备() {
    // 测试和排障时不该去碰真机器上的安装；平时不设这个变量。
    if (String(process.env.DSH_QQ_BRIDGE_NO_SNOWLUMA_ADOPT || '') === '1') {
      return { ok: true, 接管: false, 跳过: true }
    }
    const 配置 = 读配置()
    if (!配置.总开关) return { ok: true, 接管: false }
    if (安装任务.进行中) return { ok: true, 接管: false }
    const 雪 = (配置 && 配置.SnowLuma) || {}
    const 指定 = 绝对目录(雪.目录)

    if (是SnowLuma目录(指定)) {
      if (雪.同意协议) {
        await 自动启动()
        return { ok: true, 接管: false, 目录: 指定 }
      }
      const 证据 = 同意证据(指定)
      if (!证据.已同意) return { ok: true, 接管: false, 认出: { 目录: 指定, 已同意: false } }
      改配置({ 目录: 指定, 同意协议: true, 自动启动: true })
      记账(`沿用 ${指定} 里之前接受过的 SnowLuma 协议，不再要求重新勾选`)
      void 执行安装({ 目录: 指定, 自动启动: true })
      return { ok: true, 接管: true, 目录: 指定, 版本: 读SnowLuma版本(指定), 来源: '设置里指定' }
    }

    await 找运行中的SnowLuma()
    const 候选 = 候选目录(配置)
    if (候选.length === 0) return { ok: true, 接管: false }
    const 可接管 = 候选.find((x) => x.同意 && x.同意.已同意)
    if (可接管) {
      改配置({ 目录: 可接管.目录, 同意协议: true, 自动启动: true })
      记账(`认出本机已有的 SnowLuma v${可接管.版本 || '?'}（${可接管.目录}），协议之前接受过，直接接管、不再下载`)
      void 执行安装({ 目录: 可接管.目录, 自动启动: true })
      return { ok: true, 接管: true, 目录: 可接管.目录, 版本: 可接管.版本, 来源: 可接管.来源 }
    }
    // 只是认出了目录：填进设置，等主人勾一下同意；不碰它的进程，也不下载第二份
    const 提示 = 候选[0]
    if (String(雪.目录 || '').trim() === '' && 提示) {
      改配置({ 目录: 提示.目录 })
      记账(`认出本机已有的 SnowLuma v${提示.版本 || '?'}（${提示.目录}）；勾选同意后就能直接启用，不会重新下载`)
    }
    return { ok: true, 接管: false, 认出: 提示 }
  }

  return {
    状态,
    快照,
    设置,
    启动: 手动启动,
    停止: 手动停止,
    重置密码,
    自动启动,
    自动准备,
    探测,
    目标目录,
    候选目录,
    是SnowLuma目录,
  }
}
