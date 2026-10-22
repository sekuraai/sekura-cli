// `sekura init`: detect, choose, review, apply, verify. Under a minute, and
// nothing is written before the review is shown and (unless --yes) agreed.

import { Command } from 'commander'
import { checkbox, confirm, select } from '@inquirer/prompts'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { DOCS, ENDPOINT, TOOLS, home } from '../catalogue.js'
import { applyStep, buildPlan, describeStep, detectTools, type Scope } from '../plan.js'
import { verifyEndpoint } from '../verify.js'
import { banner, cross, dot, say, tick } from '../ui.js'

export type InitOptions = {
  yes?: boolean
  skill?: boolean
  scope?: Scope
  tools?: string
  dryRun?: boolean
  cwd?: string
  verify?: boolean
}

/** The home folder (or the top of the disk) is no project: project scope
 *  there would put AGENTS.md and .mcp.json in it for every tool to find. */
export function isProjectDir(cwd: string): boolean {
  const real = (p: string) => { try { return realpathSync(p) } catch { return resolve(p) } }
  const dir = real(cwd)
  return dir !== real(home()) && dir !== real(homedir()) && dirname(dir) !== dir
}

export async function runInit(opts: InitOptions): Promise<{ written: number; byHand: number; failed: number }> {
  const interactive = !opts.yes && process.stdin.isTTY && process.stderr.isTTY
  const cwd = opts.cwd ?? process.cwd()
  banner()

  // 1. Detect.
  const detected = detectTools(cwd)
  let chosen: string[]
  if (opts.tools) {
    chosen = opts.tools.split(',').map((s) => s.trim()).filter(Boolean).map((s) => (s.startsWith('tools-') ? s : `tools-${s}`))
  } else if (detected.length === 0) {
    say('  No supported coding tool was found on this machine.')
    say(`  Sekura connects to Claude Code, Cursor, GitHub Copilot, OpenAI Codex and nearly forty other tools; the page has every one: ${DOCS}`)
    return { written: 0, byHand: 0, failed: 0 }
  } else if (!interactive) {
    chosen = detected.map((t) => t.id)
  } else {
    say(`  Found ${detected.length === 1 ? 'one tool' : `${detected.length} tools`}: ${detected.map((t) => t.name).join(', ')}`)
    say()
    chosen = await checkbox({
      message: 'Connect Sekura to',
      choices: detected.map((t) => ({ name: t.name, value: t.id, checked: true })),
      required: true,
    })
  }

  // 2. Scope and skill.
  let scope: Scope = opts.scope ?? 'user'
  const inProject = isProjectDir(cwd)
  if (scope === 'project' && !inProject) {
    say(`  ${cwd} is your home folder or the top of the disk, not a project: run sekura init --scope project inside the project, or use --scope user.`)
    say('  Nothing was changed.')
    return { written: 0, byHand: 0, failed: 1 }
  }
  if (!opts.scope && interactive && inProject) {
    scope = await select<Scope>({
      message: 'Where',
      choices: [
        { name: 'For me, in every project (your user configuration)', value: 'user' },
        { name: `This project only (${cwd})`, value: 'project' },
      ],
    })
  }
  let skill = opts.skill !== false
  if (opts.skill === undefined && interactive) {
    skill = await confirm({ message: 'Also install the sekura skill, which teaches the agent the quote-then-confirm rule?', default: true })
  }

  // 3. The plan, shown before anything happens.
  const plan = buildPlan({ tools: chosen, scope, skill, cwd })
  say()
  say(opts.dryRun ? '  Dry run. This would:' : '  This will:')
  for (const s of plan.steps) say(`${dot} ${describeStep(s, !!opts.dryRun)}`)
  for (const s of plan.skipped) say(`${dot} ${s.tool.name}: skipped, ${s.why}`)
  say(`${dot} touch nothing else: other servers, settings and files stay as they are`)
  say()
  if (opts.dryRun) return { written: 0, byHand: 0, failed: 0 }
  if (interactive && !(await confirm({ message: 'Apply?', default: true }))) {
    say('  Nothing was changed.')
    return { written: 0, byHand: 0, failed: 0 }
  }

  // 4. Apply, one step at a time, saying what each did.
  let written = 0, byHand = 0, failed = 0
  const signIns = new Map<string, string>()
  for (const s of plan.steps) {
    const r = applyStep(s)
    switch (r.status) {
      case 'written': case 'ran': written++; say(`${tick} ${r.where}`); break
      case 'removed': case 'absent': break
      case 'unchanged': say(`${tick} ${r.where} (already there)`); break
      case 'by-hand': byHand++; say(`${cross} ${r.where}: ${r.why}`); if (r.snippet) say(r.snippet.split('\n').map((l) => '      ' + l).join('\n')); break
      case 'failed': failed++; say(`${cross} ${r.where}: ${r.why}`); break
    }
    if (s.kind === 'tool' && (r.status === 'written' || r.status === 'ran' || r.status === 'unchanged')) signIns.set(s.tool.name, s.tool.signIn)
  }

  // 5. Verify the address, and say what comes next.
  if (opts.verify !== false) {
    const v = await verifyEndpoint(ENDPOINT)
    say(`${v.ok ? tick : cross} ${v.detail}`)
  }
  say()
  if (signIns.size) {
    say('  Next, sign in once per tool:')
    for (const [name, how] of signIns) say(`${dot} ${name}: ${how}`)
    say()
    say('  Then ask it which of your repositories Sekura can scan, and for a quote to scan one.')
  }
  say(`  Documentation and every other tool: ${DOCS}`)
  say()
  return { written, byHand, failed }
}

export const initCommand = new Command('init')
  .description('Connect the coding tools on this machine to Sekura, and install the sekura skill.')
  .option('-y, --yes', 'apply without asking; every detected tool, user scope, with the skill')
  .option('--no-skill', 'the MCP server only: no skill, no guidance block')
  .option('--scope <scope>', 'user (every project) or project (this directory)', (v) => { if (v !== 'user' && v !== 'project') throw new Error('--scope is user or project'); return v })
  .option('--tools <ids>', `only these, comma-separated: ${TOOLS.map((t) => t.id.replace('tools-', '')).join(', ')}`)
  .option('--dry-run', 'show the plan and change nothing')
  .option('--no-verify', 'do not check that the Sekura server answers')
  .action(async (opts: InitOptions) => {
    const r = await runInit(opts)
    process.exitCode = r.failed ? 1 : 0
  })
