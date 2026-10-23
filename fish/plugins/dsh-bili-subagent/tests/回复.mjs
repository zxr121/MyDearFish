// 收到的回复 → 可回评列表 的归一化冒烟测试。
// 跑法： node tests/回复.mjs

import { normalizeReceivedReplies } from '../lib/replies.mjs'

let 挂了 = 0
const 报 = (标签, 过, 详情) => { if (!过) 挂了++; console.log(`${过 ? 'PASS' : 'FAIL'}  ${标签}${详情 ? '  :: ' + 详情 : ''}`) }

const NOW = 1761007200 * 1000   // 2025-10-21 前后，只用来固定"多久算旧"

const 通知 = ({ item: 覆盖 = {}, ...外层 } = {}) => ({
  id: 1,
  user: { nickname: '小明' },
  reply_time: 1761003600,
  ...外层,
  item: {
    business_id: 1,
    source_id: 900001,
    root_id: 0,
    target_id: 700000,
    source_content: '同意！',
    target_reply_content: '她原来写的',
    root_reply_content: '她原来写的',
    title: '某视频',
    uri: 'https://www.bilibili.com/video/BV1aa411c7mA',
    reply_time: 1761003600,
    ...覆盖,
  },
})

const 原始 = {
  data: {
    items: [
      通知(),
      通知({
        id: 2,
        user: { nickname: '小红' },
        item: {
          source_id: 900002,
          root_id: 800000,
          target_id: 900001,
          source_content: '我也觉得',
          root_reply_content: '根评论',
          uri: 'https://www.bilibili.com/video/BV1bb411c7mB',
          reply_time: 1761007200,
        },
        reply_time: 1761007200,
      }),
      通知({ id: 3, item: { business_id: 11, source_id: 900003 } }),
      通知({ id: 4, reply_time: 1500000000, item: { source_id: 900004, reply_time: 1500000000 } }),
      通知({ id: 5, item: { source_id: 900005, uri: 'https://t.bilibili.com/1' } }),
      通知({ id: 6 }),
      通知({ id: 7, item: { source_id: 0 } }),
      通知({
        id: 8,
        item: {
          source_id: 900006,
          uri: 'https://www.bilibili.com/video/BV1cc411c7mC',
          reply_time: 1760990000,
        },
        reply_time: 1760990000,
      }),
    ],
  },
}

const 盒 = normalizeReceivedReplies(原始, { now: NOW })
报('总量按去重后的有效回复算', 盒.total === 4, JSON.stringify({ total: 盒.total, skipped: 盒.skipped }))
报('按时间从新到旧', 盒.items.map((x) => x.rpid).join() === '900002,900001,900005,900006', 盒.items.map((x) => x.rpid).join())
报('动态等其他业务跳过', 盒.skipped.otherBusiness === 1, JSON.stringify(盒.skipped))
报('超过 72 小时的跳过', 盒.skipped.old === 1, JSON.stringify(盒.skipped))
报('没有 BV 的不能用 bili_reply 回', 盒.skipped.noBvid === 1 && 盒.items.find((x) => x.rpid === 900005)?.canReply === false, JSON.stringify(盒.skipped))
报('坏的 source_id 跳过', 盒.skipped.invalid === 1, JSON.stringify(盒.skipped))

const 一级回复 = 盒.items.find((x) => x.rpid === 900001)
报('直接回一级评论时 root 用 target_id', 一级回复?.root === 700000 && 一级回复?.targetId === 700000, JSON.stringify(一级回复))
报('带出回复者、原文和她当时的评论', 一级回复?.nickname === '小明' && 一级回复?.text === '同意！' && 一级回复?.myComment === '她原来写的', JSON.stringify(一级回复))
报('带出 BV、楼中楼 root 和视频标题', 盒.items.find((x) => x.rpid === 900002)?.root === 800000 && 盒.items.find((x) => x.rpid === 900001)?.bvid === 'BV1aa411c7mA' && 盒.items.find((x) => x.rpid === 900001)?.title === '某视频')
报('重复的 source_id 只留一条', 盒.items.filter((x) => x.rpid === 900001).length === 1)

const 已回 = normalizeReceivedReplies(原始, { now: NOW, seenTargets: new Set([900001, 900006]) })
报('回过的不再回（alreadyReplied）', 已回.items.find((x) => x.rpid === 900001)?.alreadyReplied === true && 已回.items.find((x) => x.rpid === 900002)?.alreadyReplied === false)
报('统计里点出已回条数', 已回.skipped.alreadyReplied === 2, JSON.stringify(已回.skipped))

const 两条 = normalizeReceivedReplies(原始, { now: NOW, limit: 2 })
报('limit 只截返回、不改总量', 两条.items.length === 2 && 两条.total === 4)

const 不限时间 = normalizeReceivedReplies(原始, { now: NOW, maxAgeHours: 0 })
报('maxAgeHours=0 时旧回复也留着', 不限时间.total === 5 && 不限时间.skipped.old === 0)

const 字符串 = normalizeReceivedReplies(JSON.stringify(原始), { now: NOW })
报('JSON 字符串输入也能解析', 字符串.total === 4)

const 平铺 = normalizeReceivedReplies({ items: 原始.data.items }, { now: NOW })
报('外壳被拆掉（items 在顶层）也能解析', 平铺.total === 4)

const 空 = normalizeReceivedReplies({ data: { items: [] } }, { now: NOW })
报('空列表不报错', 空.total === 0 && 空.items.length === 0)

console.log(`\n${挂了 === 0 ? '全部通过 ✅' : `有 ${挂了} 条没过 ❌`}`)
process.exitCode = 挂了 === 0 ? 0 : 1
