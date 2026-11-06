// 官方商城表情：包目录归一、图片地址和消息段字段的离线测试。
// 跑法： node tests/商城表情.mjs

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const 家 = mkdtempSync(join(tmpdir(), 'qq-sticker-pack-'))
process.env.DSH_HOME = 家

let 挂了 = 0
const 报 = (标签, 过, 详情) => { if (!过) 挂了++; console.log(`${过 ? 'PASS' : 'FAIL'}  ${标签}${详情 ? '  :: ' + 详情 : ''}`) }

const 包 = await import(new URL('../lib/sticker-pack.js', import.meta.url).href)
const 宿主 = await import(new URL('../lib/host.js', import.meta.url).href + '?v=' + Date.now())

// ---------- 目录地址 ----------
报('目录地址按个位分桶',
  包.系列目录址(246925) === 'https://i.gtimg.cn/club/item/parcel/5/246925.json'
  && 包.系列目录址('249028') === 'https://i.gtimg.cn/club/item/parcel/8/249028.json')
报('非法包号不拼地址', 包.系列目录址(0) === '' && 包.系列目录址(-1) === '' && 包.系列目录址('x') === '')

// ---------- 图片地址 ----------
报('动态图 / 静态图地址',
  包.系列图址('9282b49b61ee17739f4bbbd2a36564c2') === 'https://gxh.vip.qq.com/club/item/parcel/item/92/9282b49b61ee17739f4bbbd2a36564c2/raw300.gif'
  && 包.系列图址('9282b49b61ee17739f4bbbd2a36564c2', false) === 'https://gxh.vip.qq.com/club/item/parcel/item/92/9282b49b61ee17739f4bbbd2a36564c2/300x300.png')
报('带 face 前缀的 id 原样保留',
  包.系列图址('face77b7a9ab8a935c376c7e4ef08dd9') === 'https://gxh.vip.qq.com/club/item/parcel/item/fa/face77b7a9ab8a935c376c7e4ef08dd9/raw300.gif')
报('空 / 怪 id 不拼地址', 包.系列图址('') === '' && 包.系列图址('../x') === '' && 包.系列图址('a'.repeat(65)) === '')

// ---------- 名字 ----------
报('名字去掉方括号和引号',
  包.净商城名('[捏捏]') === '捏捏' && 包.净商城名('【安详】') === '安详'
  && 包.净商城名('「可爱捏」') === '可爱捏' && 包.净商城名('  多  余 空白 ') === '多 余 空白')
报('名字最多 24 字', 包.净商城名('鱼'.repeat(40)).length === 24)

// ---------- 目录归一 ----------
const 目录 = {
  id: 246925,
  name: '小喵包',
  mark: '小喵包的日常生活w',
  author: '',
  price: 0,
  updateTime: 1700000000,
  imgs: [
    { id: '9282b49b61ee17739f4bbbd2a36564c2', name: '目移', keywords: ['目移'] },
    { id: 'face77b7a9ab8a935c376c7e4ef08dd9', name: '[喜欢你]', keywords: ['喜欢你', '喜欢', ''] },
    { id: '9282b49b61ee17739f4bbbd2a36564c2', name: '重复', keywords: [] },
    { id: '', name: '没图' },
    { id: 'bad id', name: '坏 id' },
  ],
}
const 归一 = 包.归系列包(目录)
报('目录归一：包名 / 简介 / 价格',
  归一 && 归一.id === 246925 && 归一.name === '小喵包'
  && 归一.mark === '小喵包的日常生活w' && 归一.price === 0 && 归一.updateTime === 1700000000)
报('目录归一：按 id 去重、坏条目丢掉',
  归一 && 归一.items.length === 2 && 归一.items[0].name === '目移'
  && 归一.items[1].name === '喜欢你' && 归一.items[1].keywords.length === 2)
报('目录归一：没有可用图返回 null', 包.归系列包({ id: 1, name: '空', imgs: [] }) === null
  && 包.归系列包(null) === null && 包.归系列包({ id: 0, imgs: [{ id: 'abc' }] }) === null)

const 大目录 = 包.归系列包({ id: 9, name: '大包', imgs: Array.from({ length: 80 }, (_, i) => ({ id: `a${i}`, name: `图${i}` })) })
报('目录归一：最多 60 张', 大目录 && 大目录.items.length === 60)

// ---------- 取目录 ----------
const 假取 = (体) => async (url) => ({ ok: true, url, text: async () => JSON.stringify(体) })
const 取到 = await 包.取系列目录(246925, { fetchImpl: 假取(目录) })
报('假 fetch 取到并归一', 取到 && 取到.name === '小喵包' && 取到.items.length === 2)
const 坏址 = await 包.取系列目录(246925, { fetchImpl: async (url) => ({ ok: true, url: 'https://evil.example/x', text: async () => '{}' }) })
报('重定向到非 i.gtimg.cn 不认', 坏址 === null)
const 坏状态 = await 包.取系列目录(246925, { fetchImpl: async (url) => ({ ok: false, url, text: async () => '{}' }) })
报('非 200 不认', 坏状态 === null)
const 坏文 = await 包.取系列目录(246925, { fetchImpl: async (url) => ({ ok: true, url, text: async () => '不是 JSON' }) })
报('坏 JSON 不认', 坏文 === null)

// ---------- 解析层 ----------
const 图段 = 宿主.解析消息段({
  message: [{
    type: 'image',
    data: {
      file: '52-52a3d779b6269d22adf0acb567281524.gif',
      url: 'https://gxh.vip.qq.com/club/item/parcel/item/52/52a3d779b6269d22adf0acb567281524/raw300.gif',
      summary: '[捏捏]',
      sub_type: 0,
      emoji_id: '52a3d779b6269d22adf0acb567281524',
      emoji_package_id: 246925,
      key: '42c60969b5f716aa',
    },
  }],
})
const 图 = 图段.图片们[0]
报('商城表情的 image 段：认成表情、留下包号 / key / 官方名线索',
  图 && 图.商城 === true && 图.表情号 === '52a3d779b6269d22adf0acb567281524'
  && 图.系列号 === 246925 && 图.系列key === '42c60969b5f716aa' && 图.subType === 1
  && 图.summary === '[捏捏]',
  JSON.stringify(图))

const 无址段 = 宿主.解析消息段({
  message: [{
    type: 'image',
    data: { summary: '[捏捏]', emoji_id: '52a3d779b6269d22adf0acb567281524', emoji_package_id: 246925, key: 'k' },
  }],
})
报('商城表情没给 url 时按 id 拼 gxh 地址',
  无址段.图片们[0] && 无址段.图片们[0].url === 'https://gxh.vip.qq.com/club/item/parcel/item/52/52a3d779b6269d22adf0acb567281524/raw300.gif')

const 旧式段 = 宿主.解析消息段({
  message: [{
    type: 'mface',
    data: { summary: '[捏捏]', emoji_id: '52a3d779b6269d22adf0acb567281524', emoji_package_id: 246925, key: 'k' },
  }],
})
报('旧式 mface 段同样带上包号 / key / 地址',
  旧式段.看不见的表情 === 0 && 旧式段.图片们[0]
  && 旧式段.图片们[0].商城 === true && 旧式段.图片们[0].系列号 === 246925
  && 旧式段.图片们[0].系列key === 'k'
  && 旧式段.图片们[0].url.endsWith('/raw300.gif'))

const 普通段 = 宿主.解析消息段({
  message: [{ type: 'image', data: { url: 'https://gchat.qpic.cn/a.png', summary: '', sub_type: 0 } }],
})
报('普通图片不受影响', 普通段.图片们[0] && !普通段.图片们[0].商城
  && 普通段.图片们[0].subType === 0 && !普通段.图片们[0].表情号)

rmSync(家, { recursive: true, force: true })
console.log(`\n${挂了 === 0 ? '全部通过 ✅' : `有 ${挂了} 条没过 ❌`}`)
process.exitCode = 挂了 === 0 ? 0 : 1
