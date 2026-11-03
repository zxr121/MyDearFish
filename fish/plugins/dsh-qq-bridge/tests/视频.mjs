// 「通到 QQ」视频分镜冒烟测试 —— 纯函数 + 解析层 + 没 ffmpeg 时的降级。
// 有 ffmpeg 时再加 QQ_BRIDGE_FFMPEG_TEST=1 跑一次真抽帧。
// 跑法： node tests/视频.mjs
//       QQ_BRIDGE_FFMPEG_TEST=1 node tests/视频.mjs

import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const 家 = mkdtempSync(join(tmpdir(), 'qq-video-'))
process.env.DSH_HOME = 家

let 挂了 = 0
const 报 = (标签, 过, 详情) => { if (!过) 挂了++; console.log(`${过 ? 'PASS' : 'FAIL'}  ${标签}${详情 ? '  :: ' + 详情 : ''}`) }

const 视频 = await import(new URL('../lib/video.js', import.meta.url).href)
const 宿主 = await import(new URL('../lib/host.js', import.meta.url).href + '?v=' + Date.now())

// ---------- 纯函数 ----------
const mp4头 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(8)])
报('MP4 嗅探', 视频.嗅探视频(mp4头) === 'mp4')
报('非 MP4 / 空 / 过短', 视频.嗅探视频(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])) === ''
  && 视频.嗅探视频(new Uint8Array()) === '' && 视频.嗅探视频(Buffer.from('ftyp')) === '')

const 参数28 = 视频.抽帧参数({ 秒: 28 })
报('28 秒 6 帧：均匀抽样、去音频、不读 stdin',
  参数28.秒 === 28 && 参数28.帧数 === 6
  && 参数28.参数.includes('fps=0.214286,scale=480:-2:flags=lanczos')
  && 参数28.参数.includes('-frames:v') && 参数28.参数.includes('6')
  && 参数28.参数.includes('-an') && 参数28.参数.includes('-nostdin')
  && 参数28.参数.includes('-t') && 参数28.参数.includes('28'),
  参数28.参数.join(' '))
报('没时长按 30 秒估，超长夹到 60 秒',
  视频.抽帧参数({ 秒: 0 }).秒 === 30 && 视频.抽帧参数({ 秒: 0 }).估算 === true
  && 视频.抽帧参数({ 秒: 999 }).秒 === 60)
报('宽度取偶', 视频.抽帧参数({ 宽度: 641 }).宽 === 640 && 视频.抽帧参数({ 宽度: 159 }).宽 === 160)
const 参数gif = 视频.抽帧参数({ 秒: 10, 编码: 'gif' })
报('GIF 兜底：调色板滤镜 + gif 输出',
  参数gif.参数.join(' ').includes('palettegen') && 参数gif.参数.includes('-f') && 参数gif.参数.includes('gif'))
const 参数老webp = 视频.抽帧参数({ 秒: 10, 编码: 'webp', webp编码器: 'libwebp' })
报('只认 libwebp 的老构建也能用', 参数老webp.参数.includes('libwebp'))

const btb = `${'a'.repeat(64)}  ffmpeg-master-latest-win64-lgpl.zip\n${'b'.repeat(64)}  other.zip`
报('两列清单按文件名挑摘要',
  视频.摘要行(btb, 'ffmpeg-master-latest-win64-lgpl.zip') === 'a'.repeat(64)
  && 视频.摘要行(btb, 'nope.zip') === '')
报('gyan 单列 hash', 视频.摘要行(`${'c'.repeat(64)}\n`) === 'c'.repeat(64))

const 假gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.from([0x21, 0xf9, 0, 0, 0]), Buffer.from([0x21, 0xf9, 0, 0, 0])])
const 假webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.from('ANMF'), Buffer.from('ANMF')])
报('数帧：GIF / WebP / 静态 PNG',
  视频.数分镜帧(假gif) === 2 && 视频.数分镜帧(假webp) === 2
  && 视频.数分镜帧(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])) === 0)

// ---------- 解析层 ----------
const 段 = 宿主.解析消息段({
  message: [
    { type: 'text', data: { text: '看这个 ' } },
    {
      type: 'video',
      data: {
        file: 'a.mp4', url: 'https://multimedia.nt.qq.com.cn/download?appid=1415',
        duration: 28, width: 640, height: 1164, fileSize: 3233726,
      },
    },
    { type: 'record', data: { file: 'a.amr' } },
  ],
})
报('视频段：正文标 [视频]、留下时长和大小',
  段.文字 === '看这个 [视频][语音]' && 段.视频们.length === 1 && 段.视频们[0].秒 === 28
  && 段.视频们[0].大小 === 3233726, JSON.stringify(段.视频们))

const 表情段 = 宿主.解析消息段({
  message: [
    { type: 'mface', data: { summary: '[商城表情]', url: 'https://gxh.vip.qq.com/x.gif' } },
    { type: 'mface', data: { summary: '[商城表情]' } },
    { type: 'face', data: { id: '1' } },
  ],
})
报('mface：有 QQ 图才收，没图只标 [表情]',
  表情段.图片们.length === 1 && 表情段.图片们[0].subType === 1 && 表情段.图片们[0].商城 === true
  && 表情段.看不见的表情 === 1 && 表情段.文字 === '[表情][表情][表情]',
  JSON.stringify(表情段))

const 转发 = 宿主.转发视频们([
  { user_id: 123, sender: { nickname: '甲' }, message: [{ type: 'video', data: { url: 'https://multimedia.nt.qq.com.cn/x', duration: 10 } }] },
  { user_id: 456, sender: { nickname: '乙' }, message: [{ type: 'video', data: { url: 'https://multimedia.nt.qq.com.cn/y' } }] },
], 123)
报('合并转发只取 1 个视频，并标出主人', 转发.length === 1 && 转发[0].说话人 === '甲' && 转发[0].主人 === true,
  JSON.stringify(转发))

// ---------- 没 ffmpeg 的降级 ----------
writeFileSync(join(家, 'qq-bridge-config.json'), JSON.stringify({
  视频: { 启用: true, 自动装: false, ffmpeg路径: join(家, 'nope.exe') },
}, null, 2), 'utf8')
const 旧PATH = process.env.PATH
process.env.PATH = join(家, 'empty-path')
const 工坊 = 视频.创建视频工坊({
  家目录: 家,
  读配置: () => JSON.parse(readFileSync(join(家, 'qq-bridge-config.json'), 'utf8')),
  记账: () => {},
  平台: 'win32',
})
let 成 = '没返回'
try { 成 = await 工坊.确保安装({ 等毫秒: 50 }) } catch (error) { 成 = `抛错:${error.message}` }
报('没 ffmpeg 且不自动装：返回 null，不抛错', 成 === null, String(成))
let 抽错 = ''
try { await 工坊.抽分镜({ bytes: mp4头 }) } catch (error) { 抽错 = String(error.message || error) }
报('没 ffmpeg 抽帧：明确说还没准备好', 抽错.includes('ffmpeg 还没准备好'), 抽错)
process.env.PATH = 旧PATH

// ---------- 有 ffmpeg 才跑 ----------
if (process.env.QQ_BRIDGE_FFMPEG_TEST === '1') {
  const 命令 = await 工坊.找命令()
  if (!命令) {
    console.log('SKIP  抽帧集成：本机没 ffmpeg')
  } else {
    const 样本 = join(家, 'sample.mp4')
    await new Promise((resolve, reject) => {
      execFile(命令.ffmpeg, [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10', '-t', '4',
        '-pix_fmt', 'yuv420p', 样本,
      ], { windowsHide: true, timeout: 30_000 }, (错) => (错 ? reject(错) : resolve()))
    })
    const 分镜 = await 工坊.抽分镜({ bytes: readFileSync(样本), 秒: 4 })
    报('抽帧集成：6 帧、有产物、临时目录清空',
      分镜.帧 === 6 && 分镜.data.length > 0 && 分镜.data.length <= 6 * 1024 * 1024
      && readdirSync(join(家, 'qq-video', 'tmp')).length === 0,
      `${分镜.帧} 帧 / ${分镜.编码} / ${分镜.data.length} 字节`)
  }
}

rmSync(家, { recursive: true, force: true })
console.log(`\n${挂了 === 0 ? '全部通过 ✅' : `有 ${挂了} 条没过 ❌`}`)
process.exitCode = 挂了 === 0 ? 0 : 1
