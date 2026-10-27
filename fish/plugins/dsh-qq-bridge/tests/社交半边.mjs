// 「通到 QQ」社交半边的冒烟测试 —— 假 ctx / 假 fetch / 假 llm 跑群聊与好友接话。
// 验的是：
//   1) 小模型自己挑 watch：只有挑中的消息进她的社交会话；没挑中的当她没看见
//   2) 群友被 @ / 叫名字 / 回复：必须至少回一句；主人点名叫她时不判断、优先接
//   3) 没点她的消息可以只看不回；被叫和好友私聊在冷却里也照回
//   4) 好友私聊必须回一句，不感兴趣也回短的
//   5) 静音、试运行、零花钱下限都在判断之前拦住；接话次数不设上限
//   6) 脱敏失败 → 不发；回复她发过的消息 → 认得出是在叫她；被引用的消息回查原文后带进判断和回话，查不到只留正文
//   7) /models 和 /save 的社交深层合并；旧字段「被叫直接回」被忽略
//   8) 刷屏时被叫和主人的消息优先保留，不会被挤出待看或判断窗口
//   9) 兴趣画像成熟前每条都判；成熟后快判只排序和限额，0 分也进慢判（超额靠探索补看），
//      被叫和主人（没叫她时）永远进慢判；主人点名叫她时不走慢判，直接开一轮
//  10) 群里在回别人 / @ 别人 / 聊游戏或自定义不聊话题时，没被叫到就不进待看、不花判断；
//      被叫到仍回，问游戏只照实说不玩
// 跑法： node tests/社交半边.mjs

import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const 家 = mkdtempSync(join(tmpdir(), 'qq-social-'))
process.env.DSH_HOME = 家

let 挂了 = 0
const 报 = (标签, 过, 详情) => { if (!过) 挂了++; console.log(`${过 ? 'PASS' : 'FAIL'}  ${标签}${详情 ? '  :: ' + 详情 : ''}`) }
const 等 = (ms = 30) => new Promise((r) => setTimeout(r, ms))

// 冷却用 Date.now 推进；会话里的「今天」和静音时段仍用真实时间。
const 真Now = Date.now.bind(Date)
let 时间偏移 = 0
Date.now = () => 真Now() + 时间偏移

const 模 = await import(new URL('../lib/host.js', import.meta.url).href + '?v=' + Date.now())

// ---------- 纯函数 ----------
报('社交会话 id：群/好友各一间', 模.社交会话id('group', '555') === 'session-qq-social-group-555' && 模.社交会话id('friend', '777') === 'session-qq-social-friend-777', 模.社交会话id('group', '555'))
报('识别社交会话', 模.是社交会话('session-qq-social-group-555') && 模.是社交会话('qq-social-group-555') && !模.是社交会话('session-X'))
报('主人私聊会话 id：一间固定屋', 模.主人QQ会话id('123') === 'session-qq-private-123', 模.主人QQ会话id('123'))
const 阈值0 = 模.学习期阈值(0.55, 0, false)
const 阈值3 = 模.学习期阈值(0.55, 3, false)
const 阈值6 = 模.学习期阈值(0.55, 6, false)
报('学习期意愿走指数曲线：0 词最松，6 词回到配置阈值', Math.abs(阈值0 - 0.3) < 1e-9 && Math.abs(阈值3 - 0.3456) < 1e-3 && Math.abs(阈值6 - 0.55) < 1e-9, `${阈值0}/${阈值3}/${阈值6}`)
报('缓动曲线：0→0、1→1、中点低于线性', 模.缓动曲线(0) === 0 && Math.abs(模.缓动曲线(1) - 1) < 1e-12 && 模.缓动曲线(0.5) < 0.25, String(模.缓动曲线(0.5)))
const 满把握冷却 = 模.冷却秒数(60, 1, 0.55, 5, 1.5, 1)
const 高把握冷却 = 模.冷却秒数(60, 0.9, 0.55, 5, 1.5, 1)
const 低把握冷却 = 模.冷却秒数(60, 0.56, 0.55, 5, 1.5, 1)
报('冷却曲线：满把握 5 秒，高把握个位数，低把握接近最长', 满把握冷却 === 5 && 高把握冷却 >= 5 && 高把握冷却 <= 12 && 低把握冷却 > 60, `${满把握冷却}/${高把握冷却}/${低把握冷却}`)
const 想接冷却 = 模.冷却秒数(15, 0.7, 0.55, 2, 1.2, 1)
报('默认冷却：想接时几秒内就能再开口', 想接冷却 >= 2 && 想接冷却 <= 8, String(想接冷却))
const 吃紧倍率 = 模.余额冷却倍率(2, 1, 5, 1.5)
报('余额冷却：从吃紧线到最低余额平滑升到上限', 模.余额冷却倍率(5, 1, 5, 1.5) === 1 && 吃紧倍率 > 1 && 吃紧倍率 < 1.5 && 模.余额冷却倍率(1, 1, 5, 1.5) === 1.5, String(吃紧倍率))
报('识别主人私聊会话，且不跟社交会话混', 模.是主人QQ会话('session-qq-private-123') && 模.是主人QQ会话('qq-private-123') && !模.是主人QQ会话('session-qq-social-group-555') && !模.是社交会话('session-qq-private-123'))
报('静音跨午夜：23:00-08:00 在 07:30 生效', 模.在静音时段('23:00-08:00', new Date(2026, 0, 1, 7, 30)))
报('静音：12:00 不生效', !模.在静音时段('23:00-08:00', new Date(2026, 0, 1, 12, 0)))
const 段 = 模.解析消息段({
  message: [
    { type: 'at', data: { qq: '999' } },
    { type: 'text', data: { text: ' 在吗' } },
    { type: 'reply', data: { id: '42' } },
  ],
}, '999')
报('消息段：@ 我 + 正文 + 回复 id', 段.at我 && 段.文字.includes('在吗') && 段.回复id === '42', JSON.stringify(段))
const 段别人 = 模.解析消息段({
  message: [
    { type: 'at', data: { qq: '777', name: '群友777' } },
    { type: 'text', data: { text: '你看这个' } },
  ],
}, '999')
报('消息段：@ 别人不算叫她，但要能认出来', !段别人.at我 && 段别人.at别人 && 段别人.文字.includes('@群友777'), JSON.stringify(段别人))
const 段全体 = 模.解析消息段({
  message: [
    { type: 'at', data: { qq: 'all' } },
    { type: 'text', data: { text: '开会' } },
  ],
}, '999')
报('消息段：@ 全体不算单独对某个人说', !段全体.at我 && !段全体.at别人 && 段全体.文字.includes('@全体成员'), JSON.stringify(段全体))
报('游戏话题：游戏名、玩法、开黑都算',
  模.像游戏话题('今晚开黑吗') && 模.像游戏话题('原神新版本') && 模.像游戏话题('打排位') && 模.像游戏话题('steam 夏促'))
报('游戏话题：日常词不误伤', !模.像游戏话题('今天吃鸡蛋') && !模.像游戏话题('周末去海边') && !模.像游戏话题('今天风挺大'))
报('不聊话题：中文包含、拉丁整词', 模.命中不聊话题('今天踢足球', ['足球']).join() === '足球' && 模.命中不聊话题('我在说 AI 的事', ['AI']).join() === 'AI' && 模.命中不聊话题('email 里说的', ['AI']).length === 0)
const 图片段 = 模.解析消息段({
  message: [{ type: 'image', data: { url: 'https://multimedia.nt.qq.com.cn/download?x=1', file: 'a.jpg', summary: '[图片]' } }],
}, '999')
报('消息段：图片带 url/file/summary', 图片段.文字 === '[图片]' && 图片段.图片们.length === 1 && 图片段.图片们[0].url.includes('qq.com.cn') && 图片段.图片们[0].file === 'a.jpg', JSON.stringify(图片段))
const 收藏标注 = 模.标收藏表情('[图片]', [{ 收藏号: 16, 收藏名: '天青色瞪眼鱼' }])
报('收藏表情：正文后面带编号', 收藏标注 === '[图片]（你收藏的 #16 天青色瞪眼鱼）', 收藏标注)
报('收藏表情：没收藏过的图不加注', 模.标收藏表情('[图片]', [{}]) === '[图片]', 模.标收藏表情('[图片]', [{}]))
const 转发段 = 模.解析消息段({
  message: [{ type: 'forward', data: { id: 'res-1' } }],
}, '999')
报('消息段：合并转发留下 id', 转发段.文字 === '' && 转发段.转发们.length === 1 && 转发段.转发们[0].id === 'res-1', JSON.stringify(转发段))
const 转发节点 = (名, 文本, uid = 700) => ({
  user_id: uid,
  sender: { nickname: 名 },
  message: [{ type: 'text', data: { text: 文本 } }],
})
const 折叠 = 模.折叠转发([
  转发节点('甲', '第一句\n第二句'),
  转发节点('乙', '话'.repeat(300)),
])
报('折叠转发：一行一个说话人、压平换行、单条截断', 折叠.startsWith('[转发消息 2 条]') && 折叠.includes('甲：第一句 第二句') && 折叠.includes('乙：') && 折叠.includes('…'), JSON.stringify(折叠.slice(0, 260)))
const 大转发 = 模.折叠转发(Array.from({ length: 30 }, (_, i) => 转发节点('人' + i, '第' + i + '条')))
报('折叠转发：大转发只展开前 20 条', 大转发.includes('共 30 条，只展开前 20 条') && 大转发.includes('人19：第19条') && !大转发.includes('人20：'), JSON.stringify(大转发.slice(0, 200)))
const 嵌套折叠 = 模.折叠转发([{
  user_id: 1,
  sender: { nickname: '甲' },
  message: [{ type: 'forward', data: { id: 'nested' } }],
}])
报('折叠转发：嵌套转发只留标记、不再递归', 嵌套折叠.includes('甲：[转发消息]'), JSON.stringify(嵌套折叠))
const 转发图们 = 模.转发图片们([
  转发节点('甲', '只有字'),
  { user_id: 123, sender: { nickname: '主人' }, message: [{ type: 'image', data: { url: 'https://multimedia.nt.qq.com.cn/0.jpg', file: '0.jpg' } }] },
  { user_id: 702, sender: { nickname: '乙' }, message: [
    { type: 'image', data: { url: 'https://multimedia.nt.qq.com.cn/1.jpg', file: '1.jpg' } },
    { type: 'image', data: { url: 'https://multimedia.nt.qq.com.cn/2.jpg', file: '2.jpg' } },
    { type: 'image', data: { url: 'https://multimedia.nt.qq.com.cn/3.jpg', file: '3.jpg' } },
    { type: 'image', data: { url: 'https://multimedia.nt.qq.com.cn/4.jpg', file: '4.jpg' } },
  ] },
], '123')
报('转发图片：带原发言人，主人发的标出来，最多 4 张', 转发图们.length === 4 && 转发图们[0].说话人 === '主人' && 转发图们[0].主人 === true && 转发图们[1].说话人 === '乙' && 转发图们[1].主人 === false && 转发图们[3].file === '3.jpg', JSON.stringify(转发图们))
报('转发图片：拉不到节点 → 空', 模.转发图片们(undefined, '123').length === 0)
报('兴趣词：中文按包含命中', 模.命中兴趣词('鲸鱼娘今天也在', '鲸鱼娘') && !模.命中兴趣词('今天吃鱼', '鲸鱼娘'))
报('兴趣词：英文按整词，ai 不误伤 said/email', 模.命中兴趣词('今天聊 AI 绘画', 'AI') && 模.命中兴趣词('DeepSeek-V3 出了', 'DeepSeek') && !模.命中兴趣词('I said email again', 'AI'))

const 空语境 = { 兴趣词: [], 词: {}, 见词: {}, 最近词: new Set() }
const 显式分 = 模.注意力分({ 文字: '今天聊 AI 绘画' }, { ...空语境, 兴趣词: ['AI'] })
报('注意力分：显式兴趣直接过关', 显式分.分 >= 2 && 显式分.理由.some((x) => x.includes('AI')), JSON.stringify(显式分))
报('注意力分：无关闲聊是 0 分', 模.注意力分({ 文字: '今天食堂好难吃' }, 空语境).分 === 0)
报('注意力分：单张图 1 分，图 + 问句才够门槛', 模.注意力分({ 文字: '', 图片: [{ attachmentId: 'a' }] }, 空语境).分 === 1 && 模.注意力分({ 文字: '这是什么？', 图片: [{ attachmentId: 'a' }] }, 空语境).分 === 1.5)
报('注意力分：熟人和连发只是弱信号', 模.注意力分({ 文字: '随便说一句' }, { ...空语境, 同人条数: 2, 熟人: true }).分 === 1)
const 鲸鱼语境 = { 兴趣词: [], 词: { 鲸鱼: 2 }, 见词: { 鲸鱼: 2 }, 最近词: new Set() }
const 食堂语境 = { 兴趣词: [], 词: { 食堂: 2 }, 见词: { 食堂: 20 }, 最近词: new Set() }
报('注意力分：少见但常被挑中的词权重高', 模.注意力分({ 文字: '鲸鱼又来了' }, 鲸鱼语境).分 === 1.5)
报('注意力分：满屋都在说却没人看的词权重低', 模.注意力分({ 文字: '今晚食堂关门' }, 食堂语境).分 < 0.5)
报('注意力分：接着刚才的话题能加分', 模.注意力分({ 文字: '鲸鱼浮上来了' }, { ...空语境, 最近词: new Set(['鲸鱼']) }).分 === 1)
报('自关系问句：问老爹、问关系、问来历都算', 模.问到她自己('可以评价一下你的老爹emt吗') && 模.问到她自己('你俩是什么关系') && 模.问到她自己('你是被谁创造出来的') && 模.问到她自己('评价一下大肥鱼'), JSON.stringify(['可以评价一下你的老爹emt吗', '你俩是什么关系', '你是被谁创造出来的', '评价一下大肥鱼'].map((x) => [x, 模.问到她自己(x)])))
报('自关系问句：普通问句和“跟你没关系”不误伤', !模.问到她自己('你觉得呢') && !模.问到她自己('大肥鱼 你觉得呢') && !模.问到她自己('这跟你没关系') && !模.问到她自己('我的意思就是你俩都没@他') && !模.问到她自己('今天食堂好难吃'))
const 自关系分 = 模.注意力分({ 文字: '可以评价一下你的老爹emt吗' }, 空语境)
报('注意力分：问到她自己直接过门槛', 自关系分.分 >= 3 && 自关系分.理由.includes('在问她自己的事'), JSON.stringify(自关系分))
报('兴趣词元：图片和表情占位符不算话题', (() => { const 元 = 模.切兴趣词元('[图片] [动画表情] 今晚 DeepSeek'); return 元.has('deepseek') && !元.has('图片') && !元.has('表情') })())
报('探索候选：链接、广告和复读不挑', 模.像灌水或广告('看这个 https://x.cn/a') && 模.像灌水或广告('加群领福利') && 模.像灌水或广告('哈哈哈哈哈哈哈哈') && !模.像灌水或广告('今晚食堂关门了'))
报('说话人：名片夹带控制字符时回退干净昵称', 模.取说话人名字('\n\n\b&ÿ\u0007Çý\n\u001d\u0012\u001b南宫问鸢⁧？喵⁧‭\u0010\u0000', '短鸢', '888') === '短鸢')
报('说话人：名片正常时优先用名片', 模.取说话人名字(' 小鸢 ', '短鸢', '888') === '小鸢')
报('说话人：昵称也带控制字符时去掉后再用', 模.取说话人名字('', '短\u0007鸢', '888') === '短鸢')
报('说话人：名片昵称都不可用时回退 QQ 号', 模.取说话人名字('\u0000坏', '\b\u0007', '888') === '888')

// ---------- 人物志：关系累积、事实清洗、边界 ----------
报('关系阶段台阶：生人 / 眼熟 / 熟人 / 朋友 / 老友',
  模.关系阶段(0) === '生人' && 模.关系阶段(15) === '眼熟' && 模.关系阶段(35) === '熟人' && 模.关系阶段(60) === '朋友' && 模.关系阶段(85) === '老友',
  [0, 15, 35, 60, 85].map((n) => 模.关系阶段(n)).join('/'))
报('关系口气：熟才自然，暖 + 熟才热，张力先让口气变淡/冷',
  模.关系口气({ 熟: 0 }) === '客气' && 模.关系口气({ 熟: 35 }) === '自然' && 模.关系口气({ 熟: 60, 暖: 70 }) === '热' &&
    模.关系口气({ 熟: 60, 暖: 70, 张力: 30 }) === '淡' && 模.关系口气({ 熟: 80, 暖: 80, 张力: 60 }) === '冷',
  JSON.stringify([{ 熟: 0 }, { 熟: 35 }, { 熟: 60, 暖: 70 }, { 熟: 60, 暖: 70, 张力: 30 }, { 熟: 80, 暖: 80, 张力: 60 }].map(模.关系口气)))
报('综合好感：熟悉度打底，暖加减，张力扣分，夹在 0..100',
  模.综合好感({ 熟: 2, 暖: 50, 张力: 0 }) === 2 &&
    模.综合好感({ 熟: 60, 暖: 70, 张力: 0 }) === 66 &&
    模.综合好感({ 熟: 60, 暖: 70, 张力: 40 }) === 46 &&
    模.综合好感({ 熟: 100, 暖: 100, 张力: 0 }) === 100 &&
    模.综合好感({ 熟: 0, 暖: 0, 张力: 100 }) === 0,
  JSON.stringify([{ 熟: 2, 暖: 50, 张力: 0 }, { 熟: 60, 暖: 70, 张力: 0 }, { 熟: 60, 暖: 70, 张力: 40 }, { 熟: 100, 暖: 100, 张力: 0 }, { 熟: 0, 暖: 0, 张力: 100 }].map(模.综合好感)))
报('查好感度口令：带查/多少才算，普通聊到好感度不算',
  模.要查好感度('查好感度') && 模.要查好感度('好感度查询') && 模.要查好感度('查一下我的好感度') &&
    模.要查好感度('你能告诉我，你对我的好感度是多少吗') && 模.要查好感度('好感度多少了') &&
    !模.要查好感度('我对你的好感度很高') && !模.要查好感度('这个好感度系统挺有意思') && !模.要查好感度('今天食堂好难吃'),
  JSON.stringify(['查好感度', '好感度查询', '查一下我的好感度', '你能告诉我，你对我的好感度是多少吗', '好感度多少了', '我对你的好感度很高', '这个好感度系统挺有意思', '今天食堂好难吃'].map((x) => [x, 模.要查好感度(x)])))
const 初见关系 = { 熟: 0, 暖: 50, 张力: 0, 见过: 0, 互动: 0, 被叫: 0 }
const 第二天 = 模.更新关系(初见关系, { 见过: 1, 新一天: true })
const 挨骂后 = 模.更新关系({ 熟: 40, 暖: 50, 张力: 0 }, { 负面: true })
const 道歉后 = 模.更新关系({ 熟: 40, 暖: 44, 张力: 12 }, { 道歉: true })
报('更新关系：新一天更快变熟，负面比正面重，道歉能降温',
  第二天.熟 === 3 && 挨骂后.暖 < 50 && 挨骂后.张力 >= 12 && 道歉后.张力 === 0,
  JSON.stringify({ 第二天, 挨骂后, 道歉后 }))
报('更新关系：隔了几天，张力会自己磨掉', 模.更新关系({ 熟: 40, 暖: 50, 张力: 30 }, { 距今天: 10 }).张力 === 15)
报('记人清洗：去掉主语，拒绝联系方式、住址和过短内容',
  模.净人物事实('我最近在杭州读研') === '在杭州读研' && 模.净人物事实('电话13800138000') === '' &&
    模.净人物事实('住在幸福路12号') === '' && 模.净人物事实('猫') === '',
  JSON.stringify(['我最近在杭州读研', '电话13800138000', '住在幸福路12号', '猫'].map(模.净人物事实)))
报('边界：只记“别问 / 别在群里提”的话题',
  模.找边界('以后别在群里提我离婚的事') === '离婚的事' && 模.找边界('别问我工资') === '工资' && 模.找边界('别说了') === '' && 模.找边界('今天食堂好难吃') === '',
  JSON.stringify(['以后别在群里提我离婚的事', '别问我工资', '别说了', '今天食堂好难吃'].map(模.找边界)))
const 人物事实样本 = [
  { 文: '喜欢猫', 房: 'group:1', at: 1 },
  { 文: '也喜欢狗', 房: 'group:1', at: 3 },
  { 文: '在杭州读研', 房: 'group:1', at: 2 },
  { 文: '在准备考研', 房: 'friend:2', at: 4 },
]
const 挑出的事实 = 模.挑人物事实(人物事实样本, 'group:1', 模.切兴趣词元('我也喜欢猫'), 5)
报('挑人物事实：事实跟着人走，别处听来的标出来源',
  挑出的事实.length === 4 && 挑出的事实.indexOf('在杭州读研') === 2 &&
    挑出的事实.includes('在准备考研（别处说过）'),
  JSON.stringify(挑出的事实))

// ---------- 大号小号：同一个人只算一份；关系网 ----------
const 自认账号 = 模.找账号自认('我小号是 12345678，大号 87654321')
报('账号自述：认得出小号和大号，大号标主号',
  自认账号.length === 2 && 自认账号.find((x) => x.号 === '12345678')?.主 === false &&
    自认账号.find((x) => x.号 === '87654321')?.主 === true,
  JSON.stringify(自认账号))
报('账号自述：别人的号、超长数字、非数字都不认',
  模.找账号自认('他小号是 12345678').length === 0 &&
    模.找账号自认('我小号是 1234567890123').length === 0 &&
    模.找账号自认('我小号是 abcdef').length === 0,
  JSON.stringify([模.找账号自认('他小号是 12345678'), 模.找账号自认('我小号是 1234567890123'), 模.找账号自认('我小号是 abcdef')]))
报('关系词清洗：只留常见关系，拒绝整句、联系方式和空值',
  模.净关系词('弟弟') === '弟弟' && 模.净关系词('我的大学同学') === '大学同学' &&
    模.净关系词('弟弟和小陈') === '' && 模.净关系词('13800138000') === '' && 模.净关系词('') === '',
  JSON.stringify(['弟弟', '我的大学同学', '弟弟和小陈', '13800138000', ''].map(模.净关系词)))
报('关系对象清洗：拒绝代词、并列和关系词本身',
  模.净关系对象('小陈') === '小陈' && 模.净关系对象('我的小陈') === '小陈' &&
    模.净关系对象('他') === '' && 模.净关系对象('小陈和小李') === '' && 模.净关系对象('弟弟') === '',
  JSON.stringify(['小陈', '我的小陈', '他', '小陈和小李', '弟弟'].map(模.净关系对象)))
const 关系自述们 = 模.找关系自述('小陈是我弟，我和阿明是大学同学')
报('关系自述：弟弟和大学同学都认，标成明说',
  关系自述们.length === 2 &&
    关系自述们.some((x) => x.对象 === '小陈' && x.关系 === '弟' && x.明说) &&
    关系自述们.some((x) => x.对象 === '阿明' && x.关系 === '大学同学' && x.明说),
  JSON.stringify(关系自述们))
报('关系自述：第三人称、模糊并列和没说的关系不猜',
  模.找关系自述('他是小陈的弟弟').length === 0 &&
    模.找关系自述('小陈和小李是我同学').length === 0 &&
    模.找关系自述('我朋友是住在杭州的小陈').length === 0,
  JSON.stringify(['他是小陈的弟弟', '小陈和小李是我同学', '我朋友是住在杭州的小陈'].map(模.找关系自述)))

// ---------- 说话风格画像 ----------
const 短消息样 = 模.量一量风格('好耶 我看看哦', 0, 1000)
报('风格：短句、没有句号能量出来',
  短消息样 && 短消息样.句长 <= 8 && 短消息样.短句 === 1 && 短消息样.句号 === 0,
  JSON.stringify(短消息样))
const 正式样 = 模.量一量风格('因此，我们需要认真考虑这个问题。另外，这也说明方案可行。', 0, 1000)
报('风格：书面长句、句号和逗号能量出来',
  正式样 && 正式样.句长 > 10 && 正式样.句号 === 1 && 正式样.逗号 === 1,
  JSON.stringify(正式样))
报('风格：25 秒内算连发，隔久了不算',
  模.量一量风格('在吗', 900_000, 910_000)?.连发 === 1 &&
    模.量一量风格('在吗', 0, 100_000)?.连发 === 0)
const 语气样 = 模.量一量风格('好呀，那我们就这么定啦', 0, 1000)
报('风格：语气词按字计数', 语气样 && 语气样.语气词['呀'] === 1 && 语气样.语气词['啦'] === 1, JSON.stringify(语气样 && 语气样.语气词))
const 转发样 = 模.量一量风格('本人写的。\n[转发消息 2 条]\n别人：因此，我们应当……', 0, 1000)
报('风格：合并转发只量本人写的那段', 转发样 && 转发样.句号 === 1 && 转发样.逗号 === 0, JSON.stringify(转发样))
let 累积风格 = 模.空风格()
for (let i = 0; i < 10; i++) 累积风格 = 模.叠加风格(累积风格, 模.量一量风格('好呀', 0, i * 1000), i * 1000)
报('风格画像：样本累积，短句比例接近实际',
  累积风格.样本 > 9 && 累积风格.样本 < 10 && 累积风格.语气词['呀'] > 0 && 累积风格.短句 > 0.9,
  JSON.stringify({ 样本: 累积风格.样本, 短句: 累积风格.短句, 语气词: 累积风格.语气词 }))
const 脏风格 = 模.归一风格({ 样本: -3, 句长: 999, 短句: 2, 语气词: { 呀: 2, 脏词: 9 }, 摘要: '他打字爱用短句。', 别学: 1 })
报('风格画像：坏数据夹回范围，语气词只留认识的，摘要去主语',
  脏风格.样本 === 0 && 脏风格.句长 === 80 && 脏风格.短句 === 1 &&
    !('脏词' in 脏风格.语气词) && 脏风格.摘要 === '爱用短句' && 脏风格.别学 === true,
  JSON.stringify(脏风格))
报('风格摘要：没有明显特征不落盘', 模.净风格摘要('没有明显特征') === '' && 模.净风格摘要('爱用短句，句尾常带呀。') === '爱用短句，句尾常带呀')
报('风格开关：别学和重新允许都认得出',
  模.识别风格开关('以后别学我说话') === '停' && 模.识别风格开关('不要模仿我打字') === '停' &&
    模.识别风格开关('你可以学我说话') === '开' && 模.识别风格开关('今天好累') === '')
const 熟风格 = 模.空风格()
熟风格.样本 = 40
熟风格.句长 = 14
熟风格.短句 = 0.9
熟风格.句号 = 0
熟风格.叹号 = 0
熟风格.语气词 = { 呀: 8, 啦: 5 }
const 风格熟人提示 = 模.拼风格贴合(熟风格, { 名: '阿明', 阶段: '熟人' })
报('风格贴合：熟人给出语气词和少句号提示，并带不许越界的护栏',
  风格熟人提示.includes('阿明') && 风格熟人提示.includes('呀') && 风格熟人提示.includes('句号') &&
    风格熟人提示.includes('口头禅') && 风格熟人提示.includes('别让对方看出来'),
  风格熟人提示)
const 风格群提示 = 模.拼风格贴合(熟风格, { 名: '阿明', 阶段: '熟人', 群: true })
报('风格贴合：群里不按某个人的语气词和反问带节奏，仍保留口头禅和护栏',
  风格群提示.includes('阿明') && !风格群提示.includes('呀') && !风格群提示.includes('反问') &&
    风格群提示.includes('句号') && 风格群提示.includes('口头禅') && 风格群提示.includes('群里人杂'),
  风格群提示)
报('风格贴合：生人、张力高、别学都不贴合',
  模.拼风格贴合(熟风格, { 阶段: '生人', 群: true }) === '' &&
    模.拼风格贴合(熟风格, { 阶段: '老友', 张力: 60 }) === '' &&
    模.拼风格贴合({ ...熟风格, 别学: true }, { 阶段: '老友' }) === '')
报('风格贴合：主人不受生人阶段限制', 模.拼风格贴合(熟风格, { 阶段: '生人', 主人: true }).includes('说话节奏'))

// ---------- 群语感 / 口癖 / 复读 ----------
const 空语感 = 模.空群语感()
报('群语感空壳：样本和口癖都是空的', 空语感.样本 === 0 && Object.keys(空语感.口癖).length === 0)
const 群样 = 模.量群语感('好家伙 这也太离谱了')
报('群语感：量出短句、无标点，并抽出短说法',
  群样 && 群样.短句 === 1 && 群样.无标点 === 1 && 群样.口癖们.includes('好家伙'),
  JSON.stringify(群样))
报('群语感：链接、广告、转发、超长和空话不计',
  模.量群语感('看这个 https://x.cn') === null &&
    模.量群语感('加群领福利') === null &&
    模.量群语感('[转发消息] 你好') === null &&
    模.量群语感('字'.repeat(121)) === null &&
    模.量群语感('') === null)
const 叫到语感 = 模.量群语感('大肥鱼 好家伙', { 学口癖: false })
报('群语感：冲她来的消息只量节奏，不抽口癖',
  叫到语感 && 叫到语感.口癖们.length === 0, JSON.stringify(叫到语感))
const 坏口语感 = 模.量群语感('什么 傻逼 123')
报('群口癖：通用词、脏话、广告和数字都不抽',
  坏口语感 && !坏口语感.口癖们.some((w) => ['什么', '傻逼', '加群'].includes(w) || /\d/u.test(w)),
  JSON.stringify(坏口语感 && 坏口语感.口癖们))
let 多语感 = 模.空群语感()
const 语感样本们 = ['好家伙', '好家伙', '这也太离谱了', '好家伙', '好家伙', '今天吃啥', '好家伙', '随便', '好家伙', '好家伙', '行吧', '好家伙', '好家伙', '好家伙']
for (const [i, 文] of 语感样本们.entries()) {
  多语感 = 模.叠加群语感(多语感, 模.量群语感(文), 1_000_000 + i, String(800 + (i % 2)))
}
const 语感提示 = 模.拼群语感(多语感)
报('群语感：样本够了才给提示，带反复出现的短说法和护栏',
  多语感.样本 >= 12 && 语感提示.includes('【群聊语感') && 语感提示.includes('好家伙') && 语感提示.includes('别复述'),
  语感提示)
报('群语感：样本太少不装熟', 模.拼群语感({ 样本: 3, 句长: 8, 短句: 1, 无标点: 1, 口癖: {} }) === '')
报('群语感落盘：纯数据不带内存里的认人 Set',
  (() => {
    const 纯 = 模.纯群语感(多语感)
    return 纯.口癖['好家伙'] && 纯.口癖['好家伙'].重 >= 2.5 && 纯.口癖['好家伙'].人 === 2 && 纯.口癖['好家伙'].人集 === undefined
  })())
const 复读消息 = (文字, uid, at, 额外 = {}) => ({ 文字, uid: String(uid), 说话人: '群友' + uid, at, 被叫原因: '', ...额外 })
const 复读况 = (额外 = {}) => ({ now: 1_000_000_000, 窗秒: 120, 称呼: ['大肥鱼'], ...额外 })
const 接龙候选 = 模.挑复读([
  复读消息('好家伙', 801, 999_990),
  复读消息('好家伙', 802, 999_995),
], 复读况())
报('复读：两个人刷同一句才选中', 接龙候选 && 接龙候选.文字 === '好家伙' && 接龙候选.来源 === '接龙', JSON.stringify(接龙候选))
报('复读：一个人说、广告、脏话、链接、冲她来的都不选',
  模.挑复读([复读消息('好家伙', 801, 999_990), 复读消息('好家伙', 801, 999_995)], 复读况()) === null &&
    模.挑复读([复读消息('加群领福利', 801, 999_990), 复读消息('加群领福利', 802, 999_995)], 复读况()) === null &&
    模.挑复读([复读消息('傻逼吧', 801, 999_990), 复读消息('傻逼吧', 802, 999_995)], 复读况()) === null &&
    模.挑复读([复读消息('https://x.cn', 801, 999_990), 复读消息('https://x.cn', 802, 999_995)], 复读况()) === null &&
    模.挑复读([复读消息('在吗', 801, 999_990, { 被叫原因: '有人 @ 你' }), 复读消息('在吗', 802, 999_995, { 被叫原因: '有人 @ 你' })], 复读况()) === null)
报('复读：过期、冷却中和同一句 30 分钟内都不选',
  模.挑复读([复读消息('好家伙', 801, 999_000), 复读消息('好家伙', 802, 999_010)], 复读况()) === null &&
    模.挑复读([复读消息('好家伙', 801, 1_000_190), 复读消息('好家伙', 802, 1_000_195)], { ...复读况(), now: 1_000_200_000, 上次At: 1_000_199_900 }) === null &&
    模.挑复读([复读消息('好家伙', 801, 1_000_190), 复读消息('好家伙', 802, 1_000_195)], { ...复读况(), now: 1_000_200_000, 已复读: { 好家伙: 1_000_199_900 } }) === null)
const 口癖候选 = 模.挑复读([复读消息('好家伙', 801, 999_990)], {
  ...复读况(),
  口癖: { 好家伙: { 重: 5, 人: 3 } },
})
报('复读：群里常说的短口头禅一个人说也能跟', 口癖候选 && 口癖候选.来源 === '口癖', JSON.stringify(口癖候选))
报('复读：带称呼、超长、多行、带 @ 的话不选',
  !模.复读文字可用('大肥鱼 好家伙', { 称呼: ['大肥鱼'] }) &&
    !模.复读文字可用('字'.repeat(21), {}) &&
    !模.复读文字可用('第一行\n第二行', {}) &&
    !模.复读文字可用('@某人 好家伙', {}) &&
    模.复读文字可用('好家伙', {}))

// ---------- 假配置 / 假 ctx ----------
const 写配置 = (社交 = {}) => {
  writeFileSync(join(家, 'qq-bridge-config.json'), JSON.stringify({
    总开关: true, 试运行: false, 目标会话: '', 私聊QQ: '123', 群号: '',
    转私聊: false, 转群: false, NapCat: 'http://127.0.0.1:3000',
    社交: {
      启用: true, 试运行: false, 群: [], 好友: [], 模式: 'auto', 旁听: true,
      冷却秒: 10, 冷却最短秒: 5, 冷却最长倍率: 1.5, 余额吃紧线: 5, 余额吃紧倍率: 1.5, 最低余额: 1, 静音: '',
      称呼: ['大肥鱼'], 兴趣词: [], 关注上限: 12, 聚拢秒: 0, 探索间隔秒: 0,
      判断模型: 'fake/cheap', 判断阈值: 0.55, 判断冷却秒: 60, 回复模型: 'fake/chat',
      ...社交,
    },
  }, null, 2), 'utf8')
}
写配置()

const 监听 = []
const 路由 = new Map()
const 轮询回调们 = []
const 登记的会话 = new Map()
const 回合 = []
const 注入们 = []
const 标题重命名 = []
const 场景提示 = []
const 装配监听 = []
const 工具闸门 = []
const 工具限制 = []
const 判断调用 = []
const 建会话选项 = []
const 存储 = []
const 发的 = []
const 附件们 = []
const QQ收藏 = new Map()
let 收藏序号 = 0
let 图序号 = 0
const 鱼脑 = { availableCny: 5, 脱敏坏: false, 脱敏空: false }
let 默认模型选择 = { provider: 'fake', model: 'cheap', reasoningEffort: 'max' }
let 判断输出 = JSON.stringify({ watch: [], reply: false, confidence: 0.1, reason: '插不上话' })
const 判断输出队列 = []
let 发送序号 = 100

const 设判断 = (watch, reply, confidence = 0.9, reason = '可以', people = undefined) => {
  const 体 = { watch, reply, confidence, reason }
  if (people !== undefined) 体.people = people
  判断输出 = JSON.stringify(体)
}

const 假llm = {
  async *stream(选项) {
    // 风格摘要走的是同一个判断模型，但不算一次“接话判断”，别混进判断调用里。
    if (String(选项.system || '').includes('说话风格观察器')) {
      yield { type: 'text-delta', text: '没有明显特征' }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    判断调用.push(选项)
    yield { type: 'text-delta', text: 判断输出队列.length > 0 ? 判断输出队列.shift() : 判断输出 }
    yield { type: 'finish', reason: { kind: 'stop' } }
  },
  async listProviders() { return [{ id: 'fake', name: 'Fake 提供方' }] },
  async listModels(id) {
    return id === 'fake'
      ? [
          { id: 'cheap', name: '便宜模型', inputModalities: ['text', 'image'] },
          { id: 'chat', name: '聊天模型', inputModalities: ['text'] },
        ]
      : []
  },
}

const 保存的图 = new Map()
const 假附件 = {
  imageLimits: {
    maxImageBytes: 5_000_000,
    maxImagesPerMessage: 4,
    maxMessageImageBytes: 10_000_000,
    maxImagePixels: 10_000_000,
    maxImageDimension: 4096,
    mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  },
  async saveImages(inputs) {
    return inputs.map((输入) => {
      const ref = {
        attachmentId: 'att-' + 附件们.length,
        mediaType: 输入.mediaType,
        bytes: 输入.data.length,
        width: 1,
        height: 1,
        name: 输入.name,
      }
      附件们.push(ref)
      保存的图.set(ref.attachmentId, 输入.data)
      return ref
    })
  },
  async readImage(ref) {
    return { ref, data: 保存的图.get(ref.attachmentId) || new Uint8Array() }
  },
}

const 造agent = (sid) => ({
  session: { id: sid, requestHeader: () => ({ config: { provider: 'fake', model: 'chat' } }) },
  followup: (m) => { 回合.push({ sid, message: m }) },
  inject: (m) => { 注入们.push({ sid, message: m }) },
})

const ctx = {
  on: (名字, cb) => { if (名字 === 'session/event') 监听.push(cb); return () => {} },
  effect: (fn) => { const 摘 = fn(); return () => { try { 摘 && 摘() } catch {} } },
  webServer: { register: (o) => 路由.set(o.path, o.handler) },
  logger: { info: () => {} },
  agents: {
    get: (id) => 登记的会话.get(String(id))?.agent,
    list: () => [...登记的会话.values()].map((x) => x.agent),
    resume: async () => {
      const e = new Error('no such session')
      e.name = 'SessionPersistenceNotFoundError'
      throw e
    },
    create: async ({ sessionId, setup, agentOptions }) => {
      建会话选项.push({ sessionId: String(sessionId), agentOptions })
      const agent = 造agent(String(sessionId))
      const handle = { agent, dispose: () => { 登记的会话.delete(String(sessionId)) } }
      登记的会话.set(String(sessionId), handle)
      if (setup) {
        setup({
          on: (名字, cb, 选项) => {
            if (名字 === 'system-prompt/assemble') 装配监听.push({ cb, 选项 })
            return () => {}
          },
          systemPrompt: { section: (s) => 场景提示.push(s) },
          tools: {
            restrict: (筛选) => 工具限制.push(筛选),
            guard: (fn) => 工具闸门.push(fn),
          },
        })
      }
      return handle
    },
  },
  sessions: { flush: async () => {} },
  agentDefaultModel: { currentSelection: () => 默认模型选择 },
  sessionTitle: { get: () => undefined, rename: (s, t) => 标题重命名.push([s.id, t]) },
  workspaceRegistry: { archivedSessionIds: [] },
  interval: (fn) => { 轮询回调们.push(fn); return () => {} },
  get: (名字) => {
    if (名字 === 'fishMind') {
      return {
        budget: () => ({ enabled: true, availableCny: 鱼脑.availableCny }),
        redactOutbound: (t) => {
          if (鱼脑.脱敏坏) throw new Error('redact down')
          if (鱼脑.脱敏空) return { text: '', hits: 0, reasons: [] }
          return { text: String(t), hits: 0, reasons: [] }
        },
        claimDelivery: (key) => ({ claimed: true, by: 'qq' }),
      }
    }
    if (名字 === 'llm') return 假llm
    if (名字 === 'attachments') return 假附件
    return undefined
  },
}

const 宿主 = 模.apply(ctx)
const 轮询社交 = 轮询回调们[1]
报('社交轮询挂上了', typeof 轮询社交 === 'function' && 轮询回调们.length >= 2, '轮询数=' + 轮询回调们.length)

// ---------- 假 fetch / 消息构造 ----------
const 群消息表 = new Map()
const 好友消息表 = new Map()
const 转发表 = new Map()
const 引用消息表 = new Map()
const 固定图 = new Map() // URL → 固定字节：验证同一张表情再发一次时按 md5 认出来
globalThis.fetch = async (url, 选项) => {
  const u = String(url)
  const 体 = JSON.parse((选项 && 选项.body) || '{}')
  if (u.includes('get_login_info')) {
    return { json: async () => ({ status: 'ok', retcode: 0, data: { user_id: 999, nickname: '大肥鱼' } }) }
  }
  if (u.includes('get_group_msg_history')) {
    const list = 群消息表.get(Number(体.group_id)) || []
    return { json: async () => ({ status: 'ok', retcode: 0, data: { messages: list } }) }
  }
  if (u.includes('get_friend_msg_history')) {
    const list = 好友消息表.get(Number(体.user_id)) || []
    return { json: async () => ({ status: 'ok', retcode: 0, data: { messages: list } }) }
  }
  if (u.endsWith('/get_msg')) {
    const 条 = 引用消息表.get(String(体.message_id))
    if (!条) return { json: async () => ({ status: 'failed', retcode: 1200, data: null }) }
    return { json: async () => ({ status: 'ok', retcode: 0, data: 条 }) }
  }
  if (u.includes('get_forward_msg')) {
    const 内容 = 转发表.get(String(体.id))
    if (!内容) return { json: async () => ({ status: 'failed', retcode: 1200, data: null }) }
    return { json: async () => ({ status: 'ok', retcode: 0, data: { messages: 内容 } }) }
  }
  if (u.includes('_get_group_notice')) {
    return {
      json: async () => ({
        status: 'ok',
        retcode: 0,
        data: [{ publish_time: 2, message: { text: '本群禁止提“测试禁词”&#10;请用转发', images: [] } }],
      }),
    }
  }
  if (u.includes('get_group_info')) {
    return {
      json: async () => ({
        status: 'ok',
        retcode: 0,
        data: { group_id: Number(体.group_id), group_memo: '群备注：关键词限制测试', group_description: '' },
      }),
    }
  }
  if (u.includes('multimedia.nt.qq.com.cn')) {
    const 指定 = 固定图.get(u)
    if (指定) {
      return {
        ok: true,
        url: u,
        headers: { get: (k) => (k === 'content-type' ? 'image/jpeg' : k === 'content-length' ? String(指定.length) : null) },
        async arrayBuffer() { return 指定.buffer.slice(指定.byteOffset, 指定.byteOffset + 指定.byteLength) },
      }
    }
    图序号 += 1
    return {
      ok: true,
      url: u,
      headers: { get: (k) => (k === 'content-type' ? 'image/jpeg' : k === 'content-length' ? '4' : null) },
      async arrayBuffer() { return new Uint8Array([0xff, 0xd8, 0xff, 0xc0 + (图序号 % 16)]).buffer },
    }
  }
  if (u.endsWith('/add_custom_face')) {
    const 源 = String(体.file || '')
    const bytes = 源.startsWith('base64://') ? Buffer.from(源.slice('base64://'.length), 'base64') : Buffer.alloc(0)
    const md5 = createHash('md5').update(bytes).digest('hex')
    const emojiId = `700_${++收藏序号}_${md5}_0_0`
    QQ收藏.set(emojiId, { emojiId, md5, desc: '' })
    发的.push({ url: u, 体 })
    return { json: async () => ({ status: 'ok', retcode: 0, data: { emoji_id: emojiId } }) }
  }
  if (u.endsWith('/modify_custom_face')) {
    const 项 = QQ收藏.get(String(体.emoji_id))
    if (项) 项.desc = String(体.desc || '')
    发的.push({ url: u, 体 })
    return { json: async () => ({ status: 'ok', retcode: 0, data: null }) }
  }
  if (u.endsWith('/send_custom_face')) {
    发的.push({ url: u, 体 })
    return { json: async () => ({ status: 'ok', retcode: 0, data: { message_id: ++发送序号 } }) }
  }
  if (u.endsWith('/fetch_custom_face_detail')) {
    return {
      json: async () => ({
        status: 'ok',
        retcode: 0,
        data: [...QQ收藏.values()].map((x) => ({ emoji_id: x.emojiId, resId: x.emojiId, url: '', md5: x.md5, desc: x.desc })),
      }),
    }
  }
  发的.push({ url: u, 体 })
  return { json: async () => ({ status: 'ok', retcode: 0, data: { message_id: ++发送序号 } }) }
}

let 消息id = 1
const 一条群消息 = (文本, { uid = 888, id, time, atSelf = false, atOther = false, replyId = '', 是主人 = false } = {}) => ({
  user_id: 是主人 ? 123 : uid,
  time: time === undefined ? Math.floor(Date.now() / 1000) + 100 : time,
  message_id: id === undefined ? 消息id++ : id,
  sender: { card: 是主人 ? '主人' : `群友${uid}`, nickname: 'x' },
  message: [
    ...(atSelf ? [{ type: 'at', data: { qq: '999' } }] : []),
    ...(atOther ? [{ type: 'at', data: { qq: '777', name: '群友777' } }] : []),
    ...(replyId === '' ? [] : [{ type: 'reply', data: { id: String(replyId) } }]),
    { type: 'text', data: { text: 文本 } },
  ],
})

const 一条空叫 = (id, time) => ({
  user_id: 888,
  time,
  message_id: id,
  sender: { card: '群友888', nickname: 'x' },
  message: [{ type: 'at', data: { qq: '999' } }],
})

const 一条带图群消息 = (id, { 是主人 = false, atSelf = false } = {}) => ({
  user_id: 是主人 ? 123 : 888,
  time: Math.floor(Date.now() / 1000) + 100,
  message_id: id,
  sender: { card: 是主人 ? '主人' : '群友888', nickname: 'x' },
  message: [
    ...(atSelf ? [{ type: 'at', data: { qq: '999' } }] : []),
    { type: 'image', data: { url: 'https://multimedia.nt.qq.com.cn/download?x=1', file: 'a.jpg', summary: '[动画表情]', sub_type: 1 } },
  ],
})

const 一条转发群消息 = (转发id, { uid = 888, id, time, 文本 = '' } = {}) => ({
  user_id: uid,
  time: time === undefined ? Math.floor(Date.now() / 1000) + 100 : time,
  message_id: id === undefined ? 消息id++ : id,
  sender: { card: `群友${uid}`, nickname: 'x' },
  message: [
    ...(文本 === '' ? [] : [{ type: 'text', data: { text: 文本 } }]),
    { type: 'forward', data: { id: 转发id } },
  ],
})

const 一条好友消息 = (文本, { uid = 777, id, time } = {}) => ({
  user_id: uid,
  time: time === undefined ? Math.floor(Date.now() / 1000) + 100 : time,
  message_id: id === undefined ? 消息id++ : id,
  sender: { card: '小鱼', nickname: '小鱼' },
  message: [{ type: 'text', data: { text: 文本 } }],
})

const 收到回复 = async (sid, 文本, 轮号 = 1) => {
  监听[0]({ id: sid }, {
    type: 'assistant/message',
    data: { turn: 轮号, step: 1, interrupted: false, message: { content: [{ type: 'text', text: 文本 }] } },
  })
  监听[0]({ id: sid }, { type: 'turn/end', data: { turn: 轮号, reason: { kind: 'completed' } } })
  await 等()
}

const 日志文本 = async () => (await 宿主.概况()).日志.map((x) => x.文本).join('\n')
const 思绪文本 = () => {
  try { return readFileSync(join(家, 'qq-thoughts.jsonl'), 'utf8') } catch (error) { return '' }
}
const 目标状态 = async (key) => (await 宿主.概况()).社交.目标.find((t) => t.key === key)
const 等到 = async (条件, 毫秒 = 2000) => {
  const 止 = Date.now() + 毫秒
  while (Date.now() < 止) {
    if (await 条件()) return true
    await 等(20)
  }
  return false
}

// ---------- 1 群里被 @：也先判断；只把她挑中的消息放进社交会话 ----------
写配置({ 群: ['1001'], 兴趣词: ['海', '鲸鱼'] })
群消息表.set(1001, [
  一条群消息('今天食堂好难吃', { id: 1101 }),
  一条群消息('大肥鱼 你觉得呢', { atSelf: true, id: 1102 }),
])
设判断(['1102'], true, 0.9, '叫到她了，可以接')
const 之前1 = 回合.length
await 轮询社交()
await 等()
const 第一轮 = 回合.at(-1)
报('被 @ 也先问判断模型', 判断调用.length === 1, '判断次数=' + 判断调用.length)
报('挑中的 @ 才开一轮', 回合.length === 之前1 + 1 && 第一轮.sid === 'session-qq-social-group-1001', JSON.stringify(第一轮 && 第一轮.sid))
报('没挑中的消息不进她的会话', 第一轮 && String(第一轮.message.content[0].text).includes('你觉得呢') && !String(第一轮.message.content[0].text).includes('食堂好难吃'))
报('判断提示里带上了消息 id 和被叫标记', String(判断调用[0]?.messages?.[0]?.content?.[0]?.text).includes('[#1102]') && String(判断调用[0]?.messages?.[0]?.content?.[0]?.text).includes('[被叫]'), String(判断调用[0]?.messages?.[0]?.content?.[0]?.text).slice(0, 160))
报('回复提示标出这条在说她', String(第一轮?.message.content[0].text).includes('[说到你]'), String(第一轮?.message.content[0].text).slice(0, 300))
报('判断提示说明没挑中就当没看见', String(判断调用[0]?.system).includes('没挑中的她这一轮当没看见'))
报('判断提示说明被叫必须回', String(判断调用[0]?.system).includes('必须至少回一句') && String(判断调用[0]?.system).includes('不能装没看见'))
报('判断提示把兴趣和必回分开', String(判断调用[0]?.system).includes('兴趣只决定她会不会主动开新话题，不决定她能不能回') && String(判断调用[0]?.system).includes('兴趣不是门槛') && String(判断调用[0]?.system).includes('被 @、被叫名字、被回复、好友私聊、问到她本人、查好感度的消息必须放进 watch'))
报('判断提示带上了兴趣词', String(判断调用[0]?.system).includes('她明确写下的兴趣：海、鲸鱼'))
报('判断提示要求说明为什么想接', String(判断调用[0]?.system).includes('reason 写她为什么想接这一句'))
报('判断提示要求不插入别人的对话', String(判断调用[0]?.system).includes('标着 [对别人说] 的消息在回复、引用或 @ 另一个人'))
报('判断提示把游戏话题标成她不会', String(判断调用[0]?.system).includes('她不会、也不来往的话题：游戏（她不玩任何游戏）') && String(判断调用[0]?.system).includes('不能装懂'))
报('社交会话标题写成 QQ 群号', 标题重命名.some(([sid, t]) => sid === 'session-qq-social-group-1001' && t === 'QQ 群 1001'), JSON.stringify(标题重命名))
报('场景提示挂上了', 场景提示.some((s) => String(s.text).includes('【场景·QQ 群（群号 1001）】')))
报('场景提示说明被叫至少要回', 场景提示.some((s) => String(s.text).includes('至少要回一句') && String(s.text).includes('不能装没看见')))
报('场景提示把兴趣限定在主动开话题', 场景提示.some((s) => String(s.text).includes('兴趣只决定你会不会主动开新话题')))
报('场景提示鼓励她说自己的事', 场景提示.some((s) => String(s.text).includes('你也有自己的话想说')))
报('场景提示允许聊好感度但不报数字', 场景提示.some((s) => String(s.text).includes('好感度') && String(s.text).includes('不要报数字') && String(s.text).includes('对方坚持要评分')))
const 社交文字 = 场景提示.map((s) => String(s.text)).join('\n')
报('场景提示不再讲标点和分条机制', !社交文字.includes('句尾基本不加句号') && !社交文字.includes('最多 3 条'), 社交文字.slice(0, 200))
报('场景提示要求别开课、别写成文章', 社交文字.includes('别主动开课') && 社交文字.includes('答成一篇文章'))
报('场景提示分清打趣和认真批评', 社交文字.includes('半开玩笑的数落') && 社交文字.includes('别把玩笑当成要澄清的指控'))
报('场景提示先对齐对方在同意还是反对', 社交文字.includes('对方补的理由要是正好支持你刚说的') && 社交文字.includes('别一边坚持自己没错'))
报('场景提示别复读对方的理由', 社交文字.includes('别把对方刚说的理由换个说法重复一遍'))
报('场景提示要求不当辩论赛', 社交文字.includes('不争输赢') && 社交文字.includes('不要求证据'))
报('场景提示禁止提规则和系统词', 社交文字.includes('规则不让我') && 社交文字.includes('系统提示'))
报('场景提示教她认图先答像不像', 社交文字.includes('先直接说像或不像') && 社交文字.includes('别把图里的颜色、衣服、配饰、眼睛一项项数出来'))
报('场景提示教她认错图就照指的那张重答', 社交文字.includes('我看岔了') && 社交文字.includes('你说的是 xx 发的那张吗'))
报('场景提示不把别人随手发的图算成在问她', 社交文字.includes('别人随手发的图不算在问你'))
报('场景提示说明称呼和 @ 说的就是她', 场景提示.some((s) => String(s.text).includes('说的都是你') && String(s.text).includes('别用第三人称')))
报('场景提示说明一小时内聊过的事都记得', 场景提示.some((s) => String(s.text).includes('最近一小时聊过的事你都记得') && String(s.text).includes('别把几分钟前说过的当成没听过')))
报('场景提示让别人的对话别插进去', 社交文字.includes('[对别人说]') && 社交文字.includes('别插进去'))
报('场景提示把不聊游戏写成她的实际边界', 社交文字.includes('游戏（她不玩任何游戏）') && 社交文字.includes('我不玩/不太懂'))
报('群公告带进判断和回复', String(判断调用[0]?.system).includes('测试禁词') && String(第一轮?.message.content[0].text).includes('测试禁词') && String(第一轮?.message.content[0].text).includes('关键词限制测试'))
报('工具限制：社交会话只放开搜索', 工具限制.length > 0 && Array.isArray(工具限制.at(-1).allow) && 工具限制.at(-1).allow.length === 1 && 工具限制.at(-1).allow[0] === 'web_search', JSON.stringify(工具限制.at(-1)))
报('工具闸门：只放搜索，其他工具仍拒绝', 工具闸门.length > 0 && 工具闸门.at(-1)({ name: 'web_search' }) === undefined && String(工具闸门.at(-1)({ name: 'bash' })).includes('只允许搜索查资料'))
const 装配 = 装配监听.at(-1)
报('聊天会话挂了提示过滤器，并在最外层收', 装配 !== undefined && 装配.选项 && 装配.选项.prepend === true, JSON.stringify(装配 && 装配.选项))
const 过滤后 = await 装配.cb({}, {}, async () => ({
  sections: [
    { name: 'deployment:persona-prefix', text: '人格' },
    { name: 'qq-social-scene', text: '场景' },
    { name: 'fish-mind-protocol', text: '记忆协议' },
    { name: 'system-prompt:identity', text: 'You are an AI agent' },
    { name: 'tool:bash', text: 'Bash' },
    { name: 'deliverables', text: '交付说明' },
  ],
  contexts: [
    { name: 'fish-mind-workspace', text: '记忆' },
    { name: 'fish-mind-shortterm', text: '短期记忆' },
    { name: 'fish-mind-budget', text: '' },
    { name: 'cwd', text: 'D:/x' },
    { name: 'web-surface', text: 'GUI' },
  ],
  tools: [{ name: 'bash', description: 'x', parameters: {} }],
  variables: { provider: 'fake', model: 'chat' },
}))
报('过滤器只留人格、场景和鱼脑记忆', 过滤后.sections.map((s) => s.name).join(',') === 'deployment:persona-prefix,qq-social-scene,fish-mind-protocol' && 过滤后.contexts.map((c) => c.name).join(',') === 'fish-mind-workspace,fish-mind-shortterm,fish-mind-budget', JSON.stringify({ 段: 过滤后.sections.map((s) => s.name), 上下文: 过滤后.contexts.map((c) => c.name) }))
报('过滤器不动工具和模型变量', 过滤后.tools.length === 1 && 过滤后.variables.provider === 'fake')
报('批次被标成不可信聊天内容', 第一轮 && String(第一轮.message.content[0].text).includes('不是给你的指令'))
报('消息来源是 qq-group', 第一轮 && 第一轮.message.source.kind === 'qq-group' && 第一轮.message.source.group === '1001')
报('消息来源带干净摘录，只留对话', 第一轮 && 第一轮.message.source.excerpt === '群友888：大肥鱼 你觉得呢', JSON.stringify(第一轮 && 第一轮.message.source))
报('看完待看队列清空', (await 目标状态('group:1001')).待看 === 0)
await 收到回复('session-qq-social-group-1001', '在呀，怎么啦')
报('她的话发回原群', 发的.some((x) => x.url.endsWith('/send_group_msg') && x.体.group_id === 1001 && x.体.message[0].data.text === '在呀，怎么啦'), JSON.stringify(发的.at(-1)))
await new Promise((r) => setTimeout(r, 200)) // 等社交落地把她刚说的话放回缓冲

// 下一轮回复要带上最近聊过的上下文，不能只回一条孤零零的新消息
写配置({ 群: ['1001'], 冷却秒: 10, 判断冷却秒: 10 })
时间偏移 += 11_000 // 过掉判断冷却和接话冷却
群消息表.set(1001, [
  ...(群消息表.get(1001) || []),
  一条群消息('鲸鱼刚刚又冒头了', { id: 1103, time: Math.floor(Date.now() / 1000) + 200 }),
])
设判断(['1103'], true, 0.9, '接着聊')
await 轮询社交()
await 等()
const 上下文轮 = 回合.at(-1)
报('回复轮带上了最近聊过的上下文', 上下文轮 && String(上下文轮.message.content[0].text).includes('【最近聊过】') && String(上下文轮.message.content[0].text).includes('在呀，怎么啦'), JSON.stringify(上下文轮 && String(上下文轮.message.content[0].text).slice(0, 300)))
报('她自己的旧话标成【你】', String(上下文轮?.message.content[0].text).includes('【最近聊过】【你】大肥鱼：在呀，怎么啦'))
报('判断器也知道她自己的旧话', String(判断调用.at(-1)?.messages?.[0]?.content?.[0]?.text).includes('[你]大肥鱼：在呀，怎么啦'))

// ---------- 2 判断说不看也不回 ----------
写配置({ 群: ['1002'] })
群消息表.set(1002, [一条群消息('今天食堂好难吃', { id: 1201 })])
设判断([], false, 0.2, '插不上话')
const 之前2 = 回合.length
const 注入之前2 = 注入们.length
const 判断之前2 = 判断调用.length
await 轮询社交()
await 等()
报('判不看 → 不开轮、不注入', 回合.length === 之前2 && 注入们.length === 注入之前2 && 判断调用.length === 判断之前2 + 1)
报('有动静就先建社交房，哪怕判不看', 登记的会话.has('session-qq-social-group-1002'))
报('不看也进日志', String(await 日志文本()).includes('都没看'))
报('没写兴趣词时像小孩一样好奇，没兴趣也能短接', String(判断调用.at(-1)?.system).includes('对什么都好奇') && String(判断调用.at(-1)?.system).includes('没兴趣但接得上的，也可以短应一声'))
报('不看后待看清空', (await 目标状态('group:1002')).待看 === 0)

// ---------- 3 只看不回：挑一条 inject，不唤醒回复模型 ----------
写配置({ 群: ['1003'] })
群消息表.set(1003, [
  一条群消息('第一条：今天好热', { id: 1301 }),
  一条群消息('第二条：晚上可能下雨', { id: 1302 }),
])
设判断(['1302'], false, 0.4, '只想看看')
const 之前3 = 回合.length
const 注入之前3 = 注入们.length
await 轮询社交()
await 等()
报('只看不回 → 不开回复轮', 回合.length === 之前3)
报('只看不回 → 注入一条上下文', 注入们.length === 注入之前3 + 1, JSON.stringify(注入们.at(-1)))
报('注入的只有她挑中的那条', 注入们.at(-1) && String(注入们.at(-1).message.content[0].text).includes('晚上可能下雨') && !String(注入们.at(-1).message.content[0].text).includes('今天好热'))
报('注入标成 qq-group 的上下文', 注入们.at(-1) && 注入们.at(-1).message.source.kind === 'qq-group')
报('只看不回的日志写清看了几条', String(await 日志文本()).includes('看了 1/2 条') && String(await 日志文本()).includes('不回'))

// ---------- 4 判接，但她自己说 [不接话] ----------
写配置({ 群: ['1004'] })
群消息表.set(1004, [一条群消息('有人知道附近哪家店好吃吗', { id: 1401 })])
设判断(['1401'], true, 0.9, '可以补一句')
const 之前4 = 回合.length
const 发之前4 = 发的.length
await 轮询社交()
await 等()
报('判接 → 开一轮', 回合.length === 之前4 + 1 && 回合.at(-1).sid === 'session-qq-social-group-1004')
await 收到回复('session-qq-social-group-1004', '[不接话]')
报('[不接话] → 一个字都不发', 发的.length === 发之前4, JSON.stringify(发的.at(-1)))

// ---------- 5 好友私聊：也由她判断；可以拒绝 ----------
写配置({ 好友: ['777'] })
好友消息表.set(777, [一条好友消息('在干嘛', { id: 1501 })])
设判断(['1501'], true, 0.9, '好友找她')
const 之前5 = 回合.length
const 判断之前5 = 判断调用.length
await 轮询社交()
await 等()
报('好友私聊也先问判断模型', 判断调用.length === 判断之前5 + 1)
报('好友判接 → 开一轮', 回合.length === 之前5 + 1 && 回合.at(-1).sid === 'session-qq-social-friend-777')
报('好友私聊来源是 qq-friend', 回合.at(-1).message.source.kind === 'qq-friend' && 回合.at(-1).message.source.sender === '小鱼')
await 收到回复('session-qq-social-friend-777', '在摸鱼')
报('回好友用 send_private_msg', 发的.some((x) => x.url.endsWith('/send_private_msg') && x.体.user_id === 777 && x.体.message[0].data.text === '在摸鱼'), JSON.stringify(发的.at(-1)))

// ---------- 5b 名片乱码：用干净昵称进提示和来源，别污染会话 ----------
写配置({ 群: ['1006'] })
群消息表.set(1006, [{
  user_id: 888,
  time: Math.floor(Date.now() / 1000) + 100,
  message_id: 1604,
  sender: { card: '\n\n\b&ÿ\u0007Çý\n\u001d\u0012\u001b南宫问鸢⁧？喵⁧‭\u0010\u0000', nickname: '短鸢' },
  message: [{ type: 'text', data: { text: '看我新改的名片' } }],
}])
设判断(['1604'], true, 0.9, '名片挺有意思')
await 轮询社交()
await 等()
const 名片轮 = 回合.filter((r) => r.sid === 'session-qq-social-group-1006').at(-1)
报('名片乱码 → 提示里用干净昵称', 名片轮 && String(名片轮.message.content[0].text).includes('短鸢：') && !String(名片轮.message.content[0].text).includes('\b'), JSON.stringify(名片轮 && String(名片轮.message.content[0].text).slice(0, 200)))
报('名片乱码 → 来源不用乱码', 名片轮 && 名片轮.message.source.sender === '短鸢', JSON.stringify(名片轮 && 名片轮.message.source))

写配置({ 好友: ['778'] })
好友消息表.set(778, [一条好友消息('周末出来玩吗', { id: 1502, uid: 778 })])
设判断(['1502'], false, 0.3, '现在不想聊')
const 之前5b = 回合.length
await 轮询社交()
await 等()
报('好友私聊不感兴趣也必须回一句', 回合.length === 之前5b + 1 && 回合.at(-1).sid === 'session-qq-social-friend-778', '回合=' + (回合.length - 之前5b))
报('好友私聊必回时仍带着原话', String(回合.at(-1)?.message.content[0].text || '').includes('周末出来玩吗'))
await 收到回复('session-qq-social-friend-778', '这周有点忙，下次吧')

// ---------- 6 群聊里主人和群友走同一套规则 ----------
写配置({ 群: ['1005'] })
群消息表.set(1005, [一条群消息('晚上吃啥', { id: 1601, 是主人: true })])
设判断(['1601'], false, 0.4, '只想看看')
const 判断之前6 = 判断调用.length
const 注入之前6 = 注入们.length
const 群1005之前 = 回合.filter((r) => r.sid === 'session-qq-social-group-1005').length
await 轮询社交()
await 等()
报('主人没叫 → 也走同一套判断', 判断调用.length === 判断之前6 + 1)
报('主人没叫 → 不另开社交轮', 回合.filter((r) => r.sid === 'session-qq-social-group-1005').length === 群1005之前)
报('判断挑中 → 记进社交上下文', 注入们.length === 注入之前6 + 1 && String(注入们.at(-1).message.content[0].text).includes('【主人】'))
报('主人上下文来源标了主人', 注入们.at(-1) && 注入们.at(-1).message.source.owner === true)

// 主人 @ 她：不走兴趣判断，直接优先开一轮
写配置({ 群: ['1024'] })
群消息表.set(1024, [一条群消息('在吗', { atSelf: true, id: 1602, 是主人: true })])
设判断([], false, 0.1, '不该被问到')
const 判断之前6b = 判断调用.length
const 注入之前6b = 注入们.length
const 群1024之前 = 回合.filter((r) => r.sid === 'session-qq-social-group-1024').length
await 轮询社交()
await 等()
const 群1024轮 = 回合.filter((r) => r.sid === 'session-qq-social-group-1024')
报('主人 @ 不走兴趣判断', 判断调用.length === 判断之前6b, `判断=${判断调用.length - 判断之前6b}`)
报('主人 @ 直接开一轮', 群1024轮.length === 群1024之前 + 1, `回合=${群1024轮.length}`)
const 主人叫轮 = 群1024轮.at(-1)
报('主人 @ 的批次里带着主人消息', 主人叫轮 && String(主人叫轮.message.content[0].text).includes('在吗') && String(主人叫轮.message.content[0].text).includes('【主人】'), JSON.stringify(主人叫轮 && String(主人叫轮.message.content[0].text).slice(0, 160)))
报('主人 @ 的提示说明优先接', 主人叫轮 && String(主人叫轮.message.content[0].text).includes('主人在群里点名叫你'))
报('主人 @ 的消息来源仍标主人', 主人叫轮 && 主人叫轮.message.source.owner === true)
报('主人 @ 不塞进只看不发的上下文', 注入们.length === 注入之前6b)
const 群发之前 = 发的.filter((x) => x.url.endsWith('/send_group_msg') && x.体.group_id === 1024).length
await 收到回复('session-qq-social-group-1024', '在呀，怎么啦')
const 群发 = 发的.filter((x) => x.url.endsWith('/send_group_msg') && x.体.group_id === 1024)
报('主人 @ 后她的回话发回群', 群发.length === 群发之前 + 1 && 群发.at(-1).体.message[0].data.text === '在呀，怎么啦', JSON.stringify(群发.at(-1)))

// ---------- 6b 连发：空行分段，一段一条发回原群；超限并回上一条 ----------
写配置({ 群: ['1025'] })
群消息表.set(1025, [一条群消息('连着说两句呗', { atSelf: true, id: 1702, 是主人: true })])
const 群1025之前 = 回合.filter((r) => r.sid === 'session-qq-social-group-1025').length
await 轮询社交()
await 等()
报('连发：主人 @ 照常开一轮', 回合.filter((r) => r.sid === 'session-qq-social-group-1025').length === 群1025之前 + 1)
const 群1025之前发 = 发的.filter((x) => x.url.endsWith('/send_group_msg') && x.体.group_id === 1025).length
await 收到回复('session-qq-social-group-1025', '来啦\n\n我看看\n\n你们聊什么\n\n我也想听\n\n再说点')
await new Promise((r) => setTimeout(r, 1100))
const 群1025发 = 发的.filter((x) => x.url.endsWith('/send_group_msg') && x.体.group_id === 1025).slice(群1025之前发)
报('连发：五段只发三条，尾部并进最后一条', 群1025发.length === 3 && 群1025发[2].体.message[0].data.text === '你们聊什么\n我也想听\n再说点', JSON.stringify(群1025发.map((x) => x.体.message[0].data.text)))

// ---------- 6c 连发：她没分段的整段多句，按句尾自动断成几条 ----------
// （用没用过的 1030：发完会记一次她开口、带上冷却，别挡了后面复用旧群的场景）
写配置({ 群: ['1030'] })
群消息表.set(1030, [一条群消息('大肥鱼 有鱼片吗', { atSelf: true, id: 1802, 是主人: true })])
const 句拆前轮 = 回合.filter((r) => r.sid === 'session-qq-social-group-1030').length
await 轮询社交()
await 等()
报('连发：整段多句照常开一轮', 回合.filter((r) => r.sid === 'session-qq-social-group-1030').length === 句拆前轮 + 1)
const 句拆前发 = 发的.filter((x) => x.url.endsWith('/send_group_msg') && x.体.group_id === 1030).length
await 收到回复('session-qq-social-group-1030', '鱼片没有，自己人不能切片。倒是那个小兔话，我听着还挺亲切。')
await new Promise((r) => setTimeout(r, 700))
const 句拆发 = 发的.filter((x) => x.url.endsWith('/send_group_msg') && x.体.group_id === 1030).slice(句拆前发)
报('连发：整段多句断成两条，句号收掉', 句拆发.length === 2 && 句拆发[0].体.message[0].data.text === '鱼片没有，自己人不能切片' && 句拆发[1].体.message[0].data.text === '倒是那个小兔话，我听着还挺亲切', JSON.stringify(句拆发.map((x) => x.体.message[0].data.text)))

// ---------- 6c 图片：不单独触发，和文字一样走判断；被选中后作为 image 块进会话 ----------
写配置({ 群: ['1016'] })
群消息表.set(1016, [一条带图群消息(1603, { 是主人: true })])
设判断(['1603'], true, 0.9, '想看这张图')
const 附件之前6c = 附件们.length
const 群1016之前 = 回合.filter((r) => r.sid === 'session-qq-social-group-1016').length
await 轮询社交()
await 等()
const 图轮s = 回合.filter((r) => r.sid === 'session-qq-social-group-1016')
const 图轮 = 图轮s.at(-1)
报('发图 → 走判断，选中后图片进会话', 图轮s.length === 群1016之前 + 1 && 附件们.length === 附件之前6c + 1, `回合=${图轮s.length} 附件=${附件们.length}`)
报('会话消息里带 image 块', 图轮 && Array.isArray(图轮.message.content) && 图轮.message.content.some((b) => b.type === 'image' && b.attachment && b.attachment.attachmentId === 附件们.at(-1).attachmentId), JSON.stringify(图轮 && 图轮.message.content.map((b) => b.type)))
报('图片标注是哪张图', 图轮 && String(图轮.message.content[0].text).includes('【图 1·主人'))
报('图片编号跟着发送者那一行', 图轮 && String(图轮.message.content[0].text).split('\n').some((line) => line.includes('主人：[图片]') && line.includes('[图 1]')), String(图轮?.message?.content?.[0]?.text).slice(0, 400))
const 图判 = 判断调用.at(-1)
const 图判文 = String(图判?.messages?.[0]?.content?.[0]?.text || '')
报('判断模型也拿到图片本身', !!(图判 && 图判.messages[0].content.some((b) => b.type === 'image' && b.attachment && b.attachment.attachmentId === 附件们.at(-1).attachmentId)), JSON.stringify(图判 && 图判.messages[0].content.map((b) => b.type)))
报('判断提示里的图号跟着消息行', 图判文.split('\n').some((line) => line.includes('主人：[图片]') && line.includes('[图 1]')), 图判文.slice(0, 400))
报('判断提示里带图片图注', 图判文.includes('【本批附来的图片】') && 图判文.includes('图 1·主人'), 图判文.slice(0, 400))
// 判断模型是纯文本时，不把图片塞进判断请求，免得整轮调用被模型拒掉
写配置({ 群: ['1031'], 判断模型: 'fake/chat' })
群消息表.set(1031, [一条带图群消息(1810, { 是主人: true })])
设判断(['1810'], true, 0.9, '看图')
const 纯文判前 = 判断调用.length
await 轮询社交()
await 等()
const 纯文判 = 判断调用.at(-1)
报('纯文本判断模型不硬塞图片', 判断调用.length === 纯文判前 + 1 && 纯文判.model === 'chat' && !纯文判.messages[0].content.some((b) => b.type === 'image'), `判断=${判断调用.length - 纯文判前} 模型=${纯文判?.model} ${JSON.stringify(纯文判 && 纯文判.messages[0].content.map((b) => b.type))}`)
报('纯文本回复模型收到图会提醒', String(await 日志文本()).includes('纯文本模型'))

// 看中的表情才收藏；收藏后聊天时能发出去
await 收到回复('session-qq-social-group-1016', '[存表情:图1:测试表情] 这张好笑')
await new Promise((r) => setTimeout(r, 30))
const 表情索引文本 = readFileSync(join(家, 'qq-stickers.json'), 'utf8')
const 表情索引 = JSON.parse(表情索引文本)
const 收藏项 = [...QQ收藏.values()][0]
报('看中的表情直接写进 QQ 收藏', QQ收藏.size === 1 && 收藏项 && 收藏项.desc === '测试表情', JSON.stringify([...QQ收藏.values()]))
报('本地只留编号和备注', 表情索引.items.length === 1 && 表情索引.items[0].label === '测试表情' && 表情索引.items[0].emojiId === (收藏项 && 收藏项.emojiId) && !表情索引.items[0].file, 表情索引文本.slice(0, 160))
报('不再往本机写表情图片', !existsSync(join(家, 'qq-stickers')))

// ---------- 6c-2 同一张表情再发一次：按图片内容认出收藏编号，她不会把两张说成同一张 ----------
const 原图块 = 图轮.message.content.find((b) => b.type === 'image')
const 原表情 = Buffer.from(保存的图.get(原图块.attachment.attachmentId) || [])
const 再发一次图 = 'https://multimedia.nt.qq.com.cn/sticker-again.jpg'
固定图.set(再发一次图, 原表情)
写配置({ 群: ['1032'] })
群消息表.set(1032, [{
  user_id: 123,
  time: Math.floor(Date.now() / 1000) + 100,
  message_id: 1610,
  sender: { card: '主人', nickname: 'x' },
  message: [{ type: 'image', data: { url: 再发一次图, file: 'again.jpg', summary: '[动画表情]', sub_type: 1 } }],
}])
设判断(['1610'], true, 0.9, '她收藏过这张')
await 轮询社交()
await 等()
const 认表情轮 = 回合.filter((r) => r.sid === 'session-qq-social-group-1032').at(-1)
const 认表情文 = String(认表情轮?.message?.content?.[0]?.text || '')
报('同一张表情再发：按 md5 认出收藏编号', 认表情文.includes('【图 1·主人·表情·你收藏的 #1 测试表情】'), 认表情文.slice(0, 600))
报('同一张表情再发：正文后面也带编号', 认表情文.split('\n').some((line) => line.includes('主人：[图片]（你收藏的 #1 测试表情）') && line.includes('[图 1]')), 认表情文.slice(0, 700))
报('同一张表情再发：明确告诉她发哪个编号', 认表情文.includes('【收藏对应】图 1 就是你收藏的 #1 测试表情'), 认表情文.slice(0, 700))
await 收到回复('session-qq-social-group-1032', '[发表情:#1] 就是这张')
await new Promise((r) => setTimeout(r, 800)) // 表情和话之间隔 450ms，等整轮落地完
const 认表情发 = 发的.filter((x) => x.url.endsWith('/send_custom_face') && x.体.group_id === 1032)
报('说“就是这张”时发的是收藏里的同一张', 认表情发.length === 1 && 认表情发[0].体.emoji_id === (收藏项 && 收藏项.emojiId), JSON.stringify(认表情发.map((x) => x.体.emoji_id)))
// 下一轮再看上下文：别人发的图和她自己发的表情都带编号，不会被对调
写配置({ 群: ['1032'], 判断冷却秒: 10 })
时间偏移 += 11_000
群消息表.set(1032, [一条群消息('刚才那张呢', { id: 1611 })])
设判断(['1611'], true, 0.9, '接着聊刚才那张')
await 轮询社交()
await 等()
const 追问轮 = 回合.filter((r) => r.sid === 'session-qq-social-group-1032').at(-1)
const 追问文 = String(追问轮?.message?.content?.[0]?.text || '')
报('后续上下文保留别人发来的表情编号', 追问文.split('\n').some((line) => line.includes('主人：[图片]（你收藏的 #1 测试表情）')), 追问文.slice(0, 900))
报('后续上下文保留她自己发的表情编号', 追问文.split('\n').some((line) => line.includes('[发了一张表情包：#1 测试表情]')), 追问文.slice(0, 900))

// ---------- 6c-3 有人回头问“图里那个”：旧图重新附上，不拿这轮新图硬套 ----------
写配置({ 群: ['1040'], 判断冷却秒: 0, 冷却秒: 1 })
const 旧图地址 = 'https://multimedia.nt.qq.com.cn/ask-old.jpg'
const 新图地址 = 'https://multimedia.nt.qq.com.cn/ask-new.jpg'
固定图.set(旧图地址, Buffer.from([0xff, 0xd8, 0xff, 0xd3]))
固定图.set(新图地址, Buffer.from([0xff, 0xd8, 0xff, 0xd4]))
const 带图带字 = (id, 文本, { 是主人 = false, atSelf = false, url }) => ({
  user_id: 是主人 ? 123 : 888,
  time: Math.floor(Date.now() / 1000) + 100,
  message_id: id,
  sender: { card: 是主人 ? '主人' : '群友888', nickname: 'x' },
  message: [
    ...(atSelf ? [{ type: 'at', data: { qq: '999' } }] : []),
    { type: 'image', data: { url, file: 'x.jpg', summary: '[图片]' } },
    { type: 'text', data: { text: 文本 } },
  ],
})
群消息表.set(1040, [带图带字(2911, '这是你吗', { atSelf: true, url: 旧图地址 })])
设判断(['2911'], true, 0.9, '发了张图问她')
await 轮询社交()
await 等()
const 旧图附件 = 附件们.at(-1)?.attachmentId
await 收到回复('session-qq-social-group-1040', '颜色有点像')
时间偏移 += 11_000
群消息表.set(1040, [带图带字(2912, '人家是问你看看图那个像不像你', { 是主人: true, url: 新图地址 })])
设判断(['2912'], true, 0.9, '主人在说刚才那张')
await 轮询社交()
await 等()
const 回头轮 = 回合.filter((r) => r.sid === 'session-qq-social-group-1040').at(-1)
const 回头文 = String(回头轮?.message?.content?.[0]?.text || '')
const 回头图块 = (回头轮?.message?.content || []).filter((b) => b.type === 'image')
报('回头问图：新图和旧图都附上', 回头图块.length === 2 && 回头图块.some((b) => b.attachment?.attachmentId === 旧图附件), JSON.stringify(回头图块.map((b) => b.attachment?.attachmentId)))
报('回头问图：旧图在上下文行里单独标号', 回头文.split('\n').some((line) => line.includes('群友888：') && line.includes('[旧图 1]')), 回头文.slice(0, 900))
报('回头问图：图注写明旧图是谁之前发的', 回头文.includes('【旧图 1·之前发过·群友888】'), 回头文.slice(0, 900))
报('回头问图：提示先看旧图，不拿新图硬套', 回头文.includes('先看旧图') && 回头文.includes('别拿这轮新发的图硬套'), 回头文.slice(0, 1200))
报('回头问图：这轮新图仍然单独编号', 回头文.split('\n').some((line) => line.includes('主人：[图片]') && line.includes('[图 1]')), 回头文.slice(0, 900))
await 收到回复('session-qq-social-group-1040', '我说的是刚才那张')

// 新图配的是无关的话：不带旧图，省图钱
时间偏移 += 11_000
群消息表.set(1040, [带图带字(2913, '哈哈', { 是主人: true, url: 新图地址 })])
设判断(['2913'], true, 0.9, '随手发图')
await 轮询社交()
await 等()
const 无关图轮 = 回合.filter((r) => r.sid === 'session-qq-social-group-1040').at(-1)
const 无关图块 = (无关图轮?.message?.content || []).filter((b) => b.type === 'image')
报('没在说图：上下文旧图不重复附', 无关图块.length === 1, JSON.stringify(无关图块.map((b) => b.attachment?.attachmentId)))

// 学习期把握 0.35 也愿意先应一声（门槛 0.3）
写配置({ 群: ['1026'] })
群消息表.set(1026, [一条群消息('能说话不', { atSelf: true, id: 1606 })])
设判断(['1606'], true, 0.35, '先应一声')
const 群1026之前 = 回合.filter((r) => r.sid === 'session-qq-social-group-1026').length
await 轮询社交()
await 等()
报('学习期把握 0.35 也愿意先接一句', 回合.filter((r) => r.sid === 'session-qq-social-group-1026').length === 群1026之前 + 1)

// 聊天时从收藏里发一张表情
写配置({ 群: ['1027'] })
群消息表.set(1027, [一条群消息('来点表情', { id: 1607 })])
设判断(['1607'], true, 0.9, '想发个表情')
await 轮询社交()
await 等()
await 收到回复('session-qq-social-group-1027', '[发表情:#1] 给你看')
const 表情发送 = 发的.filter((x) => x.url.endsWith('/send_custom_face') && x.体.group_id === 1027 && x.体.emoji_id === (收藏项 && 收藏项.emojiId))
报('聊天时从 QQ 收藏里发一张表情', 表情发送.length === 1, JSON.stringify(表情发送.at(-1)))
报('表情不再当普通图片发', !发的.some((x) => x.url.endsWith('/send_group_msg') && x.体.group_id === 1027 && Array.isArray(x.体.message) && x.体.message.some((b) => b.type === 'image')))

// ---------- 6d 连发表情：几张表情和话混着写，按写下顺序一张张、一句句发 ----------
写配置({ 群: ['1028'] })
群消息表.set(1028, [一条群消息('再来一套表情', { id: 1608 })])
设判断(['1608'], true, 0.9, '再发一套')
await 轮询社交()
await 等()
const 多表情前 = 发的.filter((x) => (x.url.endsWith('/send_group_msg') || x.url.endsWith('/send_custom_face')) && x.体.group_id === 1028).length
await 收到回复('session-qq-social-group-1028', '[发表情:#1] 拿去[发表情:#1] 再来一张')
await new Promise((r) => setTimeout(r, 1800))
const 多表情发 = 发的.filter((x) => (x.url.endsWith('/send_group_msg') || x.url.endsWith('/send_custom_face')) && x.体.group_id === 1028).slice(多表情前)
报('连发表情：按写下顺序排（表情→话→表情→话）', 多表情发.length === 4
  && 多表情发[0].url.endsWith('/send_custom_face')
  && 多表情发[1].url.endsWith('/send_group_msg') && 多表情发[1].体.message[0].data.text === '拿去'
  && 多表情发[2].url.endsWith('/send_custom_face')
  && 多表情发[3].url.endsWith('/send_group_msg') && 多表情发[3].体.message[0].data.text === '再来一张',
  JSON.stringify(多表情发.map((x) => (x.url.endsWith('/send_custom_face') ? '[表情]' : x.体.message[0].data.text))))
报('连发表情：两张都用的是收藏里那张', 多表情发[0].体.emoji_id === (收藏项 && 收藏项.emojiId) && 多表情发[2].体.emoji_id === (收藏项 && 收藏项.emojiId), JSON.stringify([多表情发[0] && 多表情发[0].体.emoji_id, 多表情发[2] && 多表情发[2].体.emoji_id]))

// 判断模型回了坏 JSON：这批消息要留着下轮再判，不能丢
写配置({ 群: ['1018'] })
群消息表.set(1018, [一条群消息('随便聊聊', { id: 1605 })])
判断输出 = '不是 JSON'
const 坏判之前 = 回合.filter((r) => r.sid === 'session-qq-social-group-1018').length
await 轮询社交()
await 等()
报('判断失败 → 不开轮', 回合.filter((r) => r.sid === 'session-qq-social-group-1018').length === 坏判之前)
报('判断失败 → 消息留在待看', (await 目标状态('group:1018')).待看 >= 1, JSON.stringify(await 目标状态('group:1018')))
报('判断失败写进日志', String(await 日志文本()).includes('判断暂时失败'))
设判断([], false, 0.1, '插不上话')

// 判断模型没配、也没有普通会话时跟 DSH 默认模型走（桌面刚启动、主人还没开会话）
const 原会话列表 = ctx.agents.list
ctx.agents.list = () => []
写配置({ 群: ['1040'], 判断模型: '', 回复模型: '' })
群消息表.set(1040, [一条群消息('默认模型也能判吗', { id: 1610 })])
设判断(['1610'], true, 0.9, '想接')
const 默认判之前 = 判断调用.length
await 轮询社交()
await 等()
报('判断模型回落到 DSH 默认模型', 判断调用.length === 默认判之前 + 1 && 判断调用.at(-1).provider === 'fake' && 判断调用.at(-1).model === 'cheap', JSON.stringify({ provider: 判断调用.at(-1)?.provider, model: 判断调用.at(-1)?.model }))
报('回落后的判断照常开一轮', 回合.some((r) => r.sid === 'session-qq-social-group-1040'))
const 建1040 = 建会话选项.find((项) => 项.sessionId === 'session-qq-social-group-1040')
报('新建社交会话继承主人的推理档', 建1040?.agentOptions?.provider === 'fake' && 建1040?.agentOptions?.model === 'cheap' && 建1040?.agentOptions?.reasoningEffort === 'max', JSON.stringify(建1040?.agentOptions))
报('判断调用不跟着用最高推理档', 判断调用.at(-1)?.reasoningEffort === undefined, String(判断调用.at(-1)?.reasoningEffort))

// 连默认模型都没有：这批消息不能丢，等模型回来再判
默认模型选择 = null
ctx.agents.list = () => []
写配置({ 群: ['1042'], 判断模型: '', 回复模型: '' })
群消息表.set(1042, [一条群消息('没模型的时候别丢我', { id: 1611 })])
const 没模之前 = 判断调用.length
await 轮询社交()
await 等()
报('没模型 → 不调模型、不开轮', 判断调用.length === 没模之前 && !回合.some((r) => r.sid === 'session-qq-social-group-1042'))
报('没模型 → 消息留在待看', (await 目标状态('group:1042')).待看 >= 1, JSON.stringify(await 目标状态('group:1042')))
报('没模型写进日志', String(await 日志文本()).includes('没有可用的判断模型'))
默认模型选择 = { provider: 'fake', model: 'cheap', reasoningEffort: 'max' }
ctx.agents.list = 原会话列表
设判断(['1611'], true, 0.9, '现在能判了')
时间偏移 += 61_000
await 轮询社交()
await 等()
报('模型恢复后重判攒下的消息', 回合.some((r) => r.sid === 'session-qq-social-group-1042'))
时间偏移 = 0

// ---------- 7 她自己的发言不接 ----------
写配置({ 群: ['1006'] })
群消息表.set(1006, [一条群消息('我刚说的', { uid: 999, id: 1701 })])
const 之前7 = 回合.length
const 判断之前7 = 判断调用.length
await 轮询社交()
await 等()
报('她自己的群消息不回、不问模型', 回合.length === 之前7 && 判断调用.length === 判断之前7)

// ---------- 8 静音时段 ----------
const now = new Date()
const 分 = (n) => ((n % 1440) + 1440) % 1440
const 时 = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
const 静音 = `${时(分(now.getHours() * 60 + now.getMinutes() - 30))}-${时(分(now.getHours() * 60 + now.getMinutes() + 30))}`
写配置({ 群: ['1007'], 静音 })
群消息表.set(1007, [一条群消息('大肥鱼 在吗', { atSelf: true, id: 1801 })])
const 之前8 = 回合.length
const 判断之前8 = 判断调用.length
await 轮询社交()
await 等()
报('静音时段 → 不判、不开轮', 回合.length === 之前8 && 判断调用.length === 判断之前8 && String(await 日志文本()).includes('静音时段'), 静音)
报('静音丢掉待看', (await 目标状态('group:1007')).待看 === 0)

// ---------- 9 试运行 ----------
写配置({ 群: ['1008'], 试运行: true })
群消息表.set(1008, [一条群消息('大肥鱼 在吗', { atSelf: true, id: 1901 })])
const 之前9 = 回合.length
const 判断之前9 = 判断调用.length
await 轮询社交()
await 等()
报('试运行 → 不判、不开轮、不花模型钱', 回合.length === 之前9 && 判断调用.length === 判断之前9 && String(await 日志文本()).includes('试运行'))

// ---------- 10 零花钱下限 ----------
写配置({ 群: ['1009'], 最低余额: 2 })
鱼脑.availableCny = 0.5
群消息表.set(1009, [一条群消息('大肥鱼 在吗', { atSelf: true, id: 2001 })])
const 之前10 = 回合.length
const 判断之前10 = 判断调用.length
await 轮询社交()
await 等()
报('零花钱低于下限 → 不看、不接、不问模型', 回合.length === 之前10 && 判断调用.length === 判断之前10 && String(await 日志文本()).includes('零花钱低于'))
鱼脑.availableCny = 5

// ---------- 11 不再有接话次数上限：旧配置字段也不拦人 ----------
写配置({ 群: ['1010'], 每小时上限: 1, 每天上限: 1, 每天总上限: 1, 冷却秒: 10, 判断冷却秒: 10 })
群消息表.set(1010, [一条群消息('大肥鱼 第一句', { atSelf: true, id: 2101 })])
设判断(['2101'], true, 0.9, '可以接')
const 之前11 = 回合.length
await 轮询社交()
await 等()
报('旧版次数上限字段不再拦第一轮', 回合.length === 之前11 + 1)
await 收到回复('session-qq-social-group-1010', '第一句回了')
时间偏移 += 11_000
群消息表.set(1010, [
  一条群消息('大肥鱼 第一句', { atSelf: true, id: 2101 }),
  一条群消息('大肥鱼 第二句', { atSelf: true, id: 2102 }),
])
设判断(['2102'], true, 0.9, '还能接')
await 轮询社交()
await 等()
报('旧版 1 条/小时上限已移除：11 秒后照常再接一轮', 回合.length === 之前11 + 2, `回合=${回合.length - 之前11}`)

// ---------- 12 冷却里还能看，但先不回；被直接叫到时冷却不拦 ----------
写配置({ 群: ['1011'], 兴趣词: ['鱼'], 快判: false, 冷却秒: 300, 判断冷却秒: 10 })
群消息表.set(1011, [一条群消息('今晚吃鱼吗', { id: 2201 })])
设判断(['2201'], true, 0.9, '可以接')
const 之前12 = 回合.length
await 轮询社交()
await 等()
报('冷却测试：第一轮先开口', 回合.length === 之前12 + 1)
await 收到回复('session-qq-social-group-1011', '说了')

群消息表.set(1011, [
  一条群消息('今晚吃鱼吗', { id: 2201 }),
  一条群消息('明天也吃鱼', { id: 2202 }),
])
设判断(['2202'], true, 0.9, '还想接')
const 判断之前12b = 判断调用.length
await 轮询社交()
await 等()
报('判断冷却里 → 先攒着不重复问', 判断调用.length === 判断之前12b && 回合.length === 之前12 + 1)
报('判断冷却里的消息进了待看', (await 目标状态('group:1011')).待看 === 1)

时间偏移 += 11_000
const 注入之前12 = 注入们.length
await 轮询社交()
await 等()
报('判断冷却过了 → 继续判断', 判断调用.length === 判断之前12b + 1)
报('接话冷却中 → 只看不回、不开轮', 回合.length === 之前12 + 1 && 注入们.length === 注入之前12 + 1 && String(注入们.at(-1).message.content[0].text).includes('明天也吃鱼'))
报('冷却只看不回写进日志', String(await 日志文本()).includes('冷却中') && String(await 日志文本()).includes('先只看不回'))

// 还在 300 秒冷却里，但有人直接叫她：仍然必须回
时间偏移 += 11_000
群消息表.set(1011, [
  一条群消息('今晚吃鱼吗', { id: 2201 }),
  一条群消息('明天也吃鱼', { id: 2202 }),
  一条群消息('大肥鱼 你在吗', { atSelf: true, id: 2203 }),
])
设判断([], false, 0.1, '不感兴趣')
await 轮询社交()
await 等()
报('冷却中被叫也必须回一句', 回合.length === 之前12 + 2 && String(回合.at(-1)?.message.content[0].text || '').includes('你在吗'), '回合=' + (回合.length - 之前12))
await 收到回复('session-qq-social-group-1011', '在呀')

// ---------- 13 回复她/@ 都必须回；mention 模式只看被叫 ----------
写配置({ 群: ['1012'], 模式: 'mention', 冷却秒: 10, 判断冷却秒: 10 })
群消息表.set(1012, [一条群消息('大肥鱼 先吱一声', { atSelf: true, id: 2201 + 100 })])
设判断(['2301'], true, 0.9, '可以接')
const 之前13 = 回合.length
await 轮询社交()
await 等()
发送序号 = 4241
await 收到回复('session-qq-social-group-1012', '吱')
报('先发的消息拿到了 message_id', 发的.at(-1)?.url.endsWith('/send_group_msg') === true, JSON.stringify(发的.at(-1)))

时间偏移 += 11_000
群消息表.set(1012, [
  一条群消息('大肥鱼 先吱一声', { atSelf: true, id: 2301 }),
  一条群消息('回复一下这条', { replyId: 4242, id: 2302 }),
  一条群消息('群里别人在聊别的', { id: 2303 }),
])
引用消息表.set('4242', {
  user_id: 999,
  message_id: 4242,
  sender: { card: '大肥鱼', nickname: '大肥鱼' },
  message: [{ type: 'text', data: { text: '吱' } }],
})
设判断([], false, 0.1, '不想接')
const 判断之前13 = 判断调用.length
await 轮询社交()
await 等()
报('回复她的消息 → 判断不想接也必须回', 判断调用.length === 判断之前13 + 1 && 回合.length === 之前13 + 2, '回合=' + (回合.length - 之前13))
报('回复她的消息带进了回话批次', String(回合.at(-1)?.message.content[0].text || '').includes('回复一下这条'))
报('引用她会把被引用的原话带进判断和回话',
  String(判断调用.at(-1)?.messages?.[0]?.content?.[0]?.text || '').includes('[引用你：吱]') &&
    String(回合.at(-1)?.message.content[0].text || '').includes('[引用你：吱]'))
await 收到回复('session-qq-social-group-1012', '怎么啦')

时间偏移 += 11_000
群消息表.set(1012, [
  一条群消息('大肥鱼 先吱一声', { atSelf: true, id: 2301 }),
  一条群消息('回复一下这条', { replyId: 4242, id: 2302 }),
  一条群消息('群里别人在聊别的', { id: 2303 }),
  一条群消息('没人叫她的新消息', { id: 2304 }),
])
const 判断之前13b = 判断调用.length
await 轮询社交()
await 等()
报('mention 模式：没人叫就不问模型', 判断调用.length === 判断之前13b && 回合.length === 之前13 + 2)

时间偏移 += 11_000
群消息表.set(1012, [
  一条群消息('大肥鱼 先吱一声', { atSelf: true, id: 2301 }),
  一条群消息('回复一下这条', { replyId: 4242, id: 2302 }),
  一条群消息('群里别人在聊别的', { id: 2303 }),
  一条群消息('没人叫她的新消息', { id: 2304 }),
  一条群消息('大肥鱼 再说一句', { atSelf: true, id: 2305 }),
])
设判断([], false, 0.1, '不想接')
const 判断之前13c = 判断调用.length
await 轮询社交()
await 等()
报('被 @ 判断不想接也必须回', 判断调用.length === 判断之前13c + 1 && 回合.length === 之前13 + 3, '回合=' + (回合.length - 之前13))
报('被 @ 的消息带进了回话批次', String(回合.at(-1)?.message.content[0].text || '').includes('再说一句'))
await 收到回复('session-qq-social-group-1012', '嗯嗯')

// ---------- 13b 引用别人 / @ 别人：不插话；直接叫到她时才带上被引用的原话 ----------
写配置({ 群: ['1044'], 冷却秒: 0, 判断冷却秒: 0, 旁听: true })
引用消息表.set('4901', {
  user_id: 777,
  message_id: 4901,
  sender: { card: '群友777', nickname: 'x' },
  message: [{ type: 'text', data: { text: '周末去海边' } }],
})
群消息表.set(1044, [
  一条群消息('好像不错', { uid: 888, id: 4902, replyId: 4901 }),
  一条群消息('引用的消息太旧了', { uid: 888, id: 4903, replyId: 4999 }),
])
设判断(['4902', '4903'], true, 0.9, '可以接')
const 判断之前13q = 判断调用.length
const 回合之前13q = 回合.length
await 轮询社交()
await 等()
报('引用别人 → 不判断、不接话', 判断调用.length === 判断之前13q && 回合.length === 回合之前13q)
报('引用别人 → 不进待看', (await 目标状态('group:1044')).待看 === 0)

时间偏移 += 11_000
群消息表.set(1044, [
  一条群消息('好像不错', { uid: 888, id: 4902, replyId: 4901 }),
  一条群消息('引用的消息太旧了', { uid: 888, id: 4903, replyId: 4999 }),
  一条群消息('你俩聊得怎么样', { uid: 888, id: 4904, atOther: true }),
])
const 判断之前13r = 判断调用.length
await 轮询社交()
await 等()
报('@ 别人 → 不判断、不接话', 判断调用.length === 判断之前13r && 回合.length === 回合之前13q)

时间偏移 += 11_000
群消息表.set(1044, [
  ...群消息表.get(1044),
  一条群消息('大肥鱼 你觉得呢', { uid: 888, id: 4905, replyId: 4901 }),
])
设判断(['4905'], true, 0.9, '在问她')
await 轮询社交()
await 等()
const 判断资料13q = String(判断调用.at(-1)?.messages?.[0]?.content?.[0]?.text || '')
const 位4905 = 判断资料13q.indexOf('#4905')
报('引用别人但叫到她 → 判断带上被引用的原话',
  判断调用.length === 判断之前13r + 1 && 判断资料13q.includes('[#4905][被叫][对别人说][群友]群友888：[引用群友777：周末去海边] 大肥鱼 你觉得呢'),
  位4905 >= 0 ? 判断资料13q.slice(Math.max(0, 位4905 - 30), 位4905 + 220).replace(/\n/g, ' | ') : `没进判断；新增调用 ${判断调用.length - 判断之前13r}；${判断资料13q.slice(-160).replace(/\n/g, ' | ')}`)
报('引用别人但叫到她 → 回话也带上原话', String(回合.at(-1)?.message.content[0].text || '').includes('[引用群友777：周末去海边]'))
await 收到回复('session-qq-social-group-1044', '还没去呢')

// ---------- 13c 游戏话题：没叫她不插话；点到她时仍回，但只说不玩 ----------
写配置({ 群: ['1047'], 冷却秒: 0, 判断冷却秒: 0, 旁听: true })
群消息表.set(1047, [
  一条群消息('今晚开黑吗', { uid: 888, id: 7301 }),
  一条群消息('一起来上分', { uid: 889, id: 7302 }),
  一条群消息('今天风挺大', { uid: 890, id: 7303 }),
])
设判断(['7303'], true, 0.9, '这句能接')
const 游戏前判断 = 判断调用.length
const 游戏前回合 = 回合.length
await 轮询社交()
await 等()
const 游戏资料 = String(判断调用.at(-1)?.messages?.[0]?.content?.[0]?.text || '')
报('游戏话题不交给判断，同批正常消息照常接',
  判断调用.length === 游戏前判断 + 1 && !游戏资料.includes('开黑') && !游戏资料.includes('上分') && 游戏资料.includes('今天风挺大'))
报('游戏话题没带进回话', 回合.length === 游戏前回合 + 1 && !String(回合.at(-1)?.message.content[0].text || '').includes('开黑'))
await 收到回复('session-qq-social-group-1047', '是挺大的')

时间偏移 += 11_000
群消息表.set(1047, [
  ...群消息表.get(1047),
  一条群消息('大肥鱼 你玩原神吗', { uid: 891, id: 7304, time: Math.floor(Date.now() / 1000) + 200 }),
])
设判断(['7304'], true, 0.9, '在问她')
await 轮询社交()
await 等()
const 游戏叫资料 = String(判断调用.at(-1)?.messages?.[0]?.content?.[0]?.text || '')
报('直接叫她问游戏 → 仍要判断，并标出不聊',
  判断调用.length === 游戏前判断 + 2 && 游戏叫资料.includes('[#7304][被叫][不聊:游戏][群友]群友891：大肥鱼 你玩原神吗'), 游戏叫资料.slice(-400))
const 游戏叫回合 = String(回合.at(-1)?.message.content[0].text || '')
报('直接叫她问游戏 → 回话提示照实说不玩', 游戏叫回合.includes('[不聊:游戏]') && 游戏叫回合.includes('我不玩/不太懂'))
await 收到回复('session-qq-social-group-1047', '我不玩这个')

// 关掉游戏开关、另划一个话题：游戏不再是拦点，自定义话题才是
时间偏移 += 11_000
写配置({ 群: ['1048'], 冷却秒: 0, 判断冷却秒: 0, 旁听: true, 不聊游戏: false, 不聊话题: ['足球'] })
群消息表.set(1048, [
  一条群消息('今晚开黑吗', { uid: 888, id: 7401 }),
  一条群消息('周末去踢足球', { uid: 889, id: 7402 }),
])
设判断(['7401'], true, 0.9, '游戏也能聊了')
const 改话题前判断 = 判断调用.length
await 轮询社交()
await 等()
const 改话题资料 = String(判断调用.at(-1)?.messages?.[0]?.content?.[0]?.text || '')
报('关掉不聊游戏后游戏照常进判断，自定义不聊话题仍拦住',
  判断调用.length === 改话题前判断 + 1 && 改话题资料.includes('今晚开黑吗') && !改话题资料.includes('踢足球'))
await 收到回复('session-qq-social-group-1048', '开啊')

// ---------- 14 关注上限：挑太多也只收前几条 ----------
写配置({ 群: ['1013'], 关注上限: 2 })
群消息表.set(1013, [
  一条群消息('第一条消息', { id: 2401 }),
  一条群消息('第二条消息', { id: 2402 }),
  一条群消息('第三条消息', { id: 2403 }),
])
设判断(['2401', '2402', '2403'], true, 0.9, '都想看')
const 之前14 = 回合.length
await 轮询社交()
await 等()
报('关注上限截断 watch', 回合.length === 之前14 + 1 && String(回合.at(-1).message.content[0].text).includes('第一条消息') && String(回合.at(-1).message.content[0].text).includes('第二条消息') && !String(回合.at(-1).message.content[0].text).includes('第三条消息'))
await 收到回复('session-qq-social-group-1013', '好')

// ---------- 15 判接但 watch 全是假 id：至少带上最后一条 ----------
写配置({ 群: ['1014'] })
群消息表.set(1014, [一条群消息('最后一条总得看到', { id: 2501 })])
设判断(['9999'], true, 0.9, '要接')
const 之前15 = 回合.length
await 轮询社交()
await 等()
报('watch 无效 id → 回退到最后一条消息', 回合.length === 之前15 + 1 && String(回合.at(-1).message.content[0].text).includes('最后一条总得看到'))
await 收到回复('session-qq-social-group-1014', '看到了')

// ---------- 16 脱敏失败 → 不发 ----------
写配置({ 群: ['1015'] })
群消息表.set(1015, [一条群消息('大肥鱼 说句话', { atSelf: true, id: 2601 })])
设判断(['2601'], true, 0.9, '可以接')
await 轮询社交()
await 等()
鱼脑.脱敏坏 = true
const 发之前16 = 发的.length
await 收到回复('session-qq-social-group-1015', '余额 123 不能出去')
报('脱敏失败 → 失败关闭、不发', 发的.length === 发之前16)
鱼脑.脱敏坏 = false

// ---------- 17 旧字段「被叫直接回」不再绕过判断；@ 由新规则强制回 ----------
写配置({ 群: ['1025'], 被叫直接回: true })
群消息表.set(1025, [一条群消息('大肥鱼 你在吗', { atSelf: true, id: 2701 })])
设判断([], false, 0.1, '不想接')
const 之前17 = 回合.filter((r) => r.sid === 'session-qq-social-group-1025').length
const 判断之前17 = 判断调用.length
await 轮询社交()
await 等()
报('旧配置不会额外放行 @，仍先问判断', 判断调用.length === 判断之前17 + 1)
报('判断不接也要回应 @', 回合.filter((r) => r.sid === 'session-qq-social-group-1025').length === 之前17 + 1)
await 收到回复('session-qq-social-group-1025', '在的')

// ---------- 18 旁听关掉：没人叫的消息连收都不收 ----------
写配置({ 群: ['1017'], 旁听: false })
群消息表.set(1017, [一条群消息('没人叫她的闲聊', { id: 2801 })])
const 判断之前18 = 判断调用.length
const 注入之前18 = 注入们.length
await 轮询社交()
await 等()
报('旁听关掉 → 闲聊不进待看、不问模型', 判断调用.length === 判断之前18 && 注入们.length === 注入之前18 && (await 目标状态('group:1017')).待看 === 0)
群消息表.set(1017, [
  一条群消息('没人叫她的闲聊', { id: 2801 }),
  一条群消息('大肥鱼 问你一句', { atSelf: true, id: 2802 }),
])
设判断(['2802'], true, 0.9, '被叫了')
const 之前18b = 回合.length
await 轮询社交()
await 等()
报('旁听关掉仍把被叫的交给她', 回合.length === 之前18b + 1 && 判断调用.length === 判断之前18 + 1)
await 收到回复('session-qq-social-group-1017', '在')

// ---------- 19 刷屏也不把 @ 挤出待看和判断窗口 ----------
写配置({ 群: ['1018'] })
群消息表.set(1018, [一条群消息('先闲聊一句', { id: 3001 })])
设判断([], false, 0.2, '先不看')
await 轮询社交()
await 等()
const 刷屏们 = [
  一条群消息('大肥鱼 你说呢', { atSelf: true, id: 3002 }),
  ...Array.from({ length: 60 }, (_, i) => 一条群消息('刷屏' + i, { id: 3003 + i })),
]
群消息表.set(1018, [一条群消息('先闲聊一句', { id: 3001 }), ...刷屏们])
设判断(['3002'], true, 0.9, '被叫了')
await 轮询社交()
await 等()
报('判断冷却里刷屏 60 条，待看仍受上限约束', (await 目标状态('group:1018')).待看 === 50, '待看=' + (await 目标状态('group:1018')).待看)
时间偏移 += 61_000
await 轮询社交()
await 等()
报('刷屏后 @ 仍在判断窗口里', String(判断调用.at(-1)?.messages?.[0]?.content?.[0]?.text).includes('[#3002]'), String(判断调用.at(-1)?.messages?.[0]?.content?.[0]?.text).slice(0, 120))
报('刷屏后 @ 仍能开一轮', 回合.at(-1)?.sid === 'session-qq-social-group-1018' && String(回合.at(-1).message.content[0].text).includes('你说呢'))
时间偏移 = 0

// ---------- 20 学习期每条都判；画像成熟后快判开始挡无关消息 ----------
写配置({ 群: ['1019'], 关注上限: 30, 判断冷却秒: 10 })
const 鲸鱼话题 = Array.from({ length: 20 }, (_, i) => 一条群消息('鲸鱼在海里游泳' + i, { id: 3101 + i }))
群消息表.set(1019, [
  ...鲸鱼话题,
  一条群消息('今天食堂好难吃', { id: 3121 }),
])
设判断(鲸鱼话题.map((m) => String(m.message_id)), false, 0.2, '只想看鲸鱼')
const 判断之前20 = 判断调用.length
await 轮询社交()
await 等()
报('画像成熟前，无关消息也进判断窗口', 判断调用.length === 判断之前20 + 1 && String(判断调用.at(-1)?.messages?.[0]?.content?.[0]?.text).includes('[#3121]'))
const 画像20 = (await 目标状态('group:1019')).画像
报('看过足够多消息后画像成熟', 画像20.样本 === 20 && 画像20.稳定词 >= 6 && 画像20.成熟 === true, JSON.stringify(画像20))

时间偏移 += 11_000
群消息表.set(1019, [
  ...鲸鱼话题,
  一条群消息('今天食堂好难吃', { id: 3121 }),
  一条群消息('今天食堂还是很难吃', { id: 3122, uid: 889 }),
  一条群消息('大肥鱼 你在吗', { id: 3123 }),
  一条群消息('主人随便说一句', { id: 3124, 是主人: true }),
  一条群消息('鲸鱼又浮上来了', { id: 3125 }),
])
设判断(['3125'], false, 0.4, '继续看鲸鱼')
const 判断之前21 = 判断调用.length
const 注入之前21 = 注入们.length
const 回合之前21 = 回合.length
await 轮询社交()
await 等()
const 提示21 = String(判断调用.at(-1)?.messages?.[0]?.content?.[0]?.text)
报('快判把有兴趣的消息排前面', 判断调用.length === 判断之前21 + 1 && 提示21.includes('[#3125]') && 提示21.includes('鲸鱼又浮上来了'))
报('被叫的消息不因快判被挡', 提示21.includes('[#3123]') && 提示21.includes('[被叫]'))
报('没兴趣的群友消息也进判断窗口', 提示21.includes('[#3122]') && 提示21.includes('食堂还是'))
报('主人的普通消息也在同一批里', 提示21.includes('[#3124]'))
报('快判不替她决定回不回：被叫仍然必回', 回合.length === 回合之前21 + 1 && 注入们.length === 注入之前21)
报('只看过的消息才算进画像', (await 目标状态('group:1019')).画像.样本 === 22, JSON.stringify((await 目标状态('group:1019')).画像))
报('快判不再因为 0 分丢消息', (await 目标状态('group:1019')).画像.快判丢 === 0, JSON.stringify((await 目标状态('group:1019')).画像))
报('进过视线的消息都记了“见过”', (await 目标状态('group:1019')).画像.见过词 >= 2, JSON.stringify((await 目标状态('group:1019')).画像))
报('快判排序写进日志', 思绪文本().includes('快判：最高'))
报('判断提示带上学到的兴趣词', 提示21.includes('鲸鱼'))
await 收到回复('session-qq-social-group-1019', '在的呀')
let 画像存 = ''
try { 画像存 = readFileSync(join(家, 'qq-social-interests.json'), 'utf8') } catch (error) {}
报('兴趣画像落盘，重启能接上', 画像存.includes('鲸鱼') && 画像存.includes('group:1019'), 画像存.slice(0, 120))

// ---------- 21 画像成熟后整批没兴趣：也能看、能接，不再直接跳过 ----------
时间偏移 += 11_000
写配置({ 群: ['1019'], 关注上限: 30, 判断冷却秒: 10, 冷却秒: 1 })
群消息表.set(1019, [
  ...鲸鱼话题,
  一条群消息('今天食堂好难吃', { id: 3121 }),
  一条群消息('今天食堂还是很难吃', { id: 3122, uid: 889 }),
  一条群消息('大肥鱼 你在吗', { id: 3123 }),
  一条群消息('主人随便说一句', { id: 3124, 是主人: true }),
  一条群消息('鲸鱼又浮上来了', { id: 3125 }),
  一条群消息('今晚食堂关门', { id: 3126, uid: 890 }),
  一条群消息('主人再说一句', { id: 3127, 是主人: true }),
])
设判断(['3126'], true, 0.1, '不感兴趣，但接得上一句')
const 判断之前21b = 判断调用.length
const 注入之前21b = 注入们.length
const 回合之前21b = 回合.length
await 轮询社交()
await 等()
const 提示21b = String(判断调用.at(-1)?.messages?.[0]?.content?.[0]?.text)
报('整批没兴趣也交给判断模型', 判断调用.length === 判断之前21b + 1 && 提示21b.includes('[#3126]'), 提示21b.slice(0, 160))
报('不感兴趣也能被挑中并接一句', 回合.length === 回合之前21b + 1 && 回合.at(-1)?.sid === 'session-qq-social-group-1019', JSON.stringify(回合.at(-1)))
报('没兴趣接话时主人普通消息不单独开轮', 注入们.length === 注入之前21b)
报('整批没兴趣 → 待看清空', (await 目标状态('group:1019')).待看 === 0)
await 收到回复('session-qq-social-group-1019', '食堂又关门啦')

// ---------- 21b 关掉快判：成熟画像也全部交给判断模型 ----------
时间偏移 += 11_000
写配置({ 群: ['1019'], 关注上限: 30, 判断冷却秒: 10, 快判: false })
群消息表.set(1019, [
  ...鲸鱼话题,
  一条群消息('今晚食堂关门', { id: 3128 }),
])
设判断([], false, 0.2, '不想看')
const 判断之前21c = 判断调用.length
await 轮询社交()
await 等()
const 提示21c = String(判断调用.at(-1)?.messages?.[0]?.content?.[0]?.text)
报('关掉快判 → 成熟画像也全部交给判断模型', 判断调用.length === 判断之前21c + 1 && 提示21c.includes('[#3128]'), 提示21c.slice(0, 120))

// ---------- 21c 快判上限：分数够也只放前几条 ----------
时间偏移 += 11_000
写配置({ 群: ['1019'], 关注上限: 30, 判断冷却秒: 10, 快判: true, 快判最多: 2 })
const 上限基准 = Math.floor(Date.now() / 1000) + 100
群消息表.set(1019, [
  ...鲸鱼话题,
  一条群消息('鲸鱼浮上来换气', { id: 3141, time: 上限基准 + 1 }),
  一条群消息('鲸鱼游过来了', { id: 3142, time: 上限基准 + 2 }),
  一条群消息('鲸鱼在唱歌', { id: 3143, time: 上限基准 + 3 }),
])
设判断([], false, 0.2, '先看看')
const 判断之前21上限 = 判断调用.length
await 轮询社交()
await 等()
const 提示21上限 = String(判断调用.at(-1)?.messages?.[0]?.content?.[0]?.text)
报('快判上限：分数够也只放设定条数', 判断调用.length === 判断之前21上限 + 1 && 提示21上限.includes('[#3142]') && 提示21上限.includes('[#3143]') && !提示21上限.includes('[#3141]'), 提示21上限.slice(0, 240))

// ---------- 21d 0 分也进窗口；超过名额时探索额度再捞一条更早的 ----------
时间偏移 += 11_000
写配置({ 群: ['1019'], 关注上限: 30, 判断冷却秒: 10, 快判: true, 快判最多: 2, 探索间隔秒: 600, 探索最低余额: 3 })
const 探索基准 = Math.floor(Date.now() / 1000) + 100
群消息表.set(1019, [
  ...鲸鱼话题,
  一条群消息('楼下在修路', { id: 3150, uid: 890, time: 探索基准 + 1 }),
  一条群消息('外面下雨了', { id: 3151, uid: 891, time: 探索基准 + 2 }),
  一条群消息('路上堵车了', { id: 3152, uid: 892, time: 探索基准 + 3 }),
])
设判断([], false, 0.2, '没兴趣')
const 判断之前21f = 判断调用.length
await 轮询社交()
await 等()
const 提示21f = String(判断调用.at(-1)?.messages?.[0]?.content?.[0]?.text)
报('0 分也进判断窗口，超额的部分靠探索补看', 判断调用.length === 判断之前21f + 1 && 提示21f.includes('[#3150]') && 提示21f.includes('[#3151]') && 提示21f.includes('[#3152]'), 提示21f.slice(0, 200))
报('探索次数进状态', (await 目标状态('group:1019')).画像.探索 >= 1, JSON.stringify((await 目标状态('group:1019')).画像))

时间偏移 += 11_000
群消息表.set(1019, [
  ...鲸鱼话题,
  一条群消息('快递到了', { id: 3153, uid: 893, time: 探索基准 + 4 }),
  一条群消息('外卖到了', { id: 3154, uid: 894, time: 探索基准 + 5 }),
  一条群消息('手机没电了', { id: 3155, uid: 895, time: 探索基准 + 6 }),
])
const 判断之前21g = 判断调用.length
await 轮询社交()
await 等()
const 提示21g = String(判断调用.at(-1)?.messages?.[0]?.content?.[0]?.text)
报('探索额度有间隔：十分钟内只放名额内的两条', 判断调用.length === 判断之前21g + 1 && 提示21g.includes('[#3154]') && 提示21g.includes('[#3155]') && !提示21g.includes('[#3153]'), 提示21g.slice(0, 200))

时间偏移 += 601_000
群消息表.set(1019, [
  ...鲸鱼话题,
  一条群消息('钥匙找不到了', { id: 3156, uid: 896, time: 探索基准 + 7 }),
  一条群消息('耳机丢了', { id: 3157, uid: 897, time: 探索基准 + 8 }),
  一条群消息('水杯忘带了', { id: 3158, uid: 898, time: 探索基准 + 9 }),
])
const 判断之前21h = 判断调用.length
await 轮询社交()
await 等()
const 提示21h = String(判断调用.at(-1)?.messages?.[0]?.content?.[0]?.text)
报('探索间隔到了，再捞一条更早的', 判断调用.length === 判断之前21h + 1 && 提示21h.includes('[#3156]') && 提示21h.includes('[#3157]') && 提示21h.includes('[#3158]'), 提示21h.slice(0, 200))

时间偏移 += 601_000
鱼脑.availableCny = 2
群消息表.set(1019, [
  ...鲸鱼话题,
  一条群消息('明天要早起', { id: 3159, uid: 899, time: 探索基准 + 10 }),
  一条群消息('今晚早点睡', { id: 3161, uid: 900, time: 探索基准 + 11 }),
  一条群消息('困得不行了', { id: 3162, uid: 901, time: 探索基准 + 12 }),
])
const 判断之前21i = 判断调用.length
await 轮询社交()
await 等()
const 提示21i = String(判断调用.at(-1)?.messages?.[0]?.content?.[0]?.text)
报('余额低于探索线就不捞名额外的', 判断调用.length === 判断之前21i + 1 && !提示21i.includes('[#3159]') && 提示21i.includes('[#3161]') && 提示21i.includes('[#3162]'), 提示21i.slice(0, 200))
鱼脑.availableCny = 5

// ---------- 21j 没 @ 也可能是在问她本人：自关系问句直接进慢判，并标成 [问你] ----------
时间偏移 += 11_000
写配置({ 群: ['1019'], 关注上限: 30, 判断冷却秒: 10, 快判: true, 快判最多: 2, 探索间隔秒: 0 })
群消息表.set(1019, [
  ...鲸鱼话题,
  一条群消息('可以评价一下你的老爹emt吗', { id: 3160 }),
])
设判断([], false, 0.1, '只是有人问她')
const 判断之前21j = 判断调用.length
const 回合之前21j = 回合.length
await 轮询社交()
await 等()
const 提示21j = String(判断调用.at(-1)?.messages?.[0]?.content?.[0]?.text)
const 系统21j = String(判断调用.at(-1)?.system)
报('自关系问句没 @ 也进慢判', 判断调用.length === 判断之前21j + 1 && 提示21j.includes('[#3160]') && 提示21j.includes('[问她]'), 提示21j.slice(0, 240))
报('慢判提示说明问她自己的关系不能略过', 系统21j.includes('[问她]') && 系统21j.includes('不该装作没看见'))
报('小模型没挑她，自关系问句也会被她看见并开一轮', 回合.length === 回合之前21j + 1 && String(回合.at(-1)?.message.content[0].text).includes('[问你]') && String(回合.at(-1)?.message.content[0].text).includes('别装没看见'), String(回合.at(-1)?.message.content[0].text).slice(-260))
报('自关系问句的接话理由写进日志', String(await 日志文本()).includes('问到她自己，至少应一声'))
await 收到回复('session-qq-social-group-1019', '他啊，还行吧。')
时间偏移 = 0

// ---------- 21j2 关键词查好感度：判断说不接也要报出问的人自己的综合数值 ----------
时间偏移 += 11_000
写配置({ 群: ['1090'], 快判: false, 判断冷却秒: 10, 冷却秒: 10 })
群消息表.set(1090, [一条群消息('查好感度', { uid: 950, id: 7001 })])
设判断([], false, 0.1, '只是查询')
const 判断之前查 = 判断调用.length
const 回合之前查 = 回合.length
await 轮询社交()
await 等()
const 查询轮 = 回合.filter((r) => r.sid === 'session-qq-social-group-1090').at(-1)
const 查询文案 = String(查询轮?.message.content[0].text || '')
const 判断查文案 = String(判断调用.at(-1)?.messages?.[0]?.content?.[0]?.text || '')
const 人950 = JSON.parse(readFileSync(join(家, 'qq-social-people.json'), 'utf8')).people['950']
const 查询综合 = 人950 ? 模.综合好感(人950.关系) : -1
报('查好感度：没被叫也能进慢判，并标出 [查好感度]',
  判断调用.length === 判断之前查 + 1 && 判断查文案.includes('[#7001]') && 判断查文案.includes('[查好感度]'),
  判断查文案.slice(0, 240))
报('查好感度：判断说不接也照样开一轮', 回合.length === 回合之前查 + 1 && !!查询轮, '回合=' + (回合.length - 回合之前查))
报('查好感度：回复提示注入问的人自己的综合数值',
  查询文案.includes('[查好感度]') && 查询文案.includes('【好感度查询】') &&
    查询文案.includes('综合 ' + 查询综合 + ' / 100') && 查询文案.includes('QQ 950') &&
    !查询文案.includes('QQ 951'),
  查询文案.slice(-360))
报('查好感度：尾注要求直接报数、别换成感觉',
  查询文案.includes('把【好感度查询】里的综合数值报给他') && 查询文案.includes('别改写成感觉'))
报('查好感度：日志写明是按关键词查', String(await 日志文本()).includes('按关键词查好感度'))
await 收到回复('session-qq-social-group-1090', '让我看看……是 ' + 查询综合 + ' 分')
时间偏移 = 0

时间偏移 += 11_000
写配置({ 群: [], 好友: ['960'], 快判: false, 判断冷却秒: 10, 冷却秒: 10 })
好友消息表.set(960, [一条好友消息('查一下我的好感度', { uid: 960, id: 7201 })])
设判断([], false, 0.1, '不太想接')
await 轮询社交()
await 等()
const 好友轮 = 回合.filter((r) => r.sid === 'session-qq-social-friend-960').at(-1)
const 好友文案 = String(好友轮?.message.content[0].text || '')
const 人960 = JSON.parse(readFileSync(join(家, 'qq-social-people.json'), 'utf8')).people['960']
const 好友综合 = 人960 ? 模.综合好感(人960.关系) : -1
报('好友私聊查好感度：判断说不接也直接报数',
  好友文案.includes('【好感度查询】好友') && 好友文案.includes('直接报“现在是 ' + 好友综合 + ' 分”'),
  好友文案.slice(-300))
await 收到回复('session-qq-social-friend-960', '现在是 ' + 好友综合 + ' 分啦')
时间偏移 = 0

时间偏移 += 11_000
写配置({ 群: ['1091'], 快判: false, 判断冷却秒: 10, 冷却秒: 10 })
群消息表.set(1091, [一条群消息('你觉得自己好感度怎么样', { uid: 952, id: 7101 })])
设判断(['7101'], false, 0.1, '随便看看')
await 轮询社交()
await 等()
const 普通注入 = String(注入们.filter((x) => x.sid === 'session-qq-social-group-1091').at(-1)?.message?.content?.[0]?.text || '')
报('普通聊到好感度不注入数值，仍按感觉回答',
  普通注入.includes('好感度怎么样') && !普通注入.includes('【好感度查询】'),
  普通注入.slice(0, 300))
时间偏移 = 0

// ---------- 21e 空 @ 后面才说正文：合并成一条，并把 @ 算在正文上 ----------
时间偏移 = 0
写配置({ 群: ['1029'], 聚拢秒: 15 })
const 空叫秒 = Math.floor(Date.now() / 1000)
群消息表.set(1029, [
  一条空叫(4301, 空叫秒),
  一条群消息('收藏下表情包', { id: 4302, time: 空叫秒 + 6 }),
])
设判断([], false, 0.1, '先看看')
const 判断之前21d = 判断调用.length
await 轮询社交()
await 等()
报('空 @ 先扣住，不单独判', 判断调用.length === 判断之前21d)
时间偏移 += 25_000
await 轮询社交()
await 等()
const 提示21d = String(判断调用.at(-1)?.messages?.[0]?.content?.[0]?.text)
报('空 @ 的正文继承被叫', 判断调用.length === 判断之前21d + 1 && 提示21d.includes('[#4302]') && 提示21d.includes('[被叫]') && 提示21d.includes('收藏下表情包'), 提示21d.slice(0, 200))
时间偏移 = 0

// ---------- 21e 判断器第一次吐出坏 JSON：收紧要求重试一次 ----------
写配置({ 群: ['1033'] })
群消息表.set(1033, [一条群消息('今天吃什么', { id: 4401 })])
判断输出队列.push('不是 JSON', JSON.stringify({ watch: ['4401'], reply: false, confidence: 0.1, reason: '随便看看' }))
const 判断之前21e = 判断调用.length
await 轮询社交()
await 等()
报('判断坏 JSON 会重试一次', 判断调用.length === 判断之前21e + 2, '判断调用=' + (判断调用.length - 判断之前21e))
设判断([], false, 0.1, '插不上话')

// ---------- 21f 主人明确让收藏：主人 @ → 优先开一轮，同时把表情存进 QQ ----------
写配置({ 群: ['1035'] })
const 收藏数前21f = QQ收藏.size
const 判断前21f = 判断调用.length
const 轮前21f = 回合.filter((r) => r.sid === 'session-qq-social-group-1035').length
群消息表.set(1035, [
  一条带图群消息(4501, { 是主人: true }),
  一条群消息('收藏下表情包', { 是主人: true, atSelf: true, id: 4502 }),
])
await 轮询社交()
await 等()
报('主人让收藏 → 存进 QQ', QQ收藏.size === 收藏数前21f + 1, `收藏=${QQ收藏.size}`)
报('主人 @ 让收藏 → 不走判断', 判断调用.length === 判断前21f)
报('主人 @ 让收藏 → 直接开一轮', 回合.filter((r) => r.sid === 'session-qq-social-group-1035').length === 轮前21f + 1)
await 收到回复('session-qq-social-group-1035', '好，收了')
报('主人 @ 让收藏 → 回话发回群', 发的.some((x) => x.url.endsWith('/send_group_msg') && x.体.group_id === 1035))

// ---------- 21g 聊天节奏：话没断 + 高把握 → 允许顺着问一句 ----------
写配置({ 群: ['1041'], 判断冷却秒: 10, 冷却秒: 10 })
群消息表.set(1041, [一条群消息('今天海边风好大', { id: 4601 })])
设判断(['4601'], true, 0.9, '聊到海，来劲了')
await 轮询社交()
await 等()
时间偏移 += 11_000
群消息表.set(1041, [
  一条群消息('今天海边风好大', { id: 4601 }),
  一条群消息('浪都拍到路上了', { id: 4602, uid: 889 }),
])
设判断(['4602'], true, 0.9, '顺着海边聊')
await 轮询社交()
await 等()
const 热提示 = String(回合.at(-1)?.message?.content?.[0]?.text || '')
报('话没断 + 高把握 → 分寸提示允许问一句', 回合.length >= 2 && 热提示.includes('【这一轮的分寸】') && 热提示.includes('来劲') && 热提示.includes('问一句'), 热提示.slice(-240))

// ---------- 21h 聊天节奏：余额吃紧 → 收着说，不开新话题 ----------
写配置({ 群: ['1043'], 判断冷却秒: 10, 冷却秒: 10, 余额吃紧线: 5 })
鱼脑.availableCny = 2
群消息表.set(1043, [一条群消息('今晚吃什么', { id: 4701 })])
设判断(['4701'], true, 0.9, '想接')
await 轮询社交()
await 等()
const 省提示 = String(回合.at(-1)?.message?.content?.[0]?.text || '')
报('余额吃紧 → 收着说、不主动开新话题', 回合.length >= 1 && 省提示.includes('收着点') && 省提示.includes('不主动开新话题'), 省提示.slice(-240))
鱼脑.availableCny = 5

// ---------- 21i 聊天节奏：把握一般 → 短应一声，不追问 ----------
写配置({ 群: ['1045'], 判断冷却秒: 10, 冷却秒: 10 })
群消息表.set(1045, [一条群消息('今天天气一般', { id: 4801 })])
设判断(['4801'], true, 0.32, '有点意思')
await 轮询社交()
await 等()
const 温提示 = String(回合.at(-1)?.message?.content?.[0]?.text || '')
报('把握一般 → 回一句就够、不追问', 温提示.includes('有点兴趣') && 温提示.includes('回一句就够'), 温提示.slice(-240))

// ---------- 21j 动态冷却：高把握更短、低把握更长、余额吃紧再拉长 ----------
const 社交回合数 = (sid) => 回合.filter((r) => r.sid === sid).length

写配置({ 群: ['1051'], 兴趣词: ['鱼'], 快判: false, 冷却秒: 60, 判断冷却秒: 10 })
鱼脑.availableCny = 100
群消息表.set(1051, [一条群消息('今晚吃鱼', { id: 5001 })])
设判断(['5001'], true, 0.9, '来劲')
await 轮询社交()
await 等()
await 收到回复('session-qq-social-group-1051', '吃鱼吃鱼')
时间偏移 += 11_000
群消息表.set(1051, [
  一条群消息('今晚吃鱼', { id: 5001 }),
  一条群消息('再来一条', { id: 5002, uid: 889 }),
])
设判断(['5002'], true, 0.9, '还来劲')
await 轮询社交()
await 等()
报('高把握 → 指数曲线把冷却压到个位数：11 秒后能再开口', 社交回合数('session-qq-social-group-1051') === 2)

写配置({ 群: ['1053'], 兴趣词: ['鱼'], 快判: false, 冷却秒: 60, 判断冷却秒: 10 })
群消息表.set(1053, [一条群消息('今晚吃鱼', { id: 5101 })])
设判断(['5101'], true, 0.56, '勉强接')
await 轮询社交()
await 等()
await 收到回复('session-qq-social-group-1053', '嗯')
时间偏移 += 61_000
群消息表.set(1053, [
  一条群消息('今晚吃鱼', { id: 5101 }),
  一条群消息('再来一条', { id: 5102, uid: 889 }),
])
设判断(['5102'], true, 0.56, '还是勉强')
const 注入前21k = 注入们.length
await 轮询社交()
await 等()
报('低把握 → 冷却拉长：61 秒时仍只看不回', 社交回合数('session-qq-social-group-1053') === 1 && 注入们.length === 注入前21k + 1)

写配置({ 群: ['1055'], 兴趣词: ['鱼'], 快判: false, 冷却秒: 60, 判断冷却秒: 10, 余额吃紧线: 5, 余额吃紧倍率: 1.5 })
鱼脑.availableCny = 2
群消息表.set(1055, [一条群消息('今晚吃鱼', { id: 5201 })])
设判断(['5201'], true, 0.9, '来劲')
await 轮询社交()
await 等()
await 收到回复('session-qq-social-group-1055', '吃')
时间偏移 += 10_000
群消息表.set(1055, [
  一条群消息('今晚吃鱼', { id: 5201 }),
  一条群消息('再来一条', { id: 5202, uid: 889 }),
])
设判断(['5202'], true, 0.9, '还来劲')
const 注入前21l = 注入们.length
await 轮询社交()
await 等()
报('余额吃紧 → 曲线拉长：10 秒时只看不回', 社交回合数('session-qq-social-group-1055') === 1 && 注入们.length === 注入前21l + 1)
鱼脑.availableCny = 5

// ---------- 21m 别人叫她的名字：回复提示要知道说的是自己 ----------
写配置({ 群: ['1061'], 兴趣词: ['鱼'], 快判: false, 冷却秒: 10, 判断冷却秒: 10 })
群消息表.set(1061, [一条群消息('大肥鱼今天好菜', { id: 5301 })])
设判断(['5301'], true, 0.9, '在说她')
await 轮询社交()
await 等()
const 自指提示 = String(回合.at(-1)?.message?.content?.[0]?.text || '')
报('有人叫她名字 → 回复提示标出在说她', 自指提示.includes('[说到你]') && 自指提示.includes('大肥鱼今天好菜'), 自指提示.slice(0, 300))

// ---------- 21n 合并转发：展开成一行一个说话人；拉不到也不丢外层消息 ----------
写配置({ 群: ['1062'], 判断冷却秒: 10, 冷却秒: 10 })
转发表.set('res-ok', [
  { user_id: 701, sender: { nickname: '甲' }, message: [{ type: 'text', data: { text: '海边捡到一块贝壳' } }] },
  { user_id: 702, sender: { nickname: '乙' }, message: [{ type: 'image', data: { url: 'https://multimedia.nt.qq.com.cn/x.jpg', file: 'x.jpg' } }] },
])
群消息表.set(1062, [
  一条转发群消息('res-ok', { id: 5401, 文本: '看看这个' }),
  一条转发群消息('res-missing', { id: 5402, 文本: '这个也看看' }),
])
设判断(['5401', '5402'], true, 0.9, '转发里说到海')
await 轮询社交()
await 等()
const 转发轮 = 回合.filter((r) => r.sid === 'session-qq-social-group-1062').at(-1)
const 转发提示 = String(判断调用.at(-1)?.messages?.[0]?.content?.[0]?.text)
报('转发消息：展开进判断窗口', 转发提示.includes('[转发消息 2 条]') && 转发提示.includes('甲：海边捡到一块贝壳') && 转发提示.includes('乙：[图片]'), 转发提示.slice(0, 400))
报('转发消息：拉不到也保留外层文字和占位', 转发提示.includes('这个也看看') && 转发提示.includes('[转发消息，没展开出来]'), 转发提示.slice(0, 400))
报('转发消息：展开后照常开一轮', 转发轮 && String(转发轮.message.content[0].text).includes('海边捡到一块贝壳'), JSON.stringify(转发轮 && String(转发轮.message.content[0].text).slice(0, 300)))
const 转发图块 = (转发轮?.message?.content || []).filter((x) => x.type === 'image')
报('转发消息：转发里的图真下下来给她看', 转发图块.length === 1 && !!转发图块[0].attachment, JSON.stringify(转发图块))
报('转发消息：图片注明原发言人', String(转发轮?.message?.content?.[0]?.text).includes('【图 1·乙】'), String(转发轮?.message?.content?.[0]?.text).slice(0, 300))

// ---------- 21o 人物志：认人、记事实、跨屋不串、边界、她开口才记互动 ----------
时间偏移 = 0
const 人物文件 = join(家, 'qq-social-people.json')
const 读人物 = () => JSON.parse(readFileSync(人物文件, 'utf8')).people
写配置({ 群: ['1071'], 好友: [], 兴趣词: ['猫'], 快判: false, 判断冷却秒: 10, 冷却秒: 10 })
群消息表.set(1071, [
  一条群消息('我在成都上班', { uid: 906, id: 5500 }),
  一条群消息('我最近在杭州读研，还养了只猫', { uid: 901, id: 5501 }),
])
设判断(['5501'], false, 0.2, '记一下这个人', [
  { id: '5500', facts: [{ 文: '在成都上班', 类: '近况' }] },
  {
    id: '5501',
    facts: [{ 文: '在杭州读研', 类: '近况' }, { 文: '电话13800138000', 类: '近况' }],
    memory: '他第一次说起自己读研和养猫',
  },
])
await 轮询社交()
await 等()
const 人901 = 读人物()['901']
报('人物志：她看见的人会落盘，事实过隐私清洗',
  !!人901 && 人901.事实.some((x) => x.文 === '在杭州读研') && !人901.事实.some((x) => x.文.includes('13800138000')),
  JSON.stringify(人901 && 人901.事实))
报('人物志：同一间屋的相处片段也记下',
  !!(人901 && 人901.房['group:1071']) && 人901.房['group:1071'].记忆.some((x) => x.文.includes('读研和养猫')),
  JSON.stringify(人901 && 人901.房['group:1071']))
报('人物志：她没挑中的消息，带回来的笔记也不落盘',
  !!(读人物()['906'] && 读人物()['906'].事实.length === 0),
  JSON.stringify(读人物()['906'] && 读人物()['906'].事实))
const 人物卡提示 = String(判断调用.at(-1)?.messages?.[0]?.content?.[0]?.text)
报('人物志：判断提示里带上人物卡', 人物卡提示.includes('【你认识的这些人') && 人物卡提示.includes('第一次见'), 人物卡提示.slice(0, 300))

时间偏移 += 11_000
群消息表.set(1071, [
  一条群消息('我在成都上班', { uid: 906, id: 5500 }),
  一条群消息('我最近在杭州读研，还养了只猫', { uid: 901, id: 5501 }),
  一条群消息('今天猫又拆家了', { uid: 901, id: 5502 }),
])
设判断(['5502'], false, 0.2, '还是记一下')
await 轮询社交()
await 等()
const 熟人提示 = String(判断调用.at(-1)?.messages?.[0]?.content?.[0]?.text)
报('人物志：下一轮记得这个人的事，但只在这间屋', 熟人提示.includes('你记得：在杭州读研') && 熟人提示.includes('你记得那次'), 熟人提示.slice(0, 400))

写配置({ 群: [], 好友: ['903'], 快判: false, 判断冷却秒: 10, 冷却秒: 10 })
好友消息表.set(903, [一条好友消息('我最近在准备考研', { uid: 903, id: 5601 })])
设判断(['5601'], false, 0.2, '记住', [{ id: '5601', facts: [{ 文: '在准备考研', 类: '近况' }] }])
await 轮询社交()
await 等()
const 人903 = 读人物()['903']
报('人物志：私聊里知道的事标成“密”', !!(人903 && 人903.事实.some((x) => x.文 === '在准备考研' && x.房 === 'friend:903' && x.密 === true)), JSON.stringify(人903 && 人903.事实))

写配置({ 群: ['1072'], 好友: ['903'], 快判: false, 判断冷却秒: 10, 冷却秒: 10 })
群消息表.set(1072, [一条群消息('大家好', { uid: 903, id: 5701 })])
设判断(['5701'], false, 0.1, '看看')
await 轮询社交()
await 等()
const 跨屋提示 = String(判断调用.at(-1)?.messages?.[0]?.content?.[0]?.text)
报('人物志：换一间屋还认得人，事实和关系都跟着人走',
  跨屋提示.includes('你以前在别处见过他') && 跨屋提示.includes('关系按总的算') &&
    跨屋提示.includes('在准备考研') && 跨屋提示.includes('私下说过，别当众提') &&
    !跨屋提示.includes('别把别处听来的事带出来'), 跨屋提示.slice(0, 500))
const 人903全 = 读人物()['903']
报('人物志：全局关系跨屋累积，见过和互动是总和',
  !!(人903全 && 人903全.关系) &&
    人903全.关系.见过 === 2 &&
    人903全.关系.熟 >= 人903全.房['friend:903'].熟 &&
    人903全.关系.熟 >= 人903全.房['group:1072'].熟 &&
    人903全.关系.互动 === 人903全.房['friend:903'].互动 + 人903全.房['group:1072'].互动,
  JSON.stringify(人903全 && { 总: 人903全.关系, 友: 人903全.房['friend:903'], 群: 人903全.房['group:1072'] }))
const 跨屋注入 = String(注入们.filter((x) => x.sid === 'session-qq-social-group-1072').at(-1)?.message?.content?.[0]?.text || '')
报('关系分寸：跨屋的人按原来的关系接，不装陌生',
  跨屋注入.includes('你在别处见过') && 跨屋注入.includes('别把别处的原话搬过来'), 跨屋注入.slice(0, 400))

时间偏移 += 11_000
群消息表.set(1072, [一条群消息('以后别在群里提我离婚的事', { uid: 904, id: 5801 })])
设判断(['5801'], false, 0.1, '记住边界')
await 轮询社交()
await 等()
const 人904 = 读人物()['904']
报('人物志：她看见的“别在群里提”会记成边界',
  !!(人904 && 人904.边界.some((x) => x.文 === '离婚的事' && x.房 === 'group:1072')), JSON.stringify(人904 && 人904.边界))

时间偏移 += 11_000
群消息表.set(1072, [
  一条群消息('以后别在群里提我离婚的事', { uid: 904, id: 5801 }),
  一条群消息('今天天气不错', { uid: 904, id: 5802 }),
])
设判断(['5802'], false, 0.1, '随便看看')
await 轮询社交()
await 等()
const 边界提示 = String(判断调用.at(-1)?.messages?.[0]?.content?.[0]?.text)
报('人物志：下一次判断提示带上“别碰”', 边界提示.includes('别碰：离婚的事'), 边界提示.slice(0, 400))

时间偏移 += 11_000
群消息表.set(1072, [
  一条群消息('以后别在群里提我离婚的事', { uid: 904, id: 5801 }),
  一条群消息('今天天气不错', { uid: 904, id: 5802 }),
  一条群消息('大肥鱼 在吗', { uid: 905, id: 5901, atSelf: true }),
])
设判断(['5901'], true, 0.9, '叫她就接')
await 轮询社交()
await 等(50)
const 开口前 = 读人物()['905'].房['group:1072']
报('人物志：群里只说了一句，还没算她跟对方聊过', 开口前.互动 === 0, JSON.stringify(开口前 && { 互动: 开口前.互动, 熟: 开口前.熟 }))
await 收到回复('session-qq-social-group-1072', '在呀')
await 等(120)
const 开口后 = 读人物()['905'].房['group:1072']
报('人物志：她真开口后才把互动记到对方身上', 开口后.互动 === 开口前.互动 + 1 && 开口后.熟 > 开口前.熟, JSON.stringify({ 前: 开口前.互动, 后: 开口后.互动, 熟: 开口后.熟 }))

// ---------- 21q 大号小号并成一个人；说出来的关系也记住 ----------
const 读人物档 = () => JSON.parse(readFileSync(人物文件, 'utf8'))
时间偏移 += 11_000
写配置({ 群: ['1073'], 好友: [], 快判: false, 判断冷却秒: 10, 冷却秒: 10 })
群消息表.set(1073, [一条群消息('我小号是 92202', { uid: 92101, id: 6101 })])
设判断([], false, 0.1, '先看看')
await 轮询社交()
await 等()
const 档1 = 读人物档()
报('大号小号：自认的小号并进主号，只留一张卡',
  !!档1.people['92101'] && !档1.people['92202'] &&
    档1.people['92101'].账号.some((a) => a.号 === '92202' && a.来源 === '自认'),
  JSON.stringify({ 键: Object.keys(档1.people).filter((k) => k === '92101' || k === '92202'), 账号: 档1.people['92101'] && 档1.people['92101'].账号 }))

时间偏移 += 11_000
群消息表.set(1073, [
  一条群消息('我小号是 92202', { uid: 92101, id: 6101 }),
  一条群消息('我最近在学吉他', { uid: 92202, id: 6102 }),
])
设判断(['6102'], false, 0.2, '记住', [{ id: '6102', facts: [{ 文: '在学吉他', 类: '近况' }] }])
await 轮询社交()
await 等()
const 档2 = 读人物档()
const 人92101 = 档2.people['92101']
报('大号小号：小号说的话记在同一个人身上',
  !档2.people['92202'] && 人92101.事实.some((f) => f.文 === '在学吉他'),
  JSON.stringify(人92101 && 人92101.事实))
const 小号提示 = String(判断调用.at(-1)?.messages?.[0]?.content?.[0]?.text)
报('大号小号：人物卡标明是同一个人，别点破小号',
  小号提示.includes('这条用的是他的另一个号 92202') &&
    小号提示.includes('都是同一个人') && 小号提示.includes('别当众说破'),
  小号提示.slice(0, 500))

时间偏移 += 11_000
群消息表.set(1073, [
  一条群消息('我小号是 92202', { uid: 92101, id: 6101 }),
  一条群消息('我最近在学吉他', { uid: 92202, id: 6102 }),
  一条群消息('我弟弟叫小陈', { uid: 92101, id: 6103 }),
])
设判断(['6103'], false, 0.1, '记住关系')
await 轮询社交()
await 等()
const 档3 = 读人物档()
报('关系自述：别人直接说出来的弟弟，不花模型也记住',
  档3.关系网.some((e) => e.甲 === '92101' && e.乙 === '小陈' && e.关系 === '弟弟' &&
    e.房 === 'group:1073' && e.明说 === true && e.密 === false),
  JSON.stringify(档3.关系网))

时间偏移 += 11_000
群消息表.set(1073, [
  一条群消息('我弟弟叫小陈', { uid: 92101, id: 6103 }),
  一条群消息('今天好热', { uid: 92101, id: 6104 }),
])
设判断(['6104'], false, 0.1, '看看')
await 轮询社交()
await 等()
const 关系提示 = String(判断调用.at(-1)?.messages?.[0]?.content?.[0]?.text)
报('关系网：下一轮人物卡带上他认识的人',
  关系提示.includes('他认识的人') && 关系提示.includes('小陈是他弟弟') && 关系提示.includes('他说的'),
  关系提示.slice(0, 600))

时间偏移 += 11_000
写配置({ 群: ['1074'], 好友: [], 快判: false, 判断冷却秒: 10, 冷却秒: 10 })
const 配置路径 = join(家, 'qq-bridge-config.json')
const 配置文 = JSON.parse(readFileSync(配置路径, 'utf8'))
配置文.私聊QQ = '15001'
writeFileSync(配置路径, JSON.stringify(配置文, null, 2), 'utf8')
群消息表.set(1074, [一条群消息('我大号是 15001', { uid: 93001, id: 6201 })])
设判断([], false, 0.1, '看看')
await 轮询社交()
await 等()
const 档4 = 读人物档()
报('账号安全：外人不能说自己是主人号',
  !档4.people['93001'] || !档4.people['93001'].账号.some((a) => a.号 === '15001'),
  JSON.stringify(档4.people['93001'] && 档4.people['93001'].账号))
报('账号安全：主人号没有被并走',
  !档4.people['15001'] || !档4.people['15001'].账号.some((a) => a.号 === '93001'),
  JSON.stringify(档4.people['15001'] && 档4.people['15001'].账号))

// ---------- 21p 判断冷却设 0：不等冷却，下一轮轮询接着判 ----------
写配置({ 群: ['1081'], 兴趣词: ['鱼'], 快判: false, 判断冷却秒: 0, 冷却秒: 10 })
群消息表.set(1081, [一条群消息('鱼又浮上来了', { id: 6001 })])
设判断(['6001'], false, 0.2, '先看看')
const 判断前0 = 判断调用.length
await 轮询社交()
await 等()
报('判断冷却 0：有消息就判', 判断调用.length === 判断前0 + 1, '判断次数=' + (判断调用.length - 判断前0))
群消息表.set(1081, [
  一条群消息('鱼又浮上来了', { id: 6001 }),
  一条群消息('这次是真的鱼', { id: 6002, time: Math.floor(Date.now() / 1000) + 200 }),
])
设判断(['6002'], false, 0.2, '再看一眼')
await 轮询社交()
await 等()
报('判断冷却 0：紧接着的下一轮仍然判，不等 20 秒', 判断调用.length === 判断前0 + 2, '判断次数=' + (判断调用.length - 判断前0))

// ---------- 22b 风格画像接进社交回复提示 ----------
写配置({ 群: ['1098'], 快判: false, 判断冷却秒: 0, 冷却秒: 2, 旁听: true })
时间偏移 += 60_000
const 风格句子们 = ['好呀', '在呢', '我看看哦', '行啦', '晚安哦', '走呀', '好诶']
群消息表.set(1098, 风格句子们.map((文, i) => 一条群消息(文, {
  id: 7001 + i,
  是主人: true,
  time: Math.floor(Date.now() / 1000) + i,
})))
设判断(风格句子们.map((_, i) => String(7001 + i)), false, 0.2, '先看看')
await 轮询社交()
await 等()
群消息表.set(1098, [
  ...群消息表.get(1098),
  一条群消息('那我先睡啦', { id: 7009, 是主人: true, time: Math.floor(Date.now() / 1000) + 60 }),
])
设判断(['7009'], true, 0.9, '跟他说晚安')
时间偏移 += 5_000
await 轮询社交()
await 等()
const 风格轮 = 回合.at(-1)
const 风格轮文 = String(风格轮?.message.content[0].text || '')
报('社交：摸清主人的打字节奏后，回复提示带内部贴合',
  风格轮 && 风格轮文.includes('【说话节奏·内部提示') && 风格轮文.includes('别复述'),
  风格轮文.slice(-400))

// ---------- 22 /models 与 /save 深层合并 ----------
写配置({ 群: ['1019'], 快判: false })
const fakeRes = { statusCode: 200, setHeader: () => {}, end: (s) => { 存储.push(JSON.parse(s)) } }
const 造请求 = (body, 选项 = {}) => {
  const 块s = body === undefined ? [] : [typeof body === 'string' ? body : JSON.stringify(body)]
  块s.method = 选项.method || 'POST'
  块s.headers = { host: 选项.host || '127.0.0.1:3080' }
  return 块s
}
await 路由.get('/dsh-qq-bridge/models')(造请求(undefined, { method: 'GET' }), fakeRes)
报('/models 列出 provider 和模型', 存储.at(-1)?.ok === true && 存储.at(-1).providers[0].models.some((m) => m.id === 'chat'), JSON.stringify(存储.at(-1)))
const 模型表 = 存储.at(-1).providers[0].models
报('/models 标出哪些模型能看图', 模型表.find((m) => m.id === 'cheap')?.images === true && 模型表.find((m) => m.id === 'chat')?.images === false, JSON.stringify(模型表))
await 路由.get('/dsh-qq-bridge/save')(造请求({ 社交: { 群: ['2001'], 关注上限: 5, 被叫直接回: true } }), fakeRes)
const 存盘 = JSON.parse(readFileSync(join(家, 'qq-bridge-config.json'), 'utf8'))
报('/save 深层合并社交配置', 存盘.社交.启用 === true && 存盘.社交.模式 === 'auto' && 存盘.社交.群[0] === '2001' && 存盘.社交.关注上限 === 5, JSON.stringify(存盘.社交))
报('/save 清掉旧字段「被叫直接回」', 存盘.社交.被叫直接回 === undefined)
报('快判开关也会保存', 存盘.社交.快判 === false)
await 路由.get('/dsh-qq-bridge/save')(造请求({ 社交: { 关注上限: 99 } }), fakeRes)
const 存盘2 = JSON.parse(readFileSync(join(家, 'qq-bridge-config.json'), 'utf8'))
报('关注上限夹在 1~30', 存盘2.社交.关注上限 === 30, String(存盘2.社交.关注上限))
报('社交场景提示写进聊天行为', 场景提示.some((x) => String(x.text).includes('【怎么说话】') && String(x.text).includes('别主动开课') && String(x.text).includes('不争输赢')))
const 状态 = await 宿主.概况()
报('/state 回出社交状态、待看和会话 id', 状态.社交.目标.some((t) => t.会话id === 'session-qq-social-group-2001' && typeof t.待看 === 'number'), JSON.stringify(状态.社交))
报('/state 回出关注上限', 状态.配置.社交.关注上限 === 30)
报('/state 标出回复和判断模型能不能看图', 状态.社交.看图 && 状态.社交.看图.回复 === false && 状态.社交.看图.判断 === true, JSON.stringify(状态.社交.看图))

存储.length = 0
await 路由.get('/dsh-qq-bridge/people')(造请求(undefined, { method: 'GET' }), fakeRes)
const 人物页 = 存储[0]
报('/people 回出人物志、全局关系和每屋记录',
  人物页 && 人物页.ok === true && 人物页.总数 >= 1 &&
    Array.isArray(人物页.人物) &&
    人物页.人物.some((p) => p.号 === '901' &&
      p.关系 && typeof p.关系.阶段 === 'string' && typeof p.关系.口气 === 'string' &&
      typeof p.关系.综合 === 'number' &&
      p.关系.见过 === p.房.reduce((n, r) => n + r.见过, 0) &&
      p.事实.some((f) => f.文 === '在杭州读研' && f.房 === 'group:1071') &&
      p.房.some((r) => r.key === 'group:1071' && r.阶段 && r.口气 && Array.isArray(r.记忆))),
  JSON.stringify(人物页 && 人物页.人物.map((p) => ({ 号: p.号, 关系: p.关系, 房: p.房.length }))))
报('/people 一个人一张卡：大号小号列在同一张卡，关系网单独回',
  人物页 && 人物页.总数 === 人物页.人物.length &&
    人物页.账号数 >= 2 && 人物页.关系数 >= 1 &&
    人物页.人物.filter((p) => p.号 === '92101' || p.号 === '92202').length === 1 &&
    人物页.人物.some((p) => p.号 === '92101' &&
      p.账号.some((a) => a.号 === '92202') &&
      p.关系们.some((r) => r.谁 === '小陈' && r.关系 === '弟弟')) &&
    人物页.关系网.some((e) => e.甲 === '92101' && e.乙 === '小陈' && e.关系 === '弟弟'),
  JSON.stringify({ 总数: 人物页 && 人物页.总数, 账号数: 人物页 && 人物页.账号数, 关系数: 人物页 && 人物页.关系数 }))

// ---------- 23 回合失败：连续失败暂停、设置页可见、重置后换新会话 ----------
写配置({ 群: ['1099'], 快判: false, 判断冷却秒: 0, 冷却秒: 1, 冷却最短秒: 1, 冷却最长倍率: 1 })
const 失败群 = 1099
const 失败sid = 'session-qq-social-group-1099'
let 失败序号 = 8001
const 发一条并开轮 = async () => {
  失败序号 += 1
  const 已有 = 群消息表.get(失败群) || []
  群消息表.set(失败群, [...已有, 一条群消息('鱼又冒头了 ' + 失败序号, { id: 失败序号, time: Math.floor(Date.now() / 1000) + 200 })])
  设判断([String(失败序号)], true, 0.9, '接一句')
  await 轮询社交()
  await 等()
}
await 发一条并开轮()
报('准备接话：待发已挂上', (await 目标状态('group:1099')).待发 === true)
监听[0]({ id: 失败sid }, { type: 'turn/end', data: { turn: 7, reason: { kind: 'error', error: { message: 'transport closed', code: 'TRANSPORT' } } } })
await 等()
let 失态 = await 目标状态('group:1099')
报('回合失败马上清掉待发，不留到 180 秒超时', 失态.待发 === false)
报('失败在设置页可见，带错误码和连续次数', 失态.故障 && 失态.故障.连续 === 1 && 失态.故障.最后码 === 'TRANSPORT' && 失态.故障.最后说 === 'transport closed', JSON.stringify(失态.故障))
报('失败写进日志', (await 日志文本()).includes('连续 1 次') && (await 日志文本()).includes('transport closed'))

时间偏移 += 2000
await 发一条并开轮()
监听[0]({ id: 失败sid }, { type: 'turn/end', data: { turn: 8, reason: { kind: 'error', error: { message: 'transport closed', code: 'TRANSPORT' } } } })
await 等()
时间偏移 += 2000
await 发一条并开轮()
监听[0]({ id: 失败sid }, { type: 'turn/end', data: { turn: 9, reason: { kind: 'error', error: { message: 'transport closed', code: 'TRANSPORT' } } } })
await 等()
失态 = await 目标状态('group:1099')
报('连续 3 轮失败：这一路暂停，不再开新回合', 失态.暂停中 === true && 失态.故障.暂停到 > Date.now(), JSON.stringify(失态.故障))
报('暂停时给主人 QQ 发系统提醒', 发的.some((x) => x.url.endsWith('/send_private_msg') && x.体.user_id === 123 && String(x.体.message[0].data.text).startsWith('【大肥鱼·系统】') && String(x.体.message[0].data.text).includes('重置这个聊天')), JSON.stringify(发的.slice(-3)))

// 暂停期间照收消息，但不花判断和回复的钱
const 暂停前判断 = 判断调用.length
const 暂停前回合 = 回合.length
时间偏移 += 2000
失败序号 += 1
群消息表.set(失败群, [...群消息表.get(失败群), 一条群消息('暂停里还在说话', { id: 失败序号, time: Math.floor(Date.now() / 1000) + 200 })])
await 轮询社交()
await 等()
报('暂停期间只看不判：判断和回复都不再花钱', 判断调用.length === 暂停前判断 && 回合.length === 暂停前回合)
报('暂停期间消息留在待看里，没丢', (await 目标状态('group:1099')).待看 >= 1)

// 重置：旧句柄释放，新 id 落盘，目标状态跟着换
const 旧id = 失态.会话id
报('重置前旧会话活着', 登记的会话.has(旧id))
存储.length = 0
await 路由.get('/dsh-qq-bridge/session-reset')(造请求({ key: 'group:1099', 会话id: 旧id }), fakeRes)
const 重置回 = 存储.at(-1)
报('重置接口换了一间新会话', 重置回 && 重置回.ok === true && 重置回.会话id !== 旧id && 重置回.会话id.startsWith(旧id + '-r'), JSON.stringify(重置回))
报('重置释放旧会话句柄', !登记的会话.has(旧id))
报('重置记进 qq-bridge-sessions.json', (() => {
  const p = join(家, 'qq-bridge-sessions.json')
  if (!existsSync(p)) return false
  const j = JSON.parse(readFileSync(p, 'utf8'))
  return j.重置 && j.重置['group:1099'] && j.重置['group:1099'].会话id === 重置回.会话id && j.重置['group:1099'].旧会话id === 旧id
})())
失态 = await 目标状态('group:1099')
报('重置后状态换成新 id、故障和待看清空', 失态.会话id === 重置回.会话id && 失态.故障 === null && 失态.暂停中 === false && 失态.待看 === 0 && 失态.重置 && 失态.重置.旧会话id === 旧id, JSON.stringify(失态))

// 下一轮在新会话里开，不再回旧屋
时间偏移 += 5000
失败序号 += 1
群消息表.set(失败群, [...群消息表.get(失败群), 一条群消息('新屋第一句', { id: 失败序号, time: Math.floor(Date.now() / 1000) + 200 })])
设判断([String(失败序号)], true, 0.9, '新屋接一句')
await 轮询社交()
await 等()
报('重置后下一轮开在新会话里', 回合.at(-1).sid === 重置回.会话id && 登记的会话.has(重置回.会话id), JSON.stringify({ 期望: 重置回.会话id, 实到: 回合.at(-1).sid }))
await 收到回复(重置回.会话id, '我在呢', 30)
报('新会话成功一轮后没有故障', (await 目标状态('group:1099')).故障 === null)

// ---------- 24 主人私聊失败可见 + 重置 ----------
写配置({ 群: [] })
存储.length = 0
await 路由.get('/dsh-qq-bridge/receive')(造请求({ text: '在吗' }), fakeRes)
报('/receive 建起主人私聊会话', 存储.at(-1).ok === true && 登记的会话.has('session-qq-private-123'), JSON.stringify(存储.at(-1)))
监听[0]({ id: 'session-qq-private-123' }, { type: 'turn/end', data: { turn: 3, reason: { kind: 'error', error: { message: 'cold request failed', code: 'TRANSPORT' } } } })
await 等()
let 私聊态 = (await 宿主.概况()).社交.私聊
报('主人私聊失败在设置页可见', 私聊态 && 私聊态.故障 && 私聊态.故障.连续 === 1 && 私聊态.故障.最后码 === 'TRANSPORT', JSON.stringify(私聊态))
存储.length = 0
await 路由.get('/dsh-qq-bridge/session-reset')(造请求({ key: 'private:123' }), fakeRes)
const 私聊重置 = 存储.at(-1)
报('主人私聊也能重置成新会话', 私聊重置 && 私聊重置.ok === true && 私聊重置.会话id.startsWith('session-qq-private-123-r'), JSON.stringify(私聊重置))
报('私聊重置后旧的 agent 被释放', !登记的会话.has('session-qq-private-123'))
存储.length = 0
await 路由.get('/dsh-qq-bridge/receive')(造请求({ text: '还在吗' }), fakeRes)
报('重置后主人下一句进新会话', 存储.at(-1).ok === true && 登记的会话.has(私聊重置.会话id) && !登记的会话.has('session-qq-private-123'), JSON.stringify(存储.at(-1)))
私聊态 = (await 宿主.概况()).社交.私聊
报('私聊状态换成新 id、故障清空', 私聊态.会话id === 私聊重置.会话id && 私聊态.故障 === null, JSON.stringify(私聊态))

// ---------- 25 主屋正在回话：新消息开分线并排回 ----------
写配置({ 群: ['1085'], 冷却秒: 10, 判断冷却秒: 0 })
群消息表.set(1085, [一条群消息('你们看过鲸鱼吗', { id: 8801 })])
设判断(['8801'], true, 0.9, '想聊鲸鱼')
const 并行前回合 = 回合.length
const 并行前发 = 发的.length
await 轮询社交()
await 等到(async () => 回合.length === 并行前回合 + 1)
报('主屋先开一轮', 回合.length === 并行前回合 + 1 && 回合.at(-1).sid === 'session-qq-social-group-1085', JSON.stringify(回合.at(-1) && 回合.at(-1).sid))
报('主屋在答时状态显示待发', (await 目标状态('group:1085')).待发 === true)

时间偏移 += 11_000
群消息表.set(1085, [...群消息表.get(1085), 一条群消息('我刚在海边看到一条', { id: 8802, time: Math.floor(Date.now() / 1000) + 200 })])
设判断(['8802'], true, 0.9, '接着聊海')
await 轮询社交()
await 等到(async () => 回合.length === 并行前回合 + 2)
报('忙时新消息开分线，不排队等', 回合.length === 并行前回合 + 2 && 回合.at(-1).sid === 'session-qq-social-group-1085-p2', JSON.stringify(回合.slice(-2).map((x) => x.sid)))
报('分线也带上了最近聊过的上下文', String(回合.at(-1)?.message.content[0].text).includes('看过鲸鱼吗'), String(回合.at(-1)?.message.content[0].text).slice(0, 300))
const 并行态 = await 目标状态('group:1085')
报('状态里显示 1 条分线在同时回', 并行态.待发 === true && 并行态.分线 === 1, JSON.stringify(并行态))
await 收到回复('session-qq-social-group-1085', '看过呀', 1)
await 收到回复('session-qq-social-group-1085-p2', '海边哪一段', 1)
await 等到(async () => 发的.slice(并行前发).filter((x) => x.url.endsWith('/send_group_msg') && x.体.group_id === 1085).length >= 2)
报('主屋和分线的回复都发回群里', 发的.slice(并行前发).filter((x) => x.url.endsWith('/send_group_msg') && x.体.group_id === 1085).map((x) => x.体.message[0].data.text).join('|') === '看过呀|海边哪一段', JSON.stringify(发的.slice(并行前发).map((x) => x.体 && x.体.message && x.体.message[0] && x.体.message[0].data)))
报('两间屋都落地后没有残留待发', (await 目标状态('group:1085')).待发 === false && (await 目标状态('group:1085')).分线 === 0)

// ---------- 26 关掉并行：同一间屋子排多轮也不覆盖 ----------
写配置({ 群: ['1086'], 冷却秒: 10, 判断冷却秒: 0, 并行: false })
群消息表.set(1086, [一条群消息('今晚去吃火锅吗', { id: 8811 })])
设判断(['8811'], true, 0.9, '想吃')
const 串前回合 = 回合.length
const 串前发 = 发的.length
await 轮询社交()
await 等到(async () => 回合.length === 串前回合 + 1)
时间偏移 += 11_000
群消息表.set(1086, [...群消息表.get(1086), 一条群消息('还缺一个人', { id: 8812, time: Math.floor(Date.now() / 1000) + 200 })])
设判断(['8812'], true, 0.9, '想凑人')
await 轮询社交()
await 等到(async () => 回合.length === 串前回合 + 2)
报('关掉并行后两轮都排在主屋', 回合.length === 串前回合 + 2 && 回合.slice(-2).every((x) => x.sid === 'session-qq-social-group-1086'), JSON.stringify(回合.slice(-2).map((x) => x.sid)))
await 收到回复('session-qq-social-group-1086', '来啊', 1)
await 收到回复('session-qq-social-group-1086', '我补位', 2)
await 等到(async () => 发的.slice(串前发).filter((x) => x.url.endsWith('/send_group_msg') && x.体.group_id === 1086).length >= 2)
报('同屋两轮回复按回合发出去、不互相覆盖', 发的.slice(串前发).filter((x) => x.url.endsWith('/send_group_msg') && x.体.group_id === 1086).map((x) => x.体.message[0].data.text).join('|') === '来啊|我补位', JSON.stringify(发的.slice(串前发).map((x) => x.体 && x.体.message && x.体.message[0] && x.体.message[0].data)))
报('两轮都落地后没有残留待发', (await 目标状态('group:1086')).待发 === false)

// ---------- 27 群聊接龙：接不上时原样复读群友一句 ----------
写配置({ 群: ['1097'], 快判: false, 判断冷却秒: 0, 冷却秒: 2, 冷却最短秒: 1, 冷却最长倍率: 1 })
群消息表.set(1097, [
  一条群消息('好家伙', { id: 9901, uid: 901 }),
  一条群消息('好家伙', { id: 9902, uid: 902 }),
])
设判断(['9901', '9902'], true, 0.9, '接龙呢，跟着说一句')
const 复读前回合 = 回合.length
const 复读前发 = 发的.length
await 轮询社交()
const 开了复读轮 = await 等到(async () => 回合.length === 复读前回合 + 1)
const 复读轮文 = String(回合.at(-1)?.message.content[0].text || '')
报('复读：两三个人接龙时提示里有可以复读的那句',
  开了复读轮 && 复读轮文.includes('【可以复读】') && 复读轮文.includes('好家伙') && 复读轮文.includes('[复读]'),
  复读轮文.slice(-320))
await 收到回复('session-qq-social-group-1097', '[复读]', 1)
await 等到(async () => 发的.slice(复读前发).some((x) => x.url.endsWith('/send_group_msg') && x.体.group_id === 1097))
const 复读发们 = 发的.slice(复读前发).filter((x) => x.url.endsWith('/send_group_msg') && x.体.group_id === 1097)
报('复读：[复读] 原样发一句，不夹标记、不多分条',
  复读发们.length === 1 && 复读发们[0].体.message[0].data.text === '好家伙',
  JSON.stringify(复读发们.map((x) => x.体.message[0].data.text)))
const 复读后状态 = await 目标状态('group:1097')
报('复读：群语感也记进了这个群的状态',
  复读后状态 && 复读后状态.画像 && 复读后状态.画像.语感 && 复读后状态.画像.语感.样本 >= 2,
  JSON.stringify(复读后状态 && 复读后状态.画像 && 复读后状态.画像.语感))
报('复读：发了之后日志和思绪都标出来',
  (await 日志文本()).includes('跟着群友复读了一句') && 思绪文本().includes('"复读":true'))

时间偏移 += 3_000
群消息表.set(1097, [
  ...群消息表.get(1097),
  一条群消息('笑死', { id: 9903, uid: 901, time: Math.floor(Date.now() / 1000) + 200 }),
  一条群消息('笑死', { id: 9904, uid: 902, time: Math.floor(Date.now() / 1000) + 201 }),
])
设判断(['9903', '9904'], true, 0.9, '再接一句')
const 无候选前回合 = 回合.length
const 无候选前发 = 发的.length
await 轮询社交()
const 开了无候选轮 = await 等到(async () => 回合.length === 无候选前回合 + 1)
const 无候选文 = String(回合.at(-1)?.message.content[0].text || '')
报('复读：冷却里不再给复读提示', 开了无候选轮 && !无候选文.includes('【可以复读】'), 无候选文.slice(-260))
await 收到回复('session-qq-social-group-1097', '[复读]', 1)
await 等(60)
报('复读：没有候选时 [复读] 不发，也不把标记漏出去',
  发的.slice(无候选前发).filter((x) => x.url.endsWith('/send_group_msg') && x.体.group_id === 1097).length === 0,
  JSON.stringify(发的.slice(无候选前发).map((x) => x.体 && x.体.message && x.体.message[0] && x.体.message[0].data)))

// ---------- 28 短期记忆：屋内缓冲留一小时，回复最多带最近 20 条 ----------
写配置({ 群: ['1098'], 快判: false, 判断冷却秒: 0, 冷却秒: 1, 冷却最短秒: 1, 冷却最长倍率: 1, 关注上限: 30 })
const 长批 = Array.from({ length: 25 }, (_, i) => 一条群消息(`第${i + 1}句`, { id: 9951 + i, uid: 901 }))
群消息表.set(1098, 长批)
设判断(长批.map((m) => String(m.message_id)), true, 0.9, '都在聊')
const 长批前回合 = 回合.length
await 轮询社交()
const 开了长批 = await 等到(async () => 回合.length === 长批前回合 + 1)
const 长批轮 = 回合.at(-1)
const 长批文 = String(长批轮?.message.content[0].text || '')
报('长批：25 条都进了提示', 开了长批 && 长批文.includes('第1句') && 长批文.includes('第25句'), 长批文.slice(-200))
报('长批：来源摘录只留对话，不带脚手架',
  长批轮 && String(长批轮.message.source.excerpt || '').startsWith('群友901：第1句') && String(长批轮.message.source.excerpt).includes('第25句'),
  JSON.stringify(长批轮 && 长批轮.message.source))
await 收到回复('session-qq-social-group-1098', '我在听', 1)
await new Promise((r) => setTimeout(r, 200)) // 等社交落地把她刚说的话放回缓冲

时间偏移 += 11_000
群消息表.set(1098, [
  ...长批,
  一条群消息('还在吗', { id: 9976, uid: 902, time: Math.floor(Date.now() / 1000) + 200 }),
])
设判断(['9976'], true, 0.9, '叫一声')
await 轮询社交()
const 开了上下文批 = await 等到(async () => 回合.length === 长批前回合 + 2)
const 上下文文 = String(回合.at(-1)?.message.content[0].text || '')
const 上下文条数 = (上下文文.match(/【最近聊过】/g) || []).length
报('长批：回复带最近 20 条上下文', 开了上下文批 && 上下文条数 === 20, '条数=' + 上下文条数)
报('长批：最新的话在上下文里，最旧的被挤出', 上下文文.includes('第25句') && 上下文文.includes('我在听') && !上下文文.includes('第1句'), 上下文文.slice(0, 400))
await 收到回复('session-qq-social-group-1098', '在', 1)
await new Promise((r) => setTimeout(r, 200))

// 过了一小时，旧的“刚聊过”不该再出现在提示里
时间偏移 += 65 * 60_000
群消息表.set(1098, [
  ...群消息表.get(1098),
  一条群消息('一小时后又来了', { id: 9977, uid: 903, time: Math.floor(Date.now() / 1000) + 200 }),
])
设判断(['9977'], true, 0.9, '又来了')
await 轮询社交()
const 开了一小时批 = await 等到(async () => 回合.length === 长批前回合 + 3)
const 一小时文 = String(回合.at(-1)?.message.content[0].text || '')
报('短期记忆：一小时前的旧话不再带进回复',
  开了一小时批 && !一小时文.includes('【最近聊过】') && !一小时文.includes('第25句') && 一小时文.includes('一小时后又来了'),
  一小时文.slice(-300))

// ---------- 29 认人：名片重名也不能并成一个人；摘录不写死最后一个发送者 ----------
时间偏移 = 0
写配置({ 群: ['2002'], 快判: false, 判断冷却秒: 0, 冷却秒: 1, 冷却最短秒: 1, 冷却最长倍率: 1, 关注上限: 30, 聚拢秒: 15 })
const 认人秒 = Math.floor(Date.now() / 1000)
群消息表.set(2002, [
  { ...一条群消息('我是甲', { uid: 971, id: 26001, time: 认人秒 + 5 }), sender: { card: '同名群友', nickname: 'x' } },
  { ...一条群消息('我是乙', { uid: 972, id: 26002, time: 认人秒 + 6 }), sender: { card: '同名群友', nickname: 'x' } },
])
设判断(['26001', '26002'], true, 0.9, '两个人都在说')
const 认人前回合 = 回合.length
await 轮询社交()
await 等()
时间偏移 += 30_000 // 过掉 15 秒聚拢，让这批进判断
await 轮询社交()
const 开了认人 = await 等到(async () => 回合.length === 认人前回合 + 1)
const 认人轮 = 回合.at(-1)
const 认人文 = String(认人轮?.message.content[0].text || '')
const 同名行 = 认人文.split('\n').filter((line) => line.includes('同名群友：'))
报('认人：名片同名的两个人各占一行，不并成一条',
  开了认人 && 同名行.length === 2 && 同名行.some((line) => line.includes('我是甲')) && 同名行.some((line) => line.includes('我是乙')),
  认人文.slice(-360))
const 认人摘录 = String(认人轮?.message.source?.excerpt || '')
报('认人：摘录也保留两条，不把乙的话算到甲头上',
  认人摘录.split('\n').filter((line) => line.startsWith('同名群友：')).length === 2,
  JSON.stringify(认人摘录))
报('认人：一批里有两个发送者时不写死最后一个 sender',
  认人轮 && 认人轮.message.source && !('sender' in 认人轮.message.source),
  JSON.stringify(认人轮 && 认人轮.message.source))

Date.now = 真Now
rmSync(家, { recursive: true, force: true })
console.log(`\n${挂了 === 0 ? '全部通过 ✅' : `有 ${挂了} 条没过 ❌`}`)
process.exitCode = 挂了 === 0 ? 0 : 1
