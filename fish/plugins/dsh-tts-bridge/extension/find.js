// DSH 朗读桥 · 找窝（固定端口）
//
// 本机同时跑着工作区网页版和安装版桌面版。朗读桥只属于工作区那一套（3080），
// 这里不再扫常见端口、也不再问路，免得点到安装版的窝里、把两边串起来。
;(() => {
  const 路径 = '/dsh-tts-bridge'
  const 固定端口 = 3080

  // 问一下这个端口是不是朗读桥的窝。
  async function 探(端口) {
    const base = 'http://127.0.0.1:' + 端口 + 路径
    const 超时 = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(1200) : null
    try {
      const r = await fetch(base + '/state', 超时 ? { cache: 'no-store', signal: 超时 } : { cache: 'no-store' })
      if (!r.ok) return null
      const j = await r.json()
      if (j && j.ok) return { 端口, base }
    } catch (e) {
      // 没人应 / 不是它 / 超时，都算没有
    }
    return null
  }

  async function 找窝() {
    const w = await 探(固定端口)
    return w ? [w] : []
  }

  self.__ttsFind = { 探, 找窝, 固定端口, 路径 }
})()
