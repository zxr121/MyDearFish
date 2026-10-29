import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildFishArchive, parseFishArchive } from '../lib/archive.js'
import { saveIdentity } from '../lib/birth.js'
import { buildDefaults } from '../lib/config.js'
import { openStore } from '../lib/store.js'
import { saveTendency } from '../lib/tendency.js'
import {
  applyImportedPersona,
  applyPortableConfigs,
  collectPortableConfigs,
  parsePortableConfigs,
} from '../lib/portable-configs.js'

const IDENTITY = {
  name: '小鲸',
  species: '虎鲸娘',
  appearance: '黑白配色，短发。',
  ownerAddress: '船长',
  ownerGender: '女',
  origin: '从一片海图里醒来。',
  style: '句子短一点。',
}

const SECRETS = {
  snowPassword: 'snow-pass-xyz',
  snowToken: 'snow-token-xyz',
  privateQq: '100010001',
  group: '200020002',
  qqTarget: 'sess-qq-target',
  watchSession: 'sess-watch-9',
  favoriteSession: 'sess-tts-7',
  favoriteWho: 'qq-777888',
  favoriteMessage: 'msg-555',
  biliSession: 'sess-bili-8',
  biliDmUid: 'dm-uid-123',
  pythonPath: 'D:\\secret-tool\\python.exe',
}

function writeSource({ persona = '' } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'fish-portable-src-'))
  const dir = join(home, 'fish-mind')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'config.json'), JSON.stringify({
    mode: 'live',
    inject: true,
    retentionDays: 30,
    maxTextChars: 4000,
    budget: { dailyGrantCny: 20 },
    developer: { enabled: true },
    permissions: { private: true },
  }))
  saveTendency(dir, '群里安静一点，勤保存表情包')
  writeFileSync(join(dir, 'identity.json'), JSON.stringify(IDENTITY))
  const identity = saveIdentity(dir, IDENTITY, 2000)
  const store = openStore({ dir, config: buildDefaults(home), diag: () => {} })

  mkdirSync(join(home, 'feiyu-mood'), { recursive: true })
  writeFileSync(join(home, 'feiyu-mood', 'config.json'), JSON.stringify({
    targetSession: 'sess-mood-local',
    selfName: '小鲸',
    judgeProvider: 'deepseek',
    judgeModel: 'flash',
    moodBase: 60,
    autoJudge: true,
  }))
  writeFileSync(join(home, 'qq-bridge-config.json'), JSON.stringify({
    总开关: true,
    试运行: false,
    目标会话: SECRETS.qqTarget,
    私聊QQ: SECRETS.privateQq,
    群号: SECRETS.group,
    NapCat: { 地址: '127.0.0.1:3002', 后台密码: SECRETS.snowPassword },
    SnowLuma: { 后台密码: SECRETS.snowPassword, 令牌: SECRETS.snowToken },
    戳一戳: true,
    导入: true,
    转私聊: true,
    转群: false,
    社交: {
      启用: true,
      试运行: false,
      主动每时: 6,
      主动每日: 40,
      判断阈值: 0.4,
      关注上限: 12,
      学表情: true,
      学说话: true,
      复读: false,
      模式: '自然',
      称呼: '船长',
      兴趣词: ['海', '鲸'],
      不聊话题: [' politics '],
      群: ['888'],
      好友: ['999'],
    },
  }))
  writeFileSync(join(home, 'speak-up-config.json'), JSON.stringify({
    总开关: true,
    试运行: true,
    目标会话: ['sess-speak-local'],
    间隔分钟: 45,
    安静起: 23,
    安静止: 7,
    触发文案: '在吗',
    角色: '小鲸',
  }))
  writeFileSync(join(home, 'tts-bridge.json'), JSON.stringify({
    panel: false,
    everSeen: true,
    folders: [{ id: 'f1', name: '常用', secret: 'x' }],
    favorites: [
      { text: '早上好', folder: 'f1', messageId: SECRETS.favoriteMessage, sessionId: SECRETS.favoriteSession, who: SECRETS.favoriteWho },
      { text: '', folder: 'f1' },
    ],
    watch: [{ sessionId: SECRETS.watchSession }],
  }))
  mkdirSync(join(home, 'bili-duty'), { recursive: true })
  writeFileSync(join(home, 'bili-duty', 'config.json'), JSON.stringify({
    pythonPath: SECRETS.pythonPath,
    targetSession: SECRETS.biliSession,
    dmUid: SECRETS.biliDmUid,
    autoComment: true,
    autoReply: true,
    dmMode: 'on',
    perDay: 3,
    gapHours: 6,
    keywords: ['鱼'],
    ownerName: '小鱿鱼',
    scanPrompt: '扫描提示',
  }))
  return { home, dir, store, identity, persona }
}

test('导出只带走白名单字段：秘密值一个都不进包', () => {
  const source = writeSource()
  const buffer = buildFishArchive({
    dir: source.dir,
    dshHome: source.home,
    store: source.store,
    identity: source.identity,
    pluginVersion: '0.7.4',
    now: 1760000000000,
  }).buffer
  const parsed = parseFishArchive(buffer)
  assert.equal(parsed.manifest.version, 1)
  assert.equal(parsed.configs !== null, true)
  assert.equal(parsed.manifest.counts.configs, 7)
  const names = Object.keys(parsed.configs.files).sort()
  assert.deepEqual(names, [
    'bili-duty/config.json',
    'feiyu-mood/config.json',
    'fish-mind/config.json',
    'fish-mind/tendency.json',
    'qq-bridge-config.json',
    'speak-up-config.json',
    'tts-bridge.json',
  ])

  const qq = JSON.parse(parsed.configs.files['qq-bridge-config.json'])
  assert.equal(qq['转私聊'], true)
  assert.equal(qq['转群'], false)
  assert.equal(qq['社交']['主动每时'], 6)
  assert.equal(qq['社交']['判断阈值'], 0.4)
  assert.equal(Object.hasOwn(qq, '目标会话'), false)
  assert.equal(Object.hasOwn(qq, '私聊QQ'), false)
  assert.equal(Object.hasOwn(qq, '群号'), false)
  assert.equal(Object.hasOwn(qq, 'NapCat'), false)
  assert.equal(Object.hasOwn(qq, 'SnowLuma'), false)
  assert.equal(Object.hasOwn(qq, '总开关'), false)
  assert.equal(Object.hasOwn(qq['社交'], '群'), false)
  assert.equal(Object.hasOwn(qq['社交'], '启用'), false)

  const fish = JSON.parse(parsed.configs.files['fish-mind/config.json'])
  assert.equal(fish.mode, 'live')
  assert.equal(Object.hasOwn(fish, 'budget'), false)
  assert.equal(Object.hasOwn(fish, 'developer'), false)
  assert.equal(Object.hasOwn(fish, 'permissions'), false)

  const mood = JSON.parse(parsed.configs.files['feiyu-mood/config.json'])
  assert.equal(mood.judgeProvider, 'deepseek')
  assert.equal(Object.hasOwn(mood, 'targetSession'), false)
  assert.equal(Object.hasOwn(mood, 'selfName'), false)

  const speak = JSON.parse(parsed.configs.files['speak-up-config.json'])
  assert.equal(speak['间隔分钟'], 45)
  assert.equal(Object.hasOwn(speak, '目标会话'), false)
  assert.equal(Object.hasOwn(speak, '总开关'), false)

  const tts = JSON.parse(parsed.configs.files['tts-bridge.json'])
  assert.equal(tts.panel, false)
  assert.deepEqual(tts.folders, [{ id: 'f1', name: '常用' }])
  assert.deepEqual(tts.favorites, [{ text: '早上好', folder: 'f1' }])
  assert.equal(Object.hasOwn(tts, 'watch'), false)

  const bili = JSON.parse(parsed.configs.files['bili-duty/config.json'])
  assert.equal(bili.perDay, 3)
  assert.equal(Object.hasOwn(bili, 'pythonPath'), false)
  assert.equal(Object.hasOwn(bili, 'targetSession'), false)
  assert.equal(Object.hasOwn(bili, 'dmUid'), false)
  assert.equal(Object.hasOwn(bili, 'autoComment'), false)
  assert.equal(Object.hasOwn(bili, 'autoReply'), false)
  assert.equal(Object.hasOwn(bili, 'dmMode'), false)

  const tendency = JSON.parse(parsed.configs.files['fish-mind/tendency.json'])
  assert.equal(tendency.text, '群里安静一点，勤保存表情包')
  assert.equal(Object.hasOwn(parsed.configs.files, 'persona.txt'), false, '没自定义人设就不带人设')

  const carried = JSON.stringify(parsed.manifest.configs)
  for (const [name, value] of Object.entries(SECRETS)) {
    assert.equal(carried.includes(value), false, `${name} 不应该出现在包里`)
  }
  // 字段名可以留在 redacted 里，方便主人知道哪些没带。
  assert.ok(parsed.manifest.configs.files['qq-bridge-config.json'].redacted.includes('私聊QQ'))
  assert.ok(parsed.manifest.configs.files['qq-bridge-config.json'].redacted.includes('SnowLuma'))

  source.store.close()
})

test('导入恢复偏好、保留本地秘密、强制关掉对外通道', () => {
  const source = writeSource()
  const buffer = buildFishArchive({
    dir: source.dir,
    dshHome: source.home,
    store: source.store,
    identity: source.identity,
    pluginVersion: '0.7.4',
  }).buffer
  const parsed = parseFishArchive(buffer)

  const target = mkdtempSync(join(tmpdir(), 'fish-portable-dst-'))
  const targetMind = join(target, 'fish-mind')
  mkdirSync(targetMind, { recursive: true })
  writeFileSync(join(targetMind, 'config.json'), JSON.stringify({
    mode: 'dry',
    budget: { dailyGrantCny: 5 },
    developer: { enabled: false },
  }))
  mkdirSync(join(target, 'feiyu-mood'), { recursive: true })
  writeFileSync(join(target, 'feiyu-mood', 'config.json'), JSON.stringify({
    targetSession: 'local-mood-session',
    selfName: '本地小鱼',
    judgeProvider: 'local-provider',
  }))
  writeFileSync(join(target, 'qq-bridge-config.json'), JSON.stringify({
    总开关: true,
    试运行: false,
    目标会话: 'local-qq-session',
    私聊QQ: 'local-qq',
    群号: 'local-group',
    NapCat: { 后台密码: 'local-napcat-pass' },
    SnowLuma: { 令牌: 'local-snow-token' },
    社交: { 启用: true, 试运行: false, 学表情: true, 主动每时: 99, 群: ['local-group-id'], 人的态度: { 'qq-1': '熟人' } },
  }))
  writeFileSync(join(target, 'speak-up-config.json'), JSON.stringify({
    总开关: true,
    试运行: false,
    目标会话: ['local-speak-session'],
    间隔分钟: 5,
  }))
  writeFileSync(join(target, 'tts-bridge.json'), JSON.stringify({
    panel: true,
    everSeen: false,
    folders: [],
    favorites: [],
    watch: [{ sessionId: 'local-watch' }],
  }))
  mkdirSync(join(target, 'bili-duty'), { recursive: true })
  writeFileSync(join(target, 'bili-duty', 'config.json'), JSON.stringify({
    pythonPath: 'C:\\local\\python.exe',
    targetSession: 'local-bili-session',
    dmUid: 'local-dm',
    autoComment: true,
    autoReply: true,
    dmMode: 'on',
    perDay: 9,
  }))

  const result = applyPortableConfigs({ dshHome: target, dir: targetMind, configs: parsed.configs })
  assert.equal(result.skipped, 0)
  assert.equal(result.applied, 7)
  assert.deepEqual(result.warnings, [])
  assert.equal(result.persona, '')

  const qq = JSON.parse(readFileSync(join(target, 'qq-bridge-config.json'), 'utf8'))
  assert.equal(qq['总开关'], false, '导入先关掉 QQ')
  assert.equal(qq['试运行'], true)
  assert.equal(qq['社交']['启用'], false)
  assert.equal(qq['社交']['试运行'], true)
  assert.equal(qq['社交']['主动每时'], 6, '偏好从包里恢复')
  assert.equal(qq['社交']['判断阈值'], 0.4)
  assert.equal(qq['转私聊'], true)
  assert.equal(qq['转群'], false)
  assert.equal(qq['目标会话'], 'local-qq-session', '本地会话绑定原样保留')
  assert.equal(qq['私聊QQ'], 'local-qq')
  assert.equal(qq['群号'], 'local-group')
  assert.equal(qq['NapCat']['后台密码'], 'local-napcat-pass')
  assert.equal(qq['SnowLuma']['令牌'], 'local-snow-token')
  assert.deepEqual(qq['社交']['群'], ['local-group-id'], '本地群设置不被覆盖')
  assert.deepEqual(qq['社交']['人的态度'], { 'qq-1': '熟人' })

  const fish = JSON.parse(readFileSync(join(targetMind, 'config.json'), 'utf8'))
  assert.equal(fish.mode, 'live')
  assert.equal(fish.budget.dailyGrantCny, 5, '零花钱账本不跟着包走')
  assert.equal(fish.developer.enabled, false)
  assert.equal(JSON.parse(readFileSync(join(targetMind, 'tendency.json'), 'utf8')).text, '群里安静一点，勤保存表情包')

  const mood = JSON.parse(readFileSync(join(target, 'feiyu-mood', 'config.json'), 'utf8'))
  assert.equal(mood.judgeProvider, 'deepseek')
  assert.equal(mood.targetSession, 'local-mood-session')
  assert.equal(mood.selfName, '本地小鱼', '称呼以出生设定为准，不覆盖')

  const speak = JSON.parse(readFileSync(join(target, 'speak-up-config.json'), 'utf8'))
  assert.equal(speak['间隔分钟'], 45)
  assert.equal(speak['总开关'], false)
  assert.equal(speak['试运行'], true)
  assert.deepEqual(speak['目标会话'], ['local-speak-session'])

  const tts = JSON.parse(readFileSync(join(target, 'tts-bridge.json'), 'utf8'))
  assert.equal(tts.panel, false)
  assert.deepEqual(tts.favorites, [{ text: '早上好', folder: 'f1' }])
  assert.deepEqual(tts.watch, [{ sessionId: 'local-watch' }])

  const bili = JSON.parse(readFileSync(join(target, 'bili-duty', 'config.json'), 'utf8'))
  assert.equal(bili.perDay, 3)
  assert.equal(bili.autoComment, false)
  assert.equal(bili.autoReply, false)
  assert.equal(bili.dmMode, 'off')
  assert.equal(bili.pythonPath, 'C:\\local\\python.exe')
  assert.equal(bili.targetSession, 'local-bili-session')
  assert.equal(bili.dmUid, 'local-dm')

  source.store.close()
})

test('坏一份只跳过并警告，未知版本和陌生文件名不阻断', () => {
  const raw = {
    format: 'mydearfish.fish-configs',
    version: 1,
    files: {
      'fish-mind/config.json': { text: JSON.stringify({ mode: 'live' }), sha256: '' },
      'qq-bridge-config.json': { text: '{坏掉的' },
      'bili-duty/config.json': { text: JSON.stringify({ perDay: 2 }) },
      'speak-up-config.json': { text: JSON.stringify({ 无关: 1 }) },
      'tts-bridge.json': { text: JSON.stringify({ panel: false }), sha256: 'deadbeef' },
      'unknown/config.json': { text: '{}' },
      '../escape.json': { text: '{}' },
    },
  }
  const warnings = []
  const parsed = parsePortableConfigs(raw, warnings)
  assert.ok(parsed !== null)
  assert.deepEqual(Object.keys(parsed.files).sort(), [
    'bili-duty/config.json',
    'fish-mind/config.json',
    'qq-bridge-config.json',
    'speak-up-config.json',
  ])
  assert.ok(warnings.some((item) => item.includes('unknown/config.json')))
  assert.ok(warnings.some((item) => item.includes('../escape.json')))
  assert.ok(warnings.some((item) => item.includes('tts-bridge.json') && item.includes('校验失败')))

  const target = mkdtempSync(join(tmpdir(), 'fish-portable-bad-'))
  const targetMind = join(target, 'fish-mind')
  const result = applyPortableConfigs({ dshHome: target, dir: targetMind, configs: parsed })
  assert.equal(result.applied, 3)
  assert.equal(result.skipped, 1)
  assert.ok(result.warnings.some((item) => item.includes('qq-bridge-config.json')))
  assert.equal(JSON.parse(readFileSync(join(target, 'bili-duty', 'config.json'), 'utf8')).perDay, 2)
  assert.equal(JSON.parse(readFileSync(join(targetMind, 'config.json'), 'utf8')).mode, 'live')
  assert.equal(existsSync(join(target, 'qq-bridge-config.json')), false)
  assert.equal(JSON.parse(readFileSync(join(target, 'speak-up-config.json'), 'utf8'))['总开关'], false, '没有可恢复字段也先关掉对外通道')

  const future = []
  assert.equal(parsePortableConfigs({ format: 'mydearfish.fish-configs', version: 9, files: {} }, future), null)
  assert.ok(future.some((item) => item.includes('版本 9')))
  const foreign = []
  assert.equal(parsePortableConfigs({ format: 'other.tool', version: 1, files: {} }, foreign), null)
  assert.ok(foreign.some((item) => item.includes('不是大肥鱼的格式')))
  assert.equal(parsePortableConfigs(undefined, []), null)
})

test('人设只在自定义时打包，导入后交给配置层保存', async () => {
  const source = writeSource()
  const withoutPersona = collectPortableConfigs({ dshHome: source.home, personaText: '' })
  assert.equal(Object.hasOwn(withoutPersona.files, 'persona.txt'), false)
  assert.equal(collectPortableConfigs({ dshHome: source.home, personaText: '   ' }).files['persona.txt'], undefined)

  const withPersona = collectPortableConfigs({ dshHome: source.home, personaText: '你会用颜文字。' })
  assert.ok(withPersona.files['persona.txt'])
  assert.equal(withPersona.files['persona.txt'].text, '你会用颜文字。')

  const target = mkdtempSync(join(tmpdir(), 'fish-portable-persona-'))
  const targetMind = join(target, 'fish-mind')
  const compiled = parsePortableConfigs(withPersona, [])
  const applied = applyPortableConfigs({ dshHome: target, dir: targetMind, configs: compiled })
  assert.equal(applied.persona, '你会用颜文字。')
  assert.equal(readFileSync(join(targetMind, 'persona-import.txt'), 'utf8'), '你会用颜文字。')

  const saved = []
  const text = await applyImportedPersona({
    dir: targetMind,
    personaEditor: { save: async (value) => { saved.push(value) } },
    diag: () => {},
  })
  assert.equal(text, '你会用颜文字。')
  assert.deepEqual(saved, ['你会用颜文字。'])
  assert.equal(existsSync(join(targetMind, 'persona-import.txt')), false)
  assert.equal(existsSync(join(targetMind, 'persona-import.txt.done')), true)

  const none = await applyImportedPersona({
    dir: targetMind,
    personaEditor: { save: async () => { throw new Error('不该调用') } },
  })
  assert.equal(none, '')

  source.store.close()
})
