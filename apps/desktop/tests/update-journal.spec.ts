import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { readdirSync, utimesSync } from 'node:fs'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  DesktopUpdateJournal, desktopUpdateJournalState, pruneDesktopUpdateJournals, readDesktopUpdateJournals,
} from '../src/update-journal.ts'

describe('desktop qualification update journal', () => {
  it('keeps both versions in separate files in the shared evidence directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-update-journal-'))
    try {
      const old = new DesktopUpdateJournal(directory, '1.0.0-nightly.1')
      old.action('download-requested')
      old.state({ phase: 'downloading', version: '1.0.0-nightly.2', percent: 42.1 })
      old.state({ phase: 'downloading', version: '1.0.0-nightly.2', percent: 42.9 })
      old.state({ phase: 'error', version: '1.0.0-nightly.2', failedOperation: 'download', message: 'ETIMEDOUT private-data' })
      old.action('download-requested')
      old.state({ phase: 'ready', version: '1.0.0-nightly.2' })
      old.action('install-confirmed')
      old.action('quit-requested')
      const next = new DesktopUpdateJournal(directory, '1.0.0-nightly.2')
      next.action('workspace-ready')
      const first = (await readFile(old.path, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
      const second = (await readFile(next.path, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
      expect(first.map(row => row.sequence)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
      expect(first[3]).toMatchObject({ failedOperation: 'download', errorCode: 'ETIMEDOUT' })
      expect(second).toMatchObject([{ event: 'started', version: '1.0.0-nightly.2' }, { event: 'workspace-ready' }])
      expect(JSON.stringify(first)).not.toContain('private-data')
      expect(next.path).not.toBe(old.path)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('drops detailed errors and unexpected fields instead of trying to redact arbitrary text', () => {
    const state = { phase: 'error' as const, failedOperation: 'download' as const, version: '1.2.3',
      message: 'https://user:password@example.test/file?token=secret', technicalDetails: 'password', extra: 'secret' }
    expect(desktopUpdateJournalState(state)).toEqual({ phase: 'error', targetVersion: '1.2.3',
      failedOperation: 'download', errorCode: 'UNCLASSIFIED' })
    expect(desktopUpdateJournalState({ phase: 'idle' })).toEqual({ phase: 'idle' })
    expect(desktopUpdateJournalState({ phase: 'downloading' })).toEqual({ phase: 'downloading' })
    expect(desktopUpdateJournalState({ phase: 'error' })).toEqual({ phase: 'error', errorCode: 'UNCLASSIFIED' })
    expect(desktopUpdateJournalState({ phase: 'verifying', version: '1.2.3', percent: 100 })).toEqual({ phase: 'verifying', targetVersion: '1.2.3' })
  })

  it('classifies feed and transport failures without retaining their text', () => {
    const classify = (message: string) => desktopUpdateJournalState({ phase: 'error', failedOperation: 'download', message })
    expect(classify('HttpError: 404 response body')).toMatchObject({ errorCode: 'HTTP_404' })
    expect(classify('Error: ERR_UPDATER_CHANNEL_FILE_NOT_FOUND at redacted')).toMatchObject({ errorCode: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' })
    expect(classify('net::ERR_CONNECTION_ABORTED')).toMatchObject({ errorCode: 'ERR_CONNECTION_ABORTED' })
    expect(classify('unexpected updater failure')).toMatchObject({ errorCode: 'UNCLASSIFIED' })
  })

  it('keeps the newest journals and reads them for a diagnostic copy', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-update-journal-prune-'))
    try {
      const oldest = new DesktopUpdateJournal(directory, '1.0.0')
      const middle = new DesktopUpdateJournal(directory, '1.0.1')
      const newest = new DesktopUpdateJournal(directory, '1.0.2')
      utimesSync(oldest.path, new Date(1_000), new Date(1_000))
      utimesSync(middle.path, new Date(2_000), new Date(2_000))
      pruneDesktopUpdateJournals(directory, 2)
      expect(readdirSync(directory).sort()).toEqual([basename(middle.path), basename(newest.path)].sort())
      const { files, text } = readDesktopUpdateJournals(directory, 1)
      expect(files).toBe(1)
      expect(text).toContain('"version":"1.0.2"')
      expect(text).not.toContain('"version":"1.0.1"')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('refuses relative evidence paths and reports storage failure', async () => {
    expect(() => new DesktopUpdateJournal('relative-logs', '1.0.0')).toThrow('must be absolute')
    const directory = await mkdtemp(join(tmpdir(), 'dsh-update-journal-failure-'))
    try {
      const journal = new DesktopUpdateJournal(directory, '1.0.0')
      await rm(journal.path)
      await rm(directory, { recursive: true, force: true })
      expect(() => { journal.action('download-requested') }).toThrow()
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
