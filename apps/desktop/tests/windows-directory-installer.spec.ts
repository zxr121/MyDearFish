/** The pinned builder template keeps its registration flow around staged directory replacement. */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { expect, it } from 'vitest'
import { directoryInstallerExits, directoryInstallSection, directoryUninstaller } from '../scripts/windows-directory-installer.mjs'

const require = createRequire(import.meta.url)
const section = readFileSync(join(dirname(require.resolve('app-builder-lib/package.json')),
  'templates/nsis/installSection.nsh'), 'utf8')

it('removes application files through the native helper and asks before deleting the packaged Harness home', () => {
  const source = readFileSync(join(dirname(require.resolve('app-builder-lib/package.json')), 'templates/nsis/uninstaller.nsh'), 'utf8')
  const adapted = directoryUninstaller(source)
  expect(adapted).not.toContain('--delete-app-data')
  expect(adapted).not.toContain('RMDir /r "$APPDATA')
  expect(adapted).toContain('!insertmacro customUnInstall')
  expect(adapted).toContain('DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}"')
  expect(adapted).toContain('DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}"')
  expect(directoryUninstaller(source.replaceAll('\n', '\r\n'))).toBe(adapted)
  const removal = adapted.indexOf('UninstallRemoveInstallation')
  expect(removal).toBeGreaterThan(-1)
  expect(adapted.indexOf('Call un.AskRemoveHome')).toBeGreaterThan(removal)
  expect(adapted.indexOf('RMDir "$INSTDIR"')).toBeGreaterThan(removal)
  expect(adapted).not.toContain('RMDir /r $INSTDIR')
  expect(adapted).not.toContain('RMDir /r "\\\\?\\$INSTDIR"')
  expect(adapted).not.toContain('UNINSTALLER_DATA_KEPT')
  expect(() => directoryUninstaller(source.replace('  Var /GLOBAL isDeleteAppData\n', ''))).toThrow('template changed')
  expect(() => directoryUninstaller(source.replace('  DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}"', ''))).toThrow('template changed')
  expect(() => directoryUninstaller(source.replace('    RMDir /r $INSTDIR', '    RMDir /r $INSTDIR\n    RMDir /r $INSTDIR'))).toThrow('template changed')
})

it('asks before the packaged Harness home leaves and keeps it on silent or linked data entries', () => {
  const prompt = readFileSync(join(import.meta.dirname, '..', 'installer', 'uninstall.nsh'), 'utf8')
  const only = prompt.slice(prompt.indexOf('Function un.AskRemoveHome'), prompt.indexOf('FunctionEnd', prompt.indexOf('Function un.AskRemoveHome')))
  expect(only).toContain('${If} ${Silent}')
  expect(only).toContain('$INSTDIR\\data')
  expect(only).toContain('0x400')
  expect(only).toContain('MessageBox MB_YESNO|MB_ICONQUESTION')
  expect(only).toContain('/SD IDNO IDYES dshDeleteHome')
  expect(only).toContain('Goto dshKeepHome')
  expect(only).toContain('UninstallRemoveHome(w "$INSTDIR", w "$UnHome")')
  expect(only).toContain('UNINSTALLER_DATA_DELETE_FAILED')
})

it.each(['allowOnlyOneInstallerInstance.nsh', 'installUtil.nsh'])('cleans staged files before %s exits', (helper) => {
  const source = readFileSync(join(dirname(require.resolve('app-builder-lib/package.json')), 'templates/nsis/include', helper), 'utf8')
  const exits = source.match(/^\s*Quit\s*$/gm) ?? []
  expect(exits.length).toBeGreaterThan(0)
  const adapted = directoryInstallerExits(source)
  expect(adapted.match(/Call dshCleanupDirectories/g)).toHaveLength(exits.length)
  expect(adapted).toContain('!ifndef BUILD_UNINSTALLER')
})

it('stages before stopping the application and promotes before registering the installation', () => {
  const result = directoryInstallSection(section)
  expect(result.indexOf('!insertmacro dshStageApplication')).toBeLessThan(result.indexOf('!insertmacro CHECK_APP_RUNNING'))
  expect(result.indexOf('Call dshPromoteDirectories')).toBeLessThan(result.indexOf('!insertmacro registryAddInstallInfo'))
  expect(result).toContain('!insertmacro addStartMenuLink $keepShortcuts')
  expect(result).toContain('!insertmacro addDesktopLink $keepShortcuts')
  expect(result).toContain('!insertmacro handleUninstallResult HKEY_CURRENT_USER')
  expect(result).not.toContain('!insertmacro installApplicationFiles')
  expect(result).not.toContain('File /oname=uninstallerIcon.ico')
})

it.each(['!include installer.nsh', '!insertmacro setLinkVars', '!insertmacro installApplicationFiles'])(
  'rejects a missing or duplicate upstream insertion point: %s', (point) => {
    expect(() => directoryInstallSection(section.replace(point, ''))).toThrow('Desktop NSIS template changed')
    expect(() => directoryInstallSection(`${section}\n${point}`)).toThrow('Desktop NSIS template changed')
  },
)
