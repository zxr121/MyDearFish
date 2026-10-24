// 插件家目录的铺文件逻辑冒烟测试。
// 跑法： node tests/家目录.mjs
//
// 重点盯 2026-10-24 的桌面版事故：插件从 app.asar 加载时，
// 外部 uv / pip 读不了 asar 内部路径 ⇒ 装依赖必须用家目录那份 requirements.txt。

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureHomeFiles, requirementsFile } from '../lib/state.mjs'

let 挂了 = 0
const 报 = (标签, 过, 详情) => { if (!过) 挂了++; console.log(`${过 ? 'PASS' : 'FAIL'}  ${标签}${详情 ? '  :: ' + 详情 : ''}`) }

const 根 = mkdtempSync(join(tmpdir(), 'bili-home-'))
const 插件 = join(根, 'app.asar', 'node_modules', 'dsh-bili-subagent')
const 家 = join(根, 'dsh-home', 'bili-duty')
mkdirSync(join(插件, 'vendor', 'bilibili-mcp'), { recursive: true })
mkdirSync(join(插件, 'lib'), { recursive: true })
mkdirSync(家, { recursive: true })

const 发货的 = join(插件, 'vendor', 'bilibili-mcp', 'requirements.txt')
const 家里的 = join(家, 'requirements.txt')
const 日志 = []
const 记 = (s) => 日志.push(s)

writeFileSync(发货的, 'bilibili-api-python>=17.4.1,<18\n', 'utf8')
writeFileSync(join(插件, 'vendor', 'bilibili-mcp', 'mcp_server.py'), 'print("mcp")\n', 'utf8')
writeFileSync(join(插件, 'lib', 'asr.py'), 'print("asr")\n', 'utf8')

try {
  ensureHomeFiles(插件, 家, 记)
  报('首次启动铺好 requirements.txt', existsSync(家里的) && readFileSync(家里的, 'utf8') === readFileSync(发货的, 'utf8'))
  报('首次启动同时铺好 mcp_server.py', existsSync(join(家, 'mcp_server.py')))
  报('首次启动同时铺好 asr.py', existsSync(join(家, 'asr.py')))

  writeFileSync(发货的, 'bilibili-api-python>=17.4.1,<18\nmcp>=1.0.0,<2\n', 'utf8')
  ensureHomeFiles(插件, 家, 记)
  报('插件升级后覆盖家里的 requirements.txt', readFileSync(家里的, 'utf8').includes('mcp>=1.0.0,<2'))

  报('requirementsFile 优先返回家里那份', requirementsFile(插件, 家, 记) === 家里的)

  rmSync(家里的, { force: true })
  const 补铺 = requirementsFile(插件, 家, 记)
  报('家里缺了会当场从插件补铺', 补铺 === 家里的 && existsSync(家里的))

  rmSync(家里的, { force: true })
  rmSync(发货的, { force: true })
  const 都没有 = requirementsFile(插件, 家, 记)
  报('两边都没有时返回空串并写日志', 都没有 === '' && 日志.some((s) => s.includes('缺文件：')))
} finally {
  rmSync(根, { recursive: true, force: true })
}

console.log(`\n${挂了 === 0 ? '全部通过 ✅' : `有 ${挂了} 条没过 ❌`}`)
process.exitCode = 挂了 === 0 ? 0 : 1
