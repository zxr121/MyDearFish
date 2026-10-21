// 敏感内容清洗：拿不准就整条丢，不把秘密写进经历库。
//
// 这里只做「拦下来并计数」，不做「把秘密替换成星号后继续记」——
// 被吞掉的那一句通常前后都夹着更多隐私，留下半句反而是新的泄露面。
// 调用方看到 hits 非空时应当把 text 丢掉，只留元数据。

const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
const ID_CODES = '10X98765432'

/** 中国居民身份证号（18 位）校验位。 */
function validChineseId(value) {
  if (!/^[1-9]\d{16}[\dXx]$/.test(value)) return false
  let sum = 0
  for (let index = 0; index < 17; index += 1) sum += Number(value[index]) * ID_WEIGHTS[index]
  return ID_CODES[sum % 11] === value[17].toUpperCase()
}

// 代码里写 `password = process.env.PASSWORD` 不是泄露；别把这种引用当成密码抹掉。
const NOT_CODE_VALUE = '(?!(?:process\\.env|os\\.environ|os\\.getenv|import\\.meta\\.env|Deno\\.env|env:|\\$|%|<|\\{\\{|[A-Za-z_$][\\w$]*(?:\\.[\\w$]+|\\()))'

const PATTERNS = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
  ['api-key', /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/g],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g],
  ['aws-key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g],
  ['bearer', /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/g],
  ['url-credential', /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/gi],
  ['password', new RegExp(`(?:密码|口令|password|passwd|pwd)\\s*(?:[:：=]|是|为|is)\\s*${NOT_CODE_VALUE}\\S{3,}`, 'gi')],
  ['secret', new RegExp(`(?:api[_-]?key|secret|token)\\s*[:：=]\\s*${NOT_CODE_VALUE}[A-Za-z0-9._~+/-]{8,}`, 'gi')],
  ['id-card', /(?<!\d)[1-9]\d{16}[\dXx](?!\d)/g],
  ['bank-card', /(?:银行卡|卡号|account\s*number|card\s*number)\s*[:：]?\s*\d(?:[ -]?\d){11,18}/gi],
  ['address', /(?:地址|住址|住在|家住|address)\s*[:：]?\s*[^\s，。,.!?！？]{6,80}/gi],
]

/**
 * 扫描文本里的敏感内容。
 * @param {string} text - 原始文本。
 * @returns {{ text: string, hits: Record<string, number> }} 兜底用的替换文本与命中计数。
 */
export function scrub(text) {
  const source = typeof text === 'string' ? text : ''
  const hits = {}
  let redacted = source

  for (const [kind, pattern] of PATTERNS) {
    pattern.lastIndex = 0
    if (kind === 'id-card') {
      redacted = redacted.replace(pattern, (match) => {
        if (!validChineseId(match)) return match
        hits[kind] = (hits[kind] || 0) + 1
        return `[已隐去:${kind}]`
      })
      continue
    }
    redacted = redacted.replace(pattern, () => {
      hits[kind] = (hits[kind] || 0) + 1
      return `[已隐去:${kind}]`
    })
  }

  return { text: redacted, hits }
}

/** 从消息内容块里取正文；图片、推理块一律不要。 */
export function textOfMessage(message) {
  if (!message || !Array.isArray(message.content)) return ''
  return message.content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim()
}

/** 给审计日志用：清掉秘密后截断，避免把整段对话抄进审计。 */
export function summarize(value, limit = 200) {
  let text
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    text = String(value)
  }
  const cleaned = scrub(text || '').text.replace(/\s+/g, ' ').trim()
  return cleaned.length <= limit ? cleaned : `${cleaned.slice(0, limit - 1)}…`
}
