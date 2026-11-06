// QQ 表情商城的公开包目录：只读包名、简介和每张的官方名字/关键词。
//
// 目录和图片都不需要登录；目录只从 i.gtimg.cn 取，图片统一走 gxh.vip.qq.com。
// 这里不碰收藏、不碰配置，只做取数、归一和名字清理，方便离线测试。

const 目录基址 = 'https://i.gtimg.cn/club/item/parcel'
const 图基址 = 'https://gxh.vip.qq.com/club/item/parcel/item'
const 目录域名 = 'i.gtimg.cn'

/** 目录请求的超时；超时就当这次没取到，不拦消息。 */
export const 系列目录超时毫秒 = 2500
/** 一份目录在内存里留多久；包名和官方名不会天天变。 */
export const 系列缓存毫秒 = 7 * 24 * 60 * 60_000
/** 取失败后多久再试，避免同一套表情反复打 CDN。 */
export const 系列失败缓存毫秒 = 5 * 60_000

/**
 * QQ 表情包的公开目录地址。
 * @param {number|string} packId - 表情包编号；只取整数部分。
 * @returns {string} 目录 URL；编号不合法时返回空串。
 */
export function 系列目录址(packId) {
  const 号 = Number(packId)
  if (!Number.isInteger(号) || 号 <= 0) return ''
  return `${目录基址}/${号 % 10}/${号}.json`
}

/**
 * 一张商城表情的图片地址。动态图先试 raw300.gif，静态或取不到时再试 300x300.png。
 * 图片 id 原样用，可能带 `face` 前缀，不能按 32 位 md5 截断。
 * @param {string} 表情号 - 包目录里的 `imgs[].id`。
 * @param {boolean} [动] - true 取 GIF，false 取 PNG。
 * @returns {string} 图片 URL；id 为空时返回空串。
 */
export function 系列图址(表情号, 动 = true) {
  const id = String(表情号 || '').trim()
  if (id === '' || id.length > 64 || !/^[a-z0-9]+$/i.test(id)) return ''
  return `${图基址}/${id.slice(0, 2)}/${id}/${动 ? 'raw300.gif' : '300x300.png'}`
}

/**
 * 把消息里的 `[捏捏]`、包名或目录字段收成能直接当备注的短名。
 * @param {unknown} 值 - 原文。
 * @returns {string} 去掉一层方括号/引号、压平空白后的短名；空值返回空串。
 */
export function 净商城名(值) {
  let 名 = String(值 === undefined || 值 === null ? '' : 值)
    .replace(/^[\[【［]\s*/u, '')
    .replace(/\s*[\]】］]$/u, '')
    .replace(/^[“"「『]\s*/u, '')
    .replace(/\s*[”"」』]$/u, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (名.length > 24) 名 = 名.slice(0, 24).trim()
  return 名
}

/** 包简介只留一行，去掉控制字符和多余空白。 */
function 净简介(值) {
  return String(值 || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
}

/** 关键词只留短的、不重复的；最多 8 个。 */
function 归关键词(值) {
  const 出 = []
  const 见 = new Set()
  for (const 项 of Array.isArray(值) ? 值 : []) {
    const 词 = 净商城名(项)
    if (词 === '' || 见.has(词)) continue
    见.add(词)
    出.push(词)
    if (出.length >= 8) break
  }
  return 出
}

/**
 * 把公开目录归一成 `{id, name, mark, author, price, updateTime, items}`。
 * 只收有图片 id 的条目；数量最多 60，防止异常目录把索引撑大。
 * @param {unknown} 数据 - 目录 JSON。
 * @param {number} [期望号] - 期望的包编号；目录没给 id 时用它。
 * @returns {{id: number, name: string, mark: string, author: string, price: number, updateTime: number, items: {id: string, name: string, keywords: string[]}[]}|null}
 */
export function 归系列包(数据, 期望号 = 0) {
  if (!数据 || typeof 数据 !== 'object') return null
  const 号 = Number(数据.id === undefined || 数据.id === null ? 期望号 : 数据.id)
  if (!Number.isInteger(号) || 号 <= 0) return null
  const 见 = new Set()
  const items = []
  for (const 项 of Array.isArray(数据.imgs) ? 数据.imgs : []) {
    if (!项 || typeof 项 !== 'object') continue
    const id = String(项.id || '').trim()
    if (id === '' || id.length > 64 || !/^[a-z0-9]+$/i.test(id) || 见.has(id)) continue
    见.add(id)
    items.push({
      id,
      name: 净商城名(项.name) || 净商城名(项.keywords && 项.keywords[0]) || '',
      keywords: 归关键词(项.keywords),
    })
    if (items.length >= 60) break
  }
  if (items.length === 0) return null
  return {
    id: 号,
    name: 净商城名(数据.name) || `表情包 ${号}`,
    mark: 净简介(数据.mark),
    author: 净商城名(数据.author),
    price: Number(数据.price) || 0,
    updateTime: Number(数据.updateTime) || 0,
    items,
  }
}

/**
 * 取一份公开的 QQ 表情包目录；失败返回 null，不抛异常。
 * @param {number|string} packId - 表情包编号。
 * @param {{fetchImpl?: typeof fetch, timeout?: number}} [选项] - 测试可注入的 fetch 和超时。
 * @returns {Promise<ReturnType<typeof 归系列包>>} 归一后的包；取不到返回 null。
 */
export async function 取系列目录(packId, 选项 = {}) {
  const 址 = 系列目录址(packId)
  if (址 === '') return null
  const 取 = typeof 选项.fetchImpl === 'function' ? 选项.fetchImpl : fetch
  const 超时 = Math.max(100, Number(选项.timeout) || 系列目录超时毫秒)
  const 控 = new AbortController()
  const 计时 = setTimeout(() => 控.abort(), 超时)
  try {
    const r = await 取(址, {
      signal: 控.signal,
      redirect: 'follow',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
    if (!r || !r.ok) return null
    const 终址 = String(r.url || 址)
    try {
      if (new URL(终址).hostname.toLowerCase() !== 目录域名) return null
    } catch (error) {
      return null
    }
    const 文 = await r.text()
    if (typeof 文 !== 'string' || 文.length === 0 || 文.length > 300_000) return null
    return 归系列包(JSON.parse(文), Number(packId))
  } catch (error) {
    return null
  } finally {
    clearTimeout(计时)
  }
}
