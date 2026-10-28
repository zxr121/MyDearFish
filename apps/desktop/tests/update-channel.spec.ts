import { expect, it } from 'vitest'
import { desktopUpdateChannel, desktopUpdateDownloadPage, desktopUpdateSources } from '../src/update-channel.ts'

it('reads the installed channel independently from the current version', () => {
  expect(desktopUpdateChannel({ version: '1.0.0', dshDesktopUpdateChannel: 'nightly' })).toBe('nightly')
  expect(desktopUpdateChannel({ version: '1.0.0', dshDesktopUpdateChannel: 'latest' })).toBe('latest')
  expect(desktopUpdateChannel({ version: '1.0.0' })).toBe('nightly')
  expect(() => desktopUpdateChannel({ dshDesktopUpdateChannel: 'beta' })).toThrow(/channel/u)
  expect(() => desktopUpdateChannel(null)).toThrow(/manifest/u)
})

it('reads an optional packaged download page', () => {
  expect(desktopUpdateDownloadPage({ version: '1.0.0' })).toBeUndefined()
  expect(desktopUpdateDownloadPage({ dshDesktopUpdateDownloadPage: 'https://github.com/example/fish/releases/latest' }))
    .toBe('https://github.com/example/fish/releases/latest')
  expect(() => desktopUpdateDownloadPage({ dshDesktopUpdateDownloadPage: 'http://example.com' })).toThrow(/download page/u)
  expect(() => desktopUpdateDownloadPage(null)).toThrow(/manifest/u)
})

it('reads ordered packaged update sources and normalizes directory URLs', () => {
  expect(desktopUpdateSources({ version: '1.0.0' })).toEqual([])
  expect(desktopUpdateSources({
    dshDesktopUpdateSources: ['https://mirror.example.com/fish/win-x64/',
      'https://github.com/example/fish/releases/latest/download'],
  })).toEqual(['https://mirror.example.com/fish/win-x64/',
    'https://github.com/example/fish/releases/latest/download/'])
  expect(desktopUpdateSources({ dshDesktopUpdateSources: ['https://mirror.example.com'] }))
    .toEqual(['https://mirror.example.com/'])
  expect(() => desktopUpdateSources(null)).toThrow(/manifest/u)
  expect(() => desktopUpdateSources({ dshDesktopUpdateSources: [] })).toThrow(/packaged update sources/u)
  expect(() => desktopUpdateSources({ dshDesktopUpdateSources: 'https://mirror.example.com/' }))
    .toThrow(/packaged update sources/u)
  for (const source of [1, 'http://mirror.example.com/', 'https://user:pass@mirror.example.com/',
    'https://mirror.example.com/?token=1', 'https://mirror.example.com/#fragment', 'not a url']) {
    expect(() => desktopUpdateSources({ dshDesktopUpdateSources: [source] })).toThrow(/packaged update source/u)
  }
})
