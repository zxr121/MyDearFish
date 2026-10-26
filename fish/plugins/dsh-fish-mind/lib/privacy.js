// 隐私护栏：本机身份、账号、密码和密钥不进对话，也不离开本机。
//
// 四道口子都在这里准备：
//   · redact(text, mode) —— 把值换成标签。tool 模式只清秘密，保留路径（工具还要用）；
//     local 模式再清主机名、用户名和本机路径；outbound 模式连路径和整句都删掉，
//     整条只剩私密内容就返回空，让调用方失败关闭而不是发一句拒绝话术。
//   · protectStream —— 模型输出一边流一边清，块结束时用整段再清一遍兜底。
//   · hasCredential —— 工具参数里出现真凭据时，给 Capability Broker 一个硬拒绝的理由。
//   · learn —— 用户亲口贴出来的密码/令牌，进程内记住；不落盘，重启就忘。
//
// 这不是内核级 DLP。换一种说法、编码或推理套话仍可能绕过；所以系统提示里还有一条
// 写死的隐私规则，工具层也会拒绝探测本机和读取凭据目录。这里负责“具体值不出现”。

import { homedir, hostname, networkInterfaces, userInfo } from 'node:os'
import { join } from 'node:path'
import { scrub } from './sanitize.js'

const HOLD_CHARS = 24
const HOLD_TOKENS = 6
const MAX_LEARNED = 120

const PATH_KINDS = new Set(['home-path', 'dsh-path', 'project-path'])
const IDENTITY_KINDS = new Set(['machine-name', 'username', 'domain', 'ip', 'mac'])
const SECRET_KINDS = new Set([
  'private-key',
  'api-key',
  'github-token',
  'aws-key',
  'slack-token',
  'bearer',
  'url-credential',
  'password',
  'secret',
  'id-card',
  'bank-card',
  'jwt',
  'cookie',
  'session-id',
  'env-assignment',
  'env-secret',
  'basic-auth',
  'ssh-public-key',
  'account',
  'email',
  'phone',
  'address',
  'learned',
])
// 这些命中会让一条经历整条不落库；主机名、路径之类只脱敏，不丢上下文。
const DROP_KINDS = new Set(SECRET_KINDS)

const LABELS = {
  'machine-name': '[主机名已隐去]',
  username: '[账号已隐去]',
  domain: '[域已隐去]',
  'home-path': '[本机路径已隐去]',
  'dsh-path': '[本机路径已隐去]',
  'project-path': '[本机路径已隐去]',
  ip: '[内网地址已隐去]',
  mac: '[硬件地址已隐去]',
  'env-secret': '[密钥已隐去]',
  learned: '[密钥已隐去]',
}

const COMMON_VALUES = new Set([
  'true',
  'false',
  'yes',
  'no',
  'on',
  'off',
  'null',
  'undefined',
  'none',
  'default',
  'utf-8',
  'utf8',
  'localhost',
  'administrator',
  'admin',
  'root',
  'user',
])

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function unquote(value) {
  const text = String(value == null ? '' : value).trim()
  if (text.length >= 2) {
    const first = text[0]
    const last = text[text.length - 1]
    if ((first === '"' || first === "'" || first === '`') && first === last) return text.slice(1, -1)
  }
  return text
}

function isCodeReference(value) {
  return /^(?:process\.env|os\.environ|os\.getenv|import\.meta\.env|env\.|Deno\.env|\$|%|<|\{\{)/i.test(value)
    || /^[A-Z][A-Z0-9_]*$/.test(value)
    || /^[a-z_$][\w$]*(?:\.[\w$]+)+$/i.test(value)
    || /^[\w$.]+\([^)]*\)$/.test(value)
}

function looksLikeSecretValue(value) {
  const text = unquote(value)
  if (text.length < 6) return false
  if (COMMON_VALUES.has(text.toLowerCase())) return false
  if (/已隐去|REDACTED|redacted/.test(text)) return false
  if (isCodeReference(text)) return false
  if (/^(?:\*+|x{3,}|\.{3,}|<[^>]*>|\{\{[^}]*\}\}|your[_-]|changeme|placeholder|example|redacted|已隐去)/i.test(text)) return false
  return /[A-Za-z]/.test(text) && (/[0-9]/.test(text) || /[^A-Za-z0-9]/.test(text) || text.length >= 16)
}

function looksLikeAccountValue(value) {
  const text = unquote(value)
  if (text.length < 3) return false
  if (COMMON_VALUES.has(text.toLowerCase())) return false
  if (isCodeReference(text)) return false
  if (/^\[.*已隐去.*\]$/.test(text)) return false
  if (/^(?:\*+|x{3,}|\.{3,}|<[^>]*>|\{\{[^}]*\}\})$/i.test(text)) return false
  return true
}

function pathVariants(value) {
  const set = new Set([value])
  if (/[\\/]/.test(value)) {
    set.add(value.replace(/\\/g, '/'))
    set.add(value.replace(/\//g, '\\'))
  }
  return Array.from(set).sort((a, b) => b.length - a.length)
}

/** 本机身份与环境里的敏感值；全部只进内存。 */
function collectFacts(dshHome) {
  const facts = []
  const seen = new Set()
  const add = (value, kind, label = '') => {
    const text = String(value == null ? '' : value).trim()
    if (text.length < 3 || COMMON_VALUES.has(text.toLowerCase())) return
    const key = `${kind}:${text}`
    if (seen.has(key)) return
    seen.add(key)
    facts.push({ value: text, kind, label })
  }

  add(hostname(), 'machine-name')
  add(process.env.COMPUTERNAME, 'machine-name')
  add(process.env.USERDOMAIN, 'domain')
  add(process.env.USERNAME, 'username')
  add(process.env.USER, 'username')
  try {
    add(userInfo().username, 'username')
  } catch {
    // 拿不到系统账号不耽误别的护栏。
  }
  add(homedir(), 'home-path')
  add(process.env.USERPROFILE, 'home-path')
  add(dshHome, 'dsh-path')
  add(process.env.DSH_HOME, 'dsh-path')
  add(process.cwd(), 'project-path')

  const sensitiveEnv = /(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL|AUTH|COOKIE|SESSION|PRIVATE|ACCOUNT)/i
  const identityEnv = new Set([
    'USERNAME',
    'USER',
    'COMPUTERNAME',
    'USERDOMAIN',
    'USERPROFILE',
    'HOME',
    'DSH_HOME',
    'PATH',
  ])
  for (const [key, value] of Object.entries(process.env)) {
    if (identityEnv.has(key) || !sensitiveEnv.test(key)) continue
    const text = String(value == null ? '' : value).trim()
    if (text.length < 6 || COMMON_VALUES.has(text.toLowerCase())) continue
    add(text, 'env-secret', key)
  }

  try {
    for (const entries of Object.values(networkInterfaces())) {
      for (const info of entries || []) {
        if (!info || info.internal) continue
        if (info.address) add(info.address, 'ip')
        if (info.mac && info.mac !== '00:00:00:00:00:00') add(info.mac, 'mac')
      }
    }
  } catch {
    // 网卡枚举失败就算了，通用模式还在。
  }

  return facts.sort((a, b) => b.value.length - a.value.length)
}

const FULL_PRIVATE_KEY = /-----BEGIN[^\n-]{0,40}PRIVATE KEY-----[\s\S]*?-----END[^\n-]{0,40}PRIVATE KEY-----/g

const GENERIC = [
  ['ssh-public-key', /\b(?:ssh-(?:rsa|ed25519|dss)|ecdsa-sha2-nistp\d+)\s+AAAA[A-Za-z0-9+/=]{20,}/g, '[公钥已隐去]'],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[令牌已隐去]'],
  ['basic-auth', /\bBasic\s+[A-Za-z0-9+/=]{16,}/gi, 'Basic [已隐去]'],
  ['cookie', /\b(?:Cookie|Set-Cookie)\s*:\s*[^\r\n]+/gi, 'Cookie: [已隐去]'],
  ['session-id', /\b(?:sessionid|session_id|PHPSESSID|JSESSIONID|connect\.sid)\s*[=:]\s*[^\s;,"']{6,}/gi, '[会话标识已隐去]'],
  [
    'env-assignment',
    /(?<![\w])(["']?)([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL|AUTH|COOKIE|SESSION)[A-Z0-9_]*)\1\s*[:=]\s*("[^"\n]*"|'[^'\n]*'|[^\s,;}\]\n]+)/g,
    null,
  ],
  [
    'account',
    /(?:账号|帐号|账户|用户名|登录名|登录账号|username|login|account)\s*(?:是|为|[:：=])\s*([^\s，。；;、]{3,64})/gi,
    null,
  ],
  ['email', /(?<![\w.%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?![\w.-])/g, '[邮箱已隐去]'],
  ['phone', /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g, '[手机号已隐去]'],
  [
    'ip',
    /(?<![\d.])(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3})(?![\d.])/g,
    '[内网地址已隐去]',
  ],
  ['ip', /\b(?:[0-9a-f]{1,4}:){4,7}[0-9a-f]{1,4}\b/gi, '[本机地址已隐去]'],
  ['mac', /\b(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}\b/gi, '[硬件地址已隐去]'],
  ['machine-name', /\bDESKTOP-[A-Z0-9]{5,12}\b/gi, '[主机名已隐去]'],
  ['home-path', /(?<![\w])(?:[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'<>|]+)/g, '[本机路径已隐去]'],
  ['home-path', /(?<![\w:])\/(?:home|Users)\/[^/\s"'<>]+/g, '[本机路径已隐去]'],
  ['home-path', /\\\\[^\\\s"'<>|]+\\[^\\\s"'<>|]+/g, '[网络路径已隐去]'],
  ['machine-name', /\bS-1-5-(?:\d+-){1,14}\d+\b/g, '[系统标识已隐去]'],
]

const OUTBOUND_WORDS = /密码|口令|密钥|令牌|凭证|账号|帐号|账户|用户名|登录|验证码|主机|电脑|计算机|本机|内网|局域网|IP\s*地址|端口|部署|路径|目录|工作区|邮箱|手机号|电话|身份证|银行卡|住址|地址|服务器|数据库|SSH|VPN|Cookie|Token|API\s*Key/i

function splitSentences(text) {
  const parts = String(text).split(/([。！？!?；;\n]+)/)
  const out = []
  for (let index = 0; index < parts.length; index += 2) {
    out.push([parts[index] || '', parts[index + 1] || ''])
  }
  return out
}

function hasConcreteValue(sentence) {
  return /[0-9]|[@\\/]|[A-Za-z]{3,}|[:：=]\s*\S/.test(sentence)
}

function hasCopula(sentence) {
  return /(?:是|叫|为|在|用)\s*[^\s，。！？!?；;]{1,}/.test(sentence)
}

/**
 * 创建隐私护栏。
 * @param {object} options - `{ dshHome, diag }`。
 * @returns {object} 脱敏与识别接口。
 */
export function createPrivacyGuard({ dshHome = join(homedir(), '.dsh'), diag = () => {} } = {}) {
  const facts = collectFacts(dshHome)
  const learned = new Map()
  const extraPaths = []

  function addFact(value, kind) {
    const text = String(value == null ? '' : value).trim()
    if (text.length < 3) return false
    if (facts.some((fact) => fact.value === text)) return false
    facts.push({ value: text, kind, label: '' })
    facts.sort((a, b) => b.value.length - a.value.length)
    return true
  }

  function learn(text) {
    const source = typeof text === 'string' ? text : ''
    if (source === '') return { added: 0, kinds: [] }
    const kinds = []
    const add = (value, kind) => {
      const clean = unquote(String(value == null ? '' : value)).replace(/[,，。；;、]+$/, '')
      if (clean.length < 4 || clean.length > 256) return
      if (COMMON_VALUES.has(clean.toLowerCase())) return
      if (!looksLikeSecretValue(clean) && !(kind === 'password' && clean.length >= 6)) return
      if (facts.some((fact) => fact.value === clean) || learned.has(clean)) return
      learned.set(clean, kind)
      kinds.push(kind)
      if (learned.size > MAX_LEARNED) learned.delete(learned.keys().next().value)
    }

    const patterns = [
      [/(?:密码|口令|pass(?:word|wd)?|pwd)\s*(?:是|为|[:：=])\s*["'`]?([^\s，。；;、"'`]{4,128})/gi, 'password'],
      [/(?:api[_-]?key|secret|token|access[_-]?key)\s*[:：=]\s*["'`]?([A-Za-z0-9._~+/-]{8,})/gi, 'token'],
      [/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/g, 'api-key'],
      [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, 'github-token'],
      [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, 'aws-key'],
      [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, 'slack-token'],
      [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, 'jwt'],
    ]
    for (const [pattern, kind] of patterns) {
      pattern.lastIndex = 0
      let match
      while ((match = pattern.exec(source)) !== null) add(match[1] || match[0], kind)
    }
    if (kinds.length > 0) diag(`privacy: 记住 ${kinds.length} 个用户贴出的秘密（只在内存里，不落盘）`)
    return { added: kinds.length, kinds }
  }

  function exactRegex(fact) {
    const variants = PATH_KINDS.has(fact.kind) ? pathVariants(fact.value) : [fact.value]
    const flags = fact.kind === 'env-secret' || fact.kind === 'learned' ? 'g' : 'gi'
    const source = variants.map(escapeRegExp).join('|')
    if (IDENTITY_KINDS.has(fact.kind) && fact.kind !== 'ip' && fact.kind !== 'mac') {
      return new RegExp(`(?<![\\w.-])(?:${source})(?![\\w.-])`, flags)
    }
    if (fact.kind === 'ip') return new RegExp(`(?<![\\d.])${source}(?![\\d.])`, flags)
    return new RegExp(source, flags)
  }

  function maskExact(text, mode, bump) {
    let out = text
    for (const fact of facts) {
      // tool 模式只清真秘密，保留路径、账号名和主机名，免得把工具结果弄坏。
      if (mode === 'tool' && fact.kind !== 'env-secret') continue
      const label = LABELS[fact.kind]
      if (!label) continue
      out = out.replace(exactRegex(fact), () => {
        bump(fact.kind)
        return label
      })
    }
    for (const [value, kind] of learned) {
      out = out.replace(new RegExp(escapeRegExp(value), 'g'), () => {
        bump(kind || 'learned')
        return LABELS.learned
      })
    }
    return out
  }

  function redact(text, mode = 'local') {
    const source = typeof text === 'string' ? text : ''
    if (source === '') return { text: '', hits: 0, counts: {}, kinds: [], reasons: [], changed: false }
    const counts = new Map()
    const bump = (kind, times = 1) => counts.set(kind, (counts.get(kind) || 0) + times)
    let out = source

    // 私钥整段先换掉，免得后面的按句拆分把 key 拆成半截。
    FULL_PRIVATE_KEY.lastIndex = 0
    out = out.replace(FULL_PRIVATE_KEY, () => {
      bump('private-key')
      return '[私钥已隐去]'
    })

    if (mode === 'outbound') {
      let dropped = false
      out = splitSentences(out)
        .map(([body, delimiter]) => {
          if (!OUTBOUND_WORDS.test(body)) return body + delimiter
          if (/不方便说|不想说|不能说/.test(body) && !hasConcreteValue(body)) return body + delimiter
          if (!hasConcreteValue(body) && !hasCopula(body)) return body + delimiter
          bump('outbound-private')
          dropped = true
          // 换行分隔必须留住，否则删掉中间一句会把前后两句粘成一句。
          return delimiter.includes('\n') ? '\n' : ''
        })
        .join('')
      if (dropped) out = out.replace(/\n{2,}/g, '\n').trim()
    }

    const cleaned = scrub(out)
    out = cleaned.text
    for (const [kind, times] of Object.entries(cleaned.hits)) bump(kind, times)

    // 工具结果要留给模型干活：tool 模式只清凭据，不把邮箱、路径、账号一起换掉。
    const toolKinds = new Set(['ssh-public-key', 'jwt', 'basic-auth', 'cookie', 'session-id'])
    for (const [kind, pattern, label] of GENERIC) {
      if (mode === 'tool' && !toolKinds.has(kind)) continue
      pattern.lastIndex = 0
      out = out.replace(pattern, (...args) => {
        if (kind === 'env-assignment') {
          const quote = args[1] || ''
          const key = args[2] || ''
          const raw = args[3] || ''
          if (!looksLikeSecretValue(raw)) return args[0]
          bump(kind)
          if (quote) return `${quote}${key}${quote}: ${quote}[已隐去]${quote}`
          return `${key}=[已隐去]`
        }
        if (kind === 'account') {
          const value = args[1] || ''
          if (!looksLikeAccountValue(value)) return args[0]
          bump(kind)
          return '[账号已隐去]'
        }
        bump(kind)
        return label
      })
    }

    if (mode === 'outbound') {
      // 离开本机的内容里，任何盘符路径和系统目录都按部署细节处理。
      out = out.replace(/(?<![\w:])(?:[A-Za-z]:[\\/][^\s"'<>|，。；;]*)/g, () => {
        bump('project-path')
        return '[本机路径已隐去]'
      })
      out = out.replace(/(?<![\w:])\/(?:opt|srv|var|etc|root|data|mnt)\/[^\s"'<>|，。；;]*/g, () => {
        bump('project-path')
        return '[本机路径已隐去]'
      })
    }

    out = maskExact(out, mode, bump)

    if (mode === 'outbound') {
      out = out.replace(/[ \t]{2,}/g, ' ').trim()
    }

    const kinds = Array.from(counts.keys())
    let hits = 0
    for (const times of counts.values()) hits += times
    return { text: out, hits, counts: Object.fromEntries(counts), kinds, reasons: kinds, changed: out !== source }
  }

  function assess(text) {
    const result = redact(text, 'local')
    const sensitiveKinds = result.kinds.filter((kind) => DROP_KINDS.has(kind))
    return { ...result, sensitive: sensitiveKinds.length > 0, sensitiveKinds }
  }

  /** 工具参数里有没有真凭据；只认高置信度写法，不因为出现“password”这个词就拒绝写代码。 */
  function hasCredential(text) {
    const source = typeof text === 'string' ? text : ''
    if (source === '') return false
    const test = (pattern) => {
      pattern.lastIndex = 0
      return pattern.test(source)
    }

    FULL_PRIVATE_KEY.lastIndex = 0
    if (FULL_PRIVATE_KEY.test(source)) return true
    if (test(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/)) return true
    if (test(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/)) return true
    if (test(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/)) return true
    if (test(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/)) return true
    if (test(/\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/)) return true
    if (test(/\bBasic\s+[A-Za-z0-9+/=]{16,}/i)) return true
    if (test(/\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i)) return true
    if (test(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/)) return true
    // 裸的 17/18 位数字也可能是雪花 id，只有写明是身份证时才当凭据。
    if (test(/(?:身份证|id\s*card|identity\s*card)\D{0,8}[1-9]\d{16}[\dXx]/i)) return true
    if (test(/(?:银行卡|卡号|account\s*number|card\s*number)\s*[:：]?\s*\d(?:[ -]?\d){11,18}/i)) return true
    if (test(/(?:sessionid|session_id|PHPSESSID|JSESSIONID|connect\.sid)\s*[=:]\s*[^\s;,"']{6,}/i)) return true

    const assignments = /(?<![\w])(["']?)([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL|AUTH|COOKIE|SESSION)[A-Z0-9_]*)\1\s*[:=]\s*("[^"\n]*"|'[^'\n]*'|[^\s,;}\]\n]+)/g
    let match
    while ((match = assignments.exec(source)) !== null) {
      if (looksLikeSecretValue(match[3])) return true
    }

    for (const pattern of [
      /(?:api[_-]?key|secret|token|access[_-]?key)\s*[:：=]\s*["'`]?([A-Za-z0-9._~+/-]{8,})/gi,
      /(?:密码|口令|pass(?:word|wd)?|pwd)\s*(?:是|为|[:：=])\s*["'`]?([^\s，。；;、"'`]{4,128})/gi,
    ]) {
      pattern.lastIndex = 0
      while ((match = pattern.exec(source)) !== null) {
        if (looksLikeSecretValue(match[1])) return true
      }
    }

    for (const fact of facts) {
      if (fact.kind === 'env-secret' && source.includes(fact.value)) return true
    }
    for (const value of learned.keys()) {
      if (source.includes(value)) return true
    }
    return false
  }

  /** 从缓冲末尾往前找一个不会被拆开的切点。 */
  function stableCut(buffer) {
    const boundary = /[\s，。！？!?；;：:、]/g
    const points = []
    let match
    while ((match = boundary.exec(buffer)) !== null) points.push(match.index + match[0].length)
    let cut = 0
    if (points.length > HOLD_TOKENS) cut = points[points.length - HOLD_TOKENS] - 1
    else cut = Math.max(0, buffer.length - HOLD_CHARS)

    // 不把英数、路径、邮箱之类的一个整词切开。
    while (cut > 0 && cut < buffer.length) {
      const before = buffer[cut - 1]
      const after = buffer[cut]
      if (!/[A-Za-z0-9_@.\\/-]/.test(before) || !/[A-Za-z0-9_@.\\/-]/.test(after)) break
      cut -= 1
    }
    // 末尾的数字串也整个留住：手机号、卡号、验证码通常没有空白分隔。
    let tail = buffer.length
    while (tail > 0 && /[\d-]/.test(buffer[tail - 1])) tail -= 1
    if (tail < buffer.length) cut = Math.min(cut, tail)
    return Math.max(0, Math.min(cut, buffer.length))
  }

  function riskHold(buffer) {
    let hold = buffer.length
    // 已经出现的秘密前缀：缓冲区末尾正好是某个真值的开头，就压住不流出去。
    for (const fact of facts) {
      const value = fact.value
      const max = Math.min(value.length, buffer.length)
      for (let size = max; size >= 3; size -= 1) {
        if (buffer.endsWith(value.slice(0, size))) {
          hold = Math.min(hold, buffer.length - size)
          break
        }
      }
    }
    // 敏感词之后如果还没有句读，整段先压住，等值结束再一起清。
    const marker = /密码|口令|密钥|令牌|凭证|账号|帐号|账户|用户名|登录名|主机名|电脑名|计算机名|IP\s*地址|MAC|地址|住址|邮箱|手机号|电话|身份证|银行卡|Cookie|Bearer|Basic|BEGIN[^\n]*PRIVATE KEY|sk-|ghp_|AKIA|xox[baprs]-|S-1-5-|C:[\\/]Users|\/home\/|\/Users\//gi
    let last = -1
    let match
    while ((match = marker.exec(buffer)) !== null) last = match.index
    if (last >= 0) {
      const rest = buffer.slice(last)
      if (!/[。！？!?；;\n]/.test(rest)) hold = Math.min(hold, last)
    }
    return Math.max(0, hold)
  }

  function redactBlock(block, mode) {
    if (!block || typeof block !== 'object') return block
    if (block.type === 'text' || block.type === 'reasoning') {
      if (typeof block.text !== 'string') return block
      const cleaned = redact(block.text, mode)
      return cleaned.text === block.text ? block : { ...block, text: cleaned.text }
    }
    if (block.type === 'tool-call' && typeof block.arguments === 'string') {
      const cleaned = redact(block.arguments, 'tool')
      return cleaned.text === block.arguments ? block : { ...block, arguments: cleaned.text }
    }
    return block
  }

  /**
   * 包住模型输出流：文字按块清，工具参数攒齐再清，块结束时整段兜底。
   * @param {AsyncIterable<object>} source - `llm/stream` 下游。
   * @param {object} options - `{ mode, onHit }`。
   * @returns {AsyncIterable<object>} 脱敏后的流。
   */
  function protectStream(source, { mode = 'local', onHit = () => {} } = {}) {
    return (async function* () {
      const blocks = new Map()
      const report = (result) => {
        for (const kind of result.kinds) {
          try {
            onHit(kind, result.counts[kind] || 1)
          } catch {
            // 记账回调自己出错不能影响回话。
          }
        }
      }
      const stateOf = (index, kind) => {
        let state = blocks.get(index)
        if (state === undefined) {
          state = { kind, full: '', buffer: '', emitted: '', args: '', id: '', name: '' }
          blocks.set(index, state)
        }
        return state
      }
      const emitDelta = (chunk, state, text) => ({ ...chunk, text })

      for await (const chunk of source) {
        if (!chunk || typeof chunk !== 'object') {
          yield chunk
          continue
        }

        if (chunk.type === 'block-start') {
          blocks.set(chunk.index, { kind: chunk.blockType, full: '', buffer: '', emitted: '', args: '', id: '', name: '' })
          yield chunk
          continue
        }

        if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
          if (typeof chunk.text !== 'string' || chunk.text === '') {
            yield chunk
            continue
          }
          const state = stateOf(chunk.index, chunk.type === 'text-delta' ? 'text' : 'reasoning')
          state.full += chunk.text
          state.buffer += chunk.text
          let cut = Math.min(stableCut(state.buffer), riskHold(state.buffer))
          if (cut > 0) {
            const prefix = state.buffer.slice(0, cut)
            state.buffer = state.buffer.slice(cut)
            const cleaned = redact(prefix, mode)
            report(cleaned)
            if (cleaned.text !== '') {
              state.emitted += cleaned.text
              yield emitDelta(chunk, state, cleaned.text)
            }
          }
          continue
        }

        if (chunk.type === 'tool-call-delta') {
          const state = stateOf(chunk.index, 'tool-call')
          state.args += typeof chunk.argumentsDelta === 'string' ? chunk.argumentsDelta : ''
          state.id = String(chunk.id || '')
          if (chunk.name) state.name = String(chunk.name)
          continue
        }

        if (chunk.type === 'block-end') {
          const state = blocks.get(chunk.index)
          let block = chunk.block
          if (block && (block.type === 'text' || block.type === 'reasoning')) {
            // 正常情况 state.full 最全；只有块结束前没经过 delta 时才退回块自己的正文。
            const full = state && state.full !== ''
              ? state.full
              : (typeof block.text === 'string' ? block.text : '')
            const final = redact(full, mode)
            report(final)
            let tail = ''
            if (state) {
              if (final.text.startsWith(state.emitted)) tail = final.text.slice(state.emitted.length)
              else {
                // 极少数跨切点的命中：整段已经流出去的碎片收不回来，把剩余部分补上并记一笔。
                diag('privacy: 流式输出有一次跨切点命中，已按整段结果兜底')
                let common = 0
                while (common < state.emitted.length && common < final.text.length && state.emitted[common] === final.text[common]) common += 1
                tail = final.text.slice(common)
              }
              state.emitted = final.text
              state.buffer = ''
            }
            if (tail !== '') {
              yield {
                type: block.type === 'reasoning' ? 'reasoning-delta' : 'text-delta',
                index: chunk.index,
                text: tail,
              }
            }
            block = { ...block, text: final.text }
          } else if (block && block.type === 'tool-call') {
            const original = typeof block.arguments === 'string'
              ? block.arguments
              : (state && state.args) || ''
            const cleaned = redact(original, 'tool')
            report(cleaned)
            if (state && state.args !== '') {
              yield {
                type: 'tool-call-delta',
                index: chunk.index,
                id: (state.id || block.id),
                ...(state.name || block.name ? { name: state.name || block.name } : {}),
                argumentsDelta: cleaned.text,
              }
            }
            block = { ...block, arguments: cleaned.text }
          }
          blocks.delete(chunk.index)
          yield { ...chunk, block }
          continue
        }

        if (chunk.type === 'finish') {
          // 没等到 block-end 的残块也要把尾巴吐干净。
          for (const [index, state] of blocks) {
            if (state.kind === 'tool-call' || state.full === '') continue
            const final = redact(state.full, mode)
            report(final)
            let tail
            if (final.text.startsWith(state.emitted)) {
              tail = final.text.slice(state.emitted.length)
            } else {
              diag('privacy: 流式输出收尾时有一次跨切点命中，已按整段结果兜底')
              let common = 0
              while (common < state.emitted.length && common < final.text.length && state.emitted[common] === final.text[common]) common += 1
              tail = final.text.slice(common)
            }
            if (tail !== '') {
              yield {
                type: state.kind === 'reasoning' ? 'reasoning-delta' : 'text-delta',
                index,
                text: tail,
              }
            }
            state.emitted = final.text
            state.buffer = ''
          }
          blocks.clear()
          if (chunk.reason && chunk.reason.kind === 'error' && chunk.reason.failure && typeof chunk.reason.failure.message === 'string') {
            const cleaned = redact(chunk.reason.failure.message, 'tool')
            report(cleaned)
            yield { ...chunk, reason: { ...chunk.reason, failure: { ...chunk.reason.failure, message: cleaned.text } } }
            continue
          }
          yield chunk
          continue
        }

        yield chunk
      }
    })()
  }

  function describe() {
    return {
      enabled: true,
      exactFacts: facts.length,
      learnedSecrets: learned.size,
      modes: ['tool', 'local', 'outbound'],
      hardGuards: ['private-paths', 'machine-probes', 'credential-arguments', 'stream-redaction', 'tool-result-redaction'],
      extraPaths: extraPaths.length,
    }
  }

  function addPrivatePath(value) {
    const text = String(value == null ? '' : value).trim()
    if (text.length < 4 || extraPaths.indexOf(text) >= 0) return false
    extraPaths.push(text)
    addFact(text, 'project-path')
    return true
  }

  return {
    redact,
    assess,
    hasCredential,
    learn,
    protectStream,
    redactBlock,
    describe,
    addPrivatePath,
    exactCount: () => facts.length,
    learnedCount: () => learned.size,
  }
}
