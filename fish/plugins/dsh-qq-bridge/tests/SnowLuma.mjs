// SnowLuma 安装/配置管理器的离线测试：不联网、不启动进程。
// 验：OneBot 端口解析与配置合并（事件 httpClient）、后台密码哈希、目录识别、候选目录、协议前置。
// 跑法： node tests/SnowLuma.mjs

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scryptSync } from 'node:crypto'

import {
  后台端口,
  默认OneBot端口,
  认得的OneBot端口,
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
  报('认已有实例的端口含 3003：SnowLuma 在 3002 被占时会顺延到这个口',
    JSON.stringify(认得的OneBot端口) === JSON.stringify([3002, 3003, 3000]), JSON.stringify(认得的OneBot端口))
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

  // ---------- 选了她的号：只有她那份接 DSH，别的号让开 ----------
  const 主人号文件 = join(安装目录, 'config', 'onebot_837263217.json')
  writeFileSync(主人号文件, JSON.stringify({
    mode: 'snapshot',
    networks: {
      httpServers: [{ name: 'http-default', port: 3002, host: '127.0.0.1', path: '/', enableWebSocket: false, messageFormat: 'array', reportSelfMessage: false }],
      httpClients: [{ name: 'dsh-event', url: 事件地址, enabled: true }, { name: '别的客户端', url: 'http://x', enabled: true }],
    },
    statusCommand: { enabled: true, swallow: false, cooldownSeconds: 5, trigger: '#sl' },
  }, null, 2), 'utf8')
  写SnowLuma配置(安装目录, 事件地址, 3002, { 账号: '2514029319' })
  const 她的 = JSON.parse(readFileSync(join(安装目录, 'config', 'onebot_2514029319.json'), 'utf8'))
  const 主人号 = JSON.parse(readFileSync(主人号文件, 'utf8'))
  const 全局 = JSON.parse(readFileSync(单文件, 'utf8'))
  const 她的服务 = 她的.networks.httpServers.find((x) => x.name === 'http-default')
  const 主人服务 = 主人号.networks.httpServers.find((x) => x.name === 'http-default')
  const 全局服务 = 全局.networks.httpServers.find((x) => x.name === 'http-default')
  报('选了她的号：她那份额到 DSH 端口并挂事件上报',
    她的服务.port === 3002 && 她的.networks.httpClients.some((x) => x.name === 'dsh-event' && x.url === 事件地址),
    JSON.stringify({ port: 她的服务.port }))
  报('别的号摘掉事件上报、让出同一个端口，别的客户端留着',
    主人服务.port === 3004 && !主人号.networks.httpClients.some((x) => x.name === 'dsh-event') &&
      主人号.networks.httpClients.some((x) => x.name === '别的客户端'),
    JSON.stringify({ port: 主人服务.port, clients: 主人号.networks.httpClients.map((x) => x.name) }))
  报('她有自己的文件时，全局那份也算别的号，一起让开',
    全局服务.port === 3003 && !全局.networks.httpClients.some((x) => x.name === 'dsh-event'),
    JSON.stringify({ port: 全局服务.port, clients: 全局.networks.httpClients.map((x) => x.name) }))
  报('让开的号不会两个号抢同一个端口', 主人服务.port !== 全局服务.port, `${主人服务.port}/${全局服务.port}`)

  // ---------- 选账号：读后台的 QQ 列表，把她要的号接过来 ----------
  // 假 SnowLuma 后台（5099）和假 OneBot：走全局 fetch，不联网、不碰真端口。
  const 真fetch = globalThis.fetch
  let 世界 = null
  const 开假世界 = (设置) => {
    const 这 = {
      密码: '后台秘密',
      令牌: 设置.令牌 || 'tok-1',
      账号们: 设置.账号们,
      配置表: JSON.parse(JSON.stringify(设置.配置表)),
      在听表: new Map(设置.在听表 || []),
      记录: { 登录: [], 配置POST: [], 加载: [] },
    }
    const 昵称 = (号) => {
      const 项 = 这.账号们.find((x) => String((x.account && x.account.uin) || '') === String(号))
      return String((项 && 项.account && 项.account.nickname) || '')
    }
    globalThis.fetch = async (url, 选项 = {}) => {
      const u = new URL(String(url))
      const 方法 = String(选项.method || 'GET').toUpperCase()
      const 请求体 = typeof 选项.body === 'string' && 选项.body !== '' ? JSON.parse(选项.body) : null
      const 回 = (状态, 数据, 文本) => ({
        ok: 状态 >= 200 && 状态 < 300,
        status: 状态,
        json: async () => 数据,
        text: async () => (文本 === undefined ? JSON.stringify(数据) : 文本),
      })
      if (u.port === String(后台端口)) {
        const 令牌 = String((选项.headers && 选项.headers['x-snowluma-token']) || '')
        if (u.pathname === '/api/login' && 方法 === 'POST') {
          这.记录.登录.push(请求体)
          return 请求体 && 请求体.password === 这.密码
            ? 回(200, { success: true, token: 这.令牌 })
            : 回(401, { success: false, message: '密码不对' })
        }
        if (u.pathname === '/api/processes' && 方法 === 'GET') {
          return 令牌 === 这.令牌 ? 回(200, { list: 这.账号们 }) : 回(401, { message: '没登录' })
        }
        const 配置路 = u.pathname.match(/^\/api\/config\/(\d+)$/)
        if (配置路 && 令牌 === 这.令牌) {
          const 号 = 配置路[1]
          if (方法 === 'GET') return 这.配置表[号] ? 回(200, { config: 这.配置表[号] }) : 回(404, { message: '没有这个号' })
          if (方法 === 'POST') {
            这.记录.配置POST.push({ 号, 体: 请求体 })
            这.配置表[号] = 请求体
            // SnowLuma 热重载：按新配置立刻应答 OneBot
            for (const [端口, 谁] of [...这.在听表]) if (谁.号 === 号) 这.在听表.delete(端口)
            const 服 = ((请求体.networks && 请求体.networks.httpServers) || []).find((x) => x && x.name === 'http-default')
            if (服 && 服.enabled !== false) 这.在听表.set(Number(服.port), { 号, 昵称: 昵称(号) })
            return 回(200, { success: true })
          }
        }
        const 加载路 = u.pathname.match(/^\/api\/processes\/(\d+)\/load$/)
        if (加载路 && 方法 === 'POST') {
          这.记录.加载.push(Number(加载路[1]))
          return 回(200, { success: true })
        }
        if (u.pathname === '/' && 方法 === 'GET') return 回(200, { ok: true })
        return 回(404, { message: '没有这个接口' })
      }
      if (u.pathname === '/get_login_info') {
        const 谁 = 这.在听表.get(Number(u.port))
        if (!谁) return 回(404, {}, 'not found')
        return 回(200, { status: 'ok', retcode: 0, data: { user_id: Number(谁.号), nickname: 谁.昵称 } })
      }
      return 回(404, {}, 'not found')
    }
    世界 = 这
    return 这
  }

  const 找空端口 = async (从 = 3010, 到 = 3099) => {
    for (let 端口 = 从; 端口 <= 到; 端口++) {
      const 空 = await new Promise((resolve) => {
        const 服 = createServer()
        服.once('error', () => resolve(false))
        服.listen(端口, '127.0.0.1', () => 服.close(() => resolve(true)))
      })
      if (空) return 端口
    }
    throw new Error('测试机上 3010–3099 全被占了')
  }

  const 主人QQ = '837263217'
  const 她QQ = '2514029319'
  const 主人OneBot配置 = {
    networks: {
      httpServers: [{ name: 'http-default', port: 3002, host: '127.0.0.1', enabled: true }],
      httpClients: [{ name: 'dsh-event', url: 事件地址, enabled: true }, { name: '主人的客户端', url: 'http://x', enabled: true }],
    },
  }
  let 号配置 = {
    NapCat: 'http://127.0.0.1:3002',
    SnowLuma: { 目录: '', 后台密码: '后台秘密', 同意协议: true, 自动启动: true, 账号: '' },
  }
  const 号管理器 = 创建SnowLuma({
    家目录: 家,
    读配置: () => 号配置,
    存配置: (c) => { 号配置 = c },
    记账: () => {},
    事件地址: () => 事件地址,
  })

  try {
    // 她还没接上：她那份也写着 3002；主人号正占着 3002 在应答
    世界 = 开假世界({
      账号们: [
        { pid: 111, status: 'online', injected: true, account: { uin: Number(主人QQ), nickname: '@EMT@' } },
        { pid: 222, status: 'online', injected: false, account: { uin: Number(她QQ), nickname: 'EMT的可爱大肥鱼' } },
      ],
      配置表: {
        [主人QQ]: 主人OneBot配置,
        [她QQ]: { networks: { httpServers: [{ name: 'http-default', port: 3002, host: '127.0.0.1', enabled: true }], httpClients: [] } },
      },
      在听表: [[3002, { 号: 主人QQ, 昵称: '@EMT@' }]],
    })
    const 切 = await 号管理器.选账号(她QQ)
    const 她那条 = 世界.记录.配置POST.find((x) => x.号 === 她QQ)
    const 她的服务 = 她那条 && 她那条.体.networks.httpServers.find((x) => x.name === 'http-default')
    const 她端口 = 她的服务 ? Number(她的服务.port) : 0
    报('选账号：查到她的号，接到一个不撞主人的端口',
      切.ok === true && 切.账号 && 切.账号.号 === 她QQ && 切.账号.昵称 === 'EMT的可爱大肥鱼' && 她端口 > 0 && 她端口 !== 3002,
      JSON.stringify(切))
    报('她的 OneBot 收本机端口、挂事件上报',
      !!她那条 && 她的服务.host === '127.0.0.1' &&
        她那条.体.networks.httpClients.some((x) => x.name === 'dsh-event' && x.url === 事件地址),
      JSON.stringify(她那条 && 她那条.体.networks))
    报('切过去后配置记住新地址和她的号',
      号配置.NapCat === `http://127.0.0.1:${她端口}` && 号配置.SnowLuma.账号 === 她QQ,
      JSON.stringify({ NapCat: 号配置.NapCat, 账号: 号配置.SnowLuma.账号 }))
    报('还没接入的号顺手 load', 世界.记录.加载.includes(222), JSON.stringify(世界.记录.加载))
    const 主人那条 = 世界.记录.配置POST.find((x) => x.号 === 主人QQ)
    const 主人服务2 = 主人那条 && 主人那条.体.networks.httpServers.find((x) => x.name === 'http-default')
    报('不占她端口的别的号不搬，但事件上报也摘掉，自己的客户端留着',
      !!主人那条 && Number(主人服务2.port) === 3002 &&
        !主人那条.体.networks.httpClients.some((x) => x.name === 'dsh-event') &&
        主人那条.体.networks.httpClients.some((x) => x.name === '主人的客户端'),
      JSON.stringify(主人那条 && { port: 主人服务2.port, clients: 主人那条.体.networks.httpClients.map((x) => x.name) }))
    const 号态 = await 号管理器.状态()
    报('状态里带账号列表和当前号',
      号态.已连QQ === true && 号态.用户 === 她QQ && 号态.账号们.当前 === 她QQ && 号态.账号们.列表.length === 2 && !号态.账号们.错,
      JSON.stringify({ 用户: 号态.用户, 账号们: 号态.账号们 }))

    // 她已经在某个口上应答了：只改地址，不再写 SnowLuma 配置
    世界 = 开假世界({
      账号们: [
        { pid: 111, status: 'online', injected: true, account: { uin: Number(主人QQ), nickname: '@EMT@' } },
        { pid: 222, status: 'online', injected: true, account: { uin: Number(她QQ), nickname: 'EMT的可爱大肥鱼' } },
      ],
      配置表: { [主人QQ]: 主人OneBot配置 },
      在听表: [[3002, { 号: 主人QQ, 昵称: '@EMT@' }], [3006, { 号: 她QQ, 昵称: 'EMT的可爱大肥鱼' }]],
    })
    号配置 = { NapCat: 'http://127.0.0.1:3002', SnowLuma: { ...号配置.SnowLuma, 账号: '' } }
    const 切现成 = await 号管理器.选账号(她QQ)
    报('她已经在线就只改地址，不动 SnowLuma',
      切现成.ok === true && 切现成.说.includes('已经接上') && 号配置.NapCat === 'http://127.0.0.1:3006' &&
        号配置.SnowLuma.账号 === 她QQ && 世界.记录.配置POST.length === 0 && 世界.记录.加载.length === 0,
      JSON.stringify({ 说: 切现成.说, NapCat: 号配置.NapCat, POST: 世界.记录.配置POST.length }))

    const 没这个号 = await 号管理器.选账号('1234567')
    报('SnowLuma 里没有的号直接说清楚', 没这个号.ok === false && 没这个号.说.includes('1234567') && 没这个号.说.includes('先在后台登录'),
      JSON.stringify(没这个号))
    const 坏号 = await 号管理器.选账号('abc')
    报('不是 QQ 号的输入不放行', 坏号.ok === false && 坏号.说.includes('QQ 号'), JSON.stringify(坏号))

    // 后台密码不对：令牌过期后才会真去登录；同一个错密码只试一次，别把 SnowLuma 后台锁死
    号配置 = { ...号配置, SnowLuma: { ...号配置.SnowLuma, 后台密码: '错的密码' } }
    世界 = 开假世界({
      令牌: 'tok-2',
      账号们: [
        { pid: 111, status: 'online', injected: true, account: { uin: Number(主人QQ), nickname: '@EMT@' } },
        { pid: 222, status: 'online', injected: true, account: { uin: Number(她QQ), nickname: 'EMT的可爱大肥鱼' } },
      ],
      配置表: { [主人QQ]: 主人OneBot配置 },
      在听表: [[3002, { 号: 主人QQ, 昵称: '@EMT@' }]],
    })
    const 错密码1 = await 号管理器.选账号(她QQ)
    const 错密码2 = await 号管理器.选账号(她QQ)
    报('后台密码不对只登录一次，不把 SnowLuma 后台锁死',
      错密码1.ok === false && 错密码1.说.includes('登录失败') && 错密码2.ok === false && 世界.记录.登录.length === 1,
      JSON.stringify({ 说1: 错密码1.说, 说2: 错密码2.说, 登录: 世界.记录.登录.length }))
    号配置 = { ...号配置, SnowLuma: { ...号配置.SnowLuma, 后台密码: '后台秘密' } }

    // 另一个号也写在同一个口上：先让它让开，再把她接上去
    const 挑好的端口 = await 找空端口()
    世界 = 开假世界({
      账号们: [
        { pid: 111, status: 'online', injected: true, account: { uin: Number(主人QQ), nickname: '@EMT@' } },
        { pid: 222, status: 'online', injected: true, account: { uin: Number(她QQ), nickname: 'EMT的可爱大肥鱼' } },
        { pid: 333, status: 'online', injected: true, account: { uin: 111111111, nickname: '另一个号' } },
      ],
      配置表: {
        [主人QQ]: 主人OneBot配置,
        [她QQ]: { networks: { httpServers: [{ name: 'http-default', port: 挑好的端口, host: '127.0.0.1' }], httpClients: [] } },
        '111111111': {
          networks: {
            httpServers: [{ name: 'http-default', port: 挑好的端口, host: '127.0.0.1' }],
            httpClients: [{ name: 'dsh-event', url: 事件地址, enabled: true }, { name: '别的客户端', url: 'http://x', enabled: true }],
          },
        },
      },
      在听表: [[3002, { 号: 主人QQ, 昵称: '@EMT@' }]],
    })
    号配置 = { NapCat: 'http://127.0.0.1:3002', SnowLuma: { ...号配置.SnowLuma, 账号: '' } }
    const 切让开 = await 号管理器.选账号(她QQ)
    const 挪开 = 世界.记录.配置POST.find((x) => x.号 === '111111111')
    const 挪开服务 = 挪开 && 挪开.体.networks.httpServers.find((x) => x.name === 'http-default')
    const 她那条2 = 世界.记录.配置POST.find((x) => x.号 === 她QQ)
    const 她服务2 = 她那条2 && 她那条2.体.networks.httpServers.find((x) => x.name === 'http-default')
    报('同一个口的别的号先让开：摘事件上报、换到没人用的口，别的客户端留着',
      切让开.ok === true && !!挪开 && 挪开服务.port === 3003 && 挪开服务.port !== 挑好的端口 && 挪开服务.port !== 3002 &&
        !挪开.体.networks.httpClients.some((x) => x.name === 'dsh-event') &&
        挪开.体.networks.httpClients.some((x) => x.name === '别的客户端'),
      JSON.stringify({ port: 挪开服务 && 挪开服务.port, clients: 挪开 && 挪开.体.networks.httpClients.map((x) => x.name) }))
    报('她的号用自己配置里那个空着的口', 她服务2 && Number(她服务2.port) === 挑好的端口 && 号配置.NapCat === `http://127.0.0.1:${挑好的端口}`,
      JSON.stringify({ her: 她服务2 && 她服务2.port, 挑好的端口, NapCat: 号配置.NapCat }))
  } finally {
    globalThis.fetch = 真fetch
  }

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
