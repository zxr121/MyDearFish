#!/usr/bin/env node
// 大肥鱼全部测试：鱼脑单测、各插件冒烟、跨插件提示词快照，串行跑，任一失败即非零退出。
// 跑法：node scripts/test-fish.mjs（仓库根目录）
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const NODE = process.execPath

function 找测试(目录, 匹配) {
  if (!existsSync(目录)) return []
  return readdirSync(目录)
    .filter((名) => 匹配.test(名))
    .sort()
    .map((名) => join(目录, 名))
}

// 鱼脑用 node:test；其余插件是一句话一个断言的冒烟脚本，逐个跑。
const 组 = [
  {
    名: '鱼脑单测',
    方式: 'node-test',
    cwd: join(REPO, 'fish/plugins/dsh-fish-mind'),
    文件: 找测试(join(REPO, 'fish/plugins/dsh-fish-mind/tests'), /\.test\.mjs$/),
  },
  {
    名: '组合提示词快照',
    方式: 'node-test',
    cwd: REPO,
    文件: 找测试(join(REPO, 'fish/tests'), /\.test\.mjs$/),
  },
]

for (const 目录 of ['dsh-qq-bridge', 'dsh-speak-up', 'dsh-tts-bridge', 'dsh-bili-subagent']) {
  const 测试目录 = join(REPO, 'fish/plugins', 目录, 'tests')
  组.push({
    名: `${目录} 冒烟`,
    方式: 'script',
    cwd: join(REPO, 'fish/plugins', 目录),
    文件: 找测试(测试目录, /\.mjs$/),
  })
}

function 跑(命令, cwd) {
  execFileSync(NODE, 命令, { cwd, stdio: 'inherit' })
}

console.log(`大肥鱼测试 · Node ${process.version} · ${REPO}`)
const 失败 = []
for (const 项 of 组) {
  if (项.文件.length === 0) continue
  console.log(`\n── ${项.名}（${项.文件.length} 个文件） ──`)
  const 起点 = Date.now()
  try {
    if (项.方式 === 'node-test') {
      跑(['--test', ...项.文件], 项.cwd)
    } else {
      for (const 文件 of 项.文件) {
        try {
          跑([文件], 项.cwd)
        } catch (错误) {
          失败.push(`${项.名} / ${文件.slice(REPO.length + 1)}`)
          console.error(`\n${文件.slice(REPO.length + 1)} 失败`)
        }
      }
    }
  } catch (错误) {
    失败.push(项.名)
  }
  const 秒 = ((Date.now() - 起点) / 1000).toFixed(1)
  if (!失败.some((x) => x.startsWith(项.名))) console.log(`── ${项.名} 通过（${秒}s）`)
  else console.error(`── ${项.名} 没通过（${秒}s）`)
}

if (失败.length > 0) {
  console.error(`\n大肥鱼测试没全过 ❌\n${失败.map((x) => `  - ${x}`).join('\n')}`)
  process.exit(1)
}
console.log('\n大肥鱼测试全部通过 ✅')
