// 短期记忆：最近这段对话的取景，和它攒够/放凉之后转长期的计划。
//
// 这一层没有第二份存储：原文早就写进经历流了，这里只做三件事——
// 把最近若干条拼成一段提示、判断什么时候该提炼、把模型给的事实句子收干净。
// 纯函数，不碰 fs 和 sqlite，方便单测。

const ROLE_LABEL = { user: '主人', assistant: '我' }

/** 一条短期原文最多带多少字：这是“刚聊过”，不是逐字稿。 */
const ROW_CHARS = 160

function shortWhen(at) {
  const date = new Date(Number(at))
  if (Number.isNaN(date.getTime())) return '时间不详'
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 拼出【刚才在聊的】那一段。
 * 空窗口返回空串——不留一段“什么都没有”的话占预算。
 * @param {{ at: number, role: string, text: string }[]} rows - 正序的短期窗口。
 * @param {{ chars?: number }} [options] - 整段字数上限，超出时从最旧的开始丢。
 * @returns {string}
 */
export function shorttermText(rows, options = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return ''
  const header = '【刚才在聊的·短期记忆】\n下面是最近这些对话的原话，可能来自别的会话窗口：它们就是你刚从眼前的事，直接当成上下文用，不必向主人复述“我记得日志里写着”。'
  const max = Math.max(60, Number(options.chars) || 1200) - header.length - 1
  const lines = []
  let used = 0
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]
    const text = String((row && row.text) ?? '').replace(/\s+/g, ' ').trim()
    if (text === '') continue
    const label = ROLE_LABEL[row && row.role] || '旁白'
    const clipped = text.length > ROW_CHARS ? `${text.slice(0, ROW_CHARS)}…` : text
    const line = `${shortWhen(row && row.at)} ${label}：${clipped}`
    if (used + line.length > max) break
    lines.unshift(line)
    used += line.length
  }
  if (lines.length === 0) return ''
  return `${header}\n${lines.join('\n')}`
}

/**
 * 决定现在要不要把短期窗口转成长期事实。
 * 两条路：放凉了（静默超过 idleMs）或者攒多了（超过 maxRows）。
 * @param {{ at: number }[]} rows - 短期窗口，正序。
 * @param {{ lastConsolidatedAt?: number, now?: number, idleMs?: number, maxRows?: number, minRows?: number }} [options]
 * @returns {{ ready: boolean, reason: string, pending: { at: number }[] }}
 */
export function planConsolidation(rows, options = {}) {
  const last = Number.isFinite(options.lastConsolidatedAt) ? Number(options.lastConsolidatedAt) : 0
  const now = Number.isFinite(options.now) ? Number(options.now) : Date.now()
  const idleMs = Number.isFinite(options.idleMs) ? Number(options.idleMs) : 20 * 60 * 1000
  const maxRows = Math.max(2, Number(options.maxRows) || 40)
  const minRows = Math.max(1, Number(options.minRows) || 2)
  const list = Array.isArray(rows) ? rows : []
  const pending = list.filter((row) => Number(row && row.at) > last)
  if (pending.length < minRows) return { ready: false, reason: 'not-enough', pending }
  const newest = pending.reduce((acc, row) => Math.max(acc, Number(row.at) || 0), 0)
  if (pending.length >= maxRows) return { ready: true, reason: 'overflow', pending }
  if (now - newest >= idleMs) return { ready: true, reason: 'idle', pending }
  return { ready: false, reason: 'fresh', pending }
}

/**
 * 提炼用的提示词。只准她记“关于人和关系的事实”，并且明确把秘密和闲聊挡在外面。
 * @param {{ at: number, role: string, text: string }[]} rows - 待提炼窗口。
 * @param {{ knownFacts?: { subject: string, predicate: string, object: string }[], maxFacts?: number }} [options]
 * @returns {{ system: string, user: string }}
 */
export function extractionPrompt(rows, options = {}) {
  const max = Math.min(Math.max(1, Number(options.maxFacts) || 8), 20)
  const known = Array.isArray(options.knownFacts) ? options.knownFacts : []
  const transcript = rows.map((row) => {
    const text = String((row && row.text) ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
    return `${shortWhen(row && row.at)} ${ROLE_LABEL[row && row.role] || '旁白'}：${text}`
  }).join('\n')
  const knownText = known.length === 0
    ? '（还没有记住过任何事实）'
    : known.slice(0, 40).map((fact) => `- ${fact.subject} · ${fact.predicate} · ${fact.object}`).join('\n')
  return {
    system: [
      '你在帮一个 AI 伙伴把刚才的对话整理成能长期记住的事实。',
      '只整理确实从对话里读出来的东西：主人的称呼、身份、喜好、约定、她自己的情况。',
      '不整理：闲聊的玩笑、一次性的任务细节、你的猜测、你没听说过的事。',
      '密码、密钥、令牌、余额、住址这类私密内容一律不写，宁可少写。',
      '只输出 JSON 数组，不要解释、不要代码块。每项形如',
      '{"subject":"主人","predicate":"昵称","object":"EMT","confidence":0.9}',
      `最多 ${max} 条；没有值得记的就输出 []。`,
    ].join('\n'),
    user: `已经记住的（同样的事不要再写一遍）：\n${knownText}\n\n刚才的对话：\n${transcript}`,
  }
}

/**
 * 读模型给的 JSON。容错：去掉代码围栏、只取第一个数组、逐条校验。
 * @param {string} text - 模型输出。
 * @param {{ max?: number }} [options]
 * @returns {{ subject: string, predicate: string, object: string, confidence: number }[]}
 */
export function parseFacts(text, options = {}) {
  const raw = String(text ?? '')
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  let value
  try {
    value = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(value)) return []
  const max = Math.min(Math.max(1, Number(options.max) || 8), 20)
  const clean = (input, limit) => String(input ?? '').replace(/\s+/g, ' ').trim().slice(0, limit)
  const out = []
  for (const item of value) {
    if (out.length >= max) break
    if (!item || typeof item !== 'object') continue
    const subject = clean(item.subject, 60)
    const predicate = clean(item.predicate, 60)
    const object = clean(item.object, 240)
    if (subject === '' || predicate === '' || object === '') continue
    const confidence = Number(item.confidence)
    out.push({
      subject,
      predicate,
      object,
      confidence: Number.isFinite(confidence) ? Math.min(0.95, Math.max(0.2, confidence)) : 0.7,
    })
  }
  return out
}

/** 把一条事实写成一句她能自然复述的中文，用作回写经历流的正文。 */
export function factSentence(fact) {
  const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()
  return `${clean(fact.subject)}的${clean(fact.predicate)}是${clean(fact.object)}`
}
