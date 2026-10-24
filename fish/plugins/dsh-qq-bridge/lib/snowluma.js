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

export const 后台端口 = 5099
export const OneBot端口 = 3000
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

/** 把 OneBot HTTP 服务固定到本机 3000，并加一个把事件推给 DSH 的 httpClient。 */
export function 写OneBot配置(文件, 事件地址) {
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
    port: OneBot端口,
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

  写JSON(文件, {
    ...源,
    networks: { ...网, httpServers: 服务器们, httpClients: 客户端们 },
  })
  return 文件
}

/** 写运行端口、全局 OneBot，以及所有已经在用的 per-UIN 快照。 */
export function 写SnowLuma配置(目录, 事件地址) {
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
  写了.push(写OneBot配置(join(配置目录, 'onebot.json'), 事件地址))

  let 账号文件 = []
  try {
    账号文件 = readdirSync(配置目录).filter((名) => /^onebot_\d+\.json$/.test(名))
  } catch (error) {}
  for (const 名 of 账号文件) {
    try {
      写了.push(写OneBot配置(join(配置目录, 名), 事件地址))
    } catch (error) {}
  }
  return 写了
}

export function 创建SnowLuma({ 家目录, 读配置, 存配置, 记账, 事件地址 }) {
  let 安装任务 = { 进行中: false, 阶段: '', 错: '', 已下载: 0, 总: 0 }
  let 探测缓存 = { at: 0, 值: null, 进行中: null }

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

  const 候选目录 = (配置) => {
    const 出 = []
    const 加 = (路径, 来源) => {
      const 目录 = 绝对目录(路径)
      if (目录 === '' || 出.some((x) => x.目录.toLowerCase() === 目录.toLowerCase())) return
      if (!是SnowLuma目录(目录)) return
      出.push({ 目录, 来源, 版本: 读SnowLuma版本(目录) })
    }
    const 指定 = 绝对目录(配置 && 配置.SnowLuma && 配置.SnowLuma.目录)
    if (指定 !== '') 加(指定, '设置里指定')
    加(join(家目录, 'snowluma'), '数据目录')
    if (basename(家目录).toLowerCase() === '.dsh') 加(join(dirname(家目录), 'tools', 'snowluma'), '工作区')
    if (process.env.LOCALAPPDATA) 加(join(process.env.LOCALAPPDATA, 'SnowLuma', 'snowluma'), '本机')
    加(join(homedir(), 'snowluma'), '用户目录')
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
    存配置({
      ...现在,
      NapCat: `http://127.0.0.1:${OneBot端口}`,
      SnowLuma: { ...(现在.SnowLuma || {}), ...改 },
    })
  }

  async function 探OneBot() {
    try {
      const r = await fetch(`http://127.0.0.1:${OneBot端口}/get_login_info`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(2500),
      })
      const j = await r.json().catch(() => null)
      if (j && j.status === 'ok' && j.data) {
        return { ok: true, 用户: String(j.data.user_id || ''), 昵称: String(j.data.nickname || '') }
      }
      return { ok: false, 错: 'OneBot 有回应，但还没登录 QQ' }
    } catch (error) {
      return { ok: false, 错: `127.0.0.1:${OneBot端口} 没有回应（SnowLuma 没启动，或 HTTP 服务没开）` }
    }
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
        const [OneBot, 后台] = await Promise.all([探OneBot(), 探后台()])
        const 值 = { 运行中: OneBot.ok || 后台, 后台在跑: 后台, ...OneBot }
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
    return {
      ok: true,
      目录,
      已安装,
      版本: 已安装 ? 读SnowLuma版本(目录) : '',
      候选: 候选目录(配置),
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
      已连QQ: 探.ok === true,
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

      写SnowLuma配置(目录, 事件地址())
      改配置({
        目录,
        后台密码: 新密码,
        同意协议: true,
        自动启动: 自动启动 !== false,
      })

      安装任务 = { ...安装任务, 阶段: '启动 SnowLuma' }
      const 探 = await 探测()
      if (探.运行中) {
        if (进程在(读PID(目录))) {
          停止(目录)
          await new Promise((r) => setTimeout(r, 800))
          启动(目录, true)
        }
      } else {
        启动(目录, true)
      }
      await 等就绪()
      安装任务 = { 进行中: false, 阶段: '完成', 错: '', 已下载: 安装任务.已下载, 总: 安装任务.总 }
      记账('SnowLuma 已装好并启动（OneBot 127.0.0.1:3000，后台 127.0.0.1:5099）')
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
    写SnowLuma配置(目录, 事件地址())
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
    if (!(配置.SnowLuma && 配置.SnowLuma.同意协议 && 配置.SnowLuma.自动启动)) return
    const 目录 = 目标目录(配置)
    if (!是SnowLuma目录(目录)) return
    const 探 = await 探测()
    if (探.运行中) return
    写SnowLuma配置(目录, 事件地址())
    启动(目录, true)
    记账('SnowLuma 没在跑，已按设置自动启动')
  }

  return {
    状态,
    快照,
    设置,
    启动: 手动启动,
    停止: 手动停止,
    重置密码,
    自动启动,
    探测,
    目标目录,
    候选目录,
    是SnowLuma目录,
  }
}
