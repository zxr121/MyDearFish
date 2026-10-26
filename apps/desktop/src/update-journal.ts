/** Bounded update evidence outside the installation directory; no raw diagnostics or request data. */
import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { DesktopUpdateState } from './ipc.ts'

/** User and process milestones that connect update states across application restarts. */
export type DesktopUpdateJournalAction = 'started' | 'workspace-ready' | 'workspace-failed'
  | 'check-requested' | 'download-requested' | 'install-confirmed' | 'quit-requested'
  | 'policy-login-opened' | 'policy-login-returned' | 'policy-login-cancelled' | 'policy-login-failed'

const ERROR_CODES = ['ETIMEDOUT', 'ENOSPC', 'ERR_INTERNET_DISCONNECTED', 'ERR_CONNECTION_RESET', 'ERR_CONNECTION_CLOSED',
  'ERR_CONNECTION_ABORTED', 'ERR_NAME_NOT_RESOLVED', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN',
  'ERR_UPDATER_INVALID_SIGNATURE', 'ERR_UPDATER_CHECKSUM_MISMATCH', 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND',
  'ERR_UPDATER_LATEST_VERSION_NOT_FOUND', 'ERR_UPDATER_OLD_FILE_NOT_FOUND', 'ERR_UPDATER_ZIP_FILE_NOT_FOUND'] as const

const HTTP_ERROR = /\bHttpError:\s*(\d{3})\b/u

/** Retain only a stable classification; an unmatched error never carries its text into evidence. */
function updateErrorCode(message: string | undefined): string {
  if (message === undefined) return 'UNCLASSIFIED'
  const code = ERROR_CODES.find(candidate => message.includes(candidate))
  if (code !== undefined) return code
  const status = HTTP_ERROR.exec(message)
  return status === null ? 'UNCLASSIFIED' : `HTTP_${status[1]}`
}

/**
 * Whitelist one update state for disk; neither error text nor unexpected object fields survive.
 * @param state Main-process-owned update state.
 * @returns Only phase, target version, integer progress, operation, and a fixed error classification.
 */
export function desktopUpdateJournalState(state: DesktopUpdateState): object {
  return {
    phase: state.phase,
    ...(state.version !== undefined ? { targetVersion: state.version } : {}),
    ...(state.phase === 'downloading' && state.percent !== undefined ? { percent: Math.floor(state.percent) } : {}),
    ...(state.phase === 'error' ? {
      failedOperation: state.failedOperation,
      errorCode: updateErrorCode(state.message),
    } : {}),
  }
}

/** Process-owned JSONL evidence; each append is flushed before the caller continues. */
export class DesktopUpdateJournal {
  readonly path: string
  private sequence = 0
  private previousState: string | undefined

  /**
   * @param directory Absolute evidence directory, retained across installs; creation errors stop qualification.
   * @param version Installed application version, not a version supplied by the feed.
   */
  constructor(directory: string, private readonly version: string) {
    if (!isAbsolute(directory)) throw new Error('desktop update journal: directory must be absolute')
    mkdirSync(directory, { recursive: true })
    this.path = join(directory, `${Date.now()}-${randomUUID()}.jsonl`)
    writeFileSync(this.path, '', { flag: 'wx', mode: 0o600, flush: true })
    this.action('started')
  }

  /**
   * Append a fixed action; failures propagate so incomplete qualification is never reported as traced.
   * @param action Update operation or process milestone; no free-text fields are accepted.
   * @returns Nothing after the record has been flushed.
   */
  action(action: DesktopUpdateJournalAction): void { this.append({ event: action }) }

  /**
   * Retain state changes and integer progress increments without raw errors, URLs, or request data.
   * @param state Main-process-owned update state.
   * @returns Nothing after the changed state has been flushed; duplicate states add no record.
   */
  state(state: DesktopUpdateState): void {
    const fields = desktopUpdateJournalState(state)
    const encoded = JSON.stringify(fields)
    if (encoded === this.previousState) return
    this.append({ event: 'state', ...fields })
    this.previousState = encoded
  }

  private append(fields: object): void {
    appendFileSync(this.path, `${JSON.stringify({ schemaVersion: 1, sequence: this.sequence++,
      time: new Date().toISOString(), pid: process.pid, version: this.version, ...fields })}\n`, { flush: true })
  }
}

function newestJournals(directory: string): readonly string[] {
  return readdirSync(directory).filter(name => name.endsWith('.jsonl'))
    .map(name => ({ name, modified: statSync(join(directory, name)).mtimeMs }))
    .sort((left, right) => right.modified - left.modified)
    .map(file => file.name)
}

/**
 * Delete older journal files so an always-on evidence directory stays bounded.
 * @param directory Absolute evidence directory.
 * @param keep Number of newest files to retain.
 * @returns Nothing; filesystem failures propagate so the caller can report them.
 */
export function pruneDesktopUpdateJournals(directory: string, keep: number): void {
  if (!Number.isInteger(keep) || keep < 1) throw new Error('desktop update journal: keep must be a positive integer')
  for (const name of newestJournals(directory).slice(keep)) unlinkSync(join(directory, name))
}

/**
 * Read the newest journal files for a user-initiated diagnostic copy.
 * @param directory Absolute evidence directory.
 * @param maxFiles Maximum number of newest files to include.
 * @param maxBytes Maximum UTF-8 bytes across the included files.
 * @returns Included file count and concatenated records; filesystem failures propagate.
 */
export function readDesktopUpdateJournals(directory: string, maxFiles = 5, maxBytes = 512 * 1024): { files: number; text: string } {
  let text = ''
  let files = 0
  for (const name of newestJournals(directory).slice(0, maxFiles)) {
    const contents = readFileSync(join(directory, name), 'utf8')
    if (Buffer.byteLength(text) + Buffer.byteLength(contents) > maxBytes) break
    text += `--- ${name}\n${contents.trimEnd()}\n`
    files += 1
  }
  return { files, text: text.trimEnd() }
}
