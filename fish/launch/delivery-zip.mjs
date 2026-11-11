// 打版交付 zip：安装包 exe + 安装说明 + nightly.yml。
//
// 不把 SnowLuma 的二进制放进交付包：它的 EULA 禁止单独再分发专有组件。
// 安装说明里只给镜像地址、文件名和摘要，接收方自己在设置页下载或用「从本地 zip 安装」。

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
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
 * 交付 zip 里的安装说明；SnowLuma 的二进制不随包分发，只给镜像、文件名和摘要。
 * @param {{版本: string, 安装包名: string, 大小: number, sha: string}} 输入 - 安装包信息。
 * @returns {string} 纯文本说明。
 */
export function 安装说明文本({ 版本, 安装包名, 大小, sha }) {
  const 雪 = 最后已知发行包
  const 镜像 = 发行镜像仓库[0].仓库
  const 雪直连 = `https://github.com/${镜像}/releases/download/${雪.标签}/${雪.资产.name}`
  const 雪摘要 = String(雪.资产.digest || '').replace(/^sha256:/i, '')
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
    '4. 勾选同意 SnowLuma 的协议，点「一键安装并配置」。',
    '',
    '如果一键安装下载失败：',
    '· 先手动下载 SnowLuma（QQ 后端），任选一个镜像：',
    `  https://gh-proxy.com/${雪直连}`,
    `  https://ghproxy.net/${雪直连}`,
    `  文件名：${雪.资产.name}`,
    `  大小：${Number(雪.资产.size).toLocaleString('en-US')} 字节`,
    `  SHA-256：${雪摘要 || '以镜像 release.json 为准'}`,
    '· 回到 DSH 设置，点「从本地 zip 安装」，选刚下载的这个文件。',
    `· 镜像页（有新版本时以这里为准）：https://github.com/${镜像}/releases/latest`,
    '',
    '说明：本交付包不分发 SnowLuma 的二进制；SnowLuma 由你从镜像自行下载，',
    '并在设置页勾选同意它的 EULA / 隐私政策。',
    '',
    'nightly.yml 是这个版本的更新清单，SHA-512 与安装包一致。',
    '',
  ].join('\n')
}

/** 交付 zip 里必须有的文件；少一个就不算打好。 */
const 交付文件 = (安装包名) => [安装包名, '安装说明.txt', 'nightly.yml']

/**
 * 打交付 zip：exe + 安装说明 + nightly.yml。
 * SnowLuma 的二进制不放进去；说明里给镜像地址、文件名和摘要。
 * @param {{输出目录: string, 版本: string, 安装包: string, 大小: number, sha: string, nightly: string}} 输入 - 已校验的安装包和清单。
 * @returns {Promise<{文件: string, 大小: number, sha: string, 内容: string[]}>} 交付 zip 的路径、大小、SHA-512 和内容。
 */
export async function 打交付zip({ 输出目录, 版本, 安装包, 大小, sha, nightly }) {
  mkdirSync(输出目录, { recursive: true })
  const 文件名 = `大肥鱼-${版本}-win-x64.zip`
  const 输出 = join(输出目录, 文件名)
  const 安装包名 = basename(安装包)
  const 文件们 = 交付文件(安装包名)
  const 暂存 = mkdtempSync(join(tmpdir(), 'fish-delivery-'))
  try {
    copyFileSync(安装包, join(暂存, 安装包名))
    // 加 BOM：老记事本才会按 UTF-8 读中文，不靠系统代码页。
    writeFileSync(join(暂存, '安装说明.txt'), '\uFEFF' + 安装说明文本({ 版本, 安装包名, 大小, sha }).replace(/\n/g, '\r\n'), 'utf8')
    writeFileSync(join(暂存, 'nightly.yml'), nightly, 'utf8')

    try {
      rmSync(输出, { force: true })
    } catch (错误) {
      throw new Error(`旧的交付 zip 删不掉（可能正被打开）：${错误.message}`)
    }

    let 列表 = ''
    if (process.platform === 'win32') {
      const tar = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
      if (!existsSync(tar)) throw new Error(`找不到 Windows 自带的 ${tar}，没法打 zip`)
      execFileSync(tar, ['-a', '-cf', 输出, '-C', 暂存, ...文件们], {
        windowsHide: true,
        timeout: 30 * 60_000,
      })
      // 不用 tar -tf 列内容：中文文件名会按控制台代码页输出，Node 侧比对会变成乱码。
      const 单引 = String(输出).replace(/'/g, "''")
      列表 = execFileSync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$OutputEncoding=[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ` +
          `Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
          `$zip=[System.IO.Compression.ZipFile]::OpenRead('${单引}'); ` +
          `$zip.Entries | ForEach-Object { $_.FullName }; $zip.Dispose()`,
      ], { encoding: 'utf8', windowsHide: true, timeout: 120_000 })
    } else {
      try {
        execFileSync('zip', ['-q', '-j', 输出, ...文件们.map((名) => join(暂存, 名))], { timeout: 30 * 60_000 })
        列表 = execFileSync('unzip', ['-Z1', 输出], { encoding: 'utf8', timeout: 120_000 })
      } catch (错误) {
        throw new Error(`打 zip 失败（需要 zip / unzip）：${错误.message}`)
      }
    }

    const 行们 = 列表.split(/\r?\n/).map((x) => x.trim().replace(/^\.\//, '')).filter(Boolean)
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
