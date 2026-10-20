// 大肥鱼心情 · 右下角挂饰（浏览器端，纯 DOM）
// 挂饰 = 整张形象图直接当按钮，可拖动（拖不出屏幕）；面板会按屏幕边自动适配
;(function () {
  'use strict'
  if (window.__feiyuMoodInited) return
  window.__feiyuMoodInited = true

  var B = '/dsh-feiyu-mood'
  var dimColor = {
    happy: '#5ddc8a', calm: '#7aaadc', sweet: '#e28fc0',
    heartache: '#e0b070', worry: '#e8a25b', sad: '#7a96c8', jealous: '#c88fdc'
  }
  var DIM_LABELS = { happy: '开心', calm: '踏实', sweet: '甜蜜', heartache: '心疼', worry: '担心', sad: '难过', jealous: '吃醋' }
  var DIM_KEYS = ['happy', 'calm', 'sweet', 'heartache', 'worry', 'sad', 'jealous']

  function face(v) {
    if (v >= 80) return { img: B + '/face-great.png', label: '欢喜' }
    if (v >= 62) return { img: B + '/face-good.png', label: '开心' }
    if (v >= 42) return { img: B + '/face-ok.png', label: '一般' }
    if (v >= 25) return { img: B + '/face-worry.png', label: '心疼' }
    return { img: B + '/face-sad.png', label: '难过' }
  }

  var css = [
    '.fm-widget{position:fixed;right:18px;bottom:18px;z-index:99990;width:180px;height:180px;',
    'cursor:grab;user-select:none;background:transparent;border:0;padding:0;-webkit-user-drag:none;',
    'transition:filter .15s}',
    '.fm-widget:hover{filter:brightness(1.04)}',
    '.fm-widget:active{cursor:grabbing}',
    '.fm-widget>img{width:100%;height:100%;object-fit:contain;display:block;pointer-events:none}',
    // 面板：基础定位（JS positionPanel 会按屏幕边适配再调）
    '.fm-panel{position:absolute;left:0;bottom:calc(100% + 10px);width:300px;max-height:62vh;',
    'overflow:auto;background:#1b1c1f;color:#e8e8ea;border:1px solid rgba(128,128,128,.28);',
    'border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.5);padding:14px;display:none;',
    'font-size:13px;line-height:1.6;cursor:auto;',
    'font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}',
    '.fm-panel img{pointer-events:none;-webkit-user-drag:none}',
    '.fm-head{display:flex;align-items:center;gap:12px;margin-bottom:4px}',
    '.fm-face{width:64px;height:64px;object-fit:contain;flex:none}',
    '.fm-big{font-size:22px;font-weight:700;line-height:1.15}',
    '.fm-reason{color:#9aa0a6;margin:6px 0 10px;overflow-wrap:anywhere}',
    '.fm-dim{display:flex;align-items:center;gap:8px;margin:4px 0}',
    '.fm-dimlabel{width:34px;flex:none;color:#9aa0a6}',
    '.fm-bar{flex:1;height:7px;border-radius:4px;background:rgba(128,128,128,.2);overflow:hidden}',
    '.fm-bar i{display:block;height:100%}',
    '.fm-val{width:28px;text-align:right;color:#9aa0a6;flex:none}',
    '.fm-btn{margin-top:12px;display:block;width:100%;padding:7px 0;border:1px solid rgba(128,128,128,.35);',
    'border-radius:8px;background:transparent;color:inherit;cursor:pointer;font-size:13px;text-align:center;font-family:inherit}',
    '.fm-btn:hover{background:rgba(128,128,128,.12)}',
    '.fm-h{font-weight:600;margin:10px 0 6px;color:#c9cdd3}',
    '.fm-back{color:#8fa8c8;cursor:pointer;font-size:13px;margin-bottom:6px;display:inline-block}',
    '.fm-back:hover{text-decoration:underline}',
    '.fm-tlrow{display:flex;gap:6px;padding:3px 0;border-bottom:1px solid rgba(128,128,128,.1);align-items:baseline}',
    '.fm-tltime{flex:none;width:50px;color:#7a8088}',
    '.fm-tlmood{flex:none;width:32px;font-weight:600}',
    '.fm-tldelta{flex:none;width:44px;text-align:left;font-size:12px}',
    '.fm-tlreason{flex:1;overflow-wrap:anywhere;word-break:break-word}',
    '.fm-tldims{color:#8a93a0;font-size:11px;padding:1px 0 5px 62px}'
  ].join('')

  var style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }
  function elImg(src, cls, alt) {
    var n = document.createElement('img')
    n.src = src
    n.className = cls
    n.alt = alt || ''
    n.draggable = false
    return n
  }

  var widget = el('div', 'fm-widget')
  var bodyImg = elImg(B + '/feiyu.png', '', '形象')
  widget.appendChild(bodyImg)
  widget.title = '心情（点开看，按住拖动换位置）'

  var panel = el('div', 'fm-panel')
  widget.appendChild(panel)

  var page = 'main'
  var open = false
  var data = null

  function fmt(t) {
    if (!t) return ''
    var d = new Date(t)
    var p = function (n) { return String(n).padStart(2, '0') }
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
  }
  function fdate(t) {
    if (!t) return ''
    var d = new Date(t)
    var p = function (n) { return String(n).padStart(2, '0') }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
  }
  function deltaText(dt) {
    var n = Number(dt) || 0
    if (n > 0) return '▲+' + n
    if (n < 0) return '▼' + n
    return '·'
  }

  // 按屏幕边适配面板：挂饰在中间就居中，贴边就往里挤、放不下就往另一侧弹
  function positionPanel() {
    var rect = widget.getBoundingClientRect()
    var pw = panel.offsetWidth || 300
    var ph = panel.offsetHeight || 340
    var winW = window.innerWidth
    var winH = window.innerHeight
    var m = 8
    // 横向：默认居中于挂饰，夹紧到屏幕左右
    var left = (rect.width - pw) / 2
    var screenLeft = rect.left + left
    if (screenLeft < m) left += (m - screenLeft)
    var screenRight = rect.left + left + pw
    if (screenRight > winW - m) left -= (screenRight - (winW - m))
    panel.style.left = left + 'px'
    panel.style.right = 'auto'
    // 纵向：上方放得下就放上面，否则放下面
    if (rect.top >= ph + 20) {
      panel.style.top = 'auto'
      panel.style.bottom = (rect.height + 10) + 'px'
    } else {
      panel.style.bottom = 'auto'
      panel.style.top = (rect.height + 10) + 'px'
    }
  }

  function renderMain(d) {
    var f = face(d.mood)
    panel.innerHTML = ''
    var head = el('div', 'fm-head')
    head.appendChild(elImg(f.img, 'fm-face', f.label))
    var htxt = el('div')
    htxt.appendChild(el('div', 'fm-big', (d.mood || '--') + '  ' + f.label))
    htxt.appendChild(el('div', 'fm-reason', d.lastReason || '这会儿平静地待着，等你来。'))
    head.appendChild(htxt)
    panel.appendChild(head)

    ;(d.dims || []).forEach(function (x) {
      var row = el('div', 'fm-dim')
      row.appendChild(el('span', 'fm-dimlabel', x.label))
      var bar = el('div', 'fm-bar')
      var fill = el('i')
      fill.style.width = (x.value || 0) + '%'
      fill.style.background = dimColor[x.key] || '#8a8a8a'
      bar.appendChild(fill)
      row.appendChild(bar)
      row.appendChild(el('span', 'fm-val', String(x.value || 0)))
      panel.appendChild(row)
    })

    var btn = el('button', 'fm-btn', '看完整记录 ▸')
    btn.addEventListener('click', function (e) { e.stopPropagation(); page = 'log'; renderLog(d) })
    panel.appendChild(btn)
    positionPanel()
  }

  function renderLog(d) {
    panel.innerHTML = ''
    var back = el('span', 'fm-back', '‹ 返回当前心情')
    back.addEventListener('click', function (e) { e.stopPropagation(); page = 'main'; renderMain(d) })
    panel.appendChild(back)
    panel.appendChild(el('div', 'fm-h', '心情完整记录'))

    var tl = (d.timeline || []).slice().reverse()
    if (!tl.length) {
      panel.appendChild(el('div', 'fm-tlreason', '还没有记录 —— 聊起来就有了。'))
      positionPanel()
      return
    }
    var lastDate = ''
    for (var i = 0; i < tl.length; i++) {
      var t = tl[i]
      var day = fdate(t.at)
      if (day !== lastDate) {
        lastDate = day
        var cnt = 0
        for (var j = 0; j < tl.length; j++) if (fdate(tl[j].at) === day) cnt++
        panel.appendChild(el('div', 'fm-h', day + '　' + cnt + ' 条'))
      }
      var row = el('div', 'fm-tlrow')
      row.appendChild(el('span', 'fm-tltime', fmt(t.at).slice(6)))
      row.appendChild(el('span', 'fm-tlmood', String(t.mood)))
      row.appendChild(el('span', 'fm-tldelta', deltaText(t.delta)))
      row.appendChild(el('span', 'fm-tlreason', t.reason || '—'))
      panel.appendChild(row)
      // 七根各加了多少
      var dd = t.dimsDelta
      if (dd) {
        var parts = []
        for (var k = 0; k < DIM_KEYS.length; k++) {
          var key = DIM_KEYS[k]
          var v = Number(dd[key]) || 0
          if (v !== 0) parts.push(DIM_LABELS[key] + (v > 0 ? '+' : '') + v)
        }
        if (parts.length) panel.appendChild(el('div', 'fm-tldims', parts.join('　')))
      }
    }
    positionPanel()
  }

  function renderAll(d) {
    if (page === 'log') renderLog(d)
    else renderMain(d)
  }

  function load() {
    try {
      fetch(B + '/state', { cache: 'no-store' })
        .then(function (r) { return r.json() })
        .then(function (d) { if (d && d.ok) { data = d; renderAll(d) } })
        .catch(function () {})
    } catch (e) {}
  }

  function toggle() {
    open = !open
    panel.style.display = open ? 'block' : 'none'
    page = 'main'
    if (open) { load(); positionPanel() }
  }

  // ---- 拖动（动了算拖，没动算点）----
  var sx = 0, sy = 0, ox = 0, oy = 0, moved = false, dragged = false
  widget.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return
    if (e.target !== bodyImg && e.target !== widget) return
    sx = e.clientX; sy = e.clientY
    var rect = widget.getBoundingClientRect()
    ox = rect.left; oy = rect.top
    moved = false
    function onMove(ev) {
      var dx = ev.clientX - sx, dy = ev.clientY - sy
      if (!moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) moved = true
      if (moved) {
        dragged = true
        var maxX = window.innerWidth - widget.offsetWidth
        var maxY = window.innerHeight - widget.offsetHeight
        widget.style.left = Math.min(maxX, Math.max(0, ox + dx)) + 'px'
        widget.style.top = Math.min(maxY, Math.max(0, oy + dy)) + 'px'
        widget.style.right = 'auto'
        widget.style.bottom = 'auto'
      }
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      if (!moved) toggle()
      else if (open) positionPanel()
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    e.preventDefault()
  })
  widget.addEventListener('contextmenu', function (e) {
    if (e.target !== bodyImg && e.target !== widget) return
    e.preventDefault(); e.stopPropagation(); toggle()
  })

  document.body.appendChild(widget)
  load()

  // 窗口缩放时，把挂饰拉回屏幕内（拖过才管；没拖的 right/bottom 定位会自然跟随）
  window.addEventListener('resize', function () {
    if (!dragged) return
    var rect = widget.getBoundingClientRect()
    var maxX = window.innerWidth - widget.offsetWidth
    var maxY = window.innerHeight - widget.offsetHeight
    var x = Math.min(maxX < 0 ? 0 : maxX, Math.max(0, rect.left))
    var y = Math.min(maxY < 0 ? 0 : maxY, Math.max(0, rect.top))
    widget.style.left = x + 'px'
    widget.style.top = y + 'px'
    widget.style.right = 'auto'
    widget.style.bottom = 'auto'
    if (open) positionPanel()
  })
})()