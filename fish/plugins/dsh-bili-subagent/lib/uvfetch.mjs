/**
 * lib/uvfetch.mjs —— 「机器上连 uv 和 Python 都没有」时，**插件自己把 uv 弄到手**
 * ============================================================================
 * 为什么值得单独做：uv 是**单个可执行文件**（Windows 上 ~32MB 的 uv.exe ✓），
 * **解压就能用、不用管理员、不用进 PATH** ✓，而且它还能自己把 Python 拉下来 ✓
 * ⇒ 只要拿到它，"首次安装"就从「先去装个 Python」变成「点一下就好」✓
 *
 * 两个源，按顺序试：
 *   ① **GitHub 官方 release**（`uv-x86_64-pc-windows-msvc.zip`）—— 有加速器时最快 ✓
 *   ② ⭐ **PyPI 清华镜像的 uv wheel** —— wheel 本身就是个 zip，里面装着 `uv.exe` ✓
 *      （国内速度快、不依赖 GitHub ✓）
 *
 * 解压：优先用 **系统自带的 `tar`**（Windows 10+ 的 bsdtar 能直接读 zip ✓），
 *       再退到 `unzip`；然后**在解压出来的整棵树里按文件名找** ✓
 *       —— 不管官方把它放在哪一层都能找着 ✓
 * ============================================================================
 */
import { spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, copyFileSync, chmodSync, rmSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const ASSETS = {
  win32: { name: 'uv-x86_64-pc-windows-msvc.zip', bin: 'uv.exe' },
  darwin: { name: 'uv-aarch64-apple-darwin.tar.gz', bin: 'uv' },
  linux: { name: 'uv-x86_64-unknown-linux-gnu.tar.gz', bin: 'uv' },
}

/** 算一个文件的 sha256 */
function sha256Of(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/**
 * 取"官方期望的 sha256"：
 *   · PyPI wheel：JSON 里自带 `digests.sha256` ✓
 *   · GitHub 资产：同目录下有一份 `<文件名>.sha256` ✓（代理会一起转 ✓）
 * 取不到就返回 null（那时只记一句"未校验"，不拦着）
 */
async function expectedSha(source) {
  if (source.sha) return String(source.sha).toLowerCase()
  try {
    const r = await fetch(source.url + '.sha256')
    if (!r.ok) return null
    const m = /([0-9a-f]{64})/i.exec(await r.text())
    return m ? m[1].toLowerCase() : null
  } catch { return null }
}

/** 在目录树里按文件名找可执行文件（递归） */
export function findBin(name, dir) {
  let entries = []
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return null }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { const hit = findBin(name, p); if (hit) return hit }
    else if (e.name === name) return p
  }
  return null
}

/** 解压一个压缩包并找出目标文件（tar 优先 —— Windows 自带那份能读 zip） */
export function extractArchive(binName, archive, into) {
  const attempts = [['tar', ['-xf', archive, '-C', into]], ['unzip', ['-o', archive, '-d', into]]]
  for (const [cmd, args] of attempts) {
    try {
      const r = spawnSync(cmd, args, { stdio: 'ignore' })
      if (r.status === 0) { const hit = findBin(binName, into); if (hit) return hit }
    } catch { /* 换下一个工具 */ }
  }
  return null
}

/**
 * 确保家目录里有一份可用的 uv，返回它的路径（拿不到就返回 null）。
 * @param {{ dir: string, log?: (m: string) => void }} opts
 */
export async function ensureUv({ dir, log = () => {} }) {
  const a = ASSETS[process.platform] || ASSETS.linux
  const target = join(dir, a.bin)
  if (existsSync(target)) return target

  mkdirSync(dir, { recursive: true })
  const tmp = join(dir, '_tmp')
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })

  // 源按顺序试：直连 → 两个国内能用的 GitHub 加速代理（2026-10-14 实测这两条能出真 zip ✓）
  //          → 最后兜底是 PyPI 镜像上的 uv wheel（⚠️ 那个停在 0.2.33/2024-08，能用但不是最新 ✗）
  const asset = `https://github.com/astral-sh/uv/releases/latest/download/${a.name}`
  const sources = [
    { label: 'GitHub 直连', url: asset, file: join(tmp, a.name) },
    { label: 'GitHub 加速代理 gh-proxy.com', url: `https://gh-proxy.com/${asset}`, file: join(tmp, a.name) },
    { label: 'GitHub 加速代理 ghproxy.net', url: `https://ghproxy.net/${asset}`, file: join(tmp, a.name) },
  ]
  if (process.platform === 'win32') {
    try {
      const r = await fetch('https://pypi.tuna.tsinghua.edu.cn/pypi/uv/json')
      const j = await r.json()
      // ⚠️ PyPI 的 urls 顺序**不保证最新在前** ⇒ 必须按版本号自己排序挑最新（踩过：取到了 0.2.33 的老版本 ✗）
      const verOf = (name) => { const m = /-(\d+\.\d+\.\d+(?:[.-][0-9A-Za-z.]+)?)-py3-none-win_amd64\.whl$/.exec(String(name)); return m ? m[1] : '0.0.0' }
      const cmpVer = (a, b) => {
        const A = verOf(a).split(/[.-]/).map(Number), B = verOf(b).split(/[.-]/).map(Number)
        for (let i = 0; i < 4; i++) { if ((A[i] || 0) !== (B[i] || 0)) return (B[i] || 0) - (A[i] || 0) }
        return 0
      }
      const w = (j.urls || [])
        .filter((u) => /win_amd64\.whl$/.test(String(u.filename)))
        .sort((x, y) => cmpVer(x.filename, y.filename))[0]
      if (w?.url) {
        sources.push({ label: 'PyPI 清华镜像（uv wheel）', url: w.url, file: join(tmp, String(w.filename)), sha: w.digests?.sha256 })
        log(`  （备选源已就绪：${w.filename}）`)
      }
    } catch (e) {
      log(`  列 PyPI 版本时出错（不影响，继续试别的源）：${e?.message ?? e}`)
    }
  }

  for (const s of sources) {
    try {
      log(`正在下载 uv —— ${s.label}`)
      const res = await fetch(s.url)
      if (!res.ok) { log(`  → 返回 ${res.status}，换下一个源`); continue }
      await pipeline(Readable.fromWeb(res.body), createWriteStream(s.file))
      const mb = (statSync(s.file).size / 1048576).toFixed(1)
      log(`  → 下载完成 ${mb} MB`)
      // ⭐ 完整性校验：下载下来是要**被执行**的，必须跟官方 sha256 对上（防的是第三方代理动过包 ✗）
      const want = await expectedSha(s)
      if (want) {
        const gotSha = sha256Of(s.file)
        if (gotSha !== want) {
          log(`  → ⚠️ sha256 校验不过（期望 ${want.slice(0, 12)}… 实际 ${gotSha.slice(0, 12)}…）⇒ 丢弃这个源`)
          continue
        }
        log('  → 官方 sha256 校验通过 ✓')
      } else {
        log('  → 没取到官方 sha256，跳过校验（下载来自 HTTPS 的官方地址时风险很小）')
      }
      log('  → 开始解压')
      const hit = extractArchive(a.bin, s.file, tmp)
      if (!hit) { log('  → 解压后没找到可执行文件，换下一个源'); continue }
      copyFileSync(hit, target)
      try { chmodSync(target, 0o755) } catch { /* Windows 上不需要 */ }
      try {
        const r = spawnSync(target, ['--version'], { stdio: 'ignore' })
        log('  → 版本检查：' + (r.status === 0 ? '能跑 ✓' : '跑不起来 ✗'))
      } catch { /* 跑不起来也别拦着，后面自己会报错 */ }
      rmSync(tmp, { recursive: true, force: true })
      log(`  → uv 已就位：${target}`)
      return target
    } catch (e) {
      log(`  → ${s.label} 失败：${e?.message ?? e}`)
    }
  }

  rmSync(tmp, { recursive: true, force: true })
  log('所有源都拿不到 uv（大概是网络到不了 GitHub / PyPI 镜像）')
  return null
}
