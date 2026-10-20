// 后台：页面端发现「点朗读」→ 用扩展自己的身份去敲本机看门狗 /start。
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'start') {
    fetch('http://127.0.0.1:8765/start', { method: 'POST' }).catch(() => {})
  }
})
