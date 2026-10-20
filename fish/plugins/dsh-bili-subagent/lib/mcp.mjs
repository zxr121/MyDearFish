/**
 * lib/mcp.mjs —— 一个极小的 MCP stdio 客户端（只做我们需要的三件事）
 * ============================================================================
 * 为什么不用 `@deepseek-ai/dsh-mcp-client`：那是个"把 MCP 挂成 dsh 工具"的完整插件，
 * 而我们要的是**插件内部自己起这个 Python MCP**（用户选了 A 方案：装完就能用，
 * Python 路径和登录都在设置页里，不用去改 profile 的 patch）。
 *
 * 协议就三句话：`initialize` → `notifications/initialized` → `tools/call`，
 * stdio 上是**一行一个 JSON-RPC**。
 * ============================================================================
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

// 报给对端的身份：版本号**从 package.json 读**，别手写（手写的那份永远追不上发版）
const PKG = (() => { try { return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) } catch { return {} } })()

export class McpClient {
  constructor({ command, args = [], cwd, env, log = () => {} }) {
    this.cfg = { command, args, cwd, env, log }
    this.proc = null
    this.buf = ''
    this.nextId = 1
    this.pending = new Map()
    this.stderr = ''
    this.starting = null
  }

  get running() { return Boolean(this.proc) }

  async start() {
    if (this.proc) return
    if (this.starting) return this.starting
    this.starting = (async () => {
      const { command, args, cwd, env, log } = this.cfg
      this.proc = spawn(command, args, {
        cwd,
        env: { ...process.env, ...(env || {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
      this.proc.stdout.setEncoding('utf8')
      this.proc.stdout.on('data', (chunk) => this.#onData(chunk))
      this.proc.stderr.setEncoding('utf8')
      this.proc.stderr.on('data', (c) => { this.stderr = (this.stderr + c).slice(-4000) })
      this.proc.on('error', (e) => log(`MCP 子进程启动失败：${e?.message ?? e}`))
      this.proc.on('exit', (code) => {
        log(`MCP 子进程退出（code=${code}）`)
        for (const [, p] of this.pending) p.reject(new Error(`MCP 子进程退出（code=${code}）${this.stderr ? '：' + this.stderr.slice(-300) : ''}`))
        this.pending.clear()
        this.proc = null
      })
      await this.#request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: PKG.name || 'dsh-bili-scroll', version: PKG.version || '0.0.0' },
      })
      this.#notify('notifications/initialized', {})
      log('MCP 已就绪')
    })()
    try { await this.starting } finally { this.starting = null }
  }

  stop() {
    try { this.proc?.kill() } catch { /* 已经没了 */ }
    this.proc = null
  }

  /** 调一个 MCP 工具：能解析成 JSON 就返回对象，否则返回字符串 */
  async call(name, args = {}, { timeoutMs = 180000 } = {}) {
    await this.start()
    const result = await this.#request('tools/call', { name, arguments: args }, timeoutMs)
    const text = (result?.content ?? []).map((c) => c?.text ?? '').join('\n').trim()
    if (result?.isError) throw new Error(text || `MCP 工具 ${name} 报错`)
    try { return text ? JSON.parse(text) : {} } catch { return text }
  }

  #onData(chunk) {
    this.buf += chunk
    let idx
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim()
      this.buf = this.buf.slice(idx + 1)
      if (!line) continue
      let msg
      try { msg = JSON.parse(line) } catch { continue }   // 非 JSON 行（有些库会往 stdout 打日志）忽略
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) p.reject(new Error(msg.error?.message ? String(msg.error.message) : JSON.stringify(msg.error)))
        else p.resolve(msg.result)
      }
    }
  }

  #send(obj) {
    if (!this.proc?.stdin?.writable) throw new Error('MCP 子进程不在运行')
    this.proc.stdin.write(JSON.stringify(obj) + '\n')
  }

  #notify(method, params) { this.#send({ jsonrpc: '2.0', method, params }) }

  #request(method, params, timeoutMs = 60000) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP ${method} 超时（${timeoutMs}ms）${this.stderr ? '：' + this.stderr.slice(-200) : ''}`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      })
      try { this.#send({ jsonrpc: '2.0', id, method, params }) } catch (e) {
        clearTimeout(timer); this.pending.delete(id); reject(e)
      }
    })
  }
}
