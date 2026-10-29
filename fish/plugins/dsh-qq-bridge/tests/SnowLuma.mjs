// SnowLuma 安装/配置管理器的离线测试：不联网、不启动进程。
// 验：OneBot 端口解析与配置合并（事件 httpClient）、后台密码哈希、目录识别、候选目录、协议前置。
// 跑法： node tests/SnowLuma.mjs

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scryptSync } from 'node:crypto'

import {
  后台端口,
  默认OneBot端口,
  取端口,
  规范OneBot地址,
  是SnowLuma目录,
  读SnowLuma版本,
  协议指纹,
  读SnowLuma同意,
  常见安装目录,
  生成后台密码,
  写后台密码,
  写OneBot配置,
  写SnowLuma配置,
  创建SnowLuma,
  发行地址候选,
  下载地址候选,
} from '../lib/snowluma.js'

let 挂了 = 0
const 报 = (标签, 过, 详情) => { if (!过) 挂了++; console.log(`${过 ? 'PASS' : 'FAIL'}  ${标签}${详情 ? '  :: ' + 详情 : ''}`) }

const 家 = mkdtempSync(join(tmpdir(), 'snowluma-'))
try {
  报('端口常量没跑偏', 后台端口 === 5099 && 默认OneBot端口 === 3000, `${后台端口}/${默认OneBot端口}`)
  报('从 OneBot 地址取端口', 取端口('http://127.0.0.1:3002') === 3002 && 取端口('http://127.0.0.1') === 80, '3002/80')
  报('地址去掉末尾斜杠', 规范OneBot地址(' http://127.0.0.1:3002/ ') === 'http://127.0.0.1:3002')
  报('坏地址回退默认端口', 规范OneBot地址('不是地址') === `http://127.0.0.1:${默认OneBot端口}`)

  // ---------- 下载源 ----------
  const 发布源 = 发行地址候选()
  报('发布查询直连在前、gh-proxy 兜底',
    发布源.length === 2 && 发布源[0] === 'https://api.github.com/repos/SnowLuma/SnowLuma/releases/latest' &&
      发布源[1] === 'https://gh-proxy.com/' + 发布源[0], JSON.stringify(发布源))
  const 发行包 = 'https://github.com/SnowLuma/SnowLuma/releases/download/v1.0.0/SnowLuma-v1.0.0-win-x64.zip'
  const 下载源 = 下载地址候选(发行包)
  报('发行包先走两个镜像、最后回直连',
    下载源.length === 3 && 下载源[0] === 'https://gh-proxy.com/' + 发行包 &&
      下载源[1] === 'https://ghproxy.net/' + 发行包 && 下载源[2] === 发行包, JSON.stringify(下载源))

  // ---------- 后台密码 ----------
  const 密码 = 生成后台密码()
  报('随机密码 16 位十六进制', /^[0-9a-f]{16}$/.test(密码), 密码)
  const 安装目录 = join(家, 'snowluma')
  mkdirSync(join(安装目录, 'config'), { recursive: true })
  写后台密码(安装目录, '好记的密码')
  const 后台 = JSON.parse(readFileSync(join(安装目录, 'config', 'webui.json'), 'utf8'))
  const 验 = scryptSync('好记的密码', Buffer.from(后台.passwordSalt, 'hex'), 64, { N: 16384, r: 8, p: 1 }).toString('hex')
  报('后台密码按 scrypt 哈希落盘', 后台.passwordHash === 验 && /^[0-9a-f]{32}$/.test(后台.passwordSalt) && 后台.mustChangePassword === false,
    JSON.stringify({ salt长度: String(后台.passwordSalt || '').length, hash长度: String(后台.passwordHash || '').length }))

  // ---------- OneBot 配置 ----------
  const 事件地址 = 'http://127.0.0.1:19388/dsh-qq/event'
  const 单文件 = join(安装目录, 'config', 'onebot.json')
  writeFileSync(单文件, JSON.stringify({
    networks: {
      httpServers: [{ name: 'http-default', host: '0.0.0.0', port: 9999, accessToken: '不该留下', path: '/' }],
      httpClients: [{ name: '别的客户端', url: 'http://x', enabled: true }],
      wsServers: [{ name: '不动我' }],
    },
    statusCommand: { enabled: true, swallow: true, cooldownSeconds: 9, trigger: '#sl' },
    别的键: { 保留: true },
  }, null, 2), 'utf8')
  写OneBot配置(单文件, 事件地址, 3002)
  const 网 = JSON.parse(readFileSync(单文件, 'utf8'))
  const 服务 = 网.networks.httpServers.find((x) => x.name === 'http-default')
  const 客户端 = 网.networks.httpClients.find((x) => x.name === 'dsh-event')
  报('OneBot HTTP 写到指定端口、只收回环', 服务 && 服务.host === '127.0.0.1' && 服务.port === 3002 && 服务.enableWebSocket === false && 服务.messageFormat === 'array',
    JSON.stringify(服务))
  报('事件 httpClient 指向 DSH 收报口', 客户端 && 客户端.url === 事件地址 && 客户端.enabled === true, JSON.stringify(客户端))
  报('不留下旧的 accessToken', 服务 && !('accessToken' in 服务) && !('accessToken' in 客户端))
  报('保留别的键和别的客户端', 网.别的键 && 网.别的键.保留 === true && 网.networks.httpClients.some((x) => x.name === '别的客户端') && 网.networks.wsServers[0].name === '不动我')
  报('自带 #sl 状态指令一律关掉，触发词和冷却原样保留',
    网.statusCommand && 网.statusCommand.enabled === false && 网.statusCommand.trigger === '#sl' &&
      网.statusCommand.cooldownSeconds === 9 && 网.statusCommand.swallow === true, JSON.stringify(网.statusCommand))

  // ---------- 全局 + per-UIN ----------
  writeFileSync(join(安装目录, 'config', 'onebot_2514029319.json'), JSON.stringify({
    mode: 'snapshot',
    networks: { httpServers: [{ name: 'http-default', port: 3000, host: '127.0.0.1', path: '/', enableWebSocket: false, messageFormat: 'array', reportSelfMessage: false }], httpClients: [] },
    statusCommand: { enabled: true, swallow: false, cooldownSeconds: 5, trigger: '#sl' },
  }, null, 2), 'utf8')
  writeFileSync(join(安装目录, 'config', 'runtime.json'), JSON.stringify({ webuiPort: 6099, hookAutoLoad: false }, null, 2), 'utf8')
  const 写了 = 写SnowLuma配置(安装目录, 事件地址, 3002)
  const 运行 = JSON.parse(readFileSync(join(安装目录, 'config', 'runtime.json'), 'utf8'))
  const 账号 = JSON.parse(readFileSync(join(安装目录, 'config', 'onebot_2514029319.json'), 'utf8'))
  报('后台端口和监听固定回环', 运行.webuiPort === 后台端口 && 运行.webuiHost === '127.0.0.1' && 运行.hookAutoLoad === false, JSON.stringify(运行))
  报('per-UIN 快照也写同一端口并加事件上报',
    账号.mode === 'snapshot' && 账号.networks.httpServers.some((x) => x.name === 'http-default' && x.port === 3002) &&
      (账号.networks.httpClients || []).some((x) => x.name === 'dsh-event' && x.url === 事件地址))
  报('per-UIN 快照里的 #sl 状态指令也关掉', 账号.statusCommand && 账号.statusCommand.enabled === false && 账号.statusCommand.trigger === '#sl',
    JSON.stringify(账号.statusCommand))
  报('配置写到了这些文件', 写了.length >= 3 && 写了.every((x) => existsSync(x)), JSON.stringify(写了.map((x) => x.split(/[\\/]/).pop())))

  // ---------- 目录识别 / 候选 ----------
  报('空目录不算 SnowLuma', 是SnowLuma目录(家) === false)
  writeFileSync(join(安装目录, 'index.mjs'), '// fake\n', 'utf8')
  writeFileSync(join(安装目录, 'node.exe'), '', 'utf8')
  writeFileSync(join(安装目录, 'release.json'), JSON.stringify({ version: '9.9.9' }), 'utf8')
  报('有 index.mjs + node.exe 才算装过', 是SnowLuma目录(安装目录) === true)
  报('版本从 release.json 读', 读SnowLuma版本(安装目录) === '9.9.9')

  // ---------- 协议证据 ----------
  writeFileSync(join(安装目录, 'EULA.md'), '# EULA\n正文一\n', 'utf8')
  writeFileSync(join(安装目录, 'PRIVACY.md'), '# 隐私政策\n正文二\n', 'utf8')
  const 指纹 = 协议指纹(安装目录)
  报('协议指纹 16 位十六进制', /^[0-9a-f]{16}$/.test(指纹), 指纹)
  报('没有 consent.json 不算同意', 读SnowLuma同意(安装目录).已同意 === false)
  writeFileSync(join(安装目录, 'config', 'consent.json'),
    JSON.stringify({ version: 指纹, acceptedAt: '2026-10-22T02:01:00.154Z' }), 'utf8')
  const 同意 = 读SnowLuma同意(安装目录)
  报('同意记录 + 协议正文没变 = 已同意',
    同意.已同意 === true && 同意.同意时间 === '2026-10-22T02:01:00.154Z', JSON.stringify(同意))
  writeFileSync(join(安装目录, 'EULA.md'), '# EULA\n正文改过了\n', 'utf8')
  const 过期 = 读SnowLuma同意(安装目录)
  报('协议正文改过就不算同意，得重新勾', 过期.已同意 === false && 过期.原因.includes('更新'), JSON.stringify(过期))
  writeFileSync(join(安装目录, 'EULA.md'), '# EULA\n正文一\n', 'utf8')

  // ---------- 常见安装位置 ----------
  const 假环境 = {
    LOCALAPPDATA: join(家, 'localappdata'),
    APPDATA: join(家, 'appdata'),
    ProgramData: join(家, 'programdata'),
    ProgramFiles: join(家, 'program-files'),
    'ProgramFiles(x86)': join(家, 'program-files-x86'),
  }
  const 假家 = join(家, '用户')
  const 常见 = 常见安装目录(假环境, 假家)
  const 有位置 = (路径) => 常见.some((x) => x.路径 === 路径)
  报('常见位置覆盖 LocalAppData / Program Files / 桌面 / 下载',
    有位置(join(假环境.LOCALAPPDATA, 'SnowLuma', 'app')) &&
      有位置(join(假环境.ProgramFiles, 'SnowLuma', 'app')) &&
      有位置(join(假家, 'Desktop', 'SnowLuma', 'app')) &&
      有位置(join(假家, 'Downloads', 'SnowLuma', 'app')), JSON.stringify(常见.map((x) => x.来源)))
  报('常见位置按大小写去重', new Set(常见.map((x) => x.路径.toLowerCase())).size === 常见.length)

  let 当前配置 = {
    SnowLuma: { 目录: '', 后台密码: '', 同意协议: false, 自动启动: true },
    戳一戳: { 端口: 19388 },
  }
  const 管理器 = 创建SnowLuma({
    家目录: 家,
    读配置: () => 当前配置,
    存配置: (c) => { 当前配置 = c },
    记账: () => {},
    事件地址: () => 事件地址,
  })
  const 候选 = 管理器.候选目录(当前配置)
  const 快照 = 管理器.快照()
  报('自动认出 <DSH_HOME>/snowluma', 候选.some((x) => x.目录 === 安装目录), JSON.stringify(候选))
  报('候选带上同意证据', (候选.find((x) => x.目录 === 安装目录) || {}).同意?.已同意 === true)
  报('快照的认出指向第一个候选', 快照.认出 && 快照.认出.目录 === 候选[0].目录, JSON.stringify(快照.认出))
  报('快照报已安装和版本，未探测', 快照.已安装 === true && 快照.版本 === '9.9.9' && 快照.同意协议 === false && !('运行中' in 快照), JSON.stringify(快照))

  const 未同意 = 管理器.设置({ 同意协议: false })
  报('没勾协议拒绝安装', 未同意.ok === false && String(未同意.说).includes('勾选'), JSON.stringify(未同意))

  const 指定目录 = join(家, '指定的')
  mkdirSync(指定目录, { recursive: true })
  const 管理器2 = 创建SnowLuma({
    家目录: 家,
    读配置: () => ({ ...当前配置, SnowLuma: { ...当前配置.SnowLuma, 目录: 指定目录 } }),
    存配置: () => {},
    记账: () => {},
    事件地址: () => 事件地址,
  })
  报('设置里指定的目录优先', 管理器2.目标目录({ SnowLuma: { 目录: 指定目录 } }) === 指定目录)
  管理器2.停止()
  报('没有进程时停止不炸', true)

  // 我们以前拉起过的目录：没有 consent.json，但启动记录 + 活着的 PID 也算同意证据
  const 启动过家 = join(家, '由DSH启动')
  const 启动过目录 = join(启动过家, 'snowluma')
  mkdirSync(join(启动过目录, 'config'), { recursive: true })
  writeFileSync(join(启动过目录, 'index.mjs'), '// fake\n', 'utf8')
  writeFileSync(join(启动过目录, 'node.exe'), '', 'utf8')
  writeFileSync(join(启动过目录, '.dsh-launch.json'), JSON.stringify({ pid: process.pid, at: Date.now() }), 'utf8')
  const 管理器3 = 创建SnowLuma({
    家目录: 启动过家,
    读配置: () => ({ SnowLuma: { 目录: '' } }),
    存配置: () => {},
    记账: () => {},
    事件地址: () => 事件地址,
  })
  const 启动候选 = 管理器3.候选目录({ SnowLuma: { 目录: '' } }).find((x) => x.目录 === 启动过目录)
  报('我们拉起过的目录也算同意证据', !!启动候选 && 启动候选.同意.已同意 === true && 启动候选.同意.原因.includes('DSH'),
    JSON.stringify(启动候选))
} finally {
  rmSync(家, { recursive: true, force: true })
}

console.log(`\n${挂了 === 0 ? '全部通过 ✅' : `有 ${挂了} 条没过 ❌`}`)
process.exitCode = 挂了 === 0 ? 0 : 1
