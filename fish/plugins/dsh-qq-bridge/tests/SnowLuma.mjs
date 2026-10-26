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

  // ---------- 全局 + per-UIN ----------
  writeFileSync(join(安装目录, 'config', 'onebot_2514029319.json'), JSON.stringify({
    mode: 'snapshot',
    networks: { httpServers: [{ name: 'http-default', port: 3000, host: '127.0.0.1', path: '/', enableWebSocket: false, messageFormat: 'array', reportSelfMessage: false }], httpClients: [] },
  }, null, 2), 'utf8')
  writeFileSync(join(安装目录, 'config', 'runtime.json'), JSON.stringify({ webuiPort: 6099, hookAutoLoad: false }, null, 2), 'utf8')
  const 写了 = 写SnowLuma配置(安装目录, 事件地址, 3002)
  const 运行 = JSON.parse(readFileSync(join(安装目录, 'config', 'runtime.json'), 'utf8'))
  const 账号 = JSON.parse(readFileSync(join(安装目录, 'config', 'onebot_2514029319.json'), 'utf8'))
  报('后台端口和监听固定回环', 运行.webuiPort === 后台端口 && 运行.webuiHost === '127.0.0.1' && 运行.hookAutoLoad === false, JSON.stringify(运行))
  报('per-UIN 快照也写同一端口并加事件上报',
    账号.mode === 'snapshot' && 账号.networks.httpServers.some((x) => x.name === 'http-default' && x.port === 3002) &&
      (账号.networks.httpClients || []).some((x) => x.name === 'dsh-event' && x.url === 事件地址))
  报('配置写到了这些文件', 写了.length >= 3 && 写了.every((x) => existsSync(x)), JSON.stringify(写了.map((x) => x.split(/[\\/]/).pop())))

  // ---------- 目录识别 / 候选 ----------
  报('空目录不算 SnowLuma', 是SnowLuma目录(家) === false)
  writeFileSync(join(安装目录, 'index.mjs'), '// fake\n', 'utf8')
  writeFileSync(join(安装目录, 'node.exe'), '', 'utf8')
  writeFileSync(join(安装目录, 'release.json'), JSON.stringify({ version: '9.9.9' }), 'utf8')
  报('有 index.mjs + node.exe 才算装过', 是SnowLuma目录(安装目录) === true)
  报('版本从 release.json 读', 读SnowLuma版本(安装目录) === '9.9.9')

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
} finally {
  rmSync(家, { recursive: true, force: true })
}

console.log(`\n${挂了 === 0 ? '全部通过 ✅' : `有 ${挂了} 条没过 ❌`}`)
process.exitCode = 挂了 === 0 ? 0 : 1
