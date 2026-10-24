// `sekura init`, also what a bare `sekura` runs: detect, one question,
// review, sign in, apply, verify, then the rest of getting started (the
// Terms, the GitHub App, a repository) so none of it is left for the coding
// tool. The plan is shown and agreed before the browser opens, with a
// placeholder where the key will go, so nobody approves a sign-in before
// they have seen what will be written. Nothing is written before the review
// is agreed (unless --yes).

import { Command } from 'commander'
import { checkbox, confirm, select } from '@inquirer/prompts'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { DOCS, ENDPOINT, PENDING_KEY, TOOLS, carriesKey, home, toolById, type Tool } from '../catalogue.js'
import { applyStep, buildPlan, describeStep, detectTools, type Scope } from '../plan.js'
import { verifyEndpoint } from '../verify.js'
import { credentialsPath, readKey } from '../auth.js'
import { checkAccount, existingSession, howToScan, nextSteps, pickRepository, runToolLogins, signInHere, toolLogin, type Session } from '../guide.js'
import { banner, cross, dot, say, tick, type Wait } from '../ui.js'

export type InitOptions = {
  yes?: boolean
  skill?: boolean
  scope?: Scope
  tools?: string
  dryRun?: boolean
  cwd?: string
  verify?: boolean
  /** false: no sign-in here; the tools sign in on their own. */
  login?: boolean
  /** Sign in with a code on another device instead of this browser. */
  device?: boolean
  /** How long the account steps wait on the browser. */
  wait?: Wait
}

/** The home folder (or the top of the disk) is no project: project scope
 *  there would put AGENTS.md and .mcp.json in it for every tool to find. */
export function isProjectDir(cwd: string): boolean {
  const real = (p: string) => { try { return realpathSync(p) } catch { return resolve(p) } }
  const dir = real(cwd)
  return dir !== real(home()) && dir !== real(homedir()) && dirname(dir) !== dir
}

const and = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/** The one question: everything init will do, in a sentence. */
export function summary(o: { names: string[]; scope: Scope; skill: boolean; signIn: 'sign-in' | 'saved' | null }): string {
  const where = o.scope === 'user' ? 'for every project' : 'for this project only'
  const sign = o.signIn === 'sign-in' ? ', and sign in to Sekura' : o.signIn === 'saved' ? ', with your saved Sekura key' : ''
  return `Connect ${and(o.names)} ${where}, ${o.skill ? 'with' : 'without'} the skill${sign}?`
}

export async function runInit(opts: InitOptions): Promise<{ written: number; byHand: number; failed: number }> {
  const interactive = !opts.yes && !!process.stdin.isTTY && !!process.stderr.isTTY
  const cwd = opts.cwd ?? process.cwd()
  banner({ login: opts.login })

  // 1. Detect. Every detected tool, user scope, the skill and the sign-in
  // are the defaults; a flag answers its own question.
  const detected = detectTools(cwd)
  let chosen: string[]
  if (opts.tools) {
    chosen = opts.tools.split(',').map((s) => s.trim()).filter(Boolean).map((s) => (s.startsWith('tools-') ? s : `tools-${s}`))
  } else if (detected.length === 0) {
    say('  No supported coding tool was found on this machine.')
    say(`  Sekura connects to Claude Code, Cursor, GitHub Copilot, OpenAI Codex and nearly forty other tools; the page has every one: ${DOCS}`)
    return { written: 0, byHand: 0, failed: 0 }
  } else {
    chosen = detected.map((t) => t.id)
  }
  let scope: Scope = opts.scope ?? 'user'
  const inProject = isProjectDir(cwd)
  if (scope === 'project' && !inProject) {
    say(`  ${cwd} is your home folder or the top of the disk, not a project: run sekura init --scope project inside the project, or use --scope user.`)
    say('  Nothing was changed.')
    return { written: 0, byHand: 0, failed: 1 }
  }
  let skill = opts.skill !== false
  let login = opts.login !== false
  const hasKey = !!readKey()

  // 2. One question, with Edit for the four it stands for.
  if (interactive) {
    const open = { tools: !opts.tools, scope: !opts.scope && inProject, skill: opts.skill === undefined, login: opts.login === undefined }
    if (open.tools) { say(`  Found ${detected.length === 1 ? 'one tool' : `${detected.length} tools`}: ${detected.map((t) => t.name).join(', ')}`); say() }
    if (open.tools || open.scope || open.skill || open.login) {
      const names = chosen.map((id) => toolById(id)?.name ?? id)
      const answer = await select<'yes' | 'edit' | 'no'>({
        message: summary({ names, scope, skill, signIn: login && scope === 'user' ? (hasKey ? 'saved' : 'sign-in') : null }),
        choices: [
          { name: 'Yes', value: 'yes' },
          { name: 'Edit: choose the tools, where, the skill and the sign-in', value: 'edit' },
          { name: 'No, change nothing', value: 'no' },
        ],
      })
      if (answer === 'no') { say('  Nothing was changed.'); return { written: 0, byHand: 0, failed: 0 } }
      if (answer === 'edit') {
        if (open.tools) {
          chosen = await checkbox({
            message: 'Connect Sekura to',
            choices: detected.map((t) => ({ name: t.name, value: t.id, checked: chosen.includes(t.id) })),
            required: true,
          })
        }
        if (open.scope) {
          scope = await select<Scope>({
            message: 'Where',
            choices: [
              { name: 'For me, in every project (your user configuration)', value: 'user' },
              { name: `This project only (${cwd})`, value: 'project' },
            ],
          })
        }
        if (open.skill) skill = await confirm({ message: 'Also install the sekura skill, which teaches the agent the quote-then-confirm rule?', default: true })
        // Project files never carry the key (they are committed), so there
        // is no sign-in to ask about in project scope.
        if (open.login && scope === 'user') {
          login = await confirm({
            message: hasKey
              ? 'Give your tools your saved Sekura key, so they do not ask you to sign in?'
              : 'Sign in to Sekura once you have reviewed the plan, so your tools do not have to?',
            default: true,
          })
        }
      }
    }
  }

  // 3. A key already here is used as it is; a sign-in waits for the review.
  // A dry run never signs in.
  let session: Session | null = null
  const keyed = login && scope === 'user'
  if (keyed && hasKey) { say(); session = await existingSession() }
  const willSignIn = keyed && !session && interactive

  // 4. The plan, shown before anything happens, with a placeholder for the
  // key the sign-in will bring.
  const shown = buildPlan({ tools: chosen, scope, skill, cwd, key: session?.key ?? (willSignIn ? PENDING_KEY : undefined) })
  say()
  say(opts.dryRun ? '  Dry run. This would:' : '  This will:')
  if (willSignIn) say(`${dot} sign in to Sekura in your browser (or with a code on another device) after you agree, and keep the key in ${credentialsPath()}`)
  for (const s of shown.steps) say(`${dot} ${describeStep(s, !!opts.dryRun)}`)
  if (willSignIn || session) for (const s of shown.steps) { const cmd = toolLogin(s); if (cmd && s.kind === 'tool') say(`${dot} ${s.tool.name}: ${opts.dryRun ? 'would ' : ''}run ${cmd}, approved in the browser`) }
  for (const s of shown.skipped) say(`${dot} ${s.tool.name}: skipped, ${s.why}`)
  say(`${dot} touch nothing else: other servers, settings and files stay as they are`)
  say()
  if (opts.dryRun) return { written: 0, byHand: 0, failed: 0 }
  if (interactive && !(await confirm({ message: 'Apply?', default: true }))) {
    say('  Nothing was changed.')
    return { written: 0, byHand: 0, failed: 0 }
  }

  // 5. Sign in, now that the plan is agreed, and put the key where the
  // placeholder was. Without a key the same entries are written plain, and
  // each tool signs in on first use, as it always could.
  let plan = shown
  if (willSignIn) {
    session = await signInHere({ device: opts.device })
    if (!session) say('  Applying the plan without a key instead: each tool signs in the first time it uses Sekura.')
    plan = buildPlan({ tools: chosen, scope, skill, cwd, key: session?.key })
  }

  // 6. Apply, one step at a time, saying what each did.
  say()
  let written = 0, byHand = 0, failed = 0
  const signIns = new Map<string, string | null>()
  const connected: Tool[] = []
  for (const s of plan.steps) {
    const r = applyStep(s)
    switch (r.status) {
      case 'written': case 'ran': written++; say(`${tick} ${r.where}`); break
      case 'removed': case 'absent': break
      case 'unchanged': say(`${tick} ${r.where} (already there)`); break
      case 'by-hand': byHand++; say(`${cross} ${r.where}: ${r.why}`); if (r.snippet) say(r.snippet.split('\n').map((l) => '      ' + l).join('\n')); break
      case 'failed': failed++; say(`${cross} ${r.where}: ${r.why}`); break
    }
    if (s.kind === 'tool' && (r.status === 'written' || r.status === 'ran' || r.status === 'unchanged')) {
      signIns.set(s.tool.name, carriesKey(s.target) ? null : s.tool.signIn)
      connected.push(s.tool)
    }
  }
  // Tools whose entry cannot carry the key sign in with their own command,
  // now, while the browser is signed in to sekura.ai. A sign-in agreed in
  // the one question covers them; a saved key asks first.
  if (session) {
    const steps = plan.steps.filter((s) => s.kind === 'tool' && signIns.has(s.tool.name))
    for (const name of await runToolLogins(steps, interactive, !willSignIn)) signIns.set(name, null)
  }

  // 7. Verify the address.
  if (opts.verify !== false) {
    const v = await verifyEndpoint(ENDPOINT)
    say(`${v.ok ? tick : cross} ${v.detail}`)
  }

  // 8. The account and a repository, with the key.
  let repo: string | null = null
  if (session && signIns.size) {
    say()
    await checkAccount(session, interactive, opts.wait)
    repo = await pickRepository(session, cwd, interactive, opts.wait)
  }

  // 9. What is left, per tool.
  say()
  if (signIns.size) {
    const ready = [...signIns].filter(([, how]) => how === null).map(([name]) => name)
    const pending = [...signIns].filter(([, how]) => how !== null)
    if (ready.length) say(`${tick} Ready, no sign-in needed: ${ready.join(', ')}`)
    if (pending.length) {
      say('  Sign in once per tool:')
      for (const [name, how] of pending) say(`${dot} ${name}: ${how}`)
    }
    say()
    nextSteps(connected)
    say()
    howToScan([...signIns.keys()], repo, session?.account)
    say()
  }
  say(`  Documentation and every other tool: ${DOCS}`)
  say()
  return { written, byHand, failed }
}

/** A --no-x flag's value only when it was typed: commander fills in true
 *  otherwise, which would read as an answer to a question never asked. */
export function typedOnly<T extends Record<string, unknown>>(opts: T, cmd: Command, names: string[]): T {
  for (const n of names) if (cmd.getOptionValueSource(n) !== 'cli') delete opts[n]
  return opts
}

export const initCommand = new Command('init')
  .description('Connect the coding tools on this machine to Sekura, and install the sekura skill. What a bare `sekura` runs.')
  .option('-y, --yes', 'apply without asking; every detected tool, user scope, with the skill, and the key in SEKURA_API_KEY or saved by sekura login')
  .option('--no-skill', 'the MCP server only: no skill, no guidance block')
  .option('--scope <scope>', 'user (every project) or project (this directory)', (v) => { if (v !== 'user' && v !== 'project') throw new Error('--scope is user or project'); return v })
  .option('--tools <ids>', `only these, comma-separated: ${TOOLS.map((t) => t.id.replace('tools-', '')).join(', ')}`)
  .option('--dry-run', 'show the plan and change nothing; never signs in')
  .option('--no-verify', 'do not check that the Sekura server answers')
  .option('--no-login', 'do not sign in here; each tool signs in on first use (0.1.x behaviour)')
  .option('--device', 'sign in with a code on another device (the default over SSH and in containers)')
  .action(async (opts: InitOptions, cmd: Command) => {
    const r = await runInit(typedOnly(opts, cmd, ['skill', 'login']))
    process.exitCode = r.failed ? 1 : 0
  })
