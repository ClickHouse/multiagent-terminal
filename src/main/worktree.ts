import { simpleGit } from 'simple-git'
import * as path from 'path'
import * as fs from 'fs'

export function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+|-+$/g, '') || 'agent'
}

export function worktreePath(baseRepo: string, name: string): string {
  const parent = path.dirname(baseRepo)
  const repoName = path.basename(baseRepo)
  return path.join(parent, `${repoName}-${sanitizeName(name)}`)
}

export async function validateBaseRepo(repoPath: string): Promise<void> {
  const git = simpleGit(repoPath)
  const isRepo = await git.checkIsRepo()
  if (!isRepo) throw new Error(`${repoPath} is not a git repository`)
  const root = await git.revparse(['--show-toplevel'])
  if (root.trim() !== path.resolve(repoPath)) {
    throw new Error(`${repoPath} is not the git root (root is ${root.trim()})`)
  }
}

export async function createWorktree(
  baseRepo: string,
  wtPath: string,
  branchName: string
): Promise<void> {
  if (fs.existsSync(wtPath)) {
    throw new Error(`Worktree path already exists: ${wtPath}`)
  }
  const git = simpleGit(baseRepo)
  await git.raw(['worktree', 'add', '-b', branchName, wtPath])
}

export async function removeWorktree(baseRepo: string, wtPath: string): Promise<void> {
  const git = simpleGit(baseRepo)
  await git.raw(['worktree', 'remove', '--force', wtPath])
  await git.raw(['worktree', 'prune']).catch(() => {})
}
