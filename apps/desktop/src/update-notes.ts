/** Per-build "what changed" notes bundled with the application, and the shell's acknowledgement record. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gt, valid } from 'semver'

/** Resource name electron-builder copies next to the packaged application. */
export const UPDATE_NOTES_RESOURCE = 'update-notes.json'

/** Acknowledgement record kept beside the shell's settings. */
export const UPDATE_NOTES_STATE_FILE = 'update-notes-state.json'

/** Notes baked into one build. */
export interface DesktopUpdateNotes {
  readonly version: string
  readonly notes: readonly string[]
}

/** What the user already dismissed on this installation. */
export interface DesktopUpdateNotesState {
  /** Last version whose notes were acknowledged. */
  readonly version?: string
  /** The user asked to stop seeing update notes. */
  readonly disabled: boolean
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validate a bundled notes document.
 * @param value - Parsed JSON.
 * @returns The notes, or undefined when the document cannot be trusted.
 */
export function parseUpdateNotes(value: unknown): DesktopUpdateNotes | undefined {
  if (!record(value) || value.schemaVersion !== 1) return undefined
  if (typeof value.version !== 'string' || value.version === '') return undefined
  if (!Array.isArray(value.notes)) return undefined
  const notes: string[] = []
  for (const note of value.notes) {
    if (typeof note !== 'string' || note.trim() === '') return undefined
    notes.push(note)
  }
  return { version: value.version, notes }
}

/**
 * Read the notes this build carries.
 * @param resources - Electron's resources directory.
 * @returns Notes for this build, or undefined in development and for builds that shipped none.
 */
export function readUpdateNotes(resources: string): DesktopUpdateNotes | undefined {
  const path = join(resources, UPDATE_NOTES_RESOURCE)
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    // Development launches and packaged builds without notes legitimately have no file.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`desktop update notes: ${path}: ignored because the bundled notes could not be read`, error)
    }
    return undefined
  }
  let parsed: DesktopUpdateNotes | undefined
  try {
    parsed = parseUpdateNotes(JSON.parse(raw))
  } catch (error) {
    console.warn(`desktop update notes: ${path}: ignored because the bundled notes are not JSON`, error)
    return undefined
  }
  if (parsed === undefined) console.warn(`desktop update notes: ${path}: ignored because the bundled notes are invalid`)
  return parsed
}

/**
 * Read the acknowledgement record.
 * @param userData - Electron's userData directory.
 * @returns The recorded state, or an all-unset state when absent or unreadable.
 */
export function readUpdateNotesState(userData: string): DesktopUpdateNotesState {
  const path = join(userData, 'desktop', UPDATE_NOTES_STATE_FILE)
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!record(value)) throw new Error('expected a JSON object')
    if (value.disabled !== undefined && typeof value.disabled !== 'boolean') throw new Error('disabled must be true or false')
    if (value.version !== undefined && (typeof value.version !== 'string' || value.version === '')) {
      throw new Error('version must be a non-empty string')
    }
    return {
      ...(typeof value.version === 'string' ? { version: value.version } : {}),
      disabled: value.disabled === true,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`desktop update notes: ${path}: using no recorded state because it could not be loaded`, error)
    }
    return { disabled: false }
  }
}

/**
 * Record that one version's notes no longer need to be offered.
 * @param userData - Electron's userData directory.
 * @param state - Version to record and whether to stop offering notes.
 */
export function writeUpdateNotesState(userData: string, state: DesktopUpdateNotesState): void {
  const directory = join(userData, 'desktop')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const document = { ...(state.version === undefined ? {} : { version: state.version }), disabled: state.disabled }
  writeFileSync(join(directory, UPDATE_NOTES_STATE_FILE), `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 })
}

/**
 * Decide whether this launch should offer the notes it carries.
 * @param notes - Notes baked into the running build.
 * @param state - Acknowledgement record for this installation.
 * @param installedVersion - Version the running application reports.
 * @returns True only for a new, non-empty, matching set the user has not opted out of.
 */
export function shouldShowUpdateNotes(
  notes: DesktopUpdateNotes,
  state: DesktopUpdateNotesState,
  installedVersion: string,
): boolean {
  if (state.disabled || notes.notes.length === 0 || notes.version !== installedVersion) return false
  if (state.version === undefined) return true
  const seen = valid(state.version)
  const current = valid(installedVersion)
  // An unreadable recorded version must not silence a later build.
  return seen === null || current === null ? state.version !== installedVersion : gt(current, seen)
}
