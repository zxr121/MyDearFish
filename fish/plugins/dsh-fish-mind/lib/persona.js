// 性格人设：整段替换部署层的 system-prompt.personaPrefix。
//
// 不存 identity.json，也不进鱼脑目录：它属于 profile 的配置层，由 configEditor
// 写入 profile 的 cordis.patch.yml 并热应用。工具写不了 profile 配置，
// 只有设置页的宿主路由能改；改完下一轮就按新的人设说话。

import { isDeepStrictEqual } from 'node:util'

const PERSONA_ENTRY_ID = 'system-prompt'

export const PERSONA_MAX_CHARS = 12000

function invalidError(message) {
  const error = new Error(message)
  error.statusCode = 400
  return error
}

/**
 * 校验设置页提交的整段人设。保留换行和段落，只清掉控制字符。
 * @param {unknown} raw - 请求正文里的 `persona`。
 * @returns {string} 可写入配置的文本。
 */
export function normalizePersonaInput(raw) {
  if (typeof raw !== 'string') throw invalidError('性格人设必须是文本')
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
  if (text === '') throw invalidError('性格人设不能为空')
  if (text.includes('{{')) throw invalidError('性格人设里不能出现 {{…}}：系统提示会把它当成变量')
  if (text.length > PERSONA_MAX_CHARS) throw invalidError(`性格人设最多 ${PERSONA_MAX_CHARS} 字`)
  return text
}

function unavailableError() {
  const error = new Error('这个宿主没有可编辑的配置层，性格人设只能在桌面版设置里改')
  error.statusCode = 501
  return error
}

/**
 * 通过 configEditor 读写当前 profile 的人设前缀。
 * @param {object} options
 * @param {() => unknown} options.getConfigEditor - 返回 configEditor 服务。
 * @param {(message: string) => void} [options.diag] - 诊断日志。
 * @returns {{ available: () => boolean, read: () => object, save: (raw: unknown) => Promise<object>, reset: () => Promise<object> }}
 */
export function createPersonaEditor({ getConfigEditor, diag = () => {} }) {
  function locate() {
    let editor
    try {
      editor = getConfigEditor()
    } catch (error) {
      diag(`persona: 取不到 configEditor（${String((error && error.message) || error)}）`)
      return null
    }
    if (!editor || typeof editor.configuration !== 'function' || typeof editor.edit !== 'function') return null
    let rows
    try {
      rows = editor.configuration()
    } catch (error) {
      diag(`persona: 读不了配置层（${String((error && error.message) || error)}）`)
      return null
    }
    const row = Array.isArray(rows)
      ? rows.find((item) => item && item.entry && item.entry.options && item.entry.options.id === PERSONA_ENTRY_ID)
      : null
    if (!row || !row.entry) return null
    return {
      editor,
      entry: row.entry,
      inherited: row.inherited && typeof row.inherited === 'object' ? row.inherited : {},
      override: row.override && typeof row.override === 'object' ? row.override : {},
    }
  }

  function read() {
    const found = locate()
    if (found === null) throw unavailableError()
    const inherited = typeof found.inherited.personaPrefix === 'string' ? found.inherited.personaPrefix : ''
    const effective = found.entry.options && found.entry.options.config
    const persona = effective && typeof effective.personaPrefix === 'string'
      ? effective.personaPrefix
      : inherited
    return {
      available: true,
      persona,
      inherited,
      overridden: Object.hasOwn(found.override, 'personaPrefix'),
      maxLength: PERSONA_MAX_CHARS,
    }
  }

  async function save(raw) {
    const text = normalizePersonaInput(raw)
    const found = locate()
    if (found === null) throw unavailableError()
    await found.editor.edit(found.entry, (current) => ({ ...current, personaPrefix: text }))
    diag(`persona: 主人改了性格人设（${text.length} 字）`)
    return read()
  }

  async function reset() {
    const found = locate()
    if (found === null) throw unavailableError()
    await found.editor.edit(found.entry, (current, inherited) => {
      const next = { ...current }
      Reflect.deleteProperty(next, 'personaPrefix')
      const restInherited = { ...inherited }
      Reflect.deleteProperty(restInherited, 'personaPrefix')
      // 其余字段都没改过时返回完整继承值，让 configEditor 连空的 config 条目一起删掉；
      // 有别的自定义字段就只删 personaPrefix，保留那些字段。
      return isDeepStrictEqual(next, restInherited) ? { ...inherited } : next
    })
    diag('persona: 已恢复出厂人设')
    return read()
  }

  return {
    available: () => locate() !== null,
    read,
    save,
    reset,
  }
}
