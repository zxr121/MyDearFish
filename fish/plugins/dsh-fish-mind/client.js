/**
 * dsh-fish-mind —— 浏览器半端（设置里的一页「大肥鱼」）
 * ============================================================================
 * 这一页给主人看完整的一条鱼：
 *   · 出生设定：名字、物种、外形、称呼、来历、说话习惯，只有这里能改；
 *   · 记忆、心情、人物志、通道、零花钱、边界：只读总览，不改；
 *   · 搬迁：导出整条鱼为一个 zip，导入只收合法的大肥鱼包，而且只进空鱼。
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
[data-fishm-flabel]{font-size:12px;opacity:.72;}
[data-fishm-input]{padding:6px 9px;border-radius:7px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;font-size:13px;width:100%;box-sizing:border-box;}
[data-fishm-area]{min-height:58px;resize:vertical;font-family:inherit;line-height:1.5;}
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
[data-fishm-msg]{font-size:12px;opacity:.82;min-height:16px;line-height:1.6;}
[data-fishm-msg[data-kind="error"]{color:#d4685f;opacity:1;}
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

    function Panel() {
      const [data, setData] = React.useState(null)
      const [form, setForm] = React.useState(null)
      const [busy, setBusy] = React.useState('')
      const [msg, setMsg] = React.useState('')
      const [msgKind, setMsgKind] = React.useState('')
      const fileRef = React.useRef(null)

      const flash = (text, kind) => {
        setMsg(text)
        setMsgKind(kind || '')
        if (kind !== 'error') setTimeout(() => setMsg(''), 4000)
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
                origin: next.identity.origin,
                style: next.identity.style,
              }
            : current))
        } catch (error) {
          flash('读取失败：' + String((error && error.message) || error), 'error')
        }
      }, [])

      React.useEffect(() => {
        load()
        const timer = setInterval(() => { void load() }, 30000)
        return () => clearInterval(timer)
      }, [load])

      const patch = (key, value) => setForm((current) => ({ ...(current || {}), [key]: value }))

      const saveBirth = async () => {
        setBusy('birth')
        try {
          const result = await postJson(API + '/birth', form)
          if (result && result.identity) {
            const identity = result.identity
            setForm({
              name: identity.name,
              species: identity.species,
              appearance: identity.appearance,
              ownerAddress: identity.ownerAddress,
              origin: identity.origin,
              style: identity.style,
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
          flash(counts
            ? `导入包已收下：经历 ${counts.experiences} 条、事实 ${counts.facts} 条、心情 ${counts.moodPoints} 条、人物 ${counts.people} 位。重启 DSH 后生效。`
            : '导入包已收下，重启 DSH 后生效。')
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
      const memory = data.memory || {}
      const mood = data.mood || {}
      const inner = data.inner || {}
      const social = data.social || {}
      const channels = data.channels || {}
      const wallet = data.wallet || {}
      const biliQuota = wallet.bili || {}
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
          title: '出生设定',
          note: '只有这一块能改。记忆、心情、人物志、通道和零花钱只读；固定内核和安全边界不在设置里。',
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
            })),
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
          title: '记忆',
          note: '只读。经历流是唯一的写入路径，这里不提供“记住这条”。',
        },
          h('div', { 'data-fishm-grid': '' },
            h('div', { 'data-fishm-card': '' }, h('div', { 'data-fishm-cardtitle': '' }, '经历'), h('div', {}, `${num(memory.total)} 条`)),
            h('div', { 'data-fishm-card': '' }, h('div', { 'data-fishm-cardtitle': '' }, '情景'), h('div', {}, `${num(memory.episodes)} 段`)),
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
              h('div', { 'data-fishm-cardtitle': '' }, '朗读'),
              channels.tts && channels.tts.available
                ? h('div', { 'data-fishm-note': '' }, channels.tts.watchingAll ? '收听全部会话' : `收听 ${num(channels.tts.watching)} 个会话 · 收藏 ${num(channels.tts.favorites)} 条`)
                : h('div', { 'data-fishm-note': '' }, '没有配置')),
            h('div', { 'data-fishm-card': '' },
              h('div', { 'data-fishm-cardtitle': '' }, 'B 站'),
              channels.bili && channels.bili.available
                ? h('div', { 'data-fishm-note': '' }, `每天 ${num(channels.bili.perDay)} 次 · 错峰 ${yesNo(channels.bili.peakValley)} · 自动评论 ${yesNo(channels.bili.autoComment)} · 投递位置 ${channels.bili.targetReady ? '已配' : '未配'}`)
                : h('div', { 'data-fishm-note': '' }, '没有配置')))),

        h(Section, {
          title: '零花钱',
          note: '这是本机账本，只在这里看；她对外说不了金额。',
        },
          wallet.available
            ? h('div', {},
                h(Row, { label: '今日', value: `${yen(wallet.dailyGrantCny)} 出生额度 · 已花 ${yen(wallet.spentTodayCny)} · 还余 ${yen(wallet.availableCny)}` }),
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
            ? h('div', { 'data-fishm-banner': '' }, '有一个导入包已经收下，等重启 DSH 生效。重启前不要再次导入。')
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

        msg ? h('div', { 'data-fishm-msg': '', 'data-kind': msgKind }, msg) : null)
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
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'fish', order: 20, label: '大肥鱼' },
          () => h(Panel),
        ))
      },
    }
  },
})
