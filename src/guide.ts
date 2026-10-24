// The steps after the install that used to happen inside the coding tool:
// signing in, the Terms, the GitHub App and a repository. Shared by `init`
// and `login`. Nothing here starts a scan or charges anything: every scan is
// quoted and agreed in the coding tool. Where the person has to finish
// something in the browser, the terminal asks Sekura until it is done
// rather than waiting for Enter.

import { confirm, select } from '@inquirer/prompts'
import { spawnSync } from 'node:child_process'
import { credentialsPath, forgetKey, openBrowser, readKey, redact, saveKey, signIn } from './auth.js'
import { getAccount, listRepositories, SignedOut, type Account, type Repository } from './api.js'
import { carriesKey, nextStep, onPath, SERVER_NAME, type Tool } from './catalogue.js'
import type { Step } from './plan.js'
import { currentGithubRepo } from './repo.js'
import { SITE, siteUrl } from './endpoint.js'
import { FREE_SCAN_URL, ONCE_PRICE } from './offer.js'
import { cross, dot, say, spinner, tick, waitFor, type Wait } from './ui.js'

const START = siteUrl('/app/start')
const DASHBOARD = siteUrl('/app')

export type Session = { key: string; account: Account | null }

/**
 * The key already here: SEKURA_API_KEY or the stored one, when Sekura still
 * takes it. A revoked stored key is forgotten. Null when there is none.
 */
export async function existingSession(): Promise<Session | null> {
  const fromEnv = !!process.env.SEKURA_API_KEY?.trim()
  const existing = readKey()
  if (!existing) return null
  try {
    const account = await getAccount(existing)
    say(`${tick} Signed in to Sekura as ${account.email ?? account.name ?? redact(existing)}${fromEnv ? ' (SEKURA_API_KEY)' : ''}`)
    return { key: existing, account }
  } catch (e) {
    if (!(e instanceof SignedOut)) {
      // Offline, or Sekura did not answer: the key is likely fine, and
      // writing it now saves the person a sign-in later.
      say(`${dot} Using ${fromEnv ? 'the key in SEKURA_API_KEY' : `your saved Sekura key (${credentialsPath()})`}, ${redact(existing)}; Sekura could not confirm it: ${(e as Error).message}`)
      return { key: existing, account: null }
    }
    if (fromEnv) { say(`${cross} SEKURA_API_KEY is not a valid Sekura key (${e.message}); it was not used.`); return null }
    forgetKey()
    say(`${dot} Your saved Sekura key no longer works (${e.message}); sign in again.`)
    return null
  }
}

/** A fresh sign-in, in this machine's browser or with a code on another
 *  device. Null when it did not finish; the tools then sign in on their own. */
export async function signInHere(opts: { device?: boolean } = {}): Promise<Session | null> {
  say()
  let stop = () => {}
  try {
    const key = await signIn({
      device: opts.device,
      onUrl: (url) => {
        say('  Opening your browser to sign in to Sekura with GitHub. If it does not open, go to:')
        say(`  ${url}`)
        say()
        stop = spinner(`Waiting for the sign-in in your browser… up to 5 minutes; Ctrl-C to stop`)
      },
      onDevice: (why) => { stop(); say(`  Signing in with a code, because ${why}.`) },
      onCode: (c) => {
        stop()
        say()
        say(`  On any device, open ${c.uri} and enter ${c.userCode}`)
        if (c.complete) say(`  Or open ${c.complete}`)
        say()
        const minutes = c.expiresIn ? Math.max(1, Math.round(c.expiresIn / 60)) : null
        stop = spinner(`Waiting for you to approve on ${SITE}…${minutes ? ` the code expires in ${minutes} min;` : ''} Ctrl-C to stop`)
      },
    })
    stop()
    let account: Account | null = null
    try { account = await getAccount(key) } catch { /* shown below as unknown */ }
    const where = saveKey(key, account?.email)
    say(`${tick} Signed in to Sekura as ${account?.email ?? account?.name ?? 'you'}; the key (${redact(key)}) is kept in ${where}`)
    return { key, account }
  } catch (e) {
    stop()
    say(`${cross} ${(e as Error).message}`)
    return null
  }
}

/** The key here, or a sign-in when the person can give one. */
export async function obtainKey(opts: { interactive: boolean; device?: boolean }): Promise<Session | null> {
  const s = await existingSession()
  if (s || !opts.interactive) return s
  return signInHere({ device: opts.device })
}

const accountReady = (a: Account) => a.termsAccepted !== false && a.emailVerified !== false

/** Asks Sekura until the Terms are accepted and the email verified. */
export async function waitForAccount(s: Session, wait: Wait = {}): Promise<boolean> {
  const r = await waitFor(`Waiting for the Terms and your email on ${SITE}… press Enter to skip`, async () => {
    const a = await getAccount(s.key)
    s.account = a
    return accountReady(a)
  }, wait)
  return r === 'done'
}

/** What the account still needs before a scan can start, with the page for it. */
export async function checkAccount(s: Session, interactive: boolean, wait: Wait = {}): Promise<void> {
  const a = s.account
  if (!a) return
  const todo: string[] = []
  if (a.termsAccepted === false) todo.push('accept the Terms')
  if (a.emailVerified === false) todo.push('verify your email')
  if (!todo.length) return
  const page = a.links?.dashboard ?? DASHBOARD
  say(`${dot} Before a scan can start, ${todo.join(' and ')} on ${SITE}: ${page}`)
  if (!interactive || !(await confirm({ message: `Open ${SITE} to do that now?`, default: true }))) return
  openBrowser(page)
  if (await waitForAccount(s, wait)) say(`${tick} Your Sekura account is ready`)
  else say(`${dot} Not done yet; finish it at ${page} before your first scan.`)
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

type Listing = { repos: Repository[] }

async function listAll(key: string, quiet = false): Promise<Listing> {
  const list = await listRepositories(key)
  if (!quiet) for (const i of list.installations) {
    if (i.error === 'github_sign_in_expired') say(`${dot} ${i.account}: GitHub access has expired; sign in at ${DASHBOARD} again to refresh it.`)
    else if (i.error === 'installation_gone') say(`${dot} ${i.account}: the Sekura GitHub App is no longer installed there.`)
    else if (i.error === 'github_unavailable') say(`${dot} ${i.account}: GitHub did not answer just now; try again in a minute.`)
    else if (i.error === 'partial') say(`${dot} ${i.account}: GitHub stopped answering part-way, so this list may be incomplete; try again in a minute.`)
  }
  return { repos: list.installations.flatMap((i) => i.repositories) }
}

/**
 * Asks Sekura until `want` can be scanned, or, with no `want`, until any
 * repository can. Returns the repositories as last listed.
 */
export async function waitForRepository(s: Session, want: string | null, wait: Wait = {}): Promise<{ found: boolean; repos: Repository[] }> {
  let repos: Repository[] = []
  const r = await waitFor('Waiting for the GitHub App install… press Enter to skip', async () => {
    repos = (await listAll(s.key, true)).repos
    return want ? repos.some((x) => same(x.fullName, want)) : repos.length > 0
  }, wait)
  return { found: r === 'done', repos }
}

/**
 * The repository to scan first: the one in this folder when Sekura can scan
 * it, else the person's choice. Offers the GitHub App install when there is
 * nothing to scan, or when this folder's repository is not covered, and
 * carries on by itself once the install shows up.
 */
export async function pickRepository(s: Session, cwd: string, interactive: boolean, wait: Wait = {}): Promise<string | null> {
  const here = currentGithubRepo(cwd)
  const start = s.account?.links?.start ?? START
  let repos: Repository[]
  try { repos = (await listAll(s.key)).repos } catch (e) { say(`${cross} Could not list your repositories: ${(e as Error).message}`); return null }
  const covered = !!here && repos.some((r) => same(r.fullName, here))
  if (!repos.length || (here && !covered)) {
    say(repos.length
      ? `${dot} ${here} (this folder) is not one Sekura can scan yet: the Sekura GitHub App needs access to it.`
      : `${dot} The Sekura GitHub App is not installed on any of your GitHub accounts yet, so there is nothing to scan.`)
    if (!interactive) say(`  Install it and choose repositories at ${start}`)
    else {
      const go = await select({
        message: repos.length ? `Give Sekura access to ${here}?` : 'Install the Sekura GitHub App?',
        choices: [
          { name: `Yes, open ${SITE} (the GitHub App asks which repositories)`, value: true },
          { name: repos.length ? 'No, pick from the repositories Sekura can already scan' : 'Not now', value: false },
        ],
      })
      if (go) {
        openBrowser(start)
        say(`  Opened ${start}`)
        // With nothing there yet, any repository is progress; otherwise the
        // one this folder holds is what was asked for.
        const want = repos.length ? here : null
        const w = await waitForRepository(s, want, wait)
        if (w.repos.length) repos = w.repos
        say(w.found ? `${tick} ${want ? `Sekura can scan ${want}` : 'The Sekura GitHub App is installed'}` : `${dot} Not there yet; you can finish the install later at ${start}`)
      }
    }
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

/** The tool's own sign-in command for a step whose entry cannot carry the
 *  key (Codex, Devin), when its binary is here. */
export function toolLogin(s: Step): string | null {
  if (s.kind !== 'tool' || !s.tool.login || carriesKey(s.target)) return null
  const bin = s.target.kind === 'command' ? s.target.bin : null
  return bin && onPath(bin) ? `${bin} ${s.tool.login.join(' ')}` : null
}

/**
 * Runs the tool's own sign-in for each written entry that could not carry
 * the key. The browser is already signed in to sekura.ai, so each is one
 * Approve. `ask: false` when the person already agreed to sign in (init's
 * one question). Returns the names of the tools signed in.
 */
export async function runToolLogins(steps: Step[], interactive: boolean, ask = true): Promise<Set<string>> {
  const done = new Set<string>()
  if (!interactive) return done
  for (const s of steps) {
    const cmd = toolLogin(s)
    if (!cmd || s.kind !== 'tool') continue
    if (ask && !(await confirm({ message: `Sign ${s.tool.name} in to Sekura now? (runs ${cmd}; approve in the browser)`, default: true }))) continue
    if (!ask) say(`  ${s.tool.name}: running ${cmd}; approve in the browser`)
    const r = spawnSync((s.target as { bin: string }).bin, s.tool.login!, { stdio: 'inherit' })
    if (r.status === 0) { done.add(s.tool.name); say(`${tick} ${s.tool.name} signed in`) }
    else say(`${cross} ${cmd} did not finish; run it yourself later.`)
  }
  return done
}

/** What to do in each tool now, so it loads the server. */
export function nextSteps(tools: Tool[]): void {
  say('  Next, in each tool:')
  for (const t of tools) say(`${dot} ${t.name}: ${nextStep(t)}`)
}

/** How to ask for a scan from each connected tool. */
export function howToScan(tools: string[], repo: string | null, account?: Account | null): void {
  const target = repo ?? 'owner/repo'
  say(`  To scan from your coding tool (Sekura Once, ${ONCE_PRICE} a scan, quoted first and started only after you agree):`)
  for (const name of tools) {
    if (name === 'Claude Code') say(`${dot} ${name}: /${SERVER_NAME} scan ${target}    (/${SERVER_NAME} help lists every command)`)
    else say(`${dot} ${name}: ask "scan ${target} with Sekura"`)
  }
  if (!repo) say(`  No repository picked yet: install the Sekura GitHub App and choose repositories at ${account?.links?.start ?? START}`)
  if (account?.freeScanAvailable !== false) say(`  Your first scan is free only when you start it yourself on the website: ${account?.links?.start ?? FREE_SCAN_URL}`)
}
