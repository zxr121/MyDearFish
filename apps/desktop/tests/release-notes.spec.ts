import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import {
  collectReleaseNotes,
  MAX_UPDATE_NOTES,
  previousReleaseTag,
  releaseNoteFromSubject,
  writeReleaseNotes,
  UPDATE_NOTES_FILENAME,
} from '../scripts/release-notes.mjs'

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-release-notes-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  return root
}

function repository() {
  const cwd = fixture()
  const git = (...args: string[]): string => execFileSync('git', [
    '-c', 'user.name=Release Notes Test', '-c', 'user.email=release-notes@example.com', '-c', 'commit.gpgsign=false',
    ...args,
  ], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git('init', '--quiet')
  const commit = (subject: string): void => { git('commit', '--quiet', '--allow-empty', '-m', subject) }
  const tag = (name: string): void => { git('tag', name) }
  return { cwd, git, commit, tag }
}

it.each([
  ['feat(qq-bridge): 原生回复 + 主动戳一戳', '原生回复 + 主动戳一戳'],
  ['fix(llm)!: 全延迟工具列表不再必 400', '全延迟工具列表不再必 400'],
  ['0.2.84 回话带原生引用：修好分支语法并补冒烟用例', '回话带原生引用：修好分支语法并补冒烟用例'],
  ['perf: 检查更新更省电', '检查更新更省电'],
  ['refactor(core): 提取共享结构', '提取共享结构'],
  ['feat: 0.3.0 支持新版本说明', '支持新版本说明'],
  ['没有类型前缀的中文说明', '没有类型前缀的中文说明'],
])('turns %j into user-facing copy', (subject, note) => {
  expect(releaseNoteFromSubject(subject)).toBe(note)
})

it.each([
  '', '   ', 'docs: 补充说明', 'test(desktop): 增补用例', 'tests: 用例', 'ci: 调整流水线', 'chore: 升级依赖',
  'build: 打包', 'style: 格式', 'Merge branch \'main\'', 'Merge pull request #12', 'Release 0.2.8', '0.2.84',
])('skips %j', (subject) => {
  expect(releaseNoteFromSubject(subject)).toBeUndefined()
})

it('summarizes only the commits after the previous release tag', () => {
  const repo = repository()
  repo.commit('feat: 初始版本')
  repo.tag('fish-release-20261001')
  repo.commit('docs: 只改文档')
  repo.commit('0.2.5 新增更新说明弹窗')
  repo.commit('fix(qq): 群消息顺序')
  repo.tag('fish-release-20261028')

  expect(previousReleaseTag(repo.cwd)).toBe('fish-release-20261001')
  expect(collectReleaseNotes(repo.cwd, '0.2.5-test.20261028.1')).toEqual({
    schemaVersion: 1,
    version: '0.2.5-test.20261028.1',
    notes: ['群消息顺序', '新增更新说明弹窗'],
  })
})

it('deduplicates repeated copy and keeps the newest entries up to the cap', () => {
  const repo = repository()
  repo.commit('chore: 初始提交')
  repo.tag('fish-release-20261001')
  for (let index = 0; index < MAX_UPDATE_NOTES + 3; index += 1) repo.commit(`feat: 变更 ${index}`)
  repo.commit('fix: 同一条修复')
  repo.commit('fix: 同一条修复')

  const collected = collectReleaseNotes(repo.cwd, '0.3.0')
  expect(collected.notes).toHaveLength(MAX_UPDATE_NOTES)
  expect(collected.notes[0]).toBe('同一条修复')
  expect(collected.notes[1]).toBe(`变更 ${MAX_UPDATE_NOTES + 2}`)
  expect(new Set(collected.notes).size).toBe(MAX_UPDATE_NOTES)
})

it('falls back to the whole history when no release tag exists yet', () => {
  const repo = repository()
  repo.commit('feat: 第一条说明')
  repo.commit('chore: 忽略我')
  expect(collectReleaseNotes(repo.cwd, '0.1.0').notes).toEqual(['第一条说明'])
})

it('rejects a missing version instead of baking notes no update can match', () => {
  const repo = repository()
  expect(() => collectReleaseNotes(repo.cwd, ' ')).toThrow(/version/u)
})

it('writes the document where the packager reads it', () => {
  const directory = join(fixture(), 'target')
  const path = writeReleaseNotes(directory, { schemaVersion: 1, version: '1.0.0', notes: ['变化'] })
  expect(path).toBe(join(directory, UPDATE_NOTES_FILENAME))
  expect(readFileSync(path, 'utf8')).toBe(`${JSON.stringify({ schemaVersion: 1, version: '1.0.0', notes: ['变化'] }, null, 2)}\n`)
})
