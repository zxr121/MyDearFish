// 打版交付 zip：exe + 安装说明 + nightly.yml；不放 SnowLuma 的二进制。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { 打交付zip, 安装说明文本, SHA512 } from '../launch/delivery-zip.mjs'

test('交付 zip 里是 exe、安装说明和 nightly，不放 SnowLuma 二进制', async () => {
  const 目录 = mkdtempSync(join(tmpdir(), 'fish-delivery-test-'))
  try {
    const exe名 = 'deepseek-harness-9.9.9-win-x64-unsigned.exe'
    const exe = join(目录, exe名)
    writeFileSync(exe, randomBytes(1024 * 1024 + 7))
    const sha = await SHA512(exe)
    const 结果 = await 打交付zip({
      输出目录: 目录,
      版本: '9.9.9',
      安装包: exe,
      大小: statSync(exe).size,
      sha,
      nightly: 'version: 9.9.9\n',
    })
    assert.deepEqual(结果.内容, [exe名, '安装说明.txt', 'nightly.yml'])
    assert.ok(existsSync(结果.文件), '交付 zip 没生成')
    assert.ok(statSync(结果.文件).size > 0, '交付 zip 是空的')
    assert.equal(结果.sha, await SHA512(结果.文件), '交付 zip 的 SHA-512 没对上')
    const 校验 = readFileSync(`${结果.文件}.sha512`, 'utf8')
    assert.ok(校验.includes(结果.sha) && 校验.includes('大肥鱼-9.9.9-win-x64.zip'), '校验文件内容不对')
  } finally {
    rmSync(目录, { recursive: true, force: true })
  }
})

test('安装说明给出 exe 校验、SnowLuma 镜像和本地 zip 安装路径', () => {
  const 文 = 安装说明文本({
    版本: '9.9.9',
    安装包名: 'deepseek-harness-9.9.9-win-x64-unsigned.exe',
    大小: 123456789,
    sha: 'abc==',
  })
  assert.ok(文.includes('deepseek-harness-9.9.9-win-x64-unsigned.exe'))
  assert.ok(文.includes('SHA-512：abc=='))
  assert.ok(文.includes('SnowLuma-v2.4.2-win-x64.zip'))
  assert.ok(文.includes('gh-proxy.com'))
  assert.ok(文.includes('从本地 zip 安装'))
  assert.ok(文.includes('不分发 SnowLuma 的二进制'))
})
