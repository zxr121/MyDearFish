// 自动备份：把整条鱼定时打包到 `<DSH_HOME>/fish-backups`，最多留 5 份。
//
// 两条规矩：
//   1) 只清理本插件写出的 `mydearfish-YYYY-MM-DD-HHMMSS.zip`，同一目录里主人自己放的
//      文件一概不动。
//   2) 先写临时文件再改名，备份中途断电不会留下半截 zip。

import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildFishArchive } from './archive.js'

/** 备份目录名，落在安装目录的 data 下。 */
export const BACKUP_DIR_NAME = 'fish-backups'

/** 固定保留最近这么多份；超出的从最旧开始删。 */
export const BACKUP_KEEP = 5

const BACKUP_PATTERN = /^mydearfish-\d{4}-\d{2}-\d{2}-\d{6}(?:-\d+)?\.zip$/

/** @param {string} dshHome - DSH 根目录。 @returns {string} 备份目录。 */
export function backupDir(dshHome) {
  return join(dshHome, BACKUP_DIR_NAME)
}

function stamp(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

/**
 * 备份文件名；带秒，保证同一天多次备份不会互相覆盖。
 * @param {number|Date} [now] - 备份时间。
 * @returns {string} `mydearfish-YYYY-MM-DD-HHMMSS.zip`
 */
export function backupFileName(now = Date.now()) {
  const date = now instanceof Date ? now : new Date(now)
  return `mydearfish-${stamp(date)}.zip`
}

function existingBackupFiles(dshHome) {
  const folder = backupDir(dshHome)
  let entries
  try {
    entries = readdirSync(folder, { withFileTypes: true })
  } catch {
    return []
  }
  const files = []
  for (const entry of entries) {
    // isFile() 对符号链接是 false，顺手把链接排除在读取和清理之外。
    if (!entry.isFile() || !BACKUP_PATTERN.test(entry.name)) continue
    const path = join(folder, entry.name)
    try {
      const info = statSync(path)
      files.push({ name: entry.name, path, bytes: info.size, at: info.mtimeMs })
    } catch {
      // 刚好被别的进程挪走就当它不存在。
    }
  }
  files.sort((left, right) => right.at - left.at || right.name.localeCompare(left.name))
  return files
}

/**
 * 列出自动备份，新的在前；只认本插件写出的文件名。
 * @param {object} options - `{ dshHome }`。
 * @returns {{ name: string, path: string, bytes: number, at: number }[]} 备份文件。
 */
export function listBackups({ dshHome }) {
  return existingBackupFiles(dshHome)
}

/**
 * 只保留最近 `keep` 份，多出来的从最旧开始删。
 * @param {object} options - `{ dshHome, keep }`。
 * @returns {string[]} 被删掉的文件名。
 */
export function pruneBackups({ dshHome, keep = BACKUP_KEEP }) {
  const limit = Number.isInteger(keep) && keep > 0 ? keep : BACKUP_KEEP
  const removed = []
  for (const file of existingBackupFiles(dshHome).slice(limit)) {
    try {
      unlinkSync(file.path)
      removed.push(file.name)
    } catch {
      // 删不掉就留到下一轮，不能让一次备份失败拖垮整个插件。
    }
  }
  return removed
}

/**
 * 立刻打一份备份，再按上限清理旧文件。
 * @param {object} options - `{ dir, dshHome, store, identity, pluginVersion, personaText, now, keep }`。
 * @returns {{ ok: boolean, fileName: string, path: string, bytes: number, counts: object, warnings: string[], pruned: string[] }}
 */
export function writeBackup({
  dir,
  dshHome,
  store,
  identity,
  pluginVersion = '',
  personaText = '',
  now = Date.now(),
  keep = BACKUP_KEEP,
}) {
  const folder = backupDir(dshHome)
  if (existsSync(folder)) {
    const info = lstatSync(folder)
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error(`备份目录不是普通文件夹：${folder}`)
    }
  }
  mkdirSync(folder, { recursive: true })

  const bundle = buildFishArchive({ dir, dshHome, store, identity, pluginVersion, personaText, now })
  let fileName = backupFileName(now)
  let counter = 2
  while (existsSync(join(folder, fileName))) {
    fileName = backupFileName(now).replace(/\.zip$/, `-${counter}.zip`)
    counter += 1
  }
  const target = join(folder, fileName)
  const temp = join(folder, `.${fileName}.tmp`)
  try {
    writeFileSync(temp, bundle.buffer)
    renameSync(temp, target)
  } catch (error) {
    try {
      if (existsSync(temp)) unlinkSync(temp)
    } catch {}
    throw error
  }

  return {
    ok: true,
    fileName,
    path: target,
    bytes: bundle.buffer.length,
    counts: bundle.counts,
    warnings: bundle.warnings,
    pruned: pruneBackups({ dshHome, keep }),
  }
}

/**
 * 到了该备份的时候没有：一份都没有，或最新一份已经超过间隔。
 * @param {object} options - `{ dshHome, intervalHours, now }`。
 * @returns {boolean} 是否该备份。
 */
export function backupIsDue({ dshHome, intervalHours, now = Date.now() }) {
  const latest = existingBackupFiles(dshHome)[0]
  if (!latest) return true
  const hours = Number.isFinite(intervalHours) && intervalHours > 0 ? intervalHours : 24
  return now - latest.at >= hours * 60 * 60 * 1000
}

/**
 * 设置页要的只读状态；不带绝对路径，避免总览把本机目录带出去。
 * @param {object} options - `{ dshHome, enabled, intervalHours, keep, last, now }`。
 * @returns {object} 备份开关、间隔、最近一份和最近几次运行结果。
 */
export function describeBackups({
  dshHome,
  enabled = true,
  intervalHours = 24,
  keep = BACKUP_KEEP,
  last = null,
  now = Date.now(),
}) {
  const files = existingBackupFiles(dshHome)
  const latest = files[0] || null
  const intervalMs = Math.max(1, intervalHours) * 60 * 60 * 1000
  return {
    enabled: enabled === true,
    intervalHours,
    keep,
    dirName: BACKUP_DIR_NAME,
    count: files.length,
    lastAt: latest ? Math.round(latest.at) : 0,
    nextAt: latest ? Math.round(latest.at + intervalMs) : 0,
    due: backupIsDue({ dshHome, intervalHours, now }),
    files: files.slice(0, keep).map(({ name, bytes, at }) => ({ name, bytes, at: Math.round(at) })),
    lastRun: last,
  }
}
