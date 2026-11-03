// 收藏权限的信任层：谁能让鱼存表情、改收藏备注。
//
// 主人永远受信；其他人默认按相处自动判定（认识够久、聊得够多、她回过、
// 熟悉度和信任分过线、没留下疤），也可以在设置页手动加白或收回。
// 这里只做纯计算，不读配置、不写人物志，方便测试和别的插件复用。

const 号上限 = 100

/** 出厂规则：手动名单为空，自动受信从 3 天 / 25 条 / 3 次互动开始。 */
export const 信任默认规则 = Object.freeze({
  自动: true,
  手动加: [],
  手动禁: [],
  最少天数: 3,
  最少见过: 25,
  最少互动: 3,
  最少熟: 15,
  最少信: 52,
  最多疤: 8,
  最多张力: 40,
})

const 夹数 = (值, 兜, 低, 高) => {
  const n = Number(值)
  return Number.isFinite(n) ? Math.min(高, Math.max(低, n)) : 兜
}

const 洗号 = (值) => {
  const s = typeof 值 === 'string' ? 值.trim() : typeof 值 === 'number' ? String(值) : ''
  return /^\d{3,20}$/.test(s) ? s : ''
}

/** 手动名单：只留合法 QQ 号，去重、限长；同时出现在加/禁两边时以禁为准。 */
function 洗号列表(值) {
  const 出 = []
  for (const 项 of Array.isArray(值) ? 值 : []) {
    const 号 = 洗号(项 && typeof 项 === 'object' ? 项.号 : 项)
    if (号 === '' || 出.includes(号)) continue
    出.push(号)
    if (出.length >= 号上限) break
  }
  return 出
}

/**
 * 把配置里的信任段洗成一定能用的规则；没给的字段用出厂值。
 * @param {unknown} 原始 - 配置里的 `社交.信任`。
 * @returns {{自动: boolean, 手动加: string[], 手动禁: string[], 最少天数: number, 最少见过: number, 最少互动: number, 最少熟: number, 最少信: number, 最多疤: number, 最多张力: number}} 归一化后的规则。
 */
export function 归一信任规则(原始) {
  const 混 = 原始 && typeof 原始 === 'object' && !Array.isArray(原始) ? 原始 : {}
  const 手动加 = 洗号列表(混.手动加)
  const 手动禁 = 洗号列表(混.手动禁)
  return {
    自动: 混.自动 === undefined ? 信任默认规则.自动 : 混.自动 === true || 混.自动 === 'true' || 混.自动 === 1 || 混.自动 === '1',
    手动加: 手动加.filter((号) => !手动禁.includes(号)),
    手动禁,
    最少天数: Math.round(夹数(混.最少天数, 信任默认规则.最少天数, 0, 30)),
    最少见过: Math.round(夹数(混.最少见过, 信任默认规则.最少见过, 0, 1000)),
    最少互动: Math.round(夹数(混.最少互动, 信任默认规则.最少互动, 0, 200)),
    最少熟: 夹数(混.最少熟, 信任默认规则.最少熟, 0, 100),
    最少信: 夹数(混.最少信, 信任默认规则.最少信, 0, 100),
    最多疤: 夹数(混.最多疤, 信任默认规则.最多疤, 0, 100),
    最多张力: 夹数(混.最多张力, 信任默认规则.最多张力, 0, 100),
  }
}

/** 人物身上所有能对上手动名单的 QQ 号（主号 + 账号组）。 */
function 账号们(人, 号 = '') {
  const 出 = new Set()
  const 主号 = 洗号(人 && 人.号)
  if (主号 !== '') 出.add(主号)
  for (const a of Array.isArray(人 && 人.账号) ? 人.账号 : []) {
    const 一个 = 洗号(a && a.号)
    if (一个 !== '') 出.add(一个)
  }
  const 单号 = 洗号(号)
  if (单号 !== '') 出.add(单号)
  return 出
}

/** 纯数字快照，设置页显示用。 */
function 数一数(人, now) {
  const 关系 = 人 && 人.关系 && typeof 人.关系 === 'object' ? 人.关系 : {}
  const 天数 = Array.isArray(人 && 人.天数) ? 人.天数.length : 0
  const 首见 = Math.max(0, Number(人 && 人.初见At) || 0)
  return {
    天数,
    认识天: 首见 > 0 ? Math.max(0, Math.floor((now - 首见) / 86_400_000)) : 天数,
    见过: Math.max(0, Math.floor(Number(关系.见过) || Number(人 && 人.见过) || 0)),
    互动: Math.max(0, Math.floor(Number(关系.互动) || 0)),
    熟: Math.max(0, Number(关系.熟) || 0),
    信: Number.isFinite(Number(关系.信)) ? Math.max(0, Number(关系.信)) : 50,
    疤: Math.max(0, Number(关系.疤) || 0),
    张力: Math.max(0, Number(关系.张力) || 0),
  }
}

/**
 * 评估一个人能不能让鱼动收藏。
 * @param {object|null} 人 - 人物志里的人；没有记录时传 null。
 * @param {object} [规则] - `归一信任规则` 的形状。
 * @param {{主人?: boolean, 号?: string, now?: number}} [选项] - 主人身份、当前 QQ 号和评估时间。
 * @returns {{级别: '主人'|'受信'|'普通'|'生人', 能收藏: boolean, 自动: boolean, 手动: ''|'加'|'禁', 原因: string[], 差: string[], 检查: {项: string, 过: boolean, 说: string}[], 数: object}} 信任结论。
 */
export function 评估信任(人, 规则 = {}, 选项 = {}) {
  const 规 = 归一信任规则(规则)
  const now = Number.isFinite(Number(选项.now)) ? Number(选项.now) : Date.now()
  const 号们 = 账号们(人, 选项.号)
  const 数 = 数一数(人, now)
  const 基础 = {
    级别: 人 ? '普通' : '生人',
    能收藏: false,
    自动: false,
    手动: '',
    原因: [],
    差: [],
    检查: [],
    数,
  }
  if (选项.主人 === true) {
    return { ...基础, 级别: '主人', 能收藏: true, 自动: true, 原因: ['主人本来就可以'] }
  }
  if ([...号们].some((号) => 规.手动禁.includes(号))) {
    return { ...基础, 手动: '禁', 原因: ['主人手动收回了收藏权限'], 差: ['在手动禁止名单里'] }
  }
  if ([...号们].some((号) => 规.手动加.includes(号))) {
    return { ...基础, 级别: '受信', 能收藏: true, 手动: '加', 原因: ['主人在受信名单里手动加了'] }
  }
  if (规.自动 !== true) return { ...基础, 差: ['自动受信关着'] }
  if (!人 || 数.见过 <= 0) return { ...基础, 差: ['还没在聊天里见过'] }
  const 检查 = [
    { 项: '天数', 过: 数.天数 >= 规.最少天数 && 数.认识天 >= Math.max(0, 规.最少天数 - 1), 说: `认识 ${数.天数} 天·${数.认识天} 个自然日（要 ≥${规.最少天数} 天）` },
    { 项: '见过', 过: 数.见过 >= 规.最少见过, 说: `见过 ${数.见过} 条（要 ≥${规.最少见过}）` },
    { 项: '互动', 过: 数.互动 >= 规.最少互动, 说: `她回过 ${数.互动} 次（要 ≥${规.最少互动}）` },
    { 项: '熟', 过: 数.熟 >= 规.最少熟, 说: `熟悉度 ${圆(数.熟)}（要 ≥${规.最少熟}）` },
    { 项: '信', 过: 数.信 >= 规.最少信, 说: `信任分 ${圆(数.信)}（要 ≥${规.最少信}）` },
    { 项: '疤', 过: 数.疤 <= 规.最多疤, 说: `疤 ${圆(数.疤)}（要 ≤${规.最多疤}）` },
    { 项: '张力', 过: 数.张力 <= 规.最多张力, 说: `张力 ${圆(数.张力)}（要 ≤${规.最多张力}）` },
  ]
  const 原因 = 检查.filter((x) => x.过).map((x) => x.说)
  const 差 = []
  for (const x of 检查) {
    if (x.过) continue
    if (x.项 === '天数') 差.push(`还差 ${Math.max(0, 规.最少天数 - 数.天数)} 天（现在 ${数.天数} 天）`)
    else if (x.项 === '见过') 差.push(`还差 ${Math.max(0, 规.最少见过 - 数.见过)} 条消息（现在 ${数.见过} 条）`)
    else if (x.项 === '互动') 差.push(`她还没回够（现在 ${数.互动} 次，要 ${规.最少互动} 次）`)
    else if (x.项 === '熟') 差.push(`熟悉度还差 ${圆(Math.max(0, 规.最少熟 - 数.熟))}（现在 ${圆(数.熟)}）`)
    else if (x.项 === '信') 差.push(`信任分还差 ${圆(Math.max(0, 规.最少信 - 数.信))}（现在 ${圆(数.信)}）`)
    else if (x.项 === '疤') 差.push(`疤还高（现在 ${圆(数.疤)}，要 ≤${规.最多疤}）`)
    else if (x.项 === '张力') 差.push(`现在张力还高（${圆(数.张力)}，要 ≤${规.最多张力}）`)
  }
  const 过 = 差.length === 0
  return {
    ...基础,
    级别: 过 ? '受信' : '普通',
    能收藏: 过,
    自动: 过,
    原因,
    差,
    检查,
  }
}

function 圆(值) {
  return Math.round(Number(值) * 10) / 10
}

/**
 * 设置页的信任概况：规则、各档人数和当前受信的人。
 * @param {object[]} 人们 - 人物志里的人物。
 * @param {object} [规则] - 配置里的 `社交.信任`。
 * @param {string} [主人号] - 主人的 QQ 号。
 * @returns {object} 概况；`受信` 是 `{号, 名, 手动}` 列表。
 */
export function 信任概况(人们, 规则 = {}, 主人号 = '') {
  const 规 = 归一信任规则(规则)
  const 人 = Array.isArray(人们) ? 人们 : []
  const 受信 = []
  let 自动受信数 = 0
  let 手动加数 = 0
  for (const p of 人) {
    const 主人 = !!p.主人 || (主人号 !== '' && String(p.号) === String(主人号))
    const 信 = 评估信任(p, 规, { 主人, 号: p.号 })
    if (信.手动 === '加') 手动加数 += 1
    if (信.级别 === '受信' && 信.自动) 自动受信数 += 1
    if (信.能收藏 && 信.级别 === '受信') 受信.push({ 号: String(p.号), 名: String(p.名 || p.号), 手动: 信.手动 })
  }
  return {
    ...规,
    受信,
    受信数: 受信.length,
    自动受信数,
    手动加数,
    手动禁数: 规.手动禁.length,
  }
}
