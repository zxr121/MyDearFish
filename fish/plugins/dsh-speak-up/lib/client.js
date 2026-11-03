// DSH「主动搭话」· 网页半边
//
// 只干一件事：在 **DSH 设置** 左侧栏加一项「主动搭话」，
// 把概率曲线、最长间隔保底、峰谷省钱、安静时段、房间和文案摆出来，
// 外加两个安全的试法（演练 / 真发一次）和一份最近记录。
//
// ⚠ 这里**不碰会话、不发消息**，只是往宿主那几条 /dsh-speak-up/* 路由上读写。
//   真正的概率、排程和 followup 都在宿主半边（lib/host.js），这样只有一份逻辑。
//
// ⚠ 槽位名 'settings.section' 跟 dsh-write 等其他设置插件用的是同一个，
//   是在这个环境里已经跑通的路子（不确定换 DSH 版本会不会变，见 README）。

window.__ModuleLoader__.load({
  id: 'dsh-speak-up',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const inject = ['slots']

    const B = '/dsh-speak-up'
    const get = (p) => fetch(B + p, { cache: 'no-store' }).then((r) => r.json()).catch(() => null)
    const post = (p, body) =>
      fetch(B + p, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      })
        .then((r) => r.json())
        .catch(() => null)

    const h = React.createElement

    // 样式贴着主题变量走，换皮肤/换深浅色都跟着变（照 dsh-write 的做法）
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
      页头: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 4 },
      页标题: { fontSize: 16, lineHeight: 1.4, fontWeight: 500 },
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
      // 原生下拉的弹出层自己画白底、只继承字色：不给选项带底色，暗色主题下就是白底白字。
      option: {
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
      },
      small: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6,
        padding: '4px 8px',
        background: 'transparent',
        color: 'inherit',
        fontSize: 12.5,
        width: 110,
        boxSizing: 'border-box',
      },
      ta: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6,
        padding: '8px 10px',
        background: 'transparent',
        color: 'inherit',
        fontSize: 12.5,
        width: '100%',
        boxSizing: 'border-box',
        lineHeight: 1.7,
        fontFamily: 'inherit',
        minHeight: 56,
      },
      btn: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6,
        padding: '5px 12px',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        fontSize: 12.5,
      },
      btnOn: {
        border: '1px solid var(--dsw-alias-state-business-primary)',
        borderRadius: 6,
        padding: '5px 12px',
        background: 'var(--dsw-alias-state-business-primary)',
        color: '#fff',
        cursor: 'pointer',
        fontSize: 12.5,
      },
      warn: {
        border: '1px solid #c0392b',
        borderRadius: 8,
        padding: '8px 10px',
        marginBottom: 10,
        fontSize: 12,
        lineHeight: 1.7,
        color: '#c0392b',
      },
      ok: { color: 'var(--dsw-alias-state-business-primary)', fontSize: 12 },
      已同步: {
        margin: '6px 0 10px',
        fontSize: 12,
        color: 'var(--dsw-alias-state-business-primary)',
      },
      未保存: {
        margin: '6px 0 10px',
        fontSize: 12,
        color: '#c0392b',
        fontWeight: 600,
      },
      /**
       * 悬浮的保存条（只在「有改动还没保存」时渲染）。
       * ⚠ sticky 而不是 fixed：它属于这张设置页，滚动到哪都贴在**这一页**的底部；
       *   页面上没有改动时它压根不渲染，所以平时不占地方、不挡内容。
       */
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
      已勾: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6,
        padding: '5px 8px',
        fontSize: 12,
        lineHeight: 1.6,
      },
      清单: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6,
        marginTop: 4,
        maxHeight: 260,
        overflowY: 'auto',
      },
      会话行: {
        display: 'flex',
        alignItems: 'center',
        padding: '5px 8px',
        cursor: 'pointer',
        borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06))',
      },
      会话行勾上: {
        background: 'var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.04))',
        fontWeight: 600,
      },
      tag: {
        display: 'inline-block',
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 4,
        padding: '0 6px',
        fontSize: 11,
        marginRight: 6,
        opacity: 0.9,
      },
      日志行: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 11.5, whiteSpace: 'pre-wrap' },
      图卡: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 8,
        padding: '8px 10px 4px',
        background: 'var(--dsw-alias-bg-layer-1)',
        overflow: 'hidden',
      },
      图空: { padding: '28px 12px', fontSize: 12, opacity: 0.7, textAlign: 'center' },
      图例: { display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', margin: '2px 0 4px', fontSize: 11.5 },
      图例项: { display: 'inline-flex', alignItems: 'center', gap: 6, opacity: 0.9 },
      图例线: { display: 'inline-block', width: 18, height: 3, borderRadius: 2 },
      图例虚线: { display: 'inline-block', width: 18, height: 0, borderTop: '2px dashed var(--dsw-alias-state-warn-primary, #c27a00)' },
      状态行: { fontSize: 12, margin: '2px 0 8px', lineHeight: 1.6 },
    }

    // ---------- 小控件 ----------

    const 提示 = (文本) => h('div', { style: S.hint }, 文本)
    const 行 = (标签, 控件, 说明) =>
      h(
        'div',
        { style: S.row },
        h('div', { style: S.lab }, 标签),
        h('div', { style: S.ctl }, 控件, 说明 ? 提示(说明) : null),
      )
    const 按钮 = (文字, onClick, 亮, 关) =>
      h(
        'button',
        { type: 'button', style: 亮 ? S.btnOn : S.btn, onClick, disabled: !!关, title: 文字 },
        文字,
      )
    /** 房间勾选用；总开关/试运行一律用下面的 段选，不用这种勾选框。 */
    const 勾 = (值, onChange) =>
      h('input', { type: 'checkbox', checked: !!值, onChange: (e) => onChange(e.target.checked) })
    const 数 = (值, onChange, 步, 关) =>
      h('input', {
        type: 'number',
        value: 值 === undefined || 值 === null ? '' : 值,
        step: 步 || 1,
        disabled: !!关,
        style: { ...S.small, ...(关 ? { opacity: 0.45 } : null) },
        onChange: (e) => onChange(e.target.value),
      })
    /** 明确的「开 / 关」「直线 / 慢热 / …」分段：亮着的那段就是当前值。 */
    const 段选 = (当前, 选项, onChange) =>
      h(
        'div',
        { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
        ...选项.map(([值, 标签]) => {
          const 亮 = 当前 === 值
          return h(
            'button',
            {
              key: 值,
              type: 'button',
              style: 亮 ? S.btnOn : S.btn,
              'aria-pressed': 亮,
              title: 标签,
              onClick: () => onChange(值),
            },
            标签,
          )
        }),
      )
    /** 会话 id 的后 8 位 —— 前面那截（session- 和 uuid 开头）全都一样，只有尾巴分得出谁是谁。 */
    const 短id = (id) => {
      const s = String(id)
      return s.length <= 8 ? s : s.slice(-8)
    }

    /** 标题拿不到就明说「（还没起名）」，**绝不留空白**（空白会让人以为坏了）。 */
    const 题 = (s) => (s && typeof s.标题 === 'string' && s.标题.trim() !== '' ? s.标题 : '（还没起名）')

    /** 逗号/空格/顿号都能当分隔（照抄老版输入框的行为）。 */
    const 拆id = (文) => String(文 || '').split(/[\s,;，、]+/).filter((x) => x !== '')

    // ---------- 直角坐标系函数图 ----------

    const 图宽 = 680
    const 图高 = 300
    const 图左 = 58
    const 图右 = 20
    const 图上 = 18
    const 图下 = 46
    const 绘图宽 = 图宽 - 图左 - 图右
    const 绘图高 = 图高 - 图上 - 图下
    const 轴色 = 'var(--dsw-alias-label-secondary, rgba(127,127,127,.72))'
    const 网格色 = 'var(--dsw-alias-border-l2, rgba(127,127,127,.28))'
    const 主色 = 'var(--dsw-alias-state-business-primary, #3b82f6)'
    const 峰色 = 'var(--dsw-alias-state-warn-primary, #c27a00)'
    const 红线 = '#c0392b'
    const 图字 = 11

    const 分钟文 = (m) => {
      const n = Number(m)
      if (!Number.isFinite(n)) return '0'
      return Number.isInteger(n) ? String(n) : n.toFixed(1)
    }

    /** 曲线上的取值（检查点用；末端 T 的两个点取到 100）。 */
    const 曲线取值 = (点们, 分钟) => {
      if (!Array.isArray(点们) || 点们.length === 0) return 0
      const 末 = 点们[点们.length - 1]
      if (分钟 >= 末[0]) return 末[1]
      if (分钟 <= 点们[0][0]) return 点们[0][1]
      for (let i = 1; i < 点们.length; i++) {
        if (分钟 <= 点们[i][0]) {
          const [m0, p0] = 点们[i - 1]
          const [m1, p1] = 点们[i]
          if (m1 === m0) return p1
          return p0 + ((p1 - p0) * (分钟 - m0)) / (m1 - m0)
        }
      }
      return 末[1]
    }

    /**
     * 画真正的直角坐标系：
     *   X = 距上次主动开口（分钟），Y = 本次检查开口概率（%）；
     *   两条曲线（谷时/峰时）各自乘倍率，末端在 T 处竖直跳到 100%；
     *   圆点是实际检查点，红虚线是保底，当前点标出“现在”。
     */
    const 图谱 = (图, 状态) => {
      if (!图 || !Array.isArray(图.谷) || !Array.isArray(图.峰)) {
        return h('div', { style: S.图空 }, '宿主没有给出曲线数据（可能是旧版宿主）；保存一次后会重新生成。')
      }
      const T = Math.max(1, Number(图.最长间隔分钟) || 180)
      const 当前 = 图.当前 || null
      const 生效 = 当前 && 当前.生效 ? 当前.生效 : (状态 && 状态.峰 ? '峰' : '谷')
      const 生效色 = 生效 === '峰' ? 峰色 : 主色
      const 两线重合 = Number(图.谷时倍率) === Number(图.峰时倍率)
      const x = (分钟) => 图左 + (Math.min(T, Math.max(0, Number(分钟) || 0)) / T) * 绘图宽
      const y = (百分比) => 图上 + (1 - Math.min(100, Math.max(0, Number(百分比) || 0)) / 100) * 绘图高
      const 折线 = (键, 点们, 颜色, 粗细, 虚, 透明度 = 1) =>
        h('polyline', {
          key: 键,
          points: 点们.map(([m, p]) => `${x(m).toFixed(1)},${y(p).toFixed(1)}`).join(' '),
          fill: 'none',
          stroke: 颜色,
          strokeWidth: 粗细,
          strokeLinejoin: 'round',
          strokeLinecap: 'round',
          opacity: 透明度,
          ...(虚 ? { strokeDasharray: '5 4' } : null),
        })
      const y刻度 = [0, 25, 50, 75, 100]
      const x刻度 = [0, T / 4, T / 2, (T * 3) / 4, T]
      const 检查点 = Array.isArray(图.检查点们) ? 图.检查点们 : []
      const 检查点们 = 检查点.map((m) => {
        const 值 = 曲线取值(生效 === '峰' ? 图.峰 : 图.谷, m)
        return h('circle', { key: `ck-${m}`, cx: x(m), cy: y(值), r: 2.2, fill: 生效色, opacity: 0.85 })
      })
      // 曲线颜色固定：谷时蓝实线、峰时橙虚线；当前生效那条只加粗，不换身份。
      const 峰生效 = 生效 === '峰'
      const 曲线们 = 两线重合
        ? [折线('curve-one', 图.谷, 主色, 2.6, false)]
        : [
            折线('curve-valley', 图.谷, 主色, 峰生效 ? 1.6 : 2.6, false, 峰生效 ? 0.4 : 1),
            折线('curve-peak', 图.峰, 峰色, 峰生效 ? 2.6 : 1.6, true, 峰生效 ? 1 : 0.6),
          ]

      const 当前x = 当前 ? x(当前.分钟) : 0
      const 当前y = 当前 ? y(当前[当前.生效]) : 0
      const 靠右 = 当前x > 图左 + 绘图宽 * 0.7
      const 当前标签 = 当前
        ? h(
            'text',
            {
              x: 靠右 ? 当前x - 8 : 当前x + 8,
              y: Math.max(图上 + 12, 当前y - 8),
              fontSize: 11,
              fill: 生效色,
              textAnchor: 靠右 ? 'end' : 'start',
            },
            `现在 ${分钟文(当前.分钟)} 分钟 / ${Number(当前[当前.生效]).toFixed(1)}%`,
          )
        : null

      return h(
        'svg',
        {
          viewBox: `0 0 ${图宽} ${图高}`,
          style: { width: '100%', height: 'auto', display: 'block' },
          role: 'img',
          'aria-label': '距上次主动开口与本次检查开口概率的函数图',
        },
        // 网格
        ...y刻度.map((p) =>
          h('line', {
            key: `gy-${p}`,
            x1: 图左,
            y1: y(p),
            x2: 图左 + 绘图宽,
            y2: y(p),
            stroke: 网格色,
            strokeWidth: 0.7,
            opacity: p === 0 ? 1 : 0.55,
          }),
        ),
        ...x刻度.map((m) =>
          h('line', {
            key: `gx-${m}`,
            x1: x(m),
            y1: 图上,
            x2: x(m),
            y2: 图上 + 绘图高,
            stroke: 网格色,
            strokeWidth: 0.7,
            opacity: m === 0 || m === T ? 1 : 0.45,
          }),
        ),
        // 坐标轴
        h('line', { x1: 图左, y1: 图上, x2: 图左, y2: 图上 + 绘图高, stroke: 轴色, strokeWidth: 1 }),
        h('line', {
          x1: 图左,
          y1: 图上 + 绘图高,
          x2: 图左 + 绘图宽,
          y2: 图上 + 绘图高,
          stroke: 轴色,
          strokeWidth: 1,
        }),
        // 刻度文字
        ...y刻度.map((p) =>
          h(
            'text',
            { key: `ly-${p}`, x: 图左 - 8, y: y(p) + 4, fontSize: 图字, fill: 轴色, textAnchor: 'end' },
            `${p}%`,
          ),
        ),
        ...x刻度.map((m) =>
          h(
            'text',
            {
              key: `lx-${m}`,
              x: x(m),
              y: 图上 + 绘图高 + 18,
              fontSize: 图字,
              fill: 轴色,
              textAnchor: m === 0 ? 'start' : m === T ? 'end' : 'middle',
            },
            `${分钟文(m)}${m === T ? '（保底）' : ''}`,
          ),
        ),
        h(
          'text',
          { x: 图左 + 绘图宽 / 2, y: 图高 - 10, fontSize: 图字, fill: 轴色, textAnchor: 'middle' },
          '距上次主动开口（分钟）',
        ),
        h(
          'text',
          {
            x: 14,
            y: 图上 + 绘图高 / 2,
            fontSize: 图字,
            fill: 轴色,
            textAnchor: 'middle',
            transform: `rotate(-90 14 ${图上 + 绘图高 / 2})`,
          },
          '本次检查开口概率（%）',
        ),
        // 保底线
        h('line', {
          x1: x(T),
          y1: 图上,
          x2: x(T),
          y2: 图上 + 绘图高,
          stroke: 红线,
          strokeWidth: 1.5,
          strokeDasharray: '5 4',
        }),
        h(
          'text',
          { x: x(T) - 6, y: 图上 + 12, fontSize: 11, fill: 红线, textAnchor: 'end' },
          `保底 ${T} 分钟 → 100%`,
        ),
        // 曲线、检查点、当前点
        ...曲线们,
        ...检查点们,
        当前
          ? h('circle', {
              cx: 当前x,
              cy: 当前y,
              r: 4.5,
              fill: 生效色,
              stroke: 'var(--dsw-alias-bg-layer-1, #fff)',
              strokeWidth: 1.5,
            })
          : null,
        当前标签,
      )
    }

    // 曲线预览的防抖计时器（页面模块只有这一份；不放进 React 状态，免得丢失请求）。
    let 预览计时 = null
    let 预览序号 = 0

    // ---------- 设置页 ----------

    function Section() {
      const [态, 设态] = React.useState(null)
      const [说, 设说] = React.useState('')
      const [忙, 设忙] = React.useState(false)
      // 次要路径（手填 id）的草稿：null = 没动过，直接显示配置里那份
      const [手填, 设手填] = React.useState(null)
      // 「改了但还没按保存」——填了不按保存等于没填，这个标志就是让这件事写在脸上
      const [脏, 设脏] = React.useState(false)
      const [同步话, 设同步话] = React.useState('')
      // 未保存草稿的曲线预览（宿主 /curve 返回，不写盘）
      const [预览, 设预览] = React.useState(null)
      const [预览状态, 设预览状态] = React.useState(null)

      const 拉 = React.useCallback(
        () =>
          get('/state').then((r) => {
            if (r && r.ok) {
              设态(r)
              设预览(null)
              设预览状态(null)
            } else 设说('读不到宿主那边的状态（插件加载了吗？）')
          }),
        [],
      )

      React.useEffect(() => {
        拉()
      }, [拉])

      if (!态 || !态.配置) {
        return h('div', { style: S.wrap }, h('div', { style: S.h }, '主动搭话'), h('div', { style: S.dim }, '读取中…'))
      }

      const 配置 = 态.配置
      const 图 = 预览 || 态.曲线
      const 状态 = 预览状态 || 态.概率状态

      /**
       * 改「要点保存」的字段 → 置脏，并把草稿送去 /curve 预览。
       * ⚠ /curve 只算图，不写盘；防抖 180ms，连续输入不会把宿主刷爆。
       */
      const 改 = (k, v) => {
        const 新配置 = { ...配置, [k]: v }
        设态((旧) => ({ ...旧, 配置: { ...旧.配置, [k]: v } }))
        设脏(true)
        const 号 = ++预览序号
        if (预览计时 !== null) clearTimeout(预览计时)
        预览计时 = setTimeout(async () => {
          预览计时 = null
          const r = await post('/curve', 新配置)
          if (号 !== 预览序号) return
          if (r && r.ok && r.曲线) {
            设预览(r.曲线)
            设预览状态(r.概率状态 || null)
          }
        }, 180)
      }

      /** 勾上的会话列表（老名单模式用；全选模式下看「不主动的会话」）。 */
      const 目标们 = Array.isArray(配置.目标会话) ? 配置.目标会话 : []
      const 不主动们 = Array.isArray(配置.不主动的会话) ? 配置.不主动的会话 : []
      const 是全选 = 配置.全选 !== false
      const 已勾 = (id) => (是全选 ? 不主动们.indexOf(id) < 0 : 目标们.indexOf(id) >= 0)

      /**
       * 勾上/取消 → **立刻自动保存**（她原话：「有打勾不就完了嘛」）。
       * ⚠ 自动存只发勾选相关的这几个字段（host 的 /save 是合并语义），
       *   所以不会覆盖她在别的字段里还没保存的改动。
       */
      const 切换 = (id, 勾上) => {
        let 补丁
        if (是全选) {
          补丁 = {
            全选: true,
            目标会话: [],
            不主动的会话: 勾上 ? 不主动们.filter((x) => x !== id) : [...不主动们, id],
          }
        } else {
          const 当前勾 = new Set(目标们)
          if (勾上) 当前勾.add(id)
          else 当前勾.delete(id)
          const 全部 = Array.isArray(态.活着的会话) ? 态.活着的会话.map((x) => String(x.id)) : []
          const 不主动 = 全部.filter((x) => !当前勾.has(x))
          补丁 = { 全选: true, 目标会话: [], 不主动的会话: 不主动 }
        }
        设态((旧) => ({ ...旧, 配置: { ...旧.配置, ...补丁 } }))
        自动存(补丁)
      }

      const 自动存 = async (补丁) => {
        设同步话('保存中…')
        const r = await post('/save', 补丁)
        if (r && r.ok) {
          // ⚠ 只把「服务端算出来的东西」刷回来，**不整体替换 配置** ——
          //   否则她在别的字段里还没保存的改动会被这次自动保存悄悄抹掉。
          设态((旧) => ({
            ...旧,
            日志: r.日志,
            目标情况: r.目标情况,
            目标活着: r.目标活着,
            活着的会话: r.活着的会话,
            概率状态: r.概率状态,
            曲线: r.曲线,
          }))
          设同步话('已保存 ✓')
        } else {
          设同步话('保存失败 ✗')
        }
      }

      const 存 = async () => {
        设忙(true)
        if (预览计时 !== null) {
          clearTimeout(预览计时)
          预览计时 = null
        }
        预览序号 += 1
        // 手填框里还有没提交的草稿 → 存的时候一起带上；
        // 手填 = 明确名单，所以关掉「全选」，只在她写的那几个房间里主动。
        const 要存 = 手填 === null ? 配置 : { ...配置, 全选: false, 目标会话: 拆id(手填) }
        const r = await post('/save', 要存)
        if (r && r.ok) {
          设态(r)
          设手填(null)
          设脏(false)
          设预览(null)
          设预览状态(null)
          设同步话('已保存 ✓')
          设说(r.说 || '保存好了')
        } else {
          设说((r && r.说) || '保存失败')
          设同步话('保存失败 ✗')
        }
        设忙(false)
      }

      const 掷 = async (模式) => {
        设忙(true)
        const r = await post('/roll', { 模式 })
        if (r && r.ok) 设态((旧) => ({ ...旧, 日志: r.日志 }))
        设说((r && r.说) || '跑完了')
        设忙(false)
      }

      const 新建小屋 = async () => {
        if (!window.confirm('新建一个空会话，并自动勾上它？（会在你的会话列表里多出一条）')) return
        设忙(true)
        const r = await post('/new-session', { 设为目标: true })
        if (r && (r.ok || r.新会话)) {
          设态((旧) => ({
            ...旧,
            配置: { ...旧.配置, 目标会话: r.配置 ? r.配置.目标会话 : 旧.配置.目标会话 },
            日志: r.日志,
            目标情况: r.目标情况,
            目标活着: r.目标活着,
            活着的会话: r.活着的会话,
            概率状态: r.概率状态,
            曲线: r.曲线,
          }))
        }
        设说((r && r.说) || '做完了')
        设忙(false)
      }

      const 会话们 = Array.isArray(态.活着的会话) ? 态.活着的会话 : []
      const 日志 = Array.isArray(态.日志) ? 态.日志 : []
      const 目标情况 = Array.isArray(态.目标情况) ? 态.目标情况 : []
      const 目标活着数 = 目标情况.filter((x) => x.活着 || x.可开).length
      const 手填文本 = 手填 === null ? (是全选 ? '' : 目标们.join(', ')) : 手填
      const 最长间隔 = Number(配置.最长间隔分钟) || 180
      const 检查间隔 = Number(配置.间隔分钟) || 30
      const 曲线类型 = 配置.曲线类型 || '慢热'
      const 强度可用 = 曲线类型 === '慢热' || 曲线类型 === '快起'
      const 峰倍率 = 配置.峰时倍率 === undefined ? 0.5 : Number(配置.峰时倍率)
      const 谷倍率 = 配置.谷时倍率 === undefined ? 1 : Number(配置.谷时倍率)
      const 保底文案 = 配置.保底文案 === undefined ? (配置.触发文案 || '') : String(配置.保底文案)

      const 当前概率 = 图 && 图.当前 ? Number(图.当前[图.当前.生效]) : 状态 ? Number(状态.本次概率) : null
      const 摘要 = (() => {
        if (!状态 && !图) return '还没读到概率状态。'
        if (状态 && 状态.状态 === '待确认') {
          const 待 = 状态.待确认 || {}
          return `已经发起一轮，正在等她真的说出正文（${待.短id || '目标'}，回合 ${待.回合 === null || 待.回合 === undefined ? '?' : 待.回合}，等了 ${待.已等秒 || 0} 秒）…`
        }
        if (状态 && 状态.状态 === '安静') {
          return `现在在安静时段（${配置.安静起}~${配置.安静止} 点）里，检查延到 ${状态.安静到 || '安静结束'}。`
        }
        if (状态 && 状态.状态 === '总开关关') return '总开关关着：不会掷、不会发；打开后如果已经超过最长间隔，会立即尝试一次。'
        if (状态 && 状态.状态 === '试运行') return '试运行中：概率照算，但掷中只记账、不真发；保底也不会真发。'
        const 距离 = 状态 && 状态.已过分钟 !== null && 状态.已过分钟 !== undefined
          ? `距上次主动开口 ${Number(状态.已过分钟).toFixed(1)} 分钟`
          : '还没记录上次主动开口'
        const 概率文 = 当前概率 === null ? '' : ` · 本次概率 ${当前概率.toFixed(1)}%`
        const 保底文 = 状态 && 状态.保底 ? ' · 已到保底' : ` · 下次检查 ${状态 && 状态.下次检查 ? 状态.下次检查 : '—'}`
        return `${距离} · ${状态 && 状态.峰 ? '峰时' : '谷时'} ×${状态 ? 状态.倍率 : '—'}${概率文}${保底文}`
      })()

      /** 清单里的一行：`☐ 标题 · …后8位 · 状态`，整行点一下就勾/取消（勾选立刻自动保存）。 */
      const 会话行 = (s) =>
        h(
          'label',
          {
            key: s.id,
            style: { ...S.会话行, ...(已勾(s.id) ? S.会话行勾上 : null) },
            title:
              String(s.id) +
              (s.标题来源 ? '｜标题来源：' + String(s.标题来源) : '') +
              (s.可开
                ? '（QQ 房间现在没开，概率命中时会按需开房）'
                : (s.有agent ? '' : '（这个会话现在没有活着的 agent，概率命中时会跳过它）')) +
              (s.不能因 ? '（QQ 桥现在不让主动开口：' + String(s.不能因) + '）' : '') +
              (s.归档 ? '（⚠ 这个会话已经归档了，建议取消勾选）' : ''),
          },
          h('input', {
            type: 'checkbox',
            checked: 已勾(s.id),
            onChange: (e) => 切换(s.id, e.target.checked),
          }),
          s.qq ? h('span', { style: { ...S.tag, marginLeft: 8 } }, 'QQ' + String(s.qq)) : null,
          h(
            'span',
            { style: { marginLeft: s.qq ? 0 : 8, ...(s.有agent || s.可开 ? null : S.dim) } },
            题(s),
          ),
          h('span', { style: { ...S.dim, marginLeft: 8, whiteSpace: 'nowrap' } }, '…' + 短id(s.id) + ' · ' + String(s.状态 || '?')),
        )

      return h(
        'div',
        { style: S.wrap },

        h('div', { style: S.页头 },
          h('div', { style: S.页标题 }, '主动搭话'),
          h('div', { style: S.dim }, '本页可以设置：开关、试运行、曲线、安静时段、房间、文案、角色。'),
          h('div', { style: S.dim }, '会话里很久没人说话时，她主动开口；群里的主动开口在「她在外面 → 通到 QQ → 在群里先开口」，两边不重复。保存后立即生效；勾选房间不用点保存。'),
          h('div', { style: S.dim }, '现在：总开关 ' + (配置.总开关 ? '开' : '关') +
            ' · 试运行 ' + (配置.试运行 ? '开' : '关') +
            ' · 安静 ' + (配置.安静起 === 配置.安静止 ? '不设' : 配置.安静起 + '–' + 配置.安静止 + ' 点'))),
        h(
          'div',
          { style: S.dim },
          '距她上次主动开口越久，下一次检查开口的概率越高；到最长间隔那一点强制 100%，会发起一轮真实主动聊天。' +
            '概率只在本地算和掷，不花模型；只有真的发起之后才走 DSH 的一轮。' +
            '版本 ' + String(态.版本 || '?') + '｜配置文件：' + String(态.配置文件 || '') +
            (态.状态文件 ? '｜状态文件：' + String(态.状态文件) : ''),
        ),
        // ⚠ 「填了不按保存等于没填」这件事必须写在脸上
        h('div', { style: 脏 ? S.未保存 : S.已同步 },
          (脏 ? '⚠ 上面有改动还没保存 —— 数字/文案改完要点「保存设置」' : '设置' + (同步话 || '已同步 ✓')) +
            '（勾选会话不用点保存，点一下立刻生效）'),
        h('div', { style: S.未保存 }, '⚠ 图上纵轴就是每轮真正会用的概率，没有隐藏加成；到最长间隔那一点是 100%。安静时段/总开关/房间开关/QQ 额度会让这一轮根本不掷，记录里会写原因，不会偷偷改概率。'),
        h('div', { style: S.dim }, '群里的主动开口在「她在外面 → 通到 QQ → 在群里先开口」里管：默认所有能说话的群都开、可逐群关掉，开头类型、安静多久、每屋每天几次也在那里。这里只管会话里长时间没人说话时的概率、间隔、安静时段和房间勾选，两边不重复。'),

        // —— 总开关 + 试运行 ——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '开关'),
          行(
            '总开关',
            段选(配置.总开关 ? '开' : '关', [['开', '开'], ['关', '关']], (v) => 改('总开关', v === '开')),
            '关掉就完全不动（定时器还在，但什么都不做）。',
          ),
          行(
            '试运行',
            段选(配置.试运行 ? '开' : '关', [['开', '开'], ['关', '关']], (v) => 改('试运行', v === '开')),
            '开着时概率照算，但掷中只记账、不真发；保底也不会真发，计时不会重置。',
          ),
        ),

        // —— 概率曲线 ——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '概率曲线'),
          h('div', { style: S.dim },
            '横轴是距她上次主动开口的时间；纵轴是这一轮检查真正会用的概率。' +
              '两条线分别是谷时和峰时（各乘自己的倍率），到最长间隔那一点一起跳到 100%。'),
          h('div', { style: { ...S.状态行, fontWeight: 600 } }, 摘要),
          h('div', { style: S.图例 },
            h('span', { style: S.图例项 },
              h('span', { style: { ...S.图例线, background: 主色 } }),
              `谷时（×${谷倍率}）`),
            峰倍率 === 谷倍率
              ? null
              : h('span', { style: S.图例项 },
                  h('span', { style: S.图例虚线 }),
                  `峰时（×${峰倍率}，虚线）`),
            h('span', { style: S.图例项 },
              h('span', { style: { ...S.图例线, background: 红线 } }),
              '保底 100%'),
            h('span', { style: S.图例项 }, '圆点 = 实际检查点'),
          ),
          h('div', { style: S.图卡 }, 图谱(图, 状态)),
          h('div', { style: { ...S.dim, marginTop: 4 } },
            '曲线末端到 100% 的竖直段就是保底：T 之前按倍率，到 T 直接满概率。' +
              '峰谷切换时当前生效曲线会换一条（比如 09:00 进入峰时），所以实际曲线可能在边界跳变——这是省钱设计，不是概率造假。'),
        ),

        // —— 曲线参数 ——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '曲线参数'),
          行(
            '曲线类型',
            段选(曲线类型, [['直线', '直线'], ['慢热', '慢热'], ['快起', '快起'], ['S形', 'S形']], (v) => 改('曲线类型', v)),
            '四种都从 0 升到 100%，只是快慢不同：慢热前低后陡，快起前快后缓，S形两头缓、中间陡。',
          ),
          行(
            '曲线强度',
            数(配置.曲线强度, (v) => 改('曲线强度', v), 0.1, !强度可用),
            '只有慢热/快起用这一格；越大越弯。直线和 S 形不用它。',
          ),
          行(
            '最长间隔（分钟，保底）',
            数(配置.最长间隔分钟, (v) => 改('最长间隔分钟', v), 10),
            '默认 180（3 小时）。到点这一轮概率强制 100%，会发起一轮真实主动聊天；改短后如果已经超过，会立即尝试一次。',
          ),
          行(
            '检查间隔（分钟）',
            数(配置.间隔分钟, (v) => 改('间隔分钟', v), 1),
            '默认 30。只决定多久看一眼曲线，不是概率本身；到最长间隔那一轮仍会单独补一次。检查间隔 ≥ 最长间隔时，平时概率用不上，只会在到点检查。',
          ),
        ),

        // —— 峰谷省钱 ——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '峰谷省钱（两条曲线的倍率）'),
          h('div', { style: S.dim },
            '时段是固定的，不用你填：周一~周五 9:00~12:00、14:00~18:00 是峰时（贵）；' +
              '其余全是谷时（午休 12:00~14:00、18:00 到次日 9:00、周六周日全天）。' +
              '峰时/谷时各乘自己的倍率；到点保底不分峰谷，仍然是 100%。'),
          行(
            '峰时倍率',
            数(配置.峰时倍率 === undefined ? 0.5 : 配置.峰时倍率, (v) => 改('峰时倍率', v), 0.05),
            '峰时（贵）概率乘这个数；1 = 不降，0 = 只在保底开口。',
          ),
          行(
            '谷时倍率',
            数(配置.谷时倍率 === undefined ? 1 : 配置.谷时倍率, (v) => 改('谷时倍率', v), 0.05),
            '谷时（便宜）概率乘这个数；1 = 不降。',
          ),
          h('div', { style: S.dim }, `两条曲线现在${峰倍率 === 谷倍率 ? '重合 = 不分峰谷' : '分开画，当前生效那条加粗'}。`),
          (峰倍率 === 0 || 谷倍率 === 0)
            ? h('div', { style: S.未保存 }, '⚠ 倍率填 0 = 那个时段平时不主动开口，只在到点保底那一轮说。')
            : null,
        ),

        // —— 安静时段 ——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '安静时段'),
          行(
            '安静时段（起 / 止，小时）',
            h('div', null, 数(配置.安静起, (v) => 改('安静起', v)), h('span', { style: S.dim }, ' 点 ~ '), 数(配置.安静止, (v) => 改('安静止', v)), h('span', { style: S.dim }, ' 点')),
            '默认 1 ~ 8 点不检查（含 1 点、不含 8 点）。跨午夜也行（比如 23 ~ 7）。安静时段顺延保底：结束后如果已超过最长间隔，立即补一次。这里只管会话里的主动搭话；QQ 群/好友的外发静音在「她在外面 → 通到 QQ → 静音时段」。',
          ),
          h('div', { style: S.未保存 }, '⚠ 两个数字填成一样（比如 8 和 8）= 不启用安静时段：整天都可能检查'),
          h('div', { style: S.dim }, '安静时段不检查，所以夜里最长沉默可能 = 最长间隔 + 安静时长。'),
        ),

        // —— 目标房间（默认全选；手填只是次要路径）——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '她能主动开口的房间'),
          h('div', { style: S.dim },
            '默认全部勾着（包括「通到QQ」里的群和好友）：概率命中时，她可能在这里自己开一个话题。' +
              '取消勾选 = 这个房间不再主动；一次命中只在一个房间里开口（随机挑一个能开口、又不忙的）。'),
          h('div', { style: { ...S.dim, marginTop: 2, fontWeight: 600 } }, '✓ 勾选/取消一点就生效（自动保存，不用再按保存）'),
          h('div', { style: { marginTop: 4 } },
            目标情况.length
              ? h('div', { style: S.已勾 },
                  '现在勾着 ' + 目标情况.length + ' 个' +
                    '：' + 目标情况.map((x) => (x.标题 ? x.标题 : '…' + 短id(x.id)) + (x.qq ? '（QQ' + x.qq + '）' : '') + (x.活着 || x.可开 ? '' : '（现在不能开口）')).join('、') +
                    '。其中 ' + 目标活着数 + ' 个现在能开口' +
                    (目标活着数 === 0 ? ' —— 概率命中也会跳过；QQ 房间先在「通到QQ」里连上' : ''),
                )
              : h('div', { style: { ...S.dim, color: '#c0392b' } }, '现在一个勾着的房间都没有 —— 概率命中也不会开口。'),
          ),

          会话们.length
            ? h('div', { style: { marginTop: 8 } },
                h('div', { style: S.dim }, '现在开着的会话（点一下 = 勾上/取消，立刻生效）：'),
                h('div', { style: S.清单 }, 会话们.map(会话行)),
                h('div', { style: { ...S.dim, marginTop: 4 } },
                  '已归档的会话不再列出来（它们命中也会被 DSH 拦掉）；' +
                    '只有你已经勾着的归档会话还会显示，带「⚠ 已归档」——看到就取消勾选。' +
                    '没起名字的会话显示「（还没起名）」+ 短 id，照样能勾；' +
                    '普通会话标着「没活着」= 现在没打开，勾上也会跳过；' +
                    'QQ 房间标着「没打开」= 命中后会按需开房，不用先打开。',
                ),
              )
            : h('div', { style: { ...S.dim, marginTop: 8 } }, '现在没有开着的会话（在 DSH 里打开一个再回来点「刷新清单」）。'),

          h('div', { style: { marginTop: 8 } },
            按钮('刷新清单', 拉, false, 忙),
            h('span', { style: S.dim }, '　'),
            按钮('新建一个小屋会话，并自动勾上', 新建小屋, false, 忙),
          ),

          // 次要路径：手填 / 粘贴 id
          h('div', { style: { marginTop: 10, borderTop: '1px solid var(--dsw-alias-border-l2)', paddingTop: 8 } },
            h('div', { style: S.dim }, '也可以直接手填 / 粘贴会话 id（逗号分隔）—— 手填会改成「只在这些房间里主动」（默认全选就关了），必须点保存才生效：'),
            h('div', { style: { marginTop: 4 } },
              h('input', {
                type: 'text',
                style: S.input,
                value: 手填文本,
                placeholder: 'session-xxxxxxxx-…, session-yyyyyyyy-…',
                onChange: (e) => 设手填(e.target.value),
              }),
            ),
            h('div', { style: { marginTop: 6 } }, 按钮('保存手填的 id', 存, true, 忙)),
          ),
        ),

        // —— 文案 ——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '文案'),
          行(
            '触发文案（平时）',
            h('textarea', {
              style: S.ta,
              value: 配置.触发文案 === undefined ? '' : String(配置.触发文案),
              onChange: (e) => 改('触发文案', e.target.value),
            }),
            '平时按概率命中时送出去的动机句子。要用她自己的口吻写（这是她的动机，不是系统提示）。',
          ),
          行(
            '保底文案（到点）',
            h('textarea', {
              style: S.ta,
              value: 保底文案,
              onChange: (e) => 改('保底文案', e.target.value),
            }),
            '到最长间隔、强制发起那一轮用的动机句子；没有鱼脑由头时用它。QQ 群/好友仍用房间提示，这两段都不会原样端给外人。',
          ),
        ),

        // —— 角色（做不到的地方，老实写在这儿）——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '触发消息的角色'),
          行(
            '角色',
            h('select', {
              style: S.input,
              value: 配置.角色,
              onChange: (e) => 改('角色', e.target.value),
            },
              h('option', { style: S.option, value: 'user' }, 'user（当前唯一跑得通的）'),
              h('option', { style: S.option, value: 'developer' }, 'developer（当前 DSH 送不了）'),
            ),
            '选 developer 时本插件会主动拒发并记一条，不会去写坏会话日志。原因与证据见 README「做不到的地方」。',
          ),
        ),

        // —— 动作 ——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '自己的动作'),
          h('div', null,
            按钮('保存设置', 存, true, 忙),
            h('span', { style: S.dim }, '　'),
            按钮('演练一次（绝不真发）', () => 掷('演练'), false, 忙),
            h('span', { style: S.dim }, '　'),
            按钮('真发一次（跳过等待）', () => 掷('真发'), false, 忙),
            h('span', { style: S.dim }, '　'),
            按钮('刷新', 拉, false, 忙),
          ),
          h('div', { style: { marginTop: 6 } },
            h('div', { style: S.dim },
              '「保存设置」要按的场合：改了数字 / 曲线 / 文案 / 开关 / 角色之后（「目标会话」的勾选不用按，一点就生效）。'),
            h('div', { style: S.dim },
              '「演练一次」会完整走一遍选房和文案，但不掷概率、不动保底计时，也绝不真发。' +
                '「真发一次」会当场真的送出一轮，用于验证能不能跑通；她真的说出正文后会重置保底计时。'),
          ),
          说 ? h('div', { style: { ...S.ok, marginTop: 6 } }, 说) : null,
        ),

        // —— 记录 ——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '最近 ' + 日志.length + ' 条记录（新的在最下面）'),
          h('div', { style: S.dim }, '定时器每轮都会留一条：没掷中也留（好确认它到底有没有在跑）；等正文确认的会另行记一条。'),
          h('div', { style: { marginTop: 6, maxHeight: 260, overflowY: 'auto' } },
            日志.length === 0
              ? h('div', { style: S.dim }, '还没有记录。')
              : 日志.map((条, i) => h('div', { key: i, style: S.日志行 }, 条.时间 + '　' + 条.文本)),
          ),
        ),

        h('div', { style: S.dim },
          '⚠ 概率和检查都是纯本地计算，不花模型；只有真的发起一轮（含到点保底）才会走 DSH（会花 token）。' +
            '到点如果没房间能开口/QQ 桥挡住/模型没产出正文，只记账，不直发罐头话。',
        ),

        // —— 悬浮的保存条：**只要有没保存的改动，就贴在底下冒出来** ——
        脏
          ? h('div', { style: S.悬浮保存条 },
              h('span', { style: { fontWeight: 600, color: '#c0392b' } }, '⚠ 有改动还没保存'),
              h('span', { style: S.dim }, '数字 / 曲线 / 文案 / 开关改完，点这里就行'),
              按钮('保存设置', 存, true, 忙),
            )
          : null,
      )
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      if (typeof ctx.inject === 'function') {
        ctx.inject(['settingsSearch'], (child) => {
          child.effect(() => child.settingsSearch.register({
            sectionId: 'outside',
            tabId: 'speak-up',
            label: () => '主动搭话',
            keywords: () => ['主动', '搭话', '没人说话', '概率', '曲线', '安静时段', '房间', '文案'],
            applies: 'live',
          }), 'dsh-speak-up: settings search')
        })
      }
      slots.inject('settings.outside.tab', () =>
        slots.register(
          { name: 'settings.outside.tab', id: 'speak-up', order: 20, label: () => '主动搭话' },
          Section,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
