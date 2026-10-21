// 「哪些 B 站外发动作需要主人当场确认」的纯函数。
//
// 设置里本来就允许的自动评论 / 私信不弹审批；只有下面几种情况才需要人点头：
//   · force 绕过「自动评论关着」或「私信关着」的闸；
//   · 私信收件人不是设置里的 dmUid；
//   · 用 bili_config 改「谁能自动发」的设置（否则模型可以自己把闸打开）。
//
// 审批通道不可用时由 DSH 把 ask 变成拒绝，这里是失败关闭。

/** 改这些键等于改「谁能被自动发消息」，必须让主人确认。 */
export const OUTBOUND_CONFIG_KEYS = ['autoComment', 'dmMode', 'dmUid', 'mentionName', 'commentPerRound']

export function commentEnabled(cfg) {
  return Boolean(
    cfg
    && cfg.autoComment
    && cfg.mentionName
    && cfg.dmMode !== 'only'
    && Math.max(0, Number(cfg.commentPerRound || 0)) > 0,
  )
}

export function dmEnabled(cfg) {
  return Boolean(cfg && cfg.dmMode !== 'off' && Number(cfg.dmUid) > 0)
}

/**
 * 判断一次工具调用是否需要主人审批。
 * @param tool - 工具名。
 * @param args - 解析后的工具参数。
 * @param cfg - 当前设置。
 * @param state - 本轮状态；`commentUsed` 是本轮已经发掉的评论条数。
 * @returns null 表示不需要；否则给出审批类型和正文。
 */
export function approvalFor(tool, args, cfg, state = {}) {
  const 参数 = args && typeof args === 'object' && !Array.isArray(args) ? args : {}
  if (tool === 'bili_config') {
    const patch = 参数.patch && typeof 参数.patch === 'object' && !Array.isArray(参数.patch) ? 参数.patch : {}
    const keys = OUTBOUND_CONFIG_KEYS.filter((key) => key in patch)
    return keys.length ? { kind: 'config', keys, patch } : null
  }
  if (tool === 'bili_reply') {
    if (!参数.force) return null
    const quota = Math.max(0, Number((cfg && cfg.commentPerRound) || 0))
    const used = Math.max(0, Number(state.commentUsed) || 0)
    // 闸开着且额度没用完时 force 是多余的；用满额度后仍要发，就得让主人点头。
    if (commentEnabled(cfg) && used < quota) return null
    return { kind: 'comment', text: String(参数.text || '') }
  }
  if (tool === 'bili_send_message') {
    const uid = Number(参数.uid) || Number(cfg && cfg.dmUid) || 0
    if (!uid) return null // 没有收件人时工具自己会拒绝，没必要弹审批
    const 私信开着 = dmEnabled(cfg)
    const 换人 = 私信开着 && Number(参数.uid) > 0 && Number(参数.uid) !== Number(cfg && cfg.dmUid)
    // 工具用真值判断 force；这里也必须用真值，否则字符串 "true" 会绕过审批。
    const 强闯 = Boolean(参数.force) && !私信开着
    if (!换人 && !强闯) return null
    return { kind: 'dm', uid, text: String(参数.text || '') }
  }
  return null
}
