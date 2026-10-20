/**
 * dsh-bili-scroll —— host 半端
 * ============================================================================
 * 它是什么：每天替你刷一轮 B站 的插件版。
 *   1. **插件内部起那份 Python MCP**（`vendor/bilibili-mcp/mcp_server.py`），把它的能力
 *      注册成 dsh 工具（搜 / 字幕 / 评论 / 发评论 @ 人 / 登录检查）—— 用户不用再手改 profile。
 *   2. **谷时定时器**：中午 12:00–14:00、夜间 00:30–08:30（`lib/state.mjs` 里的 `WINDOWS`），
 *      开了哪个窗口才在哪个窗口自动跑；「定量刷」的数字是**每天总量上限**。
 *   3. **跑一轮** = 起一个 `dsh --profile headless <prompt>`（跟老方案同一条路，已被验证过），
 *      把 `duty.md` 交给它，报告写进 `<家>/out/<日期>.md`。
 *   4. **设置页**（`client.js`）通过 `/api/bili-duty/*` 读写配置、看状态、扫码登录。
 *
 * 家里（`$DSH_HOME/bili-duty/`）都有什么：`config.json` / `mcp_server.py`（从 vendor 铺过来，
 * 这样凭证 `bili_credential.json` 落在家里而不是插件包里）/ `duty.md` / `out/` / `duty.log`。
 * ============================================================================
 */
import { loadHostDeps } from './lib/hostdeps.mjs'

// ⭐ 这两样从**宿主那棵树**里取（拿不到就退到自己的依赖；再拿不到，defineTool 用本地等价实现）。
//    起因（2026-10-16 用户递来的完整报告 + 本机复现）：它们是 optional peer，
//    桌面版 profile 是 `autoInstallPeers: false` ⇒ 永远不装 ⇒ **裸 import 会让整条插件不激活** ✗。
const hostDeps = await loadHostDeps()
const z = hostDeps.z
const defineTool = hostDeps.defineTool
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { McpClient } from './lib/mcp.mjs'
import { verifyRecent, appendVerifyToReport } from './lib/verify.mjs'
import { WINDOWS, stateDirOf, readJson, writeJson, ensureHomeFiles, inWindow, dayKey } from './lib/state.mjs'
import { loginStart, loginPoll, saveCredential, renderQrPng } from './lib/login.mjs'
import { ensureUv } from './lib/uvfetch.mjs'

export const name = 'bili-scroll'
export const inject = ['webServer', 'tools', 'settings', 'subagents', 'agents', 'llm']

/**
 * 🔴 每个字段都要 `.extra('volatile', true)`：DSH 的 settings.update() 只认 volatile 字段
 *    （`volatileForm(schema)`，见 dsh-settings），没有这个标记写设置时会抛
 *    "Plugin entry … has no volatile fields"。另外两个条件是：
 *    **loader entry 的 id 必须等于命名空间名**（我们 patch 里就是 `bili-scroll`）+ **本模块导出 Config**。
 */
// ⚠️ schemastery 彻底拿不到时，这里会是 undefined —— **插件照常加载**，只是设置页降级
//    （宁可少一个设置页，也不能因为一个 import 让整条插件不激活 ✗）

// ⭐ 可配置的提示词模板（设置页能改；占位符：{owner}=主人称呼、{direction}=方向、{n}=条数）
const SCAN_PROMPT_TMPL = '你去 B 站帮我转一圈，看看有什么值得看的。\n\n这次想看的：{direction}\n\n别急着下结论，按这个来：\n先搜一搜（近 7 天，按播放或最新都行），标题看着没意思的就跳过；\n有点意思的，再看看简介，判断值不值得点进去；\n觉得值得，就把它的字幕读一遍，弄清楚到底讲了什么——没字幕的就跳过；\n顺手翻翻评论区，看看大家真实怎么说。\n\n最后挑出最值得的，最多 {n} 条。每条都跟我说清楚：标题、BV号、讲了什么、为什么值得、评论区反响怎么样。\n\n⚠️ 每条第一行单独写「### BV号」，方便我统计。\n写完把报告交给我就行，不用替我发评论、也不用发私信——那些我自己来。'

export const Config = !z ? undefined : z.object({
  /** 定量刷：每天最多挑几条 */
  perDay: z.natural().default(5).extra('volatile', true),
  /** ⭐ 两轮自动刷之间至少隔几小时（谷时窗口里按这个节奏轮转，直到额度用完） */
  gapHours: z.natural().default(3).extra('volatile', true),
  /** 峰谷自动刷（总开关） */
  peakValley: z.boolean().default(false).extra('volatile', true),
  /** 峰谷子开关：中午 / 晚上 */
  noon: z.boolean().default(true).extra('volatile', true),
  night: z.boolean().default(true).extra('volatile', true),
  /** 自动评论 @ 使用者（默认关 —— 会拿用户的号说话，必须他自己开） */
  autoComment: z.boolean().default(false).extra('volatile', true),
  /** ⭐ 私信投递：off=只发评论（现状）· only=只私信（完全不公开评论）· both=评论 + 私信 */
  dmMode: z.string().default('off').extra('volatile', true),
  /** ⭐ 私信发给谁的 UID（数字）。要在 dmMode 不是 off 时填 */
  dmUid: z.natural().default(0).extra('volatile', true),
  /** ⭐ 每轮最多发几条评论（每条里 @ 一次下面那个人）；**有效范围 0–20，口径见 clampPatch**（0 = 不发评论）
   *  ⚠️ 这里故意**不加 `.max(20)`**：schema 校验不过 ⇒ cordis 拒收这条 entry ⇒ **整条插件不激活** ✗
   *     （跟 schemastery 拿不到时的降级同一个道理）—— 范围一律由 clampPatch 在**写**和**读**两头钳。 */
  commentPerRound: z.natural().default(1).extra('volatile', true),
  /** ⭐ 要 @ 谁（B站 昵称）；**留空 = 不发评论** —— 评论存在的意义就是 @ 那一下 */
  mentionName: z.string().default('').extra('volatile', true),
  /** 关注关键词（空了用章程里默认那几组） */
  keywords: z.array(z.string()).default([]).extra('volatile', true),
  /** Python：指向 venv 里的那个最好 */
  pythonPath: z.string().default('python').extra('volatile', true),
  /** 日报形态：full=完整（现状）· brief=每条一两行 · off=不写报告（只发评论） */
  reportLevel: z.string().default('full').extra('volatile', true),
  /** ⭐ 派子代理刷 B 站用的 provider（默认用主人自己 API 里的，避用官方 key） */
  subProvider: z.string().default('apii').extra('volatile', true),
  /** ⭐ 派子代理刷 B 站用的模型 */
  subModel: z.string().default('deepseek-v4-pro').extra('volatile', true),
  /** 每次（每轮）最多挑几条（一次挑一条更清爽，默认 1） */
  perScan: z.natural().default(1).extra('volatile', true),
  /** ⭐ 自动刷在哪个会话触发（留空 = 自动挑最近聊过的那个会话） */
  targetSession: z.string().default('').extra('volatile', true),
  /** ⭐ 主人的称呼（提示词里所有「小鱿鱼」都跟这个走） */
  ownerName: z.string().default('小鱿鱼').extra('volatile', true),
  /** ⭐ 子代理的人设+流程提示词（占位符 {owner}/{direction}/{n}） */
  scanPrompt: z.string().default(SCAN_PROMPT_TMPL).extra('volatile', true),
  /** ⭐ 门槛：播放量低于这个数的直接不返回给子代理（0 = 不过滤） */
  minViews: z.natural().default(0).extra('volatile', true),
  /** ⭐ 门槛：发布不足这么多天的直接不返回给子代理（0 = 不过滤） */
  minAgeDays: z.natural().default(0).extra('volatile', true),
})

/**
 * ⭐ 给所有 Python 子进程统一 UTF-8。
 * 起因（2026-10-16，用户在评论区反馈）：Windows 上 Python 默认按 GBK 编解码，
 * 我们的脚本 / 内置 MCP 都会往管道里打中文与 emoji（`✅`、`—` 之类），一进管道就可能
 * 报 UnicodeDecodeError / 乱码或直接中断。**编码这种环境差异，插件该自己钉死，不该让用户碰。**
 */
const pyEnv = (extra = {}) => ({
  ...process.env,
  PYTHONUTF8: '1',
  PYTHONIOENCODING: 'utf-8',
  ...extra,
})

export function apply(ctx, config) {
  const pluginDir = dirname(fileURLToPath(import.meta.url))
  // ⭐ 自己的版本号（从 package.json 读，设置页要显示它）
  let myVer = ''
  const myVersion = () => {
    if (myVer) return myVer
    try { myVer = String(JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8')).version || '') } catch { myVer = '' }
    return myVer
  }
  const stateDir = stateDirOf(ctx)

  // ⭐ "就绪"必须检查依赖真的装上了，不能只看目录存不存在
  //    （2026-10-15：只看目录，害一位真实用户"显示就绪但其实装失败"白折腾 ✗）
  const sitePkgs = (venvRoot) => {
    const win = join(venvRoot, 'Lib', 'site-packages')
    if (existsSync(win)) return win
    try {
      const lib = join(venvRoot, 'lib')
      for (const d of readdirSync(lib)) {
        if (!d.startsWith('python')) continue
        const p = join(lib, d, 'site-packages')
        if (existsSync(p)) return p
      }
    } catch { /* 没有就算了 */ }
    return win
  }
  const hasPkg = (venvRoot, prefix) => {
    try { return readdirSync(sitePkgs(venvRoot)).some((n) => n.startsWith(prefix)) } catch { return false }
  }
  const venvReadyNow = () => existsSync(venvPython()) && hasPkg(join(stateDir, '.venv'), 'bilibili_api')
  const cfgFile = join(stateDir, 'config.json')
  const logFile = join(stateDir, 'duty.log')
  const outDir = join(stateDir, 'out')
  mkdirSync(outDir, { recursive: true })

  const log = (msg) => {
    const line = `${new Date().toISOString()}  ${msg}`
    try { appendFileSync(logFile, line + '\n', 'utf8') } catch { /* 日志写不进去也不致命 */ }
    try { ctx.logger?.info?.(`[bili-duty] ${msg}`) } catch { /* 没有 logger 就算了 */ }
  }

  // 宿主依赖是从哪儿取的（桌面版那次事故的排查看这里：duty.log 里会写明白）
  for (const n of hostDeps.notes) log(n)

  /**
   * ⚠️ 2026-10-14 事故（第一次挂上就炸了整个 DSH，见当天的 lesson）：
   *   `apply(ctx, config)` 传进来的那个 `config`，字段值**不保证是标量** —— 我们的 `config.pythonPath`
   *   是个**对象**、`config.keywords` 也不是数组（日志里打成 `[object Object]`）。对象是"真值"，
   *   于是 `if (!cfg.peakValley) return` 这类守卫全部失效，一路走到 `cfg.keywords.filter(...)`
   *   抛 TypeError —— 而那是在**定时器回调**里，没人接 ⇒ **整个 dsh 进程被带走** ✗✗。
   *   ⇒ 两条规矩：
   *     ① 逐字段按默认值的类型挑一遍（拿不准就用默认值），再叠自己的 `config.json`；
   *     ② **定时器回调里绝不让异常外冒**（见 tick）—— 未捕获异常会杀掉整个宿主进程。
   */
  const DEFAULTS = {
    perDay: 5, gapHours: 3, peakValley: false, noon: true, night: true, autoComment: false,
    dmMode: 'off', dmUid: 0,
    keywords: [], commentPerRound: 1, mentionName: '', pythonPath: 'python', reportLevel: 'full',
    subProvider: 'apii', subModel: 'deepseek-v4-pro',
    perScan: 1,
    targetSession: '',
    ownerName: '小鱿鱼',
    scanPrompt: SCAN_PROMPT_TMPL,
    minViews: 0,      // 播放量低于这个数的不给子代理看（0 = 不过滤）
    minAgeDays: 0,    // 发布不足这么多天的不给子代理看（0 = 不过滤）
  }
  const normalize = (src, base) => {
    const out = { ...base }
    for (const k of Object.keys(base)) {
      const v = src?.[k]
      if (v === undefined || v === null) continue
      if (Array.isArray(base[k])) { if (Array.isArray(v)) out[k] = v.filter((x) => typeof x === 'string') }
      else if (typeof base[k] === 'number') { const n = Number(v); if (Number.isFinite(n)) out[k] = n }
      else if (typeof base[k] === 'boolean') { if (typeof v === 'boolean') out[k] = v }
      else if (typeof base[k] === 'string') { if (typeof v === 'string') out[k] = v }
    }
    return out
  }
  /* ── 配置从哪来：DSH 自带的「插件设置」页 > 插件自己的 config.json > 默认值 ──
   * 老代码是 `normalize(readJson(cfgFile, {}), normalize(config, DEFAULTS))` —— config.json 一刀切盖住宿主，
   * 后果：用户在 DSH 自带的插件设置页里改了值，插件照旧读 config.json 的旧值 ⇒ **静默不生效** ✗。
   * 判据用 describe() 给的 `user` 层（= 用户在原生设置页**显式设过**的键）：
   *   设过的键 ⇒ 听宿主的；没设过 ⇒ 还是 config.json 说了算（老用户零回归 ✓）。
   * 拿不到设置服务就完全退回老行为。
   */
  /* ⭐ 「设置里能写什么范围」收在一处 —— HTTP 接口、bili_config 工具、**读配置**三处都走它，
   *    所以 perDay 0–50 / commentPerRound 0–20 这些数字**只有这一份**（schema 里不再写一遍）。
   *    （2026-10-16 审查修：原来只有 HTTP 路径钳制，工具路径连 perDay 都能写任意值；
   *      commentPerRound 两条路径都没钳，直接 POST 能写 9999）
   *    （2026-10-17 复查补：DSH 原生设置页那条路我们钳不到**写** —— 用户能在那儿直接填 9999 ⇒
   *      loadCfg 读回来也过一遍，写进去和读出来一个口径） */
  const clampPatch = (patch) => {
    const p = { ...patch }
    if ('perDay' in p) p.perDay = Math.max(0, Math.min(Number(p.perDay) || 0, 50))
    if ('gapHours' in p) p.gapHours = Math.max(1, Math.min(Number(p.gapHours) || 3, 12))
    if ('reportLevel' in p) p.reportLevel = ['full', 'brief', 'off'].includes(String(p.reportLevel)) ? String(p.reportLevel) : 'full'
    if ('commentPerRound' in p) p.commentPerRound = Math.max(0, Math.min(Number(p.commentPerRound) || 0, 20))
    if ('minViews' in p) p.minViews = Math.max(0, Math.min(Number(p.minViews) || 0, 100000000))
    if ('minAgeDays' in p) p.minAgeDays = Math.max(0, Math.min(Number(p.minAgeDays) || 0, 365))
    return p
  }

  const hostCfg = () => normalize(config, { ...DEFAULTS })       // 宿主那份（schema 校验过、默认值已填）
  const savedCfg = () => normalize(readJson(cfgFile, {}), { ...DEFAULTS })
  const CFG_SIG = ['perDay', 'mentionName', 'dmMode', 'autoComment']   // 靠这几个键认出"哪一行是我们"
  let settingsRow = { at: 0, row: null }
  /**
   * 我们那一行设置表单（拿不到就返回 null ⇒ 一切按 config.json 来）。
   * ⚠️ DSH 自带的「插件设置」页**不需要注册** —— 老代码那句 `ctx.settings.register(...)` 是个不存在的方法，
   *    每次都抛 TypeError、被 catch 吞掉（2026-10-17 读宿主源码 @deepseek-ai/dsh-settings 才明白）：
   *    describe() 自己扫 profile 里**带 volatile 字段**的条目列出来（lib/index.js:413-452），
   *    命名空间 ns **等于 loader 条目的 id**（我们 cordis.patch.yml 里是 `bili-scroll`，不是老注释写的 bili-duty）。
   * 另外两条同样要紧（都是读宿主源码得来的，别再想当然）：
   *    ① `apply(ctx, config)` 收到的 config 就是 fiber.config 本体，volatile 字段一改宿主**就地**改它
   *       （cordis-plugin-loader/src/config/entry.ts：`this.fiber._config = …` + `_commitVolatile()`）⇒
   *       启动时快照的 cfg 永远看不到设置页的改动，用之前得 refreshCfg()。
   *    ② describe() 每行给三层：value（生效值）/ base（继承层）/ user（用户在设置页显式设过的那层）。
   */
  const settingsDesc = (fresh = false) => {
    const t = Date.now()
    if (!fresh && t - settingsRow.at < 3000) return settingsRow.row   // 挡 UI 轮询：describe() 要扫所有条目
    let row = null
    try {
      const rows = ctx.settings?.describe?.() || []
      row = rows.find((r) => r?.value && CFG_SIG.every((k) => k in r.value)) || null
    } catch (e) { log(`读 DSH 设置表单失败（不影响跑）：${e?.message ?? e}`) }
    settingsRow = { at: t, row }
    return row
  }
  const loadCfg = () => {
    const saved = savedCfg()
    const row = settingsDesc()
    // ⭐ 读回来统一过一遍范围：原生设置页那边我们是钳不到写的（见 clampPatch 的注释）
    if (!row) return clampPatch(saved)
    const user = row.user || {}
    // ⭐ 用 row.value（DSH 原生设置的「生效值」，标量可靠），别用 apply 的 config 参数（字段常是坏值/对象，一丢就回默认）
    const out = normalize(row.value, { ...DEFAULTS })
    for (const k of Object.keys(DEFAULTS)) if (user[k] === undefined) out[k] = saved[k]
    // ⭐ pythonPath 是插件自己管的；DSH 原生设置传来的常是坏值/默认值，config.json 也可能被重置
    //    → 取 config.json；还是默认坏值 'python'（或不存在）时，退回 stateDir 下 venv 的 python
    out.pythonPath = saved.pythonPath
    if (!out.pythonPath || out.pythonPath === 'python' || !existsSync(out.pythonPath)) {
      const venvPy = join(stateDir, '.venv', 'Scripts', 'python.exe')
      if (existsSync(venvPy)) out.pythonPath = venvPy
    }
    return clampPatch(out)
  }
  const cfg = loadCfg()
  // ⭐ 配置是"随时可能被设置页就地改掉"的东西 ⇒ 每个入口用之前重算一遍（cfg 这个对象要一直指向同一份）
  const refreshCfg = () => { Object.assign(cfg, loadCfg()) }
  const saveCfg = (patch) => { Object.assign(cfg, normalize(patch, cfg)); writeJson(cfgFile, cfg) }
  /**
   * ⭐ 同时写一份到宿主：不写的话会出现死结 —— 某个键一旦在原生设置页设过就由宿主说了算，
   *    插件页再改那个键就成了"改了没反应" ✗。写失败不算致命（config.json 那份还在），把话带回给用户。
   */
  const saveCfgHost = async (patch) => {
    const attempt = async (fresh) => {
      const row = settingsDesc(fresh)
      if (!row?.ns || typeof ctx.settings?.update !== 'function') {
        throw Object.assign(new Error('DSH 这边没有可写的设置表单（值只落在插件自己的 config.json 里）'), { noForm: true })
      }
      await ctx.settings.update(row.ns, patch, row.revision)
      return row.ns
    }
    try { return { ok: true, ns: await attempt(false) } }
    catch (e) {
      if (!e?.noForm) {   // revision 过期（刚有别人改过）⇒ 重取一次再写
        try { return { ok: true, ns: await attempt(true), retried: true } } catch (e2) { e = e2 }
      }
      log(`写 DSH 设置失败：${e?.message ?? e}`)
      return { ok: false, error: String(e?.message ?? e) }
    }
  }
  /**
   * ⭐ 落配置的**唯一入口**：插件自己那份 config.json + DSH 原生设置页那份，钳完范围一起写。
   *    （2026-10-17 复查修：`saveCfg` + `await saveCfgHost` 这对义务原来在三个调用点各抄一遍 ——
   *      漏掉任何一处，正好就是「设置页改了没反应」那个 bug 本身 ⇒ 收成一个函数。）
   */
  const persistCfg = async (patch) => {
    const clean = clampPatch(patch)
    saveCfg(clean)
    const host = await saveCfgHost(clean)
    return { clean, host }
  }

  ensureHomeFiles(pluginDir, stateDir, log)

  /* ─────────────── MCP（内部起那个 Python MCP） ─────────────── */

  let mcp = null
  let mcpKey = ''
  const mcpKeyNow = () => `${cfg.pythonPath}|${join(stateDir, 'mcp_server.py')}`

  const ensureMcp = async () => {
    if (mcp?.running && mcpKey === mcpKeyNow()) return mcp
    if (mcp) { mcp.stop(); mcp = null }
    const script = join(stateDir, 'mcp_server.py')
    if (!existsSync(script)) throw new Error(`家里没有 mcp_server.py（应有 ${script}）—— 装上插件后重启一次 dsh 会自动铺好`)
    mcpKey = mcpKeyNow()
    mcp = new McpClient({
      command: cfg.pythonPath || 'python',
      args: [script],
      cwd: stateDir,                     // 凭证落在家里 ✓
      // ⭐ 这个内置的 Python MCP 会往 stdout 打中文（ensure_ascii=False）；
      //    Windows 默认 GBK 的话，中文/emoji 一进管道就可能炸 ⇒ 钉死 UTF-8
      env: pyEnv(),
      log,
    })
    return mcp
  }

  const call = async (toolName, args, opts) => {
    const client = await ensureMcp()
    return client.call(toolName, args, opts)
  }

  const hasCredential = () => existsSync(join(stateDir, 'bili_credential.json'))

  /* ─────────────── 工具 ─────────────── */

  const textOutput = {
    schema: { type: 'object', properties: {}, additionalProperties: true },
    render: (_args, value) => [{
      type: 'text',
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    }],
  }

  /**
   * 工具返回值一律过一遍这里：**宿主只吃"无损 JSON"**，塞进去任何函数/循环引用/类实例都会报
   * `value is not lossless JSON`（2026-10-14 第一次挂上就撞了一次）。
   */
  const safe = (v) => {
    if (v === undefined || v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
    try { return JSON.parse(JSON.stringify(v)) } catch { return String(v) }
  }

  const tool = (spec) => ctx.tools.register(defineTool({
    ...spec,
    output: textOutput,
    async execute(args, exec) { return safe(await spec.execute(args, exec)) },
  }))

  // 派一个子代理去刷 B 站（spawn 后端 + 可选模型），返回 { ok, report|error }
  // ⭐ 子代理的会话与记录**不由本插件清理**：留着还能回看当时刷了什么，也避免误伤别的会话。
  // ⭐ 这一轮「该发但还没发」的评论：没发评论就不让发私信（模型老跳过评论，只能硬约束）
  let pendingComment = null

  const scanWith = async (parent, direction, exec) => {
    const dir = String(direction || '').trim()
      || (Array.isArray(cfg.keywords) ? cfg.keywords.filter(Boolean).join(' ') : '')
      || '最近有什么值得看的'
    if (!parent) return { ok: false, error: '没有可用的会话' }
    if (!ctx.subagents) return { ok: false, error: '这台 DSH 没有子代理能力（缺少 subagents 服务）' }

    // 手动刷不占「每天几条」的额度（那是自动刷的账）；每次最多挑这么几条
    const perRound = Math.max(1, Number(cfg.perScan || 1))

    const owner = String(cfg.ownerName || '小鱿鱼')
    const level = String(cfg.reportLevel || 'full')
    const levelLine = level === 'brief'
      ? '\n\n⚠️ 报告形态：**薄** —— 每条只写一两行（标题 + BV号 + 一句值不值得），不要展开细讲。'
      : (level === 'off'
        ? '\n\n⚠️ 报告形态：**不写详细报告** —— 直接给大肥鱼一段简短的口头总结（挑中哪几条、各自一句），不用逐条展开。'
        : '')
    const prompt = String(cfg.scanPrompt || SCAN_PROMPT_TMPL)
      .split('{owner}').join(owner)
      .split('{direction}').join(dir)
      .split('{n}').join(String(perRound)) + levelLine

    let run
    try {
      run = await ctx.subagents.startActivation({
        provider: 'spawn',
        label: '刷B站：' + dir.slice(0, 20),
        request: {
          prompt: [{ type: 'text', text: prompt }],
          parent,
          agentOptions: { provider: String(cfg.subProvider || 'apii'), model: String(cfg.subModel || 'deepseek-v4-pro') },
        },
        signal: exec?.signal || new AbortController().signal,
        delivery: 'caller',
      })
    } catch (e) {
      return { ok: false, error: '派子代理失败：' + (e?.message ?? e) }
    }
    let result
    try {
      result = await run.result
    } catch (e) {
      try { await run.dispose() } catch {}
      return { ok: false, error: '子代理跑失败：' + (e?.message ?? e) }
    }
    const output = (result?.output || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('')
    try { await run.dispose() } catch {}
    if (result?.stopReason !== 'completed') {
      return { ok: false, error: '子代理没正常跑完（' + (result?.stopReason || '未知') + '）' + (result?.diagnostic ? '：' + result.diagnostic : ''), partial: output }
    }
    // 投递提示：让大肥鱼知道接下来要不要发评论/私信（她拿报告后自己决定、自己发）
    const commentQuota = Math.max(0, Number(cfg.commentPerRound || 0))
    const commentOn = Boolean(cfg.autoComment && cfg.mentionName && cfg.dmMode !== 'only' && commentQuota > 0)
    if (commentOn) pendingComment = { at: Date.now() }   // 记账：这轮欠一条评论
    const dmOn = Boolean(cfg.dmMode !== 'off' && Number(cfg.dmUid) > 0)
    const parts = ['这份报告是给你的内部情报。接下来**你来**决定怎么递给' + owner + '（用你的口吻、别把内部术语写进去）']
    if (commentOn) parts.push('· **评论区 @（公开！除了 ' + owner + '，别人也看得到）**：这是**发**评论——必须用 `bili_reply` 工具真发一条，**不是**用 `bili_comment` 去读评论（读评论是子代理已经干过的事，跟这一步无关）。**设置里已经开着，直接调 bili_reply 就行，不用传 force**。最多发 ' + commentQuota + ' 条，内容**极短**：只点一个最有意思的点/梗，然后 @ ' + cfg.mentionName + '，勾她去看。别写长、别写私密的话（大家都能看到）。')
    if (dmOn) parts.push('· **私信（只 ' + owner + ' 一个人看）**：用 bili_send_message 发**详细版**——开头先叫一声「' + owner + '，」再往下说；标题、BV号、视频讲了啥都可以细说，给 UID ' + Number(cfg.dmUid) + '。')
    if (!commentOn && !dmOn) parts.push('报告拿给你了，你自己看着跟' + owner + '聊。')
    if (commentOn && dmOn) parts.push('⚠️ **这两件都要做，别只做一件**：先调 `bili_reply` 把评论 @ 发了，再调 `bili_send_message` 发私信（没发评论之前，私信会被拒）。')
    parts.push('⚠️ 无论会话里讲、评论、还是私信，**都必须带 BV 号**（标题后紧跟 BV1xxxxxxx），' + owner + ' 要靠它找原视频。')
    const hint = parts.join('\n')
    // ⭐ 每一轮的报告都写回报告文件（设置页「看报告」能回看）；「日报写多细=不写」时跳过
    if (level !== 'off') { try { appendFileSync(reportFileOf(), '\n\n---\n\n' + output + '\n', 'utf8') } catch {} }
    return { ok: true, report: output, hint }
  }

  const doScan = async (direction, exec) => {
    const parent = ctx.agents?.currentInitiator?.()
    if (!parent) return { ok: false, error: '没拿到发起刷 B 站的会话（要在对话里用）' }
    return scanWith(parent, direction, exec)
  }

  tool({
    name: 'bili_scan',
    description: '派一个子代理去刷 B 站：按你想看的方向搜视频、读字幕原文、把值得的挑出来，看完把内容汇报给你。\n'
      + '大肥鱼（或你）说「帮我刷下 XX 方向」就能触发；子代理模型可在设置页选。',
    parameters: {
      direction: { type: 'string', description: '想刷什么方向 / 主题 / 关键词，一句话或几个词' },
    },
    async execute(args, exec) {
      return doScan(args?.direction, exec)
    },
  })

  tool({
    name: 'bili_whoami',
    description: '看 B站 那边登录的是谁（凭证是否有效、昵称、mid）。第一次用要先在「刷B站」设置页里扫码登录。',
    parameters: {},
    async execute() {
      if (!hasCredential()) {
        return { ok: false, loggedIn: false, hint: '还没登录：去 dsh 设置页的「刷B站」里点「扫码登录」（凭证会存在插件自己的家目录里）' }
      }
      const r = await call('bili_check_credential', {})
      return { ok: true, ...(typeof r === 'object' ? r : { raw: r }) }
    },
  })

  tool({
    name: 'bili_search',
    description: '搜 B站 视频（可排序）。返回标题 / BV号 / 播放量 / UP / 时长 等。\n'
      + '⚠️ 刷一轮的用法：搜近 7 天的、按播放或最新都行，然后**读字幕原文**再判断（别看摘要下结论）。',
    parameters: {
      keyword: { type: 'string', description: '搜索关键词' },
      num: { type: 'number', description: '返回几条（默认 10，最大 50）' },
      order: { type: 'string', description: 'totalrank=综合（默认）/ click=播放 / pubdate=最新 / dm=弹幕' },
    },
    async execute(args) {
      refreshCfg()
      const num = Math.max(1, Math.min(Number(args.num) || 10, 50))
      const minViews = Math.max(0, Number(cfg.minViews || 0))
      const minAgeDays = Math.max(0, Number(cfg.minAgeDays || 0))
      const filtering = Boolean(minViews || minAgeDays)
      // ⭐ 有门槛时多抓几倍再筛：不然筛完可能一条不剩，子代理会以为"搜不到"
      const raw = await call('bili_search', {
        keyword: String(args.keyword ?? ''),
        num: filtering ? Math.min(50, num * 4) : num,
        order: String(args.order || 'totalrank'),
      })
      // ⭐ 硬门槛（设置页里的「最低播放量」「至少发布几天」）：在**工具层**就把垃圾滤掉，
      //    子代理根本看不到 —— 比在提示词里嘱咐它"别选低播放量的"可靠得多。
      if (!filtering) return raw
      try {
        // ⚠️ mcp.call() **已经 JSON.parse 过**了，这里拿到的是对象；再 parse 一次会抛，
        //    然后被下面的 catch 吞掉 ⇒ 门槛看起来"完全没生效"（2026-10-20 真踩到，别删这段注释）
        const obj = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (!obj || !Array.isArray(obj.videos)) return raw
        const nowSec = Date.now() / 1000
        const kept = []
        let dropViews = 0
        let dropAge = 0
        for (const v of obj.videos) {
          if (minViews && Number(v.play || 0) < minViews) { dropViews++; continue }
          if (minAgeDays && Number(v.pubdate || 0) > nowSec - minAgeDays * 86400) { dropAge++; continue }
          kept.push(v)
        }
        const note = []
        if (minViews) note.push('播放量 < ' + minViews + ' 的排除 ' + dropViews + ' 条')
        if (minAgeDays) note.push('发布不足 ' + minAgeDays + ' 天的排除 ' + dropAge + ' 条')
        obj.videos = kept.slice(0, num)
        obj.count = obj.videos.length
        obj.filtered = note.join('；')
        // 留一行日志：以后"门槛有没有生效"直接在 duty.log 里看得见，不用再猜
        try { log('搜索门槛生效：' + (obj.filtered || '无') + '（返回 ' + obj.count + ' 条）') } catch (e) {}
        return obj
      } catch (e) {
        // 过滤失败绝不静默：退回不过滤，但日志里必须留痕
        try { log('门槛过滤失败（已退回不过滤）：' + (e?.message ?? e)) } catch (e2) {}
        return raw
      }
    },
  })

  tool({
    name: 'bili_subtitle',
    description: '取一个视频的字幕（AI 字幕）全文。**判断内容就靠它** —— 没有字幕时，'
      + '没有字幕的直接跳过这条。',
    parameters: { bvid: { type: 'string', description: 'BV号' } },
    async execute(args) { return call('bili_subtitle', { bvid: String(args.bvid ?? '') }) },
  })

  tool({
    name: 'bili_comments',
    description: '取一个视频的热门评论（含点赞/回复数）。刷一轮时顺手翻一眼，看值不值得占用使用者一次注意力。',
    parameters: {
      bvid: { type: 'string', description: 'BV号' },
      num: { type: 'number', description: '取几条（默认 30）' },
    },
    async execute(args) {
      return call('bili_comments', { bvid: String(args.bvid ?? ''), num: Math.max(1, Number(args.num) || 30) })
    },
  })

  tool({
    name: 'bili_reply',
    description: '在视频下发一条评论（或回复某条评论）。这就是"@ 那个人"那一下：短、干净、纯文本 @ 写在正文里。\n'
      + '✅ 设置里开着「自动评论并 @ 你」、填了「要 @ 谁」、「每轮最多发几条评论」> 0 时，**直接调就行，不用传 force**。\n'
      + '🔴 只有设置没开时才会拒绝；那种情况下要发才传 force: true。',
    parameters: {
      bvid: { type: 'string', description: 'BV号' },
      text: { type: 'string', description: '评论正文（短、干净、纯文本 @；别写敏感词）' },
      rpid: { type: 'number', description: '要回复的评论 id（0/不填 = 发新评论）' },
      force: { type: 'boolean', description: '本人当场让你发的，传 true 越过"自动评论关着"的闸' },
    },
    async execute(args) {
      // dmMode==='only' 时本轮根本不该发公开评论；「每轮最多发几条评论」填 0 也一条都不发 —— 工具层一并挡掉（除非当场 force）
      refreshCfg()
      const commentOn = Boolean(cfg.autoComment && cfg.mentionName && cfg.dmMode !== 'only' && Math.max(0, Number(cfg.commentPerRound || 0)) > 0)
      if (!commentOn && !args.force) {
        return {
          ok: false,
          blocked: true,
          hint: cfg.dmMode === 'only'
            ? '现在是「只私信」模式（dmMode=only）—— 规定不发公开评论，改成用 bili_send_message 私信。确实要发时传 force: true。'
            : (Math.max(0, Number(cfg.commentPerRound || 0)) === 0
              ? '设置里「每轮最多发几条评论」填的是 0 —— 这一轮按规定不发公开评论。确实要发时传 force: true。'
              : '要发评论得同时满足三条：开着「自动评论并 @ 你」、填了「要 @ 谁」、且「每轮最多发几条评论」> 0。或者本人当场让你发时传 force: true。'),
        }
      }
      const r = await call('bili_reply', {
        bvid: String(args.bvid ?? ''),
        text: String(args.text ?? ''),
        rpid: Number(args.rpid) || 0,
      })
      pendingComment = null   // 发过（无论成败）就不再卡私信
      return r
    },
  })

  tool({
    name: 'bili_send_message',
    description: '给某人发 B 站私信（把这一轮刷到的好东西私信给他）。用于「只私信 / 评论+私信」模式，让大肥鱼亲自把结果私下递过去。\n'
      + '🔴 安全闸：设置里「投递方式」得不是 off、且填了私信 UID，否则拒绝（本人当场让你发时传 force: true）。\n'
      + '⚠️ 私信是写给「人」看的：干净的人话，别出现设置名/内部术语；实测 500 字符就顶，别太长。',
    parameters: {
      text: { type: 'string', description: '私信正文（干净的人话、不含内部术语，控制 500 字内）' },
      uid: { type: 'number', description: '发给谁（B站 UID 数字；不填用设置里的 dmUid）' },
      force: { type: 'boolean', description: '本人当场让你发的，传 true 越过安全闸' },
    },
    async execute(args) {
      refreshCfg()
      const dmOn = Boolean(cfg.dmMode !== 'off' && Number(cfg.dmUid) > 0)
      const uid = Number(args.uid) || Number(cfg.dmUid) || 0
      if (!dmOn && !args.force) {
        return { ok: false, blocked: true, hint: '私信要发得先满足：设置里「投递方式」设成只私信/都发、并填了私信 UID。或者本人当场让你发时传 force: true。' }
      }
      if (!uid) return { ok: false, blocked: true, hint: '没有收件人 UID：在设置里填「私信发给谁」，或调用时传 uid。' }
      // ⭐ 硬约束：这一轮还欠着评论就先别发私信 —— 先调 bili_reply 把评论发了
      const commentOnNow = Boolean(cfg.autoComment && cfg.mentionName && cfg.dmMode !== 'only' && Math.max(0, Number(cfg.commentPerRound || 0)) > 0)
      // ⭐ 这道闸**故意不看 args.force**：模型会习惯性带 force: true 把它绕过去（2026-10-19 实测 7/7 轮全带）。
      //    评论"调过就算"（成败都清 pendingComment），所以不会把它锁死。
      if (commentOnNow && pendingComment && Date.now() - pendingComment.at < 15 * 60 * 1000) {
        return { ok: false, blocked: true, hint: '这一轮还没发评论：先调 bili_reply 在视频下留一条简短评论 @ 一下（设置里已经开着，直接发、不用 force），发完再回来发私信。' }
      }
      return call('bili_send_message', { receiver_uid: uid, text: String(args.text || '') })
    },
  })

  tool({
    name: 'bili_status',
    description: '看它今天的状态：跑了没跑、挑了几条、额度剩多少、报告在哪、登录过没有、下次窗口什么时候开。',
    parameters: {},
    async execute() {
      refreshCfg()
      const st = readJson(join(stateDir, 'state.json'), {})
      const now = new Date()
      return {
        ok: true,
        today: dayKey(now),
        // ⭐ 额度只有一个口径：**今天自动刷了几轮**（手动跑不占额度）
        autoRoundsToday: countPickedToday(now),
        autoRoundsLeft: Math.max(0, Number(cfg.perDay || 0) - countPickedToday(now)),
        videosToday: countPicks(reportFileOf(now)),   // 今天报告里真挑到几条（含手动轮的）
        perDay: cfg.perDay,
        windows: Object.fromEntries(Object.entries(WINDOWS).map(([k, w]) => [k, {
          label: w.label, start: w.start, end: w.end,
          switchOn: Boolean(cfg[k]),
          opening: inWindow(now, w),
        }])),
        peakValley: cfg.peakValley,
        autoComment: cfg.autoComment,
        dmMode: cfg.dmMode,
        dmUid: Number(cfg.dmUid) || 0,
        loggedIn: hasCredential(),
        home: stateDir,
        report: join(outDir, `${dayKey(now)}.md`),
      }
    },
  })

  tool({
    name: 'bili_login_start',
    description: '开始 B站 扫码登录：出二维码（画成 PNG 存在插件家目录里，返回路径）和一个 key。\n'
      + '用法：拿到 PNG 后用 `present` 把它推给本人（手机 B站 → 我的 → 扫一扫），再用 `bili_login_poll` 轮询。\n'
      + '⚠️ 二维码大约 180 秒有效，出码要马上递过去；手机上确认时选「记住我」那种长期登录。',
    parameters: {},
    async execute() {
      const { key, url } = await loginStart()
      const png = await renderQrPng(cfg.pythonPath, stateDir, url)
      return {
        ok: true, key, url, png,
        hint: png ? '用 present 把这张 PNG 推给本人扫；扫完调 bili_login_poll' : '没画出 PNG：先去设置里点「建 venv 装依赖」（venv 里要有 qrcode）',
      }
    },
  })

  tool({
    name: 'bili_login_poll',
    description: '查扫码结果：waiting 还没扫 / scanned 扫了待确认 / ok 成功 / expired 过期。'
      + '成功时会自动把凭证写进插件家目录的 `bili_credential.json`（MCP 认的那四个字段）。',
    parameters: { key: { type: 'string', description: 'bili_login_start 给的那个 key' } },
    async execute(args) {
      const r = await loginPoll(String(args.key ?? ''))
      if (r.state === 'ok') {
        const file = saveCredential(stateDir, r.credential)
        log(`登录成功，凭证已写入 ${file}`)
        return { ok: true, state: 'ok', file }
      }
      return { ok: r.state !== 'unknown', state: r.state, code: r.code, message: r.message }
    },
  })

  tool({
    name: 'bili_setup',
    description: '给刷B站装运行环境：在插件家目录建一个**独立 venv**、装上那个 Python MCP 的依赖，装完自动把 `pythonPath` 指过去。\n'
      + '**第一次用之前跑一次**。⭐ 它**起完就返回、不等装完**（几分钟的活），进度看家目录里的 `install.log`。',
    parameters: {},
    async execute() { return runInstall() },
  })

  tool({
    name: 'bili_config',
    description: '读 / 改「刷B站」的设置。不给 `patch` 就是读；给了就改（只认 schema 里的字段）。\n'
      + '例：`{"perDay":5,"peakValley":true,"noon":true,"night":true,"autoComment":false,"perScan":1}`；'
      + '私信投递：`{"dmMode":"only","dmUid":12345678}`（dmMode = off / only / both）。',
    parameters: { patch: { type: 'object', additionalProperties: true, description: '要改的字段（可省）' } },
    async execute(args) {
      let host = null
      if (args?.patch && typeof args.patch === 'object' && !Array.isArray(args.patch)) {
        // ⭐ 设置页显式设过的键以宿主为准 ⇒ 必须跟着写一份，否则"改了没反应"（钳范围也在这里）
        host = (await persistCfg(args.patch)).host
      }
      return { ok: true, config: cfg, windows: WINDOWS, home: stateDir, venvReady: venvReadyNow(), host }
    },
  })

  /* ─────────────── 跑一轮（跟老方案同一条路：dsh --profile headless <prompt>） ─────────────── */

  const dutyStateFile = join(stateDir, 'state.json')
  const bumpState = (patch) => {
    const st = readJson(dutyStateFile, {})
    const today = dayKey()
    if (st.day !== today) { st.day = today; st.count = 0; st.picked = 0; st.windows = {} }
    writeJson(dutyStateFile, { ...st, ...patch })
    return st
  }

  /* ⭐ 「定量刷」承诺的是**每天挑几条**（2026-10-16 审查修 H1：原来 st.count 从没自增过，
   *   tick 那道 `count >= perDay` 的闸形同虚设 ⇒ noon + night 两个窗口各跑满一轮，
   *   后一轮还会把前一轮的报告覆盖掉）。
   *   数哪儿？数**今天的报告**里那些 `### BV号` 标题行（章程写死了这个格式）。
   *   ⚠️ 为什么不数「报告里出现的所有 BV」（2026-10-17 复查修的）：报告里还会出现**没挑中**的 BV ——
   *     「因无字幕跳过 N 条」那行、评论区里别人问起的视频、"判重表读不到"的说明 —— 全算进去的话，
   *     perDay 默认 5 ⇒ 一轮里出现 5 个 BV 就把当天额度吃光 ⇒ **傍晚那轮直接不跑** ✗。
   *   ⚠️ 围栏 ``` 里的内容一律不看：那一轮没写报告时 stubReportIfMissing 会把 duty.log 尾部贴进报告，
   *     那里面的 BV 是"看过的"，不是"挑出来的"。
   *   ⚠️ 数不出来（章程那条格式没照做）就当 0 条 —— 宁可少算（顶多多跑一轮、额度也写在提示词里），
   *     也别把"提到过"算成"挑中"（那会让使用者当天再也拿不到内容）✓。 */
  const PICK_RE = /^#{2,3}[ \t]*(BV[0-9A-Za-z]{10})/gm
  const reportFileOf = (now = new Date()) => join(outDir, `${dayKey(now)}.md`)
  const countPicks = (file) => {
    try {
      const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '')
      const ids = new Set()
      for (const m of text.matchAll(PICK_RE)) ids.add(m[1])
      return ids.size
    } catch { return 0 }
  }
  // ⭐ 额度只认「自动刷」在 state 里记的 picked，不数报告文件（手动刷写报告但不占额度）
  const countPickedToday = (now = new Date()) => {
    const st = readJson(dutyStateFile, {})
    return st.day === dayKey(now) ? Number(st.picked || 0) : 0
  }
  const roundsToday = (now = new Date()) => {
    const st = readJson(dutyStateFile, {})
    return st.day === dayKey(now) ? Number(st.count || 0) : 0
  }

  // ⭐ 「复核评论」：拿判重表里最近的记录，去 B站 核一遍到底公开可见没有（发出去≠可见）
  let verifying = false
  const runVerify = async (why = 'manual') => {
    if (verifying) return { ok: false, error: '上一次复核还没跑完，等它完事' }
    verifying = true
    try {
      log(`评论复核开始（${why}）`)
      const r = await verifyRecent(stateDir, { log })
      const f = appendVerifyToReport(stateDir, r.text)
      log(`评论复核结束（${why}）：查了 ${r.checked.length} 条${f ? `，已写进 ${f}` : ''}`)
      return { ok: true, why, checked: r.checked, skipped: r.skipped, text: r.text, report: f || '' }
    } catch (e) {
      log(`评论复核失败（${why}）：${e?.message ?? e}`)
      return { ok: false, why, error: String(e?.message ?? e) }
    } finally { verifying = false }
  }

  const sessionIdOf = (session) => {
    if (!session) return ''
    for (const k of ['id', 'sessionId', 'key', 'sessionKey', 'sid']) {
      try { const v = session[k]; if (typeof v === 'string' && v) return v } catch {}
    }
    return ''
  }

  // ⭐ 自动刷：到点不 headless，而是往「伙伴住的会话」followup 一句，让 TA 自己开一轮去刷（占每天额度）
  //   目标会话：设置里选的优先；没选就自动挑「最近聊过、非空、非归档」的那个 —— 不写死任何人的 id
  const listDirs = (p) => {
    try { return readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) } catch { return [] }
  }

  const pickRecentSession = () => {
    try {
      const base = join(dirname(stateDir), 'storages')
      const sessRoot = join(dirname(stateDir), 'sessions')
      const cacheDir = join(base, 'session_projcache', 'sessions')
      const archived = new Set()
      try {
        for (const id of (readJson(join(base, 'workspace.json'), {})?.global?.archivedSessionIds || [])) archived.add(String(id))
      } catch {}
      let best = null
      for (const ws of listDirs(sessRoot)) {
        for (const sid of listDirs(join(sessRoot, ws))) {
          if (!sid.startsWith('session-')) continue
          if (archived.has(sid)) continue
          if (!existsSync(join(sessRoot, ws, sid, 'session.v4.jsonl.zstd'))) continue
          let at = 0
          let blank = false
          try {
            const meta = readJson(join(cacheDir, sid + '.json'), {})?.record?.rows?.sessionListMetadata?.val || {}
            at = Number(meta.lastPromptAt || 0)
            blank = Boolean(meta.blank)
          } catch {}
          if (blank) continue
          if (!best || at > best.at) best = { id: sid, at }
        }
      }
      return best ? best.id : ''
    } catch { return '' }
  }

  // ⭐ 最后兜底：一个可用会话都没有时，新建一个（用完就收，别一直占着）
  const createScanSession = async () => {
    if (typeof ctx.agents?.create !== 'function') return { id: '', agent: null }
    try {
      const sid = 'session-' + randomUUID()
      const handle = await ctx.agents.create({ sessionId: sid, meta: { cwd: stateDir } })
      const agent = handle?.agent || null
      let done = false
      const dispose = () => {
        if (done) return
        done = true
        try { handle?.dispose?.() } catch {}
      }
      // 这一轮结束后再收（留 30 秒给收尾），另外兜一个 20 分钟上限
      try { agent?.ctx?.on?.('agent/turn-stopping', () => setTimeout(dispose, 30_000)) } catch {}
      setTimeout(dispose, 20 * 60_000)
      log('自动刷：没有可用会话，临时新建了一个（' + sid.slice(0, 20) + '…）')
      return { id: sid, agent }
    } catch (e) {
      log('自动刷：新建会话失败（' + (e?.message ?? e) + '）')
      return { id: '', agent: null }
    }
  }

  const triggerFeiyuScan = async (why) => {
    let target = String(cfg.targetSession || '').trim()
    if (!target) target = pickRecentSession()          // 没选 → 最近聊过的那个
    let agent = null
    if (!target) {
      const made = await createScanSession()           // 实在没有 → 临时新建
      target = made.id
      agent = made.agent
    }
    if (!target) { log('自动刷：找不到可用的目标会话（请在设置里选一个会话）'); return false }
    if (!agent) {
      try { agent = ctx.agents?.get?.(target) } catch {}
    }
    if (!agent) agent = (ctx.agents?.list?.() || []).find((a) => sessionIdOf(a.session) === target)
    if (!agent) { log('自动刷：目标会话现在没醒着（' + target.slice(0, 20) + '…）—— 先去那儿说句话再等下一轮'); return false }
    if (typeof agent.followup !== 'function') { log('自动刷：agent 没有 followup'); return false }
    const msg = {
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: '（到谷时啦，去 B 站刷一轮吧～想看什么方向你自己定，用 bili_scan 就行；刷完按设置，该发评论发评论、该发私信发私信。）' }],
      source: { kind: 'bili-duty-scan' },
    }
    try {
      await agent.followup(msg)
      log('自动刷：已触发伙伴自己刷一轮（' + why + '，会话 ' + target.slice(0, 20) + '…）')
      return true
    } catch (e) {
      log('自动刷：触发失败 ' + (e?.message ?? e))
      return false
    }
  }

  // ⭐ 谷时定时器：每 60 秒看一次，满足四件事才跑
  //    ① 总开关开着 ② 今天自动刷的轮数没到上限 ③ 现在落在某个谷时窗口里
  //    ④ 离上一轮已经隔够「两轮之间至少隔几小时」
  //    ★ 2026-10-19 改：原来「每个窗口每天只跑一次」（windows[key] 打勾）⇒ 一天最多 3 轮，
  //      perDay 填 5 永远用不满。现在改成**窗口内按间隔轮转**，直到额度用完。
  const tick = () => {
    try {
      refreshCfg()                    // ⭐ 定时器活得比设置页久：每一跳都重新读一遍配置
      if (!cfg.peakValley) return
      const now = new Date()
      const st = readJson(dutyStateFile, {})
      const today = dayKey(now)
      const used = countPickedToday(now)
      if (used >= Number(cfg.perDay || 0)) return
      // ⭐ 两轮之间至少隔这么久（手动跑不受这个限制）
      const gapMs = Math.max(1, Number(cfg.gapHours || 3)) * 3600_000
      const lastAt = Date.parse(String(st.lastRunAt || '')) || 0
      if (lastAt && now.getTime() - lastAt < gapMs) return
      for (const k of ['noon', 'night']) {
        if (!cfg[k]) continue
        if (!inWindow(now, WINDOWS[k])) continue
        const key = `${today}:${k}`
        const rounds = used + 1
        const before = { windows: st.windows || {}, count: st.count || 0, picked: st.picked || 0, lastRunAt: st.lastRunAt || null, lastWhy: st.lastWhy || null }
        bumpState({ windows: { ...(st.windows || {}), [key]: true }, count: rounds, picked: rounds, lastRunAt: now.toISOString(), lastWhy: k })
        Promise.resolve(triggerFeiyuScan(`window:${k}`))
          .then((ok) => {
            // ⭐ 没投出去（目标会话没醒着之类）⇒ 把额度和间隔都退回去，下个周期还能重试
            if (ok === false) {
              bumpState(before)
              log('自动刷：这一轮没投出去，额度已退回，稍后重试')
            }
          })
          .catch((e) => { log('自动刷：投递异常（已兜住）' + (e?.message ?? e)) })
        return
      }
    } catch (e) {
      log(`定时器这一跳出错（已兜住，不影响宿主）：${e?.stack ?? e}`)
    }
  }

  try {
    const timer = setInterval(tick, 60_000)
    timer.unref?.()                                    // 别因为这个定时器让进程不肯退出
    ctx.effect(() => () => clearInterval(timer), 'bili-duty: 谷时定时器')
  } catch (e) { log(`定时器没起来：${e?.message ?? e}`) }

  /* ─────────────── HTTP（设置页用） ─────────────── */

  const sendJson = (res, code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(obj))
  }
  const readBody = (req) => new Promise((resolve) => {
    let data = ''
    let done = false
    // ⚠️ 超过 1MB 得**先把 Promise 收掉**再掐断：只 destroy 的话它永远不 settle，
    //    这个请求就挂在那儿（不回响应、也不释放）
    const finish = (v) => { if (!done) { done = true; resolve(v) } }
    req.on('data', (c) => { data += c; if (data.length > 1_000_000) { data = ''; finish({}); req.destroy() } })
    req.on('end', () => { try { finish(JSON.parse(data || '{}')) } catch { finish({}) } })
    req.on('error', () => finish({}))
  })

  const venvPython = () => process.platform === 'win32'
    ? join(stateDir, '.venv', 'Scripts', 'python.exe')
    : join(stateDir, '.venv', 'bin', 'python')

  /**
   * 建 venv + 装依赖 —— ⭐ **起完就返回，不等它装完**。
   *
   * 🔴 为什么必须这样（2026-10-14 事故）：第一版是 `async` 全程 await，
   *    而"建 venv + pip install"在使用者这条网络上要**几分钟** ⇒ 那个工具调用一直挂着，
   *    **整个会话僵住、连"暂停"都卡，最后只能重启 dsh** ✗。
   *    现在的做法：spawn 出去、输出追加进 `install.log`，函数立刻返回；
   *    想知道装完没 —— 读日志，或看 `bili_duty_status` 里的 `installing`。
   * 依赖走**国内镜像**（使用者那条网络 pip 直连只有 ~24KB/s ✗；uv + 清华源是几十秒 ✓）。
   */
  let installing = false
  const installLogFile = join(stateDir, 'install.log')
  const appendInstall = (s) => { try { appendFileSync(installLogFile, s, 'utf8') } catch { /* 写不进去就算了 */ } }

  let uvOk = null
  const haveUv = async () => {
    if (uvOk) return true
    const ok = await new Promise((resolve) => {
      try {
        const c = spawn('uv', ['--version'], { windowsHide: true, stdio: 'ignore' })
        c.on('exit', (code) => resolve(code === 0))
        c.on('error', () => resolve(false))
      } catch { resolve(false) }
    })
    // ⭐ 只缓存"有"：把"没有"也缓存住的话，这一轮里刚下好的 uv（或用户刚装上的）会被一直当成没有，
    //    非重启 dsh 不可 ✗（调用点只有装依赖那两处，多探一次几毫秒）
    if (ok) uvOk = true
    return ok
  }

  /** 探一下某个命令在不在（用于"这台机器有没有 python"）—— 陌生人第一条坎就卡在这儿 */
  const probeCmd = (cmd) => new Promise((resolve) => {
    try {
      const c = spawn(cmd, ['--version'], { windowsHide: true, stdio: 'ignore' })
      c.on('exit', (code) => resolve(code === 0))
      c.on('error', () => resolve(false))
    } catch { resolve(false) }
  })

  const spawnLogged = (cmd, args) => new Promise((resolve) => {
    appendInstall(`\n$ ${cmd} ${args.join(' ')}\n`)
    let c
    try { c = spawn(cmd, args, { cwd: stateDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: pyEnv() }) }
    catch (e) { appendInstall(`起不来：${e?.message ?? e}\n`); return resolve(1) }
    const w = (b) => appendInstall(String(b))
    c.stdout?.on('data', w)
    c.stderr?.on('data', w)
    c.on('exit', (code) => { appendInstall(`\n--- exit ${code} ---\n`); resolve(code) })
    c.on('error', (e) => { appendInstall(`起不来：${e?.message ?? e}\n`); resolve(1) })
  })

  // ⭐ 判重表也由**宿主**预先建好（两个原因）：
  //   ① 那一轮被沙箱关着，"新建文件"会被拒（2026-10-14 那条规矩）；
  //   ② 它读不出判重表 ⇒ 以为"没记录过" ⇒ 同一批视频反复推送（用户实测反馈 2026-10-16）。
  const seenFile = join(stateDir, 'seen.md')
  try {
    if (!existsSync(seenFile)) {
      writeFileSync(seenFile, [
        '# 刷B站 · 判重表（宿主预建，那一轮只往后面追加）',
        '',
        '## 评论记录（BV | rpid | root（楼中楼才填） | 时间 | 正文前 20 字）',
        '',
        '| BV | rpid | root（楼中楼才填） | 时间 | 正文前 20 字 |',
        '| --- | --- | --- | --- | --- |',
        '',
        '## 看过的视频',
        '',
      ].join('\n'), 'utf8')
    }
  } catch { /* 建不了也别拦着插件加载 */ }


  /** 找 uv：系统里的 → 插件家里下好的 → 自己下一份（给"两样都没有"的人）；主/转写两套安装共用 */
  const resolveUv = async () => {
    const bundled = join(stateDir, 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv')
    if (await haveUv()) return 'uv'
    if (existsSync(bundled)) return bundled
    appendInstall('这台机器上没有 uv —— 我下一份放进插件家目录（单文件、免管理员、约 15MB，只需要一次）…\n')
    const got = await ensureUv({ dir: join(stateDir, 'bin'), log: appendInstall })
    if (got) appendInstall('uv 已就位：' + got + '\n')
    return got
  }

  /** 跟 spawnLogged 一样，但可以写进别的日志、可以带环境变量 */
  const spawnTo = (cmd, args, { sink = appendInstall, env = null } = {}) => new Promise((resolve) => {
    sink(`\n$ ${cmd} ${args.join(' ')}\n`)
    let c
    try {
      c = spawn(cmd, args, { cwd: stateDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: pyEnv(env || {}) })
    } catch (e) { sink(`起不来：${e?.message ?? e}\n`); return resolve(1) }
    const w = (b) => sink(String(b))
    c.stdout?.on('data', w)
    c.stderr?.on('data', w)
    c.on('exit', (code) => { sink(`\n--- exit ${code} ---\n`); resolve(code) })
    c.on('error', (e) => { sink(`起不来：${e?.message ?? e}\n`); resolve(1) })
  })

  /** 装主依赖：建 venv + bilibili_api 那套（搜索 / 字幕 / 评论 用得到） */
  const runInstall = () => {
    if (installing) return { ok: true, busy: true, log: installLogFile, hint: '正在装，别重复起' }
    installing = true
    appendInstall(`\n=== ${new Date().toISOString()} 开始装依赖 ===\n`)
    ;(async () => {
      try {
        const reqFile = join(pluginDir, 'vendor', 'bilibili-mcp', 'requirements.txt')
        const mirror = process.env.BILI_DUTY_PIP_MIRROR || 'https://pypi.tuna.tsinghua.edu.cn/simple'
        const venvPy = venvPython()
        const py = String(cfg.pythonPath || 'python')
          const uvCmd = await resolveUv()   // ⭐ 系统里的 → 家里下好的 → 自己下一份
        if (!existsSync(venvPy) && !uvCmd && !(await probeCmd(py))) {
          const msg = '这台机器上没有 uv，也没有可用的 python（试过 "' + py + '"），而且我自动下 uv 也没成功'
            + '（大概是网络到不了 GitHub / PyPI 镜像）。⇒ 请手动装 uv（单个 exe：https://docs.astral.sh/uv/）'
            + '或 Python 3.10+（安装时勾 Add to PATH），然后回来再点一次「装依赖」。'
          appendInstall(msg + '\n'); log(msg); installing = false; return
        }
        if (!existsSync(venvPy)) {
          // ⭐ 2026-10-17（issue #8③）：ASR 那个环境带了 --seed，主环境却漏了 ⇒ uv 建的 venv 默认不含 pip，
          //    一旦镜像失败、回退 `python -m pip` 就是 `No module named pip` ⇒ 连补救的路都没有 ✗
          if (uvCmd) await spawnLogged(uvCmd, ['venv', '--seed', join(stateDir, '.venv')])
          if (!existsSync(venvPy) && !uvCmd) await spawnLogged(py, ['-m', 'venv', join(stateDir, '.venv')])
        }
        let code = 1
        // ⭐ 2026-10-17（issue #8②）：镜像也会整站拒绝（清华对部分 IP 回 403，而 pip 的报错写成"这个包不存在"，很误导）
        //    ⇒ 一个镜像失败就换下一个，别让用户在一个死镜像上反复撞
        const mirrors = [mirror, 'https://mirrors.ustc.edu.cn/pypi/simple', 'https://mirrors.aliyun.com/pypi/simple']
        for (let i = 0; i < mirrors.length && code !== 0; i++) {
          const m = mirrors[i]
          if (i > 0) appendInstall(`\n--- 换个镜像再试：${m} ---\n`)
          if (uvCmd) code = await spawnLogged(uvCmd, ['pip', 'install', '--python', venvPy, '-i', m, '-r', reqFile])
          if (code !== 0) code = await spawnLogged(venvPy, ['-m', 'pip', 'install', '-i', m, '-r', reqFile])
        }
        if (code === 0 && existsSync(venvPy)) {
          await persistCfg({ pythonPath: venvPy })   // ⭐ 不然设置页里显式设过 pythonPath 的话，这里就白写了
          appendInstall(`已把 pythonPath 设为 ${venvPy}\n`)
        }
        appendInstall(`=== 结束（exit ${code}，venvReady=${venvReadyNow()}）===\n`)
        log(`装依赖结束：exit=${code} venvReady=${existsSync(venvPy)}`)
      } catch (e) {
        appendInstall(`装依赖崩了：${e?.stack ?? e}\n`)
        log(`装依赖崩了：${e?.message ?? e}`)
      } finally { installing = false }
    })()
    return { ok: true, started: true, log: installLogFile, hint: '正在后台装依赖 —— 进度就显示在下面（走国内镜像，通常几十秒到一两分钟）' }
  }

  /** 「测一下」：真跑一次查询再下结论（判据落在载荷上，不看自报） */
  const checkUp = async () => {
    const out = { ok: false, steps: [] }
    if (!venvReadyNow()) { out.error = '环境还没装好（可能上次装失败了）—— 点「重装主依赖」再试一次'; return out }
    if (!hasCredential()) { out.error = '还没登录：点「扫码登录」，手机 B站 扫一下'; return out }
    try {
      const who = await call('bili_check_credential', {})
      out.who = (typeof who === 'object' ? JSON.stringify(who) : String(who)).slice(0, 140)
      out.steps.push('登录有效')
    } catch (e) { out.error = '登录检查失败：' + (e?.message ?? e); return out }
    try {
      const s = await call('bili_search', { keyword: 'DeepSeek Harness', num: 3 })
      const t = typeof s === 'string' ? s : JSON.stringify(s)
      out.sample = t.slice(0, 160)
      out.steps.push('能搜到东西')
      out.ok = t.length > 2
      if (!out.ok) out.error = '搜到了空结果'
    } catch (e) { out.error = '搜索失败：' + (e?.message ?? e) }
    return out
  }

  let updateCache = null            // { at, latest } —— 检查更新的结果缓存

  const status = () => {
    refreshCfg()
    const st = readJson(dutyStateFile, {})
    const today = dayKey()
    return {
      ok: true,
      home: stateDir,
      config: cfg,
      windows: WINDOWS,
      today,
      // ⭐ 额度只有一个口径：**今天自动刷了几轮**（手动跑不占额度）
      autoRoundsToday: countPickedToday(),
      autoRoundsLeft: Math.max(0, Number(cfg.perDay || 0) - countPickedToday()),
      videosToday: countPicks(reportFileOf()),   // 今天报告里真挑到几条（含手动轮的）
      lastRunAt: st.lastRunAt || null,
      lastWhy: st.lastWhy || null,
      loggedIn: hasCredential(),
      venvReady: venvReadyNow(),
      version: myVersion(),
      installFailed: !installing && !venvReadyNow() && (() => { try { return readFileSync(installLogFile, 'utf8').length > 0 } catch { return false } })(),
      installing,
      installLog: installLogFile,
      // ⭐ 让设置页能显示"装到哪了"（陌生人原来只看到一句"后台在装" ✗）
      installTail: (() => { try { return readFileSync(installLogFile, 'utf8').slice(-1400) } catch { return '' } })(),
      report: join(outDir, `${today}.md`),
      log: logFile,
    }
  }

  const handle = async (req, res, url) => {
    refreshCfg()
    const path = url.pathname
    if (req.method === 'GET' && path === '/api/bili-duty/status') return sendJson(res, 200, status())

    if (req.method === 'GET' && path === '/api/bili-duty/config') {
      return sendJson(res, 200, { ok: true, config: cfg, windows: WINDOWS, home: stateDir })
    }

    if (req.method === 'POST' && path === '/api/bili-duty/config') {
      const body = await readBody(req)
      const patch = {}
      // ⭐ 白名单 = DEFAULTS 的全字段（动态）：以后加任何配置，这里自动放行，再也不会漏
      for (const k of Object.keys(DEFAULTS)) {
        if (k in body) patch[k] = body[k]
      }
      // ⭐ 范围钳制 + 两份都写（config.json / DSH 原生设置页），统一走 persistCfg —— 见文件上方
      // ⭐ 私信那两个字段的合法值（2026-10-17 摘 PR #9；其余范围钳制统一在 persistCfg 里）
      if ('dmMode' in patch) patch.dmMode = ['off', 'only', 'both'].includes(String(patch.dmMode)) ? String(patch.dmMode) : 'off'
      if ('dmUid' in patch) patch.dmUid = Math.max(0, Math.min(Number(patch.dmUid) || 0, Number.MAX_SAFE_INTEGER))
      const { clean, host } = await persistCfg(patch)
      log(`设置已更新：${JSON.stringify(clean)}（DSH 那边${host.ok ? '已同步' : '没写成：' + host.error}）`)
      return sendJson(res, 200, { ok: true, config: cfg, host })
    }

    if (req.method === 'POST' && path === '/api/bili-duty/run') {
      refreshCfg()
      // ⭐ 跟「自动刷」完全同一条路：往选定会话里发一句话，让伙伴自己去派子代理
      //    （不再拿"当前第一个 agent"当父会话 —— 那样子代理会跑到别的会话里去）
      const started = await triggerFeiyuScan('manual')
      log('「现在跑一轮」：' + (started ? '已投递到会话' : '没投递成功'))
      return sendJson(res, 200, started
        ? { ok: true, started: true, hint: '已经在选定的会话里叫它去刷了 —— 切过去看它的回复' }
        : { ok: false, error: '没投递成功：先在设置里选一个会话，或确保那个会话醒着（去说句话）' })
    }

    // 列出 DSH 里已配好的 providers + models（设置页下拉选择子代理模型用）
    if (req.method === 'GET' && path === '/api/bili-duty/models') {
      const providers = []
      try {
        for (const p of (ctx.llm?.listProviders?.() || [])) {
          const item = { id: p.id, name: p.name || p.id, models: [] }
          try {
            for (const m of (await ctx.llm.listModels?.(p.id)) || []) item.models.push({ id: m.id, name: m.name || m.id })
          } catch (e) { /* 某个 provider 拉不出模型列表就算了，别整单失败 */ }
          providers.push(item)
        }
      } catch (e) { log('列模型失败：' + (e?.message ?? e)) }
      return sendJson(res, 200, { ok: true, providers })
    }

    // 列出「会话」（自动刷在哪个会话触发用）
    //   以**磁盘上真实存在的会话目录**为准（投影缓存里混着已删会话的残留，不能直接拿它列）
    //   规则：跳过空会话（从没聊过）、跳过已归档、按最近活动排序
    if (req.method === 'GET' && path === '/api/bili-duty/sessions') {
      const list = []
      try {
        const base = join(dirname(stateDir), 'storages')
        const sessRoot = join(dirname(stateDir), 'sessions')
        const cacheDir = join(base, 'session_projcache', 'sessions')
        // ⭐ 归档名单：workspace.json 的 global.archivedSessionIds
        const archived = new Set()
        try {
          const w = readJson(join(base, 'workspace.json'), {})
          for (const id of (w?.global?.archivedSessionIds || [])) archived.add(String(id))
        } catch { /* 读不到就当没有归档 */ }
        const dirs = (p) => {
          try { return readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) } catch { return [] }
        }
        const rows = []
        for (const ws of dirs(sessRoot)) {
          for (const sid of dirs(join(sessRoot, ws))) {
            if (!sid.startsWith('session-')) continue                       // 子代理（纯 UUID）不要
            if (!existsSync(join(sessRoot, ws, sid, 'session.v4.jsonl.zstd'))) continue   // 没有日志 = 不算真会话
            if (archived.has(sid)) continue                                 // 跳过归档
            let title = ''
            let at = 0
            let blank = false
            try {
              const r = readJson(join(cacheDir, sid + '.json'), {})?.record?.rows || {}
              title = String(r?.title?.val || '')
              const meta = r?.sessionListMetadata?.val || {}
              at = Number(meta.lastPromptAt || 0)
              blank = Boolean(meta.blank)
            } catch {}
            if (blank) continue                                             // 从没聊过的空会话不列
            rows.push({ id: sid, title: title || sid, at })
          }
        }
        rows.sort((a, b) => b.at - a.at)                                     // 最近聊过的排前面
        for (const r of rows) list.push({ id: r.id, title: r.title })
      } catch (e) { log('列会话失败：' + (e?.message ?? e)) }
      return sendJson(res, 200, { ok: true, sessions: list })
    }

    // 建 venv + 装依赖（**不等它**：几分钟的活，进度写 install.log）
    if (req.method === 'POST' && path === '/api/bili-duty/install') {
      return sendJson(res, 200, runInstall())
    }

    // ⭐ 「复核评论」：拿判重表里最近的记录，去 B站 核一遍到底公开可见没有
    //    （设置页那个按钮、以及每轮结束 90 秒后自动跑一次，都走这里）
    if (req.method === 'POST' && path === '/api/bili-duty/verify') return sendJson(res, 200, await runVerify('manual'))

    // 「看今天的报告」：把报告的文本读出来给设置页显示（浏览器不能直接开本地文件 ✗）
    if (req.method === 'GET' && path === '/api/bili-duty/report') {
      const day = String(url.searchParams.get('day') || dayKey()).replace(/[^0-9-]/g, '') || dayKey()
      const file = join(outDir, day + '.md')
      let text = ''
      let exists = false
      try { exists = existsSync(file); if (exists) text = readFileSync(file, 'utf8').slice(0, 200000) } catch { /* 读不到就给空 */ }
      return sendJson(res, 200, { ok: true, day, exists, file, text })
    }

    // 「打开文件夹」：浏览器开不了本地目录 ⇒ 让宿主去开（只认 out / home 两个，别的不受理）
    if (req.method === 'POST' && path === '/api/bili-duty/open') {
      const body = await readBody(req)
      const dir = String(body?.what || 'out') === 'home' ? stateDir : outDir
      if (process.platform !== 'win32') return sendJson(res, 200, { ok: false, error: '这个按钮目前只做了 Windows' })
      // ⭐ 三种方式依次试（PATH 不全时 explorer.exe 会找不到 ✗；spawn 的失败是**异步**的，
      //    try/catch 抓不到 ⇒ 必须挂 'error' 监听，否则会升级成未捕获异常）
      // ⭐ 顺序很重要：把**最可能真的弹出窗口**的放第一（cmd start 走 shell 的 ShellExecute ✓）
      //    并且**不要再传 windowsHide**（2026-10-15 实测：传了以后"成功"但窗口不出现 ✗）
      const attempts = [
        ['cmd.exe', ['/c', 'start', '', dir]],
        [join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe'), [dir]],
        ['powershell.exe', ['-NoProfile', '-Command', "Start-Process -FilePath '" + dir.replace(/'/g, "''") + "'"]],
      ]
      let lastErr = ''
      for (const [cmd, args] of attempts) {
        const err = await new Promise((resolve) => {
          let done = false
          let child
          try { child = spawn(cmd, args, { detached: true, stdio: 'ignore' }) } catch (e) { resolve(String(e?.message ?? e)); return }
          child.on('error', (e) => { if (!done) { done = true; resolve(String(e?.message ?? e)) } })
          setTimeout(() => { if (!done) { done = true; try { child.unref() } catch { /* 无所谓 */ } resolve('') } }, 500)
        })
        if (!err) { log('打开文件夹：用了 ' + cmd + '（没报错；窗口不一定真弹出来了）'); return sendJson(res, 200, { ok: true, opened: dir, via: cmd }) }
        lastErr = err
        log('打开文件夹失败（' + cmd + '）：' + err)
      }
      return sendJson(res, 200, { ok: false, error: lastErr, dir })
    }

    // 「测一下」：真跑一次，回答"能不能用"
    if (req.method === 'POST' && path === '/api/bili-duty/check') {
      return sendJson(res, 200, await checkUp())
    }

    // ── 扫码登录（设置页用）──
    if (req.method === 'POST' && path === '/api/bili-duty/login/start') {
      const { key, url } = await loginStart()
      const png = await renderQrPng(cfg.pythonPath, stateDir, url)
      let qr = null
      if (png) { try { qr = 'data:image/png;base64,' + readFileSync(png).toString('base64') } catch { qr = null } }
      log(`出码：${url}${qr ? '（已画成 PNG）' : '（没画出 PNG —— venv 里大概还没有 qrcode）'}`)
      return sendJson(res, 200, { ok: true, key, url, qr })
    }

    if (req.method === 'POST' && path === '/api/bili-duty/login/poll') {
      const body = await readBody(req)
      const r = await loginPoll(String(body.key || ''))
      if (r.state === 'ok') {
        const file = saveCredential(stateDir, r.credential)
        log(`登录成功，凭证已写入 ${file}`)
        return sendJson(res, 200, { ok: true, state: 'ok', file })
      }
      return sendJson(res, 200, { ok: r.state !== 'unknown', state: r.state, code: r.code, message: r.message })
    }

    return sendJson(res, 404, { ok: false, error: `unknown ${req.method} ${path}` })
  }

  try {
    ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: '/api/bili-duty',
      handler: async (req, res) => {
        try { await handle(req, res, new URL(req.url, 'http://127.0.0.1')) } catch (e) {
          sendJson(res, 500, { ok: false, error: e?.message ?? String(e) })
        }
      },
    }), 'bili-duty: /api/bili-duty 路由')
  } catch (e) { log(`HTTP 路由没挂上：${e?.message ?? e}`) }

  ctx.effect(() => () => { try { mcp?.stop() } catch { /* 收摊 */ } }, 'bili-duty: 收 MCP 子进程')
  log(`已挂载（家=${stateDir}，python=${cfg.pythonPath}，峰谷=${cfg.peakValley ? '开' : '关'}）`)
}
