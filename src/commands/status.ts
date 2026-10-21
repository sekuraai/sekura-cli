// `sekura status`: which tools are here, which carry Sekura, and whether the
// server answers. Reads only.

import { Command } from 'commander'
import { ENDPOINT } from '../catalogue.js'
import { buildPlan, detectTools, stepPresent, type Scope } from '../plan.js'
import { verifyEndpoint } from '../verify.js'
import { cross, dot, say, tick } from '../ui.js'

export async function runStatus(opts: { scope?: Scope; cwd?: string; verify?: boolean }): Promise<void> {
  const cwd = opts.cwd ?? process.cwd()
  const scope = opts.scope ?? 'user'
  const detected = detectTools(cwd)
  say()
  if (!detected.length) say('  No supported coding tool found on this machine.')
  const plan = buildPlan({ tools: detected.map((t) => t.id), scope, skill: true, cwd })
  for (const s of plan.steps) {
    const p = stepPresent(s)
    const mark = p === true ? tick : p === 'unknown' ? dot : cross
    const noun = s.kind === 'tool' ? 'connected' : 'installed'
    const word = p === true ? noun : p === 'unknown' ? (s.kind === 'tool' && s.target.kind === 'command' ? 'kept by the tool itself; ask it' : 'its file has comments; look by hand') : `not ${noun}`
    const label = s.kind === 'tool' ? s.tool.name : s.kind === 'skill' ? `skill ${s.path}` : `guidance ${s.path}`
    say(`${mark} ${label}: ${word}`)
  }
  for (const s of plan.skipped) say(`${dot} ${s.tool.name}: ${s.why}`)
  if (opts.verify !== false) {
    const v = await verifyEndpoint(ENDPOINT)
    say(`${v.ok ? tick : cross} ${v.detail}`)
  }
  say()
}

export const statusCommand = new Command('status')
  .description('Show which tools on this machine are connected to Sekura.')
  .option('--scope <scope>', 'user or project', 'user')
  .option('--no-verify', 'do not check that the Sekura server answers')
  .action(async (opts: { scope: Scope; verify?: boolean }) => { await runStatus(opts) })
