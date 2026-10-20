// DSH「主动搭话」· 网页半边
//
// 只干一件事：在 **DSH 设置** 左侧栏加一项「主动搭话」，
// 把那 7 组设置全摆出来，外加两个安全的试法（演练 / 真发一次）和一份最近掷骰记录。
//
// ⚠ 这里**不碰会话、不发消息**，只是往宿主那几条 /dsh-speak-up/* 路由上读写。
//   真正的掷骰和 followup 都在宿主半边（lib/host.js），这样只有一份逻辑。
//
// ⚠ 槽位名 'settings.section' 跟 dsh-write / dsh-fish-memory 用的是同一个，
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
    const 勾 = (值, onChange) =>
      h('input', { type: 'checkbox', checked: !!值, onChange: (e) => onChange(e.target.checked) })
    const 数 = (值, onChange, 步) =>
      h('input', {
        type: 'number',
        value: 值 === undefined || 值 === null ? '' : 值,
        step: 步 || 1,
        style: S.small,
        onChange: (e) => onChange(e.target.value),
      })
    /** 会话 id 的后 8 位 —— 前面那截（session- 和 uuid 开头）全都一样，只有尾巴分得出谁是谁。 */
    const 短id = (id) => {
      const s = String(id)
      return s.length <= 8 ? s : s.slice(-8)
    }

    /** 标题拿不到就明说「（还没起名）」，**绝不留空白**（空白会让人以为坏了）。 */
    const 题 = (s) => (s && typeof s.标题 === 'string' && s.标题.trim() !== '' ? s.标题 : '（还没起名）')

    /** 逗号/空格/顿号都能当分隔（照抄老版输入框的行为）。 */
    const 拆id = (文) => String(文 || '').split(/[\s,;，、]+/).filter((x) => x !== '')

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

      const 拉 = React.useCallback(
        () => get('/state').then((r) => { if (r && r.ok) 设态(r); else 设说('读不到宿主那边的状态（插件加载了吗？）') }),
        [],
      )

      React.useEffect(() => { 拉() }, [拉])

      if (!态 || !态.配置) {
        return h('div', { style: S.wrap }, h('div', { style: S.h }, '主动搭话'), h('div', { style: S.dim }, '读取中…'))
      }

      const 配置 = 态.配置
      /** 改「要点保存」的字段（数字/文案/开关）→ 置脏。 */
      const 改 = (k, v) => {
        设态((旧) => ({ ...旧, 配置: { ...旧.配置, [k]: v } }))
        设脏(true)
      }

      /** 勾上的会话列表（组件里以本地状态为准，不等刷新，点一下立刻变色）。 */
      const 目标们 = Array.isArray(配置.目标会话) ? 配置.目标会话 : []
      const 已勾 = (id) => 目标们.indexOf(id) >= 0

      /**
       * 勾上/取消 → **立刻自动保存**（她原话：「有打勾不就完了嘛」）。
       * ⚠ 这是踩过坑改的：最早那版是「填进输入框 → 再按下面的『保存设置』」，
       *   结果她填了没按保存（按钮在另一张卡片里、页面上也没有任何"还没保存"的提示），
       *   host 一直报「还没配目标会话」。勾选这类核心设置就该点一下就落盘。
       * ⚠ 自动存只把「目标会话」这一个补丁发上去（host 的 /save 是合并语义），
       *   所以不会覆盖她在别的字段里还没保存的改动。
       */
      const 切换 = (id, 勾上) => {
        const 下一个 = 勾上 ? [...目标们, id] : 目标们.filter((x) => x !== id)
        设态((旧) => ({ ...旧, 配置: { ...旧.配置, 目标会话: 下一个 } }))
        自动存({ 目标会话: 下一个 })
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
          }))
          设同步话('已保存 ✓')
        } else {
          设同步话('保存失败 ✗')
        }
      }

      const 存 = async () => {
        设忙(true)
        // 手填框里还有没提交的草稿 → 存的时候一起带上
        const 要存 = 手填 === null ? 配置 : { ...配置, 目标会话: 拆id(手填) }
        const r = await post('/save', 要存)
        if (r && r.ok) {
          设态(r)
          设手填(null)
          设脏(false)
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
          // 同样只刷服务端那份，别把她在别的字段里还没保存的改动抹掉
          设态((旧) => ({
            ...旧,
            配置: { ...旧.配置, 目标会话: r.配置 ? r.配置.目标会话 : 旧.配置.目标会话 },
            日志: r.日志,
            目标情况: r.目标情况,
            目标活着: r.目标活着,
            活着的会话: r.活着的会话,
          }))
        }
        设说((r && r.说) || '做完了')
        设忙(false)
      }

      const 会话们 = Array.isArray(态.活着的会话) ? 态.活着的会话 : []
      const 日志 = Array.isArray(态.日志) ? 态.日志 : []
      const 目标情况 = Array.isArray(态.目标情况) ? 态.目标情况 : []
      const 目标活着数 = 目标情况.filter((x) => x.活着).length
      const 手填文本 = 手填 === null ? 目标们.join(', ') : 手填

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
              (s.有agent ? '' : '（这个会话现在没有活着的 agent，掷中时会跳过它）') +
              (s.归档 ? '（⚠ 这个会话已经归档了，建议取消勾选）' : ''),
          },
          h('input', {
            type: 'checkbox',
            checked: 已勾(s.id),
            onChange: (e) => 切换(s.id, e.target.checked),
          }),
          h(
            'span',
            { style: { marginLeft: 8, ...(s.有agent ? null : S.dim) } },
            题(s),
          ),
          h('span', { style: { ...S.dim, marginLeft: 8, whiteSpace: 'nowrap' } }, '…' + 短id(s.id) + ' · ' + String(s.状态 || '?')),
        )

      return h(
        'div',
        { style: S.wrap },

        h('div', { style: S.h }, '主动搭话'),
        h(
          'div',
          { style: S.dim },
          '没人在跟她说话的时候，她也有可能先开口：按下面的间隔掷一次骰子（纯本地随机，不花模型），' +
            '掷中了才往「目标会话」里送一句话，让 DSH 自己开一轮（人格、历史、工具、记忆都是她自己的）。' +
            '版本 ' + String(态.版本 || '?') + '｜配置文件：' + String(态.配置文件 || ''),
        ),
        // ⚠ 「填了不按保存等于没填」这件事必须写在脸上（踩过坑：她在输入框里填了 id
        //   却没按保存，host 一直报「还没配目标会话」，而她不知道差在哪一步）
        h('div', { style: 脏 ? S.未保存 : S.已同步 },
          (脏 ? '⚠ 上面有改动还没保存 —— 数字/文案改完要点「保存设置」' : '设置' + (同步话 || '已同步 ✓')) +
            '（勾选会话不用点保存，点一下立刻生效）'),

        // —— 总开关 + 试运行 ——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '开关'),
          行('总开关', 勾(配置.总开关, (v) => 改('总开关', v)), '关掉就完全不动（定时器还在，但什么都不做）。'),
          行(
            '试运行（默认开）',
            勾(配置.试运行, (v) => 改('试运行', v)),
            '开着的时候：掷中了也只写一条记录，不真的发。先看几轮记录，确认时机合适了再关掉它。',
          ),
        ),

        // —— 骰子 ——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '骰子'),
          h('div', { style: S.dim },
            '每轮掷一个 0~100 的数，比命中线小就开口。命中线 =（峰时或谷时的那格命中线）× 时机因子，再加上攒下来的没中加成。'),
          行('掷骰子间隔（分钟）', 数(配置.间隔分钟, (v) => 改('间隔分钟', v)), '默认 30。范围 1~1440；改完保存，下一轮就按新间隔走（不用重启）。'),
          行(
            '搭话冷却（分钟）',
            数(配置.搭话冷却分钟, (v) => 改('搭话冷却分钟', v)),
            '她刚自己开过口之后，这么多分钟内不再开口（默认 20）。0 = 不冷却（刚开口过也照投）。' +
              '手动按钮不受它限制。',
          ),
          行(
            '没中加成（百分点）',
            数(配置.没中加成, (v) => 改('没中加成', v)),
            '每没掷中一次，下一次命中线加这么多（默认 10）。填 0 = 关掉这个功能（一分都不加）。',
          ),
          行(
            '加成上限（百分点）',
            数(配置.加成上限, (v) => 改('加成上限', v)),
            '加成最多加到这么多（默认 40）。',
          ),
          h('div', { style: S.dim },
            '掷中（含试运行掷中）就清零，从头开始；连着没中就一次一次往上加，加到上限为止。',
          ),
          h('div', { style: { ...S.dim, marginTop: 2 } },
            '这两格只影响自动的定时掷骰；手动按钮（演练/真发）不掷骰子，也不动这个计数器。',
          ),
          h('div', { style: { ...S.dim, marginTop: 2 } },
            '⚠ 「连着没中」这个数只记在内存里：DSH 一重启就回到 0。',
          ),
          行(
            '安静时段（起 / 止，小时）',
            h('div', null, 数(配置.安静起, (v) => 改('安静起', v)), h('span', { style: S.dim }, ' 点 ~ '), 数(配置.安静止, (v) => 改('安静止', v)), h('span', { style: S.dim }, ' 点')),
            '默认 1 ~ 8 点不掷（含 1 点、不含 8 点）。跨午夜也行（比如 23 ~ 7）。',
          ),
          // ⚠ 这条她特意提过两次，所以从上面那句里拎出来单独成一行、用红字（不新造颜色，复用 S.未保存）
          h('div', { style: S.未保存 }, '⚠ 两个数字填成一样（比如 8 和 8）= 不启用安静时段：整天都可能掷骰子'),
        ),

        // —— 时机因子 ——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '时机因子（刚聊过就少开口，冷太久了就多开口）'),
          行(
            '近：刚聊过 → 命中线 ×0.15',
            h('div', null, 数(配置.近阈值分钟, (v) => 改('近阈值分钟', v)), h('span', { style: S.dim }, ' 分钟内 → ×'), 数(配置.近因子, (v) => 改('近因子', v), 0.05)),
            '距她上次说话不到这个分钟数 → 命中线乘这个因子（更难开口）。默认 20 分钟 ×0.15。',
          ),
          行(
            '远：冷太久 → 命中线 ×1.5',
            h('div', null, 数(配置.远阈值分钟, (v) => 改('远阈值分钟', v)), h('span', { style: S.dim }, ' 分钟以上 → ×'), 数(配置.远因子, (v) => 改('远因子', v), 0.1)),
            '超过这个分钟数没说话 → 命中线乘这个因子（更容易开口）。默认 360 分钟（6 小时）×1.5。',
          ),
          h('div', { style: S.dim }, '中间那一段：命中线 ×1（既不加也不减）。最后会夹在 0~100。'),
        ),

        // —— 峰谷分时（贵的时候少开口，便宜的时候多开口）——
        // ⚠ 时段是**写死的**（不给格子填），这里只有两个命中线数字 —— 她的要求。
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '峰谷分时（贵的时候少开口，便宜的时候多开口）'),
          h('div', { style: S.dim }, '时段是固定的，不用你填；只有这两个数字要你定：'),
          行(
            '峰时命中线（%）',
            数(配置.峰时命中线, (v) => 改('峰时命中线', v)),
            '每轮掷一个 0~100 的数，掷到命中线以下才开口；掷在上面就不开。' +
              '这是峰时的基础命中线（峰时 = 周一~周五 9:00~12:00、14:00~18:00，贵）。默认 20 —— 贵的时候少开口。',
          ),
          行(
            '谷时命中线（%）',
            数(配置.谷时命中线, (v) => 改('谷时命中线', v)),
            '这是谷时的基础命中线（其余全是谷时：午休 12:00~14:00、18:00 到次日 9:00、周六周日全天，便宜）。默认 60。',
          ),
          h('div', { style: { ...S.dim, marginTop: 4 } },
            '最终命中线 = 这格（看是峰时还是谷时）× 时机因子 + 攒下来的没中加成（最后夹在 0~100）。',
          ),
          h('div', { style: S.未保存 }, '⚠ 两个数字填成一样 = 不分峰谷，全天一个命中线'),
          h('div', { style: S.未保存 },
            '⚠ 注意：安静时段会盖住谷时 —— 你现在安静时段是 ' +
              String(配置.安静起) + '~' + String(配置.安静止) +
              ' 点，那段时间根本不掷，谷时命中线再高也用不上。',
          ),
        ),

        // —— 目标会话（勾选清单；手填只是次要路径）——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '目标会话'),
          h('div', { style: S.dim }, '勾了谁，她就会在谁的会话里自己开口。勾几个都行；一次掷中只在其中一个里开口（随机挑一个活着、又不忙的）。'),
          h('div', { style: { ...S.dim, marginTop: 2, fontWeight: 600 } }, '✓ 勾选/取消一点就生效（自动保存，不用再按保存）'),
          h('div', { style: { marginTop: 4 } },
            目标们.length
              ? h('div', { style: S.已勾 },
                  '已勾 ' + 目标们.length + ' 个' +
                    (目标情况.length
                      ? '：' + 目标情况.map((x) => (x.标题 ? x.标题 : '…' + 短id(x.id)) + (x.活着 ? '' : '（现在没活着）')).join('、')
                      : '') +
                    (目标情况.length ? '。其中 ' + 目标活着数 + ' 个现在活着' + (目标活着数 === 0 ? ' —— 掷中也会跳过，先把它打开' : '') : ''),
                )
              : h('div', { style: { ...S.dim, color: '#c0392b' } }, '现在一个都没勾 —— 掷中了也不会开口。'),
          ),

          会话们.length
            ? h('div', { style: { marginTop: 8 } },
                h('div', { style: S.dim }, '现在开着的会话（点一下 = 勾上/取消，立刻生效）：'),
                h('div', { style: S.清单 }, 会话们.map(会话行)),
                h('div', { style: { ...S.dim, marginTop: 4 } },
                  '已归档的会话不再列出来（它们掷中也会被 DSH 拦掉）；' +
                    '只有你已经勾着的归档会话还会显示，带「⚠ 已归档」——看到就取消勾选。' +
                    '没起名字的会话显示「（还没起名）」+ 短 id，照样能勾；' +
                    '标着「没活着」的是现在没打开的会话，勾上也没用（掷中会跳过它）。',
                ),
              )
            : h('div', { style: { ...S.dim, marginTop: 8 } }, '现在没有开着的会话（在 DSH 里打开一个再回来点「刷新清单」）。'),

          h('div', { style: { marginTop: 8 } },
            按钮('刷新清单', 拉, false, 忙),
            h('span', { style: S.dim }, '　'),
            按钮('新建一个小屋会话，并自动勾上', 新建小屋, false, 忙),
          ),

          // 次要路径：手填 / 粘贴 id（她要求「不再是主路径」，但留着）
          h('div', { style: { marginTop: 10, borderTop: '1px solid var(--dsw-alias-border-l2)', paddingTop: 8 } },
            h('div', { style: S.dim }, '也可以直接手填 / 粘贴会话 id（逗号分隔）—— 手填的必须点保存才生效：'),
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
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '触发文案'),
          行(
            '掷中之后送出去的那句话',
            h('textarea', {
              style: S.ta,
              value: 配置.触发文案 === undefined ? '' : String(配置.触发文案),
              onChange: (e) => 改('触发文案', e.target.value),
            }),
            '要用她自己的口吻写（这是她的动机，不是系统提示）。',
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
              h('option', { value: 'user' }, 'user（当前唯一跑得通的）'),
              h('option', { value: 'developer' }, 'developer（当前 DSH 送不了）'),
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
              '「保存设置」要按的场合：改了数字 / 触发文案 / 开关 / 角色之后（「目标会话」的勾选不用按，一点就生效）。'),
            h('div', { style: S.dim },
              '「演练一次」会完整走一遍判断（安静时段、概率、因子都跳过，一定走到最后一步），但绝不真发，' +
                '只告诉你「本来要发什么」。「真发一次」会当场真的送出去一轮，用于验证能不能跑通。'),
          ),
          说 ? h('div', { style: { ...S.ok, marginTop: 6 } }, 说) : null,
        ),

        // —— 记录 ——
        h('div', { style: S.card },
          h('div', { style: { ...S.h, margin: '0 0 8px' } }, '最近 ' + 日志.length + ' 条记录（新的在最下面）'),
          h('div', { style: S.dim }, '定时器每轮都会留一条：没掷中也留（好确认它到底有没有在跑）。'),
          h('div', { style: { marginTop: 6, maxHeight: 260, overflowY: 'auto' } },
            日志.length === 0
              ? h('div', { style: S.dim }, '还没有记录。')
              : 日志.map((条, i) => h('div', { key: i, style: S.日志行 }, 条.时间 + '　' + 条.文本)),
          ),
        ),

        h('div', { style: S.dim },
          '⚠ 掷骰子是纯本地随机，不花模型；只有「掷中之后真发」才会走 DSH 的一轮（会花 token）。',
        ),

        // —— 悬浮的保存条：**只要有没保存的改动，就贴在底下冒出来** ——
        // 她原话：「只要上面有改动，那个按钮就会在下面弹出来，就不用每次往下面翻了」。
        // ⚠ 用 position: sticky + bottom: 0（不是 fixed）：它只在这张设置页里浮着，
        //   不会跑到别的设置页上去。没改动（脏=false）就完全不渲染 —— 不挡视线。
        脏
          ? h('div', { style: S.悬浮保存条 },
              h('span', { style: { fontWeight: 600, color: '#c0392b' } }, '⚠ 有改动还没保存'),
              h('span', { style: S.dim }, '数字 / 文案 / 开关改完，点这里就行'),
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
          { name: 'settings.section', id: 'speak-up', order: 53, label: () => '主动搭话' },
          Section,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
