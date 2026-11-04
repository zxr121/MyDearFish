/**
 * dsh-fish-mind —— 浏览器半端（设置里的一页「大肥鱼」）
 * ============================================================================
 * 这一页给主人看完整的一条鱼：
 *   · 出生设定：名字、物种、外形、称呼、来历、说话习惯和群友关系，只有这里能改；
 *   · 性格倾向：一段话编译成设置/每轮提示，能落地的保存时写进对应设置页，改代码的交给创造模式；
 *   · 作息：休眠窗口跟「主动搭话」的安静时段走，总览只看状态；人设只写休眠的样子；
 *   · 自定义话术：私事被追问时的托词和零花钱用完时的本地回复，由主人自己写；
 *   · 开发者模式：只读调试资料、读鱼 QQ 名单、在对话里帮她改行为设置的开关，以及创造模式调试会话的入口；
 *   · 大肥鱼：总览 / 她是谁 / 记忆 / 心情 / 零花钱 / 梗百科；记忆、心情、人物志、边界只读；
 *   · 她在外面：通到 QQ / 主动搭话 / 刷 B 站；
 *   · 梗百科：查词、新增、修改、删除和恢复，改的是这台机器上的副本；
 *   · 搬迁：导出整条鱼为一个 zip；导入只收合法的大肥鱼包，随时可用，覆盖前先整份备份；
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
[data-fishm-h]{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:14px;font-weight:500;line-height:22px;opacity:.94;}
[data-fishm-note]{font-size:12px;opacity:.62;line-height:1.65;}
[data-fishm-row]{display:flex;gap:10px;align-items:baseline;font-size:13px;line-height:1.6;flex-wrap:wrap;}
[data-fishm-k]{opacity:.62;min-width:92px;flex:0 0 auto;}
[data-fishm-v]{flex:1;min-width:140px;}
[data-fishm-grid]{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;}
[data-fishm-card]{padding:14px 16px;border:0.5px solid var(--dsw-alias-settings-card-stroke,rgba(127,127,127,.2));border-radius:14px;background:var(--dsw-alias-settings-card-fill,rgba(127,127,127,.06));display:flex;flex-direction:column;gap:6px;}
[data-fishm-cardtitle]{font-size:13px;font-weight:500;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
[data-fishm-field]{display:flex;flex-direction:column;gap:4px;}
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
[data-fishmw-wrap]{display:flex;flex-direction:column;gap:14px;padding:4px 2px 32px;}
[data-fishmw-hero]{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:14px 16px;border-radius:12px;background:rgba(127,127,127,.08);}
[data-fishmw-name]{font-size:18px;font-weight:600;}
[data-fishmw-sub]{font-size:12px;opacity:.62;margin-top:4px;line-height:1.55;max-width:620px;}
[data-fishmw-recent]{font-size:12px;opacity:.62;margin-top:4px;line-height:1.55;}
[data-fishmw-stats]{display:flex;gap:6px;flex-wrap:wrap;align-items:center;}
[data-fishmw-search]{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
[data-fishmw-search]>[data-fishm-input]{flex:1;min-width:220px;}
[data-fishmw-filters]{display:flex;gap:6px;flex-wrap:wrap;align-items:center;}
[data-fishmw-filter]{padding:4px 11px;border-radius:999px;border:1px solid rgba(127,127,127,.28);background:transparent;color:inherit;font-size:12px;cursor:pointer;line-height:1.6;}
[data-fishmw-filter]:hover{background:rgba(127,127,127,.12);}
[data-fishmw-filter][data-on]{border-color:rgba(80,150,255,.65);background:rgba(80,150,255,.14);}
[data-fishmw-toggles]{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px;}
[data-fishmw-toggle]{display:flex;gap:9px;align-items:flex-start;padding:9px 11px;border-radius:9px;background:rgba(127,127,127,.06);font-size:12px;line-height:1.55;}
[data-fishmw-togglegrow]{flex:1;min-width:0;}
[data-fishmw-toggle][data-off]{opacity:.5;}
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
[data-fishm-tabs]{position:sticky;top:0;z-index:3;display:flex;gap:24px;flex-wrap:wrap;padding:2px 2px 0;margin:0 0 18px;background:var(--dsw-alias-bg-layer-2,#1e1e1e);border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.24));}
[data-fishm-tab]{position:relative;padding:4px 0 11px;border:0;background:transparent;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.7));font-size:13px;line-height:20px;cursor:pointer;font-weight:400;transition:color .15s;}
[data-fishm-tab]:hover{color:var(--dsw-alias-label-primary,inherit);}
[data-fishm-tab][aria-selected="true"]{color:var(--dsw-alias-label-primary,inherit);font-weight:500;}
[data-fishm-tab][aria-selected="true"]::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;border-radius:2px;background:var(--dsw-alias-state-business-primary,#5096ff);}
[data-fishm-pagehead]{display:flex;flex-direction:column;gap:6px;padding:4px 2px 14px;margin-bottom:2px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16));}
[data-fishm-pagehead-title]{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:20px;line-height:28px;font-weight:500;letter-spacing:-.01em;}
[data-fishm-caps]{font-size:12px;line-height:1.7;padding:8px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06));border-left:2px solid var(--dsw-alias-state-business-primary,#5096ff);color:var(--dsw-alias-label-secondary,rgba(127,127,127,.8));}
[data-fishm-effect]{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;line-height:1.6;background:rgba(127,127,127,.14);opacity:.82;font-weight:400;}
[data-fishm-effect="restart"]{background:rgba(220,160,60,.18);}
[data-fishm-pane][hidden]{display:none;}
[data-fishm-pill]{display:inline-flex;align-items:center;gap:2px;padding:2px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:999px;}
[data-fishm-pill] button{border:none;border-radius:999px;padding:3px 12px;font-size:12px;line-height:1.4;background:transparent;color:inherit;cursor:pointer;opacity:.5;font-weight:400;}
[data-fishm-pill] button[aria-pressed="true"]{opacity:1;font-weight:500;}
[data-fishm-pill] button[data-on="true"][aria-pressed="true"]{background:var(--dsw-alias-state-business-primary);color:var(--dsw-static-neutral-00,#fff);}
[data-fishm-pill] button[data-on="false"][aria-pressed="true"]{background:var(--dsw-alias-border-l2,rgba(127,127,127,.28));}
[data-fishm-jump]{display:flex;gap:6px;flex-wrap:wrap;align-items:center;}
[data-fishm-jump] button{padding:3px 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));background:transparent;color:inherit;font-size:12px;cursor:pointer;}
[data-fishm-jump] button:hover{background:rgba(127,127,127,.12);}
`

    const FISH_TABS = [
      { id: 'overview', order: 0, label: '总览' },
      { id: 'who', order: 10, label: '她是谁' },
      { id: 'memory', order: 20, label: '记忆' },
      { id: 'money', order: 40, label: '零花钱' },
      { id: 'memes', order: 50, label: '梗百科' },
    ]

    function Section({ title, note, effect, children }) {
      return h('div', { 'data-fishm-sec': '' },
        h('div', { 'data-fishm-h': '' }, title,
          effect
            ? h('span', { 'data-fishm-effect': effect === 'restart' ? 'restart' : '' },
                effect === 'restart' ? '重启后生效' : '立即生效')
            : null),
        note ? h('div', { 'data-fishm-note': '' }, note) : null,
        children)
    }

    function pageHead({ title, intro, caps, effect }) {
      return h('div', {
        'data-fishm-pagehead': '',
        style: {
          display: 'flex', flexDirection: 'column', gap: 6,
          padding: '4px 2px 14px', marginBottom: 2,
          borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16))',
        },
      },
        h('div', {
          'data-fishm-pagehead-title': '',
          style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 20, lineHeight: '28px', fontWeight: 500, letterSpacing: '-.01em' },
        }, title,
          effect
            ? h('span', { 'data-fishm-effect': effect === 'restart' ? 'restart' : '' },
                effect === 'restart' ? '重启后生效' : '立即生效')
            : null),
        intro ? h('div', { 'data-fishm-note': '', style: { fontSize: 12, lineHeight: 1.7, opacity: 0.62 } }, intro) : null,
        caps ? h('div', {
          'data-fishm-caps': '',
          style: {
            fontSize: 12, lineHeight: 1.7, padding: '8px 12px', borderRadius: 8,
            background: 'var(--dsw-alias-bg-layer-1, rgba(127,127,127,.06))',
            borderLeft: '2px solid var(--dsw-alias-state-business-primary, #5096ff)',
            color: 'var(--dsw-alias-label-secondary, rgba(127,127,127,.8))',
          },
        }, caps) : null)
    }

    function 勾(值, onChange) {
      const 开 = !!值
      const 段 = (文本, 选中, 目标) => h('button', {
        type: 'button',
        'data-on': 目标 ? 'true' : 'false',
        'aria-pressed': 选中,
        style: {
          minWidth: 30, border: 'none', borderRadius: 999, padding: '4px 11px',
          fontFamily: 'inherit', fontSize: 12, lineHeight: '16px',
          cursor: 选中 ? 'default' : 'pointer',
          background: 选中
            ? (目标 ? 'var(--dsw-alias-state-business-primary, #5096ff)' : 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,.22))')
            : 'transparent',
          color: 选中
            ? (目标 ? 'var(--dsw-static-neutral-00, #fff)' : 'var(--dsw-alias-label-primary, inherit)')
            : 'var(--dsw-alias-label-tertiary, rgba(127,127,127,.7))',
          fontWeight: 选中 ? 500 : 400,
          transition: 'background .15s, color .15s',
        },
        onClick: () => { if (!选中) onChange(目标) },
      }, 文本)
      return h('div', {
        'data-fishm-pill': '',
        style: {
          display: 'inline-flex', alignItems: 'center', padding: 2, borderRadius: 999,
          border: '0.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,.28))',
          background: 'var(--dsw-alias-bg-layer-1, rgba(127,127,127,.06))',
        },
      }, 段('开', 开, true), 段('关', !开, false))
    }

    function pane(id, active, ...children) {
      return h('div', {
        'data-fishm-pane': id,
        hidden: id !== active,
        id: 'fishm-panel-' + id,
        role: 'tabpanel',
        'aria-labelledby': 'fishm-tab-' + id,
      }, id === active ? children : null)
    }

    function paneTail(id, active, ...children) {
      return h('div', { 'data-fishm-pane': id, hidden: id !== active }, id === active ? children : null)
    }

    function tabStrip(tabs, active, onSelect, label) {
      const move = (event, index) => {
        let next = -1
        if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
        else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = tabs.length - 1
        else return
        event.preventDefault()
        const target = tabs[next]
        if (target === undefined) return
        onSelect(target.id)
        if (typeof document !== 'undefined' && typeof document.getElementById === 'function') {
          const element = document.getElementById('fishm-tab-' + target.id)
          if (element && typeof element.focus === 'function') element.focus()
        }
      }
      return h('div', {
        'data-fishm-tabs': '',
        role: 'tablist',
        'aria-label': label || '设置页',
        style: {
          position: 'sticky', top: 0, zIndex: 3, display: 'flex', gap: 24, flexWrap: 'wrap',
          padding: '2px 2px 0', margin: '0 0 18px',
          background: 'var(--dsw-alias-bg-layer-2, #1e1e1e)',
          borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.24))',
        },
      },
      tabs.map((tab, index) => h('button', {
        key: tab.id,
        type: 'button',
        role: 'tab',
        'data-fishm-tab': '',
        id: 'fishm-tab-' + tab.id,
        'aria-selected': tab.id === active,
        'aria-controls': 'fishm-panel-' + tab.id,
        tabIndex: tab.id === active ? 0 : -1,
        style: {
          appearance: 'none', position: 'relative', border: 0, borderRadius: 0, background: 'transparent',
          padding: '4px 0 11px', fontFamily: 'inherit', fontSize: 13, lineHeight: '20px',
          cursor: 'pointer',
          color: tab.id === active
            ? 'var(--dsw-alias-label-primary, inherit)'
            : 'var(--dsw-alias-label-tertiary, rgba(127,127,127,.7))',
          fontWeight: tab.id === active ? 500 : 400,
          boxShadow: tab.id === active
            ? 'inset 0 -2px 0 var(--dsw-alias-state-business-primary, #5096ff)'
            : 'none',
          transition: 'color .15s',
        },
        onClick: () => onSelect(tab.id),
        onKeyDown: (event) => move(event, index),
      }, tab.label)))
    }

    function makeLedgerHook(slots, slotName) {
      let version = -1
      let rows = []
      return {
        getSnapshot: () => {
          const current = typeof slots.getVersion === 'function' ? slots.getVersion(slotName) : 0
          if (current !== version) {
            version = current
            rows = (typeof slots.entries === 'function' ? slots.entries(slotName) : [])
              .map((entry) => {
                const options = (entry && entry.options) || {}
                return {
                  id: options.id || '',
                  order: Number.isFinite(options.order) ? options.order : 0,
                  label: typeof options.label === 'function' ? options.label() : (options.label || ''),
                }
              })
              .sort((a, b) => a.order - b.order)
          }
          return rows
        },
        subscribe: (listener) => (typeof slots.subscribe === 'function' ? slots.subscribe(slotName, listener) : () => {}),
      }
    }

    function OutsideTabs({ renderSlot, useTabs, requestedTab, takeRequestedTab }) {
      const readTabs = typeof useTabs === 'function' ? useTabs : () => []
      const rows = readTabs((value) => value)
      const [active, setActive] = React.useState(undefined)
      const [visited, setVisited] = React.useState(() => new Set())
      const current = rows.find((row) => row.id === active)?.id ?? rows[0]?.id
      React.useEffect(() => {
        if (current === undefined) return
        setVisited((previous) => (previous.has(current) ? previous : new Set([...previous, current])))
      }, [current])
      React.useEffect(() => {
        if (requestedTab === undefined || requestedTab === null || typeof requestedTab.tabId !== 'string') return
        setActive(requestedTab.tabId)
        if (typeof takeRequestedTab === 'function') takeRequestedTab(requestedTab.nonce)
      }, [requestedTab])
      return h('div', { 'data-fishm-wrap': '' },
        pageHead({
          title: '她在外面',
          intro: '她怎么跟外面打交道：QQ、主动搭话、刷 B 站，装好哪个用哪个。',
          caps: '本页可以设置：接通与登录、群里怎么说话、什么时候主动开口、B 站怎么刷。',
        }),
        rows.length === 0
          ? h('div', { 'data-fishm-note': '' }, '还没有接外面的东西。装好插件后这里会出现。')
          : tabStrip(rows, current, setActive, '她在外面设置页'),
        rows.map((row) => (visited.has(row.id) || row.id === current
          ? h('div', {
              key: row.id,
              id: 'fishm-panel-' + row.id,
              role: 'tabpanel',
              'aria-labelledby': 'fishm-tab-' + row.id,
              hidden: row.id !== current,
              'data-fishm-pane': row.id,
            }, renderSlot('settings.outside.tab', {}, { only: row.id }))
          : null)))
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

    function Panel({ close, openDevSession, renderSlot, useTabs, requestedTab, takeRequestedTab }) {
      const readTabs = typeof useTabs === 'function' ? useTabs : () => []
      const ledger = readTabs((value) => value)
      const [tab, setTab] = React.useState('overview')
      const [visitedTabs, setVisitedTabs] = React.useState(() => new Set())
      const [data, setData] = React.useState(null)
      const [form, setForm] = React.useState(null)
      const [persona, setPersona] = React.useState(null)
      const [personaExpanded, setPersonaExpanded] = React.useState(false)
      const [tendencyText, setTendencyText] = React.useState('')
      const [tendencyPreview, setTendencyPreview] = React.useState(null)
      const [tendencyError, setTendencyError] = React.useState('')
      const [tendencyBusy, setTendencyBusy] = React.useState('')
      const [creationBrief, setCreationBrief] = React.useState(null)
      const [creationBusy, setCreationBusy] = React.useState(false)
      const [busy, setBusy] = React.useState('')
      const [msg, setMsg] = React.useState('')
      const [msgKind, setMsgKind] = React.useState('')
      const [grantDraft, setGrantDraft] = React.useState(null)
      const [grantBusy, setGrantBusy] = React.useState(false)
      const [walletDraft, setWalletDraft] = React.useState(null)
      const [walletBusy, setWalletBusy] = React.useState(false)
      const [phraseForm, setPhraseForm] = React.useState(null)
      const [phraseBusy, setPhraseBusy] = React.useState(false)
      const [backupForm, setBackupForm] = React.useState(null)
      const [backupBusy, setBackupBusy] = React.useState('')
      const [devBusy, setDevBusy] = React.useState(false)
      const [devOpening, setDevOpening] = React.useState(false)
      const [ttsPanelBusy, setTtsPanelBusy] = React.useState(false)
      const [restartPrompt, setRestartPrompt] = React.useState(null)
      const fileRef = React.useRef(null)
      const canRestart = typeof window !== 'undefined' && !!window.dshDesktop
        && typeof window.dshDesktop.restart === 'function'
      const tabs = [...FISH_TABS, ...ledger].sort((a, b) => a.order - b.order)
      const active = tabs.some((item) => item.id === tab) ? tab : (tabs[0] && tabs[0].id)

      React.useEffect(() => {
        if (typeof active !== 'string') return
        setVisitedTabs((previous) => (previous.has(active) ? previous : new Set([...previous, active])))
      }, [active])
      React.useEffect(() => {
        if (requestedTab === undefined || requestedTab === null || typeof requestedTab.tabId !== 'string') return
        setTab(requestedTab.tabId)
        if (typeof takeRequestedTab === 'function') takeRequestedTab(requestedTab.nonce)
      }, [requestedTab])

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

      const loadTendency = React.useCallback(async () => {
        try {
          const next = await getJson(API + '/tendency')
          setTendencyText(typeof next.text === 'string' ? next.text : '')
          setTendencyPreview(next)
          setTendencyError('')
        } catch (error) {
          setTendencyError(String((error && error.message) || error))
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
          flash(next === true
            ? '开发者模式已打开：她能只读看调试资料、读鱼 QQ 的群和好友号，也能在对话里帮你改行为设置'
            : '开发者模式已关闭：读调试资料和改设置都停了')
        } catch (error) {
          flash('没改成：' + String((error && error.message) || error), 'error')
        } finally {
          setDevBusy(false)
        }
      }

      // 创造模式会话由宿主组合：先把她自己的安装目录注册成工作区，再在那里新开空白会话，
      // 预设换成 cordis，鱼的人设和记忆照常跟着，文件路径也落在鱼自己的地盘；
      // 这种会话由鱼脑在创建时钉成完全权限，改代码不用逐条确认。
      // 带 prompt 时只填进可编辑草稿、不自动发送；不带时就是空白会话。
      const startDevSession = async (options) => {
        if (devOpening) return
        const prompt = options && typeof options === 'object' && typeof options.prompt === 'string' ? options.prompt : ''
        setDevOpening(true)
        let opened
        try {
          opened = typeof openDevSession === 'function'
            && await openDevSession(prompt === '' ? undefined : { prompt })
        } catch (error) {
          setDevOpening(false)
          flash('建会话没成功：' + String((error && error.message) || error), 'error')
          return
        }
        setDevOpening(false)
        if (!opened) {
          flash('这个宿主没有打开会话的入口，没法新建创造模式会话', 'error')
          return
        }
        if (typeof close === 'function') close()
      }

      React.useEffect(() => {
        load()
        loadTendency()
        const timer = setInterval(() => { void load() }, 30000)
        return () => clearInterval(timer)
      }, [load, loadTendency])

      // 停顿半秒再预览：主人还在打字时不发请求，打完再看她怎么理解。
      React.useEffect(() => {
        if (tendencyError !== '') return undefined
        const timer = setTimeout(async () => {
          try {
            const next = await postJson(API + '/tendency', { text: tendencyText, previewOnly: true })
            setTendencyPreview(next)
          } catch (error) {
            setTendencyPreview((current) => ({
              ...(current || {}),
              preview: [],
              unmatched: [],
              blockerError: String((error && error.message) || error),
            }))
          }
        }, 500)
        return () => clearTimeout(timer)
      }, [tendencyText, tendencyError])

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
          flash('出厂人设已保存，下一轮就会按新的人设说话')
        } catch (error) {
          flash('保存失败：' + String((error && error.message) || error), 'error')
        }
        setBusy('')
      }

      const resetPersona = async () => {
        if (!window.confirm('把出厂人设恢复成原版？名字、外形、性格倾向和其他出生设定不受影响。')) return
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

      const saveTendency = async () => {
        setTendencyBusy('save')
        try {
          const result = await postJson(API + '/tendency', { text: tendencyText })
          setTendencyText(typeof result.text === 'string' ? result.text : '')
          setTendencyPreview(result)
          setTendencyError('')
          flash(result && result.applyStatus === 'applied'
            ? '性格倾向已保存，主动话量等设置也写进了「她在外面 → 通到 QQ」'
            : result && result.applyStatus === 'missing'
              ? '性格倾向已保存；还没配置 QQ 桥，这次只影响语气'
              : '性格倾向已保存，下一轮就会按这个方向说话')
        } catch (error) {
          flash('保存失败：' + String((error && error.message) || error), 'error')
        }
        setTendencyBusy('')
      }

      const clearTendency = async () => {
        if (!window.confirm('清空性格倾向？她会回到出厂性格，倾向提示不再注入；倾向改过的主动话量等设置会还原到保存前的值。')) return
        setTendencyBusy('clear')
        try {
          const result = await postJson(API + '/tendency', { text: '' })
          setTendencyText('')
          setTendencyPreview(result)
          setTendencyError('')
          flash(result && result.applyStatus === 'missing'
            ? '性格倾向已清空，她回到出厂性格'
            : '性格倾向已清空，她回到出厂性格，设置也还原了')
        } catch (error) {
          flash('清空失败：' + String((error && error.message) || error), 'error')
        }
        setTendencyBusy('')
      }

      const addTendencyPhrase = (phrase) => {
        const limit = Number(tendencyPreview && tendencyPreview.maxLength) || 2000
        setTendencyText((current) => {
          const head = String(current || '').trim().replace(/[。；;，,\s]+$/, '')
          const next = head === '' ? phrase : `${head}，${phrase}`
          return next.length > limit ? next.slice(0, limit) : next
        })
      }

      const openCreation = async () => {
        if (creationBusy) return
        setCreationBusy(true)
        try {
          const result = await postJson(API + '/creation/brief', { text: tendencyText })
          const early = tendencyPreview && tendencyPreview.unmatched
          setCreationBrief({
            text: String(result.brief || ''),
            available: result.available === true,
            source: result.source === 'packaged' ? 'packaged' : 'repo',
            editable: list(result.editable),
            syncWarning: result.syncWarning || null,
            unmatched: list(result.unmatched).length > 0 ? list(result.unmatched) : list(early),
          })
        } catch (error) {
          flash('生成改造说明失败：' + String((error && error.message) || error), 'error')
        }
        setCreationBusy(false)
      }

      const copyCreationBrief = async () => {
        const text = creationBrief && creationBrief.text ? creationBrief.text : ''
        if (text === '') return
        try {
          await navigator.clipboard.writeText(text)
          flash('改造说明已复制')
        } catch (error) {
          flash('复制没成功，请手动选中下面的文字', 'error')
        }
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

      const saveWallet = async () => {
        if (walletBusy) return
        const value = Number(walletDraft)
        const max = Number(wallet && wallet.dailyGrantMaxCny) || 10000
        if (walletDraft === null || String(walletDraft).trim() === '' || !Number.isFinite(value) || value < 0 || value > max) {
          flash(`当前余额要填 0 到 ${max} 元之间的数字`, 'error')
          return
        }
        setWalletBusy(true)
        try {
          const result = await postJson(API + '/wallet', { walletCny: value })
          const current = result && Number.isFinite(result.walletCny) ? result.walletCny : value
          setWalletDraft(null)
          await load()
          flash(result && result.changed === false
            ? `当前余额还是 ${yen(current)}`
            : `当前余额已改成 ${yen(current)}`)
        } catch (error) {
          flash('保存失败：' + String((error && error.message) || error), 'error')
        }
        setWalletBusy(false)
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
            ? `已导出 ${name}：经历 ${counts.experiences} 条、事实 ${counts.facts} 条、心情 ${counts.moodPoints} 条、人物 ${counts.people} 位、配置 ${num(counts.configs)} 份`
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
        if (!window.confirm(`导入「${file.name}」会把这条鱼现在的记忆、长期事实、心情和人物志整个换成包里的内容，包里没带的心情、人物志会清空；替换前先备份旧鱼，重启 DSH 后生效。QQ 总开关会先关掉，社交先停在试运行。继续？`)) return
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
      const channels = data.channels || {}
      const wallet = data.wallet || {}
      const biliQuota = wallet.bili || {}
      const backup = data.backup || {}
      const tendencyLines = list(tendencyPreview && tendencyPreview.preview)
      const tendencyBlockers = list(tendencyPreview && tendencyPreview.blockers)
      const tendencyUnmatched = list(tendencyPreview && tendencyPreview.unmatched)
      const tendencyLimit = Number(tendencyPreview && tendencyPreview.maxLength) || 2000
      const tendencyStatus = tendencyPreview && tendencyPreview.applyStatus
      const tendencyStatusText = tendencyStatus === 'applied'
        ? '这段倾向已经写进「她在外面 → 通到 QQ」：主动话量、判断阈值和关注上限就是那边设置页里的值。'
        : tendencyStatus === 'missing'
          ? '还没配置 QQ 桥：这段倾向现在只影响语气；配好后再点一次保存，就会写进「她在外面 → 通到 QQ」。'
          : tendencyStatus === 'drifted'
            ? '你手动改过「她在外面 → 通到 QQ」里的数值，她不会覆盖；下次保存会以你现在的值为基础重算。'
            : '保存后会直接写进「她在外面 → 通到 QQ」的设置页，不用再去那边改两个数。'
      const writableGroups = []
      for (const item of list(data.settings && data.settings.writable)) {
        const found = writableGroups.find((group) => group.page === item.page)
        if (found) found.labels.push(item.label)
        else writableGroups.push({ page: item.page, labels: [item.label] })
      }
      const boundaries = data.boundaries || {}
      const permissions = boundaries.permissions || {}
      const privacy = boundaries.privacy || {}
      const injection = boundaries.injection || {}
      const hard = permissions.hard || {}
      const archive = data.archive || {}
      const pending = archive.pending === true
      const report = archive.report
      const backupName = report && typeof report.backup === 'string' && report.backup !== ''
        ? report.backup.split(/[\\/]/).filter(Boolean).pop()
        : ''

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
        tabStrip(tabs, active, setTab, '大肥鱼设置页'),

        pane('overview', active,
          pageHead({
            title: '大肥鱼',
            intro: '她是怎样一条鱼，今天过得怎么样。下面这些只读，改设置在后面的 tab 里。',
            caps: '本页可以看：能不能说话、心情、零花钱、记忆、作息；日常四项在「她在外面 → 通到 QQ」。',
          }),
          h('div', { 'data-fishm-hero': '' },
            h('div', {},
              h('div', { 'data-fishm-name': '' }, identity.name || '大肥鱼'),
              h('div', { 'data-fishm-sub': '' }, `${identity.species || '鲸鱼娘'} · 出生设定更新于 ${when(identity.updatedAt)}`)),
            h('div', { 'data-fishm-phase': '' }, data.phase || '')),
          h('div', { 'data-fishm-grid': '' },
            h('div', { 'data-fishm-card': '' },
              h('div', { 'data-fishm-cardtitle': '' }, 'QQ',
                h('span', { 'data-fishm-chip': channels.qq && channels.qq.enabled ? 'on' : 'off' },
                  channels.qq && channels.qq.enabled ? '总开关开' : '总开关关')),
              h('div', { 'data-fishm-note': '' },
                channels.qq && channels.qq.available
                  ? `试运行 ${yesNo(channels.qq.trial)} · 社交 ${channels.qq.socialEnabled ? '开' : '关'}${channels.qq.socialTrial ? '（试运行）' : ''}`
                  : '没有配置')),
            h('div', { 'data-fishm-card': '' },
              h('div', { 'data-fishm-cardtitle': '' }, '主动搭话',
                h('span', { 'data-fishm-chip': channels.speakUp && channels.speakUp.enabled ? 'on' : 'off' },
                  channels.speakUp && channels.speakUp.enabled ? '开' : '关')),
              h('div', { 'data-fishm-note': '' },
                channels.speakUp && channels.speakUp.available
                  ? `试运行 ${yesNo(channels.speakUp.trial)} · 目标 ${num(channels.speakUp.targets)} 个会话`
                  : '没有配置')),
            h('div', { 'data-fishm-card': '' },
              h('div', { 'data-fishm-cardtitle': '' }, 'B 站',
                channels.bili && channels.bili.available
                  ? h('span', { 'data-fishm-chip': channels.bili.peakValley ? 'on' : 'off' }, channels.bili.peakValley ? '自动刷开' : '自动刷关')
                  : null),
              h('div', { 'data-fishm-note': '' },
                channels.bili && channels.bili.available
                  ? `每天 ${num(channels.bili.perDay)} 次 · 自动评论 ${yesNo(channels.bili.autoComment)}`
                  : '没有配置')),
            h('div', { 'data-fishm-card': '' },
              h('div', { 'data-fishm-cardtitle': '' }, '朗读',
                channels.tts && channels.tts.available
                  ? h('span', { 'data-fishm-chip': channels.tts.panelOpen ? 'on' : 'off' }, channels.tts.panelOpen ? '卡片开' : '卡片关')
                  : null),
              h('div', { 'data-fishm-note': '' },
                channels.tts && channels.tts.available
                  ? (channels.tts.watchingAll ? '收听全部会话' : `收听 ${num(channels.tts.watching)} 个会话 · 收藏 ${num(channels.tts.favorites)} 条`)
                  : '没有配置'),
              channels.tts && channels.tts.available && channels.tts.panelOpen === false
                ? h('button', {
                    'data-fishm-btn': '',
                    disabled: ttsPanelBusy,
                    onClick: showTtsPanel,
                  }, ttsPanelBusy ? '正在打开…' : '重新显示右下角卡片')
                : null),
            h('div', { 'data-fishm-card': '' },
              h('div', { 'data-fishm-cardtitle': '' }, '心情'),
              h('div', { 'data-fishm-note': '' },
                mood.available ? `${mood.label || ''} ${num(mood.mood)}` : '还没启动过')),
            h('div', { 'data-fishm-card': '' },
              h('div', { 'data-fishm-cardtitle': '' }, '零花钱'),
              h('div', { 'data-fishm-note': '' },
                wallet.available
                  ? `今天已花 ${yen(wallet.spentTodayCny)} · 余额 ${yen(wallet.availableCny)}`
                  : '账本还没启动')),
            h('div', { 'data-fishm-card': '' },
              h('div', { 'data-fishm-cardtitle': '' }, '记忆'),
              h('div', { 'data-fishm-note': '' }, `${num(memory.total)} 条经历 · 今天 ${num(memory.today)} 条`)),
            h('div', { 'data-fishm-card': '' },
              h('div', { 'data-fishm-cardtitle': '' }, '作息',
                data.sleep && data.sleep.enabled
                  ? (data.sleep.state && data.sleep.state.phase === 'sleeping'
                      ? h('span', { 'data-fishm-chip': 'warn' }, '休眠中')
                      : h('span', { 'data-fishm-chip': 'on' }, '醒着'))
                  : h('span', { 'data-fishm-chip': 'off' }, '未启用')),
              h('div', { 'data-fishm-note': '' },
                data.sleep && data.sleep.enabled
                  ? `安静时段 ${data.sleep.start}–${data.sleep.end}；${data.sleep.state ? data.sleep.state.summary : ''}（在「主动搭话」里改）`
                  : '「主动搭话」的安静时段没启用，先不按作息提示'))),
          h('div', { 'data-fishm-note': '' },
            '日常只用管四项：QQ 总开关、主会话转发、群好友发言、在看的房，都在「她在外面 → 通到 QQ」。主动搭话、刷 B 站和零花钱各有自己的 tab。'),
          h('details', { 'data-fishm-details': '' },
            h('summary', {}, '关于她 · 结构、机制和小贴士'),
            h(FishAccordion, { sections: FISH_INTRO }))),

        pane('who', active,
          pageHead({
            title: '她是谁',
            intro: '名字、出生、性格和说话方式；保存后下一轮生效。',
            caps: '本页可以设置：名字、物种、对主人的称呼、外形、来历、说话习惯、群友关系、性格倾向、自定义话术、出厂人设、开发者模式。',
            effect: 'live',
          }),
        h(Section, {
          title: '性格倾向',
          note: '写你希望她长期是什么样。保存时，能落到设置的会直接写进「她在外面 → 通到 QQ」；只能靠语气的会每轮提醒她；需要改代码的，可以交给创造模式。她在外面的群聊里也会看到这段话，别写账号、密码、住址这类只有你该知道的事。安全、隐私、群规、额度和正事不受影响。',
        },
          tendencyError !== ''
            ? h('div', { 'data-fishm-banner': '' }, `现在读不了倾向：${tendencyError}`)
            : h('div', { 'data-fishm-field': '' },
                h('div', { 'data-fishm-actions': '' },
                  h('span', { 'data-fishm-note': '' }, `${tendencyText.length} / ${tendencyLimit} 字`),
                  h('span', { 'data-fishm-note': '' },
                    tendencyPreview && tendencyPreview.updatedAt
                      ? `上次保存 ${when(tendencyPreview.updatedAt)}`
                      : '还没写过')),
                h('textarea', {
                  'data-fishm-input': '',
                  'data-fishm-area': '',
                  'data-fishm-persona': '',
                  rows: 6,
                  value: tendencyText,
                  maxLength: tendencyLimit,
                  placeholder: '例如：群里安静一点，话短一点，别老开玩笑。看到合适的表情包就顺手存下来。',
                  onChange: (event) => setTendencyText(event.target.value),
                }),
                h('div', { 'data-fishm-actions': '' },
                  ['群里安静一点', '话短一点', '少开玩笑', '多主动一点'].map((phrase) => h('button', {
                    'data-fishm-btn': '',
                    type: 'button',
                    key: phrase,
                    onClick: () => addTendencyPhrase(phrase),
                  }, phrase))),
                h('div', { 'data-fishm-note': '' },
                  '先写一句总的（安静/活泼、话短/话长、玩笑多少）；想改主动频率就写「多主动/少主动」，保存后会写进「她在外面 → 通到 QQ」的主动每时和主动每日；具体动作先看预览的落点，需要代码就交给创造模式。'),
                h('div', { 'data-fishm-actions': '' },
                  h('button', {
                    'data-fishm-btn': '',
                    'data-primary': '',
                    type: 'button',
                    disabled: tendencyBusy !== '',
                    onClick: saveTendency,
                  }, tendencyBusy === 'save' ? '保存中…' : '保存倾向'),
                  h('button', {
                    'data-fishm-btn': '',
                    type: 'button',
                    disabled: tendencyBusy !== '' || tendencyText === '',
                    onClick: clearTendency,
                  }, tendencyBusy === 'clear' ? '清空中…' : '清空')),
                tendencyText.trim() === ''
                  ? null
                  : h('div', { 'data-fishm-note': '' }, tendencyStatusText),
                h('div', { 'data-fishm-h': '' }, '她会这样理解'),
                tendencyLines.length === 0
                  ? h('div', { 'data-fishm-note': '' }, tendencyText.trim() === ''
                      ? '还没有写倾向；她会完全按出厂性格说话。'
                      : '这几句还没有专门规则，会按原话作为偏好提示注入。')
                  : h('div', { 'data-fishm-list': '' }, tendencyLines.map((line, index) => h('div', {
                      'data-fishm-item': '',
                      key: index,
                    },
                      h('div', { 'data-fishm-meta': '' },
                        `「${line.clause}」 → ${line.label} `,
                        h('span', {
                          'data-fishm-chip': line.landing === 'settings' || line.landing === 'switch' ? 'on' : line.landing === 'code' ? 'warn' : '',
                        }, line.landingLabel || '')),
                      line.effect || ''))),
                tendencyBlockers.length > 0
                  ? h('div', { 'data-fishm-banner': '' }, '现在有这些阻碍：' + tendencyBlockers.join('；'))
                  : null,
                h('div', { 'data-fishm-note': '' },
                  '安全、隐私、法律、群规、额度和权限永远优先；倾向只能在硬开关允许的范围内改语气和频率。'),
                h('div', { 'data-fishm-actions': '' },
                  h('span', { 'data-fishm-note': '' },
                    tendencyUnmatched.length > 0
                      ? `有 ${tendencyUnmatched.length} 句还没被代码直接支持`
                      : '已经能落地的都落地了'),
                  h('button', {
                    'data-fishm-btn': '',
                    type: 'button',
                    disabled: creationBusy || tendencyText.trim() === '',
                    onClick: openCreation,
                  }, creationBusy ? '正在整理…' : tendencyUnmatched.length > 0 ? '让创造模式来改' : '让创造模式改这条鱼'))),

          h('details', {
            'data-fishm-details': '',
            onToggle: (event) => {
              const open = !!(event && event.currentTarget && event.currentTarget.open)
              setPersonaExpanded(open)
              if (open && persona === null) void loadPersona()
            },
          },
            h('summary', {}, '高级 · 出厂人设（公共提示词，一般不用改）'),
            !personaExpanded
              ? null
              : persona === null
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
                        '这是整段人设前缀，会替换出厂那份。她说到底听谁的：安全、隐私、法律、群规、额度、权限 > QQ 硬开关 > 性格倾向 > 这份人设 > 群语感和心情。不要写 {{变量}}。'),
                      h('div', { 'data-fishm-actions': '' },
                        h('button', {
                          'data-fishm-btn': '',
                          'data-primary': '',
                          type: 'button',
                          disabled: busy !== '',
                          onClick: savePersona,
                        }, busy === 'persona' ? '保存中…' : '保存人设'),
                        h('button', {
                          'data-fishm-btn': '',
                          type: 'button',
                          disabled: busy !== '',
                          onClick: resetPersona,
                        }, busy === 'persona-reset' ? '恢复中…' : '恢复出厂人设'))))),

        h(Section, {
          title: '开发者模式',
          note: '给她一条调试和辅助配置的通道：在你自己的会话里只读查看 DSH 目录里的日志、配置和会话记录；也能读鱼 QQ 的群号和好友号，在对话里帮你改行为设置和 B 站设置。凭据、身份文件、安全边界、预算和鱼脑数据仍然拒绝；每次读名单、读调试资料和改设置都记进审计。',
        },
          h('div', { 'data-fishm-actions': '' },
            勾(permissions.developer === true, (v) => { if (!devBusy) toggleDeveloper(v) }),
            h('span', { 'data-fishm-note': '' }, devBusy
              ? '正在切换…'
              : permissions.developer === true
                ? '已打开：你的前台会话里她能只读看调试资料、读鱼 QQ 名单、帮你改行为设置'
                : '关着：她读不了 DSH 目录，也改不了设置')),
          h('div', { 'data-fishm-h': '' }, '打开后她能帮你改的设置'),
          writableGroups.length === 0
            ? h('div', { 'data-fishm-note': '' }, '设置清单暂时读不到，重启 DSH 后再看。')
            : h('div', { 'data-fishm-list': '' }, writableGroups.map((group, index) => h('div', {
                'data-fishm-item': '',
                key: index,
              },
                h('div', { 'data-fishm-meta': '' }, group.page),
                group.labels.join('、')))),
          h('div', { 'data-fishm-note': '' },
            '在对话里直接说就行，例如「把群里主动话量调到每小时 4 次」「只在这个群里说话」「晚上 1 点到 8 点别主动搭话」。她会先用 fish_qq_roster 读出鱼 QQ 在哪些群、有哪些好友，再把号码写进设置；B 站设置用 bili_config，改自动评论、自动回复和私信收件人时会弹确认。QQ 试运行和总开关、静音时段、最低余额、预算、记忆、权限、凭据和代码不开放。'),
          h('div', { 'data-fishm-actions': '' },
            h('button', {
              'data-fishm-btn': '',
              'data-primary': '',
              type: 'button',
              disabled: devOpening,
              onClick: startDevSession,
            }, devOpening ? '正在打开…' : '用创造模式开一个调试会话'),
            h('span', { 'data-fishm-note': '' },
              '新会话在她自己的安装目录工作区里打开（没有就注册一个），换成创造模式，默认就是完全权限（文件随便写、不再逐条问），她的性格和记忆照常带着；排查完记得把开发者模式关掉。')),
          h('div', { 'data-fishm-note': '' },
            '完全权限只放开宿主那一层：可以读 DSH 目录和本机信息、用自带 Node 跑测试；鱼脑数据（记忆、预算、权限）写入、凭据、身份文件和危险命令仍然拒绝；改过鱼自己的代码要重启 DSH 才生效。')),

        h(Section, {
          title: '出生设定',
          note: '出生设定、性格倾向和话术能改；每日额度在「零花钱」里改；记忆、心情、人物志和安全边界只读。',
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

        pane('memory', active,
          pageHead({
            title: '记忆',
            intro: '只读总览；数据搬迁和自动备份也在这里。自动备份保存后立即生效，导入需要重启。',
            caps: '本页可以看：经历、情景、章节、关系、长期事实、内心、边界；可以改：自动备份；导入需要重启。',
          }),
        h(Section, {
          title: '记忆',
          note: '只读。经历流和明确承诺是两条写入路径；这里不提供“记住这条”。',
        },
          h('div', { 'data-fishm-grid': '' },
            h('div', { 'data-fishm-card': '' }, h('div', { 'data-fishm-cardtitle': '' }, '经历'), h('div', {}, `${num(memory.total)} 条`)),
            h('div', { 'data-fishm-card': '' }, h('div', { 'data-fishm-cardtitle': '' }, '情景'), h('div', {}, `${num(memory.episodes)} 段`)),
            h('div', { 'data-fishm-card': '' }, h('div', { 'data-fishm-cardtitle': '' }, '章节'), h('div', {}, `${num(memory.chapters)} 个`)),
            h('div', { 'data-fishm-card': '' }, h('div', { 'data-fishm-cardtitle': '' }, '关系'), h('div', {}, `${num(memory.relations)} 条`)),
            h('div', { 'data-fishm-card': '' }, h('div', { 'data-fishm-cardtitle': '' }, '长期事实'), h('div', {}, `${num(memory.facts)} 条`)),
            h('div', { 'data-fishm-card': '' }, h('div', { 'data-fishm-cardtitle': '' }, '承诺记忆'), h('div', {}, `${num(memory.commitments)} 条 · 已核对 ${num(memory.commitmentStats && memory.commitmentStats.verified)}`)),
            h('div', { 'data-fishm-card': '' }, h('div', { 'data-fishm-cardtitle': '' }, '今天'), h('div', {}, `${num(memory.today)} 条`)),
            h('div', { 'data-fishm-card': '' }, h('div', { 'data-fishm-cardtitle': '' }, '最近情景'), h('div', {}, when(memory.lastEpisodeAt)))),
          memory.degraded ? h('div', { 'data-fishm-banner': '' }, '检索库现在不可用，她靠经历流继续记住新的事，但旧记忆暂时搜不出来。') : null,
          h('div', { 'data-fishm-note': '' }, '最近承诺记忆'),
          list(memory.recentCommitments).length === 0
            ? h('div', { 'data-fishm-note': '' }, '还没有明确承诺记忆。')
            : h('div', { 'data-fishm-list': '' }, list(memory.recentCommitments).map((item, index) => h('div', {
                'data-fishm-item': '',
                key: index,
              },
                h('div', { 'data-fishm-meta': '' }, `${when(item.at)} · ${item.room || '未知房间'} · ${item.verified ? '已核对' : '没核对'}${item.visibility === 'secret' ? ' · 保密' : ''}`),
                item.text))),
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
                  `${relation.src} · ${relation.relation} · ${relation.dst}`))))),

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

        )),

        pane('money', active,
          pageHead({
            title: '零花钱',
            intro: '她每天能动多少；这不是你的 DeepSeek 账户余额。',
            caps: '本页可以设置：每天额度、当前余额；今天花费和 B 站占比只读。',
            effect: 'live',
          }),
        h(Section, {
          title: '零花钱',
          note: '这是她自己的零花钱账本，不是你的 DeepSeek 账户余额（账户余额在「账号与余额」）。每日额度和当前余额可以在这里改（单位：元）；今天的花费只读；她对外说不了金额。',
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
                h('div', { 'data-fishm-field': '' },
                  h('span', { 'data-fishm-flabel': '' }, '当前余额（元）'),
                  h('input', {
                    'data-fishm-input': '',
                    type: 'number',
                    min: '0',
                    max: String(num(wallet.dailyGrantMaxCny) || 10000),
                    step: '0.01',
                    value: walletDraft !== null ? walletDraft : String(num(wallet.availableCny)),
                    disabled: walletBusy,
                    onChange: (event) => setWalletDraft(event.target.value),
                  }),
                  h('span', { 'data-fishm-note': '' }, '用不完的每日额度会累计到这里；保存后以你填的数为准，之后每天照常发额度。')),
                h('div', { 'data-fishm-actions': '' },
                  h('button', {
                    'data-fishm-btn': '',
                    disabled: walletBusy || walletDraft === null || String(walletDraft).trim() === '',
                    onClick: saveWallet,
                  }, walletBusy ? '保存中…' : '保存当前余额')),
                h(Row, { label: '今天', value: `${yen(wallet.dailyGrantCny)} 额度 · 已花 ${yen(wallet.spentTodayCny)}` }),
                h(Row, { label: '累计余额', value: `${yen(wallet.availableCny)}（每天没花完的额度会攒进来，跨天继续用）` }),
                h(Row, { label: '调用', value: `${num(wallet.callsToday)} 次记账 · ${num(wallet.unmeteredToday)} 次未计价` }),
                h(Row, {
                  label: 'B 站巡检',
                  value: biliQuota.capCny > 0
                    ? `今天 ${yen(biliQuota.spentTodayCny)} / ${yen(biliQuota.capCny)}（每天额度的 ${num(biliQuota.share * 100)}%）`
                    : '不占额度（占比为 0）',
                }),
                h(Row, { label: '模型账户', value: wallet.accountKnown ? `上次读到于 ${when(wallet.accountReadAt)}` : '还没读到' }))
            : h('div', { 'data-fishm-note': '' }, '账本还没启动。'))),

        paneTail('memory', active,
        h('details', { 'data-fishm-details': '' },
          h('summary', {}, '边界'),
          h('div', { 'data-fishm-sec': '' },
            h(Row, { label: '权限层', value: `${permissions.enabled ? '开' : '关'} · 急停 ${permissions.emergencyStop ? '已按下' : '未按'} · 后台会话 ${permissions.autonomous ? '放行' : '全拒'}` }),
            h(Row, { label: '开发者模式', value: permissions.developer ? '开 · 仅主人前台会话只读 DSH 目录、读鱼 QQ 名单、帮改行为设置' : '关' }),
            h(Row, { label: '受保护路径', value: `只读 ${num(permissions.protectedReadPaths)} 处 · 只写 ${num(permissions.protectedWritePaths)} 处 · 鱼脑封存 ${num(permissions.sealedPaths)} 处` }),
            h(Row, { label: '外部 MCP', value: `${num(permissions.mcpReadOnlyTools)} 类只读动作；其他默认拒绝` }),
            h(Row, { label: '硬拒绝', value: hardText.join(' · ') || '—' }),
            h(Row, { label: '隐私', value: `固定私密 ${num(privacy.exactFacts)} 项 · 学到 ${num(privacy.learnedSecrets)} 项 · 护栏 ${list(privacy.hardGuards).join('、') || '—'}` }),
            h(Row, { label: '注入防护', value: `外部结果已标记 ${num(injection.untrustedResults)} 次 · 可疑指令 ${num(injection.suspiciousResults)} 次` }),
            h('div', { 'data-fishm-note': '' }, '这些是代码里的固定规则，设置页只能看，不能改。'))),

        h(Section, {
          title: '搬迁',
          effect: 'restart',
          note: '导出会带走出生设定、记忆、长期事实、心情、人物志、性格倾向和本机设置（鱼脑 / 心情 / QQ / 主动搭话 / 朗读 / B 站）。凭据、账号与群号、目标会话、本机路径、零花钱账本和日志不带走，换机后要重配。旧版本的大肥鱼只认记忆，不认配置。',
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
                  ? `经历 ${num(report.counts && report.counts.experiences)} 条 · 事实 ${num(report.counts && report.counts.facts)} 条 · 心情 ${num(report.counts && report.counts.moodPoints)} 条 · 人物 ${num(report.counts && report.counts.people)} 位${Number.isFinite(report.factsApplied) ? ` · 写回事实 ${num(report.factsApplied)} 条` : ''}${report.configs && report.configs.present ? ` · 配置 ${num(report.configs.applied)} 份${report.configs.skipped ? `（跳过 ${num(report.configs.skipped)}）` : ''}` : ' · 没带配置'}`
                  : `卡在 ${report.stage || '未知步骤'}：${report.error || '没有留下原因'}`,
                report.ok && backupName !== ''
                  ? h('div', { 'data-fishm-note': '' }, `替换前的旧鱼备份在鱼脑目录的 ${backupName}/ 里`)
                  : null)
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
              disabled: busy !== '' || pending,
              onClick: () => { if (fileRef.current) fileRef.current.click() },
            }, busy === 'import' ? '导入中…' : '导入记忆包（zip）')),
          h('div', { 'data-fishm-note': '' }, pending
            ? '包已经验过并暂存好了。重启 DSH 时会换上这条鱼，旧数据会先备份。'
            : '只收大肥鱼自己的记忆包；格式、版本、校验和文件清单有一项不对就不会导入。随时可以导入：这条鱼现在的记忆、长期事实、心情、人物志、出生设定、倾向和可搬的设置会被包里的内容整个换掉，包里没带的心情、人物志和短期水位会清空；替换前旧鱼先整份备份到鱼脑目录的 import-backup-<时间>/，需要回滚直接拷回去。凭据、账号与群号、目标会话、本机路径、零花钱账本和日志不动；QQ 总开关会先关掉，社交先停在试运行，等你确认账号和群之后再打开。导入后需要重启。')),

        h(Section, {
          title: '自动备份',
          note: `整条鱼会按你设的间隔打包到安装目录下的 ${backup.dirName || 'fish-backups'} 文件夹；最多留 5 份，超过就从最旧的删起。只清理大肥鱼自己写的备份，不动你放进去的其它文件。`,
        },
          backupForm === null
            ? h('div', { 'data-fishm-note': '' }, '正在读备份设置…')
            : h('div', { 'data-fishm-grid': '' },
                h('div', { 'data-fishm-card': '' },
                  h('div', { 'data-fishm-cardtitle': '' }, '定时备份'),
                  h('div', { 'data-fishm-actions': '' },
                    勾(backupForm.enabled === true, (v) => { if (backupBusy === '') patchBackup('enabled', v) }),
                    h('span', { 'data-fishm-note': '' }, '每隔一段时间自动打包她现在的记忆')),
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
                  : '还没有备份文件；自动备份关着，可以点「立即备份」。'))),

        pane('memes', active,
          pageHead({
            title: '梗百科',
            intro: '她学来的说法和梗；开关决定她会不会主动用。保存后立即生效。',
            caps: '本页可以设置：5 个用法开关；下面是词条维护，不是设置。',
            effect: 'live',
          }),
          h(MemesPanel)),

        ledger.map((entry) => (visitedTabs.has(entry.id) || active === entry.id
          ? h('div', {
              key: entry.id,
              id: 'fishm-panel-' + entry.id,
              role: 'tabpanel',
              'aria-labelledby': 'fishm-tab-' + entry.id,
              hidden: entry.id !== active,
              'data-fishm-pane': entry.id,
            }, typeof renderSlot === 'function'
              ? renderSlot('settings.fish.tab', {}, { only: entry.id })
              : null)
          : null)),

        msg ? h('div', { 'data-fishm-msg': '', 'data-kind': msgKind }, msg) : null,

        creationBrief
          ? h('div', {
              'data-fishwd-mask': '',
              role: 'dialog',
              'aria-modal': 'true',
              'aria-label': '交给创造模式的说明',
            },
              h('div', { 'data-fishwd-card': '' },
                h('div', { 'data-fishwd-head': '' },
                  h('div', { 'data-fishwd-title': '' }, '交给创造模式')),
                h('div', { 'data-fishwd-body': '' },
                  h('div', { 'data-fishwd-intro': '' }, creationBrief.available
                    ? creationBrief.source === 'packaged'
                      ? '当前目录是安装包带的可编辑源码副本（data/fish-src）。改完完全退出再打开 DSH 才会加载；只有下面说明里列出的文件会生效，内核文件会被安装包原版覆盖。'
                      : '当前目录是源码仓库，可以直接改。下面这份说明只说她要达到的行为和边界，打开创造模式时只填进草稿，不会自动发送。'
                    : '这一版没有源码，改了也编不进去；下面这份说明可以先复制出来，换到源码仓库再改。'),
                  creationBrief.syncWarning && list(creationBrief.syncWarning.warnings).length > 0
                    ? h('div', { 'data-fishm-banner': '' },
                        `上次同步没有生效：${list(creationBrief.syncWarning.warnings).join('；')}`)
                    : null,
                  h('pre', {
                    'data-fishm-prompt': '',
                    style: { maxHeight: '320px', overflow: 'auto' },
                  }, creationBrief.text)),
                h('div', { 'data-fishwd-foot': '' },
                  h('span', { 'data-fishm-note': '' },
                    creationBrief.source === 'packaged'
                      ? '代码改动在 data/fish-src，重启后生效；不进记忆包和导出包。'
                      : '配置和倾向随「导出」走；代码改动跟着源码仓库或安装包走，不会进记忆包。'),
                  h('div', { 'data-fishm-actions': '' },
                    h('button', {
                      'data-fishm-btn': '',
                      type: 'button',
                      onClick: () => setCreationBrief(null),
                    }, '关闭'),
                    h('button', {
                      'data-fishm-btn': '',
                      type: 'button',
                      onClick: copyCreationBrief,
                    }, '复制'),
                    h('button', {
                      'data-fishwd-ok': '',
                      type: 'button',
                      onClick: () => {
                        const text = creationBrief.text
                        setCreationBrief(null)
                        startDevSession({ prompt: text })
                      },
                    }, '打开创造模式')))))
          : null,

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
                    '这些内容现在只是暂存，重启 DSH 后才会整个换上，旧鱼会先备份。选「暂缓」的话，下次重启前都不会生效。')),
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
          '• 零花钱：每次模型调用都会记账，每天有额度（默认 ¥10，用不完累计；可在「大肥鱼 → 零花钱」按元调整）；她本机看得到余额，但在 QQ、B 站等对外内容里绝不提金额',
          '• 边界：隐私、注入防护、法律红线和危险命令是代码里的硬规则，设置页只能看，不能改',
        ],
      },
      {
        title: '你可以设置什么',
        body: [
          '• 出生设定（大肥鱼 → 她是谁）：名字、物种、外形、怎么称呼你、来历、说话习惯，以及可以自由增删的群友关系',
          '• 性格倾向（大肥鱼 → 她是谁）：写一段你希望她长期是什么样。保存时会直接写进「她在外面 → 通到 QQ」的主动每时、主动每日、判断阈值和关注上限；只能靠语气的每轮提醒她；预览会告诉你哪些话写进了设置、哪些只是每轮提示、哪些需要交给创造模式改代码',
          '• 开发者模式（大肥鱼 → 她是谁）：打开后她在你自己的会话里能只读查看调试资料，也能读鱼 QQ 的群号和好友号，再按你的话用 fish_config 改行为设置（群、好友、关掉、只听、少掺和、主动话量、阈值、关注上限、称呼、兴趣词、不聊话题、主动搭话和性格倾向）；B 站设置用 bili_config；安全、预算、凭据和鱼脑数据仍然不开放',
          '• 创造模式（大肥鱼 → 她是谁）：在安装目录工作区里开一个新的完全权限会话，可以读代码、改代码，也可以读 DSH 目录和本机信息、用自带 Node 跑测试；鱼脑数据写入、凭据、身份文件和危险命令仍然拒绝，改完要重启 DSH',
          '• 心情（大肥鱼 → 心情）：称呼和昵称、生效会话、判断模型、是否每轮判断、是否注入、基线、下限',
          '• 主动搭话（她在外面 → 主动搭话）：总开关、试运行、掷骰间隔和命中线、安静时段、冷却、目标会话、触发文案',
          '• QQ（她在外面 → 通到 QQ）：接 SnowLuma / NapCat、选私聊或群、试运行、戳一戳、社交模式和人物志',
          '• B 站（她在外面 → 刷 B 站）：装运行环境、扫码登录、自动刷的时段、挑视频门槛、评论/回评/私信',
          '• 朗读（右下角的「朗读桥」卡片）：勾选要听的会话、自动朗读、收藏；点卡片上的 ✕ 可以关掉，想再显示就回「大肥鱼 → 总览 → 朗读」；还要在浏览器里装扩展，第一次在 DeepSeek 页面手动点一下朗读',
          '• 零花钱（大肥鱼 → 零花钱）：按元调整每日额度，查看今日已花、余额和 B 站巡检额度',
          '• 自动备份（大肥鱼 → 记忆）：开关和间隔（1–720 小时），备份写在安装目录的 fish-backups；最多留 5 份，也能随时立即备份',
        ],
      },
      {
        title: '小贴士',
        body: [
          '1. 记忆存在本机，换窗口、重启都还在；含密码、密钥等凭据的整条经历只留时间和来源，超长正文会截断。日/周/月章节会在后台自动整理',
          '2. 在大肥鱼 → 她是谁里可以随时改她的身份、群友关系、说话风格和性格倾向；倾向会先预览再保存，保存后主动话量等数值会直接出现在「她在外面 → 通到 QQ」设置页',
          '3. 主动搭话要先勾目标会话（出厂试运行关着，掷中就真发；想先只看记录就打开试运行）；到点掷骰子，安静时段不掷，刚聊过更难开口',
          '4. 隐私、法律红线和危险命令的硬规则改不了，改出生设定也改不了',
          '5. 导出 zip 能带走出生设定、记忆、长期事实、心情、人物志、性格倾向和本机设置（鱼脑 / 心情 / QQ / 主动搭话 / 朗读 / B 站）；凭据、账号与群号、目标会话、本机路径、零花钱账本和日志不在包里，换机后要重配。旧版本的大肥鱼只认记忆，不认配置。导入随时可用，会覆盖现在这条鱼、覆盖前先整份备份，重启后生效。自动备份也会按间隔把同样的包写进安装目录的 fish-backups；卸载时会问你要不要连记忆一起删，选保留就留在 data 里',
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
      ['enabled', '启用梗百科', '关掉后不再预查，主动用梗和查询工具也会停用。'],
      ['activeUse', '主动用梗', '聊天轻松时从词库里挑一个合气氛的短说法，自然接进她自己的话；关掉后只解释别人提到的梗。'],
      ['autoInject', '自动预查', '聊天里提到词库里的梗时，自动把用法带进那一轮。'],
      ['socialInject', '群聊和好友也用', '关闭后群里和好友会话不预查、也不主动用梗；主人私下的记忆不会跟出去。'],
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

      const toggle = ([key, label, hint]) => h('div', {
        'data-fishmw-toggle': '',
        'data-off': toggleDisabled(key) ? '' : undefined,
        key,
      },
        h('span', { 'data-fishmw-togglegrow': '' },
          h('span', { 'data-fishmw-toggletitle': '' }, label),
          h('span', { 'data-fishmw-togglenote': '' }, hint)),
        勾(toggleValue(key), (v) => { if (!toggleDisabled(key) && busy === '') setToggle(key, v) }))

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
            h('div', { 'data-fishmw-sub': '' }, '网络梗、流行语和黑话的本地词库。她聊天时会按语境预查，也会挑合适的梗自己用；这里有完整搜索、增删改和开关。'),
            data
              ? h('div', { 'data-fishmw-recent': '' },
                  Array.isArray(data.recent) && data.recent.length > 0
                    ? `最近用过：${data.recent.map((item) => item.title).join('、')}`
                    : '最近还没有主动用过梗')
              : null),
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
          h('div', { 'data-fishm-note': '' }, '自动预查和主动用梗都只看这一轮的上下文；群聊和好友会话只取本群自己的上下文，不碰主人私下的记忆。'),
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

        if (typeof ctx.inject === 'function') {
          ctx.inject(['settingsSearch'], (child) => {
            child.effect(() => {
              const offs = [
                { tabId: 'overview', label: '总览', keywords: ['总览', '状态', '能不能说话', '今天', '心情', '零花钱', '记忆', '作息', '休眠', '睡觉', '睡眠', '关于'], mode: 'view' },
                { tabId: 'who', label: '她是谁', keywords: ['名字', '物种', '主人', '称呼', '外形', '来历', '说话习惯', '群友关系', '性格倾向', '话术', '人设', '开发者模式'], applies: 'live' },
                { tabId: 'memory', label: '记忆', keywords: ['记忆', '经历', '情景', '章节', '关系', '长期事实', '内心', '边界', '搬迁', '导入', '导出', '备份'], applies: 'live' },
                { tabId: 'money', label: '零花钱', keywords: ['零花钱', '额度', '余额', '花费', 'B站巡检'], applies: 'live' },
                { tabId: 'memes', label: '梗百科', keywords: ['梗', '梗百科', '词条', '表情', '用法'], applies: 'live' },
              ].map((item) => child.settingsSearch.register({
                sectionId: 'fish',
                tabId: item.tabId,
                label: () => item.label,
                keywords: () => item.keywords,
                ...(item.applies ? { applies: item.applies } : {}),
                ...(item.mode ? { mode: item.mode } : {}),
              }))
              return () => { for (const off of offs) off() }
            }, 'dsh-fish-mind: settings search')
          })
        }

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

        const fishTabsHook = makeLedgerHook(slots, 'settings.fish.tab')
        const outsideTabsHook = makeLedgerHook(slots, 'settings.outside.tab')
        slots.inject('settings.section', () => slots.register(
          {
            name: 'settings.section',
            id: 'fish',
            order: -40,
            label: '大肥鱼',
            children: { 'settings.fish.tab': { kind: 'list', scope: 'root' } },
            inject: () => ({ hooks: { tabs: fishTabsHook } }),
          },
          (props) => h(Panel, {
            ...(props || {}),
            openDevSession: async (options) => {
              const workspace = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined
              if (!workspace || typeof workspace.startSession !== 'function') return false
              const workspaces = typeof ctx.get === 'function' ? ctx.get('workspaces') : undefined
              if (!workspaces || typeof workspaces.create !== 'function') {
                throw new Error('宿主没有工作区入口，没法把安装目录注册成工作区')
              }
              const creation = await getJson(API + '/creation')
              const root = creation && typeof creation.checkout === 'string' ? creation.checkout : ''
              if (root === '') throw new Error('宿主没有给出安装目录')
              const view = await workspaces.create({ path: root })
              const workspaceId = view && view.workspaceId
              if (workspaceId === undefined) throw new Error('安装目录没能注册成工作区')
              const prompt = options && typeof options.prompt === 'string' ? options.prompt : ''
              const sessionOptions = { clearPreviousDraft: false, agentPreset: 'cordis' }
              if (prompt !== '') sessionOptions.prompt = prompt
              workspace.startSession(workspaceId, sessionOptions)
              return true
            },
          }),
        ))
        slots.inject('settings.section', () => slots.register(
          {
            name: 'settings.section',
            id: 'outside',
            order: -35,
            label: '她在外面',
            children: { 'settings.outside.tab': { kind: 'list', scope: 'root' } },
            inject: () => ({ hooks: { tabs: outsideTabsHook } }),
          },
          (props) => h(OutsideTabs, props || {}),
        ))
      },
    }
  },
})
