import { expect, it } from 'vitest'
import { desktopUpdateChannel, desktopUpdateDownloadPage } from '../src/update-channel.ts'

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
