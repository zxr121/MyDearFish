// 读鱼 QQ 当前登录账号的群和好友名单，只给开发者模式 + 主人前台会话。
//
// 只调 OneBot 的只读接口（get_login_info / get_group_list / get_friend_list），
// 不读 SnowLuma 后台密码或令牌，也不发任何消息。号码只进主人自己的会话记录。

import { readQqConfig, readQqSocial, qqSocialValues } from './config-files.js'

const FALLBACK_ENDPOINTS = ['http://127.0.0.1:3002', 'http://127.0.0.1:3000']
const REQUEST_TIMEOUT_MS = 2500
const MAX_GROUPS = 300
const MAX_FRIENDS = 500

function endpointOf(value) {
  const text = String(value === undefined || value === null ? '' : value).trim().replace(/\/+$/, '')
  if (text === '') return ''
  return /^https?:\/\//i.test(text) ? text : `http://${text}`
}

/** 问一次本机 OneBot 的只读接口；连不上、不是 OneBot 或超时都当作没读到。 */
async function askOneBot(base, action) {
  try {
    const response = await fetch(`${base}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const json = await response.json()
    if (json && json.status === 'ok') return { ok: true, data: json.data }
    // 能返回 retcode/status 说明端口上确实是 OneBot，只是没登录或这个动作失败。
    return { ok: false, oneBot: Boolean(json && (typeof json.retcode === 'number' || typeof json.status === 'string')) }
  } catch {
    return { ok: false, oneBot: false }
  }
}

function textOf(value, limit = 40) {
  return String(value === undefined || value === null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, limit)
}

function idOf(value) {
  const text = String(value === undefined || value === null ? '' : value).trim()
  return /^\d{3,20}$/.test(text) ? text : ''
}

function groupOf(item) {
  const id = idOf(item && item.group_id)
  if (id === '') return null
  const members = Number(item && item.member_count)
  return { id, name: textOf(item && (item.group_name || item.group_remark)), members: Number.isFinite(members) ? members : 0 }
}

function friendOf(item) {
  const id = idOf(item && item.user_id)
  if (id === '') return null
  return { id, name: textOf(item && (item.remark || item.nickname)) }
}

function configuredOf(social) {
  const values = qqSocialValues(social)
  return {
    enabled: values['启用'],
    groups: values['群'],
    friends: values['好友'],
    off: values['关掉'],
    only: values['只听'],
    mix: values['少掺和'],
  }
}

/**
 * 读鱼 QQ 当前登录账号的群、好友和设置里已有的名单。
 * @param {{ dshHome: string }} options - DSH 主目录。
 * @returns {Promise<object>} `{ ok, qq, groups, friends, configured, note }` 或 `{ ok:false, error, configured }`。
 */
export async function readQqRoster({ dshHome }) {
  const read = readQqConfig(dshHome)
  const social = readQqSocial(dshHome)
  const configured = configuredOf(social.social)
  if (read.error !== '') {
    return { ok: false, error: `QQ 设置文件读不出来（${read.error}），先把配置文件修好或删掉再读名单。`, configured }
  }
  const raw = read.value !== null && typeof read.value === 'object' ? read.value : {}
  const candidates = []
  for (const value of [raw['NapCat'], ...FALLBACK_ENDPOINTS]) {
    const endpoint = endpointOf(value)
    if (endpoint !== '' && !candidates.includes(endpoint)) candidates.push(endpoint)
  }
  let sawOneBot = false
  let loggedIn = null
  for (const endpoint of candidates) {
    const login = await askOneBot(endpoint, 'get_login_info')
    if (login.oneBot) sawOneBot = true
    if (!login.ok || !login.data) continue
    loggedIn = { endpoint, data: login.data }
    break
  }
  if (loggedIn === null) {
    return {
      ok: false,
      error: sawOneBot
        ? '本机的 OneBot 有回应，但鱼 QQ 还没登录：先在「通到QQ」里登录鱼 QQ，再读名单。'
        : '本机 OneBot 没有回应：先确认 SnowLuma 和鱼 QQ 已经启动，再读名单。',
      configured,
    }
  }
  const [groupResult, friendResult] = await Promise.all([
    askOneBot(loggedIn.endpoint, 'get_group_list'),
    askOneBot(loggedIn.endpoint, 'get_friend_list'),
  ])
  if (!groupResult.ok || !Array.isArray(groupResult.data) || !friendResult.ok || !Array.isArray(friendResult.data)) {
    return { ok: false, error: 'OneBot 没有给出完整的群 / 好友名单：确认鱼 QQ 已登录后重试。', configured }
  }
  const allGroups = groupResult.data.map(groupOf).filter((item) => item !== null)
  const allFriends = friendResult.data.map(friendOf).filter((item) => item !== null)
  return {
    ok: true,
    qq: {
      id: idOf(loggedIn.data.user_id),
      name: textOf(loggedIn.data.nickname),
    },
    groups: allGroups.slice(0, MAX_GROUPS),
    friends: allFriends.slice(0, MAX_FRIENDS),
    truncated: allGroups.length > MAX_GROUPS || allFriends.length > MAX_FRIENDS,
    configured,
    note: '只读名单，不会发消息；号码只在你自己的会话里用，不要发到群里。',
  }
}
