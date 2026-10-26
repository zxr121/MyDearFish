// 从上游 astrbot_plugin_memewiki 的 memes.db 生成随包词库。
//
// 用法（Node 22.5+，需要 node:sqlite）：
//   node scripts/build-memes.mjs <memes.db 路径> [输出目录]
//
// 产物：
//   data/memes.json.gz   紧凑 JSON，字段 title/slug/tags/usage/origin/other
//   data/memes-meta.json 条数、构建时间、来源和 gzip 校验和
//
// 上游数据更新后手动跑一次；安装和启动都不需要它。

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { gzipSync } from 'node:zlib'

const source = process.argv[2]
if (!source) {
  console.error('用法：node scripts/build-memes.mjs <memes.db 路径> [输出目录]')
  process.exit(2)
}

const outDir = resolve(process.argv[3] || join(import.meta.dirname, '..', 'data'))
mkdirSync(outDir, { recursive: true })

const db = new DatabaseSync(resolve(source), { readOnly: true })
try {
  const rows = db.prepare('SELECT title, slug, tags, usage, origin, other FROM memes ORDER BY title').all()
  const metaRows = db.prepare('SELECT key, value FROM meta').all()
  const meta = Object.fromEntries(metaRows.map((row) => [String(row.key), String(row.value)]))

  const items = rows.map((row) => ({
    title: String(row.title || '').trim(),
    slug: String(row.slug || '').trim(),
    tags: String(row.tags || '')
      .split('、')
      .map((tag) => tag.trim())
      .filter((tag) => tag !== ''),
    usage: String(row.usage || '').trim(),
    origin: String(row.origin || '').trim(),
    other: String(row.other || '').trim(),
  }))
  const kept = items.filter((item) => item.title !== '')
  if (kept.length !== items.length) {
    console.warn(`跳过 ${items.length - kept.length} 条空标题`)
  }

  const json = Buffer.from(JSON.stringify(kept), 'utf8')
  const gz = gzipSync(json, { level: 9 })
  writeFileSync(join(outDir, 'memes.json.gz'), gz)
  writeFileSync(
    join(outDir, 'memes-meta.json'),
    JSON.stringify({
      upstream: 'https://github.com/in1t1a1/astrbot_plugin_memewiki',
      contentSource: 'https://cnmeme.wiki',
      license: 'MIT',
      copyright: 'Copyright (c) 2026 in1t1a1',
      builtAt: meta.built_at || '',
      generatedAt: new Date().toISOString(),
      count: kept.length,
      jsonBytes: json.length,
      gzipBytes: gz.length,
      sha256: createHash('sha256').update(gz).digest('hex'),
    }, null, 2) + '\n',
    'utf8',
  )

  console.log(`已写入 ${join(outDir, 'memes.json.gz')}：${kept.length} 条，${json.length} 字节，gzip ${gz.length} 字节`)
} finally {
  db.close()
}
