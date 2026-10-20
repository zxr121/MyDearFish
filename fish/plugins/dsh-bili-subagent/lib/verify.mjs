/**
 * lib/verify.mjs —— 「评论发出后复核」
 * ============================================================================
 * 为什么要有它（2026-10-16，用户 `你的deepseek` 在评论区反馈 + 我们 10/10 亲踩）：
 *   **接口回「发送成功」≠ 公开可见** —— 新号 / 风控会让评论进审核，你自己看不见，
 *   而插件以为发出去了、还把它记进判重表 ⇒ 下一轮不再发 ⇒ **一条都没到人**。
 *   还有更坏的一层：**不公开时连通知都不会推**，于是"@ 了但没人收到"。
 *
 * 复核靠两条只读接口（2026-10-16 实测可行）：
 *   ① **顶层评论**：`/x/v2/reply/main?type=1&oid=<aid>&mode=2&next=0&ps=20`（按时间）
 *      —— 刚发出来的通常在**第一页**；找得到 ⇒ 公开可见（还能顺便读到赞数）。
 *   ② **楼中楼**：`/x/v2/reply/reply?type=1&oid=<aid>&root=<root>&ps=20`
 *      —— 直接按 root 拉那一串，找我们的 rpid。
 *   ⚠️ **看不到 ≠ 没发出**（翻页 / 热度排序都会漏）⇒ 结论一律用"**没查到**"这种说法，
 *      不写成"没发出去"（这是 2026-10-15 那条教训的同一把尺子）。
 *   ✗ `/x/v2/reply/detail` 走不通（回 `-400 请求错误`），别无谓地换它。
 * ============================================================================
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dayKey } from './state.mjs'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 从判重表里抠出「我们发过的评论」记录：容忍 markdown 表格 / 列表 / 随手写的行 */
export function parseSeen(text) {
  const rows = []
  for (const line of String(text).split(/\r?\n/)) {
    const bv = /BV[0-9A-Za-z]{10}/.exec(line)
    if (!bv) continue
    const nums = [...line.matchAll(/\b(\d{9,})\b/g)].map((m) => Number(m[1]))
    if (!nums.length) continue
    // 约定：第一个长数字 = rpid；如果后面还有第二个，且明显是另一个 id，就当 root（楼中楼）
    const rpid = nums[0]
    const root = nums.length > 1 ? nums[1] : 0
    rows.push({ bv: bv[0], rpid, root, line: line.trim().slice(0, 160) })
  }
  return rows
}

export function loadCredential(stateDir) {
  const f = join(stateDir, 'bili_credential.json')
  if (!existsSync(f)) return null
  try {
    const c = JSON.parse(readFileSync(f, 'utf8'))
    if (!c?.sessdata) return null
    return c
  } catch { return null }
}

function headersFor(cred) {
  return {
    'User-Agent': UA,
    Referer: 'https://www.bilibili.com/',
    Cookie: `SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}; buvid3=${cred.buvid3}`,
  }
}

async function jget(url, headers) {
  try {
    const r = await fetch(url, { headers })
    const t = await r.text()
    try { return JSON.parse(t) } catch { return { code: -999, message: 'not json' } }
  } catch (e) { return { code: -998, message: String(e?.message ?? e) } }
}

/**
 * 复核一条：先试顶层（按时间第一页），再试楼中楼（如果记了 root）
 * @returns {{rpid:number, bv:string, visible:boolean|null, likes?:number, how:string, note:string}}
 */
export async function verifyOne(record, { cred, aidCache = new Map(), headers }) {
  const out = { rpid: record.rpid, bv: record.bv, visible: null, how: '', note: '' }
  if (!aidCache.has(record.bv)) {
    const v = await jget(`https://api.bilibili.com/x/web-interface/view?bvid=${record.bv}`, headers)
    aidCache.set(record.bv, v?.code === 0 ? { aid: v.data.aid, mid: v.data.owner?.mid, title: v.data.title } : null)
    await sleep(300)
  }
  const meta = aidCache.get(record.bv)
  if (!meta) { out.how = '取视频信息失败'; out.note = '这条跳过（视频可能已删/不可见）'; return out }
  const aid = meta.aid

  // ① 顶层：按时间第一页（刚发的就在这儿）
  if (!record.root) {
    const d = await jget(`https://api.bilibili.com/x/v2/reply/main?type=1&oid=${aid}&mode=2&next=0&ps=20`, headers)
    const list = d?.data?.replies || []
    const hit = list.find((r) => r.rpid === record.rpid)
    if (hit && hit.rpid === record.rpid) {
      out.visible = true; out.likes = hit.like; out.how = '顶层·最新一页'
      out.note = hit.invisible ? '（但接口标了 invisible）' : ''
      return out
    }
    out.how = '顶层·最新一页'
    out.note = '最新一页里没找到 —— 可能还在审核，也可能只是翻页看不到（**不等于没发出去**）'
    return out
  }

  // ② 楼中楼：按 root 拉那一串
  const d = await jget(`https://api.bilibili.com/x/v2/reply/reply?type=1&oid=${aid}&root=${record.root}&ps=20&pn=1`, headers)
  const subs = d?.data?.replies || []
  const hit = subs.find((r) => r.rpid === record.rpid)
  if (hit) {
    out.visible = true; out.likes = hit.like; out.how = `楼中楼·root=${record.root}`
    out.note = hit.invisible ? '（但接口标了 invisible）' : ''
    return out
  }
  out.how = `楼中楼·root=${record.root}`
  out.note = subs.length
    ? `那一串里有 ${subs.length} 条，但没有我们这条 —— 可能还在审核（**不等于没发出去**）`
    : '那一串暂时拉不到内容 —— 可能还在审核（**不等于没发出去**）'
  return out
}

/**
 * 复核最近的一批（默认最多 6 条、只挑没复核过的）
 * @returns {Promise<{checked:Array, skipped:number, text:string}>}
 */
export async function verifyRecent(stateDir, { max = 6, log = () => {} } = {}) {
  const seenFile = join(stateDir, 'seen.md')
  if (!existsSync(seenFile)) return { checked: [], skipped: 0, text: '⚠️ 判重表还没生成，没什么可复核的' }
  const cred = loadCredential(stateDir)
  if (!cred) return { checked: [], skipped: 0, text: '⚠️ 还没扫码登录，没法复核（复核要用你自己的登录态）' }

  const rows = parseSeen(readFileSync(seenFile, 'utf8'))
  if (!rows.length) return { checked: [], skipped: 0, text: '判重表里还没有「我们发过的评论」记录' }

  // 状态账本：已经确认真见过的，7 天内不重复查
  const stateFile = join(stateDir, 'verify-state.json')
  let state = {}
  try { state = JSON.parse(readFileSync(stateFile, 'utf8')) } catch { /* 头一次跑 */ }
  const now = Date.now()
  const fresh = []
  let skipped = 0
  for (const r of rows.slice().reverse()) {          // 从最新的往回看
    const prev = state[String(r.rpid)]
    if (prev?.visible === true && now - (prev.at || 0) < 7 * 864e5) { skipped++; continue }
    fresh.push(r)
    if (fresh.length >= max) break
  }
  if (!fresh.length) return { checked: [], skipped, text: `都复核过了（跳过的旧记录 ${skipped} 条）` }

  const headers = headersFor(cred)
  const aidCache = new Map()
  const checked = []
  for (const r of fresh) {
    const res = await verifyOne(r, { cred, aidCache, headers })
    checked.push(res)
    state[String(r.rpid)] = { visible: res.visible, at: now, how: res.how, bv: r.bv, likes: res.likes ?? null }
    log(`复核 ${r.bv} rpid=${r.rpid} → ${res.visible === true ? '公开可见' : '没查到'}（${res.how}）`)
    await sleep(700)
  }
  try { writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8') } catch { /* 写不了就算了，复核不该因此失败 */ }

  const lines = ['', '## 评论复核（宿主自动跑的，不是那一轮自己说的）', '']
  for (const c of checked) {
    const t = c.visible === true ? `公开可见（赞 ${c.likes ?? 0}）` : '没查到'
    lines.push(`- \`${c.bv}\` rpid **${c.rpid}** —— ${t} · 依据：${c.how}${c.note ? ' · ' + c.note : ''}`)
  }
  if (skipped) lines.push(`- （另外 ${skipped} 条最近已复核过，没重复查）`)
  const text = lines.join('\n')
  return { checked, skipped, text }
}

/** 把复核结果追加到当天的报告末尾（报告可能还不存在 —— 那就别硬造一份） */
export function appendVerifyToReport(stateDir, text) {
  try {
    const f = join(stateDir, 'out', `${dayKey()}.md`)
    if (!existsSync(f)) return null
    writeFileSync(f, readFileSync(f, 'utf8').replace(/\s*$/, '') + '\n' + text + '\n', 'utf8')
    return f
  } catch { return null }
}

// ── 单独跑：node lib/verify.mjs <stateDir>（方便手工验 / 也方便我测） ──
if (process.argv[1] && /verify\.mjs$/.test(process.argv[1])) {
  const dir = process.argv[2] || join(process.env.DSH_HOME || join(process.env.USERPROFILE || '.', '.dsh'), 'bili-duty')
  const r = await verifyRecent(dir, { log: (m) => console.log('  ' + m) })
  console.log(r.text)
}
