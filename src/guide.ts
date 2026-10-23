// The steps after the install that used to happen inside the coding tool:
// signing in, the GitHub App, a repository, and the free first scan. Shared
// by `init` and `login`. Nothing here starts a scan or charges anything: the
// free scan is started by the person on sekura.ai, and every other scan is
// quoted and agreed in the coding tool.

import { confirm, input, select } from '@inquirer/prompts'
import { spawnSync } from 'node:child_process'
import { forgetKey, openBrowser, readKey, redact, saveKey, signIn } from './auth.js'
import { getAccount, listRepositories, SignedOut, type Account, type Repository } from './api.js'
import { carriesKey, onPath, SERVER_NAME } from './catalogue.js'
import type { Step } from './plan.js'
import { currentGithubRepo } from './repo.js'
import { cross, dot, say, tick } from './ui.js'

const START = 'https://sekura.ai/app/start'
const DASHBOARD = 'https://sekura.ai/app'

export type Session = { key: string; account: Account | null }

/**
 * A key that works: SEKURA_API_KEY, the stored one, or a fresh sign-in in
 * the browser when the person agrees. Null when there is none, and the tools
 * then sign in on their own, as they always could.
 */
export async function obtainKey(opts: { interactive: boolean; ask?: boolean }): Promise<Session | null> {
  const fromEnv = !!process.env.SEKURA_API_KEY?.trim()
  const existing = readKey()
  if (existing) {
    try {
      const account = await getAccount(existing)
      say(`${tick} Signed in to Sekura as ${account.email ?? account.name ?? redact(existing)}${fromEnv ? ' (SEKURA_API_KEY)' : ''}`)
      return { key: existing, account }
    } catch (e) {
      if (!(e instanceof SignedOut)) {
        // Offline, or Sekura did not answer: the key is likely fine, and
        // writing it now saves the person a sign-in later.
        say(`${dot} Using your saved Sekura key ${redact(existing)}; Sekura could not be asked who it belongs to (${(e as Error).message}).`)
        return { key: existing, account: null }
      }
      if (fromEnv) { say(`${cross} SEKURA_API_KEY is not a valid Sekura key (${e.message}); it was not used.`); return null }
      forgetKey()
      say(`${dot} Your saved Sekura key no longer works (${e.message}); sign in again.`)
    }
  }
  if (!opts.interactive) return null
  if (opts.ask !== false && !(await confirm({ message: 'Sign in to Sekura now, so your tools do not have to? (opens your browser)', default: true }))) return null
  try {
    const key = await signIn({
      onUrl: (url) => { say(); say('  Opening your browser to sign in to Sekura with GitHub. If it does not open, go to:'); say(`  ${url}`); say() },
    })
    let account: Account | null = null
    try { account = await getAccount(key) } catch { /* shown below as unknown */ }
    const where = saveKey(key, account?.email)
    say(`${tick} Signed in to Sekura as ${account?.email ?? account?.name ?? 'you'}; the key (${redact(key)}) is kept in ${where}`)
    return { key, account }
  } catch (e) {
    say(`${cross} ${(e as Error).message}`)
    say('  Your tools will ask you to sign in the first time they use Sekura instead.')
    return null
  }
}

/** What the account still needs before a scan can start, with the page for it. */
export async function checkAccount(s: Session, interactive: boolean): Promise<void> {
  const a = s.account
  if (!a) return
  const todo: string[] = []
  if (a.termsAccepted === false) todo.push('accept the Terms')
  if (a.emailVerified === false) todo.push('verify your email')
  if (!todo.length) return
  const page = a.links?.dashboard ?? DASHBOARD
  say(`${dot} Before a scan can start, ${todo.join(' and ')} on sekura.ai: ${page}`)
  if (interactive && (await confirm({ message: 'Open sekura.ai to do that now?', default: true }))) {
    openBrowser(page)
    await input({ message: 'Press Enter when you are done' })
  }
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/**
 * The repository to scan first: the one in this folder when Sekura can scan
 * it, else the person's choice. Offers the GitHub App install when there is
 * nothing to scan, or when this folder's repository is not covered.
 */
export async function pickRepository(s: Session, cwd: string, interactive: boolean): Promise<string | null> {
  const here = currentGithubRepo(cwd)
  const start = s.account?.links?.start ?? START
  let repos: Repository[] = []
  for (let attempt = 0; ; attempt++) {
    let list
    try { list = await listRepositories(s.key) } catch (e) { say(`${cross} Could not list your repositories: ${(e as Error).message}`); return null }
    for (const i of list.installations) {
      if (i.error === 'github_sign_in_expired') say(`${dot} ${i.account}: GitHub access has expired; sign in at ${DASHBOARD} again to refresh it.`)
      else if (i.error === 'installation_gone') say(`${dot} ${i.account}: the Sekura GitHub App is no longer installed there.`)
    }
    repos = list.installations.flatMap((i) => i.repositories)
    const covered = !!here && repos.some((r) => same(r.fullName, here))
    if (repos.length && (!here || covered)) break
    say(repos.length
      ? `${dot} ${here} (this folder) is not one Sekura can scan yet: the Sekura GitHub App needs access to it.`
      : `${dot} The Sekura GitHub App is not installed on any of your GitHub accounts yet, so there is nothing to scan.`)
    if (!interactive) { say(`  Install it and choose repositories at ${start}`); break }
    if (attempt >= 3) break
    const go = await select({
      message: repos.length ? `Give Sekura access to ${here}?` : 'Install the Sekura GitHub App?',
      choices: [
        { name: 'Yes, open sekura.ai (the GitHub App asks which repositories)', value: true },
        { name: repos.length ? 'No, pick from the repositories Sekura can already scan' : 'Not now', value: false },
      ],
    })
    if (!go) break
    openBrowser(start)
    say(`  Opened ${start}`)
    await input({ message: 'Press Enter once the GitHub App is installed' })
  }
  const scannable = repos.filter((r) => !r.empty)
  if (!scannable.length) return null
  const hereRepo = here ? scannable.find((r) => same(r.fullName, here)) : undefined
  if (!interactive) return hereRepo?.fullName ?? null
  if (scannable.length === 1) { say(`${tick} Repository: ${scannable[0].fullName}`); return scannable[0].fullName }
  const ordered = hereRepo ? [hereRepo, ...repos.filter((r) => r !== hereRepo)] : repos
  const picked = await select<string>({
    message: 'Which repository should Sekura scan first?',
    pageSize: 12,
    choices: [
      ...ordered.map((r) => ({
        name: `${r.fullName}${r === hereRepo ? ' (this folder)' : ''}${r.private ? ' (private)' : ''}`,
        value: r.fullName,
        disabled: r.empty ? '(empty, nothing to scan)' : false,
      })),
      { name: 'Skip for now', value: '' },
    ],
  })
  return picked || null
}

/** The free first scan, which only sekura.ai starts, when it is still there. */
export async function offerFreeScan(s: Session, repo: string | null, interactive: boolean): Promise<boolean> {
  if (!s.account?.freeScanAvailable) return false
  const start = s.account.links?.start ?? START
  say()
  say(`  Your free first scan is still available. It is started on sekura.ai${repo ? `: choose ${repo} there` : ''}.`)
  if (interactive && (await confirm({ message: `Open sekura.ai to start your free scan${repo ? ` of ${repo}` : ''}?`, default: true }))) {
    openBrowser(start)
    say(`${tick} Opened ${start}`)
    return true
  }
  say(`  Start it any time at ${start}`)
  return false
}

/**
 * Runs the tool's own sign-in for each written entry that could not carry
 * the key (Codex, Devin). The browser is already signed in to sekura.ai, so
 * each is one Approve. Returns the names of the tools signed in.
 */
export async function runToolLogins(steps: Step[], interactive: boolean): Promise<Set<string>> {
  const done = new Set<string>()
  if (!interactive) return done
  for (const s of steps) {
    if (s.kind !== 'tool' || !s.tool.login || carriesKey(s.target)) continue
    const bin = s.target.kind === 'command' ? s.target.bin : null
    if (!bin || !onPath(bin)) continue
    const cmd = `${bin} ${s.tool.login.join(' ')}`
    if (!(await confirm({ message: `Sign ${s.tool.name} in to Sekura now? (runs ${cmd}; approve in the browser)`, default: true }))) continue
    const r = spawnSync(bin, s.tool.login, { stdio: 'inherit' })
    if (r.status === 0) { done.add(s.tool.name); say(`${tick} ${s.tool.name} signed in`) }
    else say(`${cross} ${cmd} did not finish; run it yourself later.`)
  }
  return done
}

/** How to ask for a scan from each connected tool. */
export function howToScan(tools: string[], repo: string | null): void {
  const target = repo ?? 'owner/repo'
  say('  To scan from your coding tool (every scan is quoted first and starts only after you agree):')
  for (const name of tools) {
    if (name === 'Claude Code') say(`${dot} ${name}: /${SERVER_NAME} scan ${target}    (/${SERVER_NAME} help lists every command)`)
    else say(`${dot} ${name}: ask "scan ${target} with Sekura"`)
  }
}
