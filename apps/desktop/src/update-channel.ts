/** Resolve the update channel sealed into the installed application manifest. */

/** Installer-owned channel, independent of release version and upload environment. */
export type DesktopUpdateChannel = 'nightly' | 'latest'

/**
 * Read the packaged channel; older manifests retain their existing nightly behavior.
 * @param manifest Parsed application manifest.
 * @returns Validated channel. Invalid explicit values reject instead of changing feeds.
 */
export function desktopUpdateChannel(manifest: unknown): DesktopUpdateChannel {
  if (typeof manifest !== 'object' || manifest === null) throw new Error('desktop update: invalid application manifest')
  if (!('dshDesktopUpdateChannel' in manifest)) return 'nightly'
  const channel = manifest.dshDesktopUpdateChannel
  if (channel !== 'nightly' && channel !== 'latest') throw new Error('desktop update: invalid packaged channel')
  return channel
}

/**
 * Read the packaged fallback download page offered when an update check fails.
 * @param manifest Parsed application manifest.
 * @returns HTTPS download page, or undefined when the build carries none.
 */
export function desktopUpdateDownloadPage(manifest: unknown): string | undefined {
  if (typeof manifest !== 'object' || manifest === null) throw new Error('desktop update: invalid application manifest')
  if (!('dshDesktopUpdateDownloadPage' in manifest)) return undefined
  const page = manifest.dshDesktopUpdateDownloadPage
  if (typeof page !== 'string' || !page.startsWith('https://')) throw new Error('desktop update: invalid packaged download page')
  return page
}
