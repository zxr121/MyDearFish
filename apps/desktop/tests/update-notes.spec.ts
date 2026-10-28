import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest'
import {
  parseUpdateNotes,
  readUpdateNotes,
  readUpdateNotesState,
  shouldShowUpdateNotes,
  writeUpdateNotesState,
  UPDATE_NOTES_RESOURCE,
  UPDATE_NOTES_STATE_FILE,
} from '../src/update-notes.ts'

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => { vi.restoreAllMocks() })

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-update-notes-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  return root
}

const notes = { version: '0.2.5-test.20261028.1', notes: ['原生回复', '修复更新说明'] }

it('accepts only complete notes documents', () => {
  expect(parseUpdateNotes({ schemaVersion: 1, ...notes })).toEqual(notes)
  for (const value of [null, [], {}, { schemaVersion: 2, ...notes }, { schemaVersion: 1, notes: [] },
    { schemaVersion: 1, version: '', notes: [] }, { schemaVersion: 1, version: notes.version },
    { schemaVersion: 1, version: notes.version, notes: ['ok', 1] },
    { schemaVersion: 1, version: notes.version, notes: ['ok', '  '] },
  ]) expect(parseUpdateNotes(value)).toBeUndefined()
})

it('reads bundled notes but treats a missing or unreadable document as absent', () => {
  const resources = fixture()
  expect(readUpdateNotes(resources)).toBeUndefined()
  expect(console.warn).not.toHaveBeenCalled()

  writeFileSync(join(resources, UPDATE_NOTES_RESOURCE), JSON.stringify({ schemaVersion: 1, ...notes }))
  expect(readUpdateNotes(resources)).toEqual(notes)

  writeFileSync(join(resources, UPDATE_NOTES_RESOURCE), '{')
  expect(readUpdateNotes(resources)).toBeUndefined()
  expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(UPDATE_NOTES_RESOURCE), expect.any(Error))

  vi.mocked(console.warn).mockClear()
  writeFileSync(join(resources, UPDATE_NOTES_RESOURCE), '{"schemaVersion":1,"version":"1.0.0","notes":[42]}')
  expect(readUpdateNotes(resources)).toBeUndefined()
  expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('invalid'))
})

it('records and reads the acknowledged version without creating state for a fresh install', () => {
  const userData = fixture()
  expect(readUpdateNotesState(userData)).toEqual({ disabled: false })
  expect(console.warn).not.toHaveBeenCalled()

  writeUpdateNotesState(userData, { version: notes.version, disabled: true })
  expect(readUpdateNotesState(userData)).toEqual({ version: notes.version, disabled: true })
  expect(JSON.parse(readFileSync(join(userData, 'desktop', UPDATE_NOTES_STATE_FILE), 'utf8')))
    .toEqual({ version: notes.version, disabled: true })

  writeUpdateNotesState(userData, { disabled: false })
  expect(readUpdateNotesState(userData)).toEqual({ disabled: false })
})

it('falls back to unacknowledged state when the record is unreadable', () => {
  const userData = fixture()
  mkdirSync(join(userData, 'desktop'))
  for (const raw of ['{', 'null', '{"disabled":"yes"}', '{"version":""}']) {
    writeFileSync(join(userData, 'desktop', UPDATE_NOTES_STATE_FILE), raw)
    expect(readUpdateNotesState(userData)).toEqual({ disabled: false })
    expect(console.warn).toHaveBeenCalled()
    vi.mocked(console.warn).mockClear()
  }
})

it('shows only a matching, non-empty, not-yet-acknowledged version', () => {
  const installed = notes.version
  expect(shouldShowUpdateNotes(notes, { disabled: false }, installed)).toBe(true)
  expect(shouldShowUpdateNotes(notes, { disabled: true }, installed)).toBe(false)
  expect(shouldShowUpdateNotes({ version: installed, notes: [] }, { disabled: false }, installed)).toBe(false)
  expect(shouldShowUpdateNotes(notes, { disabled: false }, '9.9.9')).toBe(false)
  expect(shouldShowUpdateNotes(notes, { version: installed, disabled: false }, installed)).toBe(false)
  expect(shouldShowUpdateNotes(notes, { version: '0.2.4-test.20261027.1', disabled: false }, installed)).toBe(true)
  expect(shouldShowUpdateNotes(notes, { version: '0.2.5-test.20261028.2', disabled: false }, installed)).toBe(false)
  expect(shouldShowUpdateNotes(notes, { version: '0.2.5', disabled: false }, installed)).toBe(false)
  expect(shouldShowUpdateNotes({ ...notes, version: '0.2.5' }, { version: '0.2.5-test.20261028.1', disabled: false }, '0.2.5')).toBe(true)
  // An unreadable record must not silence a later build.
  expect(shouldShowUpdateNotes(notes, { version: 'nightly', disabled: false }, installed)).toBe(true)
})
