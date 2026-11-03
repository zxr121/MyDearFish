import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { SettingsSearch } from '../src/client/settings-search.ts'

function bench() {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  return { ctx, search: new SettingsSearch(ctx) }
}

describe('SettingsSearch', () => {
  it('publishes stable snapshots and disposes registrations', () => {
    const { search } = bench()
    expect(search.getSnapshot()).toEqual([])
    const listener = vi.fn()
    const offListen = search.subscribe(listener)
    const off = search.register({
      sectionId: 'fish',
      tabId: 'mood',
      label: () => '心情',
      keywords: () => ['情绪'],
      applies: 'live',
    })
    const first = search.getSnapshot()
    expect(first).toHaveLength(1)
    expect(search.getSnapshot()).toBe(first)
    expect(listener).toHaveBeenCalledTimes(1)
    off()
    expect(search.getSnapshot()).toEqual([])
    expect(listener).toHaveBeenCalledTimes(2)
    off()
    expect(listener).toHaveBeenCalledTimes(2)
    offListen()
  })

  it('rejects an empty section id and a duplicate target', () => {
    const { search } = bench()
    expect(() => search.register({ sectionId: '', label: () => '', keywords: () => [] }))
      .toThrow('sectionId')
    search.register({ sectionId: 'fish', tabId: 'mood', label: () => '心情', keywords: () => [] })
    expect(() => search.register({ sectionId: 'fish', tabId: 'mood', label: () => '另一个', keywords: () => [] }))
      .toThrow('duplicate target')
    expect(() => search.register({ sectionId: 'fish', tabId: 'other', label: () => '另一个', keywords: () => [] }))
      .not.toThrow()
  })

  it('resolves labels and keywords per call so a locale switch needs no re-registration', () => {
    const { search } = bench()
    let language = 'zh'
    search.register({
      sectionId: 'general',
      label: () => (language === 'zh' ? '通用' : 'General'),
      keywords: () => [language === 'zh' ? '外观' : 'appearance'],
    })
    const target = search.getSnapshot()[0]!
    expect(target.label()).toBe('通用')
    expect(target.keywords()).toEqual(['外观'])
    language = 'en'
    expect(target.label()).toBe('General')
    expect(target.keywords()).toEqual(['appearance'])
  })
})
