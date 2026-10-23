/**
 * B 站巡检的预算归属。
 *
 * 一次巡检由两段花费组成：伙伴会话里“去刷一轮”的那一轮，以及它派出去的
 * 子代理会话（可能再往下派）。这两段记在 B 站的额度里；主人同一时段的普通
 * 聊天不算。归属只看会话来源和父子关系，不靠关键词猜内容。
 *
 * 巡检消息一旦到达，就把这条会话标成“正在巡”；主人随后说了别的话，标记
 * 立刻让位给主人的新消息，避免把普通对话算进 B 站。子代理在标注有效期内
 * 建立，就带着自己的 TTL 继续归属；重启会清空内存里的标记，只影响当时还没
 * 结束的那一轮。
 *
 * @module @mydearfish/dsh-fish-mind/bili-quota
 */

const DEFAULT_WINDOW_MS = 15 * 60_000
const DEFAULT_SESSION_TTL_MS = 60 * 60_000
const MAX_ENTRIES = 512
const MAX_DEPTH = 8

/**
 * 创建一个只存在于内存的 B 站巡检归属器。
 * @param {object} [options] - `windowMs` 触发标记有效多久，`sessionTtlMs` 子代理归属多久，`now` 可注入时钟。
 * @returns {{noteUser:Function,noteSession:Function,scopeOf:Function}} 归属器。
 */
export function createBiliQuota({ windowMs = DEFAULT_WINDOW_MS, sessionTtlMs = DEFAULT_SESSION_TTL_MS, now = Date.now } = {}) {
  const lastUser = new Map()
  const sessions = new Map()
  const parents = new Map()

  function prune(at) {
    if (lastUser.size > MAX_ENTRIES) {
      for (const [id, item] of lastUser) if (at - item.at > windowMs) lastUser.delete(id)
    }
    if (sessions.size > MAX_ENTRIES) {
      for (const [id, until] of sessions) if (until < at) sessions.delete(id)
    }
    if (parents.size > MAX_ENTRIES) {
      for (const [id, item] of parents) if (at - item.at > sessionTtlMs) parents.delete(id)
    }
  }

  function active(sessionId, at) {
    const id = String(sessionId || '')
    if (id === '') return false
    const until = sessions.get(id)
    if (until !== undefined && until >= at) return true
    const last = lastUser.get(id)
    return Boolean(last && last.kind === 'bili' && at - last.at <= windowMs)
  }

  /**
   * 记下一条用户消息。只有最新的消息说话：主人在巡演期间插话，
   * 这条会话就从 B 站归属里退出。
   * @param {string} sessionId - 会话 id。
   * @param {string} kind - 来源类型，`bili` 表示巡检触发。
   * @param {number} [at] - 事件时间。
   * @returns {void}
   */
  function noteUser(sessionId, kind, at = now()) {
    const id = String(sessionId || '')
    if (id === '') return
    lastUser.set(id, { kind: String(kind || ''), at })
    prune(at)
  }

  /**
   * 记下一条子代理会话事件。父会话在巡检窗口里，或父会话自己已经归属 B 站，
   * 这条子代理就跟着归属；后续事件只刷新父链，不延长已经给出的 TTL。
   * @param {string} sessionId - 子代理会话 id。
   * @param {object} header - 会话头，至少带 `parentSession`。
   * @param {number} [at] - 事件时间。
   * @returns {void}
   */
  function noteSession(sessionId, header, at = now()) {
    const id = String(sessionId || '')
    if (id === '') return
    const parent = header && header.parentSession ? String(header.parentSession) : ''
    if (parent === '') return
    parents.set(id, { parent, at })
    if (sessions.has(id)) return
    const parentActive = active(parent, at)
      || (parents.has(parent) && lineageActive(parent, at))
    if (parentActive) sessions.set(id, at + sessionTtlMs)
    prune(at)
  }

  function lineageActive(sessionId, at) {
    let current = String(sessionId || '')
    for (let depth = 0; depth < MAX_DEPTH && current !== ''; depth += 1) {
      if (active(current, at)) return true
      const link = parents.get(current)
      current = link ? link.parent : ''
    }
    return false
  }

  /**
   * 这次模型调用算不算 B 站巡检。
   * @param {string} sessionId - 发起调用的会话 id。
   * @param {number} [at] - 当前时间。
   * @returns {'bili'|''} 归属标签。
   */
  function scopeOf(sessionId, at = now()) {
    return lineageActive(sessionId, at) ? 'bili' : ''
  }

  return { noteUser, noteSession, scopeOf }
}
