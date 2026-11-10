// 心情来源判定：主人只在 QQ 里说话时，心情也要继续记。
// 跑法： node tests/心情来源.mjs
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const 家 = mkdtempSync(join(tmpdir(), 'mood-source-'))
process.env.DSH_HOME = 家

const 模 = await import(new URL('../lib/index.js', import.meta.url).href + '?v=' + Date.now())

let 挂了 = 0
const 报 = (标签, 过, 详情) => {
  if (!过) 挂了++
  console.log(`${过 ? 'PASS' : 'FAIL'}  ${标签}${详情 ? '  :: ' + 详情 : ''}`)
}

报('主人私聊照常判', 模.该判心情('session-qq-private-837263217', { owner: false }))
报('桌面会话照常判', 模.该判心情('session-cce595b0', null) && 模.该判心情('session-unknown', {}))
报('群里主人开口才判', 模.该判心情('session-qq-social-group-795789868', { owner: true }))
报('群里只有群友说话不判', !模.该判心情('session-qq-social-group-795789868', { owner: false }))
报('群友私聊不判', !模.该判心情('session-qq-social-friend-2595029053', { owner: false }))
报('分线、重置后的会话同样按来源判',
  !模.该判心情('session-qq-social-group-795789868-rmvkmde7w-p2', { owner: false })
  && 模.该判心情('session-qq-social-group-795789868-rmvkmde7w-p2', { owner: true }))

if (挂了 > 0) {
  console.error(`\n心情来源 ${挂了} 条没过 ❌`)
  process.exit(1)
}
console.log('\n心情来源全部通过 ✅')
