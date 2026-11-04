// 明确承诺记忆的文本规则：识别“记住…”、判断保密、扫描“我记住了”这类完成说法。
//
// 这里只做纯文本判断，不读库、不调模型。真正的写入和回读在 store.commitMemory；
// 调用方必须先拿到 verified 回执，才能把“记住了”放给用户。

const REQUEST_VERB = /(?:帮我|给我|你|麻烦|请|要|得)?\s*(?:记住|记一下|记下|记着|别忘了|别忘记)/u
const REQUEST_LEAD = /^(?:请|麻烦|帮我|给我|你|你要|你得|一定要)?\s*(?:记住|记一下|记下|记着|别忘了|别忘记)\s*[，,：:、]?\s*(.+)$/u
const REQUEST_TAIL = /^(.+?)[，,。！!\s]*(?:你|帮我|给我)?(?:记住|记一下|记着|别忘了|别忘记)[。！!]?$/u
const REQUEST_ANY = /(?:帮我|给我|你)?\s*(?:记住|记一下|记下|记着|别忘了|别忘记)\s*[，,：:、]?\s*(.+)/u
const QUESTION = /(?:记得吗|记住了吗|记住了没|记不记得|还记得|记得不|记住没)/u
const FIRST_PERSON_RECALL = /^我(?:还)?记(?:得|着)/u
const NEGATION = /(?:没记住|没记下|记不住|记不清|忘了|别记|不用记|不是记住)/u
const PLAYFUL = /(?:记住你了|记住你们了|记住你这句话了|记住你这个|你给我记住)/u
const COMMAND_START = /^(?:请|麻烦|帮我|给我|你|你要|你得|一定要)?\s*(?:记住|记一下|记下|记着|别忘了|别忘记)/u
const QUOTE_PAIRS = [
  ['“', '”'],
  ['‘', '’'],
  ['「', '」'],
  ['『', '』'],
  ['"', '"'],
]
const SECRET = /(?:保密|别告诉|别跟别人说|别在群里说|就你(?:一个)?知道|不要外传|别外传|私下说|别让.{0,6}知道|别往外说)/u
const CORRECTION = /(?:不是|不对|说错|更正|改一下|改正|记错了|纠正)/u
const CLAIM = /(?:我(?:已经|真的|都|可)?(?:记住|记下|记牢|记着)了|(?:已经|都|可)?(?:记住|记下|记着)了|我?写进(?:长期)?记忆了|我?存进记忆了|我?记到心里了|我?不会忘(?:了|记|的)?|我?忘不了|我?记着呢)/gu
const CLAIM_BEFORE_BAD = /(?:没|不|别|未)$/u
const CLAIM_AFTER_BAD = /(?:吗|么|没|？|\?)/u
const CLAIM_TRANSCRIPT = /(?:他说|她说|你说|问我|写道|转述|他说让你|她说让你|他让|她让|他叫|她叫)/u

function isInsideQuotes(text, index) {
  const before = text.slice(0, index)
  if ((before.match(/"/gu) || []).length % 2 === 1) return true
  for (const [open, close] of QUOTE_PAIRS) {
    if (open === close) continue
    const opens = before.split(open).length - 1
    const closes = before.split(close).length - 1
    if (opens > closes) return true
  }
  return false
}

function cleanContent(content) {
  let text = String(content || '')
    .replace(/^[\s，,。！!？?：:；;、]+/u, '')
    .replace(/[\s，,。！!？?：:；;、]+$/u, '')
    .trim()
  if (text.length < 2) return ''
  text = text
    .replace(/^(?:这个|这件事|这事|下面这个|这句话)\s*[，,：:、]?\s*/u, '')
    .replace(/^(?:这件事|这个|这事)?(?:要|请)?保密\s*[，,：:、]?\s*/u, '')
    .replace(/^别告诉(?:别人|其他人|任何人)\s*[，,：:、]?\s*/u, '')
    .replace(/^别在群里说\s*[，,：:、]?\s*/u, '')
    .replace(/^不要外传\s*[，,：:、]?\s*/u, '')
    .replace(/[，,。；;\s]*(?:这件事|这个|这事)?(?:要|请)?保密.*$/u, '')
    .replace(/[，,。；;\s]*别告诉(?:别人|其他人|任何人).*$/u, '')
    .replace(/[，,。；;\s]*别在群里说.*$/u, '')
    .trim()
  if (/^了(?:[，,。！!\s]|$)/u.test(text)) return ''
  if (/^(?:这个|这件事|这事|刚才|刚刚|上面|前面|这些|那些)$/u.test(text)) return ''
  return text.slice(0, 400)
}

/**
 * 判断一条消息是不是在明确让她记住一件事。
 * 排除问句、第一人称回忆、否定、转述、引用和“记住你了”这类玩笑。
 * @param {string} raw - 单条用户消息的干净正文。
 * @returns {{content: string, secret: boolean, correction: boolean, raw: string}|null} 解析结果；不是请求时返回 null。
 */
export function parseMemoryRequest(raw) {
  const text = String(raw === undefined || raw === null ? '' : raw).trim()
  if (text.length < 2 || text.length > 4000) return null
  if (QUESTION.test(text) || FIRST_PERSON_RECALL.test(text) || NEGATION.test(text) || PLAYFUL.test(text)) return null
  // “我记住了，我对芒果过敏”是完成说法，不是请求；只有命令式开头才继续。
  if (scanMemoryClaims(text).length > 0 && !COMMAND_START.test(text)) return null

  let content = ''
  const lead = REQUEST_LEAD.exec(text)
  if (lead) content = lead[1]
  if (content === '') {
    const tail = REQUEST_TAIL.exec(text)
    if (tail) content = tail[1]
  }
  if (content === '') {
    const any = REQUEST_ANY.exec(text)
    if (any) {
      // 转述和引用不算；只认她自己说的请求。
      const before = text.slice(Math.max(0, any.index - 10), any.index)
      if (CLAIM_TRANSCRIPT.test(before) || isInsideQuotes(text, any.index)) return null
      content = any[1]
    }
  }
  if (content === '') return null
  const cleaned = cleanContent(content)
  if (cleaned === '') return null
  return {
    content: cleaned,
    secret: SECRET.test(text),
    correction: CORRECTION.test(text),
    raw: text.slice(0, 400),
  }
}

/**
 * 这条消息看起来像不像“记住…”，给 QQ 桥做低成本预筛；最终仍由 parseMemoryRequest 判定。
 * @param {string} raw - 单条消息正文。
 * @returns {boolean} true 表示值得交给鱼脑细判。
 */
export function looksLikeMemoryRequest(raw) {
  const text = String(raw === undefined || raw === null ? '' : raw).trim()
  if (text.length < 4) return false
  if (QUESTION.test(text) || NEGATION.test(text)) return false
  return REQUEST_VERB.test(text)
}

/**
 * 扫出“我记住了/记下了/写进记忆了/不会忘”这类完成说法。
 * 排除问句、否定、引用、转述和玩笑；返回的是要改写的区间。
 * @param {string} raw - 准备发出去的回复正文。
 * @returns {{start: number, end: number, phrase: string}[]} 按出现顺序排列的完成说法。
 */
export function scanMemoryClaims(raw) {
  const text = String(raw === undefined || raw === null ? '' : raw)
  const claims = []
  for (const match of text.matchAll(CLAIM)) {
    const start = Number(match.index) || 0
    const phrase = match[0]
    const end = start + phrase.length
    if (isInsideQuotes(text, start)) continue
    const before = text.slice(Math.max(0, start - 10), start)
    const after = text.slice(end, end + 4)
    if (CLAIM_BEFORE_BAD.test(before)) continue
    if (CLAIM_AFTER_BAD.test(after)) continue
    if (CLAIM_TRANSCRIPT.test(before)) continue
    if (/^我?记住你了/u.test(text.slice(start, end + 3))) continue
    claims.push({ start, end, phrase })
  }
  return claims
}

/**
 * 把没有回执的完成说法改成实情。
 * @param {string} raw - 准备发出去的回复正文。
 * @param {{replacement?: string, fullReplacement?: string}} [options] - 句中出现时和整句只有这一句时的替换词。
 * @returns {{text: string, changed: boolean, claims: {start: number, end: number, phrase: string}[]}} 改写结果。
 */
export function rewriteMemoryClaims(raw, options = {}) {
  const text = String(raw === undefined || raw === null ? '' : raw)
  const claims = scanMemoryClaims(text)
  if (claims.length === 0) return { text, changed: false, claims }
  const replacement = String(options.replacement || '我还没记牢')
  const fullReplacement = String(options.fullReplacement || '我没记住，你再说一遍好吗')
  let out = text
  for (const claim of [...claims].reverse()) {
    const before = out.slice(0, claim.start)
    const after = out.slice(claim.end)
    const whole = before.trim() === '' && /^[\s。！!，,]*$/u.test(after)
    out = before + (whole ? fullReplacement : replacement) + after
  }
  return { text: out, changed: true, claims }
}

/**
 * 根据正文判断这条承诺该不该只留在原房间。
 * @param {string} raw - 用户消息正文。
 * @returns {'global'|'secret'} secret 表示用户明确要求保密。
 */
export function visibilityFromText(raw) {
  return SECRET.test(String(raw === undefined || raw === null ? '' : raw)) ? 'secret' : 'global'
}

/**
 * 这条消息是不是在更正之前的说法。
 * @param {string} raw - 用户消息正文。
 * @returns {boolean} true 表示可能是“不是 X，是 Y”这类更正。
 */
export function isCorrectionText(raw) {
  return CORRECTION.test(String(raw === undefined || raw === null ? '' : raw))
}
