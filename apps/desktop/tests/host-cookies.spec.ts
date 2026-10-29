/** Startup cookie cleanup removes loopback Host cookies left by earlier random ports. */
import type { Cookie } from 'electron'
import { expect, it, vi } from 'vitest'
import { clearStaleHostCookies } from '../src/host-cookies.ts'

vi.mock('electron', () => ({ session: { defaultSession: { cookies: {} } } }))

interface CookiePatch {
  name: string
  domain?: string
  path?: string
  secure?: true
}

const cookie = ({ name, domain = '127.0.0.1', path = '/', secure }: CookiePatch): Cookie => ({
  name, value: 'v1.test', domain, path, sameSite: 'strict', ...(secure === undefined ? {} : { secure }),
})

function jar(cookies: Cookie[], failingName?: string) {
  const get = vi.fn(async () => cookies)
  const remove = vi.fn(async (_url: string, name: string) => {
    if (name === failingName) throw new Error('cookie store locked')
  })
  return { get, remove, target: { cookies: { get, remove } } }
}

it('removes only loopback Host bootstrap cookies and keeps everything else', async () => {
  const j = jar([
    cookie({ name: 'dsh-auth-a', domain: '127.0.0.1' }),
    cookie({ name: 'dsh-auth-b', domain: 'localhost' }),
    cookie({ name: 'dsh-auth-c', domain: '::1' }),
    cookie({ name: 'dsh-auth-d', domain: '.localhost' }),
    cookie({ name: 'dsh-auth-remote', domain: 'app.example.com' }),
    cookie({ name: 'dsh-session', domain: '127.0.0.1' }),
  ])
  await clearStaleHostCookies(j.target)
  expect(j.remove.mock.calls).toEqual([
    ['http://127.0.0.1/', 'dsh-auth-a'],
    ['http://localhost/', 'dsh-auth-b'],
    ['http://[::1]/', 'dsh-auth-c'],
    ['http://localhost/', 'dsh-auth-d'],
  ])
})

it('addresses secure cookies over https and tolerates individual removal failures', async () => {
  const j = jar([
    cookie({ name: 'dsh-auth-secure', secure: true, path: '/ui' }),
    cookie({ name: 'dsh-auth-locked' }),
  ], 'dsh-auth-locked')
  await expect(clearStaleHostCookies(j.target)).resolves.toBeUndefined()
  expect(j.remove.mock.calls).toEqual([
    ['https://127.0.0.1/ui', 'dsh-auth-secure'],
    ['http://127.0.0.1/', 'dsh-auth-locked'],
  ])
})
