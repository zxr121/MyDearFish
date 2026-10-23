/**
 * lib/replies.mjs —— 把 B 站「收到的回复」整理成能直接用来回评的列表。
 *
 * 数据来自 Python MCP 的 `bili_received_replies`（`/x/msgfeed/reply`）。回复通知把
 * 视频、回复者、对方说了什么、被回复的是哪条评论都放在 `item` 里：
 *   · `item.source_id`   对方那条回复的 id（回评时作为 rpid / parent）
 *   · `item.root_id`     楼中楼最顶层的评论 id（有就作为 root）
 *   · `item.target_id`   被回复的评论 id
 *   · `item.uri`         跳转链接，视频回复通常带 BV 号
 *
 * 这里只做「读」的整理，不发任何东西；发不发、回哪条由主会话决定。
 * 非视频回复（动态、专栏等）先跳过：当前的 `bili_reply` 只会发视频评论。
 */

const BV_RE = /BV[0-9A-Za-z]{10}/

const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
const toNumber = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const firstText = (...values) => {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

/** 通知列表可能在 `data.items` 里，也可能已经被 MCP 拆掉了 `data` 外壳。 */
function itemsOf(raw) {
  let value = raw
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return [] }
  }
  const root = asObject(value)
  const data = Object.keys(asObject(root.data)).length ? asObject(root.data) : root
  return Array.isArray(data.items) ? data.items : []
}

/**
 * 整理收到的回复。
 * @param raw - `bili_received_replies` 返回的 JSON（对象或已解析的字符串）。
 * @param options - `limit` 最多返回几条；`seenTargets` 已经回过的目标评论 id；
 *   `now` 当前毫秒时间；`maxAgeHours` 只保留最近多少小时（0 = 不过滤）。
 * @returns `{ items, skipped, total }`；每条带 `bvid` / `rpid` / `root` / `targetId` /
 *   `nickname` / `text` / `myComment` / `alreadyReplied` / `canReply`。
 */
export function normalizeReceivedReplies(raw, {
  limit = 10,
  seenTargets = new Set(),
  now = Date.now(),
  maxAgeHours = 168,
} = {}) {
  const replied = new Set([...seenTargets].map((v) => toNumber(v)).filter(Boolean))
  const skipped = { old: 0, otherBusiness: 0, noBvid: 0, invalid: 0, alreadyReplied: 0 }
  const rows = []
  const seen = new Set()

  for (const rawItem of itemsOf(raw)) {
    const notice = asObject(rawItem)
    const item = asObject(notice.item)
    const user = asObject(notice.user)

    // business_id：1 = 视频评论，11/17 等是动态等其它业务；先只处理视频。
    if (toNumber(item.business_id) !== 1) { skipped.otherBusiness++; continue }

    const replyTime = toNumber(notice.reply_time) || toNumber(item.reply_time)
    const repliedAtMs = replyTime > 0 ? replyTime * 1000 : 0
    if (maxAgeHours > 0 && repliedAtMs > 0 && now - repliedAtMs > maxAgeHours * 3600_000) {
      skipped.old++
      continue
    }

    const rpid = toNumber(item.source_id)
    if (!rpid) { skipped.invalid++; continue }
    if (seen.has(rpid)) continue

    const targetId = toNumber(item.target_id)
    const rootId = toNumber(item.root_id)
    // 直接回她的一级评论时 root_id 可能是 0，target_id 才是那一楼；把它当作 root。
    const root = rootId || (targetId && targetId !== rpid ? targetId : 0)

    let bvid = ''
    for (const candidate of [item.uri, item.native_uri]) {
      const hit = BV_RE.exec(String(candidate || ''))
      if (hit) { bvid = hit[0]; break }
    }
    if (!bvid) skipped.noBvid++

    const text = firstText(item.source_content, item.title, item.message)
    const myComment = firstText(item.target_reply_content, item.root_reply_content)
    const nickname = firstText(user.nickname) || '有人'
    const alreadyReplied = replied.has(rpid)
    if (alreadyReplied) skipped.alreadyReplied++

    seen.add(rpid)
    rows.push({
      notificationId: toNumber(notice.id),
      bvid,
      aid: bvid ? 0 : toNumber(item.subject_id),
      canReply: Boolean(bvid),
      rpid,
      root,
      targetId,
      nickname,
      text: text.slice(0, 500),
      myComment: myComment.slice(0, 300),
      title: firstText(item.title).slice(0, 160),
      replyTime,
      alreadyReplied,
      uri: String(item.uri || ''),
    })
  }

  rows.sort((a, b) => b.replyTime - a.replyTime)
  const max = Math.max(1, Math.min(toNumber(limit) || 10, 50))
  return { items: rows.slice(0, max), skipped, total: rows.length }
}

// ── 单独跑：node lib/replies.mjs '<json>'（手工看归一化结果用）──
if (process.argv[1] && /replies\.mjs$/.test(process.argv[1])) {
  const raw = process.argv[2] || '{"items":[]}'
  console.log(JSON.stringify(normalizeReceivedReplies(raw), null, 2))
}
