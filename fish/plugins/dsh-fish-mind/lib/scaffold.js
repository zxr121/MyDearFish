// 旧版 QQ 桥把内部提示、图注和表情说明拼进了用户正文。记忆和由头都先剥掉这些行，
// 只留真正的对话；旧库清理和挑选由头共用同一套标记，免得两边慢慢长歪。

const SCAFFOLD_MARKERS = [
  '说话节奏·内部提示',
  '群聊语感·内部提示',
  '【这一轮的分寸】',
  '【关系分寸】',
  '【你在 QQ 收藏的表情包】',
  '【存表情】',
  '【收藏对应】',
  '【表情没发成】',
  '[发表情:',
  '[存表情:',
]

/** 这一行是不是桥拼进来的提示、图注或表情说明。 */
export function isScaffoldLine(value) {
  const line = String(value ?? '').trim()
  if (line === '') return false
  if (line === '[图片]') return true
  if (/^【图\s*\d+/.test(line)) return true
  return SCAFFOLD_MARKERS.some((marker) => line.includes(marker))
}

/** 去掉脚手架行和行内图注，返回剩下的对话正文。 */
export function stripScaffold(value) {
  return String(value ?? '')
    .split('\n')
    .filter((line) => !isScaffoldLine(line))
    .map((line) => line.replace(/\[图片\]/g, '').trim())
    .filter((line) => line !== '')
    .join('\n')
    .trim()
}

/** 整段正文里有没有脚手架、群/好友提示转储，或她自己主动开口的旁注。 */
export function hasScaffold(value) {
  const text = String(value ?? '')
  if (text.includes('【QQ 群聊·群') || text.includes('【QQ 好友私聊·')) return true
  if (text.trim() === '（我自己主动开的口）') return true
  if (text.includes('[图片]')) return true
  return text.split('\n').some((line) => isScaffoldLine(line))
}

/** 群/好友提示转储里真正聊过的话：只留每行以【最近聊过】开头的条目。 */
export function extractRecentChat(value) {
  const kept = []
  for (const line of String(value ?? '').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('【最近聊过】')) continue
    const body = trimmed.slice('【最近聊过】'.length).trim()
    if (body !== '') kept.push(body)
  }
  return kept.join('\n').trim()
}
