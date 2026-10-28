/** Resource name electron-builder copies next to the packaged application. */
export const UPDATE_NOTES_FILENAME: 'update-notes.json'

/** Most entries one build shows; the newest commits are kept. */
export const MAX_UPDATE_NOTES: number

/**
 * Turn one commit subject into user-facing copy.
 * @param subject - Commit subject as `git log` reports it.
 * @returns The note, or undefined for commits that never reach the popup.
 */
export function releaseNoteFromSubject(subject: string): string | undefined

/**
 * Find the release tag a new build should compare against.
 * @param cwd - Repository root.
 * @returns The newest release tag reachable from HEAD whose commit is not HEAD itself, or undefined.
 */
export function previousReleaseTag(cwd: string): string | undefined

/**
 * Collect the notes one build carries.
 * @param cwd - Repository root.
 * @param version - Build version the notes are baked for.
 * @returns The document written as {@link UPDATE_NOTES_FILENAME}.
 */
export function collectReleaseNotes(
  cwd: string,
  version: string,
): { schemaVersion: 1; version: string; notes: string[] }

/**
 * Write the notes where electron-builder reads them.
 * @param directory - Target build directory.
 * @param notes - Document to write.
 * @returns Absolute path of the written file.
 */
export function writeReleaseNotes(
  directory: string,
  notes: { schemaVersion: 1; version: string; notes: readonly string[] },
): string
