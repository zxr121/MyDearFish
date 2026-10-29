#!/usr/bin/env node
// 把 profile 里安装的鱼插件按本地源码重装一遍：pnpm 的 file: 依赖是实体副本，
// git pull 只改源码，不会自动更新 profile/node_modules。
import { cpSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)

function option(name) {
  const i = argv.indexOf(`--${name}`)
  if (i === -1) return ''
  const value = argv[i + 1]
  if (!value || value.startsWith('--')) {
    console.error(`缺少 --${name} 的值`)
    process.exit(2)
  }
  return value
}

function defaultHome() {
  return join(repo, 'data')
}

const home = resolve(option('home') || process.env.DSH_HOME || defaultHome())
const profile = option('profile') || 'web'
const profileDir = join(home, 'profiles', profile)
const profilePkgFile = join(profileDir, 'package.json')

if (!existsSync(profilePkgFile)) {
  console.error(`找不到 profile：${profilePkgFile}`)
  console.error('先启动一次 dsh 创建 profile，或用 --home/--profile 指定。')
  process.exit(2)
}

const localPackages = new Map()
function addPackage(dir) {
  const pkgFile = join(dir, 'package.json')
  if (!existsSync(pkgFile)) return
  try {
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
    if (pkg.name) localPackages.set(pkg.name, { version: pkg.version, dir })
  } catch {
    // 源码清单坏掉时让下面的校验报出来，不在这里吞掉后假装刷新成功
  }
}
for (const dir of readdirSync(join(repo, 'fish', 'plugins'))) {
  addPackage(join(repo, 'fish', 'plugins', dir))
}
addPackage(join(repo, 'fish', 'bundle'))

let profilePkg
try {
  profilePkg = JSON.parse(readFileSync(profilePkgFile, 'utf8'))
} catch (err) {
  console.error(`读不了 ${profilePkgFile}：${err.message}`)
  process.exit(2)
}

const deps = profilePkg.dependencies || {}
const declared = [...localPackages.keys()].filter((name) => deps[name])
if (!declared.length) {
  console.error(`profile 没有声明任何本地鱼插件：${profilePkgFile}`)
  console.error('这个脚本只刷新已用 file:/link: 装进 profile 的插件。')
  process.exit(1)
}

const env = { ...process.env, DSH_HOME: home }
const run = (command, args) => spawnSync(
  process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : command,
  process.platform === 'win32' ? ['/d', '/s', '/c', command, ...args] : args,
  { cwd: profileDir, env, stdio: 'inherit' },
)

console.log(`刷新 ${profileDir}`)
let result = run('pnpm', ['install'])
if (result.error || result.status === 9009 || result.status === 127) {
  console.warn('没找到 pnpm，改用 dsh plugin 安装')
  result = run(process.platform === 'win32' ? 'dsh.cmd' : 'dsh', ['plugin', '--profile', profile, 'install'])
}
if (result.error) {
  console.error(`安装失败：${result.error.code || result.error.message}`)
  process.exit(1)
}
if (result.status !== 0) {
  console.error(`安装失败，退出码 ${result.status}`)
  process.exit(1)
}

let failed = false
for (const name of declared) {
  const source = localPackages.get(name)
  const spec = String(deps[name])
  if (!/^(file|link):/.test(spec)) {
    console.warn(`! ${name}: 依赖规格是 ${spec}，不是本地源码；拉取后不会跟着更新`)
  }
  const installedPkgFile = join(profileDir, 'node_modules', ...name.split('/'), 'package.json')
  if (!existsSync(installedPkgFile)) {
    console.error(`✗ ${name}: 没有装进 node_modules`)
    failed = true
    continue
  }
  try {
    let installed = JSON.parse(readFileSync(installedPkgFile, 'utf8'))
    if (installed.version !== source.version) {
      // pnpm 把 file: 目录依赖按 spec 记进锁文件，源码版本变了也报 already up to date，只能整棵复制
      const targetDir = join(profileDir, 'node_modules', ...name.split('/'))
      rmSync(targetDir, { recursive: true, force: true })
      cpSync(source.dir, targetDir, {
        recursive: true,
        filter: (entry) => !entry.split(sep).includes('node_modules'),
      })
      installed = JSON.parse(readFileSync(installedPkgFile, 'utf8'))
      if (installed.version !== source.version) {
        console.error(`✗ ${name}: 复制后仍是 ${installed.version}，源码 ${source.version}`)
        failed = true
      } else {
        console.log(`✓ ${name} ${installed.version}（源码已整棵复制）`)
      }
      continue
    }
    console.log(`✓ ${name} ${installed.version}`)
  } catch (err) {
    console.error(`✗ ${name}: 读不了安装清单（${err.message}）`)
    failed = true
  }
}

if (failed) process.exit(1)
console.log('已按源码刷新，重启 dsh 后生效。')
