// DSH「通到 QQ」· 网页半边
//
// 只干一件事：在 **DSH 设置** 左侧栏加一项「通到 QQ」，
// 摆出：总开关 / 试运行 / 目标会话（下拉选，不手填）/ 私聊QQ / 群号 / 转私聊 / 转群，
// 外加社交模式：群 / 好友清单、接话冷却、静音、判断与回复模型、当前状态，
// 以及「翻旧记录」：从 Tulpa 读已有的私聊记录进她的经历流（只读，可继续 / 可停 / 可重来）。
// 加「测试一句」「保存设置」和一份最近记录。
//
// ⚠ 这里不碰会话、不发消息，只是往宿主那几条 /dsh-qq-bridge/* 路由上读写。
// ⚠ 令牌从服务器只拿回掩码；原样保存不会改动真令牌。

window.__ModuleLoader__.load({
  id: 'dsh-qq-bridge',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const inject = ['slots']

    const B = '/dsh-qq-bridge'
    const get = (p) => fetch(B + p, { cache: 'no-store' }).then((r) => r.json()).catch(() => null)
    const post = (p, body) =>
      fetch(B + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
        .then((r) => r.json())
        .catch(() => null)

    const h = React.createElement

    const S = {
      wrap: {
        padding: '12px 14px 24px',
        fontSize: 13,
        lineHeight: 1.7,
        background: 'var(--dsw-alias-bg-layer-1, rgba(255,255,255,.92))',
        border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))',
        borderRadius: 12,
      },
      h: { fontSize: 14, fontWeight: 600, margin: '16px 0 8px' },
      dim: { opacity: 0.62, fontSize: 12 },
      card: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 8,
        padding: '10px 12px',
        marginBottom: 10,
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      row: { display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8, flexWrap: 'wrap' },
      lab: { minWidth: 190, paddingTop: 3, fontSize: 12.5 },
      ctl: { flex: '1 1 260px', minWidth: 220 },
      hint: { opacity: 0.6, fontSize: 11.5, marginTop: 2 },
      input: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6,
        padding: '4px 8px',
        background: 'transparent',
        color: 'inherit',
        fontSize: 12.5,
        width: '100%',
        boxSizing: 'border-box',
      },
      area: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6,
        padding: '4px 8px',
        background: 'transparent',
        color: 'inherit',
        fontSize: 12.5,
        width: '100%',
        minHeight: 54,
        resize: 'vertical',
        boxSizing: 'border-box',
        fontFamily: 'ui-monospace, Consolas, monospace',
      },
      small: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6,
        padding: '4px 8px',
        background: 'transparent',
        color: 'inherit',
        fontSize: 12.5,
        width: 140,
        boxSizing: 'border-box',
      },
      // 原生下拉的弹出层自己画白底、只继承字色：不给选项带底色，暗色主题下就是白底白字。
      option: {
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
      },
      ok: { color: 'var(--dsw-alias-state-business-primary)', fontSize: 12 },
      已同步: { margin: '6px 0 10px', fontSize: 12, color: 'var(--dsw-alias-state-business-primary)' },
      未保存: { margin: '6px 0 10px', fontSize: 12, color: '#c0392b', fontWeight: 600 },
      悬浮保存条: {
        position: 'sticky',
        bottom: 0,
        marginTop: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        padding: '8px 12px',
        borderRadius: 10,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1, rgba(255,255,255,.95))',
        boxShadow: '0 -6px 18px rgba(0,0,0,.18)',
        zIndex: 5,
      },
      btn: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6,
        padding: '4px 12px',
        background: 'transparent',
        color: 'inherit',
        fontSize: 12,
        cursor: 'pointer',
      },
      btnOn: {
        border: '1px solid var(--dsw-alias-state-business-primary)',
        borderRadius: 6,
        padding: '4px 12px',
        background: 'var(--dsw-alias-state-business-primary)',
        color: '#fff',
        fontSize: 12,
        cursor: 'pointer',
      },
      日志行: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 11.5, whiteSpace: 'pre-wrap' },
      绪行: {
        cursor: 'pointer',
        padding: '3px 0',
        borderTop: '1px solid var(--dsw-alias-border-l2)',
      },
      绪标: {
        display: 'inline-block',
        minWidth: 36,
        textAlign: 'center',
        marginRight: 6,
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 4,
        padding: '0 4px',
        fontSize: 11,
        opacity: 0.85,
      },
      绪详: {
        fontFamily: 'ui-monospace, Consolas, monospace',
        fontSize: 11.5,
        whiteSpace: 'pre-wrap',
        margin: '2px 0 6px',
        padding: '4px 8px',
        borderRadius: 6,
        border: '1px dashed var(--dsw-alias-border-l2)',
        opacity: 0.9,
      },
    }

    const 提示 = (文本) => h('div', { style: S.hint }, 文本)
    const 行 = (标签, 控件, 说明) =>
      h('div', { style: S.row }, h('div', { style: S.lab }, 标签), h('div', { style: S.ctl }, 控件, 说明 ? 提示(说明) : null))
    const 按钮 = (文字, onClick, 亮, 关) =>
      h('button', { type: 'button', style: 亮 ? S.btnOn : S.btn, onClick, disabled: !!关, title: 文字 }, 文字)
    const 勾 = (值, onChange) => h('input', { type: 'checkbox', checked: !!值, onChange: (e) => onChange(e.target.checked) })
    const 短id = (id) => {
      const s = String(id)
      return s.length <= 8 ? s : s.slice(-8)
    }
    // 群号 / 好友 / 称呼都可能一次填一串；逗号、顿号、空格、换行都算分隔。
    const 拆列表 = (文本) => String(文本 || '').split(/[\s,，、;；]+/).map((s) => s.trim()).filter(Boolean)
    const 时间短 = (ts) => {
      const 数 = Number(ts) || 0
      if (数 <= 0) return ''
      const d = new Date(数)
      const 补 = (x) => String(x).padStart(2, '0')
      return 补(d.getMonth() + 1) + '-' + 补(d.getDate()) + ' ' + 补(d.getHours()) + ':' + 补(d.getMinutes())
    }
    const 能看图说 = (v) => (v === true ? '能看图' : v === false ? '仅文本，看不到图' : '未知')

    function Section() {
      const [态, 设态] = React.useState(null)
      const [脏, 设脏] = React.useState(false)
      const [忙, 设忙] = React.useState(false)
      const [说, 设说] = React.useState('')
      const [群文本, 设群文本] = React.useState('')
      const [好友文本, 设好友文本] = React.useState('')
      const [称呼文本, 设称呼文本] = React.useState('')
      const [兴趣文本, 设兴趣文本] = React.useState('')
      const [不聊文本, 设不聊文本] = React.useState('')
      const [模型们, 设模型们] = React.useState([])
      const [导忙, 设导忙] = React.useState(false)
      const [导说, 设导说] = React.useState('')
      const [白名单文本, 设白名单文本] = React.useState('')
      const [同意雪, 设同意雪] = React.useState(false)
      const [雪密码, 设雪密码] = React.useState('')
      const [雪目录, 设雪目录] = React.useState('')
      const [雪说, 设雪说] = React.useState('')
      const [雪忙, 设雪忙] = React.useState(false)
      const 雪初化 = React.useRef(false)
      const [人物态, 设人物态] = React.useState(null)
      const [人物载, 设人物载] = React.useState(false)
      const [人物错, 设人物错] = React.useState('')
      const [人物搜, 设人物搜] = React.useState('')
      const [只看熟, 设只看熟] = React.useState(false)
      const [展开人, 设展开人] = React.useState('')
      const [全部人, 设全部人] = React.useState(false)
      const [全部关系, 设全部关系] = React.useState(false)
      const [人号草稿, 设人号草稿] = React.useState({})
      // —— 思想活动：从 /thoughts 增量拉，绝不碰 /state（不然会冲掉没保存的表单值）——
      const [绪流, 设绪流] = React.useState([])
      const [绪摘, 设绪摘] = React.useState(null)
      const [绪类, 设绪类] = React.useState('')
      const [绪停, 设绪停] = React.useState(false)
      const [绪错, 设绪错] = React.useState('')
      const [展绪, 设展绪] = React.useState(0)
      const 绪游标 = React.useRef(0)
      const 绪停Ref = React.useRef(false)
      const 绪底 = React.useRef(null)
      const 贴底 = React.useRef(true)
      绪停Ref.current = 绪停

      React.useEffect(() => {
        拉()
        拉模型()
        拉人物()
      }, [])

      const 吃状态 = (s) => {
        设态(s)
        const 社 = (s && s.配置 && s.配置.社交) || {}
        设群文本((社.群 || []).join(', '))
        设好友文本((社.好友 || []).join(', '))
        设称呼文本((社.称呼 || []).join(', '))
        设兴趣文本((社.兴趣词 || []).join(', '))
        设不聊文本((社.不聊话题 || []).join(', '))
        设白名单文本((((s && s.配置 && s.配置.导入) || {}).白名单 || []).join(', '))
      }
      const 拉 = async () => {
        const s = await get('/state')
        if (s) 吃状态(s)
      }
      const 拉模型 = async () => {
        const m = await get('/models')
        if (m && m.ok) 设模型们(Array.isArray(m.providers) ? m.providers : [])
      }
      const 拉人物 = async () => {
        设人物载(true)
        const s = await get('/people')
        设人物载(false)
        if (s && s.ok && Array.isArray(s.人物)) {
          设人物态(s)
          设人物错('')
        } else {
          设人物错((s && s.说) || '读不到人物志')
        }
      }
      // 思想活动只走 /thoughts：带上本地游标做增量，宿主不重发旧的；宿主重启过（序号回退）就整段重来。
      const 拉绪 = async () => {
        const 从 = 绪游标.current
        const 出 = await get('/thoughts' + (从 > 0 ? '?since=' + 从 : ''))
        if (!出 || !出.ok) {
          设绪错((出 && 出.说) || '读不到思路流')
          return
        }
        设绪错('')
        const 来 = Array.isArray(出.思绪) ? 出.思绪 : []
        if (出.重发) {
          设绪流(来.slice(-400))
        } else if (来.length > 0) {
          设绪流((旧) => {
            const 有 = new Set(旧.map((x) => x.序号))
            return 旧.concat(来.filter((x) => !有.has(x.序号))).slice(-400)
          })
        }
        if (Number(出.序号) > 0) 绪游标.current = Number(出.序号)
        设绪摘({ 心情: 出.心情, 预算: 出.预算, 落盘: 出.落盘, 外源话: 出.外源话, 类别: 出.类别 })
      }
      React.useEffect(() => {
        void 拉绪()
        const 表 = setInterval(() => {
          if (typeof document !== 'undefined' && document.hidden) return
          if (绪停Ref.current) return
          void 拉绪()
        }, 3000)
        return () => clearInterval(表)
      }, [])
      // 新的思绪在最下面；只有本来就贴着底才自动跟下去，用户往回翻时不打扰。
      React.useEffect(() => {
        const 栏 = 绪底.current
        if (栏 && 贴底.current) 栏.scrollTop = 栏.scrollHeight
      }, [绪流, 绪类])
      // 只刷 SnowLuma 这一块，别用 /state 把没保存的表单值冲掉。
      function 吃雪(s) {
        if (!s || !s.ok) return
        设态((旧) => {
          if (!旧) return 旧
          const 雪 = { ...(旧.SnowLuma || {}), ...s }
          const 连上 = !!雪.已连QQ
          return {
            ...旧,
            SnowLuma: 雪,
            NapCat状态: 连上
              ? { 用户: 雪.用户, 昵称: 雪.昵称 }
              : { 错: 雪.错 || (雪.运行中 ? 'SnowLuma 在跑，但还没接上 QQ' : 'SnowLuma 没在跑') },
          }
        })
      }
      const 拉雪 = async () => {
        const s = await get('/snowluma')
        吃雪(s)
      }
      React.useEffect(() => {
        if (!态 || 雪初化.current) return
        雪初化.current = true
        const 雪 = (态.配置 && 态.配置.SnowLuma) || {}
        设同意雪(!!雪.同意协议)
        设雪目录(String(雪.目录 || ''))
      }, [态])
      const 雪装中 = !!(态 && 态.SnowLuma && 态.SnowLuma.安装 && 态.SnowLuma.安装.进行中)
      React.useEffect(() => {
        if (!雪装中) return undefined
        const 表 = setInterval(() => { void 拉雪() }, 1500)
        return () => clearInterval(表)
      }, [雪装中])
      const 改 = (k, v) => {
        设态((旧) => (旧 ? { ...旧, 配置: { ...(旧.配置 || {}), [k]: v } } : 旧))
        设脏(true)
      }
      const 改社交 = (k, v) => {
        设态((旧) => {
          if (!旧) return 旧
          const 配置 = 旧.配置 || {}
          return { ...旧, 配置: { ...配置, 社交: { ...(配置.社交 || {}), [k]: v } } }
        })
        设脏(true)
      }
      const 改戳一戳 = (k, v) => {
        设态((旧) => {
          if (!旧) return 旧
          const 配置 = 旧.配置 || {}
          return { ...旧, 配置: { ...配置, 戳一戳: { ...(配置.戳一戳 || {}), [k]: v } } }
        })
        设脏(true)
      }
      const 改导入 = (k, v) => {
        设态((旧) => {
          if (!旧) return 旧
          const 配置 = 旧.配置 || {}
          return { ...旧, 配置: { ...配置, 导入: { ...(配置.导入 || {}), [k]: v } } }
        })
        设脏(true)
      }
      const 存 = async () => {
        设忙(true)
        const s = await post('/save', (态 && 态.配置) || {})
        设忙(false)
        if (s && s.ok) {
          吃状态(s)
          设脏(false)
          设说(s.说 || '保存好了')
        } else {
          设说((s && s.说) || '保存失败')
        }
      }
      const 试一句 = async () => {
        设忙(true)
        const s = await post('/test-send', {})
        设忙(false)
        设说((s && s.说) || '没反应')
        await 拉()
      }
      // 换一间新会话，旧档留在磁盘上；只动状态里对应的那一行，不刷新整页、不冲掉没保存的改动。
      const 重置聊天 = async (t) => {
        const 叫 = (t && t.叫) || '这个聊天'
        if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
          const 行 = '重置「' + 叫 + '」的聊天？\n\n她会换一间新会话重新开始；旧聊天原样留在磁盘上，不会删。'
          if (!window.confirm(行)) return
        }
        设忙(true)
        const s = await post('/session-reset', { key: t && t.key, 会话id: t && t.会话id })
        设忙(false)
        设说((s && s.说) || '没反应')
        if (!s || !s.ok) return
        设态((旧) => {
          if (!旧) return 旧
          const 社交 = 旧.社交 || {}
          const 重置 = { 旧会话id: s.旧会话id, 重置At: Date.now() }
          const 目标 = (Array.isArray(社交.目标) ? 社交.目标 : []).map((x) =>
            x.key === s.key ? { ...x, 会话id: s.会话id, 活着: false, 待发: false, 待看: 0, 故障: null, 暂停中: false, 重置 } : x)
          const 主人私聊 = 社交.私聊 && 社交.私聊.key === s.key
            ? { ...社交.私聊, 会话id: s.会话id, 活着: false, 故障: null, 重置 }
            : 社交.私聊
          const 配置 = 旧.配置 || {}
          const 目标会话 = String(配置.目标会话 || '') === String(s.旧会话id) ? s.会话id : 配置.目标会话
          return { ...旧, 配置: { ...配置, 目标会话 }, 社交: { ...社交, 目标, 私聊: 主人私聊 } }
        })
      }
      const 戳一个 = async (t) => {
        if (!t) return
        const 场景 = t.类型 === 'group' ? 'group' : 'private'
        const 群号 = t.类型 === 'group' ? String(t.号 || '') : ''
        const 目标号 = 场景 === 'group'
          ? (t.人来回 && t.人来回.length > 0 && /^\d{5,12}$/.test(String(t.人来回[0].号)) ? String(t.人来回[0].号) : '')
          : String(t.号 || '')
        if (场景 === 'group' && !目标号) {
          设说('群聊戳人需要先有人说话；等群里有人发言后再按')
          return
        }
        设忙(true)
        const s = await post('/poke', { 场景, 号: 目标号, 群号 })
        设忙(false)
        设说((s && s.说) || '没反应')
      }
      // 导入的进度单独刷：整页 /state 会把没保存的表单值冲掉（令牌、白名单都会没）。
      const 拉导入 = async () => {
        const s = await get('/import-state')
        if (s && s.ok) 设态((旧) => (旧 ? { ...旧, 导入: s } : 旧))
      }
      const 跑一轮导入 = async () => {
        设导忙(true)
        const s = await post('/import-run', {})
        设导忙(false)
        设导说(s && s.ok
          ? '这一轮：写进 ' + (s.写 || 0) + ' 条｜本来就有的 ' + (s.重 || 0) + ' 条｜认不出 ' + (s.跳 || 0) + ' 条｜' + (s.说 || '')
          : ((s && s.说) || '导入没跑起来'))
        await 拉导入()
      }
      const 停导入 = async () => {
        设导忙(true)
        const s = await post('/import-stop', {})
        设导忙(false)
        设导说((s && s.说) || '已请求停止')
        await 拉导入()
      }
      const 重来导入 = async () => {
        设导忙(true)
        const s = await post('/import-reset', {})
        设导忙(false)
        设导说((s && s.说) || '游标已清空')
        await 拉导入()
      }

      const 数框 = (值, onChange, 步 = 1, 最小 = 0, 最大 = 100000) =>
        h('input', {
          type: 'number',
          style: S.small,
          value: Number(值) || 0,
          min: 最小,
          max: 最大,
          step: 步,
          onChange: (e) => onChange(e.target.value === '' ? 0 : Number(e.target.value)),
        })

      const 模型选项 = []
      for (const p of 模型们) {
        for (const m of (Array.isArray(p.models) ? p.models : [])) {
          模型选项.push({
            value: String(p.id) + '/' + String(m.id),
            label: String(p.name || p.id) + ' · ' + String(m.name || m.id) + (m.images === false ? '（仅文本）' : ''),
            仅文本: m.images === false,
          })
        }
      }
      const 模型选择 = (值, onChange, 默认词) => {
        const 当前 = String(值 || '')
        if (模型选项.length === 0) {
          return h('input', {
            type: 'text',
            style: S.input,
            value: 当前,
            placeholder: 'provider/model（拿不到模型列表时可手填）',
            onChange: (e) => onChange(e.target.value.trim()),
          })
        }
        const 列表里没有 = 当前 !== '' && !模型选项.some((o) => o.value === 当前)
        const 仅文本 = !!(当前 !== '' && (模型选项.find((o) => o.value === 当前) || {}).仅文本)
        return h('div', null,
          h('select', { style: S.input, value: 当前, onChange: (e) => onChange(e.target.value) },
            h('option', { style: S.option, value: '' }, 默认词),
            ...(列表里没有 ? [h('option', { style: S.option, value: 当前 }, 当前 + '（当前配置）')] : []),
            ...模型选项.map((o) => h('option', { style: S.option, key: o.value, value: o.value }, o.label)),
          ),
          仅文本
            ? h('div', { style: { ...S.hint, color: '#c0392b' } }, '这个模型只收文字：QQ 图片会被换成占位文字，她看不到图里的内容。')
            : null,
        )
      }

      if (!态) return h('div', { style: S.wrap }, h('div', { style: S.h }, '通到 QQ'), h('div', { style: S.dim }, '读取中…'))

      const 配置 = 态.配置 || {}
      const 目标们 = Array.isArray(态.活着的会话) ? 态.活着的会话 : []
      const 雪 = 态.SnowLuma || {}
      const 雪装好 = !!雪.已安装
      const 雪在跑 = !!雪.运行中
      const 雪连上 = !!雪.已连QQ
      const 雪安装 = 雪.安装 || {}
      const 雪后台 = 雪.后台 || {}
      const 雪OneBot = String(雪.OneBot || 配置.NapCat || 'http://127.0.0.1:3000')
      const 日志 = Array.isArray(态.日志) ? 态.日志 : []
      const 社交 = 配置.社交 || {}
      const 关掉们 = Array.isArray(社交.关掉) ? 社交.关掉 : []
      const 只听们 = Array.isArray(社交.只听) ? 社交.只听 : []
      const 少掺和们 = Array.isArray(社交.少掺和) ? 社交.少掺和 : []
      const 人态表 = 社交.人的态度 && typeof 社交.人的态度 === 'object' && !Array.isArray(社交.人的态度) ? 社交.人的态度 : {}
      const 人态字 = { warm: '多聊', quiet: '不主动', cold: '少理', ignore: '不理' }
      // 旧配置里可能还直接写着字符串；过期的人当没设，免得状态一直停在“少理”。
      const 人态值 = (值) => {
        const 态 = 值 && typeof 值 === 'object' && !Array.isArray(值)
          ? 值
          : typeof 值 === 'string' ? { 态: 值, 到: 0 } : null
        if (!态) return null
        if (!Object.prototype.hasOwnProperty.call(人态字, 态.态)) return null
        const 到 = Number(态.到) || 0
        if (到 > 0 && 到 <= Date.now()) return null
        return { 态: 态.态, 到: 到 > 0 ? 到 : 0 }
      }
      const 人态度数 = Object.values(人态表).reduce(
        (n, 人们) => n + Object.values(人们 || {}).filter((v) => 人态值(v) !== null).length, 0,
      )
      const 今晚零点 = () => {
        const d = new Date()
        d.setHours(24, 0, 0, 0)
        return d.getTime()
      }
      const 明早八点 = () => {
        const d = new Date()
        d.setHours(8, 0, 0, 0)
        if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1)
        return d.getTime()
      }
      const 期限值 = (到) => (到 <= 0 ? 'forever' : 到 <= 今晚零点() ? 'tonight' : '3d')
      const 改房间态 = (key, v) => {
        改社交('关掉', 关掉们.filter((k) => k !== key))
        改社交('少掺和', 少掺和们.filter((k) => k !== key))
        改社交('只听', 只听们.filter((k) => k !== key))
        if (v === 'few') 改社交('少掺和', 少掺和们.includes(key) ? 少掺和们 : [...少掺和们, key])
        else if (v === 'listen') 改社交('只听', 只听们.includes(key) ? 只听们 : [...只听们, key])
        else if (v === 'off') 改社交('关掉', 关掉们.includes(key) ? 关掉们 : [...关掉们, key])
      }
      const 房间态选择 = (key) => {
        const 是群 = key.startsWith('group:')
        const 值 = 关掉们.includes(key) ? 'off' : 少掺和们.includes(key) ? 'few' : 只听们.includes(key) ? 'listen' : 'normal'
        return h('select', {
          style: { ...S.small, padding: '3px 6px' },
          value: 值,
          onChange: (e) => 改房间态(key, e.target.value),
        },
          h('option', { style: S.option, value: 'normal' }, '正常'),
          ...(是群 ? [h('option', { style: S.option, value: 'few' }, '少掺和（只接叫我的）')] : []),
          h('option', { style: S.option, value: 'listen' }, '只听不说'),
          h('option', { style: S.option, value: 'off' }, '关掉'),
        )
      }
      const 改人态 = (key, 号, 态度, 期限 = 'forever') => {
        const 人们 = { ...(人态表[key] || {}) }
        if (态度 === 'normal') {
          delete 人们[号]
        } else {
          const 到 = 期限 === 'tonight' ? 今晚零点() : 期限 === '3d' ? Date.now() + 3 * 86_400_000 : 0
          人们[号] = { 态: 态度, 到 }
        }
        const 全 = { ...人态表 }
        if (Object.keys(人们).length === 0) delete 全[key]
        else 全[key] = 人们
        改社交('人的态度', 全)
      }
      const 群人 = (key) => {
        const 定过 = Object.fromEntries(Object.entries(人态表[key] || {}).filter(([, v]) => 人态值(v) !== null))
        const 目标 = (Array.isArray((态.社交 || {}).目标) ? 态.社交.目标 : []).find((t) => t.key === key)
        const 来回 = new Map(
          (目标 && Array.isArray(目标.人来回) ? 目标.人来回 : []).map((x) => [String(x.号), Number(x.次) || 0]),
        )
        const 出 = []
        const 见 = new Set()
        for (const p of 人物页) {
          if (p.主人) continue
          const 房 = (Array.isArray(p.房) ? p.房 : []).find((r) => r.key === key)
          if (!房) continue
          出.push({ 号: String(p.号), 名: String(p.名 || ''), 最后At: Number(房.最后At) || 0, 次: 来回.get(String(p.号)) || 0 })
          见.add(String(p.号))
        }
        for (const [号, 次] of 来回) {
          if (见.has(号)) continue
          出.push({ 号, 名: '', 最后At: 0, 次 })
          见.add(号)
        }
        for (const 号 of Object.keys(定过)) {
          if (!见.has(号)) 出.push({ 号, 名: '', 最后At: 0, 次: 0 })
        }
        出.sort((a, b) => b.次 - a.次 || b.最后At - a.最后At)
        const 排好 = 出.filter((p) => 定过[p.号]).concat(出.filter((p) => !定过[p.号]))
        return 排好.slice(0, 12)
      }
      const 加个人 = (key, 态度) => {
        const 号 = String(人号草稿[key] || '').trim()
        if (!/^\d{3,20}$/.test(号)) {
          设说('QQ 号看着不对：' + (号 || '（空）'))
          return
        }
        改人态(key, 号, 态度)
        设人号草稿({ ...人号草稿, [key]: '' })
      }
      const 人态选择 = (key, 号) => {
        const 值 = 人态值((人态表[key] || {})[号])
        const 态 = 值 ? 值.态 : 'normal'
        const 期 = 值 ? 期限值(值.到) : 'forever'
        return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
          h('select', {
            style: { ...S.small, padding: '3px 6px' },
            value: 态,
            onChange: (e) => 改人态(key, 号, e.target.value, 期),
          },
            h('option', { style: S.option, value: 'normal' }, '正常'),
            h('option', { style: S.option, value: 'warm' }, '多聊（多接、多问一句）'),
            h('option', { style: S.option, value: 'quiet' }, '不主动（没叫她先不接）'),
            h('option', { style: S.option, value: 'cold' }, '少理（被叫才短应）'),
            h('option', { style: S.option, value: 'ignore' }, '不理（叫了也不接）'),
          ),
          态 === 'normal'
            ? null
            : h('select', {
                style: { ...S.small, padding: '3px 6px' },
                value: 期,
                onChange: (e) => 改人态(key, 号, 态, e.target.value),
                title: '到点自动恢复正常',
              },
                h('option', { style: S.option, value: 'forever' }, '一直'),
                h('option', { style: S.option, value: 'tonight' }, '到今晚'),
                h('option', { style: S.option, value: '3d' }, '3 天'),
              ),
          值 && 值.到 > 0 ? h('span', { style: S.dim, title: '到点自动恢复' }, 时间短(值.到)) : null,
        )
      }
      const 空数框 = (值, onChange, 占位, 最小 = 0, 最大 = 1000) =>
        h('input', {
          type: 'number',
          style: { ...S.small, width: 66 },
          value: 值 === undefined ? '' : String(值),
          placeholder: 占位,
          min: 最小,
          max: 最大,
          step: 1,
          title: '留空 = 跟默认；填 0 = 这间不限',
          onChange: (e) => onChange(e.target.value),
        })
      // 一间屋的规矩：看/说模式、临时歇着、这间单独的主动话量（只对群有意义）。
      const 房规矩 = ({ key, 叫 }) => {
        const 到 = 房歇到(key)
        const t = 房计.get(key) || {}
        const 单 = 房单(key)
        const 量 = 房话量(key)
        const 是群 = key.startsWith('group:')
        return h('div', { key, style: { borderTop: '1px solid var(--dsw-alias-border-l2)', paddingTop: 6 } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
            h('span', {
              style: { flex: '1 1 160px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5, fontWeight: 600 },
            }, 叫),
            房间态选择(key),
            到 > 0
              ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
                  h('span', { style: { ...S.dim, color: '#c0392b' } }, '歇到 ' + 时间短(到) + '（照常看和学，不说话）'),
                  按钮('这就回来', () => 改歇着(key, 0), false),
                )
              : h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
                  按钮('歇半小时', () => 改歇着(key, 1800), false),
                  按钮('歇 1 小时', () => 改歇着(key, 3600), false),
                  按钮('歇到明早', () => 改歇着(key, Math.max(60, Math.round((明早八点() - Date.now()) / 1000))), false),
                ),
          ),
          h('div', { style: { ...S.dim, marginTop: 3 } },
            (是群 ? '主动话量 ' + 量.每时 + ' 轮/时 · ' + 量.每日 + ' 轮/日' +
              (量.自己定 ? '（这间单独定）' : '（跟默认）') : '私聊都算直接找你，不占主动话量') +
              (t.暂停中 ? '｜已连续失败暂停' : '') +
              ((t.主动本小时 || t.主动今日)
                ? '｜已用：本小时 ' + (t.主动本小时 || 0) + ' 轮 · 今天 ' + (t.主动今日 || 0) + ' 轮'
                : '') +
              (t.人的态度 && Object.keys(t.人的态度).length > 0 ? '｜个别态度 ' + Object.keys(t.人的态度).length + ' 人' : ''),
          ),
          是群
            ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 3 } },
                h('span', { style: S.dim }, '这间的主动话量'),
                空数框(单.每时, (v) => 改话量(key, '每时', v), String(社交.主动每时 ?? 6)),
                h('span', { style: S.dim }, '轮/时'),
                空数框(单.每日, (v) => 改话量(key, '每日', v), String(社交.主动每日 ?? 40)),
                h('span', { style: S.dim }, '轮/日'),
              )
            : null,
        )
      }
      const 社态 = 态.社交 || {}
      const 社交目标们 = Array.isArray(社态.目标) ? 社态.目标 : []
      // 宿主读到的群名 / 好友备注：开关列表和状态行都拿它把号翻成名字。
      const 房名表 = new Map(社交目标们.map((t) => [String(t.key), String(t.名 || '')]))
      const 房标 = (前缀, 号, key) => {
        const 名 = 房名表.get(key) || ''
        return 名 === '' ? 前缀 + ' ' + 号 : 前缀 + ' ' + 名 + '（' + 号 + '）'
      }
      const 可开房间 = [
        ...(社交.群 || []).map((号) => ({ key: 'group:' + 号, 叫: 房标('群', 号, 'group:' + 号) })),
        ...(社交.好友 || [])
          .filter((号) => String(号) !== String(配置.私聊QQ || '').trim())
          .map((号) => ({ key: 'friend:' + 号, 叫: 房标('好友', 号, 'friend:' + 号) })),
      ]
      const 话量表 = 社交.话量 && typeof 社交.话量 === 'object' && !Array.isArray(社交.话量) ? 社交.话量 : {}
      const 房单 = (key) => (话量表[key] && typeof 话量表[key] === 'object' ? 话量表[key] : {})
      // 空 = 跟全局；填 0 = 这间不限。
      const 房话量 = (key) => {
        const 单 = 房单(key)
        const 读 = (值, 兜) => (值 === undefined ? Math.round(Number(兜) || 0) : Math.round(Number(值) || 0))
        return {
          每时: 读(单.每时, 社交.主动每时),
          每日: 读(单.每日, 社交.主动每日),
          自己定: Object.keys(单).length > 0,
        }
      }
      const 改话量 = (key, 字段, 文) => {
        const 单 = { ...房单(key) }
        const 清 = String(文).trim()
        if (清 === '') delete 单[字段]
        else 单[字段] = Math.max(0, Math.round(Number(清) || 0))
        const 全 = { ...话量表 }
        if (Object.keys(单).length === 0) delete 全[key]
        else 全[key] = 单
        改社交('话量', 全)
      }
      const 歇着表 = 社交.歇着 && typeof 社交.歇着 === 'object' && !Array.isArray(社交.歇着) ? 社交.歇着 : {}
      const 房歇到 = (key) => {
        const 到 = Number(歇着表[key]) || 0
        return 到 > Date.now() ? 到 : 0
      }
      const 改歇着 = (key, 秒) => {
        const 全 = { ...歇着表 }
        const 秒数 = Math.round(Number(秒) || 0)
        if (秒数 > 0) 全[key] = Date.now() + 秒数 * 1000
        else delete 全[key]
        改社交('歇着', 全)
      }
      const 房计 = new Map(社交目标们.map((t) => [String(t.key), t]))
      const 自己 = 社态.自己 || (雪连上 ? { 昵称: 雪.昵称, 号: 雪.用户 } : null)
      const 导入 = 配置.导入 || {}
      const 导态 = 态.导入 || {}
      const 戳 = 配置.戳一戳 || {}
      const 戳态 = 态.戳一戳 || {}
      const 本轮 = 导态.本轮 || {}
      const 人物页 = 人物态 && Array.isArray(人物态.人物) ? 人物态.人物 : []
      const 关系页 = 人物态 && Array.isArray(人物态.关系网) ? 人物态.关系网 : []
      const 人物词 = 人物搜.trim().toLowerCase()
      const 全局熟 = (p) => Number(p && p.关系 && p.关系.熟) || 0
      const 人物筛过 = 人物页.filter((p) => {
        const 房间 = Array.isArray(p.房) ? p.房 : []
        if (只看熟 && 全局熟(p) < 35) return false
        if (人物词 === '') return true
        const 文 = [
          p.名, p.号,
          ...(Array.isArray(p.别名) ? p.别名 : []),
          ...(Array.isArray(p.账号) ? p.账号.map((a) => a.号 + ' ' + (a.名 || '')) : []),
          ...房间.map((r) => r.叫),
          ...(Array.isArray(p.事实) ? p.事实.map((f) => f.文 + ' ' + (f.房叫 || '')) : []),
          ...(Array.isArray(p.关系们) ? p.关系们.map((r) => r.谁 + ' ' + r.关系) : []),
          ...(Array.isArray(p.被说) ? p.被说.map((r) => r.谁 + ' ' + r.关系) : []),
        ].join(' ').toLowerCase()
        return 文.includes(人物词)
      })
      const 人物显示 = 人物词 !== '' || 全部人 ? 人物筛过 : 人物筛过.slice(0, 40)
      const 人物熟 = 人物页.filter((p) => 全局熟(p) >= 35).length
      const 账号数 = 人物态 && Number(人物态.账号数)
        ? 人物态.账号数
        : 人物页.reduce((n, p) => n + (Number(p.账号数) || 0), 0)

      const 兆 = (n) => (Number(n) || 0) >= 1048576
        ? (Number(n) / 1048576).toFixed(1) + ' MB'
        : Math.max(0, Math.round((Number(n) || 0) / 1024)) + ' KB'

      const 装雪 = async () => {
        if (!同意雪) {
          设雪说('先把下面的协议勾上：安装前需要你明确同意 SnowLuma 的 EULA 和隐私政策')
          return
        }
        设雪忙(true)
        设雪说('')
        const s = await post('/snowluma/setup', {
          目录: 雪目录.trim(),
          密码: 雪密码.trim(),
          同意协议: true,
          自动启动: true,
        })
        设雪忙(false)
        设雪说((s && s.说) || '没反应')
        if (s && s.状态) 吃雪(s.状态)
        if (s && s.ok) 设雪密码('')
        await 拉雪()
      }

      const 雪动作 = async (名) => {
        设雪忙(true)
        const s = await post('/snowluma/' + 名, {})
        设雪忙(false)
        设雪说((s && s.说) || '没反应')
        if (s && s.状态) 吃雪(s.状态)
        await 拉雪()
      }

      const 打开雪后台 = () => {
        const 址 = String(雪后台.地址 || 'http://127.0.0.1:5099/')
        if (typeof window !== 'undefined') window.open(址, '_blank', 'noopener,noreferrer')
      }

      const 复制 = async (文) => {
        const 要复制的 = String(文 || '')
        if (要复制的 === '') return
        try {
          await navigator.clipboard.writeText(要复制的)
          设雪说('已复制：' + 要复制的)
        } catch (error) {
          设雪说('复制不了，手动选中这串：' + 要复制的)
        }
      }

      const 步骤头 = (号, 完成) =>
        h('div', {
          style: {
            flex: '0 0 22px',
            width: 22,
            height: 22,
            borderRadius: 11,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            fontWeight: 700,
            marginTop: 1,
            background: 完成 ? 'var(--dsw-alias-state-business-primary)' : 'transparent',
            color: 完成 ? '#fff' : 'inherit',
            border: 完成 ? '1px solid var(--dsw-alias-state-business-primary)' : '1px solid var(--dsw-alias-border-l2)',
          },
        }, 完成 ? '✓' : String(号))

      // 一条思绪：一行话，点开看原始详情（理由全文 / 她看到的消息 / 真正发出去的话）。
      const 绪行 = (条) => {
        const 开 = 展绪 === 条.序号
        return h('div', { key: 条.序号, style: S.绪行, onClick: () => 设展绪(开 ? 0 : 条.序号) },
          h('span', { style: S.绪标 }, String(条.类别 || '')),
          h('span', { style: S.dim }, String(条.时间 || '') + (条.谁 ? '　' + String(条.谁) : '') + '　'),
          h('span', null, String(条.文本 || '')),
          开 && 条.详情 ? h('div', { style: S.绪详 }, JSON.stringify(条.详情, null, 2)) : null,
        )
      }

      // 面板顶那条：她现在多少分、上一次想什么、今天鱼脑花了多少。
      const 绪状态条 = () => {
        const 心 = (绪摘 && 绪摘.心情) || {}
        const 预 = (绪摘 && 绪摘.预算) || {}
        const 段 = []
        if (心.可用) 段.push('心情 ' + 心.心情 + ' 分' + (心.上次想法 ? '｜上一次想：' + 心.上次想法 : ''))
        if (预.可用) 段.push('今天花了 ¥' + 预.今日花费 + '（' + 预.今日调用 + ' 次）｜余额 ¥' + 预.余额
          + (预.精力 ? '｜精力 ' + 预.精力.说法 : ''))
        if (段.length === 0) {
          return h('div', { style: S.dim },
            '心情 / 鱼脑的账本还没读到：' + String((绪摘 && 绪摘.外源话) || '那两个插件还没跑起来'),
          )
        }
        return h('div', { style: { ...S.日志行, marginBottom: 6 } }, 段.join('　'))
      }

      const 绪类别们 = Array.isArray(绪摘 && 绪摘.类别) && 绪摘.类别.length > 0
        ? 绪摘.类别
        : ['判断', '思考', '心情', '记忆', '开口']
      const 显示绪 = 绪类 === '' ? 绪流 : 绪流.filter((x) => x.类别 === 绪类)

      const 步骤 = (号, 完成, 标题, 内容) =>
        h('div', { style: { display: 'flex', gap: 10, marginTop: 12 } },
          步骤头(号, 完成),
          h('div', { style: { flex: 1, minWidth: 0 } },
            h('div', { style: { fontWeight: 600, fontSize: 12.5, marginBottom: 4 } }, 标题),
            内容,
          ),
        )

      return h(
        'div',
        { style: S.wrap },

        h('div', { style: S.h }, '通到 QQ'),
        h('div', { style: S.dim },
          '固定用 SnowLuma 把 QQ 接到这里：它在 DSH 里说完一整轮，就把那句原文发到 QQ；你在 QQ 里说的话也会转进来。' +
            '下面的社交模式里，它只会挑自己感兴趣的消息看，再决定要不要接；能回答、被 @、群里热闹都不是理由。' +
            '版本 ' + String(态.版本 || '?') + '｜配置文件：' + String(态.配置文件 || ''),
        ),

        // —— 第一次接通 QQ：装、配、接、检测 ——
        h('div', { style: S.card },
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
            h('div', { style: { ...S.h, margin: 0 } }, '第一次接通 QQ'),
            h('div', { style: 雪连上 ? S.已同步 : S.未保存 }, 雪连上 ? '✓ 已接通' : '还没接通'),
          ),
          h('div', { style: S.dim },
            '固定用 SnowLuma。点「一键安装并配置」会从官方 GitHub Releases 下载 Windows 版（国内网络自动换镜像），并把 OneBot HTTP（' + 雪OneBot + '）、事件上报和后台密码都写好；' +
              '你只剩两步：登录鱼 QQ、在 SnowLuma 后台把它接上。',
          ),
          雪装好 && 雪.外部实例
            ? h('div', { style: { ...S.dim, marginTop: 4 } },
                '现在用的是已经在运行的 SnowLuma（不是这个安装目录启动的）；要切到这个目录的版本，先把旧实例停掉。')
            : null,

          步骤(1, 雪装好 && 雪在跑, '安装并配置 SnowLuma',
            h('div', null,
              h('div', { style: S.dim },
                雪装中
                  ? '正在装：' + String(雪安装.阶段 || '') + (雪安装.总 ? '（' + 兆(雪安装.已下载) + ' / ' + 兆(雪安装.总) + '）' : '')
                  : 雪装好
                    ? '已安装 v' + String(雪.版本 || '?') + '：' + String(雪.目录 || '')
                    : '还没装。点击下载安装（约 40–60 MB），装好会自动配置并启动。',
              ),
              h('label', { style: { display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12, marginTop: 6 } },
                h('input', { type: 'checkbox', checked: 同意雪, onChange: (e) => 设同意雪(e.target.checked) }),
                h('span', null,
                  '我已阅读并同意 SnowLuma 的 ',
                  h('a', {
                    href: 'https://github.com/SnowLuma/SnowLuma',
                    target: '_blank',
                    rel: 'noreferrer',
                    style: { color: 'var(--dsw-alias-state-business-primary)' },
                  }, 'EULA 与隐私政策'),
                  '（安装包内附 EULA.md / PRIVACY.md）',
                ),
              ),
              h('div', { style: { marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' } },
                按钮(雪装中 ? '正在安装…' : (雪装好 ? (雪在跑 ? '重新配置并重启' : '配置并启动') : '一键安装并配置'),
                  装雪, true, 雪忙 || 雪装中 || !同意雪),
                雪装好 ? 按钮('打开后台', 打开雪后台, false, 雪忙) : null,
                雪装好 && 雪后台.密码 ? 按钮('复制后台密码', () => 复制(雪后台.密码), false, false) : null,
              ),
              h('details', { style: { marginTop: 8 } },
                h('summary', { style: { cursor: 'pointer', fontSize: 12, opacity: 0.72 } }, '高级：安装目录 / 后台密码'),
                h('div', { style: { marginTop: 6 } },
                  行('安装目录', h('input', {
                    type: 'text',
                    style: S.input,
                    value: 雪目录,
                    placeholder: '留空 = 自动找，找不到就装到 <DSH_HOME>/snowluma',
                    onChange: (e) => 设雪目录(e.target.value),
                  }), '已有安装会自动认出来；一般不用填。'),
                  行('后台密码', h('input', {
                    type: 'text',
                    style: S.input,
                    value: 雪密码,
                    placeholder: '留空 = 自动生成一个并记在本机',
                    onChange: (e) => 设雪密码(e.target.value),
                  }), '这是 SnowLuma 后台的登录密码；只存在本机配置文件里。'),
                ),
              ),
              雪安装.错
                ? h('div', { style: { ...S.未保存, marginTop: 6 } }, '⚠ 上次安装/启动失败：' + 雪安装.错)
                : null,
              h('div', { style: { ...S.dim, marginTop: 6 } },
                '后台：' + String(雪后台.地址 || 'http://127.0.0.1:5099/') +
                  '｜密码：' + String(雪后台.密码 || '（装好后自动生成）'),
              ),
            ),
          ),

          步骤(2, 雪连上, '登录鱼 QQ，并在 SnowLuma 后台接上它',
            h('div', null,
              h('div', { style: S.dim },
                'SnowLuma 不会替你登录 QQ：先在这台电脑登录「鱼的 QQ」，再打开后台，在「进程」里选中这个 QQ 并接上' +
                  '（不同版本可能叫接入 / 注入 / 启用）。',
              ),
              h('div', { style: { marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' } },
                按钮('打开 SnowLuma 后台', 打开雪后台, true, !雪装好),
                雪装好 && !雪在跑 ? 按钮('启动 SnowLuma', () => 雪动作('start'), false, 雪忙) : null,
                按钮('重置后台密码', () => 雪动作('password'), false, 雪忙 || !雪装好),
                按钮('停止 SnowLuma', () => 雪动作('stop'), false, 雪忙 || !雪.是我们启动的),
              ),
            ),
          ),

          步骤(3, 雪连上, '回来检测这条线',
            h('div', null,
              h('div', { style: 雪连上 ? S.已同步 : S.未保存 },
                雪连上
                  ? '✓ 已经连上：' + String(雪.昵称 || '') + '（' + String(雪.用户 || '') + '）'
                  : '还没连上' + (雪.错 ? '：' + 雪.错 : '（SnowLuma 没在跑，或后台还没接上 QQ）'),
              ),
              h('div', { style: { marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' } },
                按钮('重新检测', 拉雪, true, 雪忙),
              ),
              h('div', { style: { ...S.dim, marginTop: 4 } },
                '检测走的是 OneBot HTTP ' + 雪OneBot + '；一直失败就看最下面的记录和 SnowLuma 的 logs。',
              ),
            ),
          ),

          雪说 ? h('div', { style: { ...S.ok, marginTop: 8 } }, 雪说) : null,
        ),

        h('div', { style: 脏 ? S.未保存 : S.已同步 },
          脏 ? '⚠ 上面有改动还没保存 —— 改完点「保存设置」（有改动时底下还会浮一条出来）' : '设置已同步 ✓',
        ),

        // —— 开关 ——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '开关'),
          行('总开关', 勾(配置.总开关, (v) => 改('总开关', v)), '关着 = 一句都不发。出厂默认开；没填私聊 / 群时不会发到具体目标。'),
          行('试运行', 勾(配置.试运行, (v) => 改('试运行', v)), '开着只记账、不真发到 QQ。想先看记录就开着它。'),
        ),

        // —— 目标会话（下拉选，不手填）——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '目标会话（盯哪一间屋）'),
          h('select', {
            style: S.input,
            value: 配置.目标会话 || '',
            onChange: (e) => 改('目标会话', e.target.value),
          },
            h('option', { style: S.option, value: '' }, '（自动：QQ 私聊专用屋）'),
            ...目标们.map((s) =>
              h('option', { style: S.option, value: s.id }, (s.标题 || '…' + 短id(s.id)) + ' · ' + 短id(s.id)),
            ),
          ),
          h('div', { style: { marginTop: 4 } }, 按钮('刷新清单', 拉, false, 忙)),
          h('div', { style: S.dim }, '留空 = 第一次私聊时自动开一间 QQ 专用屋，之后一直续上；选一间 = 固定用那间，它被关掉就会报错。'),
        ),

        // —— 发到哪 ——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '发到哪'),
          行('转私聊', 勾(配置.转私聊, (v) => 改('转私聊', v)), '往下面这个 QQ 号私聊发。'),
          行('私聊 QQ 号', h('input', { type: 'text', style: S.small, value: String(配置.私聊QQ || ''), onChange: (e) => 改('私聊QQ', e.target.value) }), '就是你自己的 QQ 号。'),
          行('转群', 勾(配置.转群, (v) => 改('转群', v)), '往下面这个群发。'),
          行('群号', h('input', { type: 'text', style: S.small, value: String(配置.群号 || ''), onChange: (e) => 改('群号', e.target.value) }), '可空。'),
        ),

        // —— 戳一戳 ——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '戳一戳'),
          h('div', { style: S.dim },
            'QQ 的戳一戳是通知事件，不在聊天记录里；只靠轮询永远看不到。' +
              '一键安装时会自动写进 SnowLuma 的 HTTP 上报；改过端口才需要再到 SnowLuma 后台同步一次。',
          ),
          行('收戳一戳', 勾(戳.启用, (v) => 改戳一戳('启用', v)), '关掉 = 不监听；改端口后保存会自动重开。'),
          行('监听端口', 数框(戳.端口, (v) => 改戳一戳('端口', v), 1, 1024, 65535), '只在本机 127.0.0.1 上监听，不暴露到局域网。'),
          行('上报地址',
            h('input', {
              type: 'text',
              readOnly: true,
              style: S.input,
              value: String(戳态.地址 || ('http://127.0.0.1:' + String(戳.端口 || 19388) + '/dsh-qq/event')),
              onFocus: (e) => e.target.select(),
            }),
            '一键安装时已经自动填好；只有换过端口才需要重新同步到 SnowLuma 的 httpClient（不要填 access token）。',
          ),
          h('div', { style: 戳态.在听 ? S.已同步 : S.未保存 },
            戳态.在听
              ? '✓ 正在听 ' + String(戳态.地址 || '') + '（收到 ' + String(戳态.收到 || 0) + ' 个戳一戳' + (戳态.最近 ? '，最近 ' + 戳态.最近 : '') + '）'
              : '⚠ 没在听' + (戳态.错 ? '：' + 戳态.错 : (戳.启用 ? '（端口没起来，看下面的记录）' : '（关着）')),
          ),
        ),

        // —— 社交桥 ——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '社交（她在群里自己接话）'),
          h('div', { style: S.dim },
            '每个群 / 好友各开一间独立会话，有自己连续的上下文；这里的话会离开本机，' +
              '所以社交会话不给工具、不注入余额，记忆也只查这一间屋子。' +
              '有消息进来就先给那个群 / 好友建一间屋子，再判断看不看、回不回；能回答、被 @、群里热闹都不是理由。',
          ),
          行('启用社交', 勾(社交.启用, (v) => 改社交('启用', v)), '关着 = 完全不走社交桥。'),
          行('社交试运行', 勾(社交.试运行, (v) => 改社交('试运行', v)), '只记账、不开轮，不花模型钱；建议先跑几天看记录。'),
          行('模式',
            h('select', {
              style: S.input,
              value: 社交.模式 || 'auto',
              onChange: (e) => 改社交('模式', e.target.value),
            },
              h('option', { style: S.option, value: 'auto' }, 'auto —— 没人叫的群聊也按兴趣交给她挑'),
              h('option', { style: S.option, value: 'mention' }, 'mention —— 只把被叫到的消息交给她挑'),
            ),
            '两种模式都只挑她感兴趣的、由她决定回不回；不是被叫必回，mention 更省、更安静。',
          ),
          行('旁听', 勾(社交.旁听, (v) => 改社交('旁听', v)), '关掉 = 没被叫的消息连收都不收；开着才进入她的待看队列，再由兴趣判断挑一遍。'),
          行('群号', h('textarea', {
            style: S.area,
            value: 群文本,
            placeholder: '例如：123456789, 987654321（逗号或换行分隔）',
            onChange: (e) => { 设群文本(e.target.value); 改社交('群', 拆列表(e.target.value)) },
          }), '她要旁听的群。群里的话会进各自的独立会话。'),
          行('好友 QQ', h('textarea', {
            style: S.area,
            value: 好友文本,
            placeholder: '例如：10001, 10002（逗号或换行分隔）',
            onChange: (e) => { 设好友文本(e.target.value); 改社交('好友', 拆列表(e.target.value)) },
          }), '好友私聊也只在她感兴趣、想说话时才回；别把主人自己的号写进来（主人在上面「私聊 QQ 号」里管）。'),
          行('每一间的规矩',
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
              可开房间.length === 0
                ? h('span', { style: S.dim }, '先在「群号」「好友 QQ」里填好，这里会给每一间出规矩。')
                : 可开房间.map((房) => 房规矩(房)),
            ),
            '正常 = 看、学、说；少掺和 = 只接叫她的话（@、叫名字、回复她、问她本人），没叫她的群友消息不进视线，主人随口说的仍照常；只听不说 = 照常看和学（记人、学说话、进记忆），但一句都不发，被叫、被戳也不回，静音时段也照常学；关掉 = 这一间她既不接话也不看消息，戳一戳也不理。群 / 好友清单和聊天记录都留着，改回去就接着用。' +
              '「歇一会儿」是临时的只听不说：照常看和学，到点自己回来，不用记得去改回来。改完记得保存。',
          ),
          行('她跟谁说话',
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
              可开房间.filter(({ key }) => key.startsWith('group:')).length === 0
                ? h('span', { style: S.dim }, '先在「群号」里填好群，这里会按群列出她见过的人。')
                : 可开房间.filter(({ key }) => key.startsWith('group:')).map(({ key, 叫 }) => {
                    const 人们 = 群人(key)
                    const 草 = String(人号草稿[key] || '')
                    return h('div', { key, style: { borderTop: '1px solid var(--dsw-alias-border-l2)', paddingTop: 6 } },
                      h('div', { style: { fontSize: 12.5, fontWeight: 600, marginBottom: 4 } }, 叫),
                      人们.length === 0
                        ? h('div', { style: S.dim },
                            人态表[key]
                              ? '设置的人她还没在这间群见过，但态度照常生效。'
                              : '还没在这间群见过人；见过之后会列在这里，也可以先在下面直接填 QQ 号。',
                          )
                        : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
                            人们.map((p) => h('label', {
                              key: p.号,
                              style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 },
                            },
                              h('span', {
                                style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                              }, p.名 ? p.名 + '（' + p.号 + '）' : 'QQ ' + p.号),
                              p.次 > 0 ? h('span', { style: { ...S.dim, whiteSpace: 'nowrap' }, title: '今天这个人把她的聊天拽进去几轮' }, '今天 ' + p.次 + ' 轮') : null,
                              人态选择(key, p.号),
                            )),
                          ),
                      h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4 } },
                        h('input', {
                          type: 'text',
                          style: { ...S.small, width: 130 },
                          placeholder: '加一个 QQ 号',
                          value: 草,
                          onChange: (e) => 设人号草稿({ ...人号草稿, [key]: e.target.value }),
                        }),
                        按钮('按多聊加', () => 加个人(key, 'warm'), false),
                        按钮('按少理加', () => 加个人(key, 'cold'), false),
                        按钮('按不理加', () => 加个人(key, 'ignore'), false),
                      ),
                    )
                  }),
            ),
            '只对群聊生效，主人自己不受影响。' +
              '多聊 = 他说话更容易进视线、更愿意多接一句；不主动 = 他没点你名就不看、不接，被叫照常应；少理 = 没点你名就不看、不接，真被叫到只短答一句，不追问、不起新话题；不理 = 连 @、回复和戳一戳都不接。' +
              '每种态度都可以选「一直 / 到今晚 / 3 天」，到点自己恢复正常；「今天 N 轮」是这个人今天把她的聊天拽进去的次数，用来找谁最花 token。好友私聊要安静，用上面的「每一间的规矩」。改完记得保存。',
          ),
          行('冷却秒', 数框(社交.冷却秒, (v) => 改社交('冷却秒', v), 1, 2, 3600), '同一目标两次开口的成熟期基础间隔（默认 15 秒）；实际会按兴致走指数曲线，想接时几秒就能开口。'),
          行('冷却曲线',
            h('div', { style: { display: 'flex', gap: 8 } },
              数框(社交.冷却最短秒, (v) => 改社交('冷却最短秒', v), 1, 1, 3600),
              数框(社交.冷却最长倍率, (v) => 改社交('冷却最长倍率', v), 0.05, 1, 4),
            ),
            '最有兴致时冷却降到左边秒数（默认 2）；兴致最低时是基础 × 右边（默认 ×1.2）。中间按指数曲线过渡。',
          ),
          行('余额吃紧',
            h('div', { style: { display: 'flex', gap: 8 } },
              数框(社交.余额吃紧线, (v) => 改社交('余额吃紧线', v), 0.5, 0, 1000),
              数框(社交.余额吃紧倍率, (v) => 改社交('余额吃紧倍率', v), 0.05, 1, 3),
            ),
            '零花钱从左边（元）降到「最低余额」时，冷却按曲线逐渐乘以右边；低于最低余额就不再开口。',
          ),
          行('主动话量（默认）',
            h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
              数框(社交.主动每时 ?? 6, (v) => 改社交('主动每时', v), 1, 0, 1000),
              h('span', { style: S.dim }, '轮/时'),
              数框(社交.主动每日 ?? 40, (v) => 改社交('主动每日', v), 1, 0, 1000),
              h('span', { style: S.dim }, '轮/日'),
            ),
            '她自己凑上去说话的额度；被叫、问她本人和主人说话不算，额度用完也照样应。0 = 不限；每一间可以在上面单独改。' +
              '额度用完只是暂时不主动搭话，消息照收照学，下个小时 / 第二天自己恢复。',
          ),
          行('连着说',
            h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
              数框(社交.连说上限 ?? 3, (v) => 改社交('连说上限', v), 1, 0, 20),
              h('span', { style: S.dim }, '轮 / 两分钟内，先歇'),
              数框(社交.连说歇秒 ?? 30, (v) => 改社交('连说歇秒', v), 5, 0, 600),
              h('span', { style: S.dim }, '秒'),
            ),
            '像人一样：一口气主动说太多轮就先停一下，别把整间群刷成她的。歇着时消息攒着，到点一起看，不丢；被叫和主人不走这条。0 = 不拦。',
          ),
          行('同时接话', 勾(社交.并行, (v) => 改社交('并行', v)), '她正在回一条时，别的值得回的新消息会开一条「分线」会话同时回，不用等前一条说完；分线也会带最近上下文。'),
          行('分线上限', 数框(社交.并行上限, (v) => 改社交('并行上限', v), 1, 0, 6), '每个群 / 好友最多同时开几条分线（默认 2，0 = 不并行、按顺序回）；主屋本身不算在内。'),
          行('最低余额（元）', 数框(社交.最低余额, (v) => 改社交('最低余额', v), 0.5, 0, 1000), '鱼脑零花钱低于这个数就什么都不看、不接（被叫也不接）。'),
          行('静音时段', h('input', {
            type: 'text',
            style: S.small,
            value: String(社交.静音 || ''),
            placeholder: '23:00-08:00',
            onChange: (e) => 改社交('静音', e.target.value),
          }), '这段时间一句都不发；留空 = 不静音。'),
          行('称呼', h('input', {
            type: 'text',
            style: S.input,
            value: 称呼文本,
            placeholder: '大肥鱼, 肥鱼',
            onChange: (e) => { 设称呼文本(e.target.value); 改社交('称呼', 拆列表(e.target.value)) },
          }), '群里文字出现这些词 = 在叫她。'),
          行('兴趣词', h('input', {
            type: 'text',
            style: S.input,
            value: 兴趣文本,
            placeholder: '可空；例如：猫, 音乐, 海',
            onChange: (e) => { 设兴趣文本(e.target.value); 改社交('兴趣词', 拆列表(e.target.value)) },
          }), '兴趣只决定她会不会主动开新话题：感兴趣的先看、更可能主动接；不感兴趣也能短接一句，不会被直接挡在门外。留空时只能靠她在这间屋里看过的东西判断。'),
          行('不玩、不聊游戏', 勾(社交.不聊游戏, (v) => 改社交('不聊游戏', v)), '她本来就不玩任何游戏：群里聊游戏/开黑/抽卡、接着这个话题往下聊、发游戏截图都不接，也不跟着接梗；有人直接点她问，就照实说“我不玩”，不装懂、不编经历。关掉 = 不再把游戏当成她不会的话题。'),
          行('其他不聊的话题', h('input', {
            type: 'text',
            style: S.input,
            value: 不聊文本,
            placeholder: '可空；例如：足球, 股票',
            onChange: (e) => { 设不聊文本(e.target.value); 改社交('不聊话题', 拆列表(e.target.value)) },
          }), '她不会、也不来往的领域，逗号分隔。群里聊到这些不主动接；被直接叫到时可以短应一句，说不懂。'),
          行('关注上限', 数框(社交.关注上限, (v) => 改社交('关注上限', v), 1, 1, 30), '小模型一次最多挑几条她感兴趣的消息进入视线；没挑中的这一轮当没看见，感兴趣的消息排在前面。'),
          行('记人', 勾(社交.记人, (v) => 改社交('记人', v)), '在群和好友私聊里认人、记长期有用的事（近况、喜好、边界）和人与人之间的关系。同一个人的大号小号算同一个人，只占一张卡；群和私聊是同一段关系，事实和边界互通，但私下说过的事不会在群里点名复述。只存本机；关掉 = 不认人，也不读写人物志。'),
          行('学说话', 勾(社交.学说话, (v) => 改社交('学说话', v)), '慢慢摸清对方打字的节奏（句子长短、标点、语气词、表情、连发、口头禅），也学群里反复出现的短说法；回话时顺着节奏和语气，口头禅可以自然带一点，但不整段照搬、不学方言和骂人话，也不会让她说出来。统计只存本机；对方说「别学我」会立刻停。关掉 = 不统计也不贴合。'),
          行('学表情', 勾(社交.学表情, (v) => 改社交('学表情', v)), '看群里的人怎么用表情接话：什么场合发、多久来一张、是不是只发图不配字；熟悉以后她也会更常用表情，包括只回一张表情。群里反复出现的表情会顺手收进 QQ 收藏（只收表情类，不收主人发的图，每天最多十几张，试运行不写）。统计只存本机，不存图也不存原话。关掉 = 不统计、不自动收藏，回复里也不提群里的表情习惯。'),
          行('复读', 勾(社交.复读, (v) => 改社交('复读', v)), '实在接不上、又不想装没看见时，允许她原样跟着复读群友刚刷的一句短话（两三个人在接龙、或群里常说的短口头禅）。广告、链接、脏话、要隐私的话不会复读；同一句 30 分钟内不重复，真发了才算一次。「学说话」关掉时只跟接龙，不靠学到的口头禅。'),
          行('快判', 勾(社交.快判, (v) => 改社交('快判', v)), '她看过的消息攒够后，先用零成本注意力分排序，把感兴趣的排前面交给判断模型；0 分只排后面，不会因此不接；学习期仍每条都判。'),
          行('快判名额',
            h('div', { style: { display: 'flex', gap: 8 } },
              数框(社交.快判最多, (v) => 改社交('快判最多', v), 1, 1, 30),
            ),
            '一批消息里按注意力分从高到低取前几条交给判断模型（默认 8 条）；被叫和问她自己的一律放行、不占名额。分数低的只是排后面，不是直接丢掉。',
          ),
          行('探索额度',
            h('div', { style: { display: 'flex', gap: 8 } },
              数框(社交.探索间隔秒, (v) => 改社交('探索间隔秒', v), 30, 0, 86400),
              数框(社交.探索最低余额, (v) => 改社交('探索最低余额', v), 0.5, 0, 1000),
            ),
            '整批都没兴趣时，左边秒数里最多挑一条没见过的看看（0 = 不探索）；零花钱低于右边就不探索。',
          ),
          行('判断模型', 模型选择(社交.判断模型, (v) => 改社交('判断模型', v), '（跟当前主会话的模型走）'), '最好选便宜的小模型；每次只判断她感不感兴趣、要不要接，不生成回复。判断模型也要能看图（选带图片输入的模型），否则图片消息只能按“有张图”判断。'),
          行('判断冷却秒', 数框(社交.判断冷却秒, (v) => 改社交('判断冷却秒', v), 1, 0, 3600), '同一目标两次判断的最小间隔（默认 0 秒 = 每轮都判）；调大可以把消息攒起来一起判，省判断费。'),
          行('判断阈值', 数框(社交.判断阈值, (v) => 改社交('判断阈值', v), 0.05, 0.1, 1), '她“感兴趣且想说”的把握低于这个数就不接；只看不回不受影响（0.1 ~ 1）。'),
          行('回复模型', 模型选择(社交.回复模型, (v) => 改社交('回复模型', v), '（跟随默认）'), '社交会话本身用哪个模型；要能看图（如 deepseek-flash），否则 QQ 图片里的内容她看不到。'),
        ),

        // —— 社交状态 ——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '她在群里的状态'),
          h('div', { style: S.dim },
            '启用：' + (社态.启用 ? '开' : '关') +
              '｜试运行：' + (社态.试运行 ? '开' : '关') +
              '｜模式：' + (社态.模式 === 'mention' ? '只把被叫交给她' : 'auto') +
              '｜登录号：' + (自己 ? 自己.昵称 + '（' + 自己.号 + '）' : '还没探到') +
              '｜今天已接：' + (社态.今日已接 || 0) +
              (少掺和们.length > 0 ? '｜少掺和：' + 少掺和们.length + ' 间' : '') +
              (人态度数 > 0 ? '｜单独态度：' + 人态度数 + ' 人' : '') +
              (可开房间.filter(({ key }) => 房歇到(key) > 0).length > 0
                ? '｜歇着：' + 可开房间.filter(({ key }) => 房歇到(key) > 0).length + ' 间'
                : '') +
              (社态.在静音 ? '｜现在静音中' : ''),
          ),
          h('div', {
            style: {
              ...S.dim,
              marginTop: 4,
              ...((社态.看图 && (社态.看图.回复 === false || 社态.看图.判断 === false)) ? { color: '#c0392b' } : {}),
            },
          },
            '看图：回复模型 ' + 能看图说(社态.看图 && 社态.看图.回复) + ' · 判断模型 ' + 能看图说(社态.看图 && 社态.看图.判断) +
              (社态.看图 && 社态.看图.回复模型 ? '（' + 社态.看图.回复模型 + '）' : ''),
          ),
          h('div', { style: { ...S.dim, marginTop: 4 } },
            '人物志：' + ((社态.人物 && 社态.人物.认识) || 0) + ' 个人' +
              (社态.人物 && 社态.人物.账号 ? '、' + 社态.人物.账号 + ' 个号' : '') +
              (社态.人物 && 社态.人物.关系 ? '、' + 社态.人物.关系 + ' 条关系' : '') +
              (社态.人物 && 社态.人物.熟 ? '，熟人以上 ' + 社态.人物.熟 + ' 个' : '') +
              (社态.人物 && Array.isArray(社态.人物.最近) && 社态.人物.最近.length
                ? ' · 最近：' + 社态.人物.最近.slice(0, 5).map((p) => (p.主人 ? '主人' : p.名) + '（' + p.号 + (p.账号数 > 1 ? ' 等 ' + p.账号数 + ' 个号' : '') + '）').join('、')
                : '') +
              (社交.记人 ? '' : '（记人已关）'),
          ),
          h('div', { style: { ...S.dim, marginTop: 4 } },
            '连续 3 轮失败会先停 10 分钟、不再开新回合，并给主人 QQ 发一条系统提醒；' +
              '坏掉的聊天可以在下面「重置这个聊天」，旧记录会原样留在磁盘上。',
          ),
          社交目标们.length === 0
            ? h('div', { style: { ...S.dim, marginTop: 6 } }, '还没配群或好友。保存后这里会列出每个目标活没活着、今天接了几次。')
            : 社交目标们.map((t) => h('div', { key: t.key, style: { ...S.日志行, marginTop: 6 } },
                h('div', null,
                  房标(t.类型 === 'group' ? '群' : '好友', t.号, t.key) + '（' + 短id(t.会话id) + '）· ' +
                    (t.允许 === false ? '已单独关掉（不看、不说） · ' : '') +
                    (t.允许 !== false && t.能说 === false ? '只听不说（照常看和学，不开口） · ' : '') +
                    (t.少掺和 ? '少掺和（只接叫她的） · ' : '') +
                    (t.歇到 ? '歇着（' + 时间短(t.歇到) + ' 自己回来，照常看和学） · ' : '') +
                    (t.人的态度 && Object.keys(t.人的态度).length > 0 ? '个别态度 ' + Object.keys(t.人的态度).length + ' 人 · ' : '') +
                    (t.活着 ? '会话活着' : '等它第一次开口') +
                    (t.待看 ? ' · 待看 ' + t.待看 + ' 条' : '') +
                    (t.待发 ? ' · 正在想' : '') +
                    (t.分线 ? ' · 分线 ' + t.分线 + ' 条在同时回' : '') +
                    ' · 今天开口 ' + (t.今日 || 0) + '（本小时 ' + (t.本小时 || 0) + '）' +
                    (t.话量
                      ? ' · 主动 ' + (t.主动本小时 || 0) + '/' + t.话量.每时 + ' 每时 · ' + (t.主动今日 || 0) + '/' + t.话量.每日 + ' 每日'
                      : '') +
                    (t.画像
                      ? ' · ' + (!社交.快判 ? '快判已关' : t.画像.成熟 ? '快判已成熟' : '好奇期 ' + (t.画像.样本 || 0) + '/' + (t.画像.门槛样本 || 20)) +
                        (typeof t.画像.意愿阈值 === 'number' ? ' · 门槛 ' + t.画像.意愿阈值.toFixed(2) : '') +
                        (t.画像.探索 ? ' · 探索 ' + t.画像.探索 + ' 次' : '') +
                        (t.画像.快判丢 ? '（先放后面 ' + t.画像.快判丢 + ' 条）' : '') +
                        (Array.isArray(t.画像.兴趣词) && t.画像.兴趣词.length ? ' · 兴趣：' + t.画像.兴趣词.slice(0, 5).join('、') : '') +
                        (t.画像.语感 && t.画像.语感.样本 > 0
                          ? ' · 群语感 ' + t.画像.语感.样本 + ' 条' +
                            (Array.isArray(t.画像.语感.口癖) && t.画像.语感.口癖.length ? '（常有人说：' + t.画像.语感.口癖.join('、') + '）' : '')
                          : '') +
                        (t.画像.表情 && t.画像.表情.表情条数 > 0
                          ? ' · 表情习惯 ' + t.画像.表情.表情条数 + '/' + t.画像.表情.样本 + ' 条' +
                            (t.画像.表情.每张 > 1.2 ? '（平均 ' + t.画像.表情.每张 + ' 张）' : '') +
                            (Array.isArray(t.画像.表情.场景) && t.画像.表情.场景.length ? '（常用：' + t.画像.表情.场景.join('、') + '）' : '')
                          : '')
                      : '') +
                    (t.冷却 ? ' · 现在不接：' + t.冷却 : ''),
                ),
                t.故障
                  ? h('div', { style: { color: '#c0392b' } },
                      t.暂停中 && t.故障.暂停到
                        ? '⏸ 连续失败 ' + t.故障.连续 + ' 次，暂停到 ' + 时间短(t.故障.暂停到) + '（不再开新回合）｜' + (t.故障.最后码 || '未知') + (t.故障.最后说 ? '：' + t.故障.最后说 : '')
                        : '⚠ 上次失败：' + (t.故障.最后码 || '未知') + (t.故障.最后说 ? '：' + t.故障.最后说 : '') + (t.故障.连续 > 1 ? '（连续 ' + t.故障.连续 + ' 次）' : ''),
                    )
                  : null,
                h('div', { style: { marginTop: 3, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
                  按钮('重置这个聊天', () => 重置聊天(t), false, 忙),
                  t.重置 ? h('span', { style: S.dim }, '上次重置于 ' + 时间短(t.重置.重置At) + '，旧会话还留着') : null,
                  按钮('戳一下', () => 戳一个(t), false, 忙),
                ),
              )),
          社态.私聊
            ? h('div', { style: { ...S.日志行, marginTop: 10, borderTop: '1px solid var(--dsw-alias-border-l2)', paddingTop: 8 } },
                h('div', null,
                  '主人私聊（' + 短id(社态.私聊.会话id) + '）· ' +
                    (社态.私聊.活着 ? '会话活着' : '等主人第一句') +
                    (社态.私聊.重置 ? ' · 上次重置过，旧会话还留着' : ''),
                ),
                社态.私聊.故障
                  ? h('div', { style: { color: '#c0392b' } },
                      '⚠ 上次失败：' + (社态.私聊.故障.最后码 || '未知') + (社态.私聊.故障.最后说 ? '：' + 社态.私聊.故障.最后说 : '') + (社态.私聊.故障.连续 > 1 ? '（连续 ' + 社态.私聊.故障.连续 + ' 次）' : ''),
                    )
                  : null,
                h('div', { style: { marginTop: 3 } }, 按钮('重置这个聊天', () => 重置聊天(社态.私聊), false, 忙)),
              )
            : null,
        ),
        // —— 人物志 ——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '人物志（她认识的人）'),
          h('div', { style: S.dim },
            '一个人一张卡：同一个人的大号和小号都算同一个人，号都列在他名下。' +
              '关系跟着人走，群和私聊里是同一段关系；她也记得人和人之间的关系（谁是谁的弟弟、同学、对象），' +
              '别人自己说出来的会直接记住，她自己看出来的也会记。事实和边界跟着人走，并标明是从哪间屋听来的。' +
              '打字风格只量句子长短、标点、语气词这些节奏，不存原话；对方说过「别学我」就会停。' +
              '私下说过的事她知道，但不会在群里点名复述。只存在本机。',
          ),
          h('div', { style: { ...S.dim, marginTop: 4 } },
            '共 ' + 人物页.length + ' 个人' +
              (账号数 > 人物页.length ? '（' + 账号数 + ' 个号）' : '') +
              (关系页.length ? ' · ' + 关系页.length + ' 条关系' : '') +
              (人物熟 ? '，熟人以上 ' + 人物熟 + ' 个' : '') +
              (人物态 && 人物态.文件 ? ' · ' + 人物态.文件 : '') +
              (社交.记人 ? '' : '（记人已关，下面是之前记下的）') +
              (社交.学说话 ? '' : '（学说话已关，下面是之前量下的）') +
              (社交.学表情 ? '' : '（学表情已关，下面是之前量下的）'),
          ),
          h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 } },
            h('input', {
              type: 'text',
              style: { ...S.input, flex: '1 1 220px', width: 'auto' },
              placeholder: '搜名字、QQ、小号、房间、关系或她记得的事',
              value: 人物搜,
              onChange: (e) => 设人物搜(e.target.value),
            }),
            h('label', { style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, cursor: 'pointer' } },
              h('input', { type: 'checkbox', checked: 只看熟, onChange: (e) => 设只看熟(e.target.checked) }),
              '只看熟人以上',
            ),
            按钮('刷新', 拉人物, false, 人物载),
          ),
          人物错 ? h('div', { style: { ...S.未保存, marginTop: 6 } }, '读不到人物志：' + 人物错) : null,
          人物载 && !人物态 ? h('div', { style: { ...S.dim, marginTop: 6 } }, '读取中…') : null,
          人物态 && 人物筛过.length === 0
            ? h('div', { style: { ...S.dim, marginTop: 6 } },
                人物页.length === 0
                  ? '还没记住人。等她在群或好友私聊里看见新消息，这里会慢慢长出来。'
                  : '没有匹配的人。')
            : null,
          人物显示.map((p) => {
            const 房间 = Array.isArray(p.房) ? p.房 : []
            const 展开 = 展开人 === p.号
            const 事实们 = Array.isArray(p.事实) ? p.事实 : []
            const 边界们 = Array.isArray(p.边界) ? p.边界 : []
            const 账号们 = Array.isArray(p.账号) ? p.账号 : []
            const 关系们 = Array.isArray(p.关系们) ? p.关系们 : []
            const 被说 = Array.isArray(p.被说) ? p.被说 : []
            const 总 = p.关系 && typeof p.关系 === 'object' ? p.关系 : null
            const 风格 = p.风格 && typeof p.风格 === 'object' ? p.风格 : null
            const 出处 = (x) => (x.房叫 || x.房 || '') + (x.密 ? '，私下' : '')
            const 来源说 = (来源) => 来源 === '自认' ? '自己说这是他的号' : 来源 === '模型' ? '看出来的' : '见过'
            return h('div', {
              key: p.号,
              style: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, padding: '8px 10px', marginTop: 8 },
            },
              h('div', {
                style: { display: 'flex', justifyContent: 'space-between', gap: 8, cursor: 'pointer' },
                onClick: () => 设展开人(展开 ? '' : p.号),
              },
                h('div', { style: { minWidth: 0 } },
                  h('div', null,
                    h('span', { style: { fontWeight: 600 } }, p.主人 ? '主人' : String(p.名 || p.号)),
                    h('span', { style: S.dim }, '（' + p.号 + '）'),
                    p.主人 ? h('span', { style: { ...S.dim, marginLeft: 6 } }, '最亲近的人') : null,
                  ),
                  h('div', { style: S.dim },
                    (Array.isArray(p.别名) && p.别名.length ? '也叫 ' + p.别名.join('、') + ' · ' : '') +
                      (账号们.length > 1 ? 账号们.length + ' 个号（都算同一个人）· ' : '') +
                      '认识 ' + (p.天数 || 0) + ' 天 · 见过 ' + (p.见过 || 0) + ' 次' +
                      ' · 暖 ' + ((p.印象 && p.印象.暖) || 0) + ' / 信 ' + ((p.印象 && p.印象.信) || 0) +
                      (总 ? ' · ' + 总.阶段 + ' · 口气' + 总.口气 : '') +
                      (房间.length ? ' · ' + 房间.length + ' 间屋子' : ' · 还没在屋里说过话') +
                      (关系们.length ? ' · ' + 关系们.length + ' 条关系' : ''),
                  ),
                ),
                h('span', { style: { ...S.dim, flex: '0 0 auto' } }, 展开 ? '收起 ▲' : '展开 ▼'),
              ),
              展开 ? h('div', { style: { marginTop: 6 } },
                账号们.length > 1
                  ? h('div', { style: { fontSize: 12, marginTop: 4 } },
                      '账号（都算同一个人）：' +
                        账号们.map((a) => (a.主 ? '主号 ' : '') + a.号 +
                          (a.名 && a.名 !== p.名 ? ' ' + a.名 : '') +
                          '（' + 来源说(a.来源) + (a.房叫 ? ' · ' + a.房叫 : '') + '）').join('；'),
                    )
                  : null,
                总
                  ? h('div', { style: { padding: '6px 0', borderTop: '1px dashed var(--dsw-alias-border-l2)' } },
                      h('div', { style: { fontWeight: 600, fontSize: 12 } }, '总的关系（群和私聊共用）'),
                      h('div', { style: S.dim },
                        '综合好感 ' + (总.综合 === undefined ? '—' : 总.综合) + ' / 100 · ' +
                          '熟 ' + 总.熟 + ' · 暖 ' + 总.暖 + ' · 张力 ' + 总.张力 +
                          ' · 聊过 ' + 总.互动 + ' 次 · 被叫 ' + 总.被叫 + ' 次' +
                          (总.最后At ? ' · 最近 ' + 时间短(总.最后At) : '') +
                          (总.上次她说At ? ' · 她上次开口 ' + 时间短(总.上次她说At) : ''),
                      ),
                    )
                  : null,
                关系们.length || 被说.length
                  ? h('div', { style: { fontSize: 12, marginTop: 4 } },
                      h('span', { style: { fontWeight: 600 } }, '关系网：'),
                      [
                        ...关系们.map((r) => r.谁 +
                          (r.谁号 && r.谁号 !== r.谁 ? '（' + r.谁号 + '）' : '') +
                          ' 是他' + r.关系 + '（' + (r.明说 ? '他说的' : '她看出来的') +
                          (r.房叫 ? ' · ' + r.房叫 : '') + (r.密 ? ' · 私下' : '') + '）'),
                        ...被说.map((r) => r.谁 + ' 说 他 是 ' + r.关系 +
                          '（' + (r.明说 ? '明说' : '看出来的') +
                          (r.房叫 ? ' · ' + r.房叫 : '') + (r.密 ? ' · 私下' : '') + '）'),
                      ].join('；'),
                    )
                  : null,
                风格
                  ? h('div', { style: { fontSize: 12, marginTop: 4 } },
                      '打字风格：' + (
                        风格.别学
                          ? '对方说过别学，已经停了'
                          : 风格.摘要
                            ? 风格.摘要
                            : 风格.样本 >= 6
                              ? '还在摸，没到能描述的程度'
                              : '还没攒够样本'
                      ) +
                      (风格.样本 ? ' · 学了 ' + 风格.样本 + ' 条' : '') +
                      (风格.摸清 && Array.isArray(风格.语气词) && 风格.语气词.length
                        ? ' · 常用语气词：' + 风格.语气词.join('、')
                        : ''),
                    )
                  : null,
                风格 && 风格.摸清
                  ? h('div', { style: S.dim },
                      '平均一句 ' + 风格.句长 + ' 字 · 短句 ' + 风格.短句 + '% · 问句 ' + 风格.问句 + '%' +
                        ' · 句号 ' + 风格.句号 + '% · 叹号 ' + 风格.叹号 + '%' +
                        (风格.表情 ? ' · 表情 ' + 风格.表情 + '%' : '') +
                        (风格.连发 ? ' · 连发 ' + 风格.连发 + '%' : ''),
                    )
                  : null,
                事实们.length ? h('div', { style: { fontSize: 12, marginTop: 4 } },
                  '她记得（跟人走）：' +
                    [...事实们].sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0))
                      .map((f) => f.文 + '（' + 出处(f) + '）').join('；')) : null,
                边界们.length ? h('div', { style: { fontSize: 12, marginTop: 2 } },
                  '别碰（跟人走）：' +
                    [...边界们].sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0))
                      .map((b) => b.文 + '（' + (b.房叫 || b.房 || '') + '）').join('；')) : null,
                h('div', { style: { fontWeight: 600, fontSize: 12, marginTop: 6 } },
                  '各间屋的相处' + (房间.length > 1 ? '（共用上面那段关系）' : '')),
                房间.length === 0
                  ? h('div', { style: S.dim }, '还没有群或好友里的记录。')
                  : 房间.map((r) => {
                      const 记忆 = Array.isArray(r.记忆) ? r.记忆 : []
                      return h('div', {
                        key: r.key,
                        style: { padding: '6px 0', borderTop: '1px dashed var(--dsw-alias-border-l2)' },
                      },
                        h('div', { style: { fontWeight: 600, fontSize: 12 } }, r.叫 + ' · ' + r.阶段 + ' · ' + r.口气),
                        h('div', { style: S.dim },
                          '这间屋：熟 ' + r.熟 + ' · 暖 ' + r.暖 + ' · 张力 ' + r.张力 +
                            ' · 见过 ' + r.见过 + ' · 聊过 ' + r.互动 + ' 次 · 被叫 ' + r.被叫 + ' 次' +
                            (r.最后At ? ' · 最近 ' + 时间短(r.最后At) : '') +
                            (r.上次她说At ? ' · 她上次开口 ' + 时间短(r.上次她说At) : ''),
                        ),
                        记忆.length ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-state-business-primary)' } },
                          '这间屋记得那次：' + 记忆.map((x) => x.文).join('；')) : null,
                      )
                    }),
              ) : null,
            )
          }),
          !人物词 && !全部人 && 人物筛过.length > 人物显示.length
            ? h('div', { style: { marginTop: 8 } }, 按钮('显示全部 ' + 人物筛过.length + ' 个', () => 设全部人(true)))
            : null,
          !人物词 && 全部人 && 人物筛过.length > 40
            ? h('div', { style: { marginTop: 8 } }, 按钮('先只看最近 40 个', () => 设全部人(false)))
            : null,
          关系页.length
            ? h('div', { style: { marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--dsw-alias-border-l2)' } },
                h('div', { style: { fontWeight: 600, fontSize: 13 } }, '关系网（' + 关系页.length + ' 条）'),
                h('div', { style: { ...S.dim, marginTop: 2 } },
                  '人和人之间的关系：谁是谁的弟弟、同学、对象。她只在本机记着，不会当成聊天工具，也不会在群里替人公开介绍。'),
                (全部关系 ? 关系页 : 关系页.slice(0, 10)).map((e, i) => h('div', {
                  key: [e.甲, e.乙, e.关系, e.房, i].join('|'),
                  style: { ...S.日志行, marginTop: 4 },
                },
                  e.甲名 + ' 的' + e.关系 + '：' + e.乙名 +
                    (e.乙号 ? '（' + e.乙号 + '）' : '') +
                    ' · ' + (e.明说 ? '明说' : '看出来的') +
                    (e.密 ? ' · 私下' : '') + ' · ' + (e.房叫 || e.房),
                )),
                关系页.length > 10
                  ? h('div', { style: { marginTop: 8 } },
                      按钮(全部关系 ? '先看最近 10 条' : '显示全部 ' + 关系页.length + ' 条', () => 设全部关系(!全部关系)))
                  : null,
              )
            : null,
        ),
        h('div', { style: { ...S.dim, marginTop: 6 } },
          'QQ 收藏表情：' + ((态.表情包 && 态.表情包.数量) || 0) + ' 张' +
            (态.表情包 && Array.isArray(态.表情包.最近) && 态.表情包.最近.length
              ? ' · ' + 态.表情包.最近.slice(-5).map((x) => '#' + x.id + ' ' + x.label).join(' · ')
              : ''),
        ),

        // —— 翻旧记录（Tulpa → 经历流） ——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '翻旧记录（Tulpa → 她的过去）'),
          h('div', { style: S.dim },
            '只读：把 Tulpa 里已经存着的 QQ 私聊文字一条条写进鱼脑的经历流，让她的「以前」有真东西撑着。' +
              '群聊一条都不取；她说话还是走上面那条 QQ 通道，Tulpa 不能替她开口。' +
              '这些事在她那里标成「旧记录」—— 是翻到的聊天文字，不是她亲眼经历过的事。',
          ),
          行('启用翻旧记录', 勾(导入.启用, (v) => 改导入('启用', v)), '关着 = 下面几个按钮一律拒绝，一次都不连 Tulpa。'),
          行('MCP 地址', h('input', {
            type: 'text',
            style: S.input,
            value: String(导入.地址 || ''),
            placeholder: 'http://127.0.0.1:18777/mcp',
            onChange: (e) => 改导入('地址', e.target.value.trim()),
          }), 'Tulpa 在本机开的 MCP 接口；只认 http(s)。'),
          行('访问令牌', h('input', {
            type: 'password',
            style: S.input,
            value: String(导入.令牌 || ''),
            placeholder: '留空 = 读环境变量 TULPA_MCP_TOKEN',
            onChange: (e) => 改导入('令牌', e.target.value),
          }), '保存后页面只回显「(已设置)」，原样保存不会改动真令牌；要换就把整串删掉重填。令牌只落本机配置文件，不进日志、不进仓库。'),
          行('私聊白名单', h('input', {
            type: 'text',
            style: S.input,
            value: 白名单文本,
            placeholder: '可空；例如：10001, 10002（会话号，逗号分隔）',
            onChange: (e) => { 设白名单文本(e.target.value); 改导入('白名单', 拆列表(e.target.value)) },
          }), '只导这些会话；留空 = Tulpa 里所有好友私聊（群聊永远不导）。'),
          行('每轮条数 / 页数',
            h('div', { style: { display: 'flex', gap: 8 } },
              数框(导入.每轮条数, (v) => 改导入('每轮条数', v), 1, 1, 2000),
              数框(导入.每轮页数, (v) => 改导入('每轮页数', v), 1, 1, 50),
            ),
            '点一次「继续导」最多写进多少条、最多往更早翻几页；没翻完下次从游标接着来。',
          ),
          h('div', { style: { ...S.dim, marginTop: 6 } },
            '开关：' + (导态.启用 ? '开' : '关') +
              '｜鱼脑：' + (导态.鱼脑可用 ? '在' : '没挂上（写不进经历）') +
              '｜令牌：' + (导态.有令牌 ? '有' : '没有') +
              '｜有进度的会话：' + (导态.会话数 || 0) + ' 间' +
              (导态.运行中 ? '｜正在导' : ''),
          ),
          h('div', { style: { ...S.日志行, marginTop: 6 } },
            '上一轮：写进 ' + (本轮.写 || 0) + ' 条｜本来就有的 ' + (本轮.重 || 0) + ' 条｜认不出 ' + (本轮.跳 || 0) + ' 条｜翻了 ' + (本轮.页数 || 0) + ' 页' +
              (导态.工具 ? '｜用的是「' + 导态.工具 + '」' : '') +
              (导态.错误 ? '｜上次报错：' + 导态.错误 : ''),
          ),
          h('div', { style: { marginTop: 8 } },
            按钮('继续导', 跑一轮导入, true, 忙 || 导忙),
            h('span', { style: S.dim }, '　'),
            按钮('停止', 停导入, false, 导忙),
            h('span', { style: S.dim }, '　'),
            按钮('清游标重来', 重来导入, false, 忙 || 导忙),
            h('span', { style: S.dim }, '　'),
            按钮('刷新进度', 拉导入, false, 导忙),
          ),
          h('div', { style: { ...S.dim, marginTop: 4 } },
            '改完上面的要先点「保存设置」—— 「继续导」用的是已经保存的那份。' +
              '进度落在 ' + String(导态.状态文件 || '游标文件') + '，重启之后接着往更早翻；重复的条目不会再写第二遍。',
          ),
          导说 ? h('div', { style: { ...S.ok, marginTop: 6 } }, 导说) : null,
        ),

        // —— 动作 ——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '自己动手'),
          h('div', null,
            按钮('保存设置', 存, true, 忙),
            h('span', { style: S.dim }, '　'),
            按钮('测试一句', 试一句, false, 忙),
            h('span', { style: S.dim }, '　'),
            按钮('刷新', 拉, false, 忙),
          ),
          h('div', { style: { ...S.dim, marginTop: 4 } }, '「测试一句」会真的发一句去 QQ（绕过试运行），用来确认整条路通没通。'),
          说 ? h('div', { style: { ...S.ok, marginTop: 6 } }, 说) : null,
        ),

        // —— 思想活动：她脑子里在跑什么（判断链 / 模型思路 / 心情 / 鱼脑）——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } },
            '思想活动 · ' + 显示绪.length + ' 条' + (绪停 ? '（已暂停刷新）' : '（每 3 秒自己刷）'),
          ),
          绪状态条(),
          h('div', { style: { marginBottom: 6, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
            [''].concat(绪类别们).map((k) =>
              h('span', { key: k === '' ? '全部' : k }, 按钮(k === '' ? '全部' : k, () => 设绪类(k), 绪类 === k)),
            ),
            h('span', { style: { flex: '1 1 20px' } }),
            按钮(绪停 ? '继续刷新' : '暂停刷新', () => 设绪停(!绪停), 绪停),
            按钮('立刻刷一次', 拉绪, false),
          ),
          绪错 ? h('div', { style: { fontSize: 12, color: '#c0392b', fontWeight: 600 } }, 绪错) : null,
          h('div', {
            ref: 绪底,
            onScroll: (e) => {
              const 栏 = e.currentTarget
              贴底.current = 栏.scrollHeight - 栏.scrollTop - 栏.clientHeight < 40
            },
            style: { maxHeight: 320, overflowY: 'auto' },
          },
            显示绪.length === 0
              ? h('div', { style: S.dim },
                  绪流.length === 0
                    ? '还没有动静。她一判断、一想事、心情一动，这里就来一条。'
                    : '这个类别下还没有。',
                )
              : 显示绪.map(绪行),
          ),
          h('div', { style: { ...S.dim, marginTop: 6 } },
            '点一条能展开原始详情（判断理由全文、她当时看到的消息、真正发出去的话）。整条思路流也落在 ' +
              String((绪摘 && 绪摘.落盘) || 'qq-thoughts.jsonl') + '，重启后还能回看最近 400 条。',
          ),
        ),

        // —— 记录 ——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '最近 ' + 日志.length + ' 条记录（新的在最下面）'),
          h('div', { style: { marginTop: 6, maxHeight: 220, overflowY: 'auto' } },
            日志.length === 0
              ? h('div', { style: S.dim }, '还没有记录。')
              : 日志.map((条, i) => h('div', { key: i, style: S.日志行 }, 条.时间 + '　' + 条.文本)),
          ),
        ),

        // —— 悬浮保存条 ——
        脏
          ? h('div', { style: S.悬浮保存条 },
              h('span', { style: { fontWeight: 600, color: '#c0392b' } }, '⚠ 有改动还没保存'),
              h('span', { style: S.dim }, '改完点这里就行'),
              按钮('保存设置', 存, true, 忙),
            )
          : null,
      )
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('settings.section', () =>
        slots.register(
          { name: 'settings.section', id: 'qq-bridge', order: 54, label: () => '通到 QQ' },
          Section,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
