// Capability Broker：每一次工具调用都先过这里。
//
// 默认姿势：
//   · 本机私密信息和凭据是硬拒绝，跟 permissions.enabled 无关，也不弹审批。
//   · 外部 MCP 工具只有只读白名单里的能放行；发送、撤回、群管理一律硬拒绝。
//   · 用户自己开的会话 —— 正常放行；但 DSH 目录、凭据目录、身份文件、
//     探测本机的命令、不可逆的危险命令，以及参数里夹带真凭据的调用，一律拒绝。
//   · 开发者模式（主人从设置页打开）—— 她自己的前台会话可以用读类工具和只读 shell
//     命令查看 DSH 目录里的日志、配置和会话；凭据、身份文件、写入和群聊会话照旧拒绝。
//   · 她自己在后台开的会话 —— 默认全拒，只放行显式 allowTools，而且只能碰鱼脑目录。
//   · 紧急停止 —— 所有工具调用全拒，聊天本身还在。
//
// Windows 的 sandbox 只限制写，不限制读和网络，所以「读」这一半必须在这里拦。
// 这里不是内核级沙箱：它拦得住正常调用，拦不住故意混淆的 shell。README 写清了边界。

import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expandPath } from './config.js'
import { summarize } from './sanitize.js'

const SHELL_TOOLS = new Set(['bash', 'pwsh'])
const WRITE_TOOLS = new Set(['write', 'edit'])
// 她替主人改行为设置的工具：读不限制，写要开发者模式。
const FISH_CONFIG_TOOL = 'fish_config'
// 开发者模式放行这些纯读工具；shell 另行走下面的只读命令白名单，编辑器一类不走这个口子。
const READ_TOOLS = new Set(['read', 'glob', 'grep', 'read_image'])
// 开发者模式里额外放行的只读 shell：命令名必须在白名单里，重定向、脚本块、
// 调用运算符、方法调用和未知子命令一律算写入。只能挡住正常写法，挡不住刻意混淆。
const PWSH_READ_COMMANDS = new Set([
  'get-childitem', 'gci', 'ls', 'dir', 'tree',
  'get-content', 'gc', 'cat', 'type',
  'get-item', 'gi',
  'select-string', 'sls', 'findstr',
  'get-filehash', 'get-date',
  'sort-object', 'select-object',
  'format-table', 'ft', 'format-list', 'fl', 'format-wide', 'fw',
  'out-string', 'measure-object', 'measure', 'where-object', 'group-object', 'compare-object',
  'test-path', 'resolve-path', 'get-location', 'pwd',
  'write-output', 'write-host', 'echo',
])
const BASH_READ_COMMANDS = new Set([
  'ls', 'cat', 'head', 'tail', 'wc', 'stat', 'du',
  'grep', 'findstr', 'cut', 'tree',
  'pwd', 'echo', 'printf', 'realpath', 'readlink', 'md5sum', 'sha1sum', 'sha256sum',
])
const READ_COMMANDS = new Map([
  ['pwsh', PWSH_READ_COMMANDS],
  ['bash', BASH_READ_COMMANDS],
])
const PATH_KEYS = [
  'file_path',
  'path',
  'cwd',
  'workdir',
  'directory',
  'target',
  'source',
  'destination',
  'old_path',
  'new_path',
  'output_path',
  'input_path',
]

// 这些不是“问一下”的路径，是账号和部署信息的所在地：读到就等于拿到钥匙。
const HOME_IDENTITY_FILES = [
  '.gitconfig',
  '.bash_history',
  '.zsh_history',
  '.python_history',
  '.psql_history',
  '.wget-hsts',
  '.lesshst',
  '.viminfo',
  '.netrc',
  '.git-credentials',
  '.npmrc',
  '.pypirc',
  '.m2/settings.xml',
  '.gradle/gradle.properties',
  '.terraform.d/credentials.tfrc.json',
  '.config/git/config',
  '.config/gh/hosts.yml',
  '.azure',
  '.config/gcloud',
]

const SYSTEM_IDENTITY_FILES = [
  '/etc/passwd',
  '/etc/shadow',
  '/etc/hostname',
  '/etc/machine-id',
  '/etc/hosts',
  '/proc/self/environ',
  'C:\\Windows\\System32\\config\\SAM',
  'C:\\Windows\\System32\\config\\SECURITY',
  'C:\\Windows\\System32\\config\\SYSTEM',
  'C:\\Windows\\System32\\drivers\\etc\\hosts',
]

// 只认“命令本身就在探测本机”的写法，不因为脚本里出现一个词就拒绝。
const HARD_COMMAND_PATTERNS = [
  /^(?:sudo\s+)?(?:hostname|whoami|id|ipconfig|ifconfig|getmac|arp|nbtstat|route|systeminfo|msinfo32|dxdiag|printenv|env|set|ps|tasklist|net\s+user|net\s+localgroup|cmdkey|vaultcmd)(?=\s|$)/i,
  /^(?:sudo\s+)?security\s+find-(?:generic|internet)-password\b/i,
  /^(?:sudo\s+)?git\s+config\s+(?:--global\s+)?user\.(?:email|name)\b/i,
  /^(?:sudo\s+)?(?:gh\s+auth\s+token|npm\s+whoami|aws\s+configure\s+list|aws\s+sts\s+get-caller-identity|az\s+account\s+show|gcloud\s+config\s+list|kubectl\s+config\s+view|docker\s+info)\b/i,
  /Get-ComputerInfo\b|wmic\s+(?:computersystem|os|bios|csproduct|useraccount)\b|Get-LocalUser\b|Get-StoredCredential\b|Get-ChildItem\s+env:|\benv:\w/i,
  /reg\s+(?:query|export)\s+[^\n]*(?:HKLM|HKCU|SAM|SECURITY)/i,
  /(?:curl|wget|Invoke-WebRequest|iwr)\s+[^\n]*(?:ifconfig\.me|ipinfo\.io|ip-api\.com|whatismyip|checkip)/i,
  /(?:cat|type|Get-Content|head|tail|more)\s+[^\n]*(?:\.bash_history|\.zsh_history|\.python_history|\.psql_history|\.gitconfig|\.config[\\/]gh|hosts|passwd|shadow)/i,
  /(?:echo|printf|Write-Output|Write-Host)\b[^\n]*(?:%USERNAME%|%COMPUTERNAME%|\$env:USERNAME|\$env:COMPUTERNAME|\$USER\b|\$HOME\b|\$env:USERPROFILE)/i,
  /(?:^|[\s"'`])(?:ls|dir|Get-ChildItem|find)\s+(?:~|\$HOME|%USERPROFILE%|["']?[A-Za-z]:[\\/]Users[\\/][^\\/\s"']+["']?)(?:\s|$)/i,
  /\bos\.hostname\s*\(|\bos\.userInfo\s*\(|\bprocess\.env\.USERNAME\b/i,
  // 直接引用敏感环境变量（回显、拼进命令、从 node/python 里读）等同于把密钥交出来。
  /(?:\$env:|\$|%|env:)[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)[A-Z0-9_]*(?:%|\b)/i,
  /\bprocess\.env(?:\.[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)[A-Z0-9_]*|\[['"`]?[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)[A-Z0-9_]*['"`]?\])/i,
  /\bos\.environ(?:\.get\s*\(\s*|\[\s*)['"][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)[A-Z0-9_]*['"]|os\.getenv\s*\(\s*['"][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)[A-Z0-9_]*['"]/i,
]

// 不可逆或明显越界的高风险命令：删根、格式化、覆盖磁盘、关机、下载即执行、
// 破坏启动配置或关掉安全防护。和“探测本机”不同，这些动作一旦执行就收不回来。
const DANGEROUS_COMMAND_PATTERNS = [
  /^(?:sudo\s+)?rm\s+(?:-[A-Za-z]+\s+)*(?:--[A-Za-z-]*\s+)*(?:["']?(?:\/\*?|~\/?\*?|\$HOME\/?\*?|\$\{HOME\}\/?\*?|\$env:HOME\/?\*?|%USERPROFILE%[\\/]?\*?|[A-Za-z]:(?:[\\/]\*?)?|\.\.?\/?\*?)["']?[\\/]?\*?)(?:\s|;|&|\||$)/i,
  /^(?:sudo\s+)?rm\s+(?:-[A-Za-z]+\s+)*(?:--[A-Za-z-]*\s+)*["']?\/(?:etc|usr|bin|sbin|lib|lib64|boot|var|opt|home|root|sys|proc|dev)(?:\/\*?)?["']?(?:\s|;|&|\||$)/i,
  /^(?:sudo\s+)?find\s+["']?(?:\/|~|\$HOME|\$\{HOME\}|\$env:HOME|%USERPROFILE%|\/(?:etc|usr|bin|sbin|lib|lib64|boot|var|opt|home|root|sys|proc|dev))["']?(?:\s|$)[^\n]*-delete\b/i,
  /^(?:sudo\s+)?(?:mkfs(?:\.[\w-]+)?|mkswap|wipefs|fdisk|sfdisk|parted|blkdiscard)\b/i,
  /\bof=\/dev\/(?:sd|nvme|hd|vd|xvd|mmcblk|disk)/i,
  /^(?:sudo\s+)?(?:shutdown|reboot|halt|poweroff)\b/i,
  /:\s*\(\s*\)\s*\{[^}]*:\s*\|\s*:[^}]*\}/,
  /^(?:sudo\s+)?kill\s+(?:-[A-Za-z]+\s+)*-1\b/i,
  /^(?:sudo\s+)?killall5\b/i,
  /^(?:sudo\s+)?ch(?:mod|own)\s+(?:-[A-Za-z]+\s+)*(?:[0-7]{3,4}|[^\s]+)\s+\/(?:\s|$)/i,
  /(?:^|[\s;&|])>\s*\/dev\/(?:sd|nvme|hd|vd|xvd|mmcblk|disk)/i,
  /\btee\s+\/dev\/(?:sd|nvme|hd|vd|xvd|mmcblk|disk)/i,
  // 下载后直接执行：注入最常用的落地方式。
  /\b(?:curl|wget)\b[^\n|;]*\|\s*(?:sudo\s+)?(?:ba|z|k|da|fi)?sh\b/i,
  /\b(?:curl|wget)\b[^\n|;]*\|\s*(?:sudo\s+)?(?:python[0-9.]*|node|perl|ruby|php|powershell|pwsh)\b/i,
  /\b(?:iwr|Invoke-WebRequest|curl|wget)\b[^\n;]*\|\s*(?:iex|Invoke-Expression)\b/i,
  /\b(?:iex|Invoke-Expression)\s*\(\s*(?:New-Object\s+(?:Net|System\.Net)\.WebClient|iwr|Invoke-WebRequest|curl|wget)\b/i,
  // 编码/隐藏的 PowerShell 和系统自带下载器。
  /\b(?:powershell|pwsh)(?:\.exe)?\b[^\n]*(?:-enc(?:odedcommand)?\s+|-e\s+[A-Za-z0-9+/=]{20,})/i,
  /\b(?:certutil(?:\.exe)?\s+-urlcache|bitsadmin(?:\.exe)?\s+\/transfer|mshta(?:\.exe)?\s+https?:|regsvr32(?:\.exe)?\s+[^\n]*\/i:https?:)/i,
  /\b(?:nc|ncat|netcat)\b[^\n]*(?:-e\s|\/c\s)/i,
  /\bsocat\b[^\n]*\bexec:/i,
  /\b(?:bash|sh)\s+-i\s+[^\n]*>\s*&\s*\/dev\/tcp\//i,
  // 删卷影副本、破坏启动配置、清日志：勒索软件和掩盖痕迹的典型动作。
  /\bvssadmin(?:\.exe)?\s+delete\s+shadows\b/i,
  /\bwbadmin(?:\.exe)?\s+delete\s+(?:catalog|systemstatebackup)\b/i,
  /\bbcdedit(?:\.exe)?\s+\/set\b[^\n]*\b(?:recoveryenabled|bootstatuspolicy)\b/i,
  /\bbcdedit(?:\.exe)?\s+\/delete\b/i,
  /\bwevtutil(?:\.exe)?\s+cl\b/i,
  // Windows 盘符/主目录/当前目录的格式化或递归删除。
  /^(?:format(?:\.com)?\s+[A-Za-z]:|diskpart\b)/i,
  /(?:^|[\s;&|])(?:del|erase)(?:\.exe)?\s+(?:\/[A-Za-z]+\s+)*(?:"?(?:[A-Za-z]:(?:[\\/]\*?)?|~[\\/]?\*?|\$HOME[\\/]?\*?|\$env:USERPROFILE[\\/]?\*?|%USERPROFILE%[\\/]?\*?|\.\.?[\\/]?\*?)"?[\\/]?\*?)(?:\s|$)/i,
  /(?:^|[\s;&|])(?:rd|rmdir)(?:\.exe)?\s+\/s\s+(?:\/q\s+)?(?:"?(?:[A-Za-z]:(?:[\\/]\*?)?|~[\\/]?\*?|\$HOME[\\/]?\*?|\$env:USERPROFILE[\\/]?\*?|%USERPROFILE%[\\/]?\*?|\.\.?[\\/]?\*?)"?[\\/]?\*?)(?:\s|$)/i,
  /\bRemove-Item\b[^\n]*(?:-Recurse\b[^\n]*-Force|-Force\b[^\n]*-Recurse)[^\n]*\s(?:"?(?:[A-Za-z]:(?:[\\/]\*?)?|~[\\/]?\*?|\$HOME[\\/]?\*?|\$env:USERPROFILE[\\/]?\*?|\$env:SystemDrive[\\/]?\*?|%USERPROFILE%[\\/]?\*?|\.\.?[\\/]?\*?)"?[\\/]?\*?)(?:\s|$)/i,
  /\b(?:Clear-Disk|Initialize-Disk|Format-Volume)\b/i,
  // 关掉系统防火墙或实时防护。
  /\bnetsh(?:\.exe)?\s+advfirewall\s+set\b[^\n]*\bstate\s+off\b/i,
  /\bSet-NetFirewallProfile\b[^\n]*(?:-Enabled\s+(?:False|\$false|0))/i,
  /\bSet-MpPreference\b[^\n]*-Disable(?:RealtimeMonitoring|BehaviorMonitoring|IOAVProtection)\b/i,
]

function canonical(pathValue) {
  let current = resolve(pathValue)
  const tail = []
  for (let depth = 0; depth < 64; depth += 1) {
    try {
      const real = realpathSync.native(current)
      return tail.length === 0 ? real : join(real, ...tail.reverse())
    } catch {
      const parent = dirname(current)
      if (parent === current) return resolve(pathValue)
      tail.push(basename(current))
      current = parent
    }
  }
  return resolve(pathValue)
}

function fold(pathValue) {
  const normalized = canonical(pathValue)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function isInside(candidate, root) {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel))
}

function compileNamePattern(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`, process.platform === 'win32' ? 'i' : '')
}

/** 取一段 shell 的命令名；空串表示这一段不是命令（整段都在引号里）。 */
function shellVerbOf(segment) {
  const match = /^\S+/.exec(segment)
  if (match === null) return ''
  const token = match[0].toLowerCase()
  if (token.includes('/') || token.includes('\\') || token.includes(':') || token.startsWith('$') || token.startsWith('%')) return ''
  return token.replace(/\.exe$/, '')
}

/** 从 `$(` 的括号开始找配对的 `)`；找不到返回 null。 */
function extractSubcommand(command, openIndex) {
  let depth = 1
  let quote = ''
  let index = openIndex + 1
  const start = index
  while (index < command.length) {
    const char = command[index]
    if (quote === "'") {
      if (char === "'") quote = ''
      index += 1
      continue
    }
    if (quote === '"') {
      if (char === '"') quote = ''
      else if (char === '`') index += 1
      index += 1
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      index += 1
      continue
    }
    if (char === '(') {
      depth += 1
      index += 1
      continue
    }
    if (char === ')') {
      depth -= 1
      if (depth === 0) return { inner: command.slice(start, index), next: index + 1 }
      index += 1
      continue
    }
    index += 1
  }
  return null
}

/**
 * 把 shell 命令拆成可检查的段；引号里的文字不算命令，`$(...)` 和反引号里的内容单独递归检查。
 * 返回 null 表示写法不对或包含不安全的结构。
 */
function shellSegments(command, shell, depth) {
  const segments = []
  let bare = ''
  let quote = ''
  let index = 0
  const push = () => {
    const segment = bare.trim()
    if (segment !== '') segments.push(segment)
    bare = ''
  }
  while (index < command.length) {
    const char = command[index]
    if (quote === "'") {
      if (char === "'") {
        quote = ''
        bare += ' '
      }
      index += 1
      continue
    }
    if (quote === '"') {
      if (char === '"') {
        quote = ''
        bare += ' '
        index += 1
        continue
      }
      if (char === '`') {
        if (shell === 'pwsh') {
          index += 2
          continue
        }
        const end = command.indexOf('`', index + 1)
        if (end < 0 || !isReadOnlyShellCommand(command.slice(index + 1, end), shell, depth + 1)) return null
        index = end + 1
        continue
      }
      if (char === '$' && command[index + 1] === '(') {
        const sub = extractSubcommand(command, index + 1)
        if (sub === null || !isReadOnlyShellCommand(sub.inner, shell, depth + 1)) return null
        index = sub.next
        continue
      }
      index += 1
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      index += 1
      continue
    }
    if (char === '`') {
      if (shell === 'pwsh') {
        index += 2
        continue
      }
      const end = command.indexOf('`', index + 1)
      if (end < 0 || !isReadOnlyShellCommand(command.slice(index + 1, end), shell, depth + 1)) return null
      index = end + 1
      continue
    }
    if (char === '$' && command[index + 1] === '(') {
      const sub = extractSubcommand(command, index + 1)
      if (sub === null || !isReadOnlyShellCommand(sub.inner, shell, depth + 1)) return null
      index = sub.next
      continue
    }
    if (char === ';' || char === '\n' || char === '\r' || char === '|') {
      push()
      index += char === '|' && command[index + 1] === '|' ? 2 : 1
      continue
    }
    if (char === '&') {
      if (command[index + 1] === '&') {
        push()
        index += 2
        continue
      }
      return null
    }
    if (char === '>' || char === '<' || char === '{' || char === '}' || char === '(' || char === ')') return null
    bare += char
    index += 1
  }
  if (quote !== '') return null
  push()
  return segments
}

/** 判断一条 shell 命令是不是只有白名单里的读取命令和它们之间的管道。 */
function isReadOnlyShellCommand(command, shell, depth = 0) {
  if (typeof command !== 'string' || command.trim() === '') return false
  if (depth > 8) return false
  const allowed = READ_COMMANDS.get(shell)
  if (allowed === undefined) return false
  const segments = shellSegments(command, shell, depth)
  if (segments === null) return false
  for (const segment of segments) {
    const verb = shellVerbOf(segment)
    if (!allowed.has(verb)) return false
    // GNU sort / tree 的 -o 会把结果写进文件；这两个命令只放行不带输出的写法。
    if ((verb === 'sort' || verb === 'tree') && /(?:^|\s)(?:-o|--output)(?:\s|=|$)/i.test(segment)) return false
  }
  return true
}

const MCP_TOOL_PREFIX = /^mcp__([A-Za-z0-9_-]{1,32})__(.+)$/

/** `mcp__tulpa__get_messages` → `{ server: 'tulpa', tool: 'get_messages' }`；不是 MCP 工具返回 null。 */
function parseMcpTool(name) {
  const m = MCP_TOOL_PREFIX.exec(typeof name === 'string' ? name : '')
  return m === null ? null : { server: m[1], tool: m[2] }
}

function collectStrings(value, out, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return
  if (typeof value === 'string') {
    out.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out, depth + 1)
    return
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, out, depth + 1)
  }
}

/**
 * 权限判定器。构造时把配置里的路径展开、规范化一次。
 * @param {object} options - `{ config, dshHome, audit, diag, privacy, isOwnerSession }`；
 *   `isOwnerSession(exec)` 判断这次调用是不是主人自己的前台会话（非群聊、非子代理）。
 * @returns {object} 判定器。
 */
export function createBroker({
  config,
  dshHome,
  audit = () => {},
  diag = () => {},
  privacy = null,
  isOwnerSession = () => false,
}) {
  const readRoots = config.permissions.protectedReadPaths
    .map((value) => expandPath(value, { dshHome }))
    .map(fold)
  const writeRoots = config.permissions.protectedWritePaths
    .map((value) => expandPath(value, { dshHome }))
    .map(fold)
  const namePatterns = config.permissions.protectedNamePatterns.map((pattern) => ({
    pattern,
    regex: compileNamePattern(pattern),
    suffix: pattern.startsWith('*') ? pattern.slice(1) : null,
  }))
  const mcpReadOnly = config.permissions.mcpReadOnlyTools.map((pattern) => ({
    pattern,
    regex: compileNamePattern(pattern),
  }))
  const mindRoot = fold(join(dshHome, 'fish-mind'))
  // 鱼脑自己的代码同样是固定内核：私设、安全规则、隐私规则和权限规则都写在这里。
  // 工具能改源码就等于能改自己的出生和笼子，所以源码和鱼脑数据一样只读。
  const sourceRoot = fold(join(fileURLToPath(new URL('..', import.meta.url)), 'lib'))
  // 鱼脑目录里的预算、配置、经历、账本和以后的核心只能由内部流程写。
  // 工具写进去就等于她可以改自己的额度和记忆，必须硬拒，不能只弹审批。
  const sealedRoots = [mindRoot, sourceRoot]
  const dshRoot = fold(dshHome)
  // 这些探针只代表“命令提到了 DSH 目录本身”；开发者模式的只读命令可以放过它们，
  // 凭据、身份文件和敏感文件名的探针仍然照常拒绝。
  const dshProbes = new Set([dshRoot, dshRoot.split(sep).join('/'), dshRoot.split('/').join(sep)])
  if (basename(dshRoot).startsWith('.')) dshProbes.add(basename(dshRoot))
  const homeRoot = fold(homedir())
  const protectedRoots = [...new Set([...readRoots, ...writeRoots])]
  const identityPaths = new Set(HOME_IDENTITY_FILES.map((file) => fold(join(homedir(), file))))
  const hardProbes = new Set()

  const addProbe = (value) => {
    if (typeof value !== 'string' || value.length < 4) return
    hardProbes.add(value)
    hardProbes.add(value.split(sep).join('/'))
    hardProbes.add(value.split('/').join(sep))
  }
  addProbe(dshRoot)
  for (const root of protectedRoots) {
    addProbe(root)
    const base = basename(root)
    if (base.startsWith('.')) addProbe(base)
  }
  for (const file of HOME_IDENTITY_FILES) {
    addProbe(join(homedir(), file))
    addProbe(`~/${file}`)
    // `.config/git/config` 的 basename 是 `config`；把这么泛的词当探针会误伤
    // 所有带 config 的正常命令，所以只有主目录下的点文件才按名字探。
    if (!file.includes('/')) addProbe(basename(file))
  }
  for (const file of SYSTEM_IDENTITY_FILES) addProbe(file)
  for (const item of namePatterns) addProbe(item.suffix || item.pattern)

  const autonomousRoots = config.permissions.autonomous.allowPaths
    .map((value) => expandPath(value, { dshHome }))
    .map(fold)
  const autonomousTools = new Set(config.permissions.autonomous.allowTools)
  const autonomousSessions = new Set()

  /** 返回规则名；空串表示可以继续走后面的策略。 */
  function privatePathRule(pathValue) {
    const target = fold(pathValue)
    if (isInside(target, dshRoot)) return 'private.dsh-home'
    if (target === homeRoot) return 'private.home-root'
    if (protectedRoots.some((root) => isInside(target, root))) return 'private.credential-store'
    // `.azure`、`.config/gcloud` 是目录，里面的文件同样算身份凭据。
    for (const identity of identityPaths) {
      if (isInside(target, identity)) return 'private.identity-file'
    }
    const name = basename(target)
    if (namePatterns.some((item) => item.regex.test(name))) return 'private.credential-file'
    const raw = String(pathValue).replace(/\\/g, '/').toLowerCase()
    if (SYSTEM_IDENTITY_FILES.some((file) => raw === file.replace(/\\/g, '/').toLowerCase())) return 'private.identity-file'
    return ''
  }

  /**
   * 开发者模式下 DSH 目录里的路径按只读放行，但凭据、身份文件和敏感文件名照旧拒绝。
   * 返回规则名；空串表示可以当作普通调试资料读取。
   */
  function developerPathRule(pathValue) {
    const target = fold(pathValue)
    if (protectedRoots.some((root) => isInside(target, root))) return 'private.credential-store'
    for (const identity of identityPaths) {
      if (isInside(target, identity)) return 'private.identity-file'
    }
    const name = basename(target)
    if (namePatterns.some((item) => item.regex.test(name))) return 'private.credential-file'
    const raw = String(pathValue).replace(/\\/g, '/').toLowerCase()
    if (SYSTEM_IDENTITY_FILES.some((file) => raw === file.replace(/\\/g, '/').toLowerCase())) return 'private.identity-file'
    return ''
  }

  function privateReasonOf(rule) {
    switch (rule) {
      case 'private.dsh-home':
        return 'DSH 目录里有配置、凭据和会话，工具不能读也不能写。要查看请主人在设置里打开开发者模式，或自己打开文件。'
      case 'private.home-root':
        return '不能列出主人主目录；要做什么就指定具体文件。'
      case 'private.credential-store':
        return '这里属于账号、密钥或浏览器凭据，鱼脑不能读取或带出。'
      case 'private.credential-file':
        return '这是凭据文件，鱼脑不能读取或带出。'
      case 'private.identity-file':
        return '这是本机身份/账号文件，鱼脑不能读取。'
      case 'private.command':
        return '这条命令会探测本机身份、账号或网络信息，鱼脑不能执行。'
      case 'private.credential-argument':
        return '工具参数里出现了账号、密码或密钥，鱼脑不会搬运这类秘密。'
      default:
        return '这类本机私密信息不能通过工具读取或带出。'
    }
  }

  function shellTouchesRoot(command, root) {
    if (typeof command !== 'string' || command === '') return false
    const windows = process.platform === 'win32'
    const haystack = windows ? command.toLowerCase() : command
    const variants = new Set([root, root.split(sep).join('/'), root.split('/').join(sep)])
    for (const variant of variants) {
      if (variant.length > 3 && haystack.includes(windows ? variant.toLowerCase() : variant)) return true
    }
    return false
  }

  function shellTouchesPrivate(command, ignoreDshHome = false) {
    if (typeof command !== 'string' || command === '') return false
    const windows = process.platform === 'win32'
    const haystack = windows ? command.toLowerCase() : command
    for (const probe of hardProbes) {
      if (ignoreDshHome && dshProbes.has(probe)) continue
      if (probe.length > 3 && haystack.includes(windows ? probe.toLowerCase() : probe)) return true
    }
    return false
  }

  function isPrivateCommand(command, ignoreDshHome = false) {
    if (typeof command !== 'string' || command === '') return false
    if (shellTouchesPrivate(command, ignoreDshHome)) return true
    const segments = command
      .split(/(?:&&|\|\||[;|\n]|\$\(|`)/)
      .map((segment) => segment.trim())
      .filter(Boolean)
    for (const segment of segments) {
      if (HARD_COMMAND_PATTERNS.some((pattern) => pattern.test(segment))) return true
    }
    // 命令被包在 pwsh -Command、node -e 里时，看整条原文。
    return /\b(?:whoami|hostname|ipconfig|ifconfig|getmac|systeminfo|msinfo32|dxdiag|printenv|Get-ComputerInfo|Get-LocalUser|Get-StoredCredential|%USERNAME%|%COMPUTERNAME%|\$env:USERNAME|\$env:COMPUTERNAME|\$env:USERPROFILE|os\.hostname\s*\(|os\.userInfo\s*\()/i.test(command)
  }

  /** 危险命令既看整条（管道下载执行），也看拆分后的每一段（命令位置）。 */
  function isDangerousCommand(command) {
    if (typeof command !== 'string' || command === '') return false
    if (DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(command))) return true
    const segments = command
      .split(/(?:&&|\|\||[;|\n]|\$\(|`)/)
      .map((segment) => segment.trim())
      .filter(Boolean)
    return segments.some((segment) => DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(segment)))
  }

  /** 从调用参数里找路径和 shell 命令。 */
  function inspect(exec) {
    const args = exec && typeof exec.arguments === 'object' && exec.arguments !== null ? exec.arguments : {}
    const cwd = exec?.agent?.session?.header?.cwd
    const base = typeof cwd === 'string' && cwd !== '' ? cwd : process.cwd()
    const paths = []
    for (const key of PATH_KEYS) {
      const value = args[key]
      if (typeof value === 'string' && value.trim() !== '') {
        const expanded = expandPath(value, { dshHome })
        paths.push(isAbsolute(expanded) ? expanded : resolve(base, expanded))
      }
    }
    const commands = []
    if (SHELL_TOOLS.has(exec?.name) && typeof args.command === 'string') commands.push(args.command)
    const strings = []
    collectStrings(args, strings)
    const write = WRITE_TOOLS.has(exec?.name) || SHELL_TOOLS.has(exec?.name)
    // 开发者模式只给主人自己的前台会话开一条只读缝：群聊、子代理、后台会话都不算。
    const developerRead = config.developer.enabled === true
      && READ_TOOLS.has(exec?.name)
      && originOf(exec) === 'foreground'
      && isOwnerSession(exec) === true
    // shell 也只放行白名单里的读取命令，而且必须确实在查 DSH 或鱼脑目录；
    // 写入型命令继续走 sealed / private 硬拒绝。
    const developerShellRead = config.developer.enabled === true
      && SHELL_TOOLS.has(exec?.name)
      && originOf(exec) === 'foreground'
      && isOwnerSession(exec) === true
      && commands.length > 0
      && commands.every((command) => isReadOnlyShellCommand(command, exec.name))
      && commands.some((command) => shellTouchesRoot(command, dshRoot) || sealedRoots.some((root) => shellTouchesRoot(command, root)))

    let privatePath = null
    let privateRule = ''
    for (const pathValue of paths) {
      let rule = privatePathRule(pathValue)
      if (rule === 'private.dsh-home' && developerRead) rule = developerPathRule(pathValue)
      if (rule !== '') {
        privatePath = pathValue
        privateRule = rule
        break
      }
    }
    const privateCommand = commands.find((command) => isPrivateCommand(command, developerShellRead)) || null
    const dangerousCommand = commands.find((command) => isDangerousCommand(command)) || null
    const credentialArgument = privacy !== null && typeof privacy.hasCredential === 'function'
      ? strings.find((text) => privacy.hasCredential(text)) || null
      : null
    if (privateRule === '') {
      if (privateCommand !== null) privateRule = 'private.command'
      else if (credentialArgument !== null) privateRule = 'private.credential-argument'
    }

    const sealedPath = write ? paths.find((pathValue) => sealedRoots.some((root) => isInside(fold(pathValue), root))) : undefined
    const sealedCommand = commands.find((command) => !developerShellRead && sealedRoots.some((root) => shellTouchesRoot(command, root)))
    const developer = (developerRead && paths.some((pathValue) => isInside(fold(pathValue), dshRoot))) || developerShellRead
    return {
      paths,
      commands,
      write,
      developer,
      private: privateRule !== '',
      privatePath,
      privateCommand,
      privateRule: privateRule || null,
      privateReason: privateRule === '' ? null : privateReasonOf(privateRule),
      dangerous: dangerousCommand !== null,
      dangerousCommand,
      credentialArgument,
      sealed: Boolean(sealedPath || sealedCommand),
      sealedPath: sealedPath || null,
      sealedCommand: sealedCommand || null,
      strings,
    }
  }

  function originOf(exec) {
    const sessionId = exec?.agent?.session?.id
    return sessionId !== undefined && autonomousSessions.has(String(sessionId)) ? 'autonomous' : 'foreground'
  }

  function autonomousPathAllowed(pathValue) {
    const target = fold(pathValue)
    return isInside(target, mindRoot) || autonomousRoots.some((root) => isInside(target, root))
  }

  /**
   * 只判定，不执行。本机隐私和凭据是硬拒绝，不受权限开关影响。
   * @param {object} exec - `tools/pre-execute` 的执行对象。
   * @returns {{ decision: 'allow'|'deny', reason: string, origin: string, rule: string, inspection: object }}
   */
  function evaluate(exec) {
    const origin = originOf(exec)
    const inspection = inspect(exec)
    const base = { origin, inspection }

    if (config.permissions.emergencyStop) {
      return { ...base, decision: 'deny', reason: '紧急停止已打开：鱼脑不执行任何工具调用。改回 permissions.emergencyStop=false 后重启插件。', rule: 'emergency-stop' }
    }
    if (inspection.sealed) {
      return {
        ...base,
        decision: 'deny',
        reason: '鱼脑目录和鱼脑自己的代码是只读的：预算、配置、经历、账本、私设和权限规则只能由主人直接改文件，不能通过工具改。开发者模式下主人可以用只读命令查看；要改额度请主人直接打开 budget.json。',
        rule: 'sealed.fish-mind',
      }
    }
    // 不可逆或高风险命令是硬边界：关闭权限开关也不能执行。
    if (inspection.dangerous) {
      return {
        ...base,
        decision: 'deny',
        reason: '这条命令会删除或覆盖系统/磁盘、关机、关闭安全防护，或者从网络下载后直接执行。鱼脑不会执行这种不可逆或高风险的命令。',
        rule: 'dangerous.command',
      }
    }
    // 本机身份、凭据和部署信息同样是硬边界：权限开关关着也照样拒绝。
    if (inspection.private) {
      return {
        ...base,
        decision: 'deny',
        reason: inspection.privateReason,
        rule: inspection.privateRule,
      }
    }
    // 外部 MCP 只能读：发送、撤回、拍一拍、改资料、群管理一律拒绝。这条硬边界不受权限开关影响，
    // 因为开关关着只是「不用问主人」，不等于「外部服务可以替她说话」。
    const mcp = MCP_TOOL_PREFIX.exec(typeof exec?.name === 'string' ? exec.name : '')
    if (mcp !== null && !mcpReadOnly.some((item) => item.regex.test(mcp[2]))) {
      return {
        ...base,
        decision: 'deny',
        rule: 'external.mcp.read-only',
        reason: `外部服务「${mcp[1]}」的工具「${mcp[2]}」不在只读白名单里：她不能借外部 MCP 发消息、撤回、拍一拍或管理群。要在 QQ 里说话只能走她自己的嘴；确实需要这个能力时请主人把工具名加进 permissions.mcpReadOnlyTools。`,
      }
    }
    // 她可以读自己负责的设置；替主人改设置要先打开开发者模式，而且只能在主人自己的前台会话里。
    // 安全、额度、名单、权限和凭据不在可改范围里，写入每次记审计。
    if (exec?.name === FISH_CONFIG_TOOL) {
      const args = exec.arguments && typeof exec.arguments === 'object' && !Array.isArray(exec.arguments) ? exec.arguments : {}
      const writing = args.patch !== undefined && args.patch !== null
      if (writing) {
        if (config.developer.enabled !== true || origin !== 'foreground' || isOwnerSession(exec) !== true) {
          return {
            ...base,
            decision: 'deny',
            rule: 'fish.settings.write',
            reason: '改设置要先在「大肥鱼 → 开发者模式」里打开开发者模式，而且只能在你自己的会话里改。安全、预算、名单和凭据不开放。',
          }
        }
        return {
          ...base,
          decision: 'allow',
          rule: 'fish.settings.write',
          reason: '开发者模式：在主人自己的会话里替主人改行为设置。',
        }
      }
    }
    if (!config.permissions.enabled) return { ...base, decision: 'allow', reason: '权限开关关着', rule: 'permissions.disabled' }

    if (origin === 'autonomous') {
      if (!config.permissions.autonomous.enabled) {
        return { ...base, decision: 'deny', reason: '自主模式没有启用：后台会话不能调用工具。', rule: 'autonomous.disabled' }
      }
      if (!autonomousTools.has(exec.name)) {
        return { ...base, decision: 'deny', reason: `自主模式没有放行工具「${exec.name}」。`, rule: 'autonomous.tool' }
      }
      const outside = inspection.paths.find((pathValue) => !autonomousPathAllowed(pathValue))
      if (outside !== undefined) {
        return { ...base, decision: 'deny', reason: '自主模式只能访问鱼脑目录和 allowPaths。', rule: 'autonomous.path' }
      }
      return { ...base, decision: 'allow', reason: '自主模式允许的低风险调用', rule: 'autonomous.allow' }
    }

    if (mcp !== null) {
      return { ...base, decision: 'allow', reason: `外部服务「${mcp[1]}」的只读工具`, rule: 'external.mcp.read' }
    }

    if (inspection.developer) {
      return {
        ...base,
        decision: 'allow',
        reason: '开发者模式：只读查看 DSH 目录里的日志、配置和会话；凭据、身份文件和写入仍然拒绝。',
        rule: 'developer.read',
      }
    }

    return { ...base, decision: 'allow', reason: '用户会话正常放行', rule: 'foreground.allow' }
  }

  function auditText(value, limit) {
    let text
    try {
      text = typeof value === 'string' ? value : JSON.stringify(value)
    } catch {
      text = String(value)
    }
    const cleaned = privacy !== null && typeof privacy.redact === 'function'
      ? privacy.redact(text || '', 'local').text
      : summarize(text || '', limit)
    const flat = cleaned.replace(/\s+/g, ' ').trim()
    return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`
  }

  /** 记录一次判定；前台普通 allow 不记，避免审计被正常操作淹没，但从外部服务取数据、开发者模式读调试资料和改设置要留痕。 */
  function record(exec, verdict, downstream = 'allow') {
    const notable = verdict.origin === 'autonomous' || verdict.rule === 'external.mcp.read' || verdict.rule === 'developer.read' || verdict.rule === 'fish.settings.write'
    if (verdict.decision === 'allow' && !notable) return
    audit({
      at: Date.now(),
      tool: exec?.name ?? 'unknown',
      session: exec?.agent?.session?.id === undefined ? null : String(exec.agent.session.id),
      origin: verdict.origin,
      decision: verdict.decision,
      rule: verdict.rule,
      downstream,
      reason: auditText(verdict.reason, 300),
      args: auditText(exec?.arguments ?? {}, 200),
    })
  }

  return {
    evaluate,
    record,
    inspect,
    originOf,
    markAutonomous(sessionId) {
      autonomousSessions.add(String(sessionId))
    },
    unmarkAutonomous(sessionId) {
      autonomousSessions.delete(String(sessionId))
    },
    listAutonomous() {
      return [...autonomousSessions]
    },
    describe() {
      return {
        enabled: config.permissions.enabled,
        emergencyStop: config.permissions.emergencyStop,
        protectedReadPaths: config.permissions.protectedReadPaths,
        protectedWritePaths: config.permissions.protectedWritePaths,
        protectedNamePatterns: config.permissions.protectedNamePatterns,
        mcpReadOnlyTools: [...config.permissions.mcpReadOnlyTools],
        developer: { enabled: config.developer.enabled === true },
        sealedWritePaths: sealedRoots,
        hard: {
          dshHome: config.developer.enabled !== true,
          credentialStores: protectedRoots.length,
          identityFiles: identityPaths.size + SYSTEM_IDENTITY_FILES.length,
          machineProbes: true,
          dangerousCommands: true,
          credentialArguments: privacy !== null,
          externalMcpWrites: true,
        },
        autonomous: {
          enabled: config.permissions.autonomous.enabled,
          allowTools: [...autonomousTools],
          allowPaths: config.permissions.autonomous.allowPaths,
          sessions: [...autonomousSessions],
        },
      }
    },
    mindRoot,
    diag,
  }
}
