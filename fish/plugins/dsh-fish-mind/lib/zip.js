// 自包含的 ZIP 读写。
//
// 记忆包只有几份 JSON/JSONL，不需要第三方库：写用 store/deflate，读只认
// 中央目录完整、CRC 对得上的普通 zip。为了让「格式不对就导入不进去」是真的，
// 这里主动拒绝：分卷、ZIP64、加密、data descriptor、目录项、绝对路径和 `..`。
//
// 读出的名字和内容还要由 archive.js 按白名单再验一遍；这一层只保证压缩包本身
// 没有歧义、没有越界读取。

import { deflateRawSync, inflateRawSync } from 'node:zlib'

const LOCAL_SIG = 0x04034b50
const CENTRAL_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50

export const ZIP_LIMITS = Object.freeze({
  archiveBytes: 64 * 1024 * 1024,
  entries: 32,
  entryBytes: 128 * 1024 * 1024,
  totalBytes: 192 * 1024 * 1024,
})

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

/**
 * 计算 CRC32。
 * @param {Buffer} buffer - 原始字节。
 * @returns {number} 无符号 32 位校验值。
 */
export function crc32(buffer) {
  let value = 0xffffffff
  for (let index = 0; index < buffer.length; index += 1) {
    value = CRC_TABLE[(value ^ buffer[index]) & 0xff] ^ (value >>> 8)
  }
  return (value ^ 0xffffffff) >>> 0
}

function bad(message) {
  const error = new Error(message)
  error.statusCode = 400
  return error
}

function dosDateTime(date) {
  const value = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date()
  const year = Math.max(1980, value.getFullYear())
  return {
    time: (value.getHours() << 11) | (value.getMinutes() << 5) | Math.floor(value.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate(),
  }
}

function assertEntryName(name) {
  if (typeof name !== 'string' || name === '') throw bad('压缩包里有空文件名')
  if (name.length > 200) throw bad('压缩包里的文件名太长')
  if (name.includes('\\') || name.includes('\u0000')) throw bad(`压缩包里的文件名不合法：${name}`)
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) throw bad(`压缩包里有绝对路径：${name}`)
  if (name.endsWith('/')) throw bad(`压缩包里有目录项：${name}`)
  const parts = name.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw bad(`压缩包里的路径不合法：${name}`)
  }
}

/**
 * 写一个普通 zip。内容小的条目自动 deflate，保存时不带 data descriptor。
 * @param {{ name: string, data: Buffer|string }[]} entries - 条目，名字相对包根。
 * @param {{ now?: Date }} [options] - 时间戳。
 * @returns {Buffer} zip 字节。
 */
export function createZip(entries, { now = new Date() } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) throw bad('压缩包里没有内容')
  if (entries.length > ZIP_LIMITS.entries) throw bad('压缩包里的文件太多')
  const seen = new Set()
  const chunks = []
  const central = []
  const { time, date } = dosDateTime(now)
  let offset = 0
  let total = 0

  for (const entry of entries) {
    assertEntryName(entry.name)
    if (seen.has(entry.name)) throw bad(`压缩包里有重名文件：${entry.name}`)
    seen.add(entry.name)
    const name = Buffer.from(entry.name, 'utf8')
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8')
    if (raw.length > ZIP_LIMITS.entryBytes) throw bad(`文件太大：${entry.name}`)
    total += raw.length
    if (total > ZIP_LIMITS.totalBytes) throw bad('压缩包解压后太大')
    let data = raw
    let method = 0
    if (raw.length > 0) {
      const compressed = deflateRawSync(raw, { level: 9 })
      if (compressed.length < raw.length) {
        data = compressed
        method = 8
      }
    }
    if (data.length > 0xfffffffe || raw.length > 0xfffffffe || offset > 0xffffffff) {
      throw bad('内容太大，无法写成普通 zip')
    }
    const local = Buffer.alloc(30)
    local.writeUInt32LE(LOCAL_SIG, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc32(raw), 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    chunks.push(local, name, data)
    central.push({
      name,
      method,
      crc: crc32(raw),
      compressedSize: data.length,
      size: raw.length,
      offset,
    })
    offset += local.length + name.length + data.length
  }

  if (central.length >= 0xffff) throw bad('压缩包里的文件太多')
  const directoryStart = offset
  for (const entry of central) {
    const header = Buffer.alloc(46)
    header.writeUInt32LE(CENTRAL_SIG, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(20, 6)
    header.writeUInt16LE(0x0800, 8)
    header.writeUInt16LE(entry.method, 10)
    header.writeUInt16LE(time, 12)
    header.writeUInt16LE(date, 14)
    header.writeUInt32LE(entry.crc, 16)
    header.writeUInt32LE(entry.compressedSize, 20)
    header.writeUInt32LE(entry.size, 24)
    header.writeUInt16LE(entry.name.length, 28)
    header.writeUInt16LE(0, 30)
    header.writeUInt16LE(0, 32)
    header.writeUInt16LE(0, 34)
    header.writeUInt16LE(0, 36)
    header.writeUInt32LE(0, 38)
    header.writeUInt32LE(entry.offset, 42)
    chunks.push(header, entry.name)
    offset += header.length + entry.name.length
  }
  const directorySize = offset - directoryStart
  const end = Buffer.alloc(22)
  end.writeUInt32LE(EOCD_SIG, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(central.length, 8)
  end.writeUInt16LE(central.length, 10)
  end.writeUInt32LE(directorySize, 12)
  end.writeUInt32LE(directoryStart, 16)
  end.writeUInt16LE(0, 20)
  chunks.push(end)
  return Buffer.concat(chunks)
}

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 22 - 0xffff)
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIG) return offset
  }
  return -1
}

function readName(buffer, start, length) {
  try {
    const name = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(start, start + length))
    assertEntryName(name)
    return name
  } catch (error) {
    if (error && error.statusCode === 400) throw error
    throw bad('压缩包里的文件名不是 UTF-8')
  }
}

/**
 * 读一个普通 zip，逐个条目校验长度和 CRC。
 * @param {Buffer} buffer - 文件字节。
 * @param {object} [limits] - 覆盖 `ZIP_LIMITS` 里的上限。
 * @returns {Map<string, Buffer>} 名字到解压后的内容。
 */
export function readZip(buffer, limits = {}) {
  if (!Buffer.isBuffer(buffer)) throw bad('压缩包内容不是二进制')
  const maxArchive = Number(limits.archiveBytes) || ZIP_LIMITS.archiveBytes
  const maxEntries = Number(limits.entries) || ZIP_LIMITS.entries
  const maxEntry = Number(limits.entryBytes) || ZIP_LIMITS.entryBytes
  const maxTotal = Number(limits.totalBytes) || ZIP_LIMITS.totalBytes
  if (buffer.length > maxArchive) throw bad('压缩包太大')

  const eocd = findEndOfCentralDirectory(buffer)
  if (eocd < 0) throw bad('这不是有效的 zip：找不到中央目录结尾')
  const commentLength = buffer.readUInt16LE(eocd + 20)
  if (eocd + 22 + commentLength !== buffer.length) throw bad('zip 结尾有额外内容')
  const disk = buffer.readUInt16LE(eocd + 4)
  const directoryDisk = buffer.readUInt16LE(eocd + 6)
  const diskEntries = buffer.readUInt16LE(eocd + 8)
  const totalEntries = buffer.readUInt16LE(eocd + 10)
  const directorySize = buffer.readUInt32LE(eocd + 12)
  const directoryOffset = buffer.readUInt32LE(eocd + 16)
  if (disk !== 0 || directoryDisk !== 0 || diskEntries !== totalEntries) throw bad('不支持分卷 zip')
  if (totalEntries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw bad('不支持 ZIP64')
  }
  if (totalEntries === 0) throw bad('压缩包是空的')
  if (totalEntries > maxEntries) throw bad('压缩包里的文件太多')
  if (directoryOffset + directorySize !== eocd) throw bad('zip 中央目录位置不对')

  const entries = new Map()
  const ranges = []
  let totalBytes = 0
  let offset = directoryOffset
  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > eocd || buffer.readUInt32LE(offset) !== CENTRAL_SIG) {
      throw bad('zip 中央目录损坏')
    }
    const flags = buffer.readUInt16LE(offset + 8)
    const method = buffer.readUInt16LE(offset + 10)
    const crc = buffer.readUInt32LE(offset + 16)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const size = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const entryCommentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    if (flags & 0x0001) throw bad('不支持加密 zip')
    if (flags & 0x0008) throw bad('不支持带 data descriptor 的 zip')
    if (method !== 0 && method !== 8) throw bad(`不支持的压缩方式：${method}`)
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) {
      throw bad('不支持 ZIP64')
    }
    if (size > maxEntry) throw bad('压缩包里的单个文件太大')
    totalBytes += size
    if (totalBytes > maxTotal) throw bad('压缩包解压后太大')
    const name = readName(buffer, offset + 46, nameLength)
    if (entries.has(name)) throw bad(`压缩包里有重名文件：${name}`)

    if (localOffset + 30 > directoryOffset) throw bad('zip 条目位置不对')
    if (buffer.readUInt32LE(localOffset) !== LOCAL_SIG) throw bad('zip 条目头损坏')
    const localFlags = buffer.readUInt16LE(localOffset + 6)
    const localMethod = buffer.readUInt16LE(localOffset + 8)
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    if (localFlags & 0x0001) throw bad('不支持加密 zip')
    if (localFlags & 0x0008) throw bad('不支持带 data descriptor 的 zip')
    if (localMethod !== method) throw bad(`zip 条目压缩方式不一致：${name}`)
    const localName = readName(buffer, localOffset + 30, localNameLength)
    if (localName !== name) throw bad(`zip 条目名不一致：${name}`)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const dataEnd = dataStart + compressedSize
    if (dataEnd > directoryOffset) throw bad(`zip 条目越界：${name}`)
    const data = buffer.subarray(dataStart, dataEnd)
    let content
    if (compressedSize === 0) {
      if (size !== 0) throw bad(`zip 条目长度不对：${name}`)
      content = Buffer.alloc(0)
    } else if (method === 0) {
      if (compressedSize !== size) throw bad(`zip 条目长度不对：${name}`)
      content = Buffer.from(data)
    } else {
      try {
        content = inflateRawSync(data, { maxOutputLength: Math.max(1, size) })
      } catch {
        throw bad(`zip 条目解压失败：${name}`)
      }
    }
    if (content.length !== size) throw bad(`zip 条目长度不对：${name}`)
    if (crc32(content) !== crc) throw bad(`zip 条目校验失败：${name}`)
    entries.set(name, content)
    ranges.push([localOffset, dataEnd])
    offset += 46 + nameLength + extraLength + entryCommentLength
  }
  if (offset !== eocd) throw bad('zip 中央目录长度不对')
  ranges.sort((left, right) => left[0] - right[0])
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index][0] < ranges[index - 1][1]) throw bad('zip 条目互相重叠')
  }
  return entries
}
