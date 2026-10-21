// DSH「通到 QQ」· 历史导入半边
//
// 把 Tulpa 里已经存在的 QQ 私聊记录读进鱼脑的经历流，让她的「过去」有真内容撑着。
// 这一路只读：写经历走 observe，对外说话一律还是 host.js 的 OneBot 通道。
//
// 为什么不让模型直接调 mcp__tulpa__* 工具：
//   · 一次 tools/call 返回一整页历史，几十条消息塞进上下文，钱和位置都花在搬运上；
//     fish-mind 存一条只要一次本地写入，之后每次 recall 都是零成本。
//   · 更麻烦的是去重：模型的输出不进经历流就查不到，重放一轮会话会把同一条历史写两遍，
//     既灌满存储，也会让她把同一段往事当成发生过两次。
//
// Tulpa 是闭源程序，工具名和参数名只能按 MCP 的 tools/list 现学现用；
// 认不出来的形状一律跳过并如实报出来，不猜、不编。
//
// 实测它有两套翻页形状：老一套拿时间当游标（end_time 往前翻），
// 新一套（0.5.x）拿 offset 翻、拿 snapshot_max_id 冻结入库上界——
// 快照不冻结的话，导到一半新消息入库，页界会挪动。两套都认，按参数表自己分。

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** 导入来源：鱼脑按这个 channel 区分「翻到的旧记录」和「当场经历」。 */
export const 导入来源 = 'qq-import'

const 协议版本 = '2025-03-26'
const 请求超时毫秒 = 120000
/** 旧记录的可信度：那是聊天文字，不是她亲眼见过的事。 */
const 导入可信度 = 0.45
const 单条上限 = 2000
const 会话缓存毫秒 = 600000
/** 名字里有这些词的工具一律不选：导入只读，写、撤回和群管理都不碰。 */
const 拒绝词 = ['send', 'revoke', 'recall', 'delete', 'remove', 'set', 'add', 'stop', 'kick', 'ban', 'dismiss', 'nudge', 'poke', 'update', 'mark']
/** 只读动作的前缀：工具名得以下之一才可能入选。 */
const 只读前缀 = ['get', 'list', 'search', 'read', 'describe', 'query', 'count', 'check', 'fetch', 'open']
const 会话词 = ['conversation', 'friend', 'contact', 'session', '会话', '好友', '联系人']
const 历史词 = ['message', 'history', 'record', '聊天', '消息', '记录']
const 时间原字段 = ['time', 'timestamp', 'sent_time', 'send_time', 'created_at', 'createTime', 'date']
/** 整条只剩占位（[动画表情]、[图片] 一类）：没有可记的内容，如实跳过。 */
const 纯占位 = /^(?:\[[^\[\]]{1,16}\]\s*)+$/
/** 聊天记录里夹带的令牌样式（OpenAI/DeepSeek/Anthropic/GitHub/Slack/Google）：进经历流之前换成 [机密]，
 *  事情记得住，原文留不下。 */
const 机密样 = /\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,})/g

const 是对象 = (值) => 值 !== null && typeof 值 === 'object' && !Array.isArray(值)
const 文本 = (值) => (typeof 值 === 'string' ? 值.trim() : typeof 值 === 'number' ? String(值) : '')
const 短 = (值, 限) => {
  const s = String(值 === undefined || 值 === null ? '' : 值)
  return s.length <= 限 ? s : s.slice(0, 限)
}
const 名段 = (小) => String(小).toLowerCase().split(/[^a-z0-9]+/)
const 归名 = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')

/** 参数表里声明的条数上限（schema 的 maximum）；没声明就返回 0。 */
const 上限 = (项) => {
  const 值 = Number(是对象(项) ? 项.maximum : NaN)
  return Number.isFinite(值) && 值 > 0 ? 值 : 0
}

/** 32 位稳定整数：observe 的经历指纹里带 seq，不给稳定 seq 就每次都是新条目，重放会写两遍。 */
function 稳定序号(文字) {
  let 值 = 0x811c9dc5
  for (let i = 0; i < 文字.length; i++) {
    值 ^= 文字.charCodeAt(i)
    值 = Math.imul(值, 0x01000193) >>> 0
  }
  return 值
}

/** JSON 里套 JSON 字符串是本地服务的家常便饭，先掏成对象。 */
function 掏对象(值) {
  let 当前 = 值
  for (let 层 = 0; 层 < 4; 层++) {
    if (typeof 当前 === 'string') {
      const 文 = 当前.trim()
      if (文 === '' || (文[0] !== '{' && 文[0] !== '[')) return null
      try {
        当前 = JSON.parse(文)
      } catch (error) {
        return null
      }
      continue
    }
    if (是对象(当前) || Array.isArray(当前)) return 当前
    return null
  }
  return null
}

/** MCP 的返回是「JSON 文本装在一个 content 块里」，也可能直接给 structuredContent。 */
function 解析返回(result) {
  if (是对象(result) && 是对象(result.structuredContent)) return result.structuredContent
  const 块 = Array.isArray(result && result.content) ? result.content : []
  const 文 = 块
    .filter((b) => 是对象(b) && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim()
  if (文 === '') return null
  const 掏 = 掏对象(文)
  return 掏 === null ? { 原始: 文 } : 掏
}

/** 按「像不像这个名字」挑字段：外部服务的字段各家一套，挑不中就返回空串，由调用方如实报错。 */
function 挑字段(属性, 精确, 宽松) {
  const 名 = Object.keys(属性 || {})
  for (const 期望 of 精确) {
    const 中 = 名.find((k) => 归名(k) === 归名(期望))
    if (中 !== undefined) return 中
  }
  for (const 期望 of 宽松) {
    const 中 = 名.find((k) => 归名(k).includes(归名(期望)))
    if (中 !== undefined) return 中
  }
  return ''
}

/** 本地服务爱把数组再包一层 `{ data: { list: [...] } }`，所以要往下找两层。 */
function 挑列表(值, 候选, 层 = 0) {
  const 对象 = 掏对象(值)
  if (对象 === null) return null
  if (Array.isArray(对象)) return 对象
  for (const 键 of 候选) {
    if (Array.isArray(对象[键])) return 对象[键]
  }
  if (层 >= 2) return null
  for (const 内 of Object.values(对象)) {
    const 找 = 挑列表(内, 候选, 层 + 1)
    if (找 !== null) return 找
  }
  return null
}

/** 按名字找数字字段（next_offset、snapshot_max_id 这类分页信号）；null、空串、布尔都不算数。 */
function 挑数字(对象, 键们) {
  if (!是对象(对象)) return null
  for (const 键 of 键们) {
    const 原始 = 对象[键]
    if (typeof 原始 === 'number' && Number.isFinite(原始)) return 原始
    if (typeof 原始 === 'string' && 原始.trim() !== '' && Number.isFinite(Number(原始))) return Number(原始)
  }
  return null
}

/** 名字段或描述里带这些词，才认为它干这一类活；必须是只读前缀开头的动作。 */
function 挑工具(清单, 词) {
  let 最佳 = null
  let 最佳分 = 0
  for (const tool of 清单) {
    const 名 = 文本(tool && tool.name)
    if (名 === '') continue
    const 段 = 名段(名)
    if (拒绝词.some((w) => 段.some((s) => s === w || s.startsWith(w)))) continue
    const 描述 = String((tool && tool.description) || '').toLowerCase()
    let 分 = 段.some((s) => 词.some((w) => s === w || s.startsWith(w))) ? 2 : 0
    if (分 === 0 && 词.some((w) => 描述.includes(w))) 分 = 1
    if (分 === 0) continue
    if (!只读前缀.some((p) => 段[0] === p)) 分 = 0
    if (分 > 最佳分) {
      最佳分 = 分
      最佳 = tool
    }
  }
  return 最佳
}

/**
 * 历史工具得会「翻一间屋的整段记录」。光看名字会翻车：Tulpa 的 read_conversation
 * 名字里没有 message，而 get_messages_since 有——按名字挑会挑中那个增量工具，
 * 整段历史永远只能读到最新一页。所以把参数表也算进分：有会话参数、能翻页、
 * 能定方向的才是整段读取器；带关键词过滤（搜索类）和 since/after（增量类）的减分。
 */
function 挑历史工具(清单) {
  let 最佳 = null
  // 门槛 3：光沾一个「消息」词的不算——参数表里得有会话参数或翻页参数的证据。
  let 最佳分 = 2
  for (const tool of 清单) {
    const 名 = 文本(tool && tool.name)
    if (名 === '') continue
    const 段 = 名段(名)
    if (拒绝词.some((w) => 段.some((s) => s === w || s.startsWith(w)))) continue
    if (!只读前缀.some((p) => 段[0] === p)) continue
    const 描述 = String((tool && tool.description) || '').toLowerCase()
    const 属性 = 是对象(tool && tool.inputSchema) && 是对象(tool.inputSchema.properties) ? tool.inputSchema.properties : {}
    let 分 = 0
    if (段.some((s) => 历史词.some((w) => s === w || s.startsWith(w)))) 分 += 2
    else if (历史词.some((w) => 描述.includes(w))) 分 += 1
    if (段.some((s) => 会话词.some((w) => s === w || s.startsWith(w)))) 分 += 2
    if (挑字段(属性, ['conversation_id', 'chat_id', 'conversationId', 'chatId'], ['conversation', 'chat']) !== '') 分 += 2
    if (挑字段(属性, ['offset', 'cursor'], ['offset', 'cursor']) !== '') 分 += 1
    if (挑字段(属性, ['order', 'sort'], ['order', 'sort']) !== '') 分 += 1
    if (挑字段(属性, ['query', 'keyword', 'q', 'search'], ['query', 'keyword']) !== '') 分 -= 2
    if (段.some((s) => ['since', 'after', 'latest', 'new', 'recent'].some((w) => s === w || s.startsWith(w)))) 分 -= 3
    if (分 > 最佳分) {
      最佳分 = 分
      最佳 = tool
    }
  }
  return 最佳
}

/** content 可能是一整段文本，也可能是混着图片、语音的段列表。 */
function 消息正文(条) {
  const 直 = 文本(条.message) || 文本(条.text) || 文本(条.msg) || 文本(条.content)
  if (直 !== '') return 短(直, 单条上限)
  const 段 = Array.isArray(条.content) ? 条.content : null
  if (段 === null) return ''
  const 出 = []
  for (const 块 of 段) {
    if (!是对象(块)) continue
    if (typeof 块.text === 'string' && 块.text.trim() !== '') 出.push(块.text.trim())
    else if (块.type === 'image') 出.push('[图片]')
    else if (块.type === 'voice') 出.push('[语音]')
    else if (块.type === 'file') 出.push('[文件]')
  }
  return 短(出.join(' '), 单条上限)
}

function 挑值(条, 键们) {
  for (const 键 of 键们) {
    const 值 = 文本(条[键])
    if (值 !== '') return 值
  }
  return ''
}

/** 时间的原始值：秒和毫秒都见过，翻页游标要按原单位回传。 */
function 时间原值(条) {
  for (const 键 of 时间原字段) {
    const 值 = Number(条[键])
    if (Number.isFinite(值) && 值 > 0) return 值
  }
  return 0
}

/** Tulpa 的时刻是「2026-10-21 08:04:35 +08:00」这类文本；不带时区按北京时间算，认不出返回 0。 */
function 解析时刻串(文) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\s*(Z|[+-]\d{2}:?\d{2}))?$/.exec(String(文).trim())
  if (m === null) return 0
  const [, 年, 月, 日, 时, 分, 秒, 区] = m
  if (Number(月) < 1 || Number(月) > 12 || Number(日) < 1 || Number(日) > 31
    || Number(时) > 23 || Number(分) > 59 || Number(秒) > 59) return 0
  let 毫秒 = Date.UTC(Number(年), Number(月) - 1, Number(日), Number(时), Number(分), Number(秒 || 0))
  if (区 === undefined) 毫秒 -= 8 * 3600000
  else if (区 !== 'Z') {
    const 号 = 区[0] === '-' ? -1 : 1
    毫秒 -= 号 * (Number(区.slice(1, 3)) * 60 + Number(区.slice(-2))) * 60000
  }
  return 毫秒
}

/** 存进经历的时刻统一成毫秒：数字按秒/毫秒换算，文本按上表解析。 */
function 消息时刻(条) {
  for (const 键 of 时间原字段) {
    const 原始 = 条[键]
    if (typeof 原始 === 'string') {
      const 毫秒 = 解析时刻串(原始)
      if (毫秒 > 0) return 毫秒
    } else {
      const 值 = Number(原始)
      if (Number.isFinite(值) && 值 > 0) return 值 < 1e11 ? 值 * 1000 : 值
    }
  }
  return 0
}

/** 会话列表里的条目没有 id 字段时，才退回去拿名字当标识。 */
function 会话标识(项) {
  if (typeof 项 === 'string' || typeof 项 === 'number') return 文本(项)
  if (!是对象(项)) return ''
  const 直 = 挑值(项, ['conversation_id', 'conversationId', 'chat_id', 'chatId', 'target_id', 'sender_id', 'user_id', 'userId', 'qq', 'id', 'uid'])
  if (直 !== '') return 直
  // 也见过把会话号裹在 { user: { user_id } } 里的写法。
  for (const 内 of Object.values(项)) {
    if (是对象(内)) {
      const 套 = 挑值(内, ['conversation_id', 'chat_id', 'user_id', 'qq', 'id'])
      if (套 !== '') return 套
    }
  }
  return ''
}

const 是群名 = (值) => {
  const 文 = 文本(值).toLowerCase()
  return 文.includes('群') || 文.includes('group')
}

/**
 * 群聊一律不导：旧群记录里有第三人在场，接话风险跟她自己开口的风险不是一个量级。
 * `name` 只在这条带群号、或者名字里确有「群 / group」时才当群看，好友备注不能当群名判。
 */
function 是群(项) {
  if (!是对象(项)) return false
  if (项.is_group === true || 项.isGroup === true || 项.group === true) return true
  if (挑值(项, ['group_id', 'groupId', 'guild_id', 'room_id']) !== '') return true
  for (const 键 of ['conversation_type', 'chat_type', 'type', 'kind']) {
    if (是群名(项[键])) return true
  }
  return 是群名(项.name) || 是群名(项.title)
}

/** MCP streamable-HTTP 客户端：一次导入用到坏为止，坏了整轮报错，下次点「继续导」重连。 */
class 连接 {
  constructor(地址, 令牌) {
    this.地址 = 地址
    this.令牌 = 令牌
    this.会话id = ''
    this.号 = 0
  }

  async 发(方法, 参数, 要回执 = true) {
    const 请求 = { jsonrpc: '2.0', method: 方法, params: 参数 || {} }
    if (要回执) {
      this.号 += 1
      请求.id = this.号
    }
    const 头 = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
    if (this.令牌 !== '') 头.authorization = `Bearer ${this.令牌}`
    if (this.会话id !== '') 头['mcp-session-id'] = this.会话id
    const 控 = new AbortController()
    const 定时器 = setTimeout(() => 控.abort(), 请求超时毫秒)
    let 响应
    try {
      响应 = await fetch(this.地址, { method: 'POST', headers: 头, body: JSON.stringify(请求), signal: 控.signal })
    } finally {
      clearTimeout(定时器)
    }
    const 新会话 = 响应.headers.get('mcp-session-id')
    if (新会话 !== null && 新会话 !== '') this.会话id = 新会话
    if (响应.status === 401 || 响应.status === 403) throw new Error('Tulpa 拒了这次请求：检查 MCP 地址和访问令牌')
    if (!响应.ok) throw new Error(`Tulpa 返回 HTTP ${响应.status}`)
    if (!要回执) return null
    const 文 = await 响应.text()
    const 行 = 文
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
    for (const 段 of 行.length > 0 ? 行 : [文]) {
      let 包
      try {
        包 = JSON.parse(段)
      } catch (error) {
        continue
      }
      if (!是对象(包)) continue
      if (是对象(包.error)) throw new Error(`Tulpa 报错：${短(文本(包.error.message) || 文本(包.error.code), 200)}`)
      if (包.result !== undefined) return 包.result
    }
    throw new Error('Tulpa 返回的不是能读的 MCP 报文')
  }

  async 开工() {
    const 结果 = await this.发('initialize', {
      protocolVersion: 协议版本,
      capabilities: {},
      clientInfo: { name: 'dsh-qq-bridge', version: '1.0' },
    })
    if (!是对象(结果)) throw new Error('Tulpa 的 initialize 没有返回内容')
    await this.发('notifications/initialized', {}, false)
    return 结果
  }

  async 工具清单() {
    const 出 = []
    let 游标 = ''
    for (let 页 = 0; 页 < 10; 页++) {
      const 结果 = await this.发('tools/list', 游标 === '' ? {} : { cursor: 游标 })
      const 页清单 = 结果 && Array.isArray(结果.tools) ? 结果.tools : []
      出.push(...页清单)
      const 下 = 结果 && typeof 结果.nextCursor === 'string' ? 结果.nextCursor : ''
      if (下 === '' || 下 === 游标 || 页清单.length === 0) break
      游标 = 下
    }
    return 出
  }

  调(name, 参数) {
    return this.发('tools/call', { name, arguments: 参数 })
  }
}

/**
 * 一次点「继续导」跑一轮有上限的导入；进度落在游标文件里，重启之后接着往更早翻。
 * @param {{ 鱼脑: { observe?: Function } | null, 状态文件: string, 日志?: Function }} 依赖
 * @returns {{ 跑: Function, 停: Function, 重置: Function, 概况: () => object }}
 */
export function 创建历史导入({ 鱼脑, 状态文件, 日志 = () => {} }) {
  const 空状态 = () => ({
    运行中: false, 停止: false, 游标: {}, 会话: null,
    计数: { 写: 0, 重: 0, 跳: 0 }, 页: 0, 工具: '', 错误: '', 最近: 0,
  })
  let 状态 = 空状态()

  function 读盘() {
    try {
      const 盘 = 掏对象(readFileSync(状态文件, 'utf8'))
      if (是对象(盘) && 是对象(盘.游标)) 状态.游标 = 盘.游标
    } catch (error) {
      // 没有游标文件就是第一次导，从最新一页开始，不算错误。
    }
  }

  function 落盘() {
    try {
      mkdirSync(dirname(状态文件), { recursive: true })
      writeFileSync(状态文件, `${JSON.stringify({ 更新: new Date().toISOString(), 游标: 状态.游标 }, null, 2)}\n`, 'utf8')
      return true
    } catch (error) {
      日志(`导入：游标写不进 ${状态文件}`)
      return false
    }
  }

  function 概况() {
    return {
      运行中: 状态.运行中,
      会话数: Object.keys(状态.游标).length,
      本轮: { ...状态.计数, 页数: 状态.页 },
      工具: 状态.工具,
      错误: 状态.错误,
      最近: 状态.最近,
      状态文件,
    }
  }

  /** 一条历史消息 → 一条经历。认不出形状就跳过，绝不编内容。 */
  function 写入(条, 会话id, 每轮条数) {
    if (!是对象(条)) return '跳'
    if (状态.计数.写 >= 每轮条数) return '满'
    const 原文 = 消息正文(条)
    if (原文 === '' || 纯占位.test(原文)) return '跳'
    // 占位判断看原文（纯密钥消息不是占位，替换成 [机密] 后仍保留这条事件），
    // 落库与指纹一律用替换后的文字。
    const 文字 = 原文.replace(机密样, '[机密]')
    const id = 挑值(条, ['message_id', 'messageId', 'id', 'seq'])
    const 时刻 = 消息时刻(条)
    // 这一条属于哪间屋以「正在导的这间」为准：消息里的 sender_id 是说话人，不是会话。
    const 房间 = 会话id || 会话标识(条) || '未知会话'
    const 发送 = 挑值(条, ['sender_id', 'senderId', 'user_id', 'userId', 'from'])
      || (是对象(条.sender) ? 挑值(条.sender, ['user_id', 'userId', 'id', 'nickname', 'card']) : '')
    const 结果 = 鱼脑 === null || typeof 鱼脑.observe !== 'function'
      ? { ok: false }
      : 鱼脑.observe({
          at: 时刻 > 0 ? 时刻 : undefined,
          sessionId: `session-qq-import-${短(房间, 40)}`,
          seq: 稳定序号(`${房间}|${id}|${时刻}|${文字}`),
          kind: 'message',
          role: 'user',
          actor: 发送 === '' ? '旧记录' : `旧记录 ${短(发送, 24)}`,
          source: 导入来源,
          text: 文字,
          meta: {
            imported: true,
            origin: 'tulpa',
            trust: 导入可信度,
            conversation: 短(房间, 40),
            ...(id === '' ? {} : { message_id: 短(id, 32) }),
          },
        })
    if (!结果 || !结果.ok) return '跳'
    // observe 返回的 id 为空是经历指纹命中：这条以前导过，重放不会再写第二遍。
    return 结果.id === null || 结果.id === undefined ? '重' : '写'
  }

  /** 往更早翻：用本页最早一条的时间当下一页起点，单位跟消息里看到的保持一致。 */
  function 本页最早(消息列表) {
    let 最小 = 0
    for (const 条 of 消息列表) {
      if (!是对象(条)) continue
      const 值 = 时间原值(条)
      if (值 === 0) continue
      最小 = 最小 === 0 ? 值 : Math.min(最小, 值)
    }
    return 最小 === 0 ? null : 最小 - 1
  }

  async function 导一轮(配置) {
    const 令牌 = 配置.令牌 === '' ? (process.env.TULPA_MCP_TOKEN || '') : 配置.令牌
    if (令牌 === '') throw new Error('没有访问令牌：TULPA_MCP_TOKEN 没设，设置页里也没填')
    const 接 = new 连接(配置.地址, 令牌)
    await 接.开工()
    const 清单 = await 接.工具清单()
    if (清单.length === 0) throw new Error('Tulpa 没有暴露任何工具：检查它有没有把 MCP 开放给智能体')

    const 会话工具 = 挑工具(清单, 会话词)
    const 历史工具 = 挑历史工具(清单)
    if (历史工具 === null) throw new Error(`Tulpa 的 ${清单.length} 个工具里没有能读聊天记录的`)
    状态.工具 = 历史工具.name + (会话工具 === null ? '' : ` + ${会话工具.name}`)

    const 参数表 = 是对象(历史工具.inputSchema) && 是对象(历史工具.inputSchema.properties)
      ? 历史工具.inputSchema.properties
      : {}
    const 会话键 = 挑字段(参数表,
      ['conversation_id', 'chat_id', 'target_id', 'conversationId', 'chatId', 'friend_id'],
      ['conversation', 'chat', 'target', 'friend'])
    const 时间键 = 挑字段(参数表,
      ['end_time', 'to_time', 'before', 'max_time', 'start_time', 'begin_time', 'from_time', 'time'],
      ['time', 'date'])
    const 条数键 = 挑字段(参数表, ['count', 'limit', 'page_size', 'pageSize', 'size', 'max'], ['count', 'limit', 'size'])
    const 偏移键 = 挑字段(参数表, ['offset', 'cursor', 'next_offset'], ['offset', 'cursor'])
    const 顺序键 = 挑字段(参数表, ['order', 'sort_order', 'sortOrder', 'sort'], ['order', 'sort'])
    const 快照键 = 挑字段(参数表, ['snapshot_max_id', 'snapshotMaxId', 'snapshot_id'], ['snapshot'])
    const 平台键 = 挑字段(参数表, ['platform'], ['platform'])
    const 顺序枚举 = 顺序键 !== '' && 是对象(参数表[顺序键]) && Array.isArray(参数表[顺序键].enum)
      ? 参数表[顺序键].enum.map(文本)
      : null
    const 顺序值 = 顺序枚举 === null ? '' : (顺序枚举.includes('newest') ? 'newest' : (顺序枚举.includes('desc') ? 'desc' : ''))
    // 有时间游标的老服务走时间翻页；没有时间参数但有 offset 的（Tulpa）走偏移翻页。
    const 用偏移 = 偏移键 !== '' && 时间键 === ''

    const 平台表 = new Map()
    let 房间 = []
    if (状态.会话 !== null && 状态.会话.到 > Date.now()) {
      房间 = 状态.会话.列表
    } else if (会话工具 !== null) {
      // 会话目录自己也分页（Tulpa 每页至多 20 间），翻完才算数。
      const 会话参数表 = 是对象(会话工具.inputSchema) && 是对象(会话工具.inputSchema.properties)
        ? 会话工具.inputSchema.properties
        : {}
      const 会话条数键 = 挑字段(会话参数表, ['count', 'limit', 'page_size', 'pageSize', 'size', 'max'], ['count', 'limit', 'size'])
      const 会话偏移键 = 挑字段(会话参数表, ['offset', 'cursor', 'next_offset'], ['offset', 'cursor'])
      const 会话平台键 = 挑字段(会话参数表, ['platform'], ['platform'])
      const 基础 = {}
      if (会话平台键 !== '') 基础[会话平台键] = 'qq'
      if (会话条数键 !== '') 基础[会话条数键] = Math.min(上限(会话参数表[会话条数键]) || 20, 20)
      let 偏移 = 0
      for (let 页 = 0; 页 < 100; 页++) {
        const 参数 = 会话偏移键 === '' || 偏移 === 0 ? 基础 : { ...基础, [会话偏移键]: 偏移 }
        const 包 = 解析返回(await 接.调(会话工具.name, 参数))
        const 页房间 = 挑列表(包, ['list', 'items', 'data', 'conversations', 'friends', 'result']) || []
        房间.push(...页房间)
        const 还有键 = 挑字段(包, ['has_more', 'hasMore'], [])
        const 还有 = 还有键 === '' ? null : 包[还有键]
        let 续 = 挑数字(包, ['next_offset', 'nextOffset', 'next_cursor'])
        if (续 === null && 还有 === true) 续 = 偏移 + 页房间.length
        if (页房间.length === 0 || 续 === null || 续 === 偏移 || 还有 === false) break
        偏移 = 续
      }
      状态.会话 = { 列表: 房间, 到: Date.now() + 会话缓存毫秒 }
    }
    if (房间.length === 0) {
      const 已知 = Object.keys(状态.游标)
      if (已知.length === 0) throw new Error('Tulpa 没有返回任何会话：检查它那边有没有登录、有没有同步过记录')
      房间 = 已知.map((id) => ({ id }))
    }

    const 白名单 = 配置.白名单.length > 0 ? new Set(配置.白名单) : null
    const 目标 = []
    for (const 项 of 房间) {
      const id = 会话标识(项)
      if (id === '' || 是群(项)) continue
      if (白名单 !== null && !白名单.has(id)) continue
      if (!目标.includes(id)) {
        目标.push(id)
        if (是对象(项) && 文本(项.platform) !== '') 平台表.set(id, 文本(项.platform))
      }
    }
    if (目标.length === 0) throw new Error('要导的私聊一个都没找到：检查私聊白名单，或者 Tulpa 里有没有这些会话')
    if (会话键 === '' && 目标.length > 1) throw new Error(`「${历史工具.name}」没有会话参数：一次只能导一间，请填私聊白名单`)

    for (const 间 of 目标) {
      if (状态.停止 || 状态.计数.写 >= 配置.每轮条数) break
      const 进度 = 是对象(状态.游标[间]) ? 状态.游标[间] : { 位置: null, 完成: false }
      状态.游标[间] = 进度
      if (进度.完成) continue
      const 基础 = {}
      if (会话键 !== '') 基础[会话键] = 间
      if (平台键 !== '' && 平台表.has(间)) 基础[平台键] = 平台表.get(间)
      if (顺序值 !== '') 基础[顺序键] = 顺序值
      if (条数键 !== '') 基础[条数键] = Math.min(上限(参数表[条数键]) || 50, 配置.每轮条数)
      if (快照键 !== '' && Number.isFinite(进度.快照)) 基础[快照键] = 进度.快照
      let 参数 = 用偏移 && typeof 进度.位置 === 'number'
        ? { ...基础, [偏移键]: 进度.位置 }
        : (时间键 !== '' && typeof 进度.位置 === 'number' ? { ...基础, [时间键]: 进度.位置 } : 基础)

      for (let 页 = 0; 页 < 配置.每轮页数 && 状态.计数.写 < 配置.每轮条数 && !状态.停止; 页++) {
        状态.页 += 1
        const 包 = 解析返回(await 接.调(历史工具.name, 参数))
        const 消息 = 挑列表(包, ['list', 'messages', 'records', 'items', 'data', 'result']) || []
        let 本页新 = 0
        let 页走完 = true
        for (const 条 of 消息) {
          const r = 写入(条, 间, 配置.每轮条数)
          if (r === '写') {
            状态.计数.写 += 1
            本页新 += 1
          } else if (r === '满') {
            状态.停止 = true
            页走完 = false
            break
          } else if (r === '重') 状态.计数.重 += 1
          else 状态.计数.跳 += 1
        }
        // 满在一页中间停下：游标留在这页开头，下轮重读，写过的算重复，不漏后半页。
        if (!页走完) break
        if (用偏移) {
          if (快照键 !== '' && !Number.isFinite(进度.快照)) {
            const 快照 = 挑数字(包, [快照键, 'snapshot_max_id', 'snapshotMaxId'])
            if (快照 !== null) {
              进度.快照 = 快照
              基础[快照键] = 快照
              参数 = { ...参数, [快照键]: 快照 }
            }
          }
          const 当步 = typeof 参数[偏移键] === 'number' ? 参数[偏移键] : 0
          const 还有键 = 挑字段(包, ['has_more', 'hasMore'], [])
          let 下步 = 挑数字(包, ['next_offset', 'nextOffset', 'next_cursor'])
          if (下步 === null && 还有键 !== '' && 包[还有键] === true) 下步 = 当步 + 消息.length
          // 翻不动就收：空页、没有下步、或者下步原地踏步，都说明这间导到底了。
          if (消息.length === 0 || 下步 === null || 下步 === 当步) {
            进度.完成 = true
            break
          }
          进度.位置 = 下步
          参数 = { ...基础, [偏移键]: 下步 }
        } else {
          const 起点 = 本页最早(消息)
          // 翻不动就收：这一间导到底了，或者这个服务不给时间参数、只认最新一页。
          if (本页新 === 0 || 时间键 === '' || 起点 === null) {
            进度.完成 = true
            break
          }
          进度.位置 = 起点
          参数 = { ...基础, [时间键]: 起点 }
        }
        落盘()
      }
      落盘()
    }
    return {
      ok: true,
      写: 状态.计数.写,
      重: 状态.计数.重,
      跳: 状态.计数.跳,
      页: 状态.页,
      说: 状态.计数.写 >= 配置.每轮条数
        ? '这一轮到条数上限了，再点一次接着导'
        : 状态.停止
          ? '已停止，进度都在游标文件里'
          : '该导的都导完了',
    }
  }

  return {
    概况,
    /** 跑一轮；同一时刻只允许一轮。 */
    跑(配置) {
      if (状态.运行中) return Promise.resolve({ ok: false, 说: '已经在导了，先等这一轮结束' })
      状态 = { ...空状态(), 游标: 状态.游标, 运行中: true }
      读盘()
      return 导一轮(配置)
        .catch((error) => {
          状态.错误 = 短(String((error && error.message) || error), 300)
          日志(`导入：${状态.错误}`)
          return { ok: false, 说: 状态.错误, 写: 状态.计数.写, 重: 状态.计数.重, 跳: 状态.计数.跳, 页: 状态.页 }
        })
        .then((出) => {
          状态.运行中 = false
          状态.最近 = Date.now()
          落盘()
          return 出
        })
    },
    停() {
      状态.停止 = true
      return { ok: true, 说: '已请求停止：这一页导完就停，进度已经落盘' }
    },
    重置() {
      if (状态.运行中) return { ok: false, 说: '正在导，先停下再重置' }
      状态.游标 = {}
      状态.会话 = null
      落盘()
      return { ok: true, 说: '游标清了，下次从头开始（重复的条目不会再写进经历）' }
    },
  }
}
