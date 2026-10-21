// B 站设置页的来源防线 + 外发审批策略冒烟测试。
// 跑法： node tests/防线.mjs

import { isTrustedLocalRequest } from '../lib/http-trust.mjs'
import { approvalFor, commentEnabled, dmEnabled } from '../lib/outbound-policy.mjs'

let 挂了 = 0
const 报 = (标签, 过, 详情) => { if (!过) 挂了++; console.log(`${过 ? 'PASS' : 'FAIL'}  ${标签}${详情 ? '  :: ' + 详情 : ''}`) }

const 请求 = (headers) => ({ headers })
const 可信 = (headers, bind = '127.0.0.1') => isTrustedLocalRequest(请求(headers), bind, 'http:')

// ---------- 来源防线 ----------
报('回环 Host → 放行', 可信({ host: '127.0.0.1:3080' }))
报('localhost → 放行', 可信({ host: 'localhost:3080' }))
报('IPv6 回环 → 放行', 可信({ host: '[::1]:3080' }))
报('监听地址的局域网 IP → 放行', 可信({ host: '192.168.1.5:3080' }, '192.168.1.5'))
报('没有 Host（curl/本机进程）→ 放行', 可信({}))
报('攻击者域名 Host（DNS rebinding）→ 拒绝', !可信({ host: 'evil.example:3080' }))
报('跨站 Origin → 拒绝', !可信({ host: '127.0.0.1:3080', origin: 'https://evil.example' }))
报('同源 Origin → 放行', 可信({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }))
报('Sec-Fetch-Site: cross-site → 拒绝', !可信({ host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' }))
报('有 Origin 没 Host → 拒绝', !可信({ origin: 'http://127.0.0.1:3080' }))
报('file: 的 null Origin → 拒绝', !可信({ host: '127.0.0.1:3080', origin: 'null' }))

// ---------- 外发审批策略 ----------
const 关着 = { autoComment: false, mentionName: '', dmMode: 'off', dmUid: 0, commentPerRound: 1 }
const 评论开 = { autoComment: true, mentionName: '小鱿鱼', dmMode: 'both', dmUid: 123, commentPerRound: 1 }
const 私信开 = { autoComment: false, mentionName: '', dmMode: 'only', dmUid: 123, commentPerRound: 1 }

报('评论闸关着', commentEnabled(关着) === false)
报('评论闸开着', commentEnabled(评论开) === true)
报('dmMode=only 不算评论开着', commentEnabled(私信开) === false)
报('私信闸开着', dmEnabled(私信开) === true)
报('dmUid=0 不算私信开着', dmEnabled({ ...私信开, dmUid: 0 }) === false)

const 评论审批 = approvalFor('bili_reply', { text: '看看', force: true }, 关着)
报('force 绕过关着的评论闸 → 要审批', 评论审批 && 评论审批.kind === 'comment' && 评论审批.text === '看看', JSON.stringify(评论审批))
报('force 是字符串 "true" 也要审批', approvalFor('bili_reply', { text: '看看', force: 'true' }, 关着)?.kind === 'comment')
报('评论闸开着时 force 是多余的 → 不弹', approvalFor('bili_reply', { text: '看看', force: true }, 评论开) === null)
报('评论额度没用满时 force 是多余的 → 不弹', approvalFor('bili_reply', { text: '看看', force: true }, 评论开, { commentUsed: 0 }) === null)
报('评论额度用满后 force → 要审批', approvalFor('bili_reply', { text: '看看', force: true }, 评论开, { commentUsed: 1 })?.kind === 'comment')
报('评论额度用满、没 force → 工具自己拒，不弹', approvalFor('bili_reply', { text: '看看' }, 评论开, { commentUsed: 1 }) === null)
报('评论闸关着、没 force → 交给工具拒绝，不弹', approvalFor('bili_reply', { text: '看看' }, 关着) === null)

const 换人审批 = approvalFor('bili_send_message', { text: '你好', uid: 999 }, 私信开)
报('私信换收件人 → 要审批', 换人审批 && 换人审批.kind === 'dm' && 换人审批.uid === 999, JSON.stringify(换人审批))
报('私信发给设置里的 UID → 不弹', approvalFor('bili_send_message', { text: '你好', uid: 123 }, 私信开) === null)
const 强发私信 = approvalFor('bili_send_message', { text: '你好', force: true, uid: 456 }, 关着)
报('force 绕过关着的私信闸 → 要审批', 强发私信 && 强发私信.kind === 'dm' && 强发私信.uid === 456, JSON.stringify(强发私信))
报('私信 force 是字符串 "true" 也要审批', approvalFor('bili_send_message', { text: '你好', force: 'true', uid: 456 }, 关着)?.kind === 'dm')
报('没有收件人 → 不弹（工具会拒）', approvalFor('bili_send_message', { text: '你好', force: true }, 关着) === null)
报('私信闸关着、没 force → 不弹', approvalFor('bili_send_message', { text: '你好', uid: 456 }, 关着) === null)

const 改闸 = approvalFor('bili_config', { patch: { autoComment: true, perDay: 5 } }, 关着)
报('改自动评论设置 → 要审批且点出键', 改闸 && 改闸.kind === 'config' && 改闸.keys.join() === 'autoComment', JSON.stringify(改闸))
报('只改额度 → 不弹', approvalFor('bili_config', { patch: { perDay: 5 } }, 关着) === null)
报('读设置（没 patch）→ 不弹', approvalFor('bili_config', {}, 关着) === null)

console.log(`\n${挂了 === 0 ? '全部通过 ✅' : `有 ${挂了} 条没过 ❌`}`)
process.exitCode = 挂了 === 0 ? 0 : 1
