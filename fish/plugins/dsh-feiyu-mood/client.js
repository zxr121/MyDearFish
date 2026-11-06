/**
 * dsh-feiyu-mood —— 浏览器半端（设置里的一页「心情」）
 * ============================================================================
 * 自注册脚本（和 dsh-bili-scroll 一样的约定）：
 *
 *     window.__ModuleLoader__.load({ id: '<包名>', factory: (require) => ({ inject, apply }) })
 *
 * 这一页要满足的想法（主人 2026-10-19）：
 *   · 心情插件**也能给别人用** ⇒ 名字得能改（她叫什么叫什么、你叫什么叫什么）
 *   · 目标会话、基线、下限、注入开关、自动判断开关，都在面板里改，不用去翻 config.json
 *   · 改完**立刻生效**（宿主那边是原地改 cfg，不用重启）
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-feiyu-mood',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const API = '/dsh-feiyu-mood'
    const MIND_API = '/dsh-fish-mind/inner'
    const FAMILY_LABELS = {
      joy: '喜', anger: '怒', sorrow: '哀', fear: '惧',
      love: '爱', dislike: '恶', desire: '欲', calm: '静',
    }

    // 五档表情：用的就是挂饰那五张图（assets/face-*.png，448×352）
    const faceImg = (v) => {
      const m = Number(v)
      if (!Number.isFinite(m)) return API + '/face-ok.png'
      if (m >= 80) return API + '/face-great.png'
      if (m >= 62) return API + '/face-good.png'
      if (m >= 42) return API + '/face-ok.png'
      if (m >= 25) return API + '/face-worry.png'
      return API + '/face-sad.png'
    }

    const getJson = async (url) => {
      const res = await fetch(url, { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return res.json()
    }
    const postJson = async (url, body) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return res.json()
    }

    const CSS = `
[data-fm-wrap]{display:flex;flex-direction:column;gap:14px;padding:4px 2px 24px;}
[data-fm-hero]{display:flex;align-items:center;gap:14px;padding:14px 16px;border-radius:12px;background:rgba(127,127,127,.08);}
[data-fm-face]{width:84px;height:66px;object-fit:contain;border-radius:10px;flex:0 0 auto;background:rgba(127,127,127,.10);}
[data-fm-kicker]{font-size:11px;line-height:1.4;letter-spacing:.08em;opacity:.5;}
[data-fm-titlerow]{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:2px;}
[data-fm-title]{font-size:22px;line-height:1.35;font-weight:600;}
[data-fm-chip]{font-size:11px;line-height:1.4;padding:1px 7px;border-radius:999px;background:rgba(127,127,127,.12);opacity:.75;}
[data-fm-detail]{font-size:13px;line-height:1.5;opacity:.9;margin-top:4px;}
[data-fm-cue]{font-size:12px;line-height:1.5;opacity:.62;margin-top:4px;}
[data-fm-baseline]{font-size:12px;line-height:1.5;opacity:.55;margin-top:8px;}
[data-fm-details]{border-top:1px solid rgba(127,127,127,.18);padding-top:8px;}
[data-fm-details]>summary{cursor:pointer;font-size:13px;font-weight:600;opacity:.85;line-height:1.6;}
[data-fm-details][open]>summary{margin-bottom:8px;}
[data-fm-big]{font-size:30px;font-weight:600;line-height:1;}
[data-fm-sub]{font-size:12px;opacity:.7;margin-top:4px;}
[data-fm-sec]{display:flex;flex-direction:column;gap:8px;}
[data-fm-h]{font-size:13px;font-weight:600;opacity:.85;padding-top:6px;border-top:1px solid rgba(127,127,127,.18);}
[data-fm-note]{font-size:12px;opacity:.62;line-height:1.5;}
[data-fm-pagehead]{display:flex;flex-direction:column;gap:6px;padding:4px 2px 14px;margin-bottom:2px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16));}
[data-fm-pagehead-title]{font-size:20px;line-height:28px;font-weight:500;letter-spacing:-.01em;}
[data-fm-caps]{font-size:12px;line-height:1.7;padding:8px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06));border-left:2px solid var(--dsw-alias-state-business-primary,#5096ff);color:var(--dsw-alias-label-secondary,rgba(127,127,127,.8));}
[data-fm-row]{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
[data-fm-grow]{flex:1;min-width:180px;}
[data-fm-label]{font-size:13px;}
[data-fm-value]{font-size:13px;opacity:.85;}
[data-fm-input]{padding:6px 9px;border-radius:7px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;font-size:13px;min-width:120px;}
select[data-fm-input]>option{background:var(--dsw-alias-bg-layer-1,#1e1e1e);color:var(--dsw-alias-label-primary,inherit);}
[data-fm-num]{width:88px;min-width:88px;}
[data-fm-pill]{display:inline-flex;align-items:center;gap:2px;padding:2px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:999px;}
[data-fm-pill] button{border:none;border-radius:999px;padding:3px 12px;font-size:12px;line-height:1.4;background:transparent;color:inherit;cursor:pointer;opacity:.5;font-weight:400;}
[data-fm-pill] button[aria-pressed="true"]{opacity:1;font-weight:500;}
[data-fm-pill] button[data-on="true"][aria-pressed="true"]{background:var(--dsw-alias-state-business-primary);color:var(--dsw-static-neutral-00,#fff);}
[data-fm-pill] button[data-on="false"][aria-pressed="true"]{background:var(--dsw-alias-border-l2,rgba(127,127,127,.28));}
[data-fm-btn]{padding:6px 12px;border-radius:7px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;font-size:13px;cursor:pointer;}
[data-fm-btn]:hover{background:rgba(127,127,127,.12);}
[data-fm-btn][disabled]{opacity:.5;cursor:default;}
[data-fm-msg]{font-size:12px;opacity:.8;min-height:16px;}
[data-fm-tl]{display:flex;flex-direction:column;gap:2px;max-height:280px;overflow:auto;}
[data-fm-tlrow]{display:flex;gap:8px;font-size:12px;line-height:1.6;}
[data-fm-time]{opacity:.55;width:78px;flex:0 0 78px;}
[data-fm-mood]{opacity:.85;width:34px;flex:0 0 34px;}
[data-fm-delta]{width:40px;flex:0 0 40px;opacity:.8;}
[data-fm-reason]{opacity:.85;}
`

    function Panel() {
      const [cfg, setCfg] = React.useState(null)
      const [st, setSt] = React.useState(null)
      const [sessions, setSessions] = React.useState([])
      const [models, setModels] = React.useState([])
      const [busy, setBusy] = React.useState('')
      const [msg, setMsg] = React.useState('')

      const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 2500) }

      const load = React.useCallback(async () => {
        try {
          const [c, s, mind] = await Promise.all([
            getJson(API + '/config'),
            getJson(API + '/state'),
            getJson(MIND_API).catch(() => null),
          ])
          if (c && c.config) setCfg(c.config)
          if (s && s.ok) setSt({ ...s, inner: (mind && mind.ok && mind.inner) || null })
        } catch (e) {
          setMsg('读取失败：' + (e && e.message))
        }
      }, [])

      React.useEffect(() => {
        load()
        getJson(API + '/sessions').then((r) => setSessions((r && r.sessions) || [])).catch(() => {})
        getJson(API + '/models').then((r) => setModels((r && r.providers) || [])).catch(() => {})
        const t = setInterval(() => {
          getJson(API + '/state').then((s) => {
            if (!s || !s.ok) return
            setSt((current) => ({ ...s, inner: (current && current.inner) || null }))
          }).catch(() => {})
          getJson(MIND_API).then((r) => {
            if (r && r.ok && r.inner) setSt((current) => ({ ...(current || {}), inner: r.inner }))
          }).catch(() => {})
        }, 20000)
        return () => clearInterval(t)
      }, [load])

      const patch = async (p, label) => {
        setCfg((c) => ({ ...c, ...p }))
        try {
          const r = await postJson(API + '/config', p)
          if (r && r.config) setCfg(r.config)
          flash((label || '设置') + ' 已保存')
        } catch (e) { flash('保存失败：' + (e && e.message)) }
      }

      const onReset = async () => {
        setBusy('reset')
        try {
          await postJson(API + '/reset', {})
          await load()
          flash('已重置到基线')
        } catch (e) { flash('重置失败：' + (e && e.message)) }
        setBusy('')
      }

      if (!cfg) return h('div', { 'data-fm-wrap': '' }, h('div', { 'data-fm-note': '' }, '读取中…'))

      const 勾 = (值, onChange) => {
        const 开 = !!值
        const 段 = (文本, 选中, 目标) => h('button', {
          type: 'button',
          'data-on': 目标 ? 'true' : 'false',
          'aria-pressed': 选中,
          style: {
            minWidth: 30,
            border: 'none',
            borderRadius: 999,
            padding: '4px 11px',
            fontFamily: 'inherit',
            fontSize: 12,
            lineHeight: '16px',
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
          'data-fm-pill': '',
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            padding: 2,
            border: '0.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,.28))',
            borderRadius: 999,
            background: 'var(--dsw-alias-bg-layer-1, rgba(127,127,127,.06))',
          },
        }, 段('开', 开, true), 段('关', !开, false))
      }

      const numInput = (key, label, note, min, max) => h('div', { 'data-fm-row': '' },
        h('div', { 'data-fm-grow': '' },
          h('div', { 'data-fm-label': '' }, label),
          note ? h('div', { 'data-fm-note': '' }, note) : null),
        h('input', {
          'data-fm-input': '', 'data-fm-num': '', type: 'number', min, max,
          value: String(cfg[key] ?? ''),
          onChange: (e) => setCfg((c) => ({ ...c, [key]: e.target.value })),
          onBlur: () => {
            const n = Math.max(min, Math.min(Number(cfg[key]) || 0, max))
            patch({ [key]: n }, label)
          },
        }))

      const inner = st && st.inner && st.inner.enabled !== false ? st.inner : null
      const innerAffect = inner && inner.affect ? inner.affect : null
      const mood = st && st.mood != null ? st.mood : null
      const moodLabel = (st && st.moodLabel) || ''
      const hasInner = Boolean(innerAffect && innerAffect.phrase)
      const headline = hasInner ? innerAffect.phrase : (moodLabel || '还没有记录')
      const urge = inner && Array.isArray(inner.urges) && inner.urges[0] ? inner.urges[0].phrase : ''
      const rawCue = inner && inner.cue && inner.cue.text ? inner.cue.text : ''
      // 只被脱敏标记占满的由头没有信息量，不占主卡；长由头压到两行以内。
      const cue = rawCue && !/^\[[^\]]*已隐去\]$/.test(rawCue.trim())
        ? (rawCue.length > 90 ? rawCue.slice(0, 90) + '…' : rawCue)
        : ''
      const family = innerAffect && innerAffect.family ? (FAMILY_LABELS[innerAffect.family] || '') : ''
      const detail = urge || (st && st.lastReason) || '跟 TA 聊起来就有了'
      const baseline = mood != null
        ? `底色 ${mood}${moodLabel ? ' · ' + moodLabel : ''}${st && st.updatedAt ? ' · ' + new Date(st.updatedAt).toLocaleString() : ''}`
        : '还没有心情记录'

      return h('div', { 'data-fm-wrap': '' },
        h('div', { 'data-fm-pagehead': '' },
          h('div', { 'data-fm-pagehead-title': '' }, '心情'),
          h('div', { 'data-fm-caps': '' }, '本页可以设置：开关、判断模型、基线/下限；可以看：此刻的内心摘要和原始记录。名字跟「大肥鱼 → 她是谁」走。'),
          h('div', { 'data-fm-note': '' }, '内心摘要由鱼脑提供；鱼脑没挂时退回心情自身的标签。保存后立即生效。')),

        /* ── 此刻 ── */
        h('div', { 'data-fm-hero': '' },
          h('img', { 'data-fm-face': '', src: faceImg(mood), alt: '' }),
          h('div', { 'data-fm-grow': '' },
            h('div', { 'data-fm-kicker': '' }, hasInner ? '此刻 · 鱼脑内心' : '此刻'),
            h('div', { 'data-fm-titlerow': '' },
              h('span', { 'data-fm-title': '' }, headline),
              family ? h('span', { 'data-fm-chip': '' }, family) : null),
            h('div', { 'data-fm-detail': '' }, detail),
            cue ? h('div', { 'data-fm-cue': '' }, `心里挂着：${cue}`) : null,
            h('div', { 'data-fm-baseline': '' }, baseline))),

        /* ── 开关 ── */
        h('div', { 'data-fm-sec': '' },
          h('div', { 'data-fm-h': '' }, '开关'),
          h('div', { 'data-fm-row': '' },
            h('div', { 'data-fm-grow': '' },
              h('div', { 'data-fm-label': '' }, '每轮判断心情'),
              h('div', { 'data-fm-note': '' }, '关掉就完全不判断、不改数值（也不花判断的 token）')),
            勾(cfg.autoJudge, (v) => patch({ autoJudge: v }, '自动判断'))),
          h('div', { 'data-fm-row': '' },
            h('div', { 'data-fm-grow': '' },
              h('div', { 'data-fm-label': '' }, '把当前心情注入对话'),
              h('div', { 'data-fm-note': '' }, '关掉她就不会被心情影响口气（挂饰还照常显示）；鱼脑内心层也在描述此刻时，建议关掉这一段，只留一个声音')),
            勾(cfg.injectMood, (v) => patch({ injectMood: v }, '心情注入')))),

        /* ── 在哪个会话里生效 ── */
        h('div', { 'data-fm-sec': '' },
          h('div', { 'data-fm-h': '' }, '在哪个会话里生效'),
          h('div', { 'data-fm-note': '' }, '心情是全局一份，但只在下面这个会话里判断和注入。换会话不用重启。'),
          h('select', {
            'data-fm-input': '', value: cfg.targetSession || '',
            onChange: (e) => patch({ targetSession: e.target.value }, '目标会话'),
          },
            h('option', { value: '' }, '（未选）'),
            (sessions || []).map((s) => h('option', { key: s.id, value: s.id }, s.title)),
            // 当前值不在列表里（比如归档了）也要能看到
            cfg.targetSession && !(sessions || []).some((s) => s.id === cfg.targetSession)
              ? h('option', { value: cfg.targetSession }, '（当前：' + cfg.targetSession.slice(0, 18) + '…）')
              : null)),

        /* ── 判断设置 ── */
        h('details', { 'data-fm-details': '' },
          h('summary', {}, '判断设置'),
          h('div', { 'data-fm-sec': '' },
            h('div', { 'data-fm-note': '' }, '心情判断是一次很短的小调用。想更准就指到更强的模型，想省钱就指到便宜的；留空 = 跟着当前会话的模型走。'),
            h('div', { 'data-fm-row': '' },
              h('div', { 'data-fm-grow': '' }, h('div', { 'data-fm-label': '' }, 'provider（厂商）')),
              h('select', {
                'data-fm-input': '', value: cfg.judgeProvider || '',
                onChange: (e) => {
                  const v = e.target.value
                  const list = ((models || []).find((p) => p.id === v)?.models) || []
                  const nextModel = v ? (list[0]?.id || '') : ''
                  setCfg((c) => ({ ...c, judgeProvider: v, judgeModel: nextModel }))
                  patch({ judgeProvider: v, judgeModel: nextModel }, '判断模型')
                },
              },
                h('option', { value: '' }, '（跟随当前会话）'),
                (models || []).map((p) => h('option', { key: p.id, value: p.id }, p.name || p.id)),
                cfg.judgeProvider && !(models || []).some((p) => p.id === cfg.judgeProvider)
                  ? h('option', { value: cfg.judgeProvider }, cfg.judgeProvider)
                  : null)),
            h('div', { 'data-fm-row': '' },
              h('div', { 'data-fm-grow': '' }, h('div', { 'data-fm-label': '' }, 'model（型号）')),
              h('select', {
                'data-fm-input': '', value: cfg.judgeModel || '', disabled: !cfg.judgeProvider,
                onChange: (e) => { const v = e.target.value; setCfg((c) => ({ ...c, judgeModel: v })); patch({ judgeModel: v }, '判断模型') },
              },
                h('option', { value: '' }, '（跟随默认模型）'),
                (((models || []).find((p) => p.id === cfg.judgeProvider) || {}).models || [])
                  .map((m) => h('option', { key: m.id, value: m.id }, m.name || m.id)),
                cfg.judgeModel && !((((models || []).find((p) => p.id === cfg.judgeProvider) || {}).models) || []).some((m) => m.id === cfg.judgeModel)
                  ? h('option', { value: cfg.judgeModel }, cfg.judgeModel)
                  : null)))),

        /* ── 底色与原始记录 ── */
        h('details', { 'data-fm-details': '' },
          h('summary', {}, '底色与原始记录'),
          h('div', { 'data-fm-sec': '' },
            h('div', { 'data-fm-row': '' },
              h('div', { 'data-fm-grow': '' },
                h('div', { 'data-fm-big': '' }, (mood != null ? mood : '—') + (moodLabel ? '　' + moodLabel : '')),
                h('div', { 'data-fm-sub': '' },
                  ((st && st.lastReason) || '还没有记录 —— 跟 TA 聊起来就有了')
                  + (st && st.updatedAt ? '（' + new Date(st.updatedAt).toLocaleString() + '）' : ''))),
              h('button', { 'data-fm-btn': '', disabled: busy === 'reset', onClick: onReset }, '重置到基线')),
            h('div', { 'data-fm-tl': '' },
              ((st && st.timeline) || []).slice().reverse().slice(0, 40).map((t, i) => h('div', { 'data-fm-tlrow': '', key: i },
                h('span', { 'data-fm-time': '' }, new Date(t.at).toLocaleString()),
                h('span', { 'data-fm-mood': '' }, String(t.mood)),
                h('span', { 'data-fm-delta': '' }, (t.delta > 0 ? '+' : '') + (t.delta ?? 0)),
                h('span', { 'data-fm-reason': '' }, t.reason || '—')))),
            (st && st.timeline && st.timeline.length > 40
              ? h('div', { 'data-fm-note': '' }, '只显示最近 40 条，共 ' + st.timeline.length + ' 条')
              : null),
            numInput('moodBase', '基线心情', '没情绪时心情会慢慢回到这个数（30–100）', 30, 100),
            numInput('moodFloor', '心情下限', '最低能掉到多少；0 = 不设底线（0–100）', 0, 100))),

        /* ── 称呼与昵称 ── */
        h('details', { 'data-fm-details': '' },
          h('summary', {}, '称呼与昵称'),
          h('div', { 'data-fm-sec': '' },
            h('div', { 'data-fm-note': '' }, '名字跟「大肥鱼 → 她是谁」走，改那边会自动同步过来；这里只读。'),
            h('div', { 'data-fm-row': '' },
              h('div', { 'data-fm-grow': '' }, h('div', { 'data-fm-label': '' }, '被关心的那个人')),
              h('span', { 'data-fm-value': '' }, cfg.ownerName || '—')),
            h('div', { 'data-fm-row': '' },
              h('div', { 'data-fm-grow': '' }, h('div', { 'data-fm-label': '' }, '她自己叫什么')),
              h('span', { 'data-fm-value': '' }, cfg.selfName || '—')),
            h('div', { 'data-fm-row': '' },
              h('div', { 'data-fm-grow': '' },
                h('div', { 'data-fm-label': '' }, 'TA 平时怎么叫你（昵称）'),
                h('div', { 'data-fm-note': '' }, '逗号分隔，比如：大肥鱼,宝宝,老婆,鱼鱼。判断时会把这些词当成「在叫你」，不会把「宝宝视频」当成一个东西')),
              h('input', {
                'data-fm-input': '', value: cfg.selfAliases || '',
                placeholder: '大肥鱼,宝宝,老婆',
                onChange: (e) => setCfg((c) => ({ ...c, selfAliases: e.target.value })),
                onBlur: () => patch({ selfAliases: cfg.selfAliases }, '昵称'),
              })))),

        h('div', { 'data-fm-msg': '' }, msg),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-feiyu-mood')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-feiyu-mood: 设置页样式')

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        if (typeof ctx.inject === 'function') {
          ctx.inject(['settingsSearch'], (child) => {
            child.effect(() => child.settingsSearch.register({
              sectionId: 'fish',
              tabId: 'mood',
              label: () => '心情',
              keywords: () => ['心情', '情绪', '内心', '此刻', '摘要', '判断', '模型', '基线', '下限', '称呼', '昵称'],
              applies: 'live',
            }), 'dsh-feiyu-mood: settings search')
          })
        }
        slots.inject('settings.fish.tab', () => slots.register(
          { name: 'settings.fish.tab', id: 'mood', order: 30, label: '心情' },
          () => h(Panel),
        ))
      },
    }
  },
})
