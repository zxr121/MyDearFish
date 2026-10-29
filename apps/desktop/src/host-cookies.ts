/** Loopback Host authentication cookies left by earlier Desktop launches. */
import { session, type Cookie } from 'electron'

const HOST_COOKIE_PREFIX = 'dsh-auth-'
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '::1'])

/**
 * Host bootstrap cookie management.
 * Each Host boot binds a random loopback port and sets a cookie whose name and
 * signature are bound to that authority, so the private Desktop profile would
 * accumulate one persistent cookie per launch. Once the jar outgrows Node's
 * request-header limit, the next launch fails its own handshake with 431 before
 * it can replace them.
 */

/** Cookie operations that Host bootstrap cleanup needs from a session. */
export interface HostCookieJar {
  readonly cookies: {
    get(filter: object): Promise<Cookie[]>
    remove(url: string, name: string): Promise<void>
  }
}

/**
 * Remove Host authentication cookies for loopback authorities.
 * Runs before the launch handshake, which then sets the current authority's cookie.
 * @param target - Session owning the cookie jar.
 * @returns Completion after every stale cookie is removed or its removal fails.
 */
export async function clearStaleHostCookies(target: HostCookieJar = session.defaultSession): Promise<void> {
  const cookies = await target.cookies.get({})
  await Promise.all(cookies.filter(isStaleHostCookie).map(async (cookie) => {
    // Best effort: a jar that still overflows fails loudly at the next authentication step.
    await target.cookies.remove(cookieUrl(cookie), cookie.name).catch(() => undefined)
  }))
}

/** Whether a cookie is a Host bootstrap cookie scoped to a loopback authority. */
function isStaleHostCookie(cookie: Cookie): boolean {
  return cookie.name.startsWith(HOST_COOKIE_PREFIX) && LOOPBACK_HOSTS.has(normalizeDomain(cookie.domain ?? ''))
}

/** Host-only cookies may carry no leading dot; strip any to compare loopback hosts. */
function normalizeDomain(domain: string): string {
  return domain.startsWith('.') ? domain.slice(1) : domain
}

/** The URL Electron needs to address a cookie, bracketing IPv6 loopback hosts. */
function cookieUrl(cookie: Cookie): string {
  const domain = normalizeDomain(cookie.domain ?? '')
  const host = domain.includes(':') && !domain.startsWith('[') ? `[${domain}]` : domain
  return `${cookie.secure === true ? 'https' : 'http'}://${host}${cookie.path ?? '/'}`
}
