// The GitHub repository the person is standing in, if any: offered first
// when they pick one to scan.

import { spawnSync } from 'node:child_process'

/** `owner/repo` from a GitHub remote URL, or null for any other host. */
export function parseGithubRemote(url: string): string | null {
  const m = /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https?:\/\/(?:[^@/]+@)?github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(url.trim())
  return m ? `${m[1]}/${m[2]}` : null
}

export function currentGithubRepo(cwd: string): string | null {
  const r = spawnSync('git', ['config', '--get', 'remote.origin.url'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  if (r.error || r.status !== 0) return null
  return parseGithubRemote(r.stdout)
}
