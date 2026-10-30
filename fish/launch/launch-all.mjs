// 一键启动 SnowLuma → QQ → DSH，并等到各自就绪；已在运行的会跳过。
// 运行数据只放在仓库的 data 目录（和安装版的 <安装目录>\data 同一规则），不碰 ~/.dsh。
import { spawn, execFileSync } from 'node:child_process'
import { openSync, closeSync, appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { connect } from 'node:net'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const 家 = join(REPO, 'data')
const 日志 = join(家, '启动日志.txt')
const NODE_DIR = dirname(process.execPath)
const QQ = 'C:\\Program Files\\Tencent\\QQNT\\QQ.exe'

mkdirSync(家, { recursive: true })

// SnowLuma 认设置页装的那份（D:\MyDearFish\data\snowluma 之类），别再另起一套抢 3002。
function SnowLuma配置() {
  try {
    return JSON.parse(readFileSync(join(家, 'qq-bridge-config.json'), 'utf8')).SnowLuma || {}
  } catch (error) {
    return {}
  }
}

function SnowLuma目录() {
  const 目录 = String(SnowLuma配置().目录 || '').trim()
  if (目录 && existsSync(join(目录, 'index.mjs')) && existsSync(join(目录, 'node.exe'))) return 目录
  return 'D:\\SnowLuma\\app'
}

function 记(文) {
  const 行 = `[${new Date().toLocaleString('zh-CN', { hour12: false })}] ${文}`
  console.log(行)
  try { appendFileSync(日志, 行 + '\r\n') } catch {}
}

function 端口在听(端口, 超时毫秒 = 800) {
  return new Promise((resolve) => {
    const 连 = connect({ host: '127.0.0.1', port: 端口 })
    let 完 = false
    const 收 = (值) => {
      if (完) return
      完 = true
      连.destroy()
      resolve(值)
    }
    连.setTimeout(超时毫秒)
    连.once('connect', () => 收(true))
    连.once('timeout', () => 收(false))
    连.once('error', () => 收(false))
  })
}

async function 等端口(端口, 秒) {
  const 截止 = Date.now() + 秒 * 1000
  while (Date.now() < 截止) {
    if (await 端口在听(端口)) return true
    await new Promise((r) => setTimeout(r, 1000))
  }
  return 端口在听(端口)
}

function 进程在跑(名字) {
  try {
    const 出 = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${名字}`, '/NH'], { encoding: 'utf8', windowsHide: true })
    return 出.toLowerCase().includes(名字.toLowerCase())
  } catch {
    return false
  }
}

function 拉起(命令, 参数, 选项, 日志文件) {
  let 输出 = 'ignore'
  let fd
  if (日志文件) {
    fd = openSync(日志文件, 'a')
    输出 = fd
  }
  const 子 = spawn(命令, 参数, { ...选项, detached: true, stdio: ['ignore', 输出, 输出], windowsHide: true })
  子.unref()
  if (fd !== undefined) closeSync(fd)
}

async function 主() {
  记('=== 开始启动 ===')
  记(`运行数据目录：${家}`)

  if (await 端口在听(5099)) {
    记('SnowLuma 已在运行')
  } else {
    记('启动 SnowLuma…')
    const 目录 = SnowLuma目录()
    const 环境 = { ...process.env, ...(SnowLuma配置().同意协议 ? { SNOWLUMA_ACCEPT_EULA: '1', SNOWLUMA_ACCEPT_PRIVACY: '1' } : {}) }
    拉起(join(目录, 'node.exe'), ['index.mjs'], { cwd: 目录, env: 环境 }, join(家, 'SnowLuma启动.log'))
    if (await 等端口(5099, 40)) 记('SnowLuma 就绪（5099）')
    else 记(`SnowLuma 40 秒内没起来，检查 ${join(目录, 'logs')}`)
  }

  if (进程在跑('QQ.exe')) {
    记('QQ 已在运行')
  } else {
    记('启动 QQ…')
    拉起(QQ, [], {}, null)
  }
  记('等待 QQ 登录并自动注入（最多 120 秒）…')
  const OneBot端口 = (() => {
    try {
      const 址 = new URL(String(JSON.parse(readFileSync(join(家, 'qq-bridge-config.json'), 'utf8')).NapCat || ''))
      return Number(址.port) || 3002
    } catch (error) {
      return 3002
    }
  })()
  if (await 等端口(OneBot端口, 120)) 记(`QQ 已登录并注入，OneBot ${OneBot端口} 就绪`)
  else 记(`${OneBot端口} 未就绪：可能停在登录页；登录 QQ 后会自动注入`)

  if (进程在跑('electron.exe')) {
    记('DSH 桌面端已在运行')
  } else {
    记('启动 DSH 桌面端（约 1 分钟）…')
    const 环境 = {
      ...process.env,
      DSH_HOME: 家,
      DSH_DESKTOP_OPEN_DEVTOOLS: '0',
      PATH: `${NODE_DIR};${process.env.PATH || ''}`,
    }
    // corepack.cmd 在这台机器上没了；直接用仓库里的 pnpm 起，绕开 cmd 一层也更稳。
    拉起(join(NODE_DIR, 'node.exe'), [join(REPO, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'), '--filter', '@deepseek-ai/dsh-desktop', 'run', 'start'], { cwd: REPO, env: 环境 }, join(家, 'DSH启动.log'))
    if (await 等端口(19388, 180)) 记('DSH + QQ 桥就绪（19388）')
    else 记(`DSH 180 秒内没就绪，检查 ${join(家, 'DSH启动.log')}`)
  }

  记('=== 启动流程结束 ===')
}

主().catch((error) => {
  记('启动出错：' + (error && error.message ? error.message : String(error)))
  process.exitCode = 1
})
