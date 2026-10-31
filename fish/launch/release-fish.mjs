#!/usr/bin/env node
// 打版：推 fish-release 标签 → 等 CI 发布 → 下载安装包 → 对照 nightly.yml 校验 → 交付路径。
// 常用：node fish/launch/release-fish.mjs [--tag <已有标签>] [--again] [--dry-run] [--out <目录>] [--timeout <分钟>]
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { get as httpGet } from 'node:http'
import { get as httpsGet } from 'node:https'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const REMOTE = 'ssh'
const SLUG = 'zxr121/MyDearFish'
const PROXY = 'https://gh-proxy.com/'
const WORKFLOW = `https://github.com/${SLUG}/actions/workflows/build-fish-exe.yml`
const DOWNLOADS = join(process.env.USERPROFILE || 'C:\\Users\\83726', 'Downloads')

const 参数 = { tag: '', again: false, dryRun: false, out: DOWNLOADS, timeoutMin: 60 }
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--tag') 参数.tag = argv[++i] || ''
  else if (a === '--again') 参数.again = true
  else if (a === '--dry-run') 参数.dryRun = true
  else if (a === '--out') 参数.out = resolve(argv[++i] || DOWNLOADS)
  else if (a === '--timeout') 参数.timeoutMin = Math.max(5, Number(argv[++i]) || 60)
  else if (a === '-h' || a === '--help') {
    console.log(`用法：node fish/launch/release-fish.mjs [选项]

  --tag <标签>     标签已经推过，只等发布、下载并校验
  --again          这个提交已经打过版，仍要再打一版
  --dry-run        只预检并打印计划，不推标签
  --out <目录>     安装包下载目录（默认 ${DOWNLOADS}）
  --timeout <分>   等 CI 的上限分钟数（默认 60）`)
    process.exit(0)
  } else {
    console.error(`不认识的参数：${a}`)
    process.exit(2)
  }
}

const PATH键 = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') || 'PATH'
const 分隔符 = process.platform === 'win32' ? ';' : ':'
const git环境 = {
  ...process.env,
  [PATH键]: [dirname(process.execPath), join(REPO, 'node_modules', '.bin'), process.env[PATH键] || ''].join(分隔符),
}

let 进度行长度 = 0

function 时间() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

function 说(文 = '') {
  if (process.stdout.isTTY && 进度行长度) {
    process.stdout.write(`\r${' '.repeat(进度行长度)}\r`)
    进度行长度 = 0
  }
  console.log(`[${时间()}] ${文}`)
}

function 进度(文) {
  if (process.stdout.isTTY) {
    process.stdout.write(`\r${文.padEnd(进度行长度)}`)
    进度行长度 = 文.length
  } else {
    console.log(`[${时间()}] ${文}`)
  }
}

function 收尾() {
  if (process.stdout.isTTY && 进度行长度) {
    process.stdout.write('\n')
    进度行长度 = 0
  }
}

function 阶段(n, 总数, 名) {
  收尾()
  说(`━━ [${n}/${总数}] ${名} ━━`)
}

function 失败(文) {
  收尾()
  console.error(`\n打版中止：${文}`)
  process.exit(1)
}

function 睡(毫秒) {
  return new Promise((r) => setTimeout(r, 毫秒))
}

function MB(n) {
  return `${(n / 1048576).toFixed(1)} MB`
}

function 时钟(秒) {
  const s = Math.max(0, Math.round(秒))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

function UTC日期() {
  const d = new Date()
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
}

function git(args, { 静默 = true } = {}) {
  return execFileSync('git', args, {
    cwd: REPO,
    env: git环境,
    encoding: 'utf8',
    stdio: 静默 ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    timeout: 180000,
  })
}

function 远端标签(模式) {
  const 输出 = git(['ls-remote', '--tags', REMOTE, ...(模式 ? [模式] : [])])
  const 表 = new Map()
  for (const 行 of 输出.split('\n')) {
    const m = /^([0-9a-f]{40})\s+refs\/tags\/(.+)$/.exec(行.trim())
    if (!m) continue
    if (m[2].endsWith('^{}')) 表.set(m[2].slice(0, -3), m[1])
    else if (!表.has(m[2])) 表.set(m[2], m[1])
  }
  return 表
}

function 请求(url, { headers = {}, timeout = 30000, redirects = 10 } = {}) {
  return new Promise((resolve, reject) => {
    const go = (u, left) => {
      const mod = u.startsWith('https:') ? httpsGet : httpGet
      const req = mod(u, { headers: { 'User-Agent': 'mydearfish-release', Accept: '*/*', ...headers } }, (res) => {
        const { statusCode, headers: h } = res
        if ([301, 302, 303, 307, 308].includes(statusCode) && h.location && left > 0) {
          res.resume()
          return go(new URL(h.location, u).toString(), left - 1)
        }
        resolve({ res, url: u })
      })
      req.setTimeout(timeout, () => req.destroy(new Error('网络空闲超时')))
      req.on('error', reject)
    }
    go(url, redirects)
  })
}

async function 取文本(url, { timeout = 25000, 上限 = 4_000_000 } = {}) {
  const { res } = await 请求(url, { timeout })
  if (res.statusCode !== 200) {
    res.resume()
    throw new Error(`HTTP ${res.statusCode}`)
  }
  let 文本 = ''
  for await (const 块 of res) {
    文本 += 块
    if (文本.length > 上限) {
      res.destroy()
      break
    }
  }
  return 文本
}

async function 取小文件(url, 名) {
  let 最后错误 = null
  for (let i = 1; i <= 8; i++) {
    for (const 目标 of [url, PROXY + url]) {
      try {
        return await 取文本(目标)
      } catch (错误) {
        最后错误 = 错误
      }
    }
    说(`  ${名} 没取到（${最后错误?.message || '未知错误'}），第 ${i} 次重试`)
    await 睡(1200 * i)
  }
  throw 最后错误 || new Error(`${名} 取不到`)
}

async function SHA512(path) {
  const hash = createHash('sha512')
  for await (const 块 of createReadStream(path)) hash.update(块)
  return hash.digest('base64')
}

function 解析nightly(文本, 文件名) {
  for (const 块 of 文本.split(/\n\s*-\s+/)) {
    if (!块.includes(文件名)) continue
    return {
      url: /url:\s*(\S+)/.exec(块)?.[1] || 文件名,
      sha: /sha512:\s*(\S+)/.exec(块)?.[1] || '',
      size: Number(/size:\s*(\d+)/.exec(块)?.[1] || 0),
    }
  }
  const 整段 = {
    url: /url:\s*(\S+)/.exec(文本)?.[1] || 文件名,
    sha: /sha512:\s*(\S+)/.exec(文本)?.[1] || '',
    size: Number(/size:\s*(\d+)/.exec(文本)?.[1] || 0),
  }
  return 整段
}

async function CI状态(tag) {
  try {
    const html = await 取文本(WORKFLOW, { timeout: 25000 })
    const 位置 = html.indexOf(`refs/tags/${tag}"`)
    if (位置 < 0) return null
    const 前 = html.slice(Math.max(0, 位置 - 3000), 位置)
    const 后 = html.slice(位置, 位置 + 4000)
    const 编号 = /"runNumber":(\d+)/.exec(前)?.[1] || /"runNumber":(\d+)/.exec(后)?.[1]
    const 种类 = /WORKFLOW_RUN_TIMING_KIND_([A-Z_]+)/.exec(后)?.[1]
    const 文案 = /"text":"([^"]+)"/.exec(后)?.[1]
    const 翻译 = { IN_PROGRESS: '构建中', QUEUED: '排队', REQUESTED: '排队', WAITING: '排队', COMPLETED: '已完成' }
    const 状态 = 翻译[种类] || 种类 || 文案 || ''
    if (!编号 && !状态) return null
    return { 编号, 状态, 种类: 种类 || '' }
  } catch {
    return null
  }
}

async function 下载安装包({ url, 文件, 大小, sha }) {
  mkdirSync(参数.out, { recursive: true })
  const 目标 = join(参数.out, 文件)
  if (existsSync(目标)) {
    const 现有 = statSync(目标).size
    if (大小 && 现有 === 大小 && (await SHA512(目标)) === sha) {
      说(`  已有安装包且校验一致：${目标}`)
      return 目标
    }
    说(`  已有安装包不完整或校验不符（${现有} 字节），重新下载`)
    unlinkSync(目标)
  }

  let 尝试 = 0
  let 走镜像 = false
  while (尝试 < 100) {
    尝试++
    const 已有 = existsSync(目标) ? statSync(目标).size : 0
    if (大小 && 已有 === 大小) break
    const 地址 = 走镜像 ? PROXY + url : url
    let 输出 = null
    try {
      const { res } = await 请求(地址, { headers: 已有 ? { Range: `bytes=${已有}-` } : {}, timeout: 45000 })
      const 码 = res.statusCode
      if (码 === 416) {
        res.resume()
        break
      }
      if (码 !== 200 && 码 !== 206) {
        res.resume()
        throw new Error(`HTTP ${码}`)
      }
      const 续传 = 码 === 206 && 已有 > 0
      if (码 === 200 && 已有 > 0) 说('  服务器没理会断点，从头下载')
      输出 = createWriteStream(目标, { flags: 续传 ? 'a' : 'w' })
      const 总量 = 大小 || Number(res.headers['content-length'] || 0) + (续传 ? 已有 : 0)
      let 已收 = 续传 ? 已有 : 0
      const 起点 = 已收
      const 开始 = Date.now()
      let 上次刷新 = 0
      const 显示 = () => {
        const 秒 = Math.max(0.001, (Date.now() - 开始) / 1000)
        const 速度 = (已收 - 起点) / 秒
        const 百分比 = 总量 ? (已收 / 总量) * 100 : 0
        const 剩余 = 速度 > 0 && 总量 > 已收 ? (总量 - 已收) / 速度 : 0
        进度(`  下载 ${MB(已收)} / ${总量 ? MB(总量) : '?'}  ${百分比.toFixed(1)}%  ${MB(速度)}/s  剩 ${时钟(剩余)}`)
      }
      await new Promise((resolve, reject) => {
        let 慢次数 = 0
        const 监控 = setInterval(() => {
          const 秒 = Math.max(0.001, (Date.now() - 开始) / 1000)
          const 均速 = (已收 - 起点) / 秒
          if (秒 > 15 && 均速 < 800 * 1024 && (!总量 || 已收 < 总量 * 0.98)) {
            慢次数++
            if (慢次数 >= 2) res.destroy(new Error('速度过慢'))
          } else {
            慢次数 = 0
          }
        }, 5000)
        const 清理 = () => clearInterval(监控)
        res.on('data', (块) => {
          已收 += 块.length
          const 现在 = Date.now()
          if (process.stdout.isTTY) 显示()
          else if (现在 - 上次刷新 >= 10000) {
            上次刷新 = 现在
            显示()
          }
        })
        res.on('error', (错误) => {
          清理()
          reject(错误)
        })
        输出.on('error', (错误) => {
          清理()
          reject(错误)
        })
        输出.on('finish', () => {
          清理()
          resolve()
        })
        res.pipe(输出)
      })
      显示()
      收尾()
      if (大小 && statSync(目标).size !== 大小) throw new Error(`大小不符（${statSync(目标).size} / ${大小}）`)
      break
    } catch (错误) {
      收尾()
      try {
        输出?.destroy()
      } catch {}
      if (尝试 >= 100) throw 错误
      const 现在 = existsSync(目标) ? statSync(目标).size : 0
      说(`  连接中断（${错误.message}），第 ${尝试} 次重试，已下 ${MB(现在)}`)
      if (错误.message === '速度过慢') {
        if (!走镜像) 说('  直连太慢，改走 gh-proxy.com 镜像')
        走镜像 = true
      } else if (!走镜像 && 尝试 % 4 === 0) {
        走镜像 = true
        说('  改走 gh-proxy.com 镜像')
      } else if (走镜像 && 尝试 % 6 === 0) {
        走镜像 = false
        说('  回到直连')
      }
      await 睡(Math.min(5000, 800 * 尝试))
    }
  }

  const 大小实际 = statSync(目标).size
  if (大小 && 大小实际 !== 大小) 失败(`安装包大小不符：${大小实际} 字节，期望 ${大小} 字节`)
  说(`  下载完成：${MB(大小实际)}`)
  进度('  校验 SHA-512 …')
  收尾()
  const 实际 = await SHA512(目标)
  if (sha && 实际 !== sha) {
    unlinkSync(目标)
    失败(`SHA-512 不一致：\n  实际 ${实际}\n  期望 ${sha}`)
  }
  说('  SHA-512 与 nightly.yml 一致')
  return 目标
}

function 源码插件版本() {
  const 目录 = join(REPO, 'fish', 'plugins')
  const 表 = new Map()
  for (const 名 of readdirSync(目录).sort()) {
    const 清单 = join(目录, 名, 'package.json')
    if (!existsSync(清单)) continue
    const pkg = JSON.parse(readFileSync(清单, 'utf8'))
    if (pkg.name && pkg.version) 表.set(pkg.name, pkg.version)
  }
  return 表
}

function 打印插件版本() {
  const 源码 = 源码插件版本()
  说(`源码插件：${[...源码].map(([名, 版本]) => `${名} ${版本}`).join(' · ')}`)
  const 根们 = [join(REPO, 'data', 'profiles')]
  if (process.env.DSH_HOME) 根们.push(join(process.env.DSH_HOME, 'profiles'))
  const 提醒 = []
  for (const 根 of [...new Set(根们)]) {
    if (!existsSync(根)) continue
    for (const 档 of readdirSync(根).sort()) {
      const 偏 = []
      for (const [名, 版本] of 源码) {
        const 清单 = join(根, 档, 'node_modules', 名, 'package.json')
        if (!existsSync(清单)) continue
        const 运行时 = JSON.parse(readFileSync(清单, 'utf8')).version
        偏.push(`${名} ${运行时}${运行时 === 版本 ? '' : `（源码 ${版本}）`}`)
        if (运行时 !== 版本) {
          提醒.push(`注意：${档} 里的 ${名} 是 ${运行时}，源码是 ${版本}；打版打包源码，但本机自测可能跑的是旧副本`)
        }
      }
      if (偏.length > 0) 说(`运行时 ${档}：${偏.join(' · ')}`)
    }
  }
  for (const 文 of 提醒) 说(文)
}

function 跑鱼测试() {
  说('跑大肥鱼测试（鱼脑、各插件冒烟、组合提示词快照）…')
  try {
    execFileSync(process.execPath, [join(REPO, 'scripts', 'test-fish.mjs')], {
      cwd: REPO,
      env: git环境,
      stdio: 'inherit',
      timeout: 10 * 60_000,
    })
  } catch {
    失败('大肥鱼测试没通过，先修好再打版。')
  }
}

async function 主流程() {
  说('打版开始')
  阶段(1, 6, '预检')
  const HEAD = git(['rev-parse', 'HEAD']).trim()
  const 短 = HEAD.slice(0, 7)
  const 分支 = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim()
  const 产品版本 = JSON.parse(readFileSync(join(REPO, 'apps', 'desktop', 'package.json'), 'utf8')).version
  说(`仓库 ${REPO}`)
  说(`HEAD ${短}（${分支}）· 产品版本 ${产品版本}`)
  if (!参数.tag) {
    if (git(['status', '--porcelain']).trim()) 失败('工作区有未提交改动，先提交或 stash 再打版。')
    说('工作区干净')
    打印插件版本()
    跑鱼测试()
  }
  说('读取远端标签（ssh）…')
  let 标签表 = 远端标签()
  说(`远端标签 ${标签表.size} 个`)

  let tag = 参数.tag
  if (tag) {
    if (!标签表.has(tag)) 失败(`远端没有标签 ${tag}`)
    const 指向 = 标签表.get(tag)
    if (指向 !== HEAD) 说(`注意：${tag} 指向 ${指向.slice(0, 7)}，不是当前 HEAD ${短}`)
  } else {
    const 已发布 = [...标签表].find(([名, sha]) => sha === HEAD && (名.startsWith('fish-release-') || 名.startsWith('v')))
    if (已发布 && !参数.again) {
      const 发布 = [...标签表].find(([名, sha]) => sha === HEAD && 名.startsWith('v'))?.[0]
      说(`这个提交已经打过版：${已发布[0]}${发布 ? `（${发布}）` : '（构建可能还在跑）'}`)
      说(`只等发布并下载：node fish/launch/release-fish.mjs --tag ${已发布[0]}`)
      return
    }
    const 本地 = new Set(git(['tag', '--list']).split('\n').filter(Boolean))
    const 今天 = `fish-release-${UTC日期()}`
    let 候选 = 今天
    for (let i = 2; 标签表.has(候选) || (本地.has(候选) && git(['rev-parse', `${候选}^{commit}`]).trim() !== HEAD); i++) {
      候选 = `${今天}-${i}`
    }
    tag = 候选
    说(`将打标签 ${tag} → ${短}`)
    if (参数.dryRun) {
      说('--dry-run：不推送，到此为止')
      return
    }
    if (!本地.has(tag)) git(['tag', tag])
    说('推送标签；pre-push 会先跑 typecheck（约 30 秒）')
    const 推送开始 = Date.now()
    git(['push', REMOTE, tag], { 静默: false })
    说(`标签已推送（${时钟((Date.now() - 推送开始) / 1000)}）`)
    标签表 = 远端标签(`fish-release-${UTC日期()}*`)
  }

  const 目标提交 = 标签表.get(tag) || HEAD
  if (参数.dryRun) {
    说(`--dry-run：${tag} → ${目标提交.slice(0, 7)}，不等待也不下载`)
    return
  }

  阶段(2, 6, '等 CI 构建')
  let 版本 = ''
  const 已有发布 = [...标签表].find(([名, sha]) => 名.startsWith('v') && sha === 目标提交)
  if (已有发布) 版本 = 已有发布[0].slice(1)
  if (!版本) {
    说(`构建通常 19–24 分钟；每 30 秒检查一次，最多等 ${参数.timeoutMin} 分钟`)
  }
  const 等待起点 = Date.now()
  const 截止 = 等待起点 + 参数.timeoutMin * 60000
  let 完成次数 = 0
  while (!版本) {
    if (Date.now() > 截止) {
      失败(`等了 ${参数.timeoutMin} 分钟还没发布，去看 ${WORKFLOW}`)
    }
    let 表 = new Map()
    try {
      表 = 远端标签('v*')
    } catch (错误) {
      说(`  读远端标签失败（${错误.message}），稍后重试`)
    }
    const 命中 = [...表].find(([名, sha]) => 名.startsWith('v') && sha === 目标提交)
    if (命中) {
      版本 = 命中[0].slice(1)
      break
    }
    const run = await CI状态(tag)
    完成次数 = run?.种类 === 'COMPLETED' ? 完成次数 + 1 : 0
    const 已等 = 时钟((Date.now() - 等待起点) / 1000)
    const 状态文 = run ? ` · Actions Run #${run.编号 || '?'} ${run.状态 || '运行中'}` : ''
    说(`  已等 ${已等}${状态文}`)
    if (完成次数 >= 2) 失败(`CI 已完成但没有发布，可能构建失败；去看 ${WORKFLOW}`)
    await 睡(30000)
  }
  说(`发布完成：v${版本}`)

  阶段(3, 6, '取 nightly.yml')
  const 安装包名 = `deepseek-harness-${版本}-win-x64-unsigned.exe`
  const 发布地址 = `https://github.com/${SLUG}/releases/download/v${版本}/${安装包名}`
  const nightly = await 取小文件(`https://github.com/${SLUG}/releases/download/v${版本}/nightly.yml`, 'nightly.yml')
  const 清单 = 解析nightly(nightly, 安装包名)
  if (!清单.sha || !清单.size) 失败(`nightly.yml 里没找到 ${安装包名} 的大小或 SHA-512`)
  说(`  安装包 ${basename(清单.url || 安装包名)} · ${MB(清单.size)}`)

  阶段(4, 6, '下载安装包')
  说(`  目标目录 ${参数.out}`)
  const 安装包 = await 下载安装包({ url: 发布地址, 文件: 安装包名, 大小: 清单.size, sha: 清单.sha })

  阶段(5, 6, '校验')
  const 实际大小 = statSync(安装包).size
  const 实际sha = await SHA512(安装包)
  if (实际大小 !== 清单.size || 实际sha !== 清单.sha) 失败('安装包与 nightly.yml 对不上')
  说(`  大小 ${实际大小.toLocaleString('en-US')} 字节`)
  说(`  SHA-512 ${实际sha}`)

  阶段(6, 6, '交付')
  说('──────────────────────────────')
  说(`版本      ${版本}`)
  说(`安装包    ${安装包}`)
  说(`大小      ${实际大小.toLocaleString('en-US')} 字节（${MB(实际大小)}）`)
  说(`SHA-512   ${实际sha}`)
  说(`发布页    https://github.com/${SLUG}/releases/tag/v${版本}`)
  说('未签名：先在托盘完全退出旧版再安装；SmartScreen 点「更多信息 → 仍要运行」。')
  说('打版完成')
}

主流程().catch((错误) => 失败(错误?.stack || String(错误)))
