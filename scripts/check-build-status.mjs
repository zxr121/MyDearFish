#!/usr/bin/env node
// 检查 CI 构建进度
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TAG = process.argv[2] || ''

function git(args) {
  try {
    return execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

console.log('━━━ CI 构建状态检查 ━━━')
console.log()

if (TAG) {
  const tagSha = git(['rev-parse', TAG]).slice(0, 7)
  const headSha = git(['rev-parse', 'HEAD']).slice(0, 7)
  console.log(`标签: ${TAG} → ${tagSha}`)
  console.log(`当前 HEAD: ${headSha}`)
  if (tagSha !== headSha) {
    console.log(`⚠ 标签指向的提交不是当前 HEAD`)
  }
  console.log()
}

// 尝试通过 SSH 检查远端标签
console.log('检查远端标签...')
try {
  const lsRemote = execFileSync('git', ['ls-remote', '--tags', 'ssh'], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 10000
  })
  const tags = lsRemote.split('\n').filter(l => l.includes('fish-release-'))
  console.log(`远端有 ${tags.length} 个 fish-release 标签`)
  if (TAG) {
    const found = tags.find(t => t.includes(TAG))
    if (found) {
      console.log(`✓ 找到标签 ${TAG}`)
    } else {
      console.log(`✗ 未找到标签 ${TAG}`)
    }
  }
} catch (e) {
  console.log('无法连接远端（可能需要 SSH 配置）')
}

console.log()
console.log('━━━ 建议 ━━━')
console.log('完整构建请运行: node fish/launch/release-fish.mjs' + (TAG ? ` --tag ${TAG}` : ''))
console.log('构建通常需要 19-24 分钟，请耐心等待。')
