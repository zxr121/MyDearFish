// 打版交付 zip：exe + SnowLuma 安装包 + 安装说明 + nightly.yml。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32 } from 'node:zlib'

import { 打交付zip, 列zip条目, 安装说明文本, 校验雪包, SHA256, SHA512 } from '../launch/delivery-zip.mjs'

function 写存储zip(输出, 条目) {
  const fd = openSync(输出, 'w')
  let 偏移 = 0
  const 写 = (buf) => {
    writeSync(fd, buf)
    偏移 += buf.length
  }
  const 目录 = []
  try {
    for (const [名, 内容] of 条目) {
      const 名b = Buffer.from(名, 'utf8')
      const 数据 = Buffer.from(内容)
      const crc = crc32(数据) >>> 0
      const 头 = Buffer.alloc(30)
      头.writeUInt32LE(0x04034b50, 0)
      头.writeUInt16LE(20, 4)
      头.writeUInt16LE(0x0800, 6)
      头.writeUInt16LE(0, 8)
      头.writeUInt32LE(crc, 14)
      头.writeUInt32LE(数据.length, 18)
      头.writeUInt32LE(数据.length, 22)
      头.writeUInt16LE(名b.length, 26)
      const 起 = 偏移
      写(头)
      写(名b)
      写(数据)
      目录.push({ 名b, crc, 大小: 数据.length, 起 })
    }
    const 目录起 = 偏移
    for (const 项 of 目录) {
      const 头 = Buffer.alloc(46)
      头.writeUInt32LE(0x02014b50, 0)
      头.writeUInt16LE(20, 4)
      头.writeUInt16LE(20, 6)
      头.writeUInt16LE(0x0800, 8)
      头.writeUInt32LE(项.crc, 16)
      头.writeUInt32LE(项.大小, 20)
      头.writeUInt32LE(项.大小, 24)
      头.writeUInt16LE(项.名b.length, 28)
      头.writeUInt32LE(项.起, 42)
      写(头)
      写(项.名b)
    }
    const 目录长 = 偏移 - 目录起
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0)
    eocd.writeUInt16LE(目录.length, 8)
    eocd.writeUInt16LE(目录.length, 10)
    eocd.writeUInt32LE(目录长, 12)
    eocd.writeUInt32LE(目录起, 16)
    写(eocd)
  } finally {
    closeSync(fd)
  }
}

test('交付 zip 里是 exe、SnowLuma 安装包、安装说明和 nightly', async () => {
  const 目录 = mkdtempSync(join(tmpdir(), 'fish-delivery-test-'))
  try {
    const exe名 = 'deepseek-harness-9.9.9-win-x64-unsigned.exe'
    const exe = join(目录, exe名)
    writeFileSync(exe, randomBytes(1024 * 1024 + 7))
    const sha = await SHA512(exe)
    const 雪名 = 'SnowLuma-v9.9.9-win-x64.zip'
    const 雪包 = join(目录, 雪名)
    写存储zip(雪包, [
      ['index.mjs', 'console.log(1)\n'],
      ['node.exe', 'fake-node'],
    ])
    const 结果 = await 打交付zip({
      输出目录: 目录,
      版本: '9.9.9',
      安装包: exe,
      大小: statSync(exe).size,
      sha,
      nightly: 'version: 9.9.9\n',
      雪包,
      雪期望: { name: 雪名, size: statSync(雪包).size, digest: `sha256:${await SHA256(雪包)}` },
    })
    assert.deepEqual(结果.内容, [exe名, 雪名, '安装说明.txt', 'nightly.yml'])
    assert.ok(existsSync(结果.文件), '交付 zip 没生成')
    assert.ok(statSync(结果.文件).size > 0, '交付 zip 是空的')
    assert.equal(结果.sha, await SHA512(结果.文件), '交付 zip 的 SHA-512 没对上')
    const 条目 = 列zip条目(结果.文件)
    for (const 名 of 结果.内容) assert.ok(条目.includes(名), `交付 zip 里缺 ${名}`)
    const 校验 = readFileSync(`${结果.文件}.sha512`, 'utf8')
    assert.ok(校验.includes(结果.sha) && 校验.includes('大肥鱼-9.9.9-win-x64.zip'), '校验文件内容不对')
  } finally {
    rmSync(目录, { recursive: true, force: true })
  }
})

test('SnowLuma 包校验大小、SHA-256 和 index.mjs/node.exe 布局', async () => {
  const 目录 = mkdtempSync(join(tmpdir(), 'fish-snowluma-test-'))
  try {
    const 雪包 = join(目录, 'SnowLuma-v9.9.9-win-x64.zip')
    写存储zip(雪包, [
      ['index.mjs', 'console.log(1)\n'],
      ['node.exe', 'fake-node'],
    ])
    const 大小 = statSync(雪包).size
    const sha256 = await SHA256(雪包)
    const 通过 = await 校验雪包(雪包, { name: 'SnowLuma-v9.9.9-win-x64.zip', size: 大小, digest: `sha256:${sha256}` })
    assert.equal(通过.大小, 大小)
    assert.equal(通过.sha256, sha256)
    await assert.rejects(校验雪包(雪包, { digest: 'sha256:0000' }), /SHA-256 不符/)
    写存储zip(雪包, [['index.mjs', 'console.log(1)\n']])
    await assert.rejects(校验雪包(雪包), /缺 node\.exe/)
  } finally {
    rmSync(目录, { recursive: true, force: true })
  }
})

test('安装说明给出 exe 校验、包内 SnowLuma 文件和本地 zip 安装步骤', () => {
  const 文 = 安装说明文本({
    版本: '9.9.9',
    安装包名: 'deepseek-harness-9.9.9-win-x64-unsigned.exe',
    大小: 123456789,
    sha: 'abc==',
    雪: { 名: 'SnowLuma-v9.9.9-win-x64.zip', 大小: 43361462, sha256: 'deadbeef' },
  })
  assert.ok(文.includes('deepseek-harness-9.9.9-win-x64-unsigned.exe'))
  assert.ok(文.includes('SHA-512：abc=='))
  assert.ok(文.includes('SnowLuma-v9.9.9-win-x64.zip'))
  assert.ok(文.includes('从本地 zip 安装'))
  assert.ok(文.includes('SHA-256：deadbeef'))
  assert.ok(文.includes('gh-proxy.com'))
})
