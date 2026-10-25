import test from 'node:test'
import assert from 'node:assert/strict'
import { PERSONA_MAX_CHARS, createPersonaEditor, normalizePersonaInput } from '../lib/persona.js'

function fakeConfigEditor({ inherited = '出厂人设：温和、好奇。', persona } = {}) {
  const entry = {
    options: {
      id: 'system-prompt',
      config: { personaPrefix: persona === undefined ? inherited : persona },
    },
  }
  let override = persona === undefined ? {} : { personaPrefix: persona }
  return {
    entry,
    configuration: () => [{ entry, inherited: { personaPrefix: inherited }, override }],
    async edit(target, change) {
      assert.equal(target, entry)
      const next = change({ ...entry.options.config }, { personaPrefix: inherited })
      entry.options.config = { ...next }
      override = Object.keys(next).length === 1 && next.personaPrefix === inherited ? {} : { ...next }
    },
  }
}

test('整段人设保留换行，清掉控制字符，拒绝空文本和提示变量', () => {
  assert.equal(
    normalizePersonaInput('  第一段\r\n第二段\t  \u0000  '),
    '第一段\n第二段',
  )
  assert.throws(() => normalizePersonaInput(''), /不能为空/)
  assert.throws(() => normalizePersonaInput('   \n  '), /不能为空/)
  assert.throws(() => normalizePersonaInput(42), /必须是文本/)
  assert.throws(() => normalizePersonaInput('你是 {{model}}'), /不能出现 \{\{/)
  assert.throws(() => normalizePersonaInput('x'.repeat(PERSONA_MAX_CHARS + 1)), /最多/)
  assert.equal(normalizePersonaInput('x'.repeat(PERSONA_MAX_CHARS)).length, PERSONA_MAX_CHARS)
})

test('没有人设覆盖时读出厂人设，保存后读回自定义文本', async () => {
  const editor = fakeConfigEditor()
  const persona = createPersonaEditor({ getConfigEditor: () => editor })
  const before = persona.read()
  assert.equal(before.available, true)
  assert.equal(before.persona, '出厂人设：温和、好奇。')
  assert.equal(before.overridden, false)
  assert.equal(before.maxLength, PERSONA_MAX_CHARS)

  const saved = await persona.save('你是小鲸。\n\n说话短一点。')
  assert.equal(saved.persona, '你是小鲸。\n\n说话短一点。')
  assert.equal(saved.overridden, true)
  assert.equal(editor.entry.options.config.personaPrefix, '你是小鲸。\n\n说话短一点。')

  const afterReset = await persona.reset()
  assert.equal(afterReset.persona, '出厂人设：温和、好奇。')
  assert.equal(afterReset.overridden, false)
  assert.deepEqual(editor.entry.options.config, { personaPrefix: '出厂人设：温和、好奇。' })
})

test('恢复出厂删掉人设覆盖，不清掉其他配置', async () => {
  const editor = fakeConfigEditor({ persona: '自定义人设' })
  editor.entry.options.config.includeHarnessIdentity = false
  const persona = createPersonaEditor({ getConfigEditor: () => editor })
  const reset = await persona.reset()
  assert.equal(reset.persona, '出厂人设：温和、好奇。')
  assert.equal(reset.overridden, false)
  assert.equal(editor.entry.options.config.includeHarnessIdentity, false)
  assert.equal(Object.hasOwn(editor.entry.options.config, 'personaPrefix'), false)
})

test('校验失败时不动配置；没有配置层时明确报不可用', async () => {
  const editor = fakeConfigEditor({ persona: '自定义人设' })
  let edits = 0
  const edit = editor.edit
  editor.edit = async (...args) => { edits += 1; return edit(...args) }
  const persona = createPersonaEditor({ getConfigEditor: () => editor })
  await assert.rejects(() => persona.save('你是 {{model}}'), /不能出现 \{\{/)
  assert.equal(edits, 0)
  assert.equal(editor.entry.options.config.personaPrefix, '自定义人设')

  const missing = createPersonaEditor({ getConfigEditor: () => undefined })
  assert.equal(missing.available(), false)
  assert.throws(() => missing.read(), (error) => error.statusCode === 501)
  await assert.rejects(() => missing.save('人设'), (error) => error.statusCode === 501)
  await assert.rejects(() => missing.reset(), (error) => error.statusCode === 501)
})

test('配置层里没有 system-prompt 时也按不可用处理', () => {
  const persona = createPersonaEditor({
    getConfigEditor: () => ({
      configuration: () => [],
      edit: async () => {},
    }),
  })
  assert.equal(persona.available(), false)
})
