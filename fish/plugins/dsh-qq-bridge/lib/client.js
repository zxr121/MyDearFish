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

    function Section() {
      const [态, 设态] = React.useState(null)
      const [脏, 设脏] = React.useState(false)
      const [忙, 设忙] = React.useState(false)
      const [说, 设说] = React.useState('')
      const [群文本, 设群文本] = React.useState('')
      const [好友文本, 设好友文本] = React.useState('')
      const [称呼文本, 设称呼文本] = React.useState('')
      const [兴趣文本, 设兴趣文本] = React.useState('')
      const [模型们, 设模型们] = React.useState([])
      const [导忙, 设导忙] = React.useState(false)
      const [导说, 设导说] = React.useState('')
      const [白名单文本, 设白名单文本] = React.useState('')
      const [人物态, 设人物态] = React.useState(null)
      const [人物载, 设人物载] = React.useState(false)
      const [人物错, 设人物错] = React.useState('')
      const [人物搜, 设人物搜] = React.useState('')
      const [只看熟, 设只看熟] = React.useState(false)
      const [展开人, 设展开人] = React.useState('')
      const [全部人, 设全部人] = React.useState(false)

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
          模型选项.push({ value: String(p.id) + '/' + String(m.id), label: String(p.name || p.id) + ' · ' + String(m.name || m.id) })
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
        return h('select', { style: S.input, value: 当前, onChange: (e) => onChange(e.target.value) },
          h('option', { value: '' }, 默认词),
          ...(列表里没有 ? [h('option', { value: 当前 }, 当前 + '（当前配置）')] : []),
          ...模型选项.map((o) => h('option', { key: o.value, value: o.value }, o.label)),
        )
      }

      if (!态) return h('div', { style: S.wrap }, h('div', { style: S.h }, '通到 QQ'), h('div', { style: S.dim }, '读取中…'))

      const 配置 = 态.配置 || {}
      const 目标们 = Array.isArray(态.活着的会话) ? 态.活着的会话 : []
      const NapCat = 态.NapCat状态 || null
      const 日志 = Array.isArray(态.日志) ? 态.日志 : []
      const 社交 = 配置.社交 || {}
      const 社态 = 态.社交 || {}
      const 社交目标们 = Array.isArray(社态.目标) ? 社态.目标 : []
      const 自己 = 社态.自己 || (NapCat && !NapCat.错 ? { 昵称: NapCat.昵称, 号: NapCat.用户 } : null)
      const 导入 = 配置.导入 || {}
      const 导态 = 态.导入 || {}
      const 戳 = 配置.戳一戳 || {}
      const 戳态 = 态.戳一戳 || {}
      const 本轮 = 导态.本轮 || {}
      const 人物页 = 人物态 && Array.isArray(人物态.人物) ? 人物态.人物 : []
      const 人物词 = 人物搜.trim().toLowerCase()
      const 人物筛过 = 人物页.filter((p) => {
        const 房间 = Array.isArray(p.房) ? p.房 : []
        if (只看熟 && !房间.some((r) => Number(r.熟) >= 35)) return false
        if (人物词 === '') return true
        const 文 = [
          p.名, p.号,
          ...(Array.isArray(p.别名) ? p.别名 : []),
          ...房间.map((r) => r.叫),
          ...(Array.isArray(p.事实) ? p.事实.map((f) => f.文) : []),
        ].join(' ').toLowerCase()
        return 文.includes(人物词)
      })
      const 人物显示 = 人物词 !== '' || 全部人 ? 人物筛过 : 人物筛过.slice(0, 40)
      const 人物熟 = 人物页.filter((p) => (Array.isArray(p.房) ? p.房 : []).some((r) => Number(r.熟) >= 35)).length

      return h(
        'div',
        { style: S.wrap },

        h('div', { style: S.h }, '通到 QQ'),
        h('div', { style: S.dim },
          '它在 DSH 里说完一整轮，就把那句原文发到 QQ；你在 QQ 里说的话也会转进来。' +
            '下面的社交模式里，它只会挑自己感兴趣的消息看，再决定要不要接；能回答、被 @、群里热闹都不是理由。' +
            '版本 ' + String(态.版本 || '?') + '｜配置文件：' + String(态.配置文件 || ''),
        ),
        NapCat && !NapCat.错
          ? h('div', { style: S.已同步 }, '✓ 连着的 QQ：' + NapCat.昵称 + '（' + NapCat.用户 + '）')
          : h('div', { style: S.未保存 }, '⚠ 连不上 NapCat' + (NapCat && NapCat.错 ? '：' + NapCat.错 : '')),
        h('div', { style: 脏 ? S.未保存 : S.已同步 },
          脏 ? '⚠ 上面有改动还没保存 —— 改完点「保存设置」（有改动时底下还会浮一条出来）' : '设置已同步 ✓',
        ),

        // —— 开关 ——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '开关'),
          行('总开关', 勾(配置.总开关, (v) => 改('总开关', v)), '关着 = 一句都不发（安全默认）。'),
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
            h('option', { value: '' }, '（自动：QQ 私聊专用屋）'),
            ...目标们.map((s) =>
              h('option', { value: s.id }, (s.标题 || '…' + 短id(s.id)) + ' · ' + 短id(s.id)),
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
              '在 SnowLuma 的「HTTP 上报 / httpClient」里填下面这个地址，她被戳时才会收到。',
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
            '复制到 SnowLuma 的 HTTP 上报地址（不要填 access token）。',
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
              h('option', { value: 'auto' }, 'auto —— 没人叫的群聊也按兴趣交给她挑'),
              h('option', { value: 'mention' }, 'mention —— 只把被叫到的消息交给她挑'),
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
          行('冷却秒', 数框(社交.冷却秒, (v) => 改社交('冷却秒', v), 1, 10, 3600), '同一目标两次开口的成熟期基础间隔；实际会按兴致走指数曲线。'),
          行('冷却曲线',
            h('div', { style: { display: 'flex', gap: 8 } },
              数框(社交.冷却最短秒, (v) => 改社交('冷却最短秒', v), 1, 1, 3600),
              数框(社交.冷却最长倍率, (v) => 改社交('冷却最长倍率', v), 0.05, 1, 4),
            ),
            '最有兴致时冷却降到左边秒数（默认 5）；兴致最低时是基础 × 右边。中间按指数曲线过渡。',
          ),
          行('余额吃紧',
            h('div', { style: { display: 'flex', gap: 8 } },
              数框(社交.余额吃紧线, (v) => 改社交('余额吃紧线', v), 0.5, 0, 1000),
              数框(社交.余额吃紧倍率, (v) => 改社交('余额吃紧倍率', v), 0.05, 1, 3),
            ),
            '零花钱从左边（元）降到「最低余额」时，冷却按曲线逐渐乘以右边；低于最低余额就不再开口。',
          ),
          行('接话次数', h('span', { style: S.dim }, '不设上限'), '只受鱼脑零花钱额度约束；冷却只决定说话的节奏，不限制一天或一小时聊多少轮。'),
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
            placeholder: '可空；例如：游戏, 猫, 音乐',
            onChange: (e) => { 设兴趣文本(e.target.value); 改社交('兴趣词', 拆列表(e.target.value)) },
          }), '只有她真正感兴趣的话题才会看、才可能接；留空时只能靠她在这间屋里看过的东西判断。'),
          行('关注上限', 数框(社交.关注上限, (v) => 改社交('关注上限', v), 1, 1, 30), '小模型一次最多挑几条她感兴趣的消息进入视线；没挑中的当没看见。'),
          行('记人', 勾(社交.记人, (v) => 改社交('记人', v)), '在群和好友私聊里认人、记长期有用的事（近况、喜好、边界），并按熟悉程度调整口气；只存本机，私聊和这间屋里知道的事不会带去别的群。关掉 = 不认人，也不读写人物志。'),
          行('快判', 勾(社交.快判, (v) => 改社交('快判', v)), '她看过的消息攒够后，先用零成本注意力分挡掉没兴趣也没对话信号的，再交给判断模型；学习期仍每条都判。'),
          行('快判门槛',
            h('div', { style: { display: 'flex', gap: 8 } },
              数框(社交.快判阈值, (v) => 改社交('快判阈值', v), 0.1, 0.1, 100),
              数框(社交.快判最多, (v) => 改社交('快判最多', v), 1, 1, 30),
            ),
            '左边是放行分数（默认 1.5，被叫到的永远放行）；右边是一批最多放几条分数够的进去。',
          ),
          行('探索额度',
            h('div', { style: { display: 'flex', gap: 8 } },
              数框(社交.探索间隔秒, (v) => 改社交('探索间隔秒', v), 30, 0, 86400),
              数框(社交.探索最低余额, (v) => 改社交('探索最低余额', v), 0.5, 0, 1000),
            ),
            '整批都没兴趣时，左边秒数里最多挑一条没见过的看看（0 = 不探索）；零花钱低于右边就不探索。',
          ),
          行('判断模型', 模型选择(社交.判断模型, (v) => 改社交('判断模型', v), '（跟当前主会话的模型走）'), '最好选便宜的小模型；每次只判断她感不感兴趣、要不要接，不生成回复。'),
          行('判断冷却秒', 数框(社交.判断冷却秒, (v) => 改社交('判断冷却秒', v), 1, 10, 3600), '同一目标最多多久问一次小模型；冷却里的消息先攒着，不重复花钱。'),
          行('判断阈值', 数框(社交.判断阈值, (v) => 改社交('判断阈值', v), 0.05, 0.1, 1), '她“感兴趣且想说”的把握低于这个数就不接；只看不回不受影响（0.1 ~ 1）。'),
          行('回复模型', 模型选择(社交.回复模型, (v) => 改社交('回复模型', v), '（跟随默认）'), '社交会话本身用哪个模型。'),
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
              (社态.在静音 ? '｜现在静音中' : ''),
          ),
          h('div', { style: { ...S.dim, marginTop: 4 } },
            '人物志：' + ((社态.人物 && 社态.人物.认识) || 0) + ' 个' +
              (社态.人物 && 社态.人物.熟 ? '，熟人以上 ' + 社态.人物.熟 + ' 个' : '') +
              (社态.人物 && Array.isArray(社态.人物.最近) && 社态.人物.最近.length
                ? ' · 最近：' + 社态.人物.最近.slice(0, 5).map((p) => (p.主人 ? '主人' : p.名) + '（' + p.号 + '）').join('、')
                : '') +
              (社交.记人 ? '' : '（记人已关）'),
          ),
          社交目标们.length === 0
            ? h('div', { style: { ...S.dim, marginTop: 6 } }, '还没配群或好友。保存后这里会列出每个目标活没活着、今天接了几次。')
            : 社交目标们.map((t) => h('div', { key: t.key, style: { ...S.日志行, marginTop: 6 } },
                t.叫 + '（' + 短id(t.会话id) + '）· ' +
                  (t.活着 ? '会话活着' : '等它第一次开口') +
                  (t.待看 ? ' · 待看 ' + t.待看 + ' 条' : '') +
                  (t.待发 ? ' · 正在想' : '') +
                  ' · 本小时 ' + (t.本小时 || 0) + ' / 今日 ' + (t.今日 || 0) +
                  (t.画像
                    ? ' · ' + (!社交.快判 ? '快判已关' : t.画像.成熟 ? '快判已成熟' : '好奇期 ' + (t.画像.样本 || 0) + '/' + (t.画像.门槛样本 || 20)) +
                      (typeof t.画像.意愿阈值 === 'number' ? ' · 门槛 ' + t.画像.意愿阈值.toFixed(2) : '') +
                      (t.画像.探索 ? ' · 探索 ' + t.画像.探索 + ' 次' : '') +
                      (t.画像.快判丢 ? '（挡了 ' + t.画像.快判丢 + ' 条）' : '') +
                      (Array.isArray(t.画像.兴趣词) && t.画像.兴趣词.length ? ' · 兴趣：' + t.画像.兴趣词.slice(0, 5).join('、') : '')
                    : '') +
                  (t.冷却 ? ' · 现在不接：' + t.冷却 : ''),
              )),
        ),
        // —— 人物志 ——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '人物志（她认识的人）'),
          h('div', { style: S.dim },
            '这里能翻看她记住的人、每间屋里的关系，以及只属于那间屋的事。' +
              '只存在本机；群和私聊之间不会互相带事实。',
          ),
          h('div', { style: { ...S.dim, marginTop: 4 } },
            '共 ' + 人物页.length + ' 个' +
              (人物熟 ? '，熟人以上 ' + 人物熟 + ' 个' : '') +
              (人物态 && 人物态.文件 ? ' · ' + 人物态.文件 : '') +
              (社交.记人 ? '' : '（记人已关，下面是之前记下的）'),
          ),
          h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 } },
            h('input', {
              type: 'text',
              style: { ...S.input, flex: '1 1 220px', width: 'auto' },
              placeholder: '搜名字、QQ、房间或她记得的事',
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
            const 房间事实 = (key) => (Array.isArray(p.事实) ? p.事实 : []).filter((f) => f.房 === key)
            const 房间边界 = (key) => (Array.isArray(p.边界) ? p.边界 : []).filter((b) => b.房 === key)
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
                      '认识 ' + (p.天数 || 0) + ' 天 · 见过 ' + (p.见过 || 0) + ' 次' +
                      ' · 暖 ' + ((p.印象 && p.印象.暖) || 0) + ' / 信 ' + ((p.印象 && p.印象.信) || 0) +
                      (房间.length ? ' · ' + 房间.length + ' 间屋子' : ' · 还没在屋里说过话'),
                  ),
                ),
                h('span', { style: { ...S.dim, flex: '0 0 auto' } }, 展开 ? '收起 ▲' : '展开 ▼'),
              ),
              展开 ? h('div', { style: { marginTop: 6 } },
                房间.length === 0
                  ? h('div', { style: S.dim }, '还没有群或好友里的记录。')
                  : 房间.map((r) => {
                      const 事实 = 房间事实(r.key)
                      const 边界 = 房间边界(r.key)
                      const 记忆 = Array.isArray(r.记忆) ? r.记忆 : []
                      return h('div', {
                        key: r.key,
                        style: { padding: '6px 0', borderTop: '1px dashed var(--dsw-alias-border-l2)' },
                      },
                        h('div', { style: { fontWeight: 600, fontSize: 12 } }, r.叫 + ' · ' + r.阶段 + ' · ' + r.口气),
                        h('div', { style: S.dim },
                          '熟 ' + r.熟 + ' · 暖 ' + r.暖 + ' · 张力 ' + r.张力 +
                            ' · 见过 ' + r.见过 + ' · 聊过 ' + r.互动 + ' 次 · 被叫 ' + r.被叫 + ' 次' +
                            (r.最后At ? ' · 最近 ' + 时间短(r.最后At) : '') +
                            (r.上次她说At ? ' · 她上次开口 ' + 时间短(r.上次她说At) : ''),
                        ),
                        事实.length ? h('div', { style: { fontSize: 12, marginTop: 2 } },
                          '记得：' + 事实.map((f) => f.文 + (f.密 ? '（密）' : '')).join('；')) : null,
                        边界.length ? h('div', { style: { fontSize: 12 } },
                          '别碰：' + 边界.map((b) => b.文).join('；')) : null,
                        记忆.length ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-state-business-primary)' } },
                          '记得那次：' + 记忆.map((x) => x.文).join('；')) : null,
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
