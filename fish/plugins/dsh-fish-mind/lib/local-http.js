// 本地设置路由的来源防线和小工具。
//
// DSH 的 Web 端口只监听本机，但浏览器里的任意网页仍能向 127.0.0.1 发跨站请求，
// DNS rebinding 还能让攻击者的域名落到本机端口。这些路由能改出生设定、下载和导入
// 整条鱼的记忆，所以只放行本机界面发起的请求。
//
// 规则与 DSH 的 /api Host/Origin 栅栏一致：
//   1) Host 必须是回环、监听器绑定地址，或没有 Host（非浏览器客户端）；
//   2) Sec-Fetch-Site: cross-site 一律拒绝；
//   3) 带 Origin 时必须与 Host 同源。

function parseAuthority(authority, scheme = 'http:') {
  try {
    return new URL(`${scheme}//${authority}`)
  } catch {
    return undefined
  }
}

function isLoopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function isBindAddress(hostname, bindHost) {
  if (typeof bindHost !== 'string' || bindHost === '') return false
  const zoneAt = bindHost.indexOf('%')
  const address = zoneAt === -1 ? bindHost : bindHost.slice(0, zoneAt)
  const parsed = parseAuthority(address.includes(':') ? `[${address}]` : address)
  return parsed !== undefined && parsed.hostname === hostname
}

function isSameAuthorityOrigin(origin, host) {
  let originUrl
  try {
    originUrl = new URL(origin)
  } catch {
    return false
  }
  const scheme = originUrl.protocol === 'https:' ? 'https:'
    : originUrl.protocol === 'http:' ? 'http:'
      : undefined
  if (scheme === undefined) return false
  const hostUrl = parseAuthority(host, scheme)
  return hostUrl !== undefined && originUrl.host === hostUrl.host
}

/**
 * 判断一个 Node HTTP 请求是否来自本机界面。
 * @param req - Node IncomingMessage（只需要 headers）。
 * @param bindHost - DSH webServer 绑定的地址（ctx.webServer.host）。
 * @param protocol - 监听器协议，'http:' 或 'https:'。
 * @returns 是否放行。
 */
export function isTrustedLocalRequest(req, bindHost, protocol = 'http:') {
  const headers = req && typeof req.headers === 'object' && req.headers !== null ? req.headers : {}
  const host = typeof headers.host === 'string' ? headers.host : ''
  if (host !== '') {
    const hostUrl = parseAuthority(host, protocol === 'https:' ? 'https:' : 'http:')
    if (hostUrl === undefined) return false
    if (!isLoopbackHostname(hostUrl.hostname) && !isBindAddress(hostUrl.hostname, bindHost)) return false
  }
  if (headers['sec-fetch-site'] === 'cross-site') return false
  const origin = typeof headers.origin === 'string' ? headers.origin : ''
  if (origin === '') return true
  if (host === '') return false
  return isSameAuthorityOrigin(origin, host)
}

function tooLarge(limit) {
  const error = new Error(`内容太大，最多 ${Math.round(limit / 1024 / 1024)} MB`)
  error.statusCode = 413
  return error
}

/**
 * 读完请求正文，超过上限立刻失败；压缩包走这里。
 * @param req - Node IncomingMessage。
 * @param limit - 最大字节数。
 * @returns {Promise<Buffer>} 原始正文。
 */
export async function readBodyLimited(req, limit) {
  const declared = Number(req.headers && req.headers['content-length'])
  if (Number.isFinite(declared) && declared > limit) throw tooLarge(limit)
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > limit) throw tooLarge(limit)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/**
 * 读完 JSON 请求正文；与压缩包不同，这里的上限很小。
 * @param req - Node IncomingMessage。
 * @param limit - 最大字节数。
 * @returns {Promise<unknown>} 解析后的 JSON；空正文当 `{}`。
 */
export async function readJsonLimited(req, limit = 64 * 1024) {
  const buffer = await readBodyLimited(req, limit)
  if (buffer.length === 0) return {}
  try {
    return JSON.parse(buffer.toString('utf8'))
  } catch {
    const error = new Error('请求正文不是合法 JSON')
    error.statusCode = 400
    throw error
  }
}

/**
 * 发一个 JSON 响应。
 * @param res - Node ServerResponse。
 * @param statusCode - HTTP 状态码。
 * @param value - 要序列化的值。
 */
export function sendJson(res, statusCode, value) {
  const body = JSON.stringify(value)
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

/**
 * 发一段二进制内容（导出压缩包用）。
 * @param res - Node ServerResponse。
 * @param statusCode - HTTP 状态码。
 * @param buffer - 正文。
 * @param headers - 额外响应头。
 */
export function sendBytes(res, statusCode, buffer, headers = {}) {
  res.writeHead(statusCode, {
    'content-type': 'application/octet-stream',
    'cache-control': 'no-store',
    ...headers,
  })
  res.end(buffer)
}
