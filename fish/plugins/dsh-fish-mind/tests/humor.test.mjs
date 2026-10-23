import test from 'node:test'
import assert from 'node:assert/strict'
import { humorPrompt, humorTone } from '../lib/humor.js'

test('轻松的话给具体动作，不给“要幽默”这种空话', () => {
  const text = humorPrompt({ text: '今天楼下的猫又蹲在门口' })
  assert.ok(text.includes('把话接歪一点'))
  assert.ok(text.includes('字面接歪'))
  assert.ok(text.includes('反高潮'))
  assert.ok(text.includes('回扣'))
  assert.ok(text.includes('一句就够'))
  assert.ok(text.includes('先接住人'))
  assert.ok(text.includes('不拿外貌'))
  assert.ok(text.includes('不拿主人的私事当笑料'))
})

test('对方自己先笑了，就允许轻轻接一句', () => {
  const text = humorPrompt({ text: '今天走了两万步，笑死' })
  assert.ok(text.includes('对方这句是松的'))
  assert.equal(humorTone('今天走了两万步，笑死'), 'playful')
})

test('难过、生病、求助和正经事面前整段留空', () => {
  for (const line of [
    '我奶奶住院了',
    '今天好累',
    '我有点难过',
    '救命',
    '我不想活了',
    '帮我写个排序函数',
    '这个报错怎么修',
    '我今天被老板骂了',
    '明天还要考试',
  ]) {
    assert.equal(humorPrompt({ text: line }), '', line)
  }
})

test('自伤和重病的话题不因为一个笑脸就放开', () => {
  assert.equal(humorPrompt({ text: '我不想活了哈哈哈' }), '')
  assert.equal(humorPrompt({ text: '奶奶住院了😂' }), '')
})

test('口是心非的“想死你了”不算危机', () => {
  assert.equal(humorTone('想死你了'), 'neutral')
  assert.ok(humorPrompt({ text: '想死你了' }).includes('把话接歪一点'))
})

test('压力里对方还在笑，可以接自我增强型的玩笑', () => {
  const text = humorPrompt({ text: '加班到十点，哈哈哈' })
  assert.ok(text.includes('对方这句是松的'))
})

test('群聊只跟着屋里的气氛，没人开玩笑就不教她开玩笑', () => {
  assert.equal(humorPrompt({ text: '今天吃什么', social: true }), '')
  const text = humorPrompt({ text: '这也太离谱了吧哈哈哈', social: true })
  assert.ok(text.includes('先跟着屋里的气氛'))
  assert.ok(text.includes('不要：拿在场的人开涮'))
  assert.ok(text.includes('不透露主人私下的事'))
  assert.ok(!text.includes('反高潮'), '社交版不堆主人会话的招式')
})

test('没有本轮消息就不注入', () => {
  assert.equal(humorPrompt({ text: '' }), '')
  assert.equal(humorPrompt({}), '')
})
