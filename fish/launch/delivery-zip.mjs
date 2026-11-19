// 打版交付 zip：安装包 exe + SnowLuma 安装包 + 安装说明 + nightly.yml。
//
// 主人 2026-11-19 长期口径：「打包」= 一个 zip 里放大肥鱼安装包和 SnowLuma 安装包，
// 且 SnowLuma 要能正常安装。EULA 再分发风险已告知，按主人指令随包提供；
// 入包前校验大小、SHA-256，并确认 zip 根目录有 index.mjs / node.exe。

import { createHash } from 'node:crypto'
import {
  closeSync,
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { crc32 } from 'node:zlib'
import { 最后已知发行包, 发行镜像仓库 } from '../plugins/dsh-qq-bridge/lib/snowluma-release.js'

function MB(n) {
  return `${(n / 1048576).toFixed(1)} MB`
}

/**
 * 分块算文件的 SHA-512（base64，与 electron-builder 的 nightly.yml 一致）。
 * @param {string} 文件 - 磁盘文件。
 * @returns {Promise<string>} base64 摘要。
 */
export async function SHA512(文件) {
  const hash = createHash('sha512')
  for await (const 块 of createReadStream(文件)) hash.update(块)
  return hash.digest('base64')
}

/**
 * 分块算文件的 SHA-256（小写十六进制，与镜像 release.json 的 digest 一致）。
 * @param {string} 文件 - 磁盘文件。
 * @returns {Promise<string>} 十六进制摘要。
 */
export async function SHA256(文件) {
  const hash = createHash('sha256')
  for await (const 块 of createReadStream(文件)) hash.update(块)
  return hash.digest('hex')
}

function 默认雪资产() {
  return {
    名: 最后已知发行包.资产.name,
    大小: Number(最后已知发行包.资产.size),
    sha256: String(最后已知发行包.资产.digest || '').replace(/^sha256:/i, ''),
  }
}

/**
 * 交付 zip 里的安装说明：包内已附 SnowLuma 安装包，给出文件名、大小、摘要和本地安装步骤。
 * @param {{版本: string, 安装包名: string, 大小: number, sha: string, 雪?: {名: string, 大小: number, sha256: string}}} 输入 - 安装包和 SnowLuma 安装包信息。
 * @returns {string} 纯文本说明。
 */
export function 安装说明文本({ 版本, 安装包名, 大小, sha, 雪 = 默认雪资产() }) {
  const 雪名 = 雪.名
  const 雪大小 = Number(雪.大小)
  const 雪摘要 = String(雪.sha256 || '').replace(/^sha256:/i, '')
  const 镜像 = 发行镜像仓库[0].仓库
  const 雪直连 = `https://github.com/${镜像}/releases/download/${最后已知发行包.标签}/${encodeURIComponent(雪名)}`
  return [
    `大肥鱼 ${版本} · Windows x64 安装包`,
    '',
    `安装包：${安装包名}`,
    `大小：${大小.toLocaleString('en-US')} 字节（${MB(大小)}）`,
    `SHA-512：${sha}`,
    '',
    '怎么装：',
    '1. 先在托盘完全退出旧版大肥鱼。',
    `2. 双击 ${安装包名}；SmartScreen 提示时点「更多信息 → 仍要运行」。`,
    '3. 打开 DSH → 设置 → 她在外面 → 通到 QQ。',
    `4. 勾选同意 SnowLuma 的协议，点「从本地 zip 安装」，选同一个文件夹里的 ${雪名}。`,
    '5. 装好后按页面提示配置；QQ 登录和注入按页面引导完成。',
    '',
    '包内附的 SnowLuma 安装包（也可从镜像单独下载）：',
    `  文件：${雪名}`,
    `  大小：${雪大小.toLocaleString('en-US')} 字节`,
    `  SHA-256：${雪摘要 || '以文件实际摘要为准'}`,
    `  镜像页：https://github.com/${镜像}/releases/latest`,
    '',
    '如果本地 zip 安装失败，也可以在设置页点一键安装，从镜像重新下载：',
    `  https://gh-proxy.com/${雪直连}`,
    `  https://ghproxy.net/${雪直连}`,
    '',
    'nightly.yml 是这个版本的更新清单，SHA-512 与安装包一致。',
    '',
  ].join('\n')
}

/** 交付 zip 里必须有的文件；少一个就不算打好。 */
const 交付文件 = (安装包名, 雪名) => [安装包名, 雪名, '安装说明.txt', 'nightly.yml']

/**
 * 读出 zip 中央目录里的文件名。只解析本交付包会用到的普通 zip，不依赖 PowerShell / unzip 的输出编码。
 * @param {string} 文件 - 磁盘上的 zip。
 * @returns {string[]} zip 里的条目名。
 */
export function 列zip条目(文件) {
  const 大小 = statSync(文件).size
  const 尾长 = Math.min(大小, 65557)
  if (尾长 < 22) throw new Error('不是有效的 zip（文件太小）')
  const 尾 = Buffer.alloc(尾长)
  const 句柄 = openSync(文件, 'r')
  try {
    let 读 = 0
    while (读 < 尾长) {
      const n = readSync(句柄, 尾, 读, 尾长 - 读, 大小 - 尾长 + 读)
      if (n <= 0) break
      读 += n
    }
  } finally {
    closeSync(句柄)
  }
  let eocd = -1
  for (let i = 尾.length - 22; i >= 0; i--) {
    if (尾.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('不是有效的 zip（找不到中央目录）')
  const 条目数 = 尾.readUInt16LE(eocd + 10)
  const 目录偏移 = 尾.readUInt32LE(eocd + 16)
  const 目录结束 = (大小 - 尾长) + eocd
  const 目录长 = 目录结束 - 目录偏移
  if (目录偏移 <= 0 || 目录长 <= 0 || 目录长 > 100 * 1024 * 1024) {
    throw new Error('不是有效的 zip（中央目录位置不对）')
  }
  const 目录 = Buffer.alloc(目录长)
  const 目录句柄 = openSync(文件, 'r')
  try {
    let 读 = 0
    while (读 < 目录长) {
      const n = readSync(目录句柄, 目录, 读, 目录长 - 读, 目录偏移 + 读)
      if (n <= 0) break
      读 += n
    }
  } finally {
    closeSync(目录句柄)
  }
  const 名们 = []
  let 位置 = 0
  for (let i = 0; i < 条目数; i++) {
    if (位置 + 46 > 目录.length || 目录.readUInt32LE(位置) !== 0x02014b50) {
      throw new Error(`不是有效的 zip（第 ${i + 1} 个目录项读不出来）`)
    }
    const 名长 = 目录.readUInt16LE(位置 + 28)
    const 额外长 = 目录.readUInt16LE(位置 + 30)
    const 注释长 = 目录.readUInt16LE(位置 + 32)
    if (位置 + 46 + 名长 > 目录.length) throw new Error('不是有效的 zip（文件名越界）')
    名们.push(目录.subarray(位置 + 46, 位置 + 46 + 名长).toString('utf8'))
    位置 += 46 + 名长 + 额外长 + 注释长
  }
  return 名们
}

/**
 * 校验随包分发的 SnowLuma 安装包：文件存在、可选的大小/SHA-256 匹配，且 zip 根目录有
 * index.mjs 和 node.exe（设置页「从本地 zip 安装」依赖这两个入口）。
 * @param {string} 文件 - SnowLuma 发行 zip。
 * @param {{名?: string, name?: string, 大小?: number, size?: number, sha256?: string, digest?: string} | null} [期望] - 期望的文件信息；不传则只做结构与摘要计算。
 * @returns {Promise<{名: string, 大小: number, sha256: string}>} 入包用的文件名、大小和 SHA-256。
 */
export async function 校验雪包(文件, 期望 = null) {
  if (!existsSync(文件)) throw new Error(`找不到 SnowLuma 安装包：${文件}`)
  const 大小 = statSync(文件).size
  const 期望大小 = Number(期望?.大小 ?? 期望?.size ?? 0)
  if (期望大小 && 大小 !== 期望大小) {
    throw new Error(`SnowLuma 安装包大小不符：${大小.toLocaleString('en-US')} 字节，期望 ${期望大小.toLocaleString('en-US')} 字节`)
  }
  const 实际摘要 = await SHA256(文件)
  const 期望摘要 = String(期望?.sha256 ?? 期望?.digest ?? '').replace(/^sha256:/i, '').toLowerCase()
  if (期望摘要 && 实际摘要 !== 期望摘要) {
    throw new Error(`SnowLuma 安装包 SHA-256 不符：${实际摘要}，期望 ${期望摘要}`)
  }
  const 条目 = 列zip条目(文件)
  for (const 必须 of ['index.mjs', 'node.exe']) {
    if (!条目.includes(必须)) throw new Error(`SnowLuma 安装包不完整：根目录缺 ${必须}`)
  }
  return { 名: 期望?.名 || 期望?.name || basename(文件), 大小, sha256: 实际摘要 }
}

/**
 * 写一个只存储不压缩的 zip，文件名统一标 UTF-8。
 * exe 本身已经是压缩过的安装包，再 deflate 省不了多少；自己写可以避开
 * Windows bsdtar 按控制台代码页写中文名、PowerShell 列目录编码不一致的问题。
 * @param {string} 输出 - 输出 zip 路径。
 * @param {{名: string, 路径: string}[]} 文件们 - 要写进去的文件。
 */
function 写zip(输出, 文件们) {
  const 现在 = new Date()
  const 时间 = ((现在.getHours() & 0x1f) << 11) | ((现在.getMinutes() & 0x3f) << 5) | ((现在.getSeconds() >> 1) & 0x1f)
  const 日期 = (((现在.getFullYear() - 1980) & 0x7f) << 9) | (((现在.getMonth() + 1) & 0x0f) << 5) | (现在.getDate() & 0x1f)
  const 句柄 = openSync(输出, 'w')
  const 写全 = (buf, 位置) => {
    let 完 = 0
    while (完 < buf.length) {
      const n = writeSync(句柄, buf, 完, buf.length - 完, 位置 + 完)
      if (n <= 0) throw new Error('写 zip 失败')
      完 += n
    }
  }
  try {
    const 目录 = []
    let 偏移 = 0
    for (const 项 of 文件们) {
      const 名 = Buffer.from(项.名, 'utf8')
      const 大小 = statSync(项.路径).size
      const 头偏移 = 偏移
      const 头 = Buffer.alloc(30)
      头.writeUInt32LE(0x04034b50, 0)
      头.writeUInt16LE(20, 4)
      头.writeUInt16LE(0x0800, 6) // 文件名是 UTF-8
      头.writeUInt16LE(0, 8) // store：不压缩
      头.writeUInt16LE(时间, 10)
      头.writeUInt16LE(日期, 12)
      头.writeUInt16LE(名.length, 26)
      写全(头, 偏移)
      偏移 += 头.length
      写全(名, 偏移)
      偏移 += 名.length
      let crc = 0
      let 已读 = 0
      const 读句柄 = openSync(项.路径, 'r')
      const 块 = Buffer.alloc(1024 * 1024)
      try {
        while (已读 < 大小) {
          const n = readSync(读句柄, 块, 0, Math.min(块.length, 大小 - 已读), 已读)
          if (n <= 0) break
          crc = crc32(块.subarray(0, n), crc)
          写全(块.subarray(0, n), 偏移)
          偏移 += n
          已读 += n
        }
      } finally {
        closeSync(读句柄)
      }
      if (已读 !== 大小) throw new Error(`读 ${项.路径} 时少读了字节`)
      const 补 = Buffer.alloc(12)
      补.writeUInt32LE(crc >>> 0, 0)
      补.writeUInt32LE(大小, 4)
      补.writeUInt32LE(大小, 8)
      写全(补, 头偏移 + 14)
      目录.push({ 名, crc: crc >>> 0, 大小, 头偏移 })
    }
    const 目录起点 = 偏移
    for (const 项 of 目录) {
      const 头 = Buffer.alloc(46)
      头.writeUInt32LE(0x02014b50, 0)
      头.writeUInt16LE(20, 4)
      头.writeUInt16LE(20, 6)
      头.writeUInt16LE(0x0800, 8)
      头.writeUInt16LE(0, 10)
      头.writeUInt16LE(时间, 12)
      头.writeUInt16LE(日期, 14)
      头.writeUInt32LE(项.crc, 16)
      头.writeUInt32LE(项.大小, 20)
      头.writeUInt32LE(项.大小, 24)
      头.writeUInt16LE(项.名.length, 28)
      头.writeUInt32LE(项.头偏移, 42)
      写全(头, 偏移)
      偏移 += 头.length
      写全(项.名, 偏移)
      偏移 += 项.名.length
    }
    const 目录大小 = 偏移 - 目录起点
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0)
    eocd.writeUInt16LE(目录.length, 8)
    eocd.writeUInt16LE(目录.length, 10)
    eocd.writeUInt32LE(目录大小, 12)
    eocd.writeUInt32LE(目录起点, 16)
    写全(eocd, 偏移)
  } finally {
    closeSync(句柄)
  }
}

/**
 * 打交付 zip：exe + SnowLuma 安装包 + 安装说明 + nightly.yml。
 * @param {{输出目录: string, 版本: string, 安装包: string, 大小: number, sha: string, nightly: string, 雪包: string, 雪期望?: object | null}} 输入 - 已校验的安装包、清单和 SnowLuma 安装包。
 * @returns {Promise<{文件: string, 大小: number, sha: string, 内容: string[]}>} 交付 zip 的路径、大小、SHA-512 和内容。
 */
export async function 打交付zip({ 输出目录, 版本, 安装包, 大小, sha, nightly, 雪包, 雪期望 = null }) {
  if (!雪包) throw new Error('缺少 SnowLuma 安装包路径')
  const 雪 = await 校验雪包(雪包, 雪期望)
  mkdirSync(输出目录, { recursive: true })
  const 文件名 = `大肥鱼-${版本}-win-x64.zip`
  const 输出 = join(输出目录, 文件名)
  const 安装包名 = basename(安装包)
  const 文件们 = 交付文件(安装包名, 雪.名)
  const 暂存 = mkdtempSync(join(tmpdir(), 'fish-delivery-'))
  try {
    copyFileSync(安装包, join(暂存, 安装包名))
    copyFileSync(雪包, join(暂存, 雪.名))
    // 加 BOM：老记事本才会按 UTF-8 读中文，不靠系统代码页。
    writeFileSync(join(暂存, '安装说明.txt'), '\uFEFF' + 安装说明文本({ 版本, 安装包名, 大小, sha, 雪 }).replace(/\n/g, '\r\n'), 'utf8')
    writeFileSync(join(暂存, 'nightly.yml'), nightly, 'utf8')

    try {
      rmSync(输出, { force: true })
    } catch (错误) {
      throw new Error(`旧的交付 zip 删不掉（可能正被打开）：${错误.message}`)
    }

    写zip(输出, 文件们.map((名) => ({ 名, 路径: join(暂存, 名) })))

    // 自己读 zip 中央目录核对内容；不依赖 tar -tf / PowerShell / unzip 的输出编码。
    const 行们 = 列zip条目(输出)
    for (const 名 of 文件们) {
      if (!行们.some((x) => x === 名 || x.endsWith('/' + 名))) throw new Error(`交付 zip 里没有 ${名}`)
    }
    const 大小实际 = statSync(输出).size
    const 摘要 = await SHA512(输出)
    writeFileSync(`${输出}.sha512`, `${摘要}  ${文件名}\n`, 'utf8')
    return { 文件: 输出, 大小: 大小实际, sha: 摘要, 内容: 文件们 }
  } finally {
    rmSync(暂存, { recursive: true, force: true })
  }
}
