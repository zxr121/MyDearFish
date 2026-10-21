// 本地设置路由的来源防线（B 站设置页）。
//
// `/api/bili-duty/*` 能改配置、真跑一轮、扫码登录、打开本地文件夹。DSH 的 Web 端口只监听
// 本机，但浏览器里的任意网页仍能向 127.0.0.1 发跨站请求，DNS rebinding 还能让攻击者的域名
// 落到本机端口。这里不建立身份（本机进程本来就能读配置文件），只回答一个问题：
//   这个请求是不是从本机界面发起的？
//
// 规则与 DSH 的 /api Host/Origin 栅栏一致：
//   1) Host 必须是回环、监听器绑定地址，或没有 Host（非浏览器客户端）；
//   2) Sec-Fetch-Site: cross-site 一律拒绝；
//   3) 带 Origin 时必须与 Host 同源。
// 浏览器发起的请求一定会带 Host，所以“没有 Host 也放行”不会给网页留口子。

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
