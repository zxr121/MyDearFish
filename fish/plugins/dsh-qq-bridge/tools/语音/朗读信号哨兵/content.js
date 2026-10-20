// 哨兵：读「朗读桥」小面板那行状态字。
//   面板每行文字形如：🔊 点朗读…  /  🔊 出声了  /  🔊 念完了  /  🔊 待命
//   只认「点朗读」= 开录的那一刻；别的（等复述 / 已发出 / 待命 / 念完）都不动。
;(() => {
  let 已报 = false

  // 找到那行带 🔊/🔇 前缀的状态字（朗读桥 paint() 就是这么写的）
  function 找状态() {
    for (const el of document.querySelectorAll('span, div')) {
      const t = (el.textContent || '').trim()
      if (t.startsWith('🔊') || t.startsWith('🔇')) return t
    }
    return ''
  }

  setInterval(() => {
    const 行 = 找状态()
    if (!行) { 已报 = false; return }
    const 态 = 行.replace(/^[🔊🔇]\s*/, '')
    if (态.includes('点朗读')) {
      if (!已报) {
        已报 = true
        try { chrome.runtime.sendMessage({ type: 'start' }) } catch (e) {}
      }
    } else if (态.includes('念完了') || 态.includes('待命') || 态.includes('没念成')) {
      已报 = false
    }
  }, 250)
})()
