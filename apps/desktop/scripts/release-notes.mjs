/**
 * Build-time "what changed" notes for the bundled update popup.
 *
 * Each packaged application carries only the notes of its own build, so an installation that skipped
 * releases never shows a cumulative list. The previous `fish-release-*` tag is the only baseline
 * available at packaging time; commits newer than it are summarized by their subjects.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Resource name electron-builder copies next to the packaged application. */
export const UPDATE_NOTES_FILENAME = 'update-notes.json'

/** Most entries one build shows; the newest commits are kept. */
export const MAX_UPDATE_NOTES = 20

/** Release tag prefix this fork publishes. */
const RELEASE_TAG_PREFIX = 'fish-release-*'

/** Conventional-commit types that never explain a product change to a user. */
const UNLISTED_TYPES = new Set(['build', 'chore', 'ci', 'docs', 'style', 'test', 'tests'])

/** Subjects that carry no change a user would recognize. */
const NON_CHANGE_SUBJECT = /^(?:Merge |Release |v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\s*$)/u

/** Leading product version used by this repository's release commits. */
const VERSION_PREFIX = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\s+/u

/** Conventional-commit prefix with an optional scope and breaking marker. */
const CONVENTIONAL_PREFIX = /^([a-z]+)(?:\([^()]*\))?!?:\s*(.+)$/u

/**
 * Run one git command against a checkout.
 * @param {string} cwd - Repository root.
 * @param {readonly string[]} args - Arguments after the executable name.
 * @returns Trimmed standard output.
 */
function git(cwd, args) {
  return execFileSync('git', args, {
    cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
}

/**
 * Turn one commit subject into user-facing copy.
 * @param {string} subject - Commit subject as `git log` reports it.
 * @returns The note, or undefined for commits that never reach the popup.
 */
export function releaseNoteFromSubject(subject) {
  const line = subject.trim()
  if (line === '' || NON_CHANGE_SUBJECT.test(line)) return undefined
  const conventional = CONVENTIONAL_PREFIX.exec(line)
  if (conventional !== null && UNLISTED_TYPES.has(conventional[1])) return undefined
  const message = (conventional === null ? line : conventional[2]).replace(VERSION_PREFIX, '').trim()
  return message === '' ? undefined : message
}

/**
 * Find the release tag a new build should compare against.
 * @param {string} cwd - Repository root.
 * @returns The newest `fish-release-*` tag reachable from HEAD whose commit is not HEAD itself, or undefined.
 */
export function previousReleaseTag(cwd) {
  const head = git(cwd, ['rev-parse', 'HEAD'])
  const tags = git(cwd, ['tag', '--list', RELEASE_TAG_PREFIX, '--merged', 'HEAD', '--sort=-version:refname'])
    .split('\n').filter(tag => tag !== '')
  for (const tag of tags) {
    if (git(cwd, ['rev-parse', `${tag}^{commit}`]) !== head) return tag
  }
  return undefined
}

/**
 * Collect the notes one build carries.
 * @param {string} cwd - Repository root.
 * @param {string} version - Build version the notes are baked for.
 * @returns The document written to {@link UPDATE_NOTES_FILENAME}.
 */
export function collectReleaseNotes(cwd, version) {
  if (typeof version !== 'string' || version.trim() === '') throw new Error('release notes: a build version is required')
  const previous = previousReleaseTag(cwd)
  const subjects = git(cwd, [
    'log', '--no-merges', '--max-count=400', '--format=%s', previous === undefined ? 'HEAD' : `${previous}..HEAD`,
  ]).split('\n').filter(subject => subject !== '')
  const notes = []
  for (const subject of subjects) {
    const note = releaseNoteFromSubject(subject)
    if (note === undefined || notes.includes(note)) continue
    notes.push(note)
    if (notes.length === MAX_UPDATE_NOTES) break
  }
  return { schemaVersion: 1, version, notes }
}

/**
 * Write the notes where electron-builder reads them.
 * @param {string} directory - Target build directory.
 * @param {{ schemaVersion: 1, version: string, notes: readonly string[] }} notes - Document to write.
 * @returns Absolute path of the written file.
 */
export function writeReleaseNotes(directory, notes) {
  const path = join(directory, UPDATE_NOTES_FILENAME)
  mkdirSync(directory, { recursive: true })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, `${JSON.stringify(notes, null, 2)}\n`)
  renameSync(temporary, path)
  return path
}
