// 群/好友消息里“记住…”的低成本预筛。
//
// 这里只负责把候选消息挑出来交给鱼脑；是不是真的请求、要记什么、要不要保密，
// 由 dsh-fish-mind 的 parseMemoryRequest 再判一次。两边都排除问句和否定，
// 避免把“你记得吗”“没记住”当成写入请求。

const QUESTION = /(?:记得吗|记住了吗|记住了没|记不记得|还记得|记得不|记住没)/u
const NEGATION = /(?:没记住|没记下|记不住|记不清|别记|不用记)/u
const REQUEST = /(?:帮我|给我|你|麻烦|请|要|得)?\s*(?:记住|记一下|记下|记着|别忘了|别忘记)/u

/**
 * 这条消息值不值得交给鱼脑细判。
 * @param {string} raw - 单条消息正文。
 * @returns {boolean} true 表示像“记住…”。
 */
export function looksLikeMemoryRequest(raw) {
  const text = String(raw === undefined || raw === null ? '' : raw).trim()
  if (text.length < 4) return false
  if (QUESTION.test(text) || NEGATION.test(text)) return false
  return REQUEST.test(text)
}
