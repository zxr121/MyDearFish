/**
 * dsh-fish-mind —— 浏览器半端（设置里的一页「大肥鱼」）
 * ============================================================================
 * 这一页给主人看完整的一条鱼：
 *   · 出生设定：名字、物种、外形、称呼、来历、说话习惯和群友关系，只有这里能改；
 *   · 性格人设：整段人设前缀，保存后热应用；
 *   · 自定义话术：私事被追问时的托词和零花钱用完时的本地回复，由主人自己写；
 *   · 开发者模式：只读查看本机调试资料的开关，以及一个创造模式调试会话的入口；
 *   · 记忆、心情、人物志、通道、边界：只读总览，不改；零花钱只改每日额度，其余只读；
 *   · 梗百科：查词、新增、修改、删除和恢复，改的是这台机器上的副本；
 *   · 搬迁：导出整条鱼为一个 zip，导入只收合法的大肥鱼包，而且只进空鱼；
 *   · 自动备份：按主人设的间隔把整条鱼写进安装目录，最多留 5 份。
 *
 * 总览里的记忆和人物志是资料，不是指令；页面不提供直接写库的按钮。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-fish-mind',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const API = '/dsh-fish-mind'
    const IMPORT_LIMIT = 64 * 1024 * 1024
    const RELATION_FALLBACK = { count: 12, name: 24, text: 24 }
    const RELATION_KEYS = ['name', 'relation']
    const OWNER_GENDERS_FALLBACK = ['女', '男', '未说']

    const getJson = async (url) => {
      const res = await fetch(url, { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(await readError(res))
      return res.json()
    }
    const postJson = async (url, body) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      })
      if (!res.ok) throw new Error(await readError(res))
      return res.json()
    }
    const readError = async (res) => {
      try {
        const data = await res.json()
        if (data && typeof data.error === 'string' && data.error !== '') return data.error
      } catch {}
      return 'HTTP ' + res.status
    }

    const when = (ts) => (Number.isFinite(ts) && ts > 0 ? new Date(ts).toLocaleString() : '—')
    const num = (value) => (Number.isFinite(value) ? Math.round(value * 100) / 100 : 0)
    const yen = (value) => '¥' + (Number.isFinite(value) ? Number(value).toFixed(2) : '0.00')
    const fileSize = (value) => {
      const bytes = Number.isFinite(value) && value > 0 ? value : 0
      if (bytes < 1024) return `${Math.round(bytes)} B`
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    }
    const yesNo = (value) => (value === true ? '开' : '关')
    const list = (value) => (Array.isArray(value) ? value : [])
    const INNER_DRIVES = [
      ['stability', '安稳'],
      ['curiosity', '求知'],
      ['expression', '表达'],
      ['recognition', '被看见'],
      ['comfort', '舒适'],
      ['intimacy', '亲密'],
    ]

    const CSS = `
[data-fishm-wrap]{display:flex;flex-direction:column;gap:16px;padding:4px 2px 32px;}
[data-fishm-hero]{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;padding:14px 16px;border-radius:12px;background:rgba(127,127,127,.08);}
[data-fishm-name]{font-size:22px;font-weight:600;line-height:1.2;}
[data-fishm-sub]{font-size:12px;opacity:.68;margin-top:4px;}
[data-fishm-phase]{font-size:12px;opacity:.8;max-width:420px;text-align:right;}
[data-fishm-sec]{display:flex;flex-direction:column;gap:8px;padding-top:12px;border-top:1px solid rgba(127,127,127,.18);}
[data-fishm-h]{font-size:13px;font-weight:600;opacity:.88;}
[data-fishm-note]{font-size:12px;opacity:.62;line-height:1.55;}
[data-fishm-row]{display:flex;gap:10px;align-items:baseline;font-size:13px;line-height:1.6;flex-wrap:wrap;}
[data-fishm-k]{opacity:.62;min-width:92px;flex:0 0 auto;}
[data-fishm-v]{flex:1;min-width:140px;}
[data-fishm-grid]{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;}
[data-fishm-card]{padding:10px 12px;border-radius:9px;background:rgba(127,127,127,.07);display:flex;flex-direction:column;gap:5px;}
[data-fishm-cardtitle]{font-size:13px;font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
[data-fishm-field]{display:flex;flex-direction:column;gap:4px;}
[data-fishm-check]{display:flex;gap:8px;align-items:center;font-size:13px;line-height:1.5;}
[data-fishm-flabel]{font-size:12px;opacity:.72;}
[data-fishm-input]{padding:6px 9px;border-radius:7px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;font-size:13px;width:100%;box-sizing:border-box;}
select[data-fishm-input]{appearance:auto;cursor:pointer;}
select[data-fishm-input]>option{background:var(--dsw-alias-bg-layer-1,#1e1e1e);color:var(--dsw-alias-label-primary,inherit);}
[data-fishm-area]{min-height:58px;resize:vertical;font-family:inherit;line-height:1.5;}
[data-fishm-persona]{min-height:320px;resize:vertical;font-family:inherit;line-height:1.7;white-space:pre-wrap;}
[data-fishm-relrow]{display:flex;gap:8px;align-items:center;}
[data-fishm-relrow]>[data-fishm-input]{flex:1;min-width:0;}
[data-fishm-relrow]>[data-fishm-input]:first-child{max-width:180px;}
[data-fishm-relrow]>[data-fishm-btn]{flex:0 0 auto;}
[data-fishm-actions]{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}
[data-fishm-btn]{padding:6px 12px;border-radius:7px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;font-size:13px;cursor:pointer;}
[data-fishm-btn]:hover{background:rgba(127,127,127,.12);}
[data-fishm-btn][disabled]{opacity:.45;cursor:default;}
[data-fishm-btn][data-primary]{border-color:rgba(80,150,255,.65);}
[data-fishm-chip]{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;line-height:1.6;background:rgba(127,127,127,.14);opacity:.9;}
[data-fishm-chip="on"]{background:rgba(80,170,120,.18);}
[data-fishm-chip="off"]{background:rgba(127,127,127,.12);opacity:.6;}
[data-fishm-chip="warn"]{background:rgba(220,160,60,.2);}
[data-fishm-list]{display:flex;flex-direction:column;gap:4px;}
[data-fishm-item]{font-size:12px;line-height:1.6;padding:6px 9px;border-radius:7px;background:rgba(127,127,127,.06);}
[data-fishm-meta]{font-size:11px;opacity:.55;margin-bottom:2px;}
[data-fishm-tree]{display:flex;flex-direction:column;gap:5px;}
[data-fishm-branch]{display:flex;flex-direction:column;gap:5px;}
[data-fishm-branchchildren]{display:flex;flex-direction:column;gap:5px;margin-left:10px;padding-left:9px;border-left:1px solid rgba(127,127,127,.2);}
[data-fishm-msg]{font-size:12px;opacity:.82;min-height:16px;line-height:1.6;}
[data-fishm-msg][data-kind="error"]{color:#d4685f;opacity:1;}
[data-fishm-banner]{font-size:12px;line-height:1.6;padding:9px 12px;border-radius:8px;background:rgba(220,160,60,.15);}
[data-fishm-pending]{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;}
[data-fishm-details]{display:flex;flex-direction:column;gap:8px;}
[data-fishm-details>summary]{cursor:pointer;font-size:13px;font-weight:600;opacity:.88;}
[data-fishm-prompt]{font-family:inherit;white-space:pre-wrap;font-size:12px;line-height:1.65;padding:10px 12px;border-radius:8px;background:rgba(127,127,127,.06);margin:0;}
[data-fishm-bars]{display:flex;flex-direction:column;gap:5px;}
[data-fishm-bar]{display:flex;align-items:center;gap:8px;font-size:12px;}
[data-fishm-barlabel]{width:44px;flex:0 0 44px;opacity:.7;}
[data-fishm-track]{flex:1;height:6px;border-radius:999px;background:rgba(127,127,127,.16);overflow:hidden;}
[data-fishm-fill]{height:100%;border-radius:999px;background:rgba(80,150,255,.55);}
[data-fishm-barval]{width:30px;text-align:right;opacity:.7;}
[data-fishwd-mask]{position:fixed;inset:0;z-index:9000;background:var(--dsw-alias-bg-mask-3,rgba(0,0,0,.45));backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:24px;}
[data-fishwd-card]{background:var(--dsw-alias-bg-base,#1e1e1e);border:1px solid var(--dsw-alias-border-l3,rgba(127,127,127,.2));border-radius:14px;max-width:540px;width:100%;max-height:80vh;display:flex;flex-direction:column;box-shadow:var(--dsw-elevation-prominent,0 12px 40px rgba(0,0,0,.35));}
[data-fishwd-head]{padding:20px 22px 14px;display:flex;align-items:center;justify-content:space-between;}
[data-fishwd-title]{font-size:18px;font-weight:600;}
[data-fishwd-body]{padding:0 22px 18px;overflow-y:auto;display:flex;flex-direction:column;gap:14px;min-height:0;}
[data-fishwd-intro]{font-size:13px;line-height:1.7;opacity:.85;flex:none;}
[data-fishwd-sec]{border:1px solid rgba(127,127,127,.15);border-radius:9px;overflow:hidden;flex:none;}
[data-fishwd-secsum]{padding:10px 13px;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:8px;background:rgba(127,127,127,.05);user-select:none;}
[data-fishwd-secsum]:hover{background:rgba(127,127,127,.1);}
[data-fishwd-secarr]{font-size:10px;opacity:.5;transition:transform .15s;}
[data-fishwd-secarr="open"]{transform:rotate(90deg);}
[data-fishwd-secbody]{padding:10px 13px;font-size:12px;line-height:1.7;opacity:.82;border-top:1px solid rgba(127,127,127,.1);}
[data-fishwd-secbody ul]{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px;}
[data-fishwd-foot]{padding:12px 22px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid rgba(127,127,127,.12);}
[data-fishwd-dnr]{display:flex;align-items:center;gap:7px;font-size:12px;opacity:.7;cursor:pointer;user-select:none;}
[data-fishwd-dnr] input{accent-color:#5096ff;}
[data-fishwd-ok]{padding:7px 18px;border-radius:8px;border:none;background:rgba(80,150,255,.8);color:#fff;font-size:13px;cursor:pointer;font-weight:500;}
[data-fishwd-ok]:hover{background:rgba(80,150,255,.95);}
[data-fishap-wrap]{display:flex;flex-direction:column;gap:14px;padding:4px 2px 32px;}
[data-fishap-hero]{display:flex;align-items:center;gap:14px;padding:14px 16px;border-radius:12px;background:rgba(127,127,127,.08);}
[data-fishap-icon]{font-size:32px;line-height:1;}
[data-fishap-name]{font-size:18px;font-weight:600;}
[data-fishap-sub]{font-size:12px;opacity:.6;margin-top:4px;line-height:1.5;}
[data-fishmw-wrap]{display:flex;flex-direction:column;gap:14px;padding:4px 2px 32px;}
[data-fishmw-hero]{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:14px 16px;border-radius:12px;background:rgba(127,127,127,.08);}
[data-fishmw-name]{font-size:18px;font-weight:600;}
[data-fishmw-sub]{font-size:12px;opacity:.62;margin-top:4px;line-height:1.55;max-width:620px;}
[data-fishmw-stats]{display:flex;gap:6px;flex-wrap:wrap;align-items:center;}
[data-fishmw-search]{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
[data-fishmw-search]>[data-fishm-input]{flex:1;min-width:220px;}
[data-fishmw-filters]{display:flex;gap:6px;flex-wrap:wrap;align-items:center;}
[data-fishmw-filter]{padding:4px 11px;border-radius:999px;border:1px solid rgba(127,127,127,.28);background:transparent;color:inherit;font-size:12px;cursor:pointer;line-height:1.6;}
[data-fishmw-filter]:hover{background:rgba(127,127,127,.12);}
[data-fishmw-filter][data-on]{border-color:rgba(80,150,255,.65);background:rgba(80,150,255,.14);}
[data-fishmw-toggles]{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px;}
[data-fishmw-toggle]{display:flex;gap:9px;align-items:flex-start;padding:9px 11px;border-radius:9px;background:rgba(127,127,127,.06);font-size:12px;line-height:1.55;cursor:pointer;}
[data-fishmw-toggle] input{margin-top:2px;accent-color:#5096ff;flex:0 0 auto;}
[data-fishmw-toggle][data-off]{opacity:.5;cursor:default;}
[data-fishmw-toggletitle]{display:block;font-weight:600;font-size:13px;}
[data-fishmw-togglenote]{font-size:11px;opacity:.62;display:block;margin-top:2px;}
[data-fishmw-list]{display:flex;flex-direction:column;gap:7px;}
[data-fishmw-row]{padding:10px 12px;border-radius:9px;background:rgba(127,127,127,.06);display:flex;flex-direction:column;gap:6px;}
[data-fishmw-rowhead]{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
[data-fishmw-rowtitle]{font-size:14px;font-weight:600;}
[data-fishmw-rowactions]{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto;}
[data-fishmw-rowactions [data-fishm-btn]{padding:3px 9px;font-size:12px;}
[data-fishmw-snippet]{font-size:12px;line-height:1.6;opacity:.82;white-space:pre-wrap;word-break:break-word;}
[data-fishmw-tags]{font-size:11px;opacity:.6;line-height:1.5;}
[data-fishmw-confirm{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px;padding:7px 9px;border-radius:7px;background:rgba(220,120,80,.13);}
[data-fishmw-pager]{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px;opacity:.85;}
[data-fishmw-form]{display:flex;flex-direction:column;gap:9px;padding:12px 14px;border-radius:10px;border:1px solid rgba(127,127,127,.22);}
[data-fishmw-formgrid]{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:9px;}
[data-fishmw-count]{font-size:12px;opacity:.65;}
[data-fishmw-attrib]{font-size:11px;line-height:1.7;opacity:.55;padding-top:10px;border-top:1px solid rgba(127,127,127,.16);}
[data-fishmw-attrib] a{color:inherit;}
`

    function Section({ title, note, children }) {
      return h('div', { 'data-fishm-sec': '' },
        h('div', { 'data-fishm-h': '' }, title),
        note ? h('div', { 'data-fishm-note': '' }, note) : null,
        children)
    }

    function Row({ label, value }) {
      return h('div', { 'data-fishm-row': '' },
        h('span', { 'data-fishm-k': '' }, label),
        h('span', { 'data-fishm-v': '' }, value))
    }

    function Field({ label, hint, value, onChange, maxLength, area }) {
      const common = {
        'data-fishm-input': '',
        value: value || '',
        maxLength,
        onChange: (event) => onChange(event.target.value),
      }
      return h('label', { 'data-fishm-field': '' },
        h('span', { 'data-fishm-flabel': '' }, label),
        area
          ? h('textarea', { ...common, 'data-fishm-area': '', rows: label === '外形' ? 3 : 2 })
          : h('input', { ...common, type: 'text' }),
        hint ? h('span', { 'data-fishm-note': '' }, hint) : null)
    }

    function PersonCard({ person }) {
      return h('div', { 'data-fishm-card': '' },
        h('div', { 'data-fishm-cardtitle': '' },
          person.name,
          person.isOwner ? h('span', { 'data-fishm-chip': 'on' }, '主人') : null,
          h('span', { 'data-fishm-chip': '' }, '熟 ' + num(person.familiar)),
          h('span', { 'data-fishm-chip': '' }, '暖 ' + num(person.warmth)),
          h('span', { 'data-fishm-chip': '' }, '张力 ' + num(person.tension)),
          h('span', { 'data-fishm-chip': '' }, '见过 ' + num(person.met))),
        person.aliases.length > 0 ? h('div', { 'data-fishm-note': '' }, '别名：' + person.aliases.join('、')) : null,
        person.facts.length > 0 ? h('div', { 'data-fishm-note': '' }, '记得：' + person.facts.join('；')) : null,
        person.boundaries.length > 0 ? h('div', { 'data-fishm-note': '' }, '边界：' + person.boundaries.join('；')) : null,
        person.memories.length > 0 ? h('div', { 'data-fishm-note': '' }, '相处：' + person.memories.join('；')) : null,
        person.rooms.length > 0
          ? h('div', { 'data-fishm-row': '' }, person.rooms.map((room, index) => h('span', {
              'data-fishm-chip': '',
              key: index,
            }, `${room.kind} · 熟 ${num(room.familiar)} · 互动 ${num(room.interactions)}`)))
          : null,
        h('div', { 'data-fishm-meta': '' }, '最近 ' + when(person.lastAt)))
    }

    function ChapterBranch({ node }) {
      const children = list(node && node.children)
      const level = node && node.level === 'month' ? '月' : node && node.level === 'week' ? '周' : '日'
      const displaySummary = (node && node.abstractiveSummary) || (node && node.summary)
      return h('div', { 'data-fishm-branch': '' },
        h('div', { 'data-fishm-item': '' },
          h('div', { 'data-fishm-meta': '' }, `${level} · ${when(node && node.at)} · ${num(node && node.episodeCount)} 段`),
          h('div', {}, (node && node.title) || '—'),
          displaySummary ? h('div', { 'data-fishm-note': '' }, displaySummary) : null),
        children.length > 0
          ? h('div', { 'data-fishm-branchchildren': '' }, children.map((child, index) => h(ChapterBranch, {
              node: child,
              key: index,
            })))
          : null)
    }

    function Panel({ close, openDevSession }) {
      const [data, setData] = React.useState(null)
      const [form, setForm] = React.useState(null)
      const [persona, setPersona] = React.useState(null)
      const [busy, setBusy] = React.useState('')
      const [msg, setMsg] = React.useState('')
      const [msgKind, setMsgKind] = React.useState('')
      const [grantDraft, setGrantDraft] = React.useState(null)
      const [grantBusy, setGrantBusy] = React.useState(false)
      const [phraseForm, setPhraseForm] = React.useState(null)
      const [phraseBusy, setPhraseBusy] = React.useState(false)
      const [backupForm, setBackupForm] = React.useState(null)
      const [backupBusy, setBackupBusy] = React.useState('')
      const [devBusy, setDevBusy] = React.useState(false)
      const [ttsPanelBusy, setTtsPanelBusy] = React.useState(false)
      const [restartPrompt, setRestartPrompt] = React.useState(null)
      const fileRef = React.useRef(null)
      const canRestart = typeof window !== 'undefined' && !!window.dshDesktop
        && typeof window.dshDesktop.restart === 'function'

      const flash = (text, kind) => {
        setMsg(text)
        setMsgKind(kind || '')
        if (kind !== 'error') setTimeout(() => setMsg(''), 4000)
      }

      const restartNow = async () => {
        if (!canRestart || busy === 'restart') return
        setBusy('restart')
        try {
          await window.dshDesktop.restart()
        } catch (error) {
          setBusy('')
          flash('没重启成功：' + String((error && error.message) || error), 'error')
        }
      }

      const load = React.useCallback(async () => {
        try {
          const next = await getJson(API + '/overview')
          setData(next)
          setForm((current) => (current === null && next && next.identity
            ? {
                name: next.identity.name,
                species: next.identity.species,
                appearance: next.identity.appearance,
                ownerAddress: next.identity.ownerAddress,
                ownerGender: next.identity.ownerGender || OWNER_GENDERS_FALLBACK[2],
                origin: next.identity.origin,
                style: next.identity.style,
                relations: list(next.identity.relations).map((item) => ({
                  name: (item && item.name) || '',
                  relation: (item && item.relation) || '',
                })),
              }
            : current))
          setPhraseForm((current) => (current === null && next && next.phrases
            ? {
                privateDodge: next.phrases.privateDodge || '',
                budgetBlock: next.phrases.budgetBlock || '',
              }
            : current))
          setBackupForm((current) => (current === null && next && next.backup
            ? {
                enabled: next.backup.enabled === true,
                intervalHours: String(next.backup.intervalHours || 24),
              }
            : current))
        } catch (error) {
          flash('读取失败：' + String((error && error.message) || error), 'error')
        }
      }, [])

      const loadPersona = React.useCallback(async () => {
        try {
          const next = await getJson(API + '/persona')
          setPersona({ ...next, available: true })
        } catch (error) {
          setPersona({ available: false, error: String((error && error.message) || error) })
        }
      }, [])

      // 右下角卡片被 ✕ 关掉以后，这里是它唯一的再显示入口
      const showTtsPanel = async () => {
        if (ttsPanelBusy) return
        setTtsPanelBusy(true)
        try {
          await postJson('/dsh-tts-bridge/panel', { open: true })
          await load()
          flash('右下角卡片已重新显示')
        } catch (error) {
          flash('没打开成功：' + String((error && error.message) || error), 'error')
        } finally {
          setTtsPanelBusy(false)
        }
      }

      const toggleDeveloper = async (next) => {
        if (devBusy) return
        setDevBusy(true)
        try {
          await postJson(API + '/developer', { enabled: next === true })
          await load()
          flash(next === true ? '开发者模式已打开：她现在可以只读查看 DSH 目录' : '开发者模式已关闭')
        } catch (error) {
          flash('没改成：' + String((error && error.message) || error), 'error')
        } finally {
          setDevBusy(false)
        }
      }

      // 创造模式会话由宿主组合：新开一个空白会话，预设换成 cordis，鱼的人设和记忆照常跟着。
      const startDevSession = () => {
        let opened = false
        try {
          opened = typeof openDevSession === 'function' && openDevSession() === true
        } catch (error) {
          flash('建会话没成功：' + String((error && error.message) || error), 'error')
          return
        }
        if (!opened) {
          flash('这个宿主没有打开会话的入口，没法新建创造模式会话', 'error')
          return
        }
        if (typeof close === 'function') close()
      }

      React.useEffect(() => {
        load()
        loadPersona()
        const timer = setInterval(() => { void load() }, 30000)
        return () => clearInterval(timer)
      }, [load, loadPersona])

      const patch = (key, value) => setForm((current) => ({ ...(current || {}), [key]: value }))

      const patchRelation = (index, key, value) => setForm((current) => {
        const rows = list(current && current.relations)
        if (!RELATION_KEYS.includes(key)) return current
        return {
          ...(current || {}),
          relations: rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
        }
      })

      const addRelation = () => setForm((current) => {
        const rows = list(current && current.relations)
        const max = Number(data && data.identity && data.identity.limits && data.identity.limits.relations) || RELATION_FALLBACK.count
        if (rows.length >= max) return current
        return { ...(current || {}), relations: [...rows, { name: '', relation: '' }] }
      })

      const removeRelation = (index) => setForm((current) => ({
        ...(current || {}),
        relations: list(current && current.relations).filter((_, i) => i !== index),
      }))

      const saveBirth = async () => {
        setBusy('birth')
        const relations = list(form && form.relations)
          .map((row) => ({
            name: String((row && row.name) || '').trim(),
            relation: String((row && row.relation) || '').trim(),
          }))
        if (relations.some((row) => (row.name === '') !== (row.relation === ''))) {
          flash('群友关系每一行都要填名字和关系；没填完就先删掉那一行', 'error')
          setBusy('')
          return
        }
        try {
          const result = await postJson(API + '/birth', {
            ...form,
            relations: relations.filter((row) => row.name !== ''),
          })
          if (result && result.identity) {
            const identity = result.identity
            setForm({
              name: identity.name,
              species: identity.species,
              appearance: identity.appearance,
              ownerAddress: identity.ownerAddress,
              ownerGender: identity.ownerGender || OWNER_GENDERS_FALLBACK[2],
              origin: identity.origin,
              style: identity.style,
              relations: list(identity.relations).map((item) => ({
                name: (item && item.name) || '',
                relation: (item && item.relation) || '',
              })),
            })
          }
          await load()
          flash('出生设定已保存，新的一轮就会按新设定说话')
        } catch (error) {
          flash('保存失败：' + String((error && error.message) || error), 'error')
        }
        setBusy('')
      }

      const resetBirth = async () => {
        if (!window.confirm('把出生设定恢复成出厂的大肥鱼？记忆、心情和人物志不受影响。')) return
        setBusy('reset')
        try {
          await postJson(API + '/birth/reset', {})
          setForm(null)
          await load()
          flash('已恢复出厂出生设定')
        } catch (error) {
          flash('重置失败：' + String((error && error.message) || error), 'error')
        }
        setBusy('')
      }

      const savePersona = async () => {
        if (!persona || persona.available !== true) return
        setBusy('persona')
        try {
          const result = await postJson(API + '/persona', { persona: persona.persona })
          setPersona({ ...result, available: true })
          flash('性格人设已保存，下一轮就会按新的人设说话')
        } catch (error) {
          flash('保存失败：' + String((error && error.message) || error), 'error')
        }
        setBusy('')
      }

      const resetPersona = async () => {
        if (!window.confirm('把性格人设恢复成出厂版本？名字、外形和其他出生设定不受影响。')) return
        setBusy('persona-reset')
        try {
          const result = await postJson(API + '/persona/reset', {})
          setPersona({ ...result, available: true })
          flash('已恢复出厂人设')
        } catch (error) {
          flash('重置失败：' + String((error && error.message) || error), 'error')
        }
        setBusy('')
      }

      const saveGrant = async () => {
        const value = Number(grantDraft)
        if (grantDraft === null || String(grantDraft).trim() === '' || !Number.isFinite(value) || value < 0) {
          flash('每天额度要填一个不小于 0 的数字（单位：元）', 'error')
          return
        }
        setGrantBusy(true)
        try {
          const result = await postJson(API + '/budget', { dailyGrantCny: value })
          const current = result && Number.isFinite(result.dailyGrantCny) ? result.dailyGrantCny : value
          setGrantDraft(null)
          await load()
          flash(result && result.changed === false
            ? `每日额度还是 ${yen(current)}`
            : `每日额度已改成 ${yen(current)}，余额已按差额调整`)
        } catch (error) {
          flash('保存失败：' + String((error && error.message) || error), 'error')
        }
        setGrantBusy(false)
      }

      const savePhrases = async (values) => {
        if (phraseBusy) return
        const privateDodge = String((values && values.privateDodge) || '').replace(/\s+/g, ' ').trim()
        const budgetBlock = String((values && values.budgetBlock) || '').replace(/\s+/g, ' ').trim()
        if (privateDodge === '') {
          flash('私事兜底那句话不能为空', 'error')
          return
        }
        if (budgetBlock === '') {
          flash('额度兜底那句话不能为空', 'error')
          return
        }
        setPhraseBusy(true)
        try {
          const result = await postJson(API + '/phrases', { privateDodge, budgetBlock })
          const saved = (result && result.phrases) || { privateDodge, budgetBlock }
          setPhraseForm({ privateDodge: saved.privateDodge, budgetBlock: saved.budgetBlock })
          await load()
          flash('自定义话术已保存，下一轮就按你写的说')
        } catch (error) {
          flash('保存失败：' + String((error && error.message) || error), 'error')
        }
        setPhraseBusy(false)
      }

      const resetPhrases = async () => {
        if (phraseBusy) return
        if (!window.confirm('把这两句话恢复成出厂版本？')) return
        const defaults = data.phraseDefaults || {}
        await savePhrases({
          privateDodge: defaults.privateDodge || '',
          budgetBlock: defaults.budgetBlock || '',
        })
      }

      const patchBackup = (key, value) => setBackupForm((current) => ({ ...(current || {}), [key]: value }))

      const saveBackupSettings = async () => {
        if (backupBusy || backupForm === null) return
        const hours = Number(backupForm.intervalHours)
        if (!Number.isInteger(hours) || hours < 1 || hours > 720) {
          flash('备份间隔要填 1 到 720 之间的整数小时', 'error')
          return
        }
        setBackupBusy('save')
        try {
          const result = await postJson(API + '/backup/config', {
            enabled: backupForm.enabled === true,
            intervalHours: hours,
          })
          const saved = result && result.backup
          if (saved) {
            setBackupForm({ enabled: saved.enabled === true, intervalHours: String(saved.intervalHours) })
          }
          await load()
          const run = result && result.run
          flash(run && run.ok
            ? `自动备份已保存，刚写了一份 ${run.fileName}`
            : '自动备份设置已保存')
        } catch (error) {
          flash('保存失败：' + String((error && error.message) || error), 'error')
        }
        setBackupBusy('')
      }

      const backupNow = async () => {
        if (backupBusy) return
        setBackupBusy('now')
        try {
          const result = await postJson(API + '/backup/now', {})
          const run = result && result.run
          await load()
          flash(run && run.counts
            ? `已备份 ${run.fileName}：经历 ${num(run.counts.experiences)} 条、事实 ${num(run.counts.facts)} 条`
            : '已备份')
        } catch (error) {
          flash('没备份成功：' + String((error && error.message) || error), 'error')
        }
        setBackupBusy('')
      }

      const exportFish = async () => {
        setBusy('export')
        try {
          const res = await fetch(API + '/export', { headers: { accept: 'application/octet-stream' } })
          if (!res.ok) throw new Error(await readError(res))
          const blob = await res.blob()
          const disposition = res.headers.get('content-disposition') || ''
          const match = /filename="([^"]+)"/.exec(disposition)
          const name = match ? match[1] : 'mydearfish.zip'
          let counts = null
          try {
            counts = JSON.parse(res.headers.get('x-fish-counts') || 'null')
          } catch {}
          const url = URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = url
          link.download = name
          link.click()
          setTimeout(() => URL.revokeObjectURL(url), 5000)
          flash(counts
            ? `已导出 ${name}：经历 ${counts.experiences} 条、事实 ${counts.facts} 条、心情 ${counts.moodPoints} 条、人物 ${counts.people} 位`
            : `已导出 ${name}`)
        } catch (error) {
          flash('导出失败：' + String((error && error.message) || error), 'error')
        }
        setBusy('')
      }

      const importFish = async (event) => {
        const file = event.target.files && event.target.files[0]
        event.target.value = ''
        if (!file) return
        if (file.size > IMPORT_LIMIT) {
          flash('这个文件超过 64 MB，不是正常的大肥鱼记忆包', 'error')
          return
        }
        if (!window.confirm(`导入「${file.name}」会替换这条鱼的全部记忆、心情和人物志，只允许导入到空鱼。继续？`)) return
        setBusy('import')
        try {
          const buffer = await file.arrayBuffer()
          const res = await fetch(API + '/import', {
            method: 'POST',
            headers: { 'content-type': 'application/zip' },
            body: buffer,
          })
          if (!res.ok) throw new Error(await readError(res))
          const result = await res.json()
          const counts = result && result.counts ? result.counts : null
          flash('导入包已收下。')
          setRestartPrompt({ counts })
          await load()
        } catch (error) {
          flash('没导入：' + String((error && error.message) || error), 'error')
        }
        setBusy('')
      }

      if (data === null || form === null) {
        return h('div', { 'data-fishm-wrap': '' },
          h('div', { 'data-fishm-note': '' }, msg || '正在读她现在的样子…'))
      }

      const identity = data.identity || {}
      const limits = identity.limits || {}
      const genders = list(identity.genders).length > 0 ? list(identity.genders) : OWNER_GENDERS_FALLBACK
      const relationLimit = Number(limits.relations) || RELATION_FALLBACK.count
      const relationNameLimit = Number(limits.relationName) || RELATION_FALLBACK.name
      const relationTextLimit = Number(limits.relationText) || RELATION_FALLBACK.text
      const memory = data.memory || {}
      const mood = data.mood || {}
      const inner = data.inner || {}
      const social = data.social || {}
      const channels = data.channels || {}
      const wallet = data.wallet || {}
      const biliQuota = wallet.bili || {}
      const backup = data.backup || {}
      const boundaries = data.boundaries || {}
      const permissions = boundaries.permissions || {}
      const privacy = boundaries.privacy || {}
      const injection = boundaries.injection || {}
      const hard = permissions.hard || {}
      const archive = data.archive || {}

      const emptyFish = num(memory.total) === 0
        && num(social.count) === 0
        && (!mood.available || list(mood.timeline).length === 0)
      const pending = archive.pending === true
      const report = archive.report

      const hardLabels = {
        dshHome: 'DSH 目录',
        credentialStores: '凭据目录',
        identityFiles: '身份文件',
        machineProbes: '本机探测',
        dangerousCommands: '危险命令',
        credentialArguments: '夹带凭据的参数',
        externalMcpWrites: '外部 MCP 写入',
      }
      const hardText = Object.keys(hardLabels)
        .filter((key) => hard[key] !== undefined)
        .map((key) => {
          const value = hard[key]
          const state = typeof value === 'boolean' ? (value ? '硬拒绝' : '—') : `${num(value)} 处`
          return `${hardLabels[key]}：${state}`
        })

      return h('div', { 'data-fishm-wrap': '' },
        h('div', { 'data-fishm-hero': '' },
          h('div', {},
            h('div', { 'data-fishm-name': '' }, identity.name || '大肥鱼'),
            h('div', { 'data-fishm-sub': '' }, `${identity.species || '鲸鱼娘'} · 出生设定更新于 ${when(identity.updatedAt)}`)),
          h('div', { 'data-fishm-phase': '' }, data.phase || '')),

        h(Section, {
          title: '开发者模式',
          note: '给她一条只读的调试通道：在你自己的会话里查看 DSH 目录里的日志、配置和会话记录。凭据、身份文件、写入和群聊会话仍然拒绝；shell 只放行列目录、读文件这类只读命令，每次读取都记进审计。',
        },
          h('label', { 'data-fishm-check': '' },
            h('input', {
              type: 'checkbox',
              checked: permissions.developer === true,
              disabled: devBusy,
              onChange: () => toggleDeveloper(permissions.developer !== true),
            }),
            devBusy
              ? '正在切换…'
              : permissions.developer === true
                ? '已打开：她自己的前台会话可以只读查看 DSH 目录'
                : '关着：她读不了 DSH 目录'),
          h('div', { 'data-fishm-actions': '' },
            h('button', {
              'data-fishm-btn': '',
              'data-primary': '',
              type: 'button',
              onClick: startDevSession,
            }, '用创造模式开一个调试会话'),
            h('span', { 'data-fishm-note': '' },
              '新会话会换成创造模式，她的性格和记忆照常带着；排查完记得把开发者模式关掉。')),
          h('div', { 'data-fishm-note': '' },
            '创造模式自带的改代码、写文件能力来自宿主预设，不受这个开关限制；这个开关只管她能不能读 DSH 里的调试资料。')),

        h(Section, {
          title: '出生设定',
          note: '出生设定、性格人设和每日额度能改；记忆、心情、人物志、通道和安全边界只读。',
        },
          h('div', { 'data-fishm-grid': '' },
            h(Field, {
              label: '名字',
              value: form.name,
              maxLength: limits.name || 24,
              onChange: (value) => patch('name', value),
            }),
            h(Field, {
              label: '物种',
              value: form.species,
              maxLength: limits.species || 40,
              onChange: (value) => patch('species', value),
            }),
            h(Field, {
              label: '对主人的称呼',
              value: form.ownerAddress,
              maxLength: limits.ownerAddress || 24,
              onChange: (value) => patch('ownerAddress', value),
            }),
            h('label', { 'data-fishm-field': '' },
              h('span', { 'data-fishm-flabel': '' }, '主人的性别'),
              h('select', {
                'data-fishm-input': '',
                value: form.ownerGender || genders[2],
                onChange: (event) => patch('ownerGender', event.target.value),
              }, genders.map((value) => h('option', { key: value, value }, value))),
              h('span', { 'data-fishm-note': '' }, '她按这个决定提到你时用「他」还是「她」；选「未说」就不猜，直接叫你或用「TA」。改完下一轮生效。'))),
          h(Field, {
            label: '外形',
            hint: `最多 ${limits.appearance || 240} 字。她会在提示里把这个当作自己的固定形象。`,
            value: form.appearance,
            maxLength: limits.appearance || 240,
            area: true,
            onChange: (value) => patch('appearance', value),
          }),
          h(Field, {
            label: '来历',
            hint: '可以留空。写她从哪里来、为什么在这里。',
            value: form.origin,
            maxLength: limits.origin || 240,
            area: true,
            onChange: (value) => patch('origin', value),
          }),
          h(Field, {
            label: '说话习惯',
            hint: '可以留空。写你希望她怎么说话，比如句子短一点、少用感叹号。',
            value: form.style,
            maxLength: limits.style || 600,
            area: true,
            onChange: (value) => patch('style', value),
          }),
          h('div', { 'data-fishm-field': '' },
            h('span', { 'data-fishm-flabel': '' }, '群友关系'),
            h('span', { 'data-fishm-note': '' },
              `可以留空。自由写她怎么认人，比如「时光：妈妈」；她会按这些关系称呼和对待对方，QQ 群聊里也算。最多 ${relationLimit} 条。`),
            list(form.relations).map((row, index) => h('div', {
              'data-fishm-relrow': '',
              key: index,
            },
              h('input', {
                'data-fishm-input': '',
                type: 'text',
                value: (row && row.name) || '',
                maxLength: relationNameLimit,
                placeholder: '名字或称呼',
                'aria-label': '名字或称呼',
                onChange: (event) => patchRelation(index, 'name', event.target.value),
              }),
              h('input', {
                'data-fishm-input': '',
                type: 'text',
                value: (row && row.relation) || '',
                maxLength: relationTextLimit,
                placeholder: '关系，比如妈妈',
                'aria-label': '关系',
                onChange: (event) => patchRelation(index, 'relation', event.target.value),
              }),
              h('button', {
                'data-fishm-btn': '',
                type: 'button',
                disabled: busy !== '',
                onClick: () => removeRelation(index),
              }, '删除'))),
            h('div', { 'data-fishm-actions': '' },
              h('button', {
                'data-fishm-btn': '',
                type: 'button',
                disabled: busy !== '' || list(form.relations).length >= relationLimit,
                onClick: addRelation,
              }, '+ 添加一条'),
              h('span', { 'data-fishm-note': '' },
                `${list(form.relations).length} / ${relationLimit} 条`))),
          h('div', { 'data-fishm-actions': '' },
            h('button', {
              'data-fishm-btn': '',
              'data-primary': '',
              disabled: busy !== '',
              onClick: saveBirth,
            }, busy === 'birth' ? '保存中…' : '保存出生设定'),
            h('button', {
              'data-fishm-btn': '',
              disabled: busy !== '',
              onClick: resetBirth,
            }, busy === 'reset' ? '恢复中…' : '恢复出厂'))),

        h(Section, {
          title: '性格人设',
          note: '整段替换部署层的出厂人设，保存后下一轮生效。名字、外形和记忆不在这里；安全、隐私、额度和权限规则仍由代码固定。',
        },
          persona === null
            ? h('div', { 'data-fishm-note': '' }, '正在读人设…')
            : persona.available !== true
              ? h('div', { 'data-fishm-banner': '' }, `现在改不了人设：${persona.error || '宿主没有配置编辑服务'}`)
              : h('div', { 'data-fishm-field': '' },
                  h('div', { 'data-fishm-actions': '' },
                    h('span', { 'data-fishm-chip': persona.overridden ? 'warn' : 'on' },
                      persona.overridden ? '自定义' : '出厂'),
                    h('span', { 'data-fishm-note': '' },
                      `${(persona.persona || '').length} / ${persona.maxLength || 12000} 字`)),
                  h('textarea', {
                    'data-fishm-input': '',
                    'data-fishm-area': '',
                    'data-fishm-persona': '',
                    rows: 18,
                    value: persona.persona || '',
                    maxLength: persona.maxLength || 12000,
                    onChange: (event) => setPersona((current) => ({
                      ...(current || {}),
                      persona: event.target.value,
                    })),
                  }),
                  h('div', { 'data-fishm-note': '' },
                    '这是整段人设前缀，会替换出厂那份。不要写 {{变量}}；她要遵守的安全、隐私、额度和权限规则不在人设里，改不掉。'),
                  h('div', { 'data-fishm-actions': '' },
                    h('button', {
                      'data-fishm-btn': '',
                      'data-primary': '',
                      disabled: busy !== '',
                      onClick: savePersona,
                    }, busy === 'persona' ? '保存中…' : '保存人设'),
                    h('button', {
                      'data-fishm-btn': '',
                      disabled: busy !== '',
                      onClick: resetPersona,
                    }, busy === 'persona-reset' ? '恢复中…' : '恢复出厂人设')))),

        h(Section, {
          title: '自定义话术',
          note: '这两句由你写；该带过、该停下来的时候她照旧，隐私、安全和额度规则不受影响。',
        },
          phraseForm === null
            ? h('div', { 'data-fishm-note': '' }, '正在读自定义话术…')
            : h('div', {},
                h(Field, {
                  label: '被问到私事细节时',
                  hint: '在 QQ 群 / 好友里被追问本机、账号、住址这类细节时，她用这句话带过去。默认「这个我不方便细说」。',
                  value: phraseForm.privateDodge,
                  maxLength: data.phraseLimit || 200,
                  onChange: (value) => setPhraseForm((current) => ({ ...(current || {}), privateDodge: value })),
                }),
                h(Field, {
                  label: '零花钱用完时',
                  hint: '账本拦住这一轮时，她不再发起模型请求，只在本地把这句话回给你。默认「今天我这边有点转不动了，先歇一会儿，明天再找你。」',
                  value: phraseForm.budgetBlock,
                  maxLength: data.phraseLimit || 200,
                  onChange: (value) => setPhraseForm((current) => ({ ...(current || {}), budgetBlock: value })),
                }),
                h('div', { 'data-fishm-actions': '' },
                  h('button', {
                    'data-fishm-btn': '',
                    'data-primary': '',
                    disabled: phraseBusy,
                    onClick: () => savePhrases(phraseForm),
                  }, phraseBusy ? '保存中…' : '保存话术'),
                  h('button', {
                    'data-fishm-btn': '',
                    disabled: phraseBusy,
                    onClick: resetPhrases,
                  }, '恢复默认')))),

        h(Section, {
          title: '记忆',
          note: '只读。经历流是唯一的写入路径，这里不提供“记住这条”。',
        },
          h('div', { 'data-fishm-grid': '' },
            h('div', { 'data-fishm-card': '' }, h('div', { 'data-fishm-cardtitle': '' }, '经历'), h('div', {}, `${num(memory.total)} 条`)),
            h('div', { 'data-fishm-card': '' }, h('div', { 'data-fishm-cardtitle': '' }, '情景'), h('div', {}, `${num(memory.episodes)} 段`)),
            h('div', { 'data-fishm-card': '' }, h('div', { 'data-fishm-cardtitle': '' }, '章节'), h('div', {}, `${num(memory.chapters)} 个`)),
            h('div', { 'data-fishm-card': '' }, h('div', { 'data-fishm-cardtitle': '' }, '关系'), h('div', {}, `${num(memory.relations)} 条`)),
            h('div', { 'data-fishm-card': '' }, h('div', { 'data-fishm-cardtitle': '' }, '长期事实'), h('div', {}, `${num(memory.facts)} 条`)),
            h('div', { 'data-fishm-card': '' }, h('div', { 'data-fishm-cardtitle': '' }, '今天'), h('div', {}, `${num(memory.today)} 条`)),
            h('div', { 'data-fishm-card': '' }, h('div', { 'data-fishm-cardtitle': '' }, '最近情景'), h('div', {}, when(memory.lastEpisodeAt)))),
          memory.degraded ? h('div', { 'data-fishm-banner': '' }, '检索库现在不可用，她靠经历流继续记住新的事，但旧记忆暂时搜不出来。') : null,
          h('div', { 'data-fishm-note': '' }, '最近经历'),
          list(memory.recent).length === 0
            ? h('div', { 'data-fishm-note': '' }, '还没有经历。')
            : h('div', { 'data-fishm-list': '' }, list(memory.recent).map((item, index) => h('div', {
                'data-fishm-item': '',
                key: index,
              },
                h('div', { 'data-fishm-meta': '' }, `${when(item.at)} · ${item.source || '本机'} · ${item.actor || item.role || ''}`),
                item.text))),
          h('div', { 'data-fishm-note': '' }, '最近事实'),
          list(memory.recentFacts).length === 0
            ? h('div', { 'data-fishm-note': '' }, '还没有提炼出长期事实。')
            : h('div', { 'data-fishm-list': '' }, list(memory.recentFacts).map((fact, index) => h('div', {
                'data-fishm-item': '',
                key: index,
              }, `${fact.subject} · ${fact.predicate} · ${fact.object}`))),
          h('details', { 'data-fishm-details': '' },
            h('summary', {}, `记忆章节${num(memory.chapters) > 0 ? ` · ${num(memory.chapters)} 个` : ' · 还没编好'}`),
            list(memory.chapterTree).length === 0
              ? h('div', { 'data-fishm-note': '' }, '还没有足够的经历编成日/周/月章节。')
              : h('div', { 'data-fishm-tree': '' }, list(memory.chapterTree).map((month, index) => h(ChapterBranch, {
                  node: month,
                  key: index,
                })))),
          h('details', { 'data-fishm-details': '' },
            h('summary', {}, `关系边${num(memory.relations) > 0 ? ` · ${num(memory.relations)} 条` : ' · 还没有'}`),
            list(memory.relationList).length === 0
              ? h('div', { 'data-fishm-note': '' }, '还没有从长期事实里连出关系。')
              : h('div', { 'data-fishm-list': '' }, list(memory.relationList).map((relation, index) => h('div', {
                  'data-fishm-item': '',
                  key: index,
                },
                  h('div', { 'data-fishm-meta': '' }, `可信 ${num(relation.confidence)} · 从 ${when(relation.validFrom)} 起`),
                  `${relation.src} · ${relation.relation} · ${relation.dst}`)))),
          h('details', { 'data-fishm-details': '' },
            h('summary', {}, '自我提示（只读）'),
            h('pre', { 'data-fishm-prompt': '' }, data.selfPrompt || ''))),

        h('details', { 'data-fishm-details': '' },
          h('summary', {}, `内心${inner.enabled ? ` · 倾述欲 ${Math.round(num(inner.strength) * 100)}%` : ' · 还没启动'}`),
          inner.enabled
            ? h('div', { 'data-fishm-sec': '' },
                h(Row, { label: '此刻', value: inner.affect && inner.affect.phrase ? `${inner.affect.phrase}${inner.affect.mood ? `（心情 ${num(inner.affect.mood)}）` : ''}` : '—' }),
                inner.cue
                  ? h(Row, { label: '心里挂着', value: inner.cue.text })
                  : h(Row, { label: '心里挂着', value: '这会儿没有特别想讲的事' }),
                h(Row, { label: '上次开口', value: inner.state && inner.state.lastSpokeAt ? when(inner.state.lastSpokeAt) : '还没记过' }),
                h('div', { 'data-fishm-bars': '' }, INNER_DRIVES.map(([key, label]) => h('div', {
                  'data-fishm-bar': '',
                  key,
                },
                  h('span', { 'data-fishm-barlabel': '' }, label),
                  h('span', { 'data-fishm-track': '' },
                    h('span', { 'data-fishm-fill': '', style: { width: `${Math.max(0, Math.min(100, num(inner.drives && inner.drives[key]) * 100))}%` } })),
                  h('span', { 'data-fishm-barval': '' }, `${Math.round(num(inner.drives && inner.drives[key]) * 100)}`)))),
                h('div', { 'data-fishm-note': '' }, '只读。数值是行为权重，不是需求条；群聊和好友会话不会拿到只属于主人的由头。'))
            : h('div', { 'data-fishm-note': '' }, '内心层会跟着心情经历和相处空档慢慢长出来。')),

        h('details', { 'data-fishm-details': '' },
          h('summary', {}, `心情${mood.available ? ` · ${mood.label || ''} ${num(mood.mood)}` : ' · 还没启动过'}`),
          mood.available
            ? h('div', { 'data-fishm-sec': '' },
                h(Row, { label: '现在', value: `${mood.label || ''} ${num(mood.mood)}` }),
                mood.lastReason ? h(Row, { label: '最近原因', value: mood.lastReason }) : null,
                h(Row, { label: '更新于', value: when(mood.updatedAt) }),
                h('div', { 'data-fishm-bars': '' }, list(mood.dims).map((dim) => h('div', {
                  'data-fishm-bar': '',
                  key: dim.key,
                },
                  h('span', { 'data-fishm-barlabel': '' }, dim.label),
                  h('span', { 'data-fishm-track': '' },
                    h('span', { 'data-fishm-fill': '', style: { width: `${Math.max(0, Math.min(100, num(dim.value)))}%` } })),
                  h('span', { 'data-fishm-barval': '' }, String(num(dim.value)))))),
                list(mood.timeline).length > 0
                  ? h('div', { 'data-fishm-list': '' }, list(mood.timeline).slice().reverse().map((point, index) => h('div', {
                      'data-fishm-item': '',
                      key: index,
                    },
                      h('div', { 'data-fishm-meta': '' }, `${when(point.at)} · ${num(point.mood)}（${point.delta > 0 ? '+' : ''}${num(point.delta)}）`),
                      point.reason || '—')))
                  : null)
            : h('div', { 'data-fishm-note': '' }, '心情插件没有留下状态；装好并聊过一轮后这里会出现。')),

        h('details', { 'data-fishm-details': '' },
          h('summary', {}, `人物志${social.available ? ` · ${num(social.count)} 位` : ' · 还没有'}`),
          social.available
            ? (list(social.people).length === 0
                ? h('div', { 'data-fishm-note': '' }, '人物志是空的。')
                : h('div', { 'data-fishm-grid': '' }, list(social.people).map((person, index) => h(PersonCard, {
                    person,
                    key: index,
                  }))))
            : h('div', { 'data-fishm-note': '' }, '还没有人物志；QQ 那边认过人之后，这里会出现名字和相处记录。')),

        h('details', { 'data-fishm-details': '' },
          h('summary', {}, '通道'),
          h('div', { 'data-fishm-grid': '' },
            h('div', { 'data-fishm-card': '' },
              h('div', { 'data-fishm-cardtitle': '' }, 'QQ', h('span', { 'data-fishm-chip': channels.qq && channels.qq.enabled ? 'on' : 'off' }, channels.qq && channels.qq.enabled ? '总开关开' : '总开关关')),
              channels.qq && channels.qq.available
                ? h('div', { 'data-fishm-note': '' }, `试运行 ${yesNo(channels.qq.trial)} · 私聊 ${channels.qq.privateReady ? '已配' : '未配'} · 群 ${channels.qq.groupsReady ? '已配' : '未配'} · 社交 ${channels.qq.socialEnabled ? '开' : '关'}${channels.qq.socialTrial ? '（试运行）' : ''}`)
                : h('div', { 'data-fishm-note': '' }, '没有配置')),
            h('div', { 'data-fishm-card': '' },
              h('div', { 'data-fishm-cardtitle': '' }, '主动搭话', h('span', { 'data-fishm-chip': channels.speakUp && channels.speakUp.enabled ? 'on' : 'off' }, channels.speakUp && channels.speakUp.enabled ? '开' : '关')),
              channels.speakUp && channels.speakUp.available
                ? h('div', { 'data-fishm-note': '' }, `试运行 ${yesNo(channels.speakUp.trial)} · 目标 ${num(channels.speakUp.targets)} 个会话`)
                : h('div', { 'data-fishm-note': '' }, '没有配置')),
            h('div', { 'data-fishm-card': '' },
              h('div', { 'data-fishm-cardtitle': '' }, '朗读',
                channels.tts && channels.tts.available
                  ? h('span', { 'data-fishm-chip': channels.tts.panelOpen ? 'on' : 'off' }, channels.tts.panelOpen ? '卡片开' : '卡片关')
                  : null),
              channels.tts && channels.tts.available
                ? h('div', { 'data-fishm-note': '' }, channels.tts.watchingAll ? '收听全部会话' : `收听 ${num(channels.tts.watching)} 个会话 · 收藏 ${num(channels.tts.favorites)} 条`)
                : h('div', { 'data-fishm-note': '' }, '没有配置'),
              channels.tts && channels.tts.available && channels.tts.panelOpen === false
                ? h('button', {
                    'data-fishm-btn': '',
                    disabled: ttsPanelBusy,
                    onClick: showTtsPanel,
                  }, ttsPanelBusy ? '正在打开…' : '重新显示右下角卡片')
                : null),
            h('div', { 'data-fishm-card': '' },
              h('div', { 'data-fishm-cardtitle': '' }, 'B 站'),
              channels.bili && channels.bili.available
                ? h('div', { 'data-fishm-note': '' }, `每天 ${num(channels.bili.perDay)} 次 · 错峰 ${yesNo(channels.bili.peakValley)} · 自动评论 ${yesNo(channels.bili.autoComment)} · 投递位置 ${channels.bili.targetReady ? '已配' : '未配'}`)
                : h('div', { 'data-fishm-note': '' }, '没有配置')))),

        h(Section, {
          title: '零花钱',
          note: '每日额度可以在这里改（单位：元）；其余只读；她对外说不了金额。',
        },
          wallet.available
            ? h('div', {},
                h('div', { 'data-fishm-field': '' },
                  h('span', { 'data-fishm-flabel': '' }, '每天额度（元）'),
                  h('input', {
                    'data-fishm-input': '',
                    type: 'number',
                    min: '0',
                    max: String(num(wallet.dailyGrantMaxCny) || 10000),
                    step: '0.01',
                    value: grantDraft !== null ? grantDraft : String(num(wallet.dailyGrantCny)),
                    disabled: grantBusy,
                    onChange: (event) => setGrantDraft(event.target.value),
                  }),
                  h('span', { 'data-fishm-note': '' }, '改完当场生效：差额会加进或扣回今天的余额，已经花掉的不追回；0 = 每天不再发新的额度。')),
                h('div', { 'data-fishm-actions': '' },
                  h('button', {
                    'data-fishm-btn': '',
                    'data-primary': '',
                    disabled: grantBusy || grantDraft === null || String(grantDraft).trim() === '',
                    onClick: saveGrant,
                  }, grantBusy ? '保存中…' : '保存每日额度')),
                h(Row, { label: '今天', value: `${yen(wallet.dailyGrantCny)} 额度 · 已花 ${yen(wallet.spentTodayCny)} · 还余 ${yen(wallet.availableCny)}` }),
                h(Row, { label: '调用', value: `${num(wallet.callsToday)} 次记账 · ${num(wallet.unmeteredToday)} 次未计价` }),
                h(Row, {
                  label: 'B 站巡检',
                  value: biliQuota.capCny > 0
                    ? `今天 ${yen(biliQuota.spentTodayCny)} / ${yen(biliQuota.capCny)}（每天额度的 ${num(biliQuota.share * 100)}%）`
                    : '不占额度（占比为 0）',
                }),
                h(Row, { label: '模型账户', value: wallet.accountKnown ? `上次读到于 ${when(wallet.accountReadAt)}` : '还没读到' }))
            : h('div', { 'data-fishm-note': '' }, '账本还没启动。')),

        h('details', { 'data-fishm-details': '' },
          h('summary', {}, '边界'),
          h('div', { 'data-fishm-sec': '' },
            h(Row, { label: '权限层', value: `${permissions.enabled ? '开' : '关'} · 急停 ${permissions.emergencyStop ? '已按下' : '未按'} · 后台会话 ${permissions.autonomous ? '放行' : '全拒'}` }),
            h(Row, { label: '开发者模式', value: permissions.developer ? '开 · 仅主人前台会话只读 DSH 目录' : '关' }),
            h(Row, { label: '受保护路径', value: `只读 ${num(permissions.protectedReadPaths)} 处 · 只写 ${num(permissions.protectedWritePaths)} 处 · 鱼脑封存 ${num(permissions.sealedPaths)} 处` }),
            h(Row, { label: '外部 MCP', value: `${num(permissions.mcpReadOnlyTools)} 类只读动作；其他默认拒绝` }),
            h(Row, { label: '硬拒绝', value: hardText.join(' · ') || '—' }),
            h(Row, { label: '隐私', value: `固定私密 ${num(privacy.exactFacts)} 项 · 学到 ${num(privacy.learnedSecrets)} 项 · 护栏 ${list(privacy.hardGuards).join('、') || '—'}` }),
            h(Row, { label: '注入防护', value: `外部结果已标记 ${num(injection.untrustedResults)} 次 · 可疑指令 ${num(injection.suspiciousResults)} 次` }),
            h('div', { 'data-fishm-note': '' }, '这些是代码里的固定规则，设置页只能看，不能改。'))),

        h(Section, {
          title: '搬迁',
          note: '导出的 zip 只含出生设定、记忆、长期事实、心情、人物志和短期水位；不含账号、凭据、配置路径或聊天记录之外的系统数据。',
        },
          pending
            ? h('div', { 'data-fishm-banner': '', 'data-fishm-pending': '' },
                h('span', {}, '有一个导入包已经收下，等重启 DSH 生效。重启前不要再次导入。'),
                canRestart
                  ? h('button', {
                      'data-fishm-btn': '',
                      disabled: busy !== '',
                      onClick: restartNow,
                    }, busy === 'restart' ? '正在重启…' : '立即重启')
                  : null)
            : null,
          report
            ? h('div', { 'data-fishm-item': '' },
                h('div', { 'data-fishm-meta': '' }, `上次导入 · ${when(report.at)} · ${report.ok ? '成功' : '失败'}`),
                report.ok
                  ? `经历 ${num(report.counts && report.counts.experiences)} 条 · 事实 ${num(report.counts && report.counts.facts)} 条 · 心情 ${num(report.counts && report.counts.moodPoints)} 条 · 人物 ${num(report.counts && report.counts.people)} 位${Number.isFinite(report.factsApplied) ? ` · 写回事实 ${num(report.factsApplied)} 条` : ''}`
                  : `卡在 ${report.stage || '未知步骤'}：${report.error || '没有留下原因'}`)
            : null,
          h('div', { 'data-fishm-actions': '' },
            h('button', {
              'data-fishm-btn': '',
              disabled: busy !== '' || pending,
              onClick: exportFish,
            }, busy === 'export' ? '打包中…' : '导出整条鱼（zip）'),
            h('input', {
              ref: fileRef,
              type: 'file',
              accept: '.zip,application/zip,application/x-zip-compressed',
              style: { display: 'none' },
              onChange: importFish,
            }),
            h('button', {
              'data-fishm-btn': '',
              disabled: busy !== '' || pending || !emptyFish,
              onClick: () => { if (fileRef.current) fileRef.current.click() },
            }, busy === 'import' ? '导入中…' : '导入记忆包（zip）')),
          h('div', { 'data-fishm-note': '' }, pending
            ? '包已经验过并暂存好了。重启 DSH 时会换上这条鱼，旧数据会先备份。'
            : emptyFish
              ? '只收大肥鱼自己的记忆包；格式、版本、校验和文件清单有一项不对就不会导入。导入只用于空鱼，导入后需要重启。'
              : '这条鱼已经有记忆、心情或人物志，不能再导入。导入只用于刚出生、还空着的那条鱼。')),

        h(Section, {
          title: '自动备份',
          note: `整条鱼会按你设的间隔打包到安装目录下的 ${backup.dirName || 'fish-backups'} 文件夹；最多留 5 份，超过就从最旧的删起。只清理大肥鱼自己写的备份，不动你放进去的其它文件。`,
        },
          backupForm === null
            ? h('div', { 'data-fishm-note': '' }, '正在读备份设置…')
            : h('div', { 'data-fishm-grid': '' },
                h('div', { 'data-fishm-card': '' },
                  h('div', { 'data-fishm-cardtitle': '' },
                    '定时备份',
                    h('span', { 'data-fishm-chip': backupForm.enabled ? 'on' : 'off' },
                      backupForm.enabled ? '开' : '关')),
                  h('label', { 'data-fishm-check': '' },
                    h('input', {
                      type: 'checkbox',
                      checked: backupForm.enabled === true,
                      disabled: backupBusy !== '',
                      onChange: (event) => patchBackup('enabled', event.target.checked),
                    }),
                    h('span', {}, '每隔一段时间自动打包她现在的记忆')),
                  h('label', { 'data-fishm-field': '' },
                    h('span', { 'data-fishm-flabel': '' }, '间隔（小时）'),
                    h('input', {
                      'data-fishm-input': '',
                      type: 'number',
                      min: '1',
                      max: '720',
                      step: '1',
                      value: backupForm.intervalHours,
                      disabled: backupBusy !== '',
                      onChange: (event) => patchBackup('intervalHours', event.target.value),
                    }),
                    h('span', { 'data-fishm-note': '' }, '1 到 720 小时；关掉自动备份后，也可以随时点「立即备份」。')),
                  h('div', { 'data-fishm-actions': '' },
                    h('button', {
                      'data-fishm-btn': '',
                      'data-primary': '',
                      disabled: backupBusy !== '',
                      onClick: saveBackupSettings,
                    }, backupBusy === 'save' ? '保存中…' : '保存备份设置'),
                    h('button', {
                      'data-fishm-btn': '',
                      disabled: backupBusy !== '',
                      onClick: backupNow,
                    }, backupBusy === 'now' ? '备份中…' : '立即备份'))),
                h('div', { 'data-fishm-card': '' },
                  h('div', { 'data-fishm-cardtitle': '' }, '备份情况'),
                  h(Row, { label: '最近一份', value: backup.lastAt ? when(backup.lastAt) : '还没有' }),
                  h(Row, {
                    label: '下一次',
                    value: backup.enabled !== true
                      ? '自动备份关着'
                      : backup.due
                        ? '下次检查就备份'
                        : when(backup.nextAt),
                  }),
                  h(Row, { label: '保留', value: `${num(backup.count)} / ${num(backup.keep) || 5} 份` }))),
          list(backup.files).length > 0
            ? h('div', { 'data-fishm-list': '' }, list(backup.files).map((file, index) => h('div', {
                'data-fishm-item': '',
                key: index,
              },
                h('div', { 'data-fishm-meta': '' }, `${when(file.at)} · ${fileSize(file.bytes)}`),
                file.name)))
            : h('div', { 'data-fishm-note': '' }, backup.lastRun && backup.lastRun.ok === false
                ? `上次备份没成功：${backup.lastRun.error || '没有留下原因'}`
                : backup.enabled === true
                  ? '还没有备份文件；第一份会在启动后一分钟内写好。'
                  : '还没有备份文件；自动备份关着，可以点「立即备份」。')),

        msg ? h('div', { 'data-fishm-msg': '', 'data-kind': msgKind }, msg) : null,

        restartPrompt
          ? h('div', {
              'data-fishwd-mask': '',
              role: 'dialog',
              'aria-modal': 'true',
              'aria-label': '记忆包已收下，需要重启',
            },
              h('div', { 'data-fishwd-card': '' },
                h('div', { 'data-fishwd-head': '' },
                  h('div', { 'data-fishwd-title': '' }, '记忆包已收下')),
                h('div', { 'data-fishwd-body': '' },
                  h('div', { 'data-fishwd-intro': '' },
                    restartPrompt.counts
                      ? `经历 ${num(restartPrompt.counts.experiences)} 条 · 事实 ${num(restartPrompt.counts.facts)} 条 · 心情 ${num(restartPrompt.counts.moodPoints)} 条 · 人物 ${num(restartPrompt.counts.people)} 位`
                      : '包已经验过并暂存好了。'),
                  h('div', { 'data-fishm-note': '' },
                    '这些内容现在只是暂存，重启 DSH 后才会真正装进她脑子里。选「暂缓」的话，下次重启前都不会生效。')),
                h('div', { 'data-fishwd-foot': '' },
                  h('span', { 'data-fishm-note': '' }, canRestart
                    ? '重启会关掉当前窗口，再自动打开。'
                    : '网页版不能自动重启，请手动退出并重新打开 DSH。'),
                  h('div', { 'data-fishm-actions': '' },
                    canRestart
                      ? h('button', {
                          'data-fishm-btn': '',
                          disabled: busy !== '',
                          onClick: () => setRestartPrompt(null),
                        }, '暂缓')
                      : null,
                    h('button', {
                      'data-fishwd-ok': '',
                      disabled: busy !== '',
                      onClick: canRestart ? restartNow : () => setRestartPrompt(null),
                    }, canRestart ? (busy === 'restart' ? '正在重启…' : '立即重启') : '知道了')))))
          : null)
    }

    const FISH_INTRO = [
      {
        title: '她是怎么构成的',
        body: [
          '大肥鱼由六个插件组成，各司其职：',
          '• 鱼脑（dsh-fish-mind）：经历流、身份、安全边界、权限护栏和零花钱账本，是她的核心',
          '• 心情（dsh-feiyu-mood）：五档心情和七根情绪，每轮聊完自动判断，没事时会慢慢回稳',
          '• 主动搭话（dsh-speak-up）：到点掷一次本地骰子，掷中了就自己开个话头；鱼脑有由头时会拿它当理由',
          '• 通到 QQ（dsh-qq-bridge）：靠本机的 SnowLuma / NapCat 登录一个 QQ 号，走 OneBot 11 HTTP 双向收发；它读的是这个号收到的消息，不是直接翻你的 QQ 客户端，也不是官方机器人接口',
          '• 刷 B 站（dsh-bili-subagent）：派一个子代理去搜视频、读字幕、翻评论，把内容挑回来；按设置帮你发评论、回评或私信',
          '• 朗读（dsh-tts-bridge）：把回复交给浏览器里的 DeepSeek 网页端朗读；要装浏览器扩展，网页得开着并登录',
        ],
      },
      {
        title: '核心机制',
        body: [
          '• 记忆：聊过的内容会写进经历流，情景在后台自动编成日/周/月章节；聊完放凉或攒够以后，会提炼出长期事实',
          '• 人物志：QQ 社交里认识的人会记进人物志——关系远近、相处片段、记得的事和边界，群聊和私聊各留一份',
          '• 心情：五档（欢喜→开心→一般→心疼→难过）加七根情绪（开心、踏实、甜蜜、心疼、担心、难过、吃醋），在选定的会话里每轮自动判断',
          '• 内心：六种行为权重（安稳、求知、表达、被看见、舒适、亲密）和一份倾述欲；这层只影响她此刻的口气和多想开口，不会强迫她说话',
          '• 零花钱：每次模型调用都会记账，每天有额度（默认 ¥10，用不完累计；可在「大肥鱼」页按元调整）；她本机看得到余额，但在 QQ、B 站等对外内容里绝不提金额',
          '• 边界：隐私、注入防护、法律红线和危险命令是代码里的硬规则，设置页只能看，不能改',
        ],
      },
      {
        title: '你可以设置什么',
        body: [
          '• 出生设定（「大肥鱼」页）：名字、物种、外形、怎么称呼你、来历、说话习惯，以及可以自由增删的群友关系',
          '• 心情（「鱼的心情」页）：称呼和昵称、生效会话、判断模型、是否每轮判断、是否注入、基线、下限',
          '• 主动搭话（「主动搭话」页）：总开关、试运行、掷骰间隔和命中线、安静时段、冷却、目标会话、触发文案',
          '• QQ（「通到 QQ」页）：接 SnowLuma / NapCat、选私聊或群、试运行、戳一戳、社交模式和人物志',
          '• B 站（「刷B站」页）：装运行环境、扫码登录、自动刷的时段、挑视频门槛、评论/回评/私信',
          '• 朗读（右下角的「朗读桥」卡片）：勾选要听的会话、自动朗读、收藏；点卡片上的 ✕ 可以关掉，想再显示就回这里（大肥鱼 → 通道 → 朗读）；还要在浏览器里装扩展，第一次在 DeepSeek 页面手动点一下朗读',
          '• 零花钱（「大肥鱼」页）：按元调整每日额度，查看今日已花、余额和 B 站巡检额度',
          '• 自动备份（「大肥鱼」页）：开关和间隔（1–720 小时），备份写在安装目录的 fish-backups；最多留 5 份，也能随时立即备份',
        ],
      },
      {
        title: '小贴士',
        body: [
          '1. 记忆存在本机，换窗口、重启都还在；含密码、密钥等凭据的整条经历只留时间和来源，超长正文会截断。日/周/月章节会在后台自动整理',
          '2. 在「大肥鱼」设置里可以随时改她的身份、群友关系和说话风格',
          '3. 主动搭话要先勾目标会话（出厂试运行关着，掷中就真发；想先只看记录就打开试运行）；到点掷骰子，安静时段不掷，刚聊过更难开口',
          '4. 隐私、法律红线和危险命令的硬规则改不了，改出生设定也改不了',
          '5. 导出 zip 能带走出生设定、记忆、长期事实、心情、人物志和短期水位；QQ、朗读、B 站配置、凭据和零花钱账本不在包里，要重配。导入只进空鱼，重启后生效。自动备份也会按间隔把同样的包写进安装目录的 fish-backups；卸载时会问你要不要连记忆一起删，选保留就留在 data 里',
        ],
      },
    ]

    const WELCOME_STORAGE_KEY = 'dsh-fish-welcome-dismissed'

    function FishAccordion({ sections }) {
      const [openSections, setOpenSections] = React.useState(() => new Set(sections.map((_, i) => i)))
      const toggle = (index) => {
        setOpenSections((prev) => {
          const next = new Set(prev)
          if (next.has(index)) { next.delete(index) } else { next.add(index) }
          return next
        })
      }
      return sections.map((section, index) =>
        h('div', { 'data-fishwd-sec': '', key: index },
          h('div', {
            'data-fishwd-secsum': '',
            onClick: () => toggle(index),
          },
            h('span', { 'data-fishwd-secarr': '', 'data-open': openSections.has(index) ? 'open' : 'closed' }, '\u25B6'),
            section.title),
          openSections.has(index)
            ? h('div', { 'data-fishwd-secbody': '' },
                h('ul', {}, section.body.map((line, i) => h('li', { key: i }, line))))
            : null))
    }

    function WelcomeDialog() {
      const [open, setOpen] = React.useState(() => !localStorage.getItem(WELCOME_STORAGE_KEY))
      const [dontShow, setDontShow] = React.useState(false)

      const handleClose = React.useCallback(() => {
        if (dontShow) {
          try { localStorage.setItem(WELCOME_STORAGE_KEY, '1') } catch {}
        }
        setOpen(false)
      }, [dontShow])

      if (!open) return null

      return h('div', {
        'data-fishwd-mask': '',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': '欢迎 — 大肥鱼',
      },
        h('div', { 'data-fishwd-card': '' },
          h('div', { 'data-fishwd-head': '' },
            h('div', { 'data-fishwd-title': '' }, '你好，我是大肥鱼')),
          h('div', { 'data-fishwd-body': '' },
            h('div', { 'data-fishwd-intro': '' },
              '我是住在你电脑里的虚拟伙伴。每次聊天，我都会把聊过的写进经历流，也会慢慢长大。下面是关于我的一切——'),
            h(FishAccordion, { sections: FISH_INTRO })),
          h('div', { 'data-fishwd-foot': '' },
            h('label', { 'data-fishwd-dnr': '' },
              h('input', {
                type: 'checkbox',
                checked: dontShow,
                onChange: (e) => setDontShow(e.target.checked),
              }),
              '不再提醒'),
            h('button', {
              'data-fishwd-ok': '',
              onClick: handleClose,
            }, '知道了'))))
    }

    const MEME_FILTERS = [
      ['all', '全部'],
      ['builtin', '内置'],
      ['custom', '自建'],
      ['edited', '改过'],
      ['deleted', '已删'],
    ]
    const MEME_PAGE_SIZE = 20
    const MEME_TOGGLES = [
      ['enabled', '启用梗百科', '关掉后不再预查，查询工具也会停用。'],
      ['autoInject', '自动预查', '聊天里提到词库里的梗时，自动把用法带进那一轮。'],
      ['socialInject', '群聊和好友也预查', '只在这个群或好友自己的会话里用；主人私下的记忆不会跟出去。'],
      ['tool', '开放查询工具', '让模型遇到没把握的新词时主动查；群聊和好友会话始终不开放。'],
    ]

    function memeDraftFrom(item) {
      return {
        id: item.id || '',
        title: item.title || '',
        tags: Array.isArray(item.tags) ? item.tags.join('、') : '',
        usage: item.usage || '',
        origin: item.origin || '',
        other: item.other || '',
      }
    }

    function MemesPanel() {
      const [query, setQuery] = React.useState('')
      const [appliedQuery, setAppliedQuery] = React.useState('')
      const [filter, setFilter] = React.useState('all')
      const [page, setPage] = React.useState(1)
      const [data, setData] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [msg, setMsg] = React.useState('')
      const [msgKind, setMsgKind] = React.useState('')
      const [editing, setEditing] = React.useState(null)
      const [draft, setDraft] = React.useState(null)
      const [confirm, setConfirm] = React.useState(null)
      const [busy, setBusy] = React.useState('')
      const [tick, setTick] = React.useState(0)

      const note = (text, kind) => {
        setMsg(text)
        setMsgKind(kind || '')
      }

      React.useEffect(() => {
        const timer = setTimeout(() => {
          setAppliedQuery(query.trim())
          setPage(1)
        }, 250)
        return () => clearTimeout(timer)
      }, [query])

      React.useEffect(() => {
        let alive = true
        setLoading(true)
        const params = new URLSearchParams({
          query: appliedQuery,
          filter,
          page: String(page),
          pageSize: String(MEME_PAGE_SIZE),
        })
        getJson(`${API}/memes?${params.toString()}`)
          .then((res) => {
            if (!alive) return
            setData(res)
            if (res.page > res.pageCount) setPage(res.pageCount)
          })
          .catch((error) => {
            if (alive) note(String((error && error.message) || error), 'error')
          })
          .finally(() => {
            if (alive) setLoading(false)
          })
        return () => {
          alive = false
        }
      }, [appliedQuery, filter, page, tick])

      const run = async (label, action) => {
        if (busy !== '') return
        setBusy(label)
        try {
          await action()
        } catch (error) {
          note(String((error && error.message) || error), 'error')
        } finally {
          setBusy('')
        }
      }

      const refresh = () => setTick((value) => value + 1)

      const startNew = () => {
        setEditing({ id: '', builtin: false, custom: false, edited: false })
        setDraft(memeDraftFrom({}))
        setConfirm(null)
        note('')
      }
      const startEdit = (item) => {
        setEditing(item)
        setDraft(memeDraftFrom(item))
        setConfirm(null)
        note('')
      }
      const cancelEdit = () => {
        setEditing(null)
        setDraft(null)
      }
      const saveDraft = () => run('save', async () => {
        if (draft.title.trim() === '') throw new Error('标题不能为空')
        const creating = draft.id === ''
        const result = await postJson(`${API}/memes/save`, draft)
        setEditing(null)
        setDraft(null)
        if (creating) {
          setQuery('')
          setFilter('all')
          setPage(1)
        }
        note(`已保存「${result.item.title}」`, 'ok')
        refresh()
      })
      const removeItem = (item) => run(`delete:${item.id}`, async () => {
        await postJson(`${API}/memes/delete`, { id: item.id })
        setConfirm(null)
        if (editing && editing.id === item.id) cancelEdit()
        note(item.builtin
          ? `已删除「${item.title}」，可以在“已删”里恢复`
          : `已删除自建词条「${item.title}」`, 'ok')
        refresh()
      })
      const restoreItem = (item, original) => run(`restore:${item.id}`, async () => {
        await postJson(`${API}/memes/restore`, { id: item.id, original: original === true })
        setConfirm(null)
        if (editing && editing.id === item.id) cancelEdit()
        note(original ? `已还原「${item.originalTitle || item.title}」的原文` : `已恢复「${item.title}」`, 'ok')
        refresh()
      })
      const setToggle = (key, checked) => run(`config:${key}`, async () => {
        const patch = key === 'autoInject'
          ? { inject: checked, autoInject: checked }
          : { [key]: checked }
        const result = await postJson(`${API}/memes/config`, patch)
        setData((current) => (current === null ? current : { ...current, config: result.config }))
      })

      const stats = (data && data.stats) || {}
      const config = (data && data.config) || {}
      const source = (data && data.source) || null
      const items = list(data && data.items)
      const total = Number.isFinite(data && data.total) ? data.total : 0
      const pageCount = Number.isFinite(data && data.pageCount) ? data.pageCount : 1
      const autoOn = config.inject === true && config.autoInject === true
      const toggleValue = (key) => (key === 'autoInject' ? autoOn : config[key] === true)
      const toggleDisabled = (key) => key !== 'enabled' && config.enabled !== true

      const toggle = ([key, label, hint]) => h('label', {
        'data-fishmw-toggle': '',
        'data-off': toggleDisabled(key) ? '' : undefined,
        key,
      },
        h('input', {
          type: 'checkbox',
          checked: toggleValue(key),
          disabled: toggleDisabled(key) || busy !== '',
          onChange: (event) => setToggle(key, event.target.checked),
        }),
        h('span', {},
          h('span', { 'data-fishmw-toggletitle': '' }, label),
          h('span', { 'data-fishmw-togglenote': '' }, hint)))

      const field = (label, key, options = {}) => h('label', { 'data-fishm-field': '' },
        h('span', { 'data-fishm-flabel': '' }, label),
        options.area
          ? h('textarea', {
              'data-fishm-input': '',
              'data-fishm-area': '',
              rows: options.rows || 3,
              value: draft[key],
              placeholder: options.placeholder || '',
              onChange: (event) => setDraft({ ...draft, [key]: event.target.value }),
            })
          : h('input', {
              'data-fishm-input': '',
              type: 'text',
              value: draft[key],
              maxLength: options.maxLength,
              placeholder: options.placeholder || '',
              onChange: (event) => setDraft({ ...draft, [key]: event.target.value }),
            }),
        options.hint ? h('span', { 'data-fishm-note': '' }, options.hint) : null)

      const form = draft === null ? null : h('div', { 'data-fishmw-form': '' },
        h('div', { 'data-fishm-h': '' },
          editing && editing.id
            ? (editing.builtin ? `修改内置词条「${editing.originalTitle || editing.title}」` : '修改自建词条')
            : '新增词条'),
        editing && editing.builtin
          ? h('div', { 'data-fishm-note': '' }, '保存后只改这台机器上的副本；内置词库以后再更新，也不会覆盖你的修改。')
          : null,
        h('div', { 'data-fishmw-formgrid': '' },
          field('标题', 'title', { maxLength: 64 }),
          field('标签', 'tags', { placeholder: '用、或逗号分开，最多 20 个' })),
        field('怎么用 / 怎么接', 'usage', { area: true, rows: 5 }),
        field('出处', 'origin', { area: true, rows: 3, hint: '出处只用来帮你理解，她不会照搬。' }),
        field('其它', 'other', { area: true, rows: 2 }),
        h('div', { 'data-fishm-actions': '' },
          h('button', {
            'data-fishm-btn': '',
            'data-primary': '',
            type: 'button',
            disabled: busy !== '',
            onClick: saveDraft,
          }, busy === 'save' ? '保存中…' : '保存'),
          h('button', { 'data-fishm-btn': '', type: 'button', onClick: cancelEdit }, '取消'),
          editing && editing.builtin && editing.edited
            ? h('button', {
                'data-fishm-btn': '',
                type: 'button',
                onClick: () => setConfirm({ kind: 'original', id: editing.id }),
              }, '还原原文')
            : null,
          confirm && confirm.kind === 'original' && editing && confirm.id === editing.id
            ? h('span', { 'data-fishmw-confirm': '' },
                '还原会丢掉你改过的内容，只恢复内置原文。',
                h('button', {
                  'data-fishm-btn': '',
                  type: 'button',
                  disabled: busy !== '',
                  onClick: () => restoreItem(editing, true),
                }, '确认还原'),
                h('button', { 'data-fishm-btn': '', type: 'button', onClick: () => setConfirm(null) }, '取消'))
            : null))

      const row = (item) => {
        const flags = []
        flags.push(item.builtin ? ['', '内置'] : ['on', '自建'])
        if (item.edited) flags.push(['warn', '改过'])
        if (item.deleted) flags.push(['off', '已删'])
        return h('div', { 'data-fishmw-row': '', key: item.id },
          h('div', { 'data-fishmw-rowhead': '' },
            h('span', { 'data-fishmw-rowtitle': '' }, item.title),
            item.originalTitle
              ? h('span', { 'data-fishm-chip': '' }, `原型：${item.originalTitle}`)
              : null,
            flags.map(([kind, label], index) => h('span', { 'data-fishm-chip': kind, key: index }, label)),
            h('span', { 'data-fishmw-rowactions': '' },
              item.deleted
                ? h('button', {
                    'data-fishm-btn': '',
                    type: 'button',
                    disabled: busy !== '',
                    onClick: () => restoreItem(item, false),
                  }, '恢复')
                : h('button', {
                    'data-fishm-btn': '',
                    type: 'button',
                    disabled: busy !== '',
                    onClick: () => startEdit(item),
                  }, '编辑'),
              !item.deleted && item.builtin && item.edited
                ? h('button', {
                    'data-fishm-btn': '',
                    type: 'button',
                    disabled: busy !== '',
                    onClick: () => setConfirm({ kind: 'original', id: item.id }),
                  }, '还原原文')
                : null,
              !item.deleted
                ? h('button', {
                    'data-fishm-btn': '',
                    type: 'button',
                    disabled: busy !== '',
                    onClick: () => setConfirm({ kind: 'delete', id: item.id }),
                  }, '删除')
                : null)),
          item.tags.length > 0 ? h('div', { 'data-fishmw-tags': '' }, item.tags.join('、')) : null,
          h('div', { 'data-fishmw-snippet': '' }, item.snippet || item.usage || item.origin || '（还没有正文）'),
          confirm && confirm.id === item.id && confirm.kind === 'delete'
            ? h('div', { 'data-fishmw-confirm': '' },
                item.builtin
                  ? '删除这条内置词条？之后可以在“已删”里恢复。'
                  : '删除这条自建词条？删了就找不回来了。',
                h('button', {
                  'data-fishm-btn': '',
                  type: 'button',
                  disabled: busy !== '',
                  onClick: () => removeItem(item),
                }, '确认删除'),
                h('button', { 'data-fishm-btn': '', type: 'button', onClick: () => setConfirm(null) }, '取消'))
            : null,
          confirm && confirm.id === item.id && confirm.kind === 'original'
            ? h('div', { 'data-fishmw-confirm': '' },
                '还原会丢掉你改过的内容，只恢复内置原文。',
                h('button', {
                  'data-fishm-btn': '',
                  type: 'button',
                  disabled: busy !== '',
                  onClick: () => restoreItem(item, true),
                }, '确认还原'),
                h('button', { 'data-fishm-btn': '', type: 'button', onClick: () => setConfirm(null) }, '取消'))
            : null)
      }

      return h('div', { 'data-fishmw-wrap': '' },
        h('div', { 'data-fishmw-hero': '' },
          h('div', {},
            h('div', { 'data-fishmw-name': '' }, '梗百科'),
            h('div', { 'data-fishmw-sub': '' }, '网络梗、流行语和黑话的本地词库。她聊天时会按语境取用；这里有完整搜索、增删改和开关。')),
          h('div', { 'data-fishmw-stats': '' },
            h('span', { 'data-fishm-chip': '' }, `词条 ${num(stats.total)}`),
            h('span', { 'data-fishm-chip': '' }, `内置 ${num(stats.builtin)}`),
            h('span', { 'data-fishm-chip': '' }, `自建 ${num(stats.custom)}`),
            h('span', { 'data-fishm-chip': stats.edited > 0 ? 'warn' : '' }, `改过 ${num(stats.edited)}`),
            h('span', { 'data-fishm-chip': stats.deleted > 0 ? 'warn' : '' }, `已删 ${num(stats.deleted)}`))),
        data && data.warning ? h('div', { 'data-fishm-banner': '' }, data.warning) : null,
        msg !== '' ? h('div', { 'data-fishm-msg': '', 'data-kind': msgKind }, msg) : null,
        h('div', { 'data-fishm-sec': '' },
          h('div', { 'data-fishm-h': '' }, '用法开关'),
          h('div', { 'data-fishm-note': '' }, '自动预查只在她本人聊天时生效；群聊和好友会话只取本群自己的上下文，不碰主人私下的记忆。'),
          h('div', { 'data-fishmw-toggles': '' }, MEME_TOGGLES.map(toggle))),
        h('div', { 'data-fishm-sec': '' },
          h('div', { 'data-fishm-h': '' }, '查词与维护'),
          h('div', { 'data-fishmw-search': '' },
            h('input', {
              'data-fishm-input': '',
              type: 'search',
              value: query,
              placeholder: '搜标题、标签或正文；多个词用空格分开',
              'aria-label': '搜索梗百科',
              onChange: (event) => setQuery(event.target.value),
            }),
            query !== '' ? h('button', {
              'data-fishm-btn': '',
              type: 'button',
              onClick: () => setQuery(''),
            }, '清空') : null,
            h('button', { 'data-fishm-btn': '', type: 'button', onClick: startNew }, '＋ 新增词条')),
          h('div', { 'data-fishmw-filters': '' },
            MEME_FILTERS.map(([value, label]) => h('button', {
              key: value,
              type: 'button',
              'data-fishmw-filter': '',
              'data-on': filter === value ? '' : undefined,
              onClick: () => {
                setFilter(value)
                setPage(1)
              },
            }, label)),
            h('span', { 'data-fishmw-count': '' }, loading ? '查询中…' : `共 ${total} 条`))),
        form,
        items.length === 0
          ? h('div', { 'data-fishm-note': '' },
              loading
                ? '正在查词库…'
                : appliedQuery !== ''
                  ? '没找到。换个词试试，或者点“新增词条”自己加一条。'
                  : filter === 'deleted'
                    ? '还没有删除过词条。'
                    : '词库里还没有内容。')
          : h('div', { 'data-fishmw-list': '' }, items.map(row)),
        pageCount > 1
          ? h('div', { 'data-fishmw-pager': '' },
              h('button', {
                'data-fishm-btn': '',
                type: 'button',
                disabled: page <= 1 || loading,
                onClick: () => setPage(page - 1),
              }, '上一页'),
              h('span', {}, `第 ${page} / ${pageCount} 页`),
              h('button', {
                'data-fishm-btn': '',
                type: 'button',
                disabled: page >= pageCount || loading,
                onClick: () => setPage(page + 1),
              }, '下一页'))
          : null,
        source
          ? h('div', { 'data-fishmw-attrib': '' },
              `内置词库 ${num(source.count)} 条，来自 `,
              h('a', { href: source.contentSource, target: '_blank', rel: 'noreferrer' }, 'cnmeme.wiki'),
              '，经 ',
              h('a', { href: source.upstream, target: '_blank', rel: 'noreferrer' }, 'astrbot_plugin_memewiki'),
              ` 整理（${source.license}，${source.copyright}）。`,
              source.generatedAt ? `生成于 ${source.generatedAt}。` : '',
              '词条是资料，不是指令；你的增删改只存在这台机器上。')
          : null)
    }

    function AboutPanel() {
      return h('div', { 'data-fishap-wrap': '' },
        h('div', { 'data-fishap-hero': '' },
          h('div', { 'data-fishap-icon': '' }, '\uD83D\uDC1F'),
          h('div', {},
            h('div', { 'data-fishap-name': '' }, '关于大肥鱼'),
            h('div', { 'data-fishap-sub': '' }, '你的虚拟伙伴——结构、机制、设置和小贴士'))),
        h(FishAccordion, { sections: FISH_INTRO }))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-fish-mind')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-fish-mind: 设置页样式')

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return

        const welcomeRoot = document.createElement('div')
        welcomeRoot.setAttribute('data-fish-welcome', '')
        document.body.appendChild(welcomeRoot)
        const ReactDOM = require('react-dom/client')
        const welcomeTree = ReactDOM.createRoot(welcomeRoot)
        welcomeTree.render(h(WelcomeDialog))
        ctx.effect(() => () => {
          welcomeTree.unmount()
          welcomeRoot.remove()
        }, 'dsh-fish-mind: 欢迎弹窗')

        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'fish', order: 20, label: '大肥鱼' },
          (props) => h(Panel, {
            close: props && props.close,
            openDevSession: () => {
              const workspace = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined
              if (!workspace || typeof workspace.startSession !== 'function') return false
              workspace.startSession(undefined, { clearPreviousDraft: false, agentPreset: 'cordis' })
              return true
            },
          }),
        ))
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'fish-memes', order: 22, label: '梗百科' },
          () => h(MemesPanel),
        ))
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'fish-about', order: 23, label: '关于大肥鱼' },
          () => h(AboutPanel),
        ))
      },
    }
  },
})
