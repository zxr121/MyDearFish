// QQ 视频 → 一张 6 帧动画图。
//
// 只做“看得见画面”：不转写声音。产物走 attachments.saveImages 进 DSH 附件库，
// 模型请求时由 attachment-local 的 storyboard 管线抽帧拼成带编号的分镜，
// 和 QQ 动图（GIF/动态 WebP）完全同一条路。
//
// ffmpeg 不随插件分发：本机没有时按需从上游下载静态包，校验 sha256 后解压到
// $DSH_HOME/qq-video/bin；也可以直接指向已经装好的 ffmpeg。

import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import {
  copyFileSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'

const 跑 = promisify(execFile)

/** 一张分镜里最多抽几帧；和 attachment-local 的 storyboard 上限一致。 */
export const 分镜帧数 = 6
/** 分镜默认宽度；竖屏视频再宽，落进分镜格子也看不清。 */
export const 默认分镜宽 = 480
/** 一条 QQ 视频最多看这么久；更长的只抽前一段。 */
export const 默认最长秒 = 60
/** 产物上限，超过就降一档宽度重试。 */
const 产物上限 = 6 * 1024 * 1024
/** 同时最多处理两个视频。 */
const 并发上限 = 2
/** 排队上限；再多的这一轮直接跳过。 */
const 排队上限 = 4

/**
 * 认一个 MP4：ISO BMFF 的 ftyp box 在偏移 4。
 * @param {Uint8Array} bytes - 下载回来的前若干字节（完整文件也行）。
 * @returns {'mp4'|''} 认出来是 MP4 就返回 `'mp4'`。
 */
export function 嗅探视频(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(0)
  if (b.length < 12) return ''
  return String.fromCharCode(b[4], b[5], b[6], b[7]) === 'ftyp' ? 'mp4' : ''
}

function 夹偶(值, 最小, 最大) {
  const n = Math.round(Number(值) || 0)
  const 夹 = Math.min(最大, Math.max(最小, n))
  return 夹 % 2 === 0 ? 夹 : 夹 - 1
}

/**
 * 生成 ffmpeg 的抽帧参数。纯函数，不碰文件系统，方便测试。
 * `{in}` / `{out}` 是占位符，由调用方换成真实路径。
 * @param {{秒?: number, 宽度?: number, 帧数?: number, 上限秒?: number, 编码?: 'webp'|'gif', webp编码器?: string}} [选项] - 视频时长、输出宽度、帧数、时长上限和编码。
 * @returns {{秒: number, 估算: boolean, 编码: string, 宽: number, 帧数: number, 话: string[], 参数: string[]}} 参数与说明。
 */
export function 抽帧参数(选项 = {}) {
  const 原秒 = Number(选项.秒) > 0 ? Number(选项.秒) : 0
  const 估算 = 原秒 === 0
  const 上限 = Number(选项.上限秒) > 0 ? Number(选项.上限秒) : 默认最长秒
  const 秒 = Math.min(Math.max(0.5, 原秒 || 30), 上限)
  const 帧数 = Math.max(1, Math.round(Number(选项.帧数) || 分镜帧数))
  const 宽 = 夹偶(选项.宽度 === undefined ? 默认分镜宽 : 选项.宽度, 160, 1280)
  const 编码 = 选项.编码 === 'gif' ? 'gif' : 'webp'
  const fps = (帧数 / 秒).toFixed(6)
  const 基础 = `fps=${fps},scale=${宽}:-2:flags=lanczos`
  const 滤镜 = 编码 === 'gif'
    ? `${基础},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3`
    : 基础
  const 头 = [
    '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
    '-i', '{in}', '-t', String(秒), '-vf', 滤镜,
    '-frames:v', String(帧数), '-an', '-sn', '-dn',
  ]
  const 尾 = 编码 === 'gif'
    ? ['-loop', '0', '-f', 'gif', '{out}']
    : ['-c:v', 选项.webp编码器 === 'libwebp' ? 'libwebp' : 'libwebp_anim',
      '-lossless', '0', '-q:v', '70', '-loop', '0', '-f', 'webp', '{out}']
  return {
    秒,
    估算,
    编码,
    宽,
    帧数,
    话: [
      `抽 ${帧数} 帧 / ${秒} 秒（${编码}${估算 ? '，时长按 30 秒估' : ''}）`,
    ],
    参数: [...头, ...尾],
  }
}

/**
 * 数一张动画图里有多少帧。只认 WebP 的 ANMF 和 GIF 的图形控制块。
 * @param {Uint8Array} data - 动画 WebP / GIF 的完整字节。
 * @returns {number} 帧数；静态图或认不出返回 0。
 */
export function 数分镜帧(data) {
  const b = data instanceof Uint8Array ? Buffer.from(data) : Buffer.alloc(0)
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    let 数 = 0
    let i = 0
    while ((i = b.indexOf('ANMF', i)) !== -1) {
      数 += 1
      i += 4
    }
    return 数
  }
  if (b.length >= 6 && b.toString('ascii', 0, 3) === 'GIF') {
    const 标记 = Buffer.from([0x21, 0xf9])
    let 数 = 0
    let i = 0
    while ((i = b.indexOf(标记, i)) !== -1) {
      数 += 1
      i += 2
    }
    return 数
  }
  return 0
}

/**
 * 从 sha256 清单里挑出目标文件的摘要。
 * gyan 的 `.sha256` 常只有一行 hash；BtbN 的 `checksums.sha256` 是 `hash  filename` 两列。
 * @param {string} 文本 - 清单内容。
 * @param {string} [文件名] - 目标文件名；清单只有一行时可以省略。
 * @returns {string} 64 位小写摘要；找不到返回空串。
 */
export function 摘要行(文本, 文件名 = '') {
  const 行们 = String(文本 || '').split(/\r?\n/).map((x) => x.trim()).filter((x) => x !== '')
  for (const 行 of 行们) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(行)
    if (m && (文件名 === '' || m[2].trim() === 文件名)) return m[1].toLowerCase()
  }
  if (行们.length === 1) {
    const 单 = /^([0-9a-f]{64})/i.exec(行们[0])
    if (单) return 单[1].toLowerCase()
  }
  return ''
}

function 是文件(path) {
  try {
    return statSync(path).isFile()
  } catch (error) {
    return false
  }
}

function 找文件(名, 目录) {
  let 项们 = []
  try {
    项们 = readdirSync(目录, { withFileTypes: true })
  } catch (error) {
    return null
  }
  for (const 项 of 项们) {
    const path = join(目录, 项.name)
    if (项.isDirectory()) {
      const 命中 = 找文件(名, path)
      if (命中) return 命中
    } else if (项.name === 名) {
      return path
    }
  }
  return null
}

function 读JSON(path, 兜) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    return 兜
  }
}

function 写JSON(path, 值) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(值, null, 2), 'utf8')
}

/**
 * 建立一个视频工坊：定位/安装 ffmpeg，把视频抽成 6 帧动画图。
 * @param {{家目录: string, 记账?: (文字: string) => void, 读配置?: () => object, 平台?: string}} 选项 - 家目录、日志、配置读取。
 * @returns {object} `{ 状态, 找命令, 确保安装, 抽分镜, 清临时, 路径 }`。
 */
export function 创建视频工坊({ 家目录, 记账 = () => {}, 读配置 = () => ({}), 平台 = process.platform }) {
  const 根 = join(家目录, 'qq-video')
  const bin目录 = join(根, 'bin')
  const 临时目录 = join(根, 'tmp')
  const 元文件 = join(根, 'ffmpeg.json')
  const 是Win = 平台 === 'win32'
  const ffmpeg名 = 是Win ? 'ffmpeg.exe' : 'ffmpeg'
  const ffprobe名 = 是Win ? 'ffprobe.exe' : 'ffprobe'

  let 安装任务 = null
  let 安装状态 = { 进行中: false, 阶段: '', 错: '', 已下载: 0, 总: 0 }
  let 探测缓存 = null // { at, 命令 }；只缓存 PATH 探测，避免状态轮询反复 spawn
  let 进行中 = 0
  const 排队 = []

  function 视频配置() {
    const 配置 = 读配置() || {}
    const 视频 = 配置.视频 && typeof 配置.视频 === 'object' ? 配置.视频 : {}
    return {
      启用: 视频.启用 !== false,
      自动装: 视频.自动装 !== false,
      只用LGPL: 视频.只用LGPL === true,
      最长秒: Math.min(600, Math.max(5, Number(视频.最长秒) || 默认最长秒)),
      宽度: 夹偶(视频.宽度 === undefined ? 默认分镜宽 : 视频.宽度, 160, 1280),
      路径: typeof 视频.ffmpeg路径 === 'string' ? 视频.ffmpeg路径.trim() : '',
    }
  }

  function 元() {
    return 读JSON(元文件, null)
  }

  function 从守护进程() {
    const 配置 = 视频配置()
    const 候选 = []
    if (配置.路径 !== '') 候选.push(配置.路径)
    候选.push(join(bin目录, ffmpeg名))
    for (const 路径 of 候选) {
      if (是文件(路径)) {
        const 同目录probe = join(路径, '..', ffprobe名)
        const 从配置 = 配置.路径 !== '' && 路径 === 配置.路径
        return {
          ffmpeg: 路径,
          ffprobe: 是文件(同目录probe) ? 同目录probe : 'ffprobe',
          来源: 从配置 ? '配置路径' : (元()?.来源 || '本机安装'),
          许可证: 从配置 ? '' : (元()?.许可证 || ''),
          版本: 从配置 ? '' : (元()?.版本 || ''),
          webp编码器: 从配置 ? '' : (元()?.webp编码器 || ''),
        }
      }
    }
    return null
  }

  /** 用户自己放了一份 ffmpeg 时，第一次用之前问一次它支持哪个 WebP 编码器。 */
  async function 补齐能力(命令) {
    if (!命令 || 命令.webp编码器 !== '') return 命令
    try {
      const 编码 = await 跑(命令.ffmpeg, ['-hide_banner', '-encoders'], { windowsHide: true, timeout: 8_000 })
      const 全 = String(编码.stdout || '')
      命令.webp编码器 = 全.includes('libwebp_anim') ? 'libwebp_anim' : 全.includes('libwebp') ? 'libwebp' : ''
    } catch (error) {
      命令.webp编码器 = ''
    }
    return 命令
  }

  async function 探PATH() {
    if (探测缓存 && Date.now() - 探测缓存.at < 60_000) return 探测缓存.命令
    try {
      const { stdout } = await 跑('ffmpeg', ['-version'], { windowsHide: true, timeout: 8_000 })
      const 版本 = String(stdout || '').split(/\r?\n/)[0].replace(/^ffmpeg version\s*/i, '').slice(0, 80)
      const 命令 = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', 来源: 'PATH', 许可证: '', 版本, webp编码器: '' }
      try {
        const 编码 = await 跑('ffmpeg', ['-hide_banner', '-encoders'], { windowsHide: true, timeout: 8_000 })
        const 全 = String(编码.stdout || '')
        命令.webp编码器 = 全.includes('libwebp_anim') ? 'libwebp_anim' : 全.includes('libwebp') ? 'libwebp' : ''
      } catch (error) {}
      探测缓存 = { at: Date.now(), 命令 }
      return 命令
    } catch (error) {
      探测缓存 = { at: Date.now(), 命令: null }
      return null
    }
  }

  function 快速找() {
    return 从守护进程() || (探测缓存 && Date.now() - 探测缓存.at < 60_000 ? 探测缓存.命令 : null)
  }

  async function 找命令() {
    const 有 = 从守护进程()
    if (有) return 补齐能力(有)
    const 路径里的 = await 探PATH()
    return 路径里的 ? 补齐能力(路径里的) : null
  }

  async function 下载文件(地址, 文件, 进度) {
    const 控 = new AbortController()
    let 总时限 = setTimeout(() => 控.abort(new Error('下载超时')), 30 * 60_000)
    let 停滞 = setTimeout(() => 控.abort(new Error('连接超时')), 30_000)
    try {
      const 响应 = await fetch(地址, { redirect: 'follow', signal: 控.signal })
      clearTimeout(停滞)
      if (!响应.ok || !响应.body) throw new Error(`HTTP ${响应.status}`)
      停滞 = setTimeout(() => 控.abort(new Error('下载停滞')), 30_000)
      const 头长 = Number((响应.headers && typeof 响应.headers.get === 'function' && 响应.headers.get('content-length')) || 0)
      if (头长 > 0) 安装状态.总 = 头长
      const 哈希 = createHash('sha256')
      let 已 = 0
      await pipeline(
        Readable.fromWeb(响应.body),
        async function* (源) {
          for await (const 块 of 源) {
            已 += 块.length
            哈希.update(块)
            安装状态.已下载 = 已
            进度(已)
            clearTimeout(停滞)
            停滞 = setTimeout(() => 控.abort(new Error('下载停滞')), 30_000)
            yield 块
          }
        },
        createWriteStream(文件),
      )
      return { 摘要: 哈希.digest('hex'), 已 }
    } finally {
      clearTimeout(总时限)
      clearTimeout(停滞)
    }
  }

  async function 取摘要(地址, 文件名) {
    try {
      const 响应 = await fetch(地址, { redirect: 'follow', signal: AbortSignal.timeout(20_000) })
      if (!响应.ok) return ''
      return 摘要行(await 响应.text(), 文件名)
    } catch (error) {
      return ''
    }
  }

  async function 解压(压缩包, 到) {
    mkdirSync(到, { recursive: true })
    const tar = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    if (是文件(tar)) {
      try {
        await 跑(tar, ['-xf', 压缩包, '-C', 到], { windowsHide: true, timeout: 3 * 60_000 })
        return
      } catch (error) {}
    }
    const 单引 = (s) => String(s).replace(/'/g, "''")
    try {
      await 跑('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -LiteralPath '${单引(压缩包)}' -DestinationPath '${单引(到)}' -Force`,
      ], { windowsHide: true, timeout: 3 * 60_000 })
      return
    } catch (error) {}
    await 跑('unzip', ['-o', 压缩包, '-d', 到], { windowsHide: true, timeout: 3 * 60_000 })
  }

  function 安装源(配置) {
    const 源们 = []
    const GH = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest'
    const 名 = 'ffmpeg-master-latest-win64-lgpl.zip'
    if (!配置.只用LGPL) {
      源们.push({
        来源: 'gyan.dev', 许可证: 'GPL', 文件名: 'ffmpeg-release-essentials.zip',
        地址: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
        摘要地址: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip.sha256',
      })
    }
    for (const [前缀, 标签] of [['https://gh-proxy.com/', 'BtbN·gh-proxy'], ['https://ghproxy.net/', 'BtbN·ghproxy'], ['', 'BtbN·直连']]) {
      源们.push({
        来源: 标签, 许可证: 'LGPL', 文件名: 名,
        地址: `${前缀}${GH}/${名}`,
        摘要地址: `${前缀}${GH}/checksums.sha256`,
      })
    }
    return 源们
  }

  async function 执行安装(配置) {
    if (!是Win) {
      const 说 = '这个平台不支持一键装 ffmpeg；请在 PATH 里放一份，或在设置里指向已有路径'
      安装状态 = { 进行中: false, 阶段: '失败', 错: 说, 已下载: 0, 总: 0 }
      throw new Error(说)
    }
    mkdirSync(bin目录, { recursive: true })
    mkdirSync(临时目录, { recursive: true })
    const 错误们 = []
    for (const 源 of 安装源(配置)) {
      安装状态 = { 进行中: true, 阶段: `下载 ffmpeg（${源.来源}）`, 错: '', 已下载: 0, 总: 0 }
      const 压缩包 = join(临时目录, 源.文件名)
      const 解压到 = join(临时目录, `解压-${Date.now()}`)
      try {
        const 期望 = await 取摘要(源.摘要地址, 源.文件名)
        if (期望 === '') 记账(`ffmpeg 来源 ${源.来源} 没取到 sha256，这次不校验`)
        const 结果 = await 下载文件(源.地址, 压缩包, () => {})
        if (期望 !== '' && 结果.摘要 !== 期望) throw new Error('SHA-256 校验失败')
        安装状态 = { ...安装状态, 阶段: '解压 ffmpeg' }
        await 解压(压缩包, 解压到)
        const ffmpeg = 找文件(ffmpeg名, 解压到)
        const ffprobe = 找文件(ffprobe名, 解压到)
        if (!ffmpeg) throw new Error('解压完了，但没找到 ffmpeg.exe')
        copyFileSync(ffmpeg, join(bin目录, ffmpeg名))
        if (ffprobe) copyFileSync(ffprobe, join(bin目录, ffprobe名))
        const 路径 = join(bin目录, ffmpeg名)
        const 版本输出 = await 跑(路径, ['-version'], { windowsHide: true, timeout: 15_000 })
        const 版本 = String(版本输出.stdout || '').split(/\r?\n/)[0].replace(/^ffmpeg version\s*/i, '').slice(0, 80)
        let webp编码器 = ''
        try {
          const 编码 = await 跑(路径, ['-hide_banner', '-encoders'], { windowsHide: true, timeout: 15_000 })
          const 全 = String(编码.stdout || '')
          webp编码器 = 全.includes('libwebp_anim') ? 'libwebp_anim' : 全.includes('libwebp') ? 'libwebp' : ''
        } catch (error) {}
        const 信息 = {
          版本, 来源: 源.来源, 许可证: 源.许可证, 摘要: 结果.摘要, 装于: Date.now(),
          路径, webp编码器,
        }
        写JSON(元文件, 信息)
        安装状态 = { 进行中: false, 阶段: '就绪', 错: '', 已下载: 结果.已, 总: 结果.已 }
        记账(`ffmpeg 装好了：${版本}（${源.来源}，${源.许可证}）`)
        try { rmSync(压缩包, { force: true }) } catch (error) {}
        try { rmSync(解压到, { recursive: true, force: true }) } catch (error) {}
        return { ffmpeg: 路径, ffprobe: 是文件(join(bin目录, ffprobe名)) ? join(bin目录, ffprobe名) : '', ...信息 }
      } catch (错) {
        const 说 = String(错?.message || 错).slice(0, 120)
        错误们.push(`${源.来源}：${说}`)
        记账(`ffmpeg 下载源 ${源.来源} 失败：${说}`)
        try { rmSync(压缩包, { force: true }) } catch (error) {}
        try { rmSync(解压到, { recursive: true, force: true }) } catch (error) {}
        try { rmSync(join(bin目录, ffmpeg名), { force: true }) } catch (error) {}
        try { rmSync(join(bin目录, ffprobe名), { force: true }) } catch (error) {}
      }
    }
    const 说 = `ffmpeg 没装成（${错误们.join('；')}）`
    安装状态 = { 进行中: false, 阶段: '失败', 错: 说, 已下载: 0, 总: 0 }
    throw new Error(说)
  }

  async function 确保安装({ 等毫秒 = 0 } = {}) {
    const 现有 = await 找命令()
    if (现有) return 现有
    const 配置 = 视频配置()
    if (!配置.自动装) return null
    if (!安装任务) {
      安装任务 = 执行安装(配置).finally(() => { 安装任务 = null })
      // 后台任务失败由状态页和调用方各自记账；先挂一个空 catch 防止 unhandled rejection。
      安装任务.catch(() => {})
    }
    if (等毫秒 <= 0) return null
    const 限时 = new Promise((resolve) => setTimeout(() => resolve(null), 等毫秒))
    return Promise.race([安装任务.catch(() => null), 限时])
  }

  async function 占位() {
    if (进行中 < 并发上限) {
      进行中 += 1
      return
    }
    if (排队.length >= 排队上限) throw new Error('视频太多，这一条先跳过')
    // 放位时把名额直接交给排队者，别先减再加，免得两个新来的同时抢进同一格。
    await new Promise((resolve) => 排队.push(resolve))
  }

  function 放位() {
    const 下一个 = 排队.shift()
    if (下一个) 下一个()
    else 进行中 = Math.max(0, 进行中 - 1)
  }

  async function 探时长(ffprobe, 路径) {
    if (!ffprobe) return 0
    try {
      const { stdout } = await 跑(ffprobe, [
        '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', 路径,
      ], { windowsHide: true, timeout: 10_000 })
      const 秒 = Number(String(stdout || '').trim())
      return Number.isFinite(秒) && 秒 > 0 ? 秒 : 0
    } catch (error) {
      return 0
    }
  }

  async function 抽分镜({ bytes, 秒 = 0, 信号 } = {}) {
    if (!bytes || bytes.length === 0) throw new Error('没有视频字节')
    await 占位()
    let 工作 = ''
    try {
      mkdirSync(临时目录, { recursive: true })
      工作 = mkdtempSync(join(临时目录, 'video-'))
      const 命令 = await 找命令()
      if (!命令) throw new Error('ffmpeg 还没准备好')
      const 配置 = 视频配置()
      const 视频路径 = join(工作, 'in.mp4')
      writeFileSync(视频路径, Buffer.from(bytes))
      const 真秒 = Number(秒) > 0 ? Number(秒) : await 探时长(命令.ffprobe, 视频路径)
      let 编码 = 命令.webp编码器 === '' ? 'gif' : 'webp'
      const 试 = (宽) => {
        const 参 = 抽帧参数({
          秒: 真秒, 宽度: 宽, 帧数: 分镜帧数, 上限秒: 配置.最长秒,
          编码, webp编码器: 命令.webp编码器,
        })
        const 出 = join(工作, 编码 === 'gif' ? 'out.gif' : 'out.webp')
        const 参数 = 参.参数.map((x) => x === '{in}' ? 视频路径 : x === '{out}' ? 出 : x)
        return { 参, 出, 参数 }
      }
      const 跑一次 = async (宽) => {
        const { 参, 出, 参数 } = 试(宽)
        await 跑(命令.ffmpeg, 参数, {
          windowsHide: true, timeout: 45_000, killSignal: 'SIGKILL',
          maxBuffer: 2 * 1024 * 1024, signal: 信号,
        })
        if (!是文件(出)) throw new Error('ffmpeg 没有产出文件')
        const data = readFileSync(出)
        const 帧 = 数分镜帧(data)
        return { data, 帧, 参, 出 }
      }
      let 果
      try {
        果 = await 跑一次(配置.宽度)
      } catch (错) {
        if (编码 !== 'webp') throw 错
        // 有些构建认得出 libwebp 却编不出动画：退回 GIF，下游分镜路径完全一样。
        编码 = 'gif'
        果 = await 跑一次(配置.宽度)
      }
      if ((果.data.length > 产物上限 || 果.帧 < 2) && 配置.宽度 > 320) {
        果 = await 跑一次(320)
      }
      if (果.data.length > 产物上限) throw new Error('分镜图太大')
      if (果.帧 < 1) throw new Error('没数出画面帧')
      return {
        data: 果.data,
        mediaType: 编码 === 'gif' ? 'image/gif' : 'image/webp',
        秒: 果.参.秒,
        帧: 果.帧,
        宽: 果.参.宽,
        编码,
      }
    } finally {
      放位()
      if (工作 !== '') {
        try { rmSync(工作, { recursive: true, force: true }) } catch (error) {}
      }
    }
  }

  function 清临时() {
    let 项们 = []
    try {
      项们 = readdirSync(临时目录, { withFileTypes: true })
    } catch (error) {
      return
    }
    const 现在 = Date.now()
    for (const 项 of 项们) {
      const path = join(临时目录, 项.name)
      try {
        if (现在 - statSync(path).mtimeMs > 60 * 60_000) rmSync(path, { recursive: true, force: true })
      } catch (error) {}
    }
  }

  function 状态() {
    const 命令 = 快速找()
    const 用本机元信息 = 命令 && 命令.来源 !== 'PATH' && 命令.来源 !== '配置路径'
    const 信息 = 用本机元信息 ? (元() || {}) : {}
    return {
      启用: 视频配置().启用,
      就绪: !!命令,
      路径: 命令 ? 命令.ffmpeg : '',
      版本: 命令 ? (命令.版本 || 信息.版本 || '') : '',
      来源: 命令 ? (命令.来源 || 信息.来源 || '') : '',
      许可证: 命令 ? (命令.许可证 || 信息.许可证 || '') : '',
      webp编码器: 命令 ? (命令.webp编码器 || 信息.webp编码器 || '') : '',
      安装: { ...安装状态 },
    }
  }

  return { 状态, 找命令, 确保安装, 抽分镜, 清临时, 路径: { 根, bin目录, 临时目录, 元文件 } }
}
