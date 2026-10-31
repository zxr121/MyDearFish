// 版本一致性诊断：源码插件和 data/profiles 里实际加载的副本是不是同一份，
// 当前模型/effort 是什么，最近的回复有没有变短。测到旧代码、发错版本时先在这里露出来。
//
// 跑法：
//   node fish/tools/doctor.mjs
//   node fish/tools/doctor.mjs --home C:\\MyDearFish\\data
//   node fish/tools/doctor.mjs --json
// 源码与运行时版本/content hash 不一致时退出码 1；只读，不改任何文件。
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { 列会话, 读日志 } from './session-log.mjs'
import { 分析 } from './conversation-health.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

function 读包(dir) {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    return { name: String(pkg.name || ''), version: String(pkg.version || '') }
  } catch {
    return null
  }
}

function 文件们(dir, base = dir) {
  const out = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'tests') continue
      out.push(...文件们(full, base))
    } else if (entry.isFile()) {
      out.push(full)
    }
  }
  return out.sort()
}

function 内容哈希(dir) {
  const lib = join(dir, 'lib')
  const files = existsSync(lib)
    ? 文件们(lib)
    : existsSync(join(dir, 'cordis.patch.yml'))
      ? [join(dir, 'cordis.patch.yml')]
      : []
  if (files.length === 0) return ''
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(relative(dir, file).replace(/\\/gu, '/'))
    hash.update('\0')
    hash.update(readFileSync(file))
    hash.update('\0')
  }
  return hash.digest('hex').slice(0, 16)
}

function 源码插件们(repo) {
  const plugins = []
  const dir = join(repo, 'fish', 'plugins')
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return plugins
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const full = join(dir, entry.name)
    const pkg = 读包(full)
    if (!pkg || pkg.name === '') continue
    plugins.push({ ...pkg, dir: full, hash: 内容哈希(full) })
  }
  const bundle = join(repo, 'fish', 'bundle')
  const bundlePkg = 读包(bundle)
  if (bundlePkg) plugins.push({ ...bundlePkg, dir: bundle, hash: 内容哈希(bundle) })
  return plugins.sort((a, b) => a.name.localeCompare(b.name))
}

function 运行时插件们(home, plugins) {
  const profilesDir = join(home, 'profiles')
  let profiles = []
  try {
    profiles = readdirSync(profilesDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return { profiles: [], copies: new Map() }
  }
  const copies = new Map()
  for (const plugin of plugins) {
    const perProfile = []
    for (const profile of profiles) {
      const dir = join(profilesDir, profile, 'node_modules', plugin.name)
      if (!existsSync(join(dir, 'package.json'))) continue
      const pkg = 读包(dir)
      if (!pkg) continue
      perProfile.push({ profile, version: pkg.version, hash: 内容哈希(dir) })
    }
    copies.set(plugin.name, perProfile)
  }
  return { profiles, copies }
}

function 解析模型配置(home) {
  const profilesDir = join(home, 'profiles')
  const out = []
  let profiles = []
  try {
    profiles = readdirSync(profilesDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return out
  }
  for (const profile of profiles) {
    for (const name of ['cordis.patch.yml', 'cordis.yml']) {
      const file = join(profilesDir, profile, name)
      if (!existsSync(file)) continue
      const lines = readFileSync(file, 'utf8').split(/\r?\n/u)
      const start = lines.findIndex((line) => /^\s*-\s*id:\s*agent-default-model\s*$/u.test(line))
      if (start < 0) continue
      const block = []
      for (const line of lines.slice(start + 1)) {
        if (/^\s*-\s*id:/u.test(line)) break
        block.push(line)
      }
      const value = (key) => {
        const line = block.find((item) => new RegExp(`^\\s*${key}:\\s*\\S`, 'u').test(item))
        return line ? line.replace(new RegExp(`^\\s*${key}:\\s*`, 'u'), '').replace(/^["']|["']$/gu, '').trim() : ''
      }
      out.push({ profile, provider: value('provider'), model: value('model'), reasoningEffort: value('reasoningEffort') })
    }
  }
  return out
}

function 实际模型(home) {
  const files = 列会话(home)
  for (const { file } of files) {
    try {
      const events = 读日志(file).events
      const headers = events.filter((event) => event && event.type === 'request/header')
      const config = headers.at(-1)?.data?.header?.config
      if (config) {
        return { file, provider: config.provider, model: config.model, reasoningEffort: config.reasoningEffort }
      }
    } catch {}
  }
  return null
}

/**
 * 汇总源码/运行时插件、模型配置和最近的回复长度。
 * @param {string} home - DSH_HOME。
 * @param {string} [repo] - 仓库根目录。
 * @returns {object} 诊断结果，包含每个插件的副本对比与不一致项。
 */
export function 诊断(home, repo = REPO) {
  const 源码 = 源码插件们(repo)
  const { profiles, copies } = 运行时插件们(home, 源码)
  const 插件们 = 源码.map((plugin) => ({
    name: plugin.name,
    version: plugin.version,
    hash: plugin.hash,
    runtime: copies.get(plugin.name) || [],
  }))
  const 不一致 = []
  for (const plugin of 插件们) {
    if (plugin.runtime.length === 0) {
      不一致.push(`${plugin.name}：${profiles.length > 0 ? profiles.join('/') : '没有 profile'} 里找不到运行时副本`)
      continue
    }
    for (const copy of plugin.runtime) {
      if (copy.version !== plugin.version) {
        不一致.push(`${plugin.name}：源码 ${plugin.version}，${copy.profile} 运行时 ${copy.version}`)
      } else if (plugin.hash !== '' && copy.hash !== '' && copy.hash !== plugin.hash) {
        不一致.push(`${plugin.name}：版本同为 ${plugin.version}，但 ${copy.profile} 的 lib 内容和源码不同`)
      }
    }
  }
  const 配置 = 解析模型配置(home)
  const 实际 = 实际模型(home)
  for (const item of 配置) {
    if (实际 && (item.provider !== 实际.provider || item.model !== 实际.model)) {
      不一致.push(`模型：${item.profile} 配置 ${item.provider}/${item.model}，最近一次请求实际 ${实际.provider}/${实际.model}`)
    }
  }
  const 健康 = existsSync(join(home, 'sessions')) ? 分析(home, 14) : null
  return { home, profiles, 插件们, 配置, 实际, 健康, 不一致 }
}

/**
 * 启动日志用的一行诊断：插件版本、模型/effort、近 7 天主人回复中位。
 * @param {string} home - DSH_HOME。
 * @param {string} [repo] - 仓库根目录。
 * @returns {string} 一行话。
 */
export function 诊断一行(home, repo = REPO) {
  const result = 诊断(home, repo)
  const 插件 = result.插件们.map((plugin) => `${plugin.name} ${plugin.version}`).join('、')
  const 配置 = result.配置[0]
  const 模型 = result.实际
    ? `${result.实际.provider}/${result.实际.model}${result.实际.reasoningEffort ? ` · effort ${result.实际.reasoningEffort}` : ''}`
    : 配置
      ? `配置 ${配置.provider}/${配置.model}${配置.reasoningEffort ? ` · effort ${配置.reasoningEffort}` : ''}`
      : '模型未知'
  const 回复 = result.健康 && result.健康.近七天.回复 > 0
    ? `近 7 天主人回复中位 ${result.健康.近七天.字数中位} 字（${result.健康.近七天.回复} 条）`
    : '近 7 天还没有主人回复样本'
  const 告警 = result.不一致.length > 0 ? ` · ⚠️ ${result.不一致.length} 处版本不一致` : ''
  return `诊断：插件 ${插件} · 模型 ${模型} · ${回复}${告警}`
}

function 打表(result) {
  console.log(`源码 / 运行时插件 · ${result.home}`)
  const width = Math.max(12, ...result.插件们.map((plugin) => plugin.name.length))
  console.log(`${'插件'.padEnd(width)} ${'源码'.padEnd(10)} 运行时`)
  for (const plugin of result.插件们) {
    const copies = plugin.runtime.length > 0
      ? plugin.runtime.map((copy) => `${copy.profile} ${copy.version}${copy.version === plugin.version && (plugin.hash === '' || copy.hash === plugin.hash) ? ' ✓' : ' ⚠️'}`).join(' · ')
      : '找不到'
    console.log(`${plugin.name.padEnd(width)} ${plugin.version.padEnd(10)} ${copies}`)
  }
  if (result.配置.length > 0) {
    for (const item of result.配置) {
      console.log(`模型配置 ${item.profile}：${item.provider}/${item.model}${item.reasoningEffort ? ` · effort ${item.reasoningEffort}` : ''}`)
    }
  }
  if (result.实际) {
    console.log(`最近一次请求：${result.实际.provider}/${result.实际.model}${result.实际.reasoningEffort ? ` · effort ${result.实际.reasoningEffort}` : ''}（${result.实际.file}）`)
  } else {
    console.log('最近一次请求：没有找到 request/header')
  }
  if (result.健康) console.log(`近 7 天主人回复：${result.健康.近七天.回复} 条 · 字数中位 ${result.健康.近七天.字数中位} · 推理中位 ${result.健康.近七天.推理中位}`)
  if (result.不一致.length > 0) {
    console.log('\n不一致：')
    for (const line of result.不一致) console.log(`  - ${line}`)
  } else {
    console.log('\n源码和运行时一致 ✅')
  }
}

function 参数(argv) {
  let home = process.env.DSH_HOME || join(process.cwd(), 'data')
  let repo = REPO
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--home') home = argv[++i]
    else if (arg === '--repo') repo = argv[++i]
    else if (arg === '--json') json = true
    else if (arg === '-h' || arg === '--help') {
      console.log('用法：node fish/tools/doctor.mjs [--home <DSH_HOME>] [--repo <仓库根>] [--json]')
      process.exit(0)
    } else {
      console.error(`不认识的参数：${arg}`)
      process.exit(2)
    }
  }
  return { home, repo, json }
}

export function 主(argv = process.argv.slice(2)) {
  const { home, repo, json } = 参数(argv)
  if (!existsSync(home)) {
    console.error(`没有找到数据目录：${home}`)
    process.exit(2)
  }
  const result = { ...诊断(home, repo), home }
  if (json) console.log(JSON.stringify(result, null, 2))
  else {
    console.log('大肥鱼版本诊断')
    打表(result)
  }
  process.exitCode = result.不一致.length > 0 ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) 主()
