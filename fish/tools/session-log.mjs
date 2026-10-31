// 读 DSH 的会话日志：`.jsonl.zstd` 每条记录是一个独立的 zstd 帧，
// 一次性解压只能拿到第一帧；这里按 DSH 自己的帧结构逐帧解开。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const ZSTD_MAGIC = 0xfd2fb528

/**
 * 扫出每个完整 zstd 帧的字节范围；末尾半帧只标记位置，不当作完整帧。
 * @param {Buffer} buf - 整个日志文件的字节。
 * @returns {{frames: Array<{start: number, end: number}>, tornStart?: number}} 帧范围和可能的尾部半帧起点。
 */
export function 找帧(buf) {
  const frames = []
  let offset = 0
  while (offset < buf.length) {
    const start = offset
    if (buf.length - offset < 4) return { frames, tornStart: start }
    if (buf.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`会话日志在第 ${offset} 字节不是 zstd 帧头`)
    }
    offset += 4
    if (offset === buf.length) return { frames, tornStart: start }
    const descriptor = buf.readUInt8(offset)
    offset += 1
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buf.length - offset < remainingHeaderBytes) return { frames, tornStart: start }
    offset += remainingHeaderBytes
    for (;;) {
      if (buf.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buf.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buf.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buf.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames }
}

/**
 * 读一份会话日志，返回按顺序解析出的事件。
 * @param {string} file - `.jsonl.zstd` 或普通 `.jsonl` 路径。
 * @returns {{events: object[], torn: boolean, badLines: number}} 事件、是否丢弃了尾部半帧、坏行数。
 */
export function 读日志(file) {
  const buf = readFileSync(file)
  const isZstd = file.endsWith('.zstd')
  const text = isZstd
    ? (() => {
        const { frames, tornStart } = 找帧(buf)
        const parts = frames.map(({ start, end }) => zstdDecompressSync(buf.subarray(start, end)).toString('utf8'))
        return { text: parts.join(''), torn: tornStart !== undefined }
      })()
    : { text: buf.toString('utf8'), torn: false }
  const events = []
  let badLines = 0
  for (const line of text.text.split('\n')) {
    if (line.trim() === '') continue
    try {
      events.push(JSON.parse(line))
    } catch {
      badLines += 1
    }
  }
  return { events, torn: text.torn, badLines }
}

/**
 * 列出数据目录里的所有会话日志。
 * @param {string} home - DSH_HOME（含 sessions 目录）。
 * @returns {Array<{file: string, size: number, mtimeMs: number}>} 按修改时间倒序的日志。
 */
export function 列会话(home) {
  const root = join(home, 'sessions')
  const found = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.jsonl(?:\.zstd)?$/u.test(entry.name)) continue
      try {
        const stat = statSync(full)
        found.push({ file: full, size: stat.size, mtimeMs: stat.mtimeMs })
      } catch {}
    }
  }
  walk(root)
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

/**
 * 按会话 id 判断这间屋子的种类。
 * @param {string} id - 会话 id。
 * @returns {'qq-group'|'qq-friend'|'qq-private'|'desktop'} 屋子种类。
 */
export function 会话种类(id) {
  const text = String(id || '')
  if (/^session-qq-social-group-/u.test(text)) return 'qq-group'
  if (/^session-qq-social-friend-/u.test(text)) return 'qq-friend'
  if (/^session-qq-private-/u.test(text)) return 'qq-private'
  return 'desktop'
}

/**
 * 把消息里的文本块拼起来（忽略 reasoning、图片等非正文块）。
 * @param {{content?: Array<{type?: string, text?: string}>}} message - 会话事件里的消息。
 * @returns {string} 正文；没有文本块时为空串。
 */
export function 正文(message) {
  if (!message || !Array.isArray(message.content)) return ''
  return message.content
    .filter((block) => block && block.type === 'text')
    .map((block) => String(block.text || ''))
    .join('')
    .trim()
}

/**
 * 把消息里的思考块拼起来。
 * @param {{content?: Array<{type?: string, text?: string, thinking?: string}>}} message - 会话事件里的消息。
 * @returns {string} 思考文本；没有思考块时为空串。
 */
export function 思考(message) {
  if (!message || !Array.isArray(message.content)) return ''
  return message.content
    .filter((block) => block && (block.type === 'reasoning' || block.type === 'thinking'))
    .map((block) => String(block.thinking ?? block.text ?? ''))
    .join('')
    .trim()
}

/**
 * 数正文的实际字数，不算空白和换行。
 * @param {string} text - 任意文本。
 * @returns {number} 非空白字符数。
 */
export function 字数(text) {
  return Array.from(String(text || '').replace(/\s+/gu, '')).length
}

/**
 * 取一组数字的中位数；空数组为 0。
 * @param {number[]} values - 数字们。
 * @returns {number} 中位数。
 */
export function 中位(values) {
  const sorted = [...values].filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (sorted.length === 0) return 0
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/**
 * 取一条回复的开头几个字，用于统计重复开场。
 * @param {string} text - 回复正文。
 * @param {number} [count] - 取几个字。
 * @returns {string} 去掉标点后的开头。
 */
export function 开场(text, count = 6) {
  return Array.from(String(text || '').replace(/[\s\p{P}\p{S}]/gu, '')).slice(0, count).join('')
}

/**
 * 把毫秒时间戳折成本地日期（YYYY-MM-DD），按运行机器的时区算。
 * @param {number} ms - 毫秒时间戳。
 * @returns {string} 本地日期。
 */
export function 本地日(ms) {
  const date = new Date(Number(ms) || 0)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * 会话日志的标题（header 里的 id 或目录名）。
 * @param {string} file - 日志文件路径。
 * @param {object[]} events - 已解析事件。
 * @returns {string} 会话 id。
 */
export function 会话id(file, events) {
  const header = events.find((event) => event && event.type === 'session')
  return String(header?.id || basename(dirname(file)))
}
